import { WorkspaceHub } from "./realtime/workspace-hub";
import { claimPrimaryIdentity, getSageIdentity, linkCharacterIdentity, verifyEveAccessToken } from "./identity";
import type { EventEnvelope, Principal, SageEnv } from "./types";
import { deleteDiscordChannelMessage, discordBotRequest, discordGuildInviteUrl, discordInstallationState, findDiscordOperationAnnouncement, readDiscordGuildStructure, sendDiscordChannelMessage, sendDiscordDmToCharacter } from "./discord/service";
import { cleanupDiscordSecurity, consumeDiscordActionTicket, issueDiscordActionTicket, registerDiscordDevice } from "./discord/security";

export { WorkspaceHub };

const MAX_PAYLOAD_BYTES = 512 * 1024;
const ALLOWED_OBJECT_TYPES = new Set([
  "sage.fit",
  "sage.doctrine",
  "sage.route",
  "sage.shopping-list",
  "sage.operation",
  "sage.timer",
  "sage.wormhole-chain",
  "sage.industry-plan",
  "sage.appraisal",
  "sage.fleet",
  "sage.killmail",
  "sage.blueprint-plan",
  "sage.pi-survey",
  "sage.pi-template",
]);

function json(data: unknown, status = 200, extraHeaders: HeadersInit = {}): Response {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      ...Object.fromEntries(new Headers(extraHeaders)),
    },
  });
}

function error(status: number, code: string, message: string): Response {
  return json({ error: code, message }, status);
}

function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function requireSession(request: Request, env: SageEnv): Promise<Principal | Response> {
  const authorization = request.headers.get("Authorization") ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) return error(401, "missing_session", "A Sage Online session is required.");

  const tokenHash = await sha256Hex(match[1]);
  const row = await env.DB.prepare(
    `SELECT id, account_id
       FROM sessions
      WHERE token_hash = ?1
        AND revoked_at IS NULL
        AND expires_at > datetime('now')
      LIMIT 1`,
  ).bind(tokenHash).first<{ id: string; account_id: string }>();

  if (!row) return error(401, "invalid_session", "The Sage Online session is invalid or expired.");
  env.DB.prepare("UPDATE sessions SET last_seen_at = datetime('now') WHERE id = ?1").bind(row.id).run().catch(() => undefined);
  return { accountId: row.account_id, sessionId: row.id };
}

async function getActiveMembership(env: SageEnv, workspaceId: string, accountId: string, characterId?: number) {
  const base = `SELECT wm.workspace_id, wm.account_id, wm.eve_character_id, ei.roles_json, ei.titles_json
       FROM workspace_members wm
       LEFT JOIN eve_identities ei ON ei.character_id = wm.eve_character_id
      WHERE wm.workspace_id = ?1
        AND wm.account_id = ?2
        AND wm.membership_state = 'active'`;
  const query = characterId && characterId > 0
    ? base + " AND wm.eve_character_id = ?3 ORDER BY wm.last_verified_at DESC LIMIT 1"
    : base + " ORDER BY wm.last_verified_at DESC LIMIT 1";
  const statement = env.DB.prepare(query);
  return (characterId && characterId > 0 ? statement.bind(workspaceId, accountId, characterId) : statement.bind(workspaceId, accountId)).first<{
    workspace_id: string;
    account_id: string;
    eve_character_id: number | null;
    roles_json: string | null;
    titles_json: string | null;
  }>();
}

function parseStringArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

async function corporationAdministratorStatus(env: SageEnv, workspaceId: string, membership: { eve_character_id: number | null; roles_json: string | null } | null) {
  const roles = new Set(parseStringArray(membership?.roles_json ?? null));
  const workspace = await env.DB.prepare(
    `SELECT eve_corporation_id, eve_corporation_ceo_id FROM workspaces WHERE id = ?1 AND archived_at IS NULL LIMIT 1`,
  ).bind(workspaceId).first<{ eve_corporation_id: number | null; eve_corporation_ceo_id: number | null }>();
  let corporationCeoId = Number(workspace?.eve_corporation_ceo_id ?? 0);
  const corporationId = Number(workspace?.eve_corporation_id ?? 0);
  if (!(corporationCeoId > 0) && corporationId > 0) {
    try {
      const response = await fetch(`https://esi.evetech.net/corporations/${corporationId}/`, { headers: { "X-Compatibility-Date": env.ESI_COMPATIBILITY_DATE, "X-User-Agent": "NewEdenSage-Online/0.1.0" } });
      if (response.ok) {
        const corporation = await response.json() as { ceo_id?: number };
        const ceoId = Number(corporation.ceo_id ?? 0);
        if (Number.isSafeInteger(ceoId) && ceoId > 0) {
          corporationCeoId = ceoId;
          await env.DB.prepare(`UPDATE workspaces SET eve_corporation_ceo_id = ?2, updated_at = datetime('now') WHERE id = ?1`).bind(workspaceId, ceoId).run();
        }
      }
    } catch { /* CEO lookup is best effort; verified Director authority still applies. */ }
  }
  const characterId = Number(membership?.eve_character_id ?? 0);
  const isCeo = characterId > 0 && corporationCeoId === characterId;
  const isDirector = roles.has("Director");
  return { isCeo, isDirector, canConfigure: isCeo || isDirector };
}

async function hasPermission(env: SageEnv, workspaceId: string, accountId: string, permission: string, characterId?: number): Promise<boolean> {
  const membership = await getActiveMembership(env, workspaceId, accountId, characterId);
  if (!membership) return false;

  if (permission === "shared_object.read" || permission === "events.read") return true;

  const roles = new Set(parseStringArray(membership.roles_json));
  const titles = new Set(parseStringArray(membership.titles_json));
  const administrator = await corporationAdministratorStatus(env, workspaceId, membership);
  if (administrator.canConfigure) return true;

  const rules = await env.DB.prepare(
    `SELECT authority_type, authority_value
       FROM workspace_permission_rules
      WHERE workspace_id = ?1 AND permission = ?2 AND enabled = 1`,
  ).bind(workspaceId, permission).all<{ authority_type: string; authority_value: string }>();

  for (const rule of rules.results) {
    if (rule.authority_type === "eve_role" && roles.has(rule.authority_value)) return true;
    if (rule.authority_type === "eve_title" && titles.has(rule.authority_value)) return true;
    if (rule.authority_type === "account" && rule.authority_value === accountId) return true;
  }
  return false;
}

function publishPermissionFor(objectType: string): string {
  if (objectType === "sage.doctrine" || objectType === "sage.fit") return "doctrine.publish";
  if (objectType === "sage.wormhole-chain") return "wormholes.manage";
  if (objectType === "sage.operation" || objectType === "sage.fleet") return "fleet.manage";
  if (objectType === "sage.route" || objectType === "sage.pi-survey" || objectType === "sage.pi-template") return "route.publish";
  return "shared_object.publish";
}

async function ensureCorporationWorkspace(request: Request, env: SageEnv, principal: Principal): Promise<Response> {
  const eveToken = request.headers.get("X-EVE-Access-Token") ?? "";
  if (!eveToken) return error(401, "missing_eve_token", "A current EVE access token is required to verify corporation workspace membership.");
  let identity;
  try { identity = await verifyEveAccessToken(eveToken, env); }
  catch (cause) { return error(401, "invalid_eve_identity", cause instanceof Error ? cause.message : "EVE identity verification failed."); }
  const linked = await env.DB.prepare("SELECT account_id FROM eve_identities WHERE character_id = ?1 LIMIT 1").bind(identity.characterId).first<{ account_id: string }>();
  if (!linked || linked.account_id !== principal.accountId) return error(403, "identity_not_linked", "That EVE character is not linked to the active Sage account.");
  if (!identity.corporationId) return error(409, "corporation_unavailable", "EVE did not return a corporation for this character.");

  const workspaceId = `corp_${identity.corporationId}`;
  let corporationName = `Corporation ${identity.corporationId}`;
  let corporationCeoId: number | null = null;
  try {
    const response = await fetch(`https://esi.evetech.net/corporations/${identity.corporationId}/`, { headers: { "X-Compatibility-Date": env.ESI_COMPATIBILITY_DATE, "X-User-Agent": "NewEdenSage-Online/0.1.0" } });
    if (response.ok) {
      const corporation = await response.json() as { name?: string; ceo_id?: number };
      corporationName = String(corporation.name ?? corporationName);
      const ceoId = Number(corporation.ceo_id ?? 0);
      corporationCeoId = Number.isSafeInteger(ceoId) && ceoId > 0 ? ceoId : null;
    }
  } catch { /* Public corporation identity enrichment is best effort. */ }

  const existing = await env.DB.prepare("SELECT id FROM workspaces WHERE eve_corporation_id = ?1 AND archived_at IS NULL LIMIT 1").bind(identity.corporationId).first<{ id: string }>();
  const isNew = !existing;
  if (existing?.id && existing.id !== workspaceId) return error(409, "workspace_identity_conflict", "Corporation workspace identity does not match the deterministic corporation workspace ID.");

  const roles = new Set<string>();
  const titles = new Set<string>();
  if (identity.scopes.includes("esi-characters.read_corporation_roles.v1")) {
    try {
      const response = await fetch(`https://esi.evetech.net/characters/${identity.characterId}/roles/`, { headers: { Authorization: `Bearer ${eveToken}`, "X-Compatibility-Date": env.ESI_COMPATIBILITY_DATE, "X-User-Agent": "NewEdenSage-Online/0.1.0" } });
      if (response.ok) {
        const value = await response.json() as Record<string, unknown>;
        for (const key of ["roles", "roles_at_hq", "roles_at_base", "roles_at_other"]) for (const role of Array.isArray(value[key]) ? value[key] as unknown[] : []) if (typeof role === "string") roles.add(role);
      }
    } catch { /* Membership remains valid even if role enrichment fails. */ }
  }
  if (identity.scopes.includes("esi-characters.read_titles.v1")) {
    try {
      const response = await fetch(`https://esi.evetech.net/characters/${identity.characterId}/titles/`, { headers: { Authorization: `Bearer ${eveToken}`, "X-Compatibility-Date": env.ESI_COMPATIBILITY_DATE, "X-User-Agent": "NewEdenSage-Online/0.1.0" } });
      if (response.ok) for (const title of await response.json() as Array<{ name?: string }>) if (title?.name) titles.add(String(title.name));
    } catch { /* Optional enrichment. */ }
  }

  const statements: D1PreparedStatement[] = [
    env.DB.prepare(`INSERT INTO workspaces (id, type, eve_corporation_id, eve_alliance_id, name, eve_corporation_ceo_id, updated_at) VALUES (?1, 'corporation', ?2, ?3, ?4, ?5, datetime('now')) ON CONFLICT(id) DO UPDATE SET eve_alliance_id = excluded.eve_alliance_id, name = excluded.name, eve_corporation_ceo_id = COALESCE(excluded.eve_corporation_ceo_id, eve_corporation_ceo_id), updated_at = datetime('now'), archived_at = NULL`).bind(workspaceId, identity.corporationId, identity.allianceId, corporationName, corporationCeoId),
    env.DB.prepare(`UPDATE eve_identities SET corporation_id = ?1, alliance_id = ?2, roles_json = ?3, titles_json = ?4, last_verified_at = datetime('now'), updated_at = datetime('now') WHERE character_id = ?5 AND account_id = ?6`).bind(identity.corporationId, identity.allianceId, JSON.stringify([...roles]), JSON.stringify([...titles]), identity.characterId, principal.accountId),
    env.DB.prepare(`INSERT INTO workspace_members (workspace_id, account_id, eve_character_id, membership_state, last_verified_at) VALUES (?1, ?2, ?3, 'active', datetime('now')) ON CONFLICT(workspace_id, account_id, eve_character_id) DO UPDATE SET membership_state = 'active', last_verified_at = datetime('now')`).bind(workspaceId, principal.accountId, identity.characterId),
    env.DB.prepare(`INSERT OR IGNORE INTO workspace_permission_rules (id, workspace_id, permission, authority_type, authority_value) VALUES (?1, ?2, 'route.publish', 'eve_role', 'Director')`).bind(`perm_${workspaceId}_route_director`, workspaceId),
    env.DB.prepare(`INSERT OR IGNORE INTO workspace_permission_rules (id, workspace_id, permission, authority_type, authority_value) VALUES (?1, ?2, 'wormholes.manage', 'eve_role', 'Director')`).bind(`perm_${workspaceId}_wormholes_director`, workspaceId),

    env.DB.prepare(`INSERT OR IGNORE INTO workspace_permission_rules (id, workspace_id, permission, authority_type, authority_value)
      SELECT 'wormholes_bootstrap_backfill_' || ?1 || '_' || authority_value, ?1, 'wormholes.manage', 'account', authority_value
        FROM workspace_permission_rules
       WHERE workspace_id = ?1 AND permission = 'route.publish' AND authority_type = 'account' AND enabled = 1`).bind(workspaceId),
  ];
  if (isNew) {
    const defaultOperationRoles = ["Personnel_Manager", "Communications_Officer", "Starbase_Defense_Operator", "Skill_Plan_Manager"];
    for (const permission of ["fleet.manage", "fleet.approve"]) {
      for (const roleKey of defaultOperationRoles) {
        statements.push(env.DB.prepare(
          `INSERT OR IGNORE INTO workspace_permission_rules (id, workspace_id, permission, authority_type, authority_value) VALUES (?1, ?2, ?3, 'eve_role', ?4)`,
        ).bind(`perm_${workspaceId}_${permission.replace(/[^a-z0-9]+/gi, "_")}_${roleKey.toLowerCase()}`, workspaceId, permission, roleKey));
      }
    }
  }
  if (isNew) statements.push(env.DB.prepare(`INSERT OR IGNORE INTO workspace_permission_rules (id, workspace_id, permission, authority_type, authority_value) VALUES (?1, ?2, 'route.publish', 'account', ?3)`).bind(`perm_${workspaceId}_route_bootstrap`, workspaceId, principal.accountId));
  if (isNew) statements.push(env.DB.prepare(`INSERT OR IGNORE INTO workspace_permission_rules (id, workspace_id, permission, authority_type, authority_value) VALUES (?1, ?2, 'wormholes.manage', 'account', ?3)`).bind(`perm_${workspaceId}_wormholes_bootstrap`, workspaceId, principal.accountId));
  await env.DB.batch(statements);
  const canPublishRoutes = await hasPermission(env, workspaceId, principal.accountId, "route.publish", identity.characterId);
  const canManageWormholes = await hasPermission(env, workspaceId, principal.accountId, "wormholes.manage", identity.characterId);
  const canManageFleetOps = await hasPermission(env, workspaceId, principal.accountId, "fleet.manage", identity.characterId);
  const canApproveFleetOps = await hasPermission(env, workspaceId, principal.accountId, "fleet.approve", identity.characterId);
  const canManageDiscord = canManageFleetOps;
  const membership = await getActiveMembership(env, workspaceId, principal.accountId, identity.characterId);
  const administrator = await corporationAdministratorStatus(env, workspaceId, membership);
  return json({ workspace_id: workspaceId, workspace_type: "corporation", corporation_id: identity.corporationId, corporation_name: corporationName, character_id: identity.characterId, character_name: identity.characterName, can_publish_routes: canPublishRoutes, can_manage_wormholes: canManageWormholes, can_manage_fleet_ops: canManageFleetOps, can_approve_fleet_ops: canApproveFleetOps, can_manage_discord: canManageDiscord, can_configure_permissions: administrator.canConfigure, is_corporation_ceo: administrator.isCeo, roles: [...roles], titles: [...titles], member_access: "active" }, isNew ? 201 : 200);
}


