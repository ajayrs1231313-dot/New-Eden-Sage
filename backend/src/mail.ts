import { verifyEveAccessToken } from "./identity";
import type { Principal, SageEnv } from "./types";

const FREE_MAIL_LIMIT = 50;
const MAX_SUBJECT_LENGTH = 160;
const MAX_BODY_LENGTH = 20_000;
const MAX_CONTACT_PAGES = 20;

type MailKind = "normal" | "doctrine" | "production" | "system";
type MailFolder = "inbox" | "sent";

type IdentityRow = {
  character_id: number;
  account_id: string;
  character_name: string;
  corporation_id: number | null;
  alliance_id: number | null;
};

type VerifiedActor = {
  identity: IdentityRow;
  eve: {
    characterId: number;
    characterName: string;
    corporationId: number | null;
    allianceId: number | null;
    scopes: string[];
  };
  accessToken: string;
};

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

function error(status: number, code: string, message: string, extra?: Record<string, unknown>): Response {
  return json({ error: code, message, ...(extra ?? {}) }, status);
}

function integerCharacterId(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

function requestedCharacterId(request: Request, url: URL) {
  return integerCharacterId(request.headers.get("X-Sage-Character-ID") ?? url.searchParams.get("character_id"));
}

async function readJson(request: Request): Promise<Record<string, any> | Response> {
  try {
    const body = await request.json() as Record<string, any>;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return error(400, "mail_invalid_json", "Mail request body must be a JSON object.");
    }
    return body;
  } catch {
    return error(400, "mail_invalid_json", "Mail request body must be valid JSON.");
  }
}

async function ownedIdentity(env: SageEnv, principal: Principal, characterId: number): Promise<IdentityRow | null> {
  if (!characterId) return null;
  return env.DB.prepare(
    `SELECT e.character_id, e.account_id, e.character_name, e.corporation_id, e.alliance_id
       FROM eve_identities e
       JOIN accounts a ON a.id = e.account_id
      WHERE e.character_id = ?1
        AND e.account_id = ?2
        AND a.status = 'active'
      LIMIT 1`,
  ).bind(characterId, principal.accountId).first<IdentityRow>();
}

async function verifiedActor(request: Request, env: SageEnv, principal: Principal, expectedCharacterId: number): Promise<VerifiedActor | Response> {
  const accessToken = request.headers.get("X-EVE-Access-Token") ?? "";
  if (!accessToken) return error(401, "mail_missing_eve_token", "A current EVE access token is required for this mail action.");

  let eve: VerifiedActor["eve"];
  try {
    eve = await verifyEveAccessToken(accessToken, env);
  } catch (cause) {
    return error(401, "mail_invalid_eve_identity", cause instanceof Error ? cause.message : "EVE identity verification failed.");
  }

  if (expectedCharacterId && eve.characterId !== expectedCharacterId) {
    return error(403, "mail_character_mismatch", "The selected Sage character does not match the verified EVE character.");
  }

  const identity = await ownedIdentity(env, principal, eve.characterId);
  if (!identity) return error(403, "mail_character_not_linked", "This EVE character is not linked to the active Sage account.");

  // Refresh public affiliation/name every time a privileged mail action verifies the actor.
  await env.DB.prepare(
    `UPDATE eve_identities
        SET character_name = ?1,
            corporation_id = ?2,
            alliance_id = ?3,
            last_verified_at = datetime('now'),
            updated_at = datetime('now')
      WHERE character_id = ?4 AND account_id = ?5`,
  ).bind(eve.characterName, eve.corporationId, eve.allianceId, eve.characterId, principal.accountId).run();

  return {
    identity: { ...identity, character_name: eve.characterName, corporation_id: eve.corporationId, alliance_id: eve.allianceId },
    eve,
    accessToken,
  };
}

