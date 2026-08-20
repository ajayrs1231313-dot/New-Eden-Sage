import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Principal, SageEnv } from "./types";

const EVE_METADATA_URL = "https://login.eveonline.com/.well-known/oauth-authorization-server";
const SESSION_DAYS = 180;
const PACKET_SCHEMA = "new-eden-sage.packet.v1";

type PacketReceipt = { packetId: string };

async function requireReadablePacket(request: Request, expectedMessageType: string): Promise<PacketReceipt | Response> {
  const contentType = request.headers.get("Content-Type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return error(415, "packet_content_type", "Sage Online packets must use application/json.");
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return error(400, "invalid_packet_json", "Sage Online packet body must be readable JSON.");
  }

  if (body.schema !== PACKET_SCHEMA) {
    return error(400, "packet_schema", "Expected packet schema " + PACKET_SCHEMA + ".");
  }
  if (body.message_type !== expectedMessageType) {
    return error(400, "packet_message_type", "Expected message_type " + expectedMessageType + ".");
  }
  if (typeof body.packet_id !== "string" || !body.packet_id.trim()) {
    return error(400, "packet_id", "Sage Online packet_id is required.");
  }
  if (typeof body.sent_at !== "string" || Number.isNaN(Date.parse(body.sent_at))) {
    return error(400, "packet_sent_at", "Sage Online sent_at must be an ISO timestamp.");
  }
  const client = body.client as Record<string, unknown> | undefined;
  if (!client || client.application !== "New Eden Sage" || client.transport !== "https-json") {
    return error(400, "packet_client", "Sage Online packet client metadata is invalid.");
  }
  if (!body.payload || typeof body.payload !== "object" || Array.isArray(body.payload)) {
    return error(400, "packet_payload", "Sage Online packet payload must be a named JSON object.");
  }

  return { packetId: body.packet_id };
}

type EveIdentity = {
  characterId: number;
  characterName: string;
  corporationId: number | null;
  allianceId: number | null;
  scopes: string[];
};

let jwksPromise: Promise<ReturnType<typeof createRemoteJWKSet>> | null = null;
let issuerPromise: Promise<string[]> | null = null;

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

function error(status: number, code: string, message: string): Response {
  return json({ error: code, message }, status);
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function eveVerificationConfig() {
  if (!jwksPromise || !issuerPromise) {
    const metadataPromise = fetch(EVE_METADATA_URL).then(async (response) => {
      if (!response.ok) throw new Error(`EVE SSO metadata unavailable (${response.status}).`);
      return response.json() as Promise<{ issuer?: string; jwks_uri?: string }>;
    });
    jwksPromise = metadataPromise.then((metadata) => {
      if (!metadata.jwks_uri) throw new Error("EVE SSO metadata did not provide jwks_uri.");
      return createRemoteJWKSet(new URL(metadata.jwks_uri));
    });
    issuerPromise = metadataPromise.then((metadata) => {
      const values = new Set<string>([
        "https://login.eveonline.com/",
        "login.eveonline.com",
      ]);
      if (metadata.issuer) values.add(metadata.issuer);
      return [...values];
    });
  }
  return { jwks: await jwksPromise, issuers: await issuerPromise };
}

export async function verifyEveAccessToken(token: string, env: SageEnv): Promise<EveIdentity> {
  if (!env.EVE_CLIENT_ID) throw new Error("Sage Online EVE client ID is not configured.");
  const { jwks, issuers } = await eveVerificationConfig();
  const { payload } = await jwtVerify(token, jwks, {
    issuer: issuers,
    audience: env.EVE_CLIENT_ID,
  });

  const audiences = Array.isArray(payload.aud) ? payload.aud : payload.aud ? [payload.aud] : [];
  if (!audiences.includes(env.EVE_CLIENT_ID) || !audiences.includes("EVE Online")) {
    throw new Error("EVE token audience did not match New Eden Sage.");
  }

  const sub = typeof payload.sub === "string" ? payload.sub : "";
  const match = sub.match(/^CHARACTER:EVE:(\d+)$/);
  if (!match) throw new Error("EVE token did not contain a valid character subject.");
  const characterId = Number(match[1]);
  if (!Number.isSafeInteger(characterId)) throw new Error("EVE character ID was invalid.");
  const characterName = typeof payload.name === "string" ? payload.name : `Character ${characterId}`;
  const scopes = Array.isArray(payload.scp) ? payload.scp.filter((value): value is string => typeof value === "string") : [];

  let corporationId: number | null = null;
  let allianceId: number | null = null;
  try {
    const response = await fetch(`https://esi.evetech.net/characters/${characterId}/`, {
      headers: {
        "X-Compatibility-Date": env.ESI_COMPATIBILITY_DATE,
        "X-User-Agent": "NewEdenSage-Online/0.1.0",
      },
    });
    if (response.ok) {
      const character = await response.json() as { corporation_id?: number; alliance_id?: number };
      corporationId = character.corporation_id ?? null;
      allianceId = character.alliance_id ?? null;
    }
  } catch {
    // Identity proof comes from the verified SSO JWT. Public corporation metadata can refresh later.
  }

  return { characterId, characterName, corporationId, allianceId, scopes };
}

async function issueSession(env: SageEnv, accountId: string) {
  const token = randomToken();
  const tokenHash = await sha256Hex(token);
  const id = `ses_${crypto.randomUUID()}`;
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  const databaseExpiresAt = expiresAt.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "");
  await env.DB.prepare(
    `INSERT INTO sessions (id, account_id, token_hash, expires_at, last_seen_at)
     VALUES (?1, ?2, ?3, ?4, datetime('now'))`,
  ).bind(id, accountId, tokenHash, databaseExpiresAt).run();
  return { token, expiresAt: expiresAt.toISOString() };
}