const DEFAULT_OPERATION_AUTHORITY_ROLES = [
  "Personnel_Manager",
  "Communications_Officer",
  "Starbase_Defense_Operator",
  "Skill_Plan_Manager",
] as const;

const CORPORATION_PERMISSION_DEFINITIONS = [
  { key: "fleet.manage", label: "Create / Manage Operations", description: "Create, broadcast, edit and manage corporation operations.", defaultRoles: DEFAULT_OPERATION_AUTHORITY_ROLES },
  { key: "fleet.approve", label: "Approve / Deny Operation Applications", description: "Review member role requests when an operation requires leadership approval.", defaultRoles: DEFAULT_OPERATION_AUTHORITY_ROLES },
] as const;

type CorporationAuthorityType = "eve_role" | "eve_title";
type CorporationAuthoritySelection = { type: CorporationAuthorityType; value: string };

function corporationRoleLabel(roleKey: string) {
  return roleKey.replaceAll("_", " ").replace(/\b\w/g, (value) => value.toUpperCase());
}

async function visibleCorporationRoleKeys(env: SageEnv, workspaceId: string) {
  const keys = new Set<string>();
  for (const definition of CORPORATION_PERMISSION_DEFINITIONS) for (const role of definition.defaultRoles) keys.add(role);
  const members = await env.DB.prepare(
    `SELECT ei.roles_json FROM workspace_members wm LEFT JOIN eve_identities ei ON ei.character_id = wm.eve_character_id WHERE wm.workspace_id = ?1 AND wm.membership_state = 'active'`,
  ).bind(workspaceId).all<{ roles_json: string | null }>();
  for (const member of members.results) for (const role of parseStringArray(member.roles_json)) keys.add(role);
  const saved = await env.DB.prepare(
    `SELECT authority_value FROM workspace_permission_rules WHERE workspace_id = ?1 AND authority_type = 'eve_role'`,
  ).bind(workspaceId).all<{ authority_value: string }>();
  for (const row of saved.results) if (row.authority_value) keys.add(row.authority_value);
  return [...keys].sort((a, b) => corporationRoleLabel(a).localeCompare(corporationRoleLabel(b)));
}

async function visibleCorporationTitles(env: SageEnv, workspaceId: string) {
  const titles = new Set<string>();
  const members = await env.DB.prepare(
    `SELECT ei.titles_json FROM workspace_members wm LEFT JOIN eve_identities ei ON ei.character_id = wm.eve_character_id WHERE wm.workspace_id = ?1 AND wm.membership_state = 'active'`,
  ).bind(workspaceId).all<{ titles_json: string | null }>();
  for (const member of members.results) for (const title of parseStringArray(member.titles_json)) if (title.trim()) titles.add(title.trim());
  const saved = await env.DB.prepare(
    `SELECT authority_value FROM workspace_permission_rules WHERE workspace_id = ?1 AND authority_type = 'eve_title'`,
  ).bind(workspaceId).all<{ authority_value: string }>();
  for (const row of saved.results) if (row.authority_value?.trim()) titles.add(row.authority_value.trim());
  return [...titles].sort((a, b) => a.localeCompare(b));
}

async function corporationPermissionState(env: SageEnv, principal: Principal, workspaceId: string, characterId?: number) {
  const membership = await getActiveMembership(env, workspaceId, principal.accountId, characterId);
  if (!membership) throw new Error("ACTIVE_MEMBERSHIP_REQUIRED");
  const administrator = await corporationAdministratorStatus(env, workspaceId, membership);
  const [availableRoleKeys, availableTitles, enabled] = await Promise.all([
    visibleCorporationRoleKeys(env, workspaceId),
    visibleCorporationTitles(env, workspaceId),
    env.DB.prepare(
      `SELECT permission, authority_type, authority_value FROM workspace_permission_rules WHERE workspace_id = ?1 AND authority_type IN ('eve_role','eve_title') AND enabled = 1`,
    ).bind(workspaceId).all<{ permission: string; authority_type: CorporationAuthorityType; authority_value: string }>(),
  ]);
  const selectedByPermission = new Map<string, CorporationAuthoritySelection[]>();
  for (const row of enabled.results) {
    const values = selectedByPermission.get(row.permission) ?? [];
    if ((row.authority_type === "eve_role" || row.authority_type === "eve_title") && row.authority_value) values.push({ type: row.authority_type, value: row.authority_value });
    selectedByPermission.set(row.permission, values);
  }
  return {
    can_configure: administrator.canConfigure,
    is_corporation_ceo: administrator.isCeo,
    is_director: administrator.isDirector,
    administrators: [
      { key: "CEO", label: "CEO", locked: true },
      { key: "Director", label: "Director", locked: true },
    ],
    available_roles: availableRoleKeys.map((key) => ({ key, label: corporationRoleLabel(key) })),
    available_titles: availableTitles.map((value) => ({ value, label: value })),
    permissions: CORPORATION_PERMISSION_DEFINITIONS.map((definition) => {
      const fallback = definition.defaultRoles.map((value) => ({ type: "eve_role" as const, value }));
      const selected = selectedByPermission.has(definition.key) ? selectedByPermission.get(definition.key)! : fallback;
      return {
        key: definition.key,
        label: definition.label,
        description: definition.description,
        selected_authorities: selected,
        selected_role_keys: selected.filter((item) => item.type === "eve_role").map((item) => item.value),
        selected_title_values: selected.filter((item) => item.type === "eve_title").map((item) => item.value),
        administrator_keys: ["CEO", "Director"],
      };
    }),
  };
}

async function updateCorporationPermissionPolicy(request: Request, env: SageEnv, principal: Principal, workspaceId: string, permissionKey: string): Promise<Response> {
  const definition = CORPORATION_PERMISSION_DEFINITIONS.find((item) => item.key === permissionKey);
  if (!definition) return error(404, "permission_not_configurable", "That corporation Sage permission is not configurable here.");
  const actorCharacterId = Number(request.headers.get("X-Sage-Character-ID") ?? 0);
  const membership = await getActiveMembership(env, workspaceId, principal.accountId, actorCharacterId > 0 ? actorCharacterId : undefined);
  const administrator = await corporationAdministratorStatus(env, workspaceId, membership);
  if (!administrator.canConfigure) return error(403, "permission_denied", "Only the selected corporation CEO or Director character may change Sage corporation permissions.");
  let body: { authorities?: Array<{ type?:string; value?:string }>; role_keys?: string[]; title_values?: string[] };
  try { body = await request.json(); } catch { return error(400, "invalid_json", "Request body must be valid JSON."); }
  const rawAuthorities = Array.isArray(body.authorities)
    ? body.authorities
    : [
        ...(Array.isArray(body.role_keys) ? body.role_keys.map((value) => ({ type: "eve_role", value })) : []),
        ...(Array.isArray(body.title_values) ? body.title_values.map((value) => ({ type: "eve_title", value })) : []),
      ];
  const requested: CorporationAuthoritySelection[] = [];
  const seen = new Set<string>();
  for (const item of rawAuthorities) {
    const type = item?.type === "eve_title" ? "eve_title" : item?.type === "eve_role" ? "eve_role" : null;
    const value = typeof item?.value === "string" ? item.value.trim() : "";
    if (!type || !value) continue;
    // CEO/Director policy editors may select a corporation title even when no currently linked Sage member holds it.
    const key = type + "\u0000" + value;
    if (seen.has(key)) continue;
    seen.add(key);
    requested.push({ type, value });
  }
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(`UPDATE workspace_permission_rules SET enabled = 0 WHERE workspace_id = ?1 AND permission = ?2 AND authority_type IN ('eve_role','eve_title')`).bind(workspaceId, permissionKey),
    env.DB.prepare(`UPDATE workspace_permission_rules SET enabled = 0 WHERE workspace_id = ?1 AND permission = ?2 AND authority_type = 'account'`).bind(workspaceId, permissionKey),
  ];
  for (const authority of requested) {
    const ruleId = `perm_${workspaceId}_${permissionKey.replace(/[^a-z0-9]+/gi, "_")}_${authority.type}_${authority.value.replace(/[^a-z0-9]+/gi, "_")}`;
    statements.push(env.DB.prepare(
      `INSERT INTO workspace_permission_rules (id, workspace_id, permission, authority_type, authority_value, enabled) VALUES (?1, ?2, ?3, ?4, ?5, 1) ON CONFLICT(workspace_id, permission, authority_type, authority_value) DO UPDATE SET enabled = 1`,
    ).bind(ruleId, workspaceId, permissionKey, authority.type, authority.value));
  }
  statements.push(env.DB.prepare(
    `INSERT INTO audit_log (workspace_id, actor_account_id, action, resource_type, resource_id, detail_json) VALUES (?1, ?2, 'corporation.permission.update', 'workspace.permission', ?3, ?4)`,
  ).bind(workspaceId, principal.accountId, permissionKey, JSON.stringify({ authorities: requested })));
  await env.DB.batch(statements);
  return json(await corporationPermissionState(env, principal, workspaceId, actorCharacterId > 0 ? actorCharacterId : undefined));
}

async function resolveRestrictedRecipients(env: SageEnv, workspaceId: string, characterIds: number[]): Promise<string[]> {
  const ids = [...new Set(characterIds.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))];
  if (!ids.length) return [];
  const accounts = new Set<string>();
  for (const characterId of ids) {
    const rows = await env.DB.prepare(`SELECT account_id FROM workspace_members WHERE workspace_id = ?1 AND eve_character_id = ?2 AND membership_state = 'active'`).bind(workspaceId, characterId).all<{ account_id: string }>();
    for (const row of rows.results) accounts.add(row.account_id);
  }
  return [...accounts];
}


async function readEvent(env: SageEnv, sequence: number): Promise<EventEnvelope | null> {
  return env.DB.prepare(
    `SELECT sequence, workspace_id, event_type, object_id, object_version, created_at
       FROM events_outbox WHERE sequence = ?1`,
  ).bind(sequence).first<EventEnvelope>();
}

async function enqueueEvent(env: SageEnv, event: EventEnvelope): Promise<void> {
  await env.EVENT_QUEUE.send(event);
  await env.DB.prepare("UPDATE events_outbox SET queued_at = datetime('now') WHERE sequence = ?1")
    .bind(event.sequence).run();
}