async function eveFriendContactIds(env: SageEnv, actor: VerifiedActor): Promise<{ ids: Set<number>; available: boolean; detail?: string }> {
  const ids = new Set<number>();
  let page = 1;
  let pages = 1;

  try {
    do {
      const response = await fetch(
        `https://esi.evetech.net/characters/${actor.eve.characterId}/contacts/?page=${page}`,
        {
          headers: {
            Authorization: `Bearer ${actor.accessToken}`,
            "X-Compatibility-Date": env.ESI_COMPATIBILITY_DATE,
            "X-User-Agent": "NewEdenSage-Online/0.1.0",
          },
        },
      );
      if (!response.ok) {
        const detail = response.status === 403
          ? "EVE contact scope is unavailable for this character."
          : `EVE contacts returned HTTP ${response.status}.`;
        return { ids, available: false, detail };
      }
      const rows = await response.json() as Array<{
        contact_id?: number;
        contact_type?: string;
        standing?: number;
        is_blocked?: boolean;
      }>;
      for (const row of Array.isArray(rows) ? rows : []) {
        const id = integerCharacterId(row?.contact_id);
        if (!id || row?.contact_type !== "character" || row?.is_blocked === true) continue;
        // EVE contacts are unilateral. Treat neutral-or-better character contacts as the
        // Sage "friends" list and never turn negative/enemy standings into mail contacts.
        if (Number(row?.standing ?? 0) < 0) continue;
        ids.add(id);
      }
      pages = Math.max(1, Math.min(MAX_CONTACT_PAGES, Number(response.headers.get("X-Pages") ?? 1) || 1));
      page += 1;
    } while (page <= pages);
    return { ids, available: true };
  } catch (cause) {
    return { ids, available: false, detail: cause instanceof Error ? cause.message : "EVE contacts could not be loaded." };
  }
}

async function linkedIdentityByCharacter(env: SageEnv, characterId: number): Promise<IdentityRow | null> {
  return env.DB.prepare(
    `SELECT e.character_id, e.account_id, e.character_name, e.corporation_id, e.alliance_id
       FROM eve_identities e
       JOIN accounts a ON a.id = e.account_id
      WHERE e.character_id = ?1 AND a.status = 'active'
      LIMIT 1`,
  ).bind(characterId).first<IdentityRow>();
}

async function refreshPublicAffiliation(env: SageEnv, identity: IdentityRow): Promise<IdentityRow> {
  try {
    const response = await fetch(`https://esi.evetech.net/characters/${identity.character_id}/`, {
      headers: {
        "X-Compatibility-Date": env.ESI_COMPATIBILITY_DATE,
        "X-User-Agent": "NewEdenSage-Online/0.1.0",
      },
    });
    if (!response.ok) return identity;
    const row = await response.json() as { name?: string; corporation_id?: number; alliance_id?: number };
    const next: IdentityRow = {
      ...identity,
      character_name: String(row.name ?? identity.character_name),
      corporation_id: Number(row.corporation_id ?? 0) || null,
      alliance_id: Number(row.alliance_id ?? 0) || null,
    };
    if (
      next.character_name !== identity.character_name
      || next.corporation_id !== identity.corporation_id
      || next.alliance_id !== identity.alliance_id
    ) {
      await env.DB.prepare(
        `UPDATE eve_identities
            SET character_name = ?1,
                corporation_id = ?2,
                alliance_id = ?3,
                updated_at = datetime('now')
          WHERE character_id = ?4`,
      ).bind(next.character_name, next.corporation_id, next.alliance_id, next.character_id).run();
    }
    return next;
  } catch {
    return identity;
  }
}

async function relationshipToRecipient(env: SageEnv, actor: VerifiedActor, recipient: IdentityRow, friendIds?: Set<number>) {
  const relationships: Array<"account" | "corporation" | "contact"> = [];
  if (recipient.account_id === actor.identity.account_id) relationships.push("account");
  if (actor.eve.corporationId && recipient.corporation_id === actor.eve.corporationId) relationships.push("corporation");
  if (friendIds?.has(recipient.character_id)) relationships.push("contact");
  return relationships;
}