async function requireSageSession(request: Request, env: SageEnv): Promise<Principal | Response> {
  const authorization = request.headers.get("Authorization") ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) return error(401, "missing_session", "A Sage Online session is required.");
  const tokenHash = await sha256Hex(match[1]);
  const row = await env.DB.prepare(
    `SELECT id, account_id FROM sessions
      WHERE token_hash = ?1 AND revoked_at IS NULL AND expires_at > datetime('now')
      LIMIT 1`,
  ).bind(tokenHash).first<{ id: string; account_id: string }>();
  if (!row) return error(401, "invalid_session", "The Sage Online session is invalid or expired.");
  return { accountId: row.account_id, sessionId: row.id };
}

async function upsertEveIdentity(env: SageEnv, accountId: string, identity: EveIdentity, primary: boolean) {
  const existing = await env.DB.prepare(
    "SELECT account_id, is_primary FROM eve_identities WHERE character_id = ?1 LIMIT 1",
  ).bind(identity.characterId).first<{ account_id: string; is_primary: number }>();
  if (existing && existing.account_id !== accountId) {
    throw new Error("This EVE character is already linked to another Sage account.");
  }

  if (primary) {
    await env.DB.prepare("UPDATE eve_identities SET is_primary = 0 WHERE account_id = ?1")
      .bind(accountId).run();
  }

  await env.DB.prepare(
    `INSERT INTO eve_identities
      (character_id, account_id, character_name, corporation_id, alliance_id, scopes_json, is_primary, last_verified_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, datetime('now'), datetime('now'))
     ON CONFLICT(character_id) DO UPDATE SET
       character_name = excluded.character_name,
       corporation_id = excluded.corporation_id,
       alliance_id = excluded.alliance_id,
       scopes_json = excluded.scopes_json,
       is_primary = excluded.is_primary,
       last_verified_at = datetime('now'),
       updated_at = datetime('now')`,
  ).bind(
    identity.characterId,
    accountId,
    identity.characterName,
    identity.corporationId,
    identity.allianceId,
    JSON.stringify(identity.scopes),
    primary ? 1 : 0,
  ).run();
}