async function publishNewObject(request: Request, env: SageEnv, principal: Principal, workspaceId: string): Promise<Response> {
  let body: { object_type?: string; payload?: unknown; idempotency_key?: string; visibility?: "workspace" | "restricted"; recipient_character_ids?: number[] };
  try {
    body = await request.json();
  } catch {
    return error(400, "invalid_json", "Request body must be valid JSON.");
  }

  const objectType = body.object_type ?? "";
  if (!ALLOWED_OBJECT_TYPES.has(objectType)) return error(400, "invalid_object_type", "Unsupported Sage shared object type.");

  const visibility = body.visibility === "restricted" ? "restricted" : "workspace";
  const recipientAccounts = visibility === "restricted" ? await resolveRestrictedRecipients(env, workspaceId, Array.isArray(body.recipient_character_ids) ? body.recipient_character_ids : []) : [];
  if (visibility === "restricted" && !recipientAccounts.length) return error(400, "empty_restricted_acl", "Restricted sharing needs at least one active workspace recipient character.");

  let payloadForStorage: unknown = body.payload ?? null;
  let payloadJson = JSON.stringify(payloadForStorage);
  if (new TextEncoder().encode(payloadJson).byteLength > MAX_PAYLOAD_BYTES) {
    return error(413, "payload_too_large", "Shared object payload exceeds 512 KiB.");
  }

  const actorCharacterId = Number(request.headers.get("X-Sage-Character-ID") ?? 0);
  if (objectType === "sage.operation" && (!Number.isSafeInteger(actorCharacterId) || actorCharacterId <= 0)) return error(400, "character_required", "Select the EVE character issuing this operation command.");
  const canPublish = await hasPermission(env, workspaceId, principal.accountId, publishPermissionFor(objectType), objectType === "sage.operation" ? actorCharacterId : undefined);
  if (!canPublish) {
    return error(403, "permission_denied", "Your verified corporation authority does not allow this publish action.");
  }
  if (objectType === "sage.operation") {
    const identity = await env.DB.prepare("SELECT character_name FROM eve_identities WHERE character_id=?1 AND account_id=?2 LIMIT 1").bind(actorCharacterId, principal.accountId).first<{character_name:string}>();
    const actor = { characterId: actorCharacterId, characterName: identity?.character_name ?? `Character ${actorCharacterId}` };
    const supplied = payloadForStorage && typeof payloadForStorage === "object" && !Array.isArray(payloadForStorage) ? payloadForStorage as Record<string,unknown> : {};
    payloadForStorage = { ...supplied, createdBy: actor, operationOwner: actor, notificationLeaderCharacterIds: [] };
    payloadJson = JSON.stringify(payloadForStorage);
    if (new TextEncoder().encode(payloadJson).byteLength > MAX_PAYLOAD_BYTES) return error(413, "payload_too_large", "Operation payload exceeds 512 KiB.");
  }

  if (body.idempotency_key) {
    const existing = await env.DB.prepare(
      `SELECT resource_id FROM idempotency_keys
        WHERE workspace_id = ?1 AND account_id = ?2 AND idempotency_key = ?3`,
    ).bind(workspaceId, principal.accountId, body.idempotency_key).first<{ resource_id: string | null }>();
    if (existing?.resource_id) {
      return json({ id: existing.resource_id, idempotent_replay: true }, 200);
    }
  }

  const objectId = newId("obj");
  const eventType = objectType === "sage.doctrine" ? "doctrine.published" : objectType === "sage.wormhole-chain" ? "wormhole_chain.published" : "shared_object.published";

  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      `INSERT INTO shared_objects
       (id, workspace_id, object_type, current_version, visibility, created_by_account_id, updated_by_account_id, published_at)
       VALUES (?1, ?2, ?3, 1, ?5, ?4, ?4, datetime('now'))`,
    ).bind(objectId, workspaceId, objectType, principal.accountId, visibility),
    env.DB.prepare(
      `INSERT INTO shared_object_versions (object_id, version, payload_json, published_by_account_id)
       VALUES (?1, 1, ?2, ?3)`,
    ).bind(objectId, payloadJson, principal.accountId),
    env.DB.prepare(
      `INSERT INTO events_outbox (workspace_id, event_type, object_id, object_version)
       VALUES (?1, ?2, ?3, 1)`,
    ).bind(workspaceId, eventType, objectId),
    env.DB.prepare(
      `INSERT INTO audit_log (workspace_id, actor_account_id, action, resource_type, resource_id)
       VALUES (?1, ?2, 'shared_object.publish', ?3, ?4)`,
    ).bind(workspaceId, principal.accountId, objectType, objectId),
  ];

  if (body.idempotency_key) {
    statements.push(env.DB.prepare(
      `INSERT INTO idempotency_keys (workspace_id, account_id, idempotency_key, operation, resource_id, expires_at)
       VALUES (?1, ?2, ?3, 'shared_object.publish', ?4, datetime('now', '+7 days'))`,
    ).bind(workspaceId, principal.accountId, body.idempotency_key, objectId));
  }

  if (visibility === "restricted") {
    for (const accountId of new Set([principal.accountId, ...recipientAccounts])) statements.push(env.DB.prepare("INSERT OR IGNORE INTO shared_object_acl (object_id, account_id) VALUES (?1, ?2)").bind(objectId, accountId));
  }

  await env.DB.batch(statements);
  const eventRow = await env.DB.prepare(
    `SELECT sequence FROM events_outbox WHERE workspace_id = ?1 AND object_id = ?2 AND object_version = 1 ORDER BY sequence DESC LIMIT 1`,
  ).bind(workspaceId, objectId).first<{ sequence: number }>();
  if (eventRow) {
    const event = await readEvent(env, eventRow.sequence);
    if (event) await enqueueEvent(env, event).catch(() => undefined);
  }

  return json({ id: objectId, object_type: objectType, version: 1 }, 201);
}

function wormholeChainAuditDiff(before: unknown, after: unknown) {
  const object = (value: unknown): Record<string, any> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
  const changed = (left: unknown, right: unknown) => JSON.stringify(left) !== JSON.stringify(right);
  const compare = (field: string) => { const a=object(object(before)[field]); const b=object(object(after)[field]); const ak=new Set(Object.keys(a)); const bk=new Set(Object.keys(b)); return { added:[...bk].filter(k=>!ak.has(k)), removed:[...ak].filter(k=>!bk.has(k)), edited:[...bk].filter(k=>ak.has(k)&&changed(a[k],b[k])) }; };
  const scanBefore=Array.isArray(object(before).scanHistory)?object(before).scanHistory:[]; const scanAfter=Array.isArray(object(after).scanHistory)?object(after).scanHistory:[];
  return { systems:compare("systems"), signatures:compare("signatures"), connections:compare("connections"), scanHistory:{before:scanBefore.length,after:scanAfter.length,added:Math.max(0,scanAfter.length-scanBefore.length)}, homeChanged:object(before).homeSystemId!==object(after).homeSystemId, rallyChanged:object(before).rallySystemId!==object(after).rallySystemId, layoutChanged:changed(object(before).mapLayout,object(after).mapLayout) };
}

