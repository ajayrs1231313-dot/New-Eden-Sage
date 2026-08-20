import { WorkspaceHub } from "./realtime/workspace-hub";
import { claimPrimaryIdentity, getSageIdentity, linkCharacterIdentity, verifyEveAccessToken } from "./identity";
import type { EventEnvelope, Principal, SageEnv } from "./types";

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

async function getActiveMembership(env: SageEnv, workspaceId: string, accountId: string) {
  return env.DB.prepare(
    `SELECT wm.workspace_id, wm.account_id, wm.eve_character_id, ei.roles_json, ei.titles_json
       FROM workspace_members wm
       LEFT JOIN eve_identities ei ON ei.character_id = wm.eve_character_id
      WHERE wm.workspace_id = ?1
        AND wm.account_id = ?2
        AND wm.membership_state = 'active'
      ORDER BY wm.last_verified_at DESC
      LIMIT 1`,
  ).bind(workspaceId, accountId).first<{
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

async function hasPermission(env: SageEnv, workspaceId: string, accountId: string, permission: string): Promise<boolean> {
  const membership = await getActiveMembership(env, workspaceId, accountId);
  if (!membership) return false;

  if (permission === "shared_object.read" || permission === "events.read") return true;

  const roles = new Set(parseStringArray(membership.roles_json));
  const titles = new Set(parseStringArray(membership.titles_json));
  if (roles.has("Director")) return true;

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
  if (objectType === "sage.route") return "route.publish";
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
  try {
    const response = await fetch(`https://esi.evetech.net/corporations/${identity.corporationId}/`, { headers: { "X-Compatibility-Date": env.ESI_COMPATIBILITY_DATE, "X-User-Agent": "NewEdenSage-Online/0.1.0" } });
    if (response.ok) corporationName = String(((await response.json()) as { name?: string }).name ?? corporationName);
  } catch { /* Public corporation name is cosmetic. */ }

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
    env.DB.prepare(`INSERT INTO workspaces (id, type, eve_corporation_id, eve_alliance_id, name, updated_at) VALUES (?1, 'corporation', ?2, ?3, ?4, datetime('now')) ON CONFLICT(id) DO UPDATE SET eve_alliance_id = excluded.eve_alliance_id, name = excluded.name, updated_at = datetime('now'), archived_at = NULL`).bind(workspaceId, identity.corporationId, identity.allianceId, corporationName),
    env.DB.prepare(`UPDATE eve_identities SET corporation_id = ?1, alliance_id = ?2, roles_json = ?3, titles_json = ?4, last_verified_at = datetime('now'), updated_at = datetime('now') WHERE character_id = ?5 AND account_id = ?6`).bind(identity.corporationId, identity.allianceId, JSON.stringify([...roles]), JSON.stringify([...titles]), identity.characterId, principal.accountId),
    env.DB.prepare(`INSERT INTO workspace_members (workspace_id, account_id, eve_character_id, membership_state, last_verified_at) VALUES (?1, ?2, ?3, 'active', datetime('now')) ON CONFLICT(workspace_id, account_id, eve_character_id) DO UPDATE SET membership_state = 'active', last_verified_at = datetime('now')`).bind(workspaceId, principal.accountId, identity.characterId),
    env.DB.prepare(`INSERT OR IGNORE INTO workspace_permission_rules (id, workspace_id, permission, authority_type, authority_value) VALUES (?1, ?2, 'route.publish', 'eve_role', 'Director')`).bind(`perm_${workspaceId}_route_director`, workspaceId),
  ];
  if (isNew) statements.push(env.DB.prepare(`INSERT OR IGNORE INTO workspace_permission_rules (id, workspace_id, permission, authority_type, authority_value) VALUES (?1, ?2, 'route.publish', 'account', ?3)`).bind(`perm_${workspaceId}_route_bootstrap`, workspaceId, principal.accountId));
  await env.DB.batch(statements);
  const canPublishRoutes = await hasPermission(env, workspaceId, principal.accountId, "route.publish");
  return json({ workspace_id: workspaceId, workspace_type: "corporation", corporation_id: identity.corporationId, corporation_name: corporationName, character_id: identity.characterId, character_name: identity.characterName, can_publish_routes: canPublishRoutes, roles: [...roles], titles: [...titles], member_access: "active" }, isNew ? 201 : 200);
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
  if (visibility === "restricted" && !recipientAccounts.length) return error(400, "empty_restricted_acl", "Restricted route sharing needs at least one active workspace recipient character.");

  const payloadJson = JSON.stringify(body.payload ?? null);
  if (new TextEncoder().encode(payloadJson).byteLength > MAX_PAYLOAD_BYTES) {
    return error(413, "payload_too_large", "Shared object payload exceeds 512 KiB.");
  }

  if (!(await hasPermission(env, workspaceId, principal.accountId, publishPermissionFor(objectType)))) {
    return error(403, "permission_denied", "Your verified corporation authority does not allow this publish action.");
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
  const eventType = objectType === "sage.doctrine" ? "doctrine.published" : "shared_object.published";

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

  if (!(await hasPermission(env, workspaceId, principal.accountId, publishPermissionFor(current.object_type)))) {
    return error(403, "permission_denied", "Your verified corporation authority does not allow this update action.");
  }

  if (body.expected_version !== undefined && body.expected_version !== current.current_version) {
    return json({ error: "version_conflict", current_version: current.current_version }, 409);
  }

  const payloadJson = JSON.stringify(body.payload ?? null);
  if (new TextEncoder().encode(payloadJson).byteLength > MAX_PAYLOAD_BYTES) {
    return error(413, "payload_too_large", "Shared object payload exceeds 512 KiB.");
  }

  const nextVersion = current.current_version + 1;
  const eventType = current.object_type === "sage.doctrine" ? "doctrine.updated" : "shared_object.updated";

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
    ).bind(workspaceId, principal.accountId, current.object_type, objectId, JSON.stringify({ version: nextVersion })),
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
          "Access-Control-Allow-Headers": "Authorization, Content-Type, Idempotency-Key, X-EVE-Access-Token",
          "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
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
  },
} satisfies ExportedHandler<SageEnv, EventEnvelope>;