async function mailboxLimit(env: SageEnv, characterId: number) {
  const row = await env.DB.prepare(
    "SELECT quota_limit FROM sage_mail_quotas WHERE character_id = ?1 LIMIT 1",
  ).bind(characterId).first<{ quota_limit: number }>();
  return row ? Number(row.quota_limit) : FREE_MAIL_LIMIT;
}

async function mailboxUsage(env: SageEnv, characterId: number) {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS used,
            SUM(CASE WHEN folder = 'inbox' AND read_at IS NULL THEN 1 ELSE 0 END) AS unread
       FROM sage_mailbox_entries
      WHERE owner_character_id = ?1 AND deleted_at IS NULL`,
  ).bind(characterId).first<{ used: number; unread: number | null }>();
  return { used: Number(row?.used ?? 0), unread: Number(row?.unread ?? 0) };
}

async function quotaSnapshot(env: SageEnv, characterId: number) {
  const [limit, usage] = await Promise.all([mailboxLimit(env, characterId), mailboxUsage(env, characterId)]);
  const unlimited = limit === -1;
  return {
    used: usage.used,
    unread: usage.unread,
    limit: unlimited ? null : limit,
    remaining: unlimited ? null : Math.max(0, limit - usage.used),
    premium: unlimited,
    full: !unlimited && usage.used >= limit,
  };
}

function safeSubject(value: unknown) {
  return String(value ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, MAX_SUBJECT_LENGTH);
}

function safeBody(value: unknown) {
  return String(value ?? "").replace(/\u0000/g, "").trim().slice(0, MAX_BODY_LENGTH);
}

function parseMetadata(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function serializeMailboxRow(row: any) {
  let metadata: Record<string, unknown> = {};
  try { metadata = JSON.parse(String(row.metadata_json ?? "{}")); } catch { metadata = {}; }
  return {
    entryId: Number(row.entry_id),
    messageId: String(row.message_id),
    folder: String(row.folder) as MailFolder,
    kind: String(row.kind) as MailKind,
    senderCharacterId: row.sender_character_id == null ? null : Number(row.sender_character_id),
    senderCharacterName: String(row.sender_character_name ?? "New Eden Sage"),
    recipientCharacterId: Number(row.recipient_character_id),
    recipientCharacterName: String(row.recipient_character_name ?? ""),
    subject: String(row.subject ?? ""),
    body: String(row.body ?? ""),
    metadata,
    createdAt: String(row.created_at),
    readAt: row.read_at ? String(row.read_at) : null,
  };
}

async function directory(request: Request, env: SageEnv, url: URL, principal: Principal) {
  const characterId = requestedCharacterId(request, url);
  if (!characterId) return error(400, "mail_character_required", "Select a character before opening Sage Mail.");
  const actor = await verifiedActor(request, env, principal, characterId);
  if (actor instanceof Response) return actor;

  const friends = await eveFriendContactIds(env, actor);
  const rows = await env.DB.prepare(
    `SELECT e.character_id, e.account_id, e.character_name, e.corporation_id, e.alliance_id
       FROM eve_identities e
       JOIN accounts a ON a.id = e.account_id
      WHERE a.status = 'active'
        AND e.character_id <> ?1
        AND (e.account_id = ?2 OR (?3 IS NOT NULL AND e.corporation_id = ?3))
      ORDER BY e.character_name COLLATE NOCASE ASC`,
  ).bind(actor.eve.characterId, principal.accountId, actor.eve.corporationId).all<IdentityRow>();

  const byId = new Map<number, IdentityRow>((rows.results ?? []).map((row) => [Number(row.character_id), row]));
  const friendIds = [...friends.ids];
  for (let i = 0; i < friendIds.length; i += 75) {
    const chunk = friendIds.slice(i, i + 75);
    if (!chunk.length) continue;
    const placeholders = chunk.map((_, index) => `?${index + 1}`).join(",");
    const statement = env.DB.prepare(
      `SELECT e.character_id, e.account_id, e.character_name, e.corporation_id, e.alliance_id
         FROM eve_identities e
         JOIN accounts a ON a.id = e.account_id
        WHERE a.status = 'active' AND e.character_id IN (${placeholders})`,
    ).bind(...chunk);
    const found = await statement.all<IdentityRow>();
    for (const row of found.results ?? []) if (Number(row.character_id) !== actor.eve.characterId) byId.set(Number(row.character_id), row);
  }

  const refreshedRows = await Promise.all([...byId.values()].map((row) => refreshPublicAffiliation(env, row)));
  const contacts = (await Promise.all(refreshedRows.map(async (row) => ({
    characterId: Number(row.character_id),
    characterName: String(row.character_name),
    corporationId: row.corporation_id == null ? null : Number(row.corporation_id),
    allianceId: row.alliance_id == null ? null : Number(row.alliance_id),
    relationships: await relationshipToRecipient(env, actor, row, friends.ids),
  })))).filter((contact) => contact.relationships.length > 0);
  contacts.sort((a, b) =>
    Number(b.relationships.includes("corporation")) - Number(a.relationships.includes("corporation"))
    || a.characterName.localeCompare(b.characterName));

  return json({
    characterId: actor.eve.characterId,
    characterName: actor.eve.characterName,
    contacts,
    contactsSource: {
      corporationId: actor.eve.corporationId,
      eveContactsAvailable: friends.available,
      warning: friends.available ? null : friends.detail ?? "EVE contacts unavailable.",
    },
  });
}

async function mailbox(request: Request, env: SageEnv, url: URL, principal: Principal) {
  const characterId = requestedCharacterId(request, url);
  const identity = await ownedIdentity(env, principal, characterId);
  if (!identity) return error(403, "mail_character_not_linked", "This mailbox does not belong to the active Sage account.");

  const folder = url.searchParams.get("folder") === "sent" ? "sent" : "inbox";
  const limit = Math.max(1, Math.min(50, Math.trunc(Number(url.searchParams.get("limit") ?? 50) || 50)));
  const rows = await env.DB.prepare(
    `SELECT e.id AS entry_id, e.folder, e.read_at,
            m.id AS message_id, m.kind, m.sender_character_id, m.sender_character_name,
            m.recipient_character_id, m.recipient_character_name, m.subject, m.body,
            m.metadata_json, m.created_at
       FROM sage_mailbox_entries e
       JOIN sage_mail_messages m ON m.id = e.message_id
      WHERE e.owner_account_id = ?1
        AND e.owner_character_id = ?2
        AND e.folder = ?3
        AND e.deleted_at IS NULL
      ORDER BY m.created_at DESC, e.id DESC
      LIMIT ?4`,
  ).bind(principal.accountId, characterId, folder, limit).all();

  const quota = await quotaSnapshot(env, characterId);
  return json({
    characterId,
    characterName: identity.character_name,
    folder,
    messages: (rows.results ?? []).map(serializeMailboxRow),
    unread: quota.unread,
    quota: {
      used: quota.used,
      limit: quota.limit,
      remaining: quota.remaining,
      premium: quota.premium,
      full: quota.full,
    },
  });
}

async function ensureCapacity(env: SageEnv, characterId: number, requiredSlots: number) {
  const quota = await quotaSnapshot(env, characterId);
  return quota.premium || Number(quota.remaining ?? 0) >= requiredSlots ? null : quota;
}

async function sendNormal(request: Request, env: SageEnv, principal: Principal) {
  const body = await readJson(request);
  if (body instanceof Response) return body;
  const senderCharacterId = integerCharacterId(body.sender_character_id ?? request.headers.get("X-Sage-Character-ID"));
  const recipientCharacterId = integerCharacterId(body.recipient_character_id);
  if (!senderCharacterId || !recipientCharacterId) return error(400, "mail_recipient_required", "Sender and recipient characters are required.");

  const actor = await verifiedActor(request, env, principal, senderCharacterId);
  if (actor instanceof Response) return actor;
  const linkedRecipient = await linkedIdentityByCharacter(env, recipientCharacterId);
  if (!linkedRecipient) return error(404, "mail_recipient_not_on_sage", "That character is not currently linked to a Sage account.");
  const recipient = await refreshPublicAffiliation(env, linkedRecipient);

  const friends = await eveFriendContactIds(env, actor);
  const relationships = await relationshipToRecipient(env, actor, recipient, friends.ids);
  if (!relationships.length) {
    return error(403, "mail_not_a_contact", "Sage Mail can only be sent to your linked characters, corporation members, or neutral-or-better EVE character contacts.");
  }

  const subject = safeSubject(body.subject);
  const messageBody = safeBody(body.body);
  if (!subject) return error(400, "mail_subject_required", "Enter a subject.");
  if (!messageBody) return error(400, "mail_body_required", "Enter a message.");
  if (String(body.subject ?? "").length > MAX_SUBJECT_LENGTH) return error(400, "mail_subject_too_long", `Subjects are limited to ${MAX_SUBJECT_LENGTH} characters.`);
  if (String(body.body ?? "").length > MAX_BODY_LENGTH) return error(400, "mail_body_too_long", `Messages are limited to ${MAX_BODY_LENGTH.toLocaleString()} characters.`);

  const senderSlots = senderCharacterId === recipientCharacterId ? 2 : 1;
  const senderFull = await ensureCapacity(env, senderCharacterId, senderSlots);
  if (senderFull) return error(409, "mailbox_full", "Your selected character's Sage mailbox is full. Delete mail before sending.", { quota: senderFull });
  if (senderCharacterId !== recipientCharacterId) {
    const recipientFull = await ensureCapacity(env, recipientCharacterId, 1);
    if (recipientFull) return error(409, "recipient_mailbox_full", `${recipient.character_name}'s Sage mailbox is full.`);
  }

  const messageId = `mail_${crypto.randomUUID()}`;
  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO sage_mail_messages
          (id, sender_account_id, sender_character_id, sender_character_name, recipient_character_id, recipient_character_name, kind, subject, body, metadata_json)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'normal', ?7, ?8, '{}')`,
      ).bind(messageId, principal.accountId, actor.eve.characterId, actor.eve.characterName, recipient.character_id, recipient.character_name, subject, messageBody),
      env.DB.prepare(
        `INSERT INTO sage_mailbox_entries (message_id, owner_account_id, owner_character_id, folder, read_at)
         VALUES (?1, ?2, ?3, 'sent', datetime('now'))`,
      ).bind(messageId, principal.accountId, actor.eve.characterId),
      env.DB.prepare(
        `INSERT INTO sage_mailbox_entries (message_id, owner_account_id, owner_character_id, folder)
         VALUES (?1, ?2, ?3, 'inbox')`,
      ).bind(messageId, recipient.account_id, recipient.character_id),
    ]);
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    if (detail.includes("SAGE_MAILBOX_QUOTA_EXCEEDED")) return error(409, "mailbox_full", "A Sage mailbox reached its 50-mail limit while sending.");
    throw cause;
  }

  return json({
    sent: true,
    messageId,
    senderCharacterId: actor.eve.characterId,
    recipientCharacterId: recipient.character_id,
    relationships,
    senderQuota: await quotaSnapshot(env, actor.eve.characterId),
  }, 201);
}

async function insertSystemInbox(
  env: SageEnv,
  recipient: IdentityRow,
  input: {
    kind: Exclude<MailKind, "normal">;
    senderAccountId?: string | null;
    senderCharacterId?: number | null;
    senderCharacterName: string;
    subject: string;
    body: string;
    metadata?: Record<string, unknown>;
    dedupKey: string;
  },
) {
  const existing = await env.DB.prepare(
    `SELECT id FROM sage_mailbox_entries
      WHERE owner_character_id = ?1 AND dedup_key = ?2 LIMIT 1`,
  ).bind(recipient.character_id, input.dedupKey).first<{ id: number }>();
  if (existing) return { delivered: false, duplicate: true, full: false };

  const full = await ensureCapacity(env, recipient.character_id, 1);
  if (full) return { delivered: false, duplicate: false, full: true };

  const messageId = `mail_${crypto.randomUUID()}`;
  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO sage_mail_messages
          (id, sender_account_id, sender_character_id, sender_character_name, recipient_character_id, recipient_character_name, kind, subject, body, metadata_json)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
      ).bind(
        messageId,
        input.senderAccountId ?? null,
        input.senderCharacterId ?? null,
        input.senderCharacterName,
        recipient.character_id,
        recipient.character_name,
        input.kind,
        input.subject,
        input.body,
        JSON.stringify(input.metadata ?? {}),
      ),
      env.DB.prepare(
        `INSERT INTO sage_mailbox_entries
          (message_id, owner_account_id, owner_character_id, folder, dedup_key)
         VALUES (?1, ?2, ?3, 'inbox', ?4)`,
      ).bind(messageId, recipient.account_id, recipient.character_id, input.dedupKey),
    ]);
    return { delivered: true, duplicate: false, full: false, messageId };
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    if (detail.includes("UNIQUE") || detail.includes("SAGE_MAILBOX_QUOTA_EXCEEDED")) {
      const duplicate = detail.includes("UNIQUE");
      return { delivered: false, duplicate, full: !duplicate };
    }
    throw cause;
  }
}

async function sendSelfSystem(request: Request, env: SageEnv, principal: Principal) {
  const body = await readJson(request);
  if (body instanceof Response) return body;
  const characterId = integerCharacterId(body.character_id ?? request.headers.get("X-Sage-Character-ID"));
  const actor = await verifiedActor(request, env, principal, characterId);
  if (actor instanceof Response) return actor;

  const kind = body.kind === "production" ? "production" : "system";
  const subject = safeSubject(body.subject);
  const messageBody = safeBody(body.body);
  const dedupKey = String(body.dedup_key ?? "").trim().slice(0, 300);
  if (!subject || !messageBody || !dedupKey) return error(400, "mail_system_invalid", "System mail requires a subject, body, and deduplication key.");

  const result = await insertSystemInbox(env, actor.identity, {
    kind,
    senderCharacterName: "New Eden Sage",
    subject,
    body: messageBody,
    metadata: parseMetadata(body.metadata),
    dedupKey,
  });
  if (result.full) return error(409, "mailbox_full", "This character's Sage mailbox is full.");
  return json({ ...result, characterId, quota: await quotaSnapshot(env, characterId) }, result.delivered ? 201 : 200);
}

async function sendCorporationSystem(request: Request, env: SageEnv, principal: Principal) {
  const body = await readJson(request);
  if (body instanceof Response) return body;
  const characterId = integerCharacterId(body.character_id ?? request.headers.get("X-Sage-Character-ID"));
  const actor = await verifiedActor(request, env, principal, characterId);
  if (actor instanceof Response) return actor;
  if (!actor.eve.corporationId) return error(409, "mail_no_corporation", "The selected character is not currently in a corporation.");

  const subject = safeSubject(body.subject);
  const messageBody = safeBody(body.body);
  const baseDedupKey = String(body.dedup_key ?? "").trim().slice(0, 240);
  if (!subject || !messageBody || !baseDedupKey) return error(400, "mail_system_invalid", "Doctrine mail requires a subject, body, and deduplication key.");

  const recipients = await env.DB.prepare(
    `SELECT e.character_id, e.account_id, e.character_name, e.corporation_id, e.alliance_id
       FROM eve_identities e
       JOIN accounts a ON a.id = e.account_id
      WHERE a.status = 'active'
        AND e.corporation_id = ?1
        AND e.character_id <> ?2
      ORDER BY e.character_name COLLATE NOCASE ASC`,
  ).bind(actor.eve.corporationId, actor.eve.characterId).all<IdentityRow>();

  let delivered = 0;
  let duplicates = 0;
  let skippedFull = 0;
  let skippedNoLongerMember = 0;
  for (const storedRecipient of recipients.results ?? []) {
    const recipient = await refreshPublicAffiliation(env, storedRecipient);
    if (recipient.corporation_id !== actor.eve.corporationId) {
      skippedNoLongerMember += 1;
      continue;
    }
    const result = await insertSystemInbox(env, recipient, {
      kind: "doctrine",
      senderAccountId: principal.accountId,
      senderCharacterId: actor.eve.characterId,
      senderCharacterName: actor.eve.characterName,
      subject,
      body: messageBody,
      metadata: { ...parseMetadata(body.metadata), corporationId: actor.eve.corporationId },
      dedupKey: `${baseDedupKey}:${recipient.character_id}`,
    });
    if (result.delivered) delivered += 1;
    else if (result.duplicate) duplicates += 1;
    else if (result.full) skippedFull += 1;
  }

  return json({
    sent: true,
    corporationId: actor.eve.corporationId,
    eligibleRecipients: Number(recipients.results?.length ?? 0),
    delivered,
    duplicates,
    skippedFull,
    skippedNoLongerMember,
  });
}

async function markRead(request: Request, env: SageEnv, url: URL, principal: Principal, entryId: number) {
  const characterId = requestedCharacterId(request, url);
  const identity = await ownedIdentity(env, principal, characterId);
  if (!identity) return error(403, "mail_character_not_linked", "This mailbox does not belong to the active Sage account.");
  const result = await env.DB.prepare(
    `UPDATE sage_mailbox_entries
        SET read_at = COALESCE(read_at, datetime('now'))
      WHERE id = ?1 AND owner_account_id = ?2 AND owner_character_id = ?3 AND deleted_at IS NULL`,
  ).bind(entryId, principal.accountId, characterId).run();
  if (!Number(result.meta.changes ?? 0)) return error(404, "mail_not_found", "Mail entry not found.");
  return json({ read: true, entryId, quota: await quotaSnapshot(env, characterId) });
}

async function deleteEntry(request: Request, env: SageEnv, url: URL, principal: Principal, entryId: number) {
  const characterId = requestedCharacterId(request, url);
  const identity = await ownedIdentity(env, principal, characterId);
  if (!identity) return error(403, "mail_character_not_linked", "This mailbox does not belong to the active Sage account.");
  const result = await env.DB.prepare(
    `UPDATE sage_mailbox_entries
        SET deleted_at = datetime('now')
      WHERE id = ?1 AND owner_account_id = ?2 AND owner_character_id = ?3 AND deleted_at IS NULL`,
  ).bind(entryId, principal.accountId, characterId).run();
  if (!Number(result.meta.changes ?? 0)) return error(404, "mail_not_found", "Mail entry not found.");
  return json({ deleted: true, entryId, quota: await quotaSnapshot(env, characterId) });
}

export async function handleMailApi(
  request: Request,
  env: SageEnv,
  url: URL,
  principal: Principal,
): Promise<Response | null> {
  if (!url.pathname.startsWith("/v1/mail")) return null;

  if (url.pathname === "/v1/mail/directory" && request.method === "GET") return directory(request, env, url, principal);
  if (url.pathname === "/v1/mail/mailbox" && request.method === "GET") return mailbox(request, env, url, principal);
  if (url.pathname === "/v1/mail/send" && request.method === "POST") return sendNormal(request, env, principal);
  if (url.pathname === "/v1/mail/system/self" && request.method === "POST") return sendSelfSystem(request, env, principal);
  if (url.pathname === "/v1/mail/system/corporation" && request.method === "POST") return sendCorporationSystem(request, env, principal);

  const readMatch = url.pathname.match(/^\/v1\/mail\/entries\/(\d+)\/read$/);
  if (readMatch && request.method === "POST") return markRead(request, env, url, principal, Number(readMatch[1]));

  const deleteMatch = url.pathname.match(/^\/v1\/mail\/entries\/(\d+)$/);
  if (deleteMatch && request.method === "DELETE") return deleteEntry(request, env, url, principal, Number(deleteMatch[1]));

  return error(404, "mail_endpoint_not_found", "Sage Mail endpoint not found.");
}