async function updateObject(request: Request, env: SageEnv, principal: Principal, workspaceId: string, objectId: string): Promise<Response> {
  let body: { payload?: unknown; expected_version?: number; idempotency_key?: string };
  try {
    body = await request.json();
  } catch {
    return error(400, "invalid_json", "Request body must be valid JSON.");
  }

  const current = await env.DB.prepare(
    `SELECT id, object_type, current_version FROM shared_objects
      WHERE id = ?1 AND workspace_id = ?2 AND archived_at IS NULL`,
  ).bind(objectId, workspaceId).first<{ id: string; object_type: string; current_version: number }>();
  if (!current) return error(404, "not_found", "Shared object not found.");

  const actorCharacterId = Number(request.headers.get("X-Sage-Character-ID") ?? 0);
  if (current.object_type === "sage.operation" && (!Number.isSafeInteger(actorCharacterId) || actorCharacterId <= 0)) return error(400, "character_required", "Select the EVE character issuing this operation command.");
  if (!(await hasPermission(env, workspaceId, principal.accountId, publishPermissionFor(current.object_type), current.object_type === "sage.operation" ? actorCharacterId : undefined))) {
    return error(403, "permission_denied", "Your verified corporation authority does not allow this update action.");
  }

  if (body.expected_version !== undefined && body.expected_version !== current.current_version) {
    return json({ error: "version_conflict", current_version: current.current_version }, 409);
  }

  if (current.object_type === "sage.operation") {
    const currentVersionRow = await env.DB.prepare("SELECT payload_json FROM shared_object_versions WHERE object_id = ?1 AND version = ?2 LIMIT 1").bind(objectId, current.current_version).first<{ payload_json:string }>();
    if (currentVersionRow?.payload_json) {
      try {
        const currentPayload = JSON.parse(currentVersionRow.payload_json);
        const nextPayload = body.payload && typeof body.payload === "object" ? body.payload as Record<string,unknown> : {};
        if (currentPayload?.status === "cancelled") return error(409, "operation_cancelled_terminal", "A cancelled corporation operation is closed and cannot be modified or reopened.");
        if (nextPayload.status === "cancelled") return error(409, "operation_cancel_endpoint_required", "Use Cancel Operation so Sage Online can close applications and remove the Discord announcement safely.");
        nextPayload.createdBy = currentPayload?.createdBy;
        nextPayload.operationOwner = currentPayload?.operationOwner ?? currentPayload?.createdBy ?? null;
        nextPayload.notificationLeaderCharacterIds = Array.isArray(currentPayload?.notificationLeaderCharacterIds) ? currentPayload.notificationLeaderCharacterIds.map(Number).filter((id:number)=>Number.isSafeInteger(id)&&id>0).slice(0,25) : [];
        body.payload = nextPayload;
      } catch { /* Existing payload validation occurs below. */ }
    }
  }

  let previousPayload: unknown = null;
  if (current.object_type === "sage.wormhole-chain") {
    const previous = await env.DB.prepare("SELECT payload_json FROM shared_object_versions WHERE object_id = ?1 AND version = ?2 LIMIT 1").bind(objectId, current.current_version).first<{ payload_json:string }>();
    if (previous?.payload_json) try { previousPayload = JSON.parse(previous.payload_json); } catch { previousPayload = null; }
  }
  const payloadJson = JSON.stringify(body.payload ?? null);
  if (new TextEncoder().encode(payloadJson).byteLength > MAX_PAYLOAD_BYTES) {
    return error(413, "payload_too_large", "Shared object payload exceeds 512 KiB.");
  }

  const nextVersion = current.current_version + 1;
  const eventType = current.object_type === "sage.doctrine" ? "doctrine.updated" : current.object_type === "sage.wormhole-chain" ? "wormhole_chain.updated" : "shared_object.updated";

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE shared_objects SET current_version = ?1, updated_by_account_id = ?2, updated_at = datetime('now')
        WHERE id = ?3 AND workspace_id = ?4 AND current_version = ?5`,
    ).bind(nextVersion, principal.accountId, objectId, workspaceId, current.current_version),
    env.DB.prepare(
      `INSERT INTO shared_object_versions (object_id, version, payload_json, published_by_account_id)
       VALUES (?1, ?2, ?3, ?4)`,
    ).bind(objectId, nextVersion, payloadJson, principal.accountId),
    env.DB.prepare(
      `INSERT INTO events_outbox (workspace_id, event_type, object_id, object_version)
       VALUES (?1, ?2, ?3, ?4)`,
    ).bind(workspaceId, eventType, objectId, nextVersion),
    env.DB.prepare(
      `INSERT INTO audit_log (workspace_id, actor_account_id, action, resource_type, resource_id, detail_json)
       VALUES (?1, ?2, 'shared_object.update', ?3, ?4, ?5)`,
    ).bind(workspaceId, principal.accountId, current.object_type, objectId, JSON.stringify(current.object_type === "sage.wormhole-chain" ? { version: nextVersion, changes: wormholeChainAuditDiff(previousPayload, body.payload ?? null) } : { version: nextVersion })),
  ]);

  const eventRow = await env.DB.prepare(
    `SELECT sequence FROM events_outbox WHERE workspace_id = ?1 AND object_id = ?2 AND object_version = ?3 ORDER BY sequence DESC LIMIT 1`,
  ).bind(workspaceId, objectId, nextVersion).first<{ sequence: number }>();
  if (eventRow) {
    const event = await readEvent(env, eventRow.sequence);
    if (event) await enqueueEvent(env, event).catch(() => undefined);
  }

  return json({ id: objectId, object_type: current.object_type, version: nextVersion });
}

async function archiveObject(env: SageEnv, principal: Principal, workspaceId: string, objectId: string): Promise<Response> {
  const current = await env.DB.prepare(`SELECT id, object_type, current_version FROM shared_objects WHERE id = ?1 AND workspace_id = ?2 AND archived_at IS NULL`).bind(objectId, workspaceId).first<{ id:string; object_type:string; current_version:number }>();
  if (!current) return error(404, "not_found", "Shared object not found.");
  if (!(await hasPermission(env, workspaceId, principal.accountId, publishPermissionFor(current.object_type)))) return error(403, "permission_denied", "Your verified corporation authority does not allow this unpublish action.");
  await env.DB.batch([
    env.DB.prepare(`UPDATE shared_objects SET archived_at = datetime('now'), updated_at = datetime('now'), updated_by_account_id = ?1 WHERE id = ?2 AND workspace_id = ?3`).bind(principal.accountId, objectId, workspaceId),
    env.DB.prepare(`INSERT INTO events_outbox (workspace_id, event_type, object_id, object_version) VALUES (?1, 'shared_object.unpublished', ?2, ?3)`).bind(workspaceId, objectId, current.current_version),
    env.DB.prepare(`INSERT INTO audit_log (workspace_id, actor_account_id, action, resource_type, resource_id, detail_json) VALUES (?1, ?2, 'shared_object.unpublish', ?3, ?4, ?5)`).bind(workspaceId, principal.accountId, current.object_type, objectId, JSON.stringify({ version: current.current_version })),
  ]);
  const eventRow = await env.DB.prepare(`SELECT sequence FROM events_outbox WHERE workspace_id = ?1 AND object_id = ?2 AND event_type = 'shared_object.unpublished' ORDER BY sequence DESC LIMIT 1`).bind(workspaceId, objectId).first<{ sequence:number }>();
  if (eventRow) { const event = await readEvent(env, eventRow.sequence); if (event) await enqueueEvent(env, event).catch(() => undefined); }
  return json({ id: objectId, object_type: current.object_type, archived: true });
}

function discordRedirectUri(env:SageEnv,origin:string){return env.DISCORD_REDIRECT_URI||`${origin}/v1/discord/oauth/callback`;}
async function discordIntegrationStatus(env:SageEnv,principal:Principal,workspaceId:string,characterId:number){
  const integration=await env.DB.prepare("SELECT guild_id, channel_id, enabled, updated_at FROM discord_integrations WHERE workspace_id = ?1 LIMIT 1").bind(workspaceId).first<{guild_id:string;channel_id:string|null;enabled:number;updated_at:string}>();
  const allowed=await env.DB.prepare("SELECT channel_id FROM discord_allowed_channels WHERE workspace_id=?1 AND enabled=1 ORDER BY channel_id").bind(workspaceId).all<{channel_id:string}>();
  const link=await env.DB.prepare("SELECT eve_character_id,discord_user_id,discord_username,discord_global_name,dm_enabled,linked_at,updated_at FROM discord_user_links WHERE workspace_id=?1 AND account_id=?2 AND dm_enabled=1 ORDER BY updated_at DESC LIMIT 1").bind(workspaceId,principal.accountId).first<Record<string,unknown>>();
  const discordUserId=String(link?.discord_user_id??"");
  const notificationRows=await env.DB.prepare(`SELECT wm.eve_character_id,COALESCE(ei.character_name,'Character ' || wm.eve_character_id) AS character_name,CASE WHEN dnt.enabled=1 AND dnt.discord_user_id=?3 THEN 1 ELSE 0 END AS notification_enabled
    FROM workspace_members wm
    LEFT JOIN eve_identities ei ON ei.character_id=wm.eve_character_id
    LEFT JOIN discord_notification_targets dnt ON dnt.workspace_id=wm.workspace_id AND dnt.account_id=wm.account_id AND dnt.eve_character_id=wm.eve_character_id
    WHERE wm.workspace_id=?1 AND wm.account_id=?2 AND wm.membership_state='active'
    ORDER BY character_name`).bind(workspaceId,principal.accountId,discordUserId).all<{eve_character_id:number;character_name:string;notification_enabled:number}>();
  const linkedCount=(await env.DB.prepare("SELECT COUNT(DISTINCT discord_user_id) AS count FROM discord_notification_targets WHERE workspace_id=?1 AND enabled=1").bind(workspaceId).first<{count:number}>())?.count??0;
  const canManage=characterId>0&&await hasPermission(env,workspaceId,principal.accountId,"fleet.manage",characterId);
  const clientId=String(env.DISCORD_CLIENT_ID??"");
  const guildId=String(integration?.guild_id??"");
  const channelId=String(integration?.channel_id??"");
  const install=await discordInstallationState(env,guildId,channelId);
  const inviteUrl=discordGuildInviteUrl(clientId,guildId);
  return {
    integration:integration?{guildId,channelId,allowedChannelIds:allowed.results.map(row=>String(row.channel_id)),enabled:integration.enabled===1,updatedAt:integration.updated_at}:null,
    link:link?{discordUserId,username:String(link.discord_username??""),globalName:link.discord_global_name?String(link.discord_global_name):null,dmEnabled:Number(link.dm_enabled??0)===1,linkedAt:String(link.linked_at??""),linkedViaCharacterId:Number(link.eve_character_id??0)}:null,
    notificationCharacters:notificationRows.results.map(row=>({characterId:Number(row.eve_character_id),characterName:String(row.character_name),enabled:Number(row.notification_enabled)===1})),
    linkedUserCount:Number(linkedCount),canManage,inviteUrl,botInstalled:install.botInstalled,channelAccessible:install.channelAccessible,
  };
}
async function discordServerStructure(env:SageEnv,principal:Principal,workspaceId:string,characterId:number){
  if(!Number.isSafeInteger(characterId)||characterId<=0||!(await hasPermission(env,workspaceId,principal.accountId,"fleet.manage",characterId)))return error(403,"permission_denied","Discord server structure requires corporation leadership authority.");
  const integration=await env.DB.prepare("SELECT guild_id FROM discord_integrations WHERE workspace_id=?1 LIMIT 1").bind(workspaceId).first<{guild_id:string}>();
  if(!integration?.guild_id)return error(409,"discord_server_not_configured","Save the corporation Discord server before loading its channels.");
  try{return json(await readDiscordGuildStructure(env,integration.guild_id));}
  catch(cause){return error(409,"discord_bot_not_installed",cause instanceof Error?cause.message:"SageBot cannot read this Discord server yet.");}
}
async function configureDiscordIntegration(request:Request,env:SageEnv,principal:Principal,workspaceId:string){
  const actorCharacterId=Number(request.headers.get("X-Sage-Character-ID")??0);
  if(!Number.isSafeInteger(actorCharacterId)||actorCharacterId<=0||!(await hasPermission(env,workspaceId,principal.accountId,"fleet.manage",actorCharacterId)))return error(403,"permission_denied","Discord integration settings require corporation leadership authority.");
  let body:{guild_id?:string;channel_id?:string;allowed_channel_ids?:string[];enabled?:boolean};try{body=await request.json();}catch{return error(400,"invalid_json","Request body must be valid JSON.");}
  const guildId=String(body.guild_id??"").trim();
  const channelId=String(body.channel_id??"").trim();
  const requestedAllowed=[...new Set((Array.isArray(body.allowed_channel_ids)?body.allowed_channel_ids:[]).map(value=>String(value).trim()).filter(Boolean))];
  if(!guildId)return error(400,"guild_required","Enter the Discord server (guild) ID.");
  if(!/^\d{17,20}$/.test(guildId))return error(400,"guild_invalid","Discord server ID must be a numeric Discord snowflake.");
  if(channelId&&!/^\d{17,20}$/.test(channelId))return error(400,"channel_invalid","Discord channel ID must be a numeric Discord snowflake.");
  if(requestedAllowed.some(id=>!/^\d{17,20}$/.test(id)))return error(400,"allowed_channel_invalid","Every allowed Discord channel must be a numeric Discord snowflake.");
  if(channelId&&!requestedAllowed.includes(channelId))requestedAllowed.push(channelId);
  if(requestedAllowed.length){
    let structure;
    try{structure=await readDiscordGuildStructure(env,guildId);}catch(cause){return error(409,"discord_bot_not_installed",cause instanceof Error?cause.message:"Install SageBot in this server before selecting channels.");}
    const sendable=new Set(structure.sendableChannelIds);
    if(requestedAllowed.some(id=>!sendable.has(id)))return error(409,"discord_channel_not_sendable","One or more selected Discord channels are not visible/sendable text channels in this server.");
  }
  const statements=[
    env.DB.prepare(`INSERT INTO discord_integrations (id,workspace_id,guild_id,channel_id,enabled,credential_ref,updated_at) VALUES (?1,?2,?3,?4,?5,'server:discord',datetime('now')) ON CONFLICT(workspace_id) DO UPDATE SET guild_id=excluded.guild_id,channel_id=excluded.channel_id,enabled=excluded.enabled,credential_ref=excluded.credential_ref,updated_at=datetime('now')`).bind(`discord_${workspaceId}`,workspaceId,guildId,channelId||null,body.enabled?1:0),
    env.DB.prepare("DELETE FROM discord_allowed_channels WHERE workspace_id=?1").bind(workspaceId),
  ];
  for(const allowedId of requestedAllowed)statements.push(env.DB.prepare("INSERT INTO discord_allowed_channels (workspace_id,channel_id,enabled,updated_at) VALUES (?1,?2,1,datetime('now'))").bind(workspaceId,allowedId));
  statements.push(env.DB.prepare(`INSERT INTO audit_log (workspace_id,actor_account_id,action,resource_type,resource_id,detail_json) VALUES (?1,?2,'discord.configure','discord.integration',?3,?4)`).bind(workspaceId,principal.accountId,`discord_${workspaceId}`,JSON.stringify({guild_id:guildId,channel_id:channelId||null,allowed_channel_ids:requestedAllowed,enabled:Boolean(body.enabled)})));
  await env.DB.batch(statements);
  return json(await discordIntegrationStatus(env,principal,workspaceId,0));
}
async function discordLinkUrl(env:SageEnv,principal:Principal,workspaceId:string,url:URL){
  if(!env.DISCORD_CLIENT_ID||!env.DISCORD_CLIENT_SECRET)return error(503,"discord_service_unavailable","Sage Discord linking is not available yet.");
  const characterId=Number(url.searchParams.get("character_id")??0);if(!Number.isSafeInteger(characterId)||characterId<=0)return error(400,"character_required","Select a corporation character to link.");
  const member=await env.DB.prepare(`SELECT 1 AS ok FROM workspace_members WHERE workspace_id=?1 AND account_id=?2 AND eve_character_id=?3 AND membership_state='active' LIMIT 1`).bind(workspaceId,principal.accountId,characterId).first();if(!member)return error(403,"character_not_member","The selected character is not an active member of this corporation workspace.");
  const state=crypto.randomUUID();await env.DB.prepare(`INSERT INTO discord_oauth_states (state,workspace_id,account_id,eve_character_id,expires_at) VALUES (?1,?2,?3,?4,datetime('now','+10 minutes'))`).bind(state,workspaceId,principal.accountId,characterId).run();
  const redirect=discordRedirectUri(env,url.origin);const auth=new URL("https://discord.com/oauth2/authorize");auth.searchParams.set("client_id",env.DISCORD_CLIENT_ID);auth.searchParams.set("response_type","code");auth.searchParams.set("redirect_uri",redirect);auth.searchParams.set("scope","identify");auth.searchParams.set("state",state);auth.searchParams.set("prompt","consent");return json({url:auth.toString(),expiresInSeconds:600});
}
async function discordOauthCallback(request:Request,env:SageEnv,url:URL){
  const code=String(url.searchParams.get("code")??"");const state=String(url.searchParams.get("state")??"");if(!code||!state)return new Response("Discord link failed: missing authorization code/state.",{status:400,headers:{"Content-Type":"text/plain; charset=utf-8"}});
  const row=await env.DB.prepare(`SELECT workspace_id,account_id,eve_character_id FROM discord_oauth_states WHERE state=?1 AND expires_at > datetime('now') LIMIT 1`).bind(state).first<{workspace_id:string;account_id:string;eve_character_id:number}>();if(!row)return new Response("Discord link expired or invalid. Return to New Eden Sage and try Link Discord again.",{status:400,headers:{"Content-Type":"text/plain; charset=utf-8"}});
  if(!env.DISCORD_CLIENT_ID||!env.DISCORD_CLIENT_SECRET)return new Response("Sage Discord linking is temporarily unavailable.",{status:503,headers:{"Content-Type":"text/plain; charset=utf-8"}});
  const redirect=discordRedirectUri(env,url.origin);const form=new URLSearchParams({client_id:env.DISCORD_CLIENT_ID,client_secret:env.DISCORD_CLIENT_SECRET,grant_type:"authorization_code",code,redirect_uri:redirect});
  const tokenResponse=await fetch("https://discord.com/api/v10/oauth2/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:form});const token=await tokenResponse.json().catch(()=>({})) as {access_token?:string};if(!tokenResponse.ok||!token.access_token)return new Response("Discord authorization failed. Return to New Eden Sage and try again.",{status:400,headers:{"Content-Type":"text/plain; charset=utf-8"}});
  const userResponse=await fetch("https://discord.com/api/v10/users/@me",{headers:{Authorization:`Bearer ${token.access_token}`}});const user=await userResponse.json().catch(()=>({})) as {id?:string;username?:string;global_name?:string|null};if(!userResponse.ok||!user.id)return new Response("Discord user identity could not be read.",{status:400,headers:{"Content-Type":"text/plain; charset=utf-8"}});
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO discord_user_links (workspace_id,account_id,eve_character_id,discord_user_id,discord_username,discord_global_name,dm_enabled,linked_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,1,datetime('now'),datetime('now')) ON CONFLICT(workspace_id,account_id,eve_character_id) DO UPDATE SET discord_user_id=excluded.discord_user_id,discord_username=excluded.discord_username,discord_global_name=excluded.discord_global_name,dm_enabled=1,linked_at=datetime('now'),updated_at=datetime('now')`).bind(row.workspace_id,row.account_id,row.eve_character_id,user.id,String(user.username??user.id),user.global_name??null),
    env.DB.prepare("UPDATE discord_notification_targets SET discord_user_id=?3,updated_at=datetime('now') WHERE workspace_id=?1 AND account_id=?2").bind(row.workspace_id,row.account_id,user.id),
    env.DB.prepare(`INSERT INTO discord_notification_targets (workspace_id,account_id,eve_character_id,discord_user_id,enabled,updated_at) VALUES (?1,?2,?3,?4,1,datetime('now')) ON CONFLICT(workspace_id,account_id,eve_character_id) DO UPDATE SET discord_user_id=excluded.discord_user_id,enabled=1,updated_at=datetime('now')`).bind(row.workspace_id,row.account_id,row.eve_character_id,user.id),
    env.DB.prepare("DELETE FROM discord_oauth_states WHERE state=?1").bind(state),
    env.DB.prepare(`INSERT INTO audit_log (workspace_id,actor_account_id,action,resource_type,resource_id,detail_json) VALUES (?1,?2,'discord.user_link','discord.user',?3,?4)`).bind(row.workspace_id,row.account_id,user.id,JSON.stringify({eve_character_id:row.eve_character_id,discord_username:user.username??null})),
  ]);
  return new Response(`<!doctype html><meta charset="utf-8"><title>New Eden Sage Ã‚Â· Discord Linked</title><style>body{font-family:system-ui;background:#071014;color:#dce8ee;display:grid;place-items:center;height:100vh;margin:0}.c{border:1px solid #385261;background:#0c171d;padding:28px;max-width:520px}h1{color:#9cdb93}</style><div class="c"><h1>Discord linked to New Eden Sage</h1><p>${String(user.global_name??user.username??"Discord user")} is now opted in for Sage Discord alerts on this corporation workspace.</p><p>You can close this window and return to Sage.</p></div>`,{headers:{"Content-Type":"text/html; charset=utf-8"}});
}
async function updateDiscordNotificationTargets(request:Request,env:SageEnv,principal:Principal,workspaceId:string){
  const actorCharacterId=Number(request.headers.get("X-Sage-Character-ID")??0);
  if(!Number.isSafeInteger(actorCharacterId)||actorCharacterId<=0)return error(400,"character_required","Select a corporation character first.");
  const actor=await env.DB.prepare("SELECT 1 AS ok FROM workspace_members WHERE workspace_id=?1 AND account_id=?2 AND eve_character_id=?3 AND membership_state='active' LIMIT 1").bind(workspaceId,principal.accountId,actorCharacterId).first();
  if(!actor)return error(403,"character_not_member","The selected character is not an active member of this corporation workspace.");
  let body:{character_ids?:number[]};try{body=await request.json();}catch{return error(400,"invalid_json","Notification character settings must be valid JSON.");}
  const link=await env.DB.prepare("SELECT discord_user_id FROM discord_user_links WHERE workspace_id=?1 AND account_id=?2 AND dm_enabled=1 ORDER BY updated_at DESC LIMIT 1").bind(workspaceId,principal.accountId).first<{discord_user_id:string}>();
  if(!link?.discord_user_id)return error(409,"discord_user_not_linked","Link your Discord account before choosing notification characters.");
  const requested=[...new Set((Array.isArray(body.character_ids)?body.character_ids:[]).map(Number).filter(value=>Number.isSafeInteger(value)&&value>0))];
  const owned=await env.DB.prepare("SELECT eve_character_id FROM workspace_members WHERE workspace_id=?1 AND account_id=?2 AND membership_state='active'").bind(workspaceId,principal.accountId).all<{eve_character_id:number}>();
  const allowed=new Set(owned.results.map(row=>Number(row.eve_character_id)));
  if(requested.some(id=>!allowed.has(id)))return error(403,"notification_character_not_owned","Discord notification routing can only include your own active characters in this corporation.");
  const statements:D1PreparedStatement[]=[env.DB.prepare("DELETE FROM discord_notification_targets WHERE workspace_id=?1 AND account_id=?2").bind(workspaceId,principal.accountId)];
  for(const characterId of requested)statements.push(env.DB.prepare("INSERT INTO discord_notification_targets (workspace_id,account_id,eve_character_id,discord_user_id,enabled,updated_at) VALUES (?1,?2,?3,?4,1,datetime('now'))").bind(workspaceId,principal.accountId,characterId,link.discord_user_id));
  statements.push(env.DB.prepare("INSERT INTO audit_log (workspace_id,actor_account_id,action,resource_type,detail_json) VALUES (?1,?2,'discord.notifications.update','discord.user',?3)").bind(workspaceId,principal.accountId,JSON.stringify({actor_character_id:actorCharacterId,character_ids:requested})));
  await env.DB.batch(statements);
  return json(await discordIntegrationStatus(env,principal,workspaceId,actorCharacterId));
}