export async function claimPrimaryIdentity(request: Request, env: SageEnv): Promise<Response> {
  const packetReceipt = await requireReadablePacket(request, "identity.claim_primary");
  if (packetReceipt instanceof Response) return packetReceipt;

  const authorization = request.headers.get("Authorization") ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) return error(401, "missing_eve_token", "A verified EVE access token is required.");

  let identity: EveIdentity;
  try {
    identity = await verifyEveAccessToken(match[1], env);
  } catch (cause) {
    return error(401, "invalid_eve_identity", cause instanceof Error ? cause.message : "EVE identity verification failed.");
  }

  const accountId = String(identity.characterId);
  const existingIdentity = await env.DB.prepare(
    "SELECT account_id, is_primary FROM eve_identities WHERE character_id = ?1 LIMIT 1",
  ).bind(identity.characterId).first<{ account_id: string; is_primary: number }>();
  if (existingIdentity && (existingIdentity.account_id !== accountId || existingIdentity.is_primary !== 1)) {
    return error(409, "character_not_primary", "This character is already linked as a non-primary character on another Sage account.");
  }

  const existingPrimary = await env.DB.prepare(
    "SELECT id FROM accounts WHERE primary_eve_character_id = ?1 LIMIT 1",
  ).bind(identity.characterId).first<{ id: string }>();
  if (existingPrimary && existingPrimary.id !== accountId) {
    return error(409, "primary_identity_conflict", "This EVE character already anchors a different Sage account record.");
  }

  await env.DB.prepare(
    `INSERT INTO accounts (id, primary_eve_character_id, status, updated_at)
     VALUES (?1, ?2, 'active', datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       primary_eve_character_id = excluded.primary_eve_character_id,
       status = 'active',
       updated_at = datetime('now')`,
  ).bind(accountId, identity.characterId).run();

  try {
    await upsertEveIdentity(env, accountId, identity, true);
  } catch (cause) {
    return error(409, "identity_conflict", cause instanceof Error ? cause.message : "Identity conflict.");
  }

  const session = await issueSession(env, accountId);
  return json({
    account_id: accountId,
    primary_character_id: identity.characterId,
    primary_character_name: identity.characterName,
    session_token: session.token,
    session_expires_at: session.expiresAt,
    recovered: Boolean(existingPrimary),
    transport: { schema: PACKET_SCHEMA, reply_to: packetReceipt.packetId, message_type: "identity.claim_primary.result" },
  }, existingPrimary ? 200 : 201);
}

export async function linkCharacterIdentity(request: Request, env: SageEnv): Promise<Response> {
  const packetReceipt = await requireReadablePacket(request, "identity.link_character");
  if (packetReceipt instanceof Response) return packetReceipt;

  const principal = await requireSageSession(request, env);
  if (principal instanceof Response) return principal;
  const eveToken = request.headers.get("X-EVE-Access-Token") ?? "";
  if (!eveToken) return error(401, "missing_eve_token", "The character EVE access token is required.");

  let identity: EveIdentity;
  try {
    identity = await verifyEveAccessToken(eveToken, env);
  } catch (cause) {
    return error(401, "invalid_eve_identity", cause instanceof Error ? cause.message : "EVE identity verification failed.");
  }

  const account = await env.DB.prepare(
    "SELECT primary_eve_character_id FROM accounts WHERE id = ?1 AND status = 'active' LIMIT 1",
  ).bind(principal.accountId).first<{ primary_eve_character_id: number | null }>();
  if (!account) return error(404, "account_not_found", "Sage account not found.");

  try {
    await upsertEveIdentity(env, principal.accountId, identity, account.primary_eve_character_id === identity.characterId);
  } catch (cause) {
    return error(409, "identity_conflict", cause instanceof Error ? cause.message : "Identity conflict.");
  }

  return json({
    account_id: principal.accountId,
    character_id: identity.characterId,
    character_name: identity.characterName,
    primary: account.primary_eve_character_id === identity.characterId,
    transport: { schema: PACKET_SCHEMA, reply_to: packetReceipt.packetId, message_type: "identity.link_character.result" },
  });
}

export async function getSageIdentity(request: Request, env: SageEnv): Promise<Response> {
  const principal = await requireSageSession(request, env);
  if (principal instanceof Response) return principal;
  const account = await env.DB.prepare(
    "SELECT id, primary_eve_character_id, status, created_at, updated_at FROM accounts WHERE id = ?1 LIMIT 1",
  ).bind(principal.accountId).first();
  if (!account) return error(404, "account_not_found", "Sage account not found.");
  const identities = await env.DB.prepare(
    `SELECT character_id, character_name, corporation_id, alliance_id, is_primary, last_verified_at
       FROM eve_identities WHERE account_id = ?1 ORDER BY is_primary DESC, character_name ASC`,
  ).bind(principal.accountId).all();
  return json({ account, characters: identities.results });
}