function discordMentionPrefix(roleIds:string[],userIds:string[]){
  const mentions=[...roleIds.map(id=>`<@&${id}>`),...userIds.map(id=>`<@${id}>`)];
  return mentions.length?mentions.join(" "):"@everyone";
}
async function validateDiscordSendTarget(env:SageEnv,workspaceId:string,requestedChannelId:string|undefined,requestedRoleIds:string[],requestedUserIds:string[]=[]){
  const integration=await env.DB.prepare("SELECT guild_id,channel_id,enabled FROM discord_integrations WHERE workspace_id=?1 LIMIT 1").bind(workspaceId).first<{guild_id:string;channel_id:string|null;enabled:number}>();
  if(!integration||integration.enabled!==1||!integration.guild_id)return {error:error(409,"discord_not_ready","Enable corporation Discord routing and install SageBot first.")};
  const channelId=String(requestedChannelId||integration.channel_id||"");
  if(!channelId)return {error:error(409,"discord_channel_required","Choose a default or allowed Discord channel first.")};
  const allowed=await env.DB.prepare("SELECT 1 AS ok FROM discord_allowed_channels WHERE workspace_id=?1 AND channel_id=?2 AND enabled=1 LIMIT 1").bind(workspaceId,channelId).first();
  if(!allowed)return {error:error(403,"discord_channel_not_allowed","Sage Online is not allowed to send to this Discord channel.")};
  const structure=await readDiscordGuildStructure(env,integration.guild_id);
  if(!structure.sendableChannelIds.includes(channelId))return {error:error(409,"discord_channel_wrong_guild","The selected Discord channel is not available in this corporation server.")};
  const roleIds=[...new Set(requestedRoleIds.map(String).filter(Boolean))];
  const validRoles=new Set(structure.roles.map(role=>role.id));
  if(roleIds.some(id=>!validRoles.has(id)))return {error:error(409,"discord_role_unavailable","One or more selected Discord roles no longer exist or cannot be used by SageBot.")};
  const userIds=[...new Set(requestedUserIds.map(String).filter(Boolean))];
  if(userIds.length&&!structure.membersAvailable)return {error:error(409,"discord_members_unavailable","SageBot cannot read this server's member list yet. Enable Discord's Server Members Intent for SageBot, then refresh.")};
  const validUsers=new Set(structure.members.map(member=>member.id));
  if(userIds.some(id=>!validUsers.has(id)))return {error:error(409,"discord_member_unavailable","One or more selected Discord server members are no longer available in this guild.")};
  return {integration,channelId,roleIds,userIds,structure};
}

async function discordAnnounce(request:Request,env:SageEnv,principal:Principal,workspaceId:string){
  const actorCharacterId=Number(request.headers.get("X-Sage-Character-ID")??0);
  if(!Number.isSafeInteger(actorCharacterId)||actorCharacterId<=0||!(await hasPermission(env,workspaceId,principal.accountId,"fleet.manage",actorCharacterId)))return error(403,"permission_denied","Discord announcements require Command Ops authority for the selected character.");
  let body:{content?:string;channel_id?:string;role_ids?:string[];user_ids?:string[]};try{body=await request.json();}catch{return error(400,"invalid_json","Request body must be valid JSON.");}
  const content=String(body.content??"").trim();if(!content)return error(400,"content_required","Enter an announcement message.");
  const target=await validateDiscordSendTarget(env,workspaceId,String(body.channel_id??"")||undefined,Array.isArray(body.role_ids)?body.role_ids.map(String):[],Array.isArray(body.user_ids)?body.user_ids.map(String):[]);
  if(target.error)return target.error;
  const roleIds=target.roleIds??[];
  const userIds=target.userIds??[];
  const prefix=discordMentionPrefix(roleIds,userIds);
  const message=`${prefix}\n${content}`;
  if(message.length>2000)return error(400,"discord_message_too_long","Discord announcements must fit within 2,000 characters including mentions.");
  try{
    const sent=await sendDiscordChannelMessage(env,target.channelId!,message,{mentionEveryone:roleIds.length===0&&userIds.length===0,roleIds,userIds});
    return json({sent:true,messageId:String(sent.id??""),channelId:target.channelId,roleIds,userIds,mentionEveryone:roleIds.length===0&&userIds.length===0});
  }catch(cause){return error(502,"discord_send_failed",cause instanceof Error?cause.message:"Discord announcement failed.");}
}

function operationCancellationDiscordContent(payload:any,cancellationMessage:string){
  const title=String(payload?.title??"Corporation Operation").trim()||"Corporation Operation";
  const message=String(cancellationMessage??"").trim();
  return [`**OPERATION CANCELLED - ${title}**`,message||"Leadership has stood this operation down.","This operation has been removed from active Ops in New Eden Sage."].join("\n\n");
}

function operationDiscordContent(payload:any){
  const title=String(payload?.title??"Corporation Operation").trim()||"Corporation Operation";
  const type=String(payload?.operationType??"Operation").trim()||"Operation";
  const formup=String(payload?.formupSystem??"").trim()||"TBD";
  const startsAt=String(payload?.startsAt??"").trim();
  const startDate=startsAt?new Date(startsAt):null;
  const startLine=startDate&&!Number.isNaN(startDate.getTime())?`<t:${Math.floor(startDate.getTime()/1000)}:F> (<t:${Math.floor(startDate.getTime()/1000)}:R>)`:"TBD";
  const description=String(payload?.description??"").trim();
  const roles=(Array.isArray(payload?.roles)?payload.roles:[]).slice(0,12).map((role:any)=>{
    const label=String(role?.label??"Role").trim()||"Role";
    const hull=String(role?.hullName??"").trim()||"Any suitable hull";
    const count=Math.max(1,Number(role?.count??1)||1);
    return `- **${label}** - ${count} x ${hull}`;
  });
  const lines=[`**NEW CORPORATION OPERATION - ${title}**`,`**Type:** ${type}`,`**Form-up:** ${formup}`,`**Start:** ${startLine}`];
  if(description)lines.push("",description.slice(0,650));
  if(roles.length)lines.push("","**Ships & roles needed**",...roles);
  lines.push("","Open **New Eden Sage > Corporation > Join Ops** to view the full operation, choose the role and ship you want to fly, and submit your request.");
  return lines.join("\n");
}

async function discordAnnounceOperation(request:Request,env:SageEnv,principal:Principal,workspaceId:string,objectId:string){
  const actorCharacterId=Number(request.headers.get("X-Sage-Character-ID")??0);
  if(!Number.isSafeInteger(actorCharacterId)||actorCharacterId<=0||!(await hasPermission(env,workspaceId,principal.accountId,"fleet.manage",actorCharacterId)))return error(403,"permission_denied","Announcing an operation to Discord requires Command Ops authority for the selected character.");
  let body:{object_id?:string};try{body=await request.json();}catch{return error(400,"invalid_json","Request body must be valid JSON.");}
  if(String(body.object_id??"")!==objectId)return error(400,"operation_mismatch","The signed Discord announcement does not match this operation.");
  const row=await env.DB.prepare(`SELECT sov.payload_json FROM shared_objects so JOIN shared_object_versions sov ON sov.object_id=so.id AND sov.version=so.current_version WHERE so.id=?1 AND so.workspace_id=?2 AND so.object_type='sage.operation' AND so.archived_at IS NULL LIMIT 1`).bind(objectId,workspaceId).first<{payload_json:string}>();
  if(!row)return error(404,"operation_not_found","That corporation operation no longer exists.");
  let payload:any;try{payload=JSON.parse(row.payload_json);}catch{return error(500,"operation_payload_invalid","The stored operation payload could not be read.");}
  const requestedRoleIds=Array.isArray(payload?.discordNotifyRoleIds)?payload.discordNotifyRoleIds.map(String).filter(Boolean):[];
  const requestedUserIds=Array.isArray(payload?.discordNotifyUserIds)?payload.discordNotifyUserIds.map(String).filter(Boolean):[];
  const target=await validateDiscordSendTarget(env,workspaceId,undefined,requestedRoleIds,requestedUserIds);
  if(target.error)return target.error;
  const roleIds=target.roleIds??[];
  const userIds=target.userIds??[];
  const content=operationDiscordContent(payload);
  const message=`${discordMentionPrefix(roleIds,userIds)}\n${content}`;
  if(message.length>2000)return error(409,"operation_announcement_too_long","This operation is too detailed for one Discord announcement. Shorten its description or role list.");
  try{
    if(payload?.status==="cancelled")return error(409,"operation_cancelled","Cancelled operations cannot be announced to Discord.");
    const existing=await env.DB.prepare("SELECT channel_id,message_id FROM operation_discord_messages WHERE workspace_id=?1 AND object_id=?2 AND deleted_at IS NULL LIMIT 1").bind(workspaceId,objectId).first<{channel_id:string;message_id:string}>();
    if(existing?.channel_id&&existing?.message_id){
      try{await deleteDiscordChannelMessage(env,existing.channel_id,existing.message_id);}
      catch(cause){return error(502,"discord_previous_message_delete_failed",cause instanceof Error?cause.message:"The previous Discord operation announcement could not be removed.");}
    }
    const sent=await sendDiscordChannelMessage(env,target.channelId!,message,{mentionEveryone:roleIds.length===0&&userIds.length===0,roleIds,userIds});
    const messageId=String(sent.id??"");
    if(!messageId)return error(502,"discord_message_id_missing","Discord accepted the operation announcement but did not return a message ID.");
    try{
      await env.DB.batch([
        env.DB.prepare("INSERT INTO operation_discord_messages (workspace_id,object_id,guild_id,channel_id,message_id,sent_at,updated_at,deleted_at) VALUES (?1,?2,?3,?4,?5,datetime('now'),datetime('now'),NULL) ON CONFLICT(workspace_id,object_id) DO UPDATE SET guild_id=excluded.guild_id,channel_id=excluded.channel_id,message_id=excluded.message_id,sent_at=datetime('now'),updated_at=datetime('now'),deleted_at=NULL").bind(workspaceId,objectId,target.integration!.guild_id,target.channelId,messageId),
        env.DB.prepare("INSERT INTO audit_log (workspace_id,actor_account_id,action,resource_type,resource_id,detail_json) VALUES (?1,?2,'operation.discord_announce','sage.operation',?3,?4)").bind(workspaceId,principal.accountId,objectId,JSON.stringify({character_id:actorCharacterId,channel_id:target.channelId,message_id:messageId,role_ids:roleIds,user_ids:userIds,mention_everyone:roleIds.length===0&&userIds.length===0})),
      ]);
    }catch(dbCause){
      await deleteDiscordChannelMessage(env,target.channelId!,messageId).catch(()=>undefined);
      throw new Error(dbCause instanceof Error?`Sage Online could not track the Discord operation message: ${dbCause.message}`:"Sage Online could not track the Discord operation message.");
    }
    return json({sent:true,messageId,channelId:target.channelId,roleIds,userIds,mentionEveryone:roleIds.length===0&&userIds.length===0});
  }catch(cause){return error(502,"discord_send_failed",cause instanceof Error?cause.message:"Discord operation announcement failed.");}
}

async function cancelCorporationOperation(request:Request,env:SageEnv,principal:Principal,workspaceId:string,objectId:string){
  const actorCharacterId=Number(request.headers.get("X-Sage-Character-ID")??0);
  if(!Number.isSafeInteger(actorCharacterId)||actorCharacterId<=0||!(await hasPermission(env,workspaceId,principal.accountId,"fleet.manage",actorCharacterId)))return error(403,"permission_denied","Cancelling an operation requires Command Ops authority for the selected character.");
  let body:{object_id?:string;cancellation_message?:string};try{body=await request.json();}catch{return error(400,"invalid_json","Request body must be valid JSON.");}
  if(String(body.object_id??"")!==objectId)return error(400,"operation_mismatch","The signed cancellation does not match this operation.");
  const current=await env.DB.prepare(`SELECT so.current_version,sov.payload_json FROM shared_objects so JOIN shared_object_versions sov ON sov.object_id=so.id AND sov.version=so.current_version WHERE so.id=?1 AND so.workspace_id=?2 AND so.object_type='sage.operation' AND so.archived_at IS NULL LIMIT 1`).bind(objectId,workspaceId).first<{current_version:number;payload_json:string}>();
  if(!current)return error(404,"operation_not_found","That corporation operation no longer exists.");
  let payload:any;try{payload=JSON.parse(current.payload_json);}catch{return error(409,"operation_payload_invalid","The stored operation payload could not be read.");}
  if(payload?.status==="cancelled")return error(409,"operation_cancelled","This operation is already cancelled.");
  if(payload?.status==="complete")return error(409,"operation_complete","Completed operations cannot be cancelled.");
  const cancellationMessage=String(body.cancellation_message??"").trim().slice(0,600);
  let discordDeleted=false;let discordCleanupWarning="";let cleanupChannelId="";let cleanupMessageId="";let legacyLookup=false;let discordCancellationSent=false;let discordCancellationMessageId="";let discordCancellationWarning="";
  const tracked=await env.DB.prepare("SELECT channel_id,message_id FROM operation_discord_messages WHERE workspace_id=?1 AND object_id=?2 AND deleted_at IS NULL LIMIT 1").bind(workspaceId,objectId).first<{channel_id:string;message_id:string}>();
  if(tracked?.channel_id&&tracked?.message_id){
    cleanupChannelId=tracked.channel_id;cleanupMessageId=tracked.message_id;
    try{const result=await deleteDiscordChannelMessage(env,tracked.channel_id,tracked.message_id);discordDeleted=result.deleted||result.missing;await env.DB.prepare("UPDATE operation_discord_messages SET deleted_at=datetime('now'),updated_at=datetime('now') WHERE workspace_id=?1 AND object_id=?2").bind(workspaceId,objectId).run();}
    catch(cause){return error(502,"discord_operation_delete_failed",cause instanceof Error?cause.message:"The Discord operation announcement could not be deleted. The operation was not cancelled; try again.");}
  }else{
    const audit=await env.DB.prepare("SELECT detail_json FROM audit_log WHERE workspace_id=?1 AND action='operation.discord_announce' AND resource_id=?2 ORDER BY id DESC LIMIT 1").bind(workspaceId,objectId).first<{detail_json:string|null}>();
    let channelId="";try{channelId=String(JSON.parse(audit?.detail_json??"{}").channel_id??"");}catch{}
    if(channelId){legacyLookup=true;cleanupChannelId=channelId;try{const found=await findDiscordOperationAnnouncement(env,channelId,String(payload?.title??"Corporation Operation"));if(found?.messageId){cleanupMessageId=found.messageId;const result=await deleteDiscordChannelMessage(env,found.channelId,found.messageId);discordDeleted=result.deleted||result.missing;}else discordCleanupWarning="The pre-tracking Discord announcement could not be found in recent SageBot message history.";}catch(cause){discordCleanupWarning=cause instanceof Error?cause.message:"The legacy Discord announcement could not be searched or deleted.";}}
  }
  const identity=await env.DB.prepare("SELECT character_name FROM eve_identities WHERE character_id=?1 AND account_id=?2 LIMIT 1").bind(actorCharacterId,principal.accountId).first<{character_name:string}>();
  const cancelledBy={characterId:actorCharacterId,characterName:identity?.character_name??"Leadership"};
  try{
    const response=await mutateOperationPayload(env,principal,workspaceId,objectId,"operation.cancelled","operation.cancel",(currentPayload:any)=>{
      if(currentPayload?.status==="cancelled")throw new Error("OPERATION_CANCELLED");
      if(currentPayload?.status==="complete")throw new Error("OPERATION_COMPLETE");
      const now=new Date().toISOString();
      const applications=(Array.isArray(currentPayload?.applications)?currentPayload.applications:[]).map((app:any)=>app?.status==="pending"?{...app,status:"denied",message:cancellationMessage||"Operation cancelled.",decidedAt:now,decidedBy:cancelledBy}:app);
      return {...currentPayload,status:"cancelled",cancellationMessage,cancelledAt:now,cancelledBy,applications,updatedAt:now};
    });
    if(!response.ok)return response;
    const data=await response.json() as Record<string,unknown>;
    const requestedRoleIds=Array.isArray(payload?.discordNotifyRoleIds)?payload.discordNotifyRoleIds.map(String).filter(Boolean):[];
    const requestedUserIds=Array.isArray(payload?.discordNotifyUserIds)?payload.discordNotifyUserIds.map(String).filter(Boolean):[];
    if(payload?.discordAnnouncementEnabled!==false){
      try{
        const target=await validateDiscordSendTarget(env,workspaceId,cleanupChannelId||undefined,requestedRoleIds,requestedUserIds);
        if(target.error){const targetBody=await target.error.clone().json().catch(()=>({})) as Record<string,unknown>;discordCancellationWarning=String(targetBody.message??targetBody.error??"Discord cancellation notice could not be routed.");}
        else{
          const roleIds=target.roleIds??[],userIds=target.userIds??[];
          const cancellationContent=operationCancellationDiscordContent(payload,cancellationMessage);
          const cancellationText=`${discordMentionPrefix(roleIds,userIds)}\n${cancellationContent}`;
          const sent=await sendDiscordChannelMessage(env,target.channelId!,cancellationText,{mentionEveryone:roleIds.length===0&&userIds.length===0,roleIds,userIds});
          discordCancellationMessageId=String(sent.id??"");discordCancellationSent=Boolean(discordCancellationMessageId);
          await env.DB.prepare("INSERT INTO audit_log (workspace_id,actor_account_id,action,resource_type,resource_id,detail_json) VALUES (?1,?2,'operation.discord_cancel_notice','sage.operation',?3,?4)").bind(workspaceId,principal.accountId,objectId,JSON.stringify({channel_id:target.channelId,message_id:discordCancellationMessageId||null,role_ids:roleIds,user_ids:userIds,mention_everyone:roleIds.length===0&&userIds.length===0,cancellation_message:cancellationMessage||null})).run();
        }
      }catch(cause){discordCancellationWarning=cause instanceof Error?cause.message:"Discord cancellation notice failed.";}
    }
    await env.DB.prepare("INSERT INTO audit_log (workspace_id,actor_account_id,action,resource_type,resource_id,detail_json) VALUES (?1,?2,'operation.discord_delete','sage.operation',?3,?4)").bind(workspaceId,principal.accountId,objectId,JSON.stringify({channel_id:cleanupChannelId||null,message_id:cleanupMessageId||null,deleted:discordDeleted,legacy_lookup:legacyLookup,warning:discordCleanupWarning||null})).run();
    return json({...data,discordDeleted,discordCleanupWarning,legacyLookup,discordCancellationSent,discordCancellationMessageId,discordCancellationWarning});
  }catch(cause){if(cause instanceof Error&&cause.message==="OPERATION_CANCELLED")return error(409,"operation_cancelled","This operation is already cancelled.");if(cause instanceof Error&&cause.message==="OPERATION_COMPLETE")return error(409,"operation_complete","Completed operations cannot be cancelled.");throw cause;}
}

async function mutateOperationPayload(
  env: SageEnv,
  principal: Principal,
  workspaceId: string,
  objectId: string,
  eventType: string,
  auditAction: string,
  mutate: (payload: any) => Promise<any> | any,
): Promise<Response> {
  const current = await env.DB.prepare(
    `SELECT so.id, so.object_type, so.current_version, sov.payload_json
       FROM shared_objects so
       JOIN shared_object_versions sov ON sov.object_id = so.id AND sov.version = so.current_version
      WHERE so.id = ?1 AND so.workspace_id = ?2 AND so.archived_at IS NULL`,
  ).bind(objectId, workspaceId).first<{ id:string; object_type:string; current_version:number; payload_json:string }>();
  if (!current || current.object_type !== "sage.operation") return error(404, "operation_not_found", "Corporation operation not found.");
  let payload: any;
  try { payload = JSON.parse(current.payload_json); }
  catch { return error(409, "operation_payload_invalid", "The operation payload is invalid."); }
  const nextPayload = await mutate(payload);
  const payloadJson = JSON.stringify(nextPayload);
  if (new TextEncoder().encode(payloadJson).byteLength > MAX_PAYLOAD_BYTES) return error(413, "payload_too_large", "Operation payload exceeds 512 KiB.");
  const nextVersion = current.current_version + 1;
  await env.DB.batch([
    env.DB.prepare(`UPDATE shared_objects SET current_version = ?1, updated_by_account_id = ?2, updated_at = datetime('now') WHERE id = ?3 AND workspace_id = ?4 AND current_version = ?5`).bind(nextVersion, principal.accountId, objectId, workspaceId, current.current_version),
    env.DB.prepare(`INSERT INTO shared_object_versions (object_id, version, payload_json, published_by_account_id) VALUES (?1, ?2, ?3, ?4)`).bind(objectId, nextVersion, payloadJson, principal.accountId),
    env.DB.prepare(`INSERT INTO events_outbox (workspace_id, event_type, object_id, object_version) VALUES (?1, ?2, ?3, ?4)`).bind(workspaceId, eventType, objectId, nextVersion),
    env.DB.prepare(`INSERT INTO audit_log (workspace_id, actor_account_id, action, resource_type, resource_id, detail_json) VALUES (?1, ?2, ?3, 'sage.operation', ?4, ?5)`).bind(workspaceId, principal.accountId, auditAction, objectId, JSON.stringify({ version: nextVersion })),
  ]);
  const eventRow = await env.DB.prepare(`SELECT sequence FROM events_outbox WHERE workspace_id = ?1 AND object_id = ?2 AND object_version = ?3 ORDER BY sequence DESC LIMIT 1`).bind(workspaceId, objectId, nextVersion).first<{ sequence:number }>();
  if (eventRow) { const event = await readEvent(env, eventRow.sequence); if (event) await enqueueEvent(env, event).catch(() => undefined); }
  return json({ id: objectId, object_type: "sage.operation", version: nextVersion, payload: nextPayload });
}

async function operationLeadershipIdentity(env:SageEnv,workspaceId:string,principal:Principal,characterId:number){
  if(!Number.isSafeInteger(characterId)||characterId<=0||!(await hasPermission(env,workspaceId,principal.accountId,"fleet.manage",characterId)))return null;
  const identity=await env.DB.prepare("SELECT character_name FROM eve_identities WHERE character_id=?1 AND account_id=?2 LIMIT 1").bind(characterId,principal.accountId).first<{character_name:string}>();
  return {characterId,characterName:identity?.character_name??`Character ${characterId}`};
}

async function takeOperationOwnership(request:Request,env:SageEnv,principal:Principal,workspaceId:string,objectId:string){
  const characterId=Number(request.headers.get("X-Sage-Character-ID")??0);
  const actor=await operationLeadershipIdentity(env,workspaceId,principal,characterId);
  if(!actor)return error(403,"permission_denied","Taking operation ownership requires Command Ops authority for the selected character.");
  try{return await mutateOperationPayload(env,principal,workspaceId,objectId,"operation.owner_changed","operation.owner.take",(payload:any)=>{
    if(payload?.status==="cancelled"||payload?.status==="complete")throw new Error("OPERATION_CLOSED");
    return {...payload,operationOwner:actor,updatedAt:new Date().toISOString()};
  });}catch(cause){if(cause instanceof Error&&cause.message==="OPERATION_CLOSED")return error(409,"operation_closed","Closed operations cannot change owner.");throw cause;}
}

async function setOperationApplicationNotifications(request:Request,env:SageEnv,principal:Principal,workspaceId:string,objectId:string){
  const characterId=Number(request.headers.get("X-Sage-Character-ID")??0);
  const actor=await operationLeadershipIdentity(env,workspaceId,principal,characterId);
  if(!actor)return error(403,"permission_denied","Operation notification subscriptions require Command Ops authority for the selected character.");
  let body:{enabled?:boolean};try{body=await request.json();}catch{return error(400,"invalid_json","Operation notification settings must be valid JSON.");}
  const enabled=body.enabled===true;
  if(enabled){
    const target=await env.DB.prepare("SELECT 1 AS ok FROM discord_notification_targets WHERE workspace_id=?1 AND account_id=?2 AND eve_character_id=?3 AND enabled=1 LIMIT 1").bind(workspaceId,principal.accountId,characterId).first();
    if(!target)return error(409,"discord_notifications_not_enabled","Enable Discord alerts for this character in Discord Setup before subscribing to operation requests.");
  }
  try{return await mutateOperationPayload(env,principal,workspaceId,objectId,"operation.notification_subscription_changed","operation.notifications.self",(payload:any)=>{
    if(payload?.status==="cancelled"||payload?.status==="complete")throw new Error("OPERATION_CLOSED");
    const current=[...new Set((Array.isArray(payload?.notificationLeaderCharacterIds)?payload.notificationLeaderCharacterIds:[]).map(Number).filter((id:number)=>Number.isSafeInteger(id)&&id>0))];
    const next=enabled?[...new Set([...current,characterId])]:current.filter(id=>id!==characterId);
    return {...payload,notificationLeaderCharacterIds:next.slice(0,25),updatedAt:new Date().toISOString()};
  });}catch(cause){if(cause instanceof Error&&cause.message==="OPERATION_CLOSED")return error(409,"operation_closed","Closed operations cannot change notification subscriptions.");throw cause;}
}

async function notifyOperationLeadersOfApplication(env:SageEnv,workspaceId:string,payload:any,applicantName:string,roleId:string,hullName:string,automaticApproval:boolean){
  const ids:number[]=[...new Set<number>((Array.isArray(payload?.notificationLeaderCharacterIds)?payload.notificationLeaderCharacterIds:[]).map((value:any)=>Number(value)).filter((id:number)=>Number.isSafeInteger(id)&&id>0))].slice(0,25);
  if(!ids.length)return {requested:0,sent:0};
  const role=(Array.isArray(payload?.roles)?payload.roles:[]).find((item:any)=>String(item?.id)===roleId);
  const title=String(payload?.title??"Corporation Operation").trim()||"Corporation Operation";
  const roleLabel=String(role?.label??"a role").trim()||"a role";
  const hull=String(hullName??"").trim();
  const content=[`**New operation role request - ${title}**`,`${applicantName} submitted for **${roleLabel}**${hull?` flying **${hull}**`:""}.`,automaticApproval?"This request was auto-approved by the operation settings.":"Open New Eden Sage > Corporation Management > Op Planner > Command Ops to review it."].join("\n");
  let sent=0;const deliveredDiscordUsers=new Set<string>();
  for(const characterId of ids){
    const membership=await env.DB.prepare("SELECT account_id FROM workspace_members WHERE workspace_id=?1 AND eve_character_id=?2 AND membership_state='active' LIMIT 1").bind(workspaceId,characterId).first<{account_id:string}>();
    if(!membership?.account_id||!(await hasPermission(env,workspaceId,membership.account_id,"fleet.manage",characterId)))continue;
    const target=await env.DB.prepare("SELECT discord_user_id FROM discord_notification_targets WHERE workspace_id=?1 AND account_id=?2 AND eve_character_id=?3 AND enabled=1 LIMIT 1").bind(workspaceId,membership.account_id,characterId).first<{discord_user_id:string}>();
    if(!target?.discord_user_id||deliveredDiscordUsers.has(target.discord_user_id))continue;
    try{const result=await sendDiscordDmToCharacter(env,workspaceId,characterId,content);if(result.sent){sent++;deliveredDiscordUsers.add(target.discord_user_id);}}catch{}
  }
  return {requested:ids.length,sent};
}

async function applyForOperationRole(request: Request, env: SageEnv, principal: Principal, workspaceId: string, objectId: string): Promise<Response> {
  let body: { character_id?:number; role_id?:string; fit_name?:string; fit_text?:string; hull_name?:string };
  try { body = await request.json(); } catch { return error(400, "invalid_json", "Request body must be valid JSON."); }
  const requestedCharacterId = Number(body.character_id ?? 0);
  const membership = requestedCharacterId > 0
    ? await env.DB.prepare(`SELECT wm.workspace_id, wm.account_id, wm.eve_character_id, ei.roles_json, ei.titles_json FROM workspace_members wm LEFT JOIN eve_identities ei ON ei.character_id = wm.eve_character_id WHERE wm.workspace_id = ?1 AND wm.account_id = ?2 AND wm.eve_character_id = ?3 AND wm.membership_state = 'active' LIMIT 1`).bind(workspaceId, principal.accountId, requestedCharacterId).first<{workspace_id:string;account_id:string;eve_character_id:number;roles_json:string|null;titles_json:string|null}>()
    : await getActiveMembership(env, workspaceId, principal.accountId);
  if (!membership?.eve_character_id) return error(403, "member_character_required", "The selected character is not an active verified member of this corporation workspace.");
  const identity = await env.DB.prepare("SELECT character_name FROM eve_identities WHERE character_id = ?1 AND account_id = ?2 LIMIT 1").bind(membership.eve_character_id, principal.accountId).first<{ character_name:string }>();
  const roleId = String(body.role_id ?? "").trim();
  if (!roleId) return error(400, "role_required", "Choose an operation role.");
  try {
    const response=await mutateOperationPayload(env, principal, workspaceId, objectId, "operation.application_submitted", "operation.apply", (payload:any) => {
      if (payload?.status === "cancelled") throw new Error("OPERATION_CANCELLED");
      const roles = Array.isArray(payload?.roles) ? payload.roles : [];
      if (!roles.some((role:any) => String(role?.id) === roleId)) throw new Error("ROLE_NOT_FOUND");
      if (payload?.approvalRequired !== false && payload?.fitCheckEnabled && !String(body.fit_text ?? "").trim()) throw new Error("FIT_REQUIRED");
      const existingApplication=(Array.isArray(payload?.applications)?payload.applications:[]).find((app:any)=>Number(app?.characterId)===Number(membership.eve_character_id));
      if(existingApplication&&(existingApplication.status==="pending"||existingApplication.status==="approved"))throw new Error("APPLICATION_ACTIVE");
      const applications = (Array.isArray(payload?.applications) ? payload.applications : []).filter((app:any) => Number(app?.characterId) !== Number(membership.eve_character_id));
      const submittedAt = new Date().toISOString();
      const automaticApproval = payload?.approvalRequired === false;
      applications.push({ id: crypto.randomUUID(), characterId: Number(membership.eve_character_id), characterName: identity?.character_name ?? `Character ${membership.eve_character_id}`, roleId, fitName: String(body.fit_name ?? "").trim(), fitText: String(body.fit_text ?? "").trim(), hullName: String(body.hull_name ?? "").trim(), status: automaticApproval ? "approved" : "pending", submittedAt, ...(automaticApproval ? { autoApproved: true, decidedAt: submittedAt } : {}) });
      return { ...payload, applications, updatedAt: new Date().toISOString() };
    });
    if(!response.ok)return response;
    const data=await response.clone().json().catch(()=>null) as {payload?:any}|null;
    if(data?.payload){
      const applicantName=identity?.character_name??`Character ${membership.eve_character_id}`;
      const automaticApproval=data.payload?.approvalRequired===false;
      const delivery=await notifyOperationLeadersOfApplication(env,workspaceId,data.payload,applicantName,roleId,String(body.hull_name??""),automaticApproval);
      await env.DB.prepare("INSERT INTO audit_log (workspace_id,actor_account_id,action,resource_type,resource_id,detail_json) VALUES (?1,?2,'operation.application_notify','sage.operation',?3,?4)").bind(workspaceId,principal.accountId,objectId,JSON.stringify({applicant_character_id:Number(membership.eve_character_id),notification_leaders_requested:delivery.requested,notifications_sent:delivery.sent})).run().catch(()=>undefined);
    }
    return response;
  } catch (cause) {
    if (cause instanceof Error && cause.message === "OPERATION_CANCELLED") return error(409, "operation_cancelled", "This corporation operation has been cancelled and is no longer accepting role requests.");
    if (cause instanceof Error && cause.message === "APPLICATION_ACTIVE") return error(409, "operation_application_active", "You already have a pending or approved role on this operation.");
    if (cause instanceof Error && cause.message === "ROLE_NOT_FOUND") return error(404, "role_not_found", "That role is no longer available.");
    if (cause instanceof Error && cause.message === "FIT_REQUIRED") return error(400, "fit_required", "Leadership enabled fit checking; submit an EFT fit with the role request.");
    throw cause;
  }
}

async function decideOperationApplication(request: Request, env: SageEnv, principal: Principal, workspaceId: string, objectId: string, applicationId: string): Promise<Response> {
  const actorCharacterId = Number(request.headers.get("X-Sage-Character-ID") ?? 0);
  if (!Number.isSafeInteger(actorCharacterId) || actorCharacterId <= 0) return error(400, "character_required", "Select the EVE character issuing this operation approval.");
  if (!(await hasPermission(env, workspaceId, principal.accountId, "fleet.approve", actorCharacterId))) return error(403, "permission_denied", "Operation approval permission is required for the selected character.");
  let body: { decision?:string; message?:string };
  try { body = await request.json(); } catch { return error(400, "invalid_json", "Request body must be valid JSON."); }
  const decision = body.decision === "approved" ? "approved" : body.decision === "denied" ? "denied" : "";
  if (!decision) return error(400, "decision_required", "Decision must be approved or denied.");
  const membership = await getActiveMembership(env, workspaceId, principal.accountId, actorCharacterId);
  const identity = membership?.eve_character_id ? await env.DB.prepare("SELECT character_name FROM eve_identities WHERE character_id = ?1 LIMIT 1").bind(membership.eve_character_id).first<{ character_name:string }>() : null;
  try {
    return await mutateOperationPayload(env, principal, workspaceId, objectId, "operation.application_decided", "operation.application_decide", (payload:any) => {
      if (payload?.status === "cancelled") throw new Error("OPERATION_CANCELLED");
      let found = false;
      const applications = (Array.isArray(payload?.applications) ? payload.applications : []).map((app:any) => {
        if (String(app?.id) !== applicationId) return app;
        found = true;
        return { ...app, status: decision, message: String(body.message ?? "").trim(), decidedAt: new Date().toISOString(), decidedBy: { characterId: Number(membership?.eve_character_id ?? 0), characterName: identity?.character_name ?? "Leadership" } };
      });
      if (!found) throw new Error("APPLICATION_NOT_FOUND");
      return { ...payload, applications, updatedAt: new Date().toISOString() };
    });
  } catch (cause) {
    if (cause instanceof Error && cause.message === "OPERATION_CANCELLED") return error(409, "operation_cancelled", "This corporation operation has been cancelled; applications can no longer be changed.");
    if (cause instanceof Error && cause.message === "APPLICATION_NOT_FOUND") return error(404, "application_not_found", "That operation application no longer exists.");
    throw cause;
  }
}
async function handleWorkspaceApi(request: Request, env: SageEnv, url: URL): Promise<Response | null> {
  const match = url.pathname.match(/^\/v1\/workspaces\/([^/]+)(?:\/(.*))?$/);
  if (!match) return null;

  const workspaceId = decodeURIComponent(match[1]);
  const tail = match[2] ?? "";
  const principal = await requireSession(request, env);
  if (principal instanceof Response) return principal;

  if (!(await getActiveMembership(env, workspaceId, principal.accountId))) {
    return error(403, "workspace_access_denied", "Active verified workspace membership is required.");
  }

  if (tail === "permissions" && request.method === "GET") return json(await corporationPermissionState(env, principal, workspaceId, Number(url.searchParams.get("character_id") ?? 0) || undefined));
  const permissionPolicyMatch = tail.match(/^permissions\/(.+)$/);
  if (permissionPolicyMatch && request.method === "PUT") return updateCorporationPermissionPolicy(request, env, principal, workspaceId, decodeURIComponent(permissionPolicyMatch[1]));

  if (tail === "discord" && request.method === "GET") return json(await discordIntegrationStatus(env, principal, workspaceId, Number(url.searchParams.get("character_id") ?? 0)));
  if (tail === "discord/server-structure" && request.method === "GET") return discordServerStructure(env, principal, workspaceId, Number(url.searchParams.get("character_id") ?? 0));
  if (tail === "discord/action-ticket" && request.method === "POST") return issueDiscordActionTicket(request, env, principal, workspaceId);
  if (tail === "discord" && request.method === "PUT") {
    const guard=await consumeDiscordActionTicket(request,env,principal,workspaceId,"discord.configure");
    if(guard)return guard;
    return configureDiscordIntegration(request, env, principal, workspaceId);
  }
  if (tail === "discord/link-url" && request.method === "GET") return discordLinkUrl(env, principal, workspaceId, url);
  if (tail === "discord/announce" && request.method === "POST") {
    const guard=await consumeDiscordActionTicket(request,env,principal,workspaceId,"discord.announce");
    if(guard)return guard;
    return discordAnnounce(request, env, principal, workspaceId);
  }
  if (tail === "discord/notification-targets" && request.method === "PUT") {
    const guard=await consumeDiscordActionTicket(request,env,principal,workspaceId,"discord.notifications");
    if(guard)return guard;
    return updateDiscordNotificationTargets(request,env,principal,workspaceId);
  }
  const operationDiscordAnnounceMatch=tail.match(/^operations\/([^/]+)\/announce$/);
  if(operationDiscordAnnounceMatch&&request.method==="POST"){
    const guard=await consumeDiscordActionTicket(request,env,principal,workspaceId,"discord.operation_announce");
    if(guard)return guard;
    return discordAnnounceOperation(request,env,principal,workspaceId,decodeURIComponent(operationDiscordAnnounceMatch[1]));
  }
  const operationCancelMatch=tail.match(/^operations\/([^/]+)\/cancel$/);
  if(operationCancelMatch&&request.method==="POST"){
    const guard=await consumeDiscordActionTicket(request,env,principal,workspaceId,"discord.operation_cancel");
    if(guard)return guard;
    return cancelCorporationOperation(request,env,principal,workspaceId,decodeURIComponent(operationCancelMatch[1]));
  }
  if (tail === "discord/test-dm" && request.method === "POST") {
    const guard=await consumeDiscordActionTicket(request,env,principal,workspaceId,"discord.test_dm");
    if(guard)return guard;
    let body:{character_id?:number}; try { body=await request.json(); } catch { return error(400,"invalid_json","Request body must be valid JSON."); }
    const characterId=Number(body.character_id??0);
    const actorCharacterId=Number(request.headers.get("X-Sage-Character-ID")??0);
    if(characterId!==actorCharacterId)return error(403,"discord_character_mismatch","Test DM must use the currently selected Sage character.");
    const member=await env.DB.prepare(`SELECT 1 AS ok FROM workspace_members WHERE workspace_id=?1 AND account_id=?2 AND eve_character_id=?3 AND membership_state='active' LIMIT 1`).bind(workspaceId,principal.accountId,characterId).first();
    if(!member)return error(403,"character_not_member","You can only test Discord DMs for your own linked corporation character.");
    try { const result=await sendDiscordDmToCharacter(env,workspaceId,characterId,"New Eden Sage Discord test successful. Future opted-in corporation alerts can be delivered here."); return result.sent?json(result):error(409,"discord_user_not_linked","Link this character's Discord account first."); }
    catch(cause){return error(502,"discord_dm_failed",cause instanceof Error?cause.message:"Discord DM failed.");}
  }
  if (tail === "discord/dm" && request.method === "POST") {
    const guard=await consumeDiscordActionTicket(request,env,principal,workspaceId,"discord.dm");
    if(guard)return guard;
    const actorCharacterId=Number(request.headers.get("X-Sage-Character-ID")??0);
    if(!Number.isSafeInteger(actorCharacterId)||actorCharacterId<=0||!(await hasPermission(env,workspaceId,principal.accountId,"fleet.manage",actorCharacterId)))return error(403,"permission_denied","Sending corporation Discord alerts requires Command Ops authority for the selected character.");
    let body:{character_id?:number;content?:string};try{body=await request.json();}catch{return error(400,"invalid_json","Request body must be valid JSON.");}
    const characterId=Number(body.character_id??0),content=String(body.content??"").trim();if(!characterId||!content)return error(400,"discord_dm_input_required","Character and message are required.");
    const member=await env.DB.prepare(`SELECT 1 AS ok FROM workspace_members WHERE workspace_id=?1 AND eve_character_id=?2 AND membership_state='active' LIMIT 1`).bind(workspaceId,characterId).first();
    if(!member)return error(403,"discord_dm_target_not_member","Discord alerts can only target active members of this corporation workspace.");
    try{const result=await sendDiscordDmToCharacter(env,workspaceId,characterId,content);return result.sent?json(result):error(409,"discord_user_not_linked","That character has not opted in to Discord DMs.");}catch(cause){return error(502,"discord_dm_failed",cause instanceof Error?cause.message:"Discord DM failed.");}
  }
  if (tail === "discord/link" && request.method === "DELETE") {
    const guard=await consumeDiscordActionTicket(request,env,principal,workspaceId,"discord.unlink");
    if(guard)return guard;
    const characterId=Number(url.searchParams.get("character_id")??0);
    const actorCharacterId=Number(request.headers.get("X-Sage-Character-ID")??0);
    if(characterId!==actorCharacterId)return error(403,"discord_character_mismatch","Discord unlink must use the currently selected Sage character.");
    await env.DB.batch([env.DB.prepare("DELETE FROM discord_user_links WHERE workspace_id=?1 AND account_id=?2").bind(workspaceId,principal.accountId),env.DB.prepare("DELETE FROM discord_notification_targets WHERE workspace_id=?1 AND account_id=?2").bind(workspaceId,principal.accountId)]);return json({unlinked:true});
  }
  if (tail === "events" && request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
    const stub = env.WORKSPACE_HUB.get(env.WORKSPACE_HUB.idFromName(workspaceId));
    const headers = new Headers(request.headers);
    headers.set("X-Sage-Workspace-ID", workspaceId);
    headers.set("X-Sage-Account-ID", principal.accountId);
    return stub.fetch(new Request("https://workspace.internal/connect", { method: "GET", headers }));
  }

  if (tail === "event-log" && request.method === "GET") {
    const after = Math.max(0, Number.parseInt(url.searchParams.get("after") ?? "0", 10) || 0);
    const rows = await env.DB.prepare(
      `SELECT sequence, workspace_id, event_type, object_id, object_version, created_at
         FROM events_outbox
        WHERE workspace_id = ?1 AND sequence > ?2
        ORDER BY sequence ASC LIMIT 250`,
    ).bind(workspaceId, after).all<EventEnvelope>();
    return json({ events: rows.results });
  }

  if (tail === "audit-log" && request.method === "GET") {
    const resourceType = url.searchParams.get("resource_type");
    const rows = resourceType
      ? await env.DB.prepare(`SELECT id, actor_account_id, action, resource_type, resource_id, detail_json, created_at FROM audit_log WHERE workspace_id = ?1 AND resource_type = ?2 ORDER BY id DESC LIMIT 250`).bind(workspaceId, resourceType).all<Record<string, unknown>>()
      : await env.DB.prepare(`SELECT id, actor_account_id, action, resource_type, resource_id, detail_json, created_at FROM audit_log WHERE workspace_id = ?1 ORDER BY id DESC LIMIT 250`).bind(workspaceId).all<Record<string, unknown>>();
    return json({ audit: rows.results.map((row:any)=>({ ...row, detail: row.detail_json ? (()=>{ try{return JSON.parse(String(row.detail_json));}catch{return null;} })() : null, detail_json:undefined })) });
  }

  const operationOwnershipMatch = tail.match(/^operations\/([^/]+)\/ownership$/);
  if (operationOwnershipMatch && request.method === "POST") return takeOperationOwnership(request,env,principal,workspaceId,decodeURIComponent(operationOwnershipMatch[1]));
  const operationNotificationsMatch = tail.match(/^operations\/([^/]+)\/application-notifications$/);
  if (operationNotificationsMatch && request.method === "PUT") {
    const guard=await consumeDiscordActionTicket(request,env,principal,workspaceId,"discord.operation_notifications");
    if(guard)return guard;
    return setOperationApplicationNotifications(request,env,principal,workspaceId,decodeURIComponent(operationNotificationsMatch[1]));
  }
  const operationApplyMatch = tail.match(/^operations\/([^/]+)\/apply$/);
  if (operationApplyMatch && request.method === "POST") return applyForOperationRole(request, env, principal, workspaceId, decodeURIComponent(operationApplyMatch[1]));

  const operationDecisionMatch = tail.match(/^operations\/([^/]+)\/applications\/([^/]+)\/decision$/);
  if (operationDecisionMatch && request.method === "POST") return decideOperationApplication(request, env, principal, workspaceId, decodeURIComponent(operationDecisionMatch[1]), decodeURIComponent(operationDecisionMatch[2]));
  if (tail === "objects" && request.method === "POST") {
    return publishNewObject(request, env, principal, workspaceId);
  }

  if (tail === "objects" && request.method === "GET") {
    const objectType = url.searchParams.get("type");
    const query = objectType
      ? env.DB.prepare(
          `SELECT so.id, so.object_type, so.current_version, so.visibility, so.created_at, so.updated_at, so.published_at
             FROM shared_objects so
            WHERE so.workspace_id = ?1 AND so.object_type = ?2 AND so.archived_at IS NULL
              AND (so.visibility = 'workspace' OR so.created_by_account_id = ?3 OR EXISTS (SELECT 1 FROM shared_object_acl acl WHERE acl.object_id = so.id AND acl.account_id = ?3))
            ORDER BY so.updated_at DESC LIMIT 500`
        ).bind(workspaceId, objectType, principal.accountId)
      : env.DB.prepare(
          `SELECT so.id, so.object_type, so.current_version, so.visibility, so.created_at, so.updated_at, so.published_at
             FROM shared_objects so
            WHERE so.workspace_id = ?1 AND so.archived_at IS NULL
              AND (so.visibility = 'workspace' OR so.created_by_account_id = ?2 OR EXISTS (SELECT 1 FROM shared_object_acl acl WHERE acl.object_id = so.id AND acl.account_id = ?2))
            ORDER BY so.updated_at DESC LIMIT 500`
        ).bind(workspaceId, principal.accountId);
    const rows = await query.all();
    return json({ objects: rows.results });
  }

  const objectMatch = tail.match(/^objects\/([^/]+)$/);
  if (objectMatch && request.method === "GET") {
    const objectId = decodeURIComponent(objectMatch[1]);
    const row = await env.DB.prepare(
      `SELECT so.id, so.object_type, so.current_version, so.visibility, so.created_at, so.updated_at,
              sov.payload_json, sov.published_by_account_id, sov.published_at
         FROM shared_objects so
         JOIN shared_object_versions sov ON sov.object_id = so.id AND sov.version = so.current_version
        WHERE so.workspace_id = ?1 AND so.id = ?2 AND so.archived_at IS NULL
          AND (so.visibility = 'workspace' OR so.created_by_account_id = ?3 OR EXISTS (SELECT 1 FROM shared_object_acl acl WHERE acl.object_id = so.id AND acl.account_id = ?3))`,
    ).bind(workspaceId, objectId, principal.accountId).first<Record<string, unknown> & { payload_json: string }>();
    if (!row) return error(404, "not_found", "Shared object not found.");
    const { payload_json, ...metadata } = row;
    return json({ ...metadata, payload: JSON.parse(payload_json) });
  }

  if (objectMatch && request.method === "PUT") {
    return updateObject(request, env, principal, workspaceId, decodeURIComponent(objectMatch[1]));
  }

  if (objectMatch && request.method === "DELETE") {
    return archiveObject(env, principal, workspaceId, decodeURIComponent(objectMatch[1]));
  }

  return error(404, "not_found", "Workspace endpoint not found.");
}

async function dispatchQueuedEvent(env: SageEnv, event: EventEnvelope): Promise<void> {
  const stub = env.WORKSPACE_HUB.get(env.WORKSPACE_HUB.idFromName(event.workspace_id));
  const response = await stub.fetch("https://workspace.internal/broadcast", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(event),
  });
  if (!response.ok) throw new Error(`Workspace broadcast failed: ${response.status}`);
  await env.DB.prepare("UPDATE events_outbox SET dispatched_at = datetime('now') WHERE sequence = ?1")
    .bind(event.sequence).run();
}

async function recoverOutbox(env: SageEnv): Promise<void> {
  const pending = await env.DB.prepare(
    `SELECT sequence, workspace_id, event_type, object_id, object_version, created_at
       FROM events_outbox
      WHERE dispatched_at IS NULL AND queued_at IS NULL
      ORDER BY sequence ASC LIMIT 100`,
  ).all<EventEnvelope>();

  for (const event of pending.results) {
    try {
      await enqueueEvent(env, event);
    } catch {
      // Leave queued_at NULL so the next scheduled pass can retry.
    }
  }
}

export default {
  async fetch(request: Request, env: SageEnv): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "Authorization, Content-Type, Idempotency-Key, X-EVE-Access-Token, X-Sage-Device-ID, X-Sage-Request-Time, X-Sage-Nonce, X-Sage-Signature, X-Sage-Action-Ticket, X-Sage-Character-ID",
          "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    if (url.pathname === "/health" && request.method === "GET") {
      try {
        await env.DB.prepare("SELECT 1 AS ok").first();
        return json({
          service: "new-eden-sage-online",
          version: env.APP_VERSION,
          status: "ok",
          database: "ok",
          realtime: "configured",
          queue: "configured",
        });
      } catch {
        return json({ service: "new-eden-sage-online", status: "degraded", database: "error" }, 503);
      }
    }

    if (url.pathname === "/v1/auth/status" && request.method === "GET") {
      return json({
        eve_sso_configured: Boolean(env.EVE_CLIENT_ID),
        strategy: "desktop_pkce_verified_jwt_assertion",
        identity_anchor: "first_verified_eve_character_id",
        account_id_format: "eve_character_id",
        refresh_tokens_cloud_stored: false,
      });
    }

    if (url.pathname === "/v1/discord/oauth/callback" && request.method === "GET") {
      return discordOauthCallback(request, env, url);
    }
    if (url.pathname === "/v1/discord/device/register" && request.method === "POST") {
      const principal = await requireSession(request, env);
      if (principal instanceof Response) return principal;
      return registerDiscordDevice(request, env, principal);
    }
    if (url.pathname === "/v1/identity/claim" && request.method === "POST") {
      return claimPrimaryIdentity(request, env);
    }

    if (url.pathname === "/v1/identity/link" && request.method === "POST") {
      return linkCharacterIdentity(request, env);
    }

    if (url.pathname === "/v1/identity" && request.method === "GET") {
      return getSageIdentity(request, env);
    }

    if (url.pathname === "/v1/workspaces/corporation/ensure" && request.method === "POST") {
      const principal = await requireSession(request, env);
      if (principal instanceof Response) return principal;
      return ensureCorporationWorkspace(request, env, principal);
    }

    const workspaceResponse = await handleWorkspaceApi(request, env, url);
    if (workspaceResponse) return workspaceResponse;

    return error(404, "not_found", "Sage Online endpoint not found.");
  },

  async queue(batch: MessageBatch<EventEnvelope>, env: SageEnv): Promise<void> {
    for (const message of batch.messages) {
      await dispatchQueuedEvent(env, message.body);
    }
  },

  async scheduled(_controller: ScheduledController, env: SageEnv): Promise<void> {
    await recoverOutbox(env);
    await env.DB.prepare("DELETE FROM discord_oauth_states WHERE expires_at <= datetime('now')").run().catch(() => undefined);
    await cleanupDiscordSecurity(env);
  },
} satisfies ExportedHandler<SageEnv, EventEnvelope>;
