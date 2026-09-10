import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { USER_DATA_ROOT } from "./data-paths";
import {
  getPrivateEsiDatasetRecord,
  listPrivateEsiDatasetRecords,
  savePrivateEsiDatasetRecord,
} from "./database";
import {
  datasetIdForPrivateEsiPath,
  requiredScopeForPrivateEsiPath,
  type PrivateEsiFailureKind,
} from "./esi-scope-manifest";
import { logEvent } from "./logger";

const LEGACY_ROOT = path.join(USER_DATA_ROOT, "Private ESI Cache");
const ESI = "https://esi.evetech.net";
const BASE_HEADERS = {
  "X-Compatibility-Date": "2026-08-02",
  "X-User-Agent": "NewEdenSage/1.1.22",
};
const ENCRYPTION_VERSION = 1;
const RECORD_SCHEMA_VERSION = 2;

type DatasetState =
  | "fresh"
  | "stale"
  | "never-collected"
  | "permission-missing"
  | "role-missing"
  | "rate-limited"
  | "authorization-error"
  | "endpoint-error";

type CacheRecord<T = unknown> = {
  schemaVersion: 2;
  characterId: string;
  path: string;
  datasetId: string;
  scopeRequired?: string | null;
  storedAt: string;
  checkedAt: string;
  nextEligibleAt: string;
  etag?: string | null;
  lastModified?: string | null;
  cacheControl?: string | null;
  expires?: string | null;
  rateGroup?: string | null;
  xPages?: number;
  status: number;
  state: DatasetState;
  lastSuccessAt?: string | null;
  lastAttemptAt: string;
  lastError?: string | null;
  failureKind?: PrivateEsiFailureKind | null;
  data: T;
};

export type PrivateEsiResult<T> = {
  data: T;
  status: number;
  xPages: number;
  fromCache: boolean;
  checkedAt: string;
  nextEligibleAt: string;
  state: DatasetState;
  datasetId: string;
  scopeRequired?: string | null;
  lastSuccessAt?: string | null;
  lastAttemptAt: string;
  lastError?: string | null;
  failureKind?: PrivateEsiFailureKind | null;
};

export type PrivateEsiDatasetStatus = {
  datasetId: string;
  state: DatasetState;
  scopeRequired: string | null;
  requestCount: number;
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
  failureKind: PrivateEsiFailureKind | null;
  lastHttpStatus: number | null;
};

export class PrivateEsiRequestError extends Error {
  readonly privateEsiState: DatasetState;
  readonly failureKind: PrivateEsiFailureKind;
  readonly status: number | null;
  readonly requestPath: string;
  readonly scopeRequired: string | null;

  constructor(input: {
    message: string;
    state: DatasetState;
    failureKind: PrivateEsiFailureKind;
    status?: number | null;
    requestPath: string;
    scopeRequired?: string | null;
  }) {
    super(input.message);
    this.name = "PrivateEsiRequestError";
    this.privateEsiState = input.state;
    this.failureKind = input.failureKind;
    this.status = input.status ?? null;
    this.requestPath = input.requestPath;
    this.scopeRequired = input.scopeRequired ?? null;
  }
}

const memory = new Map<string, CacheRecord>();
const groupBackoff = new Map<string, number>();
let encryptionKey: Buffer | null = null;
let encryptionKeyFingerprint = "";

export function configurePrivateEsiEncryptionKey(base64Key: string) {
  const key = Buffer.from(String(base64Key ?? ""), "base64");
  if (key.length !== 32) throw new Error("Private ESI encryption key must be 32 bytes.");
  encryptionKey = key;
  encryptionKeyFingerprint = createHash("sha256").update(key).digest("hex").slice(0, 24);
  memory.clear();
}

function requireEncryptionKey() {
  if (!encryptionKey) throw new Error("Private ESI encryption is not initialised.");
  return encryptionKey;
}

function key(characterId: string, requestPath: string) {
  return `${characterId}:${requestPath}`;
}

function legacyFilePath(characterId: string, requestPath: string) {
  const digest = createHash("sha256").update(requestPath).digest("hex");
  return path.join(LEGACY_ROOT, characterId.replace(/[^0-9A-Za-z._-]/g, "_"), `${digest}.json`);
}

function encryptPayload(data: unknown) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", requireEncryptionKey(), iv);
  const plaintext = Buffer.from(JSON.stringify(data), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return JSON.stringify({
    v: ENCRYPTION_VERSION,
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  });
}

function decryptPayload<T>(envelopeText: string): T {
  const envelope = JSON.parse(envelopeText) as { v?: number; iv?: string; tag?: string; ciphertext?: string };
  if (envelope.v !== ENCRYPTION_VERSION || !envelope.iv || !envelope.tag || !envelope.ciphertext) {
    throw new Error("Unsupported private ESI encrypted payload format.");
  }
  const decipher = createDecipheriv("aes-256-gcm", requireEncryptionKey(), Buffer.from(envelope.iv, "base64"));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64")),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString("utf8")) as T;
}

function tokenScopes(accessToken: string) {
  try {
    const payload = accessToken.split(".")[1];
    if (!payload) return [] as string[];
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { scp?: string[] | string };
    if (Array.isArray(claims.scp)) return claims.scp.map(String);
    if (typeof claims.scp === "string") return claims.scp.split(/\s+/).filter(Boolean);
  } catch {
    // Classification can continue without the token claim.
  }
  return [] as string[];
}

function failureKindFor(requestPath: string, status: number | null, accessToken: string): PrivateEsiFailureKind {
  if (status === 420 || status === 429) return "rate-limited";
  if (status === 401) return "authorization-error";
  if (status === 403) {
    const requiredScope = requiredScopeForPrivateEsiPath(requestPath);
    const scopes = tokenScopes(accessToken);
    if (requiredScope && scopes.length && !scopes.includes(requiredScope)) return "permission-missing";
    if (requestPath.startsWith("/corporations/")) return "role-missing";
  }
  return "endpoint-error";
}

function stateForFailure(kind: PrivateEsiFailureKind, hasLastKnownGood: boolean): DatasetState {
  return hasLastKnownGood ? "stale" : kind;
}

function cacheSeconds(headers: Headers) {
  const control = String(headers.get("cache-control") ?? "");
  const match = control.match(/(?:^|,)\s*(?:s-maxage|max-age)=(\d+)/i);
  if (match) return Math.max(0, Number(match[1]));
  const expires = Date.parse(String(headers.get("expires") ?? ""));
  const responseDate = Date.parse(String(headers.get("date") ?? ""));
  if (Number.isFinite(expires)) return Math.max(0, Math.ceil((expires - (Number.isFinite(responseDate) ? responseDate : Date.now())) / 1000));
  return 0;
}

function retrySeconds(headers: Headers) {
  const raw = String(headers.get("retry-after") ?? "").trim();
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds > 0) return seconds;
  const date = Date.parse(raw);
  if (Number.isFinite(date)) return Math.max(1, Math.ceil((date - Date.now()) / 1000));
  const esiReset = Number(headers.get("x-esi-error-limit-reset") ?? 0);
  return Number.isFinite(esiReset) && esiReset > 0 ? esiReset : 0;
}

function recordFromDatabase<T>(row: NonNullable<ReturnType<typeof getPrivateEsiDatasetRecord>>): CacheRecord<T> {
  if (row.keyFingerprint !== encryptionKeyFingerprint) {
    throw new Error("Private ESI dataset was encrypted with a different local key.");
  }
  return {
    schemaVersion: RECORD_SCHEMA_VERSION,
    characterId: row.characterId,
    path: row.requestPath,
    datasetId: row.datasetId,
    scopeRequired: row.scopeRequired ?? null,
    storedAt: row.fetchedAt ?? row.lastAttemptAt,
    checkedAt: row.lastAttemptAt,
    nextEligibleAt: row.nextEligibleAt ?? row.lastAttemptAt,
    etag: row.etag ?? null,
    lastModified: row.lastModified ?? null,
    cacheControl: row.cacheControl ?? null,
    expires: row.expires ?? null,
    rateGroup: row.rateGroup ?? null,
    xPages: Math.max(1, Number(row.xPages ?? 1)),
    status: Number(row.lastHttpStatus ?? 0),
    state: (row.status || (row.lastSuccessAt ? "fresh" : "never-collected")) as DatasetState,
    lastSuccessAt: row.lastSuccessAt ?? null,
    lastAttemptAt: row.lastAttemptAt,
    lastError: row.lastError ?? null,
    failureKind: (row.failureKind ?? null) as PrivateEsiFailureKind | null,
    data: decryptPayload<T>(row.encryptedPayload),
  };
}

async function readLegacyRecord<T>(characterId: string, requestPath: string): Promise<CacheRecord<T> | null> {
  const target = legacyFilePath(characterId, requestPath);
  try {
    const parsed = JSON.parse(await fs.readFile(target, "utf8")) as any;
    if (parsed?.schemaVersion !== 1 || parsed.characterId !== characterId || parsed.path !== requestPath) return null;
    const successAt = String(parsed.checkedAt ?? parsed.storedAt ?? new Date().toISOString());
    const migrated: CacheRecord<T> = {
      schemaVersion: RECORD_SCHEMA_VERSION,
      characterId,
      path: requestPath,
      datasetId: datasetIdForPrivateEsiPath(requestPath),
      scopeRequired: requiredScopeForPrivateEsiPath(requestPath),
      storedAt: String(parsed.storedAt ?? successAt),
      checkedAt: successAt,
      nextEligibleAt: String(parsed.nextEligibleAt ?? successAt),
      etag: parsed.etag ?? null,
      lastModified: parsed.lastModified ?? null,
      cacheControl: parsed.cacheControl ?? null,
      expires: parsed.expires ?? null,
      rateGroup: parsed.rateGroup ?? null,
      xPages: Math.max(1, Number(parsed.xPages ?? 1)),
      status: Number(parsed.status ?? 200),
      state: "fresh",
      lastSuccessAt: successAt,
      lastAttemptAt: successAt,
      lastError: null,
      failureKind: null,
      data: parsed.data as T,
    };
    await writeRecord(migrated);
    await fs.rm(target, { force: true });
    return migrated;
  } catch {
    return null;
  }
}

async function readRecord<T>(characterId: string, requestPath: string): Promise<CacheRecord<T> | null> {
  const cacheKey = key(characterId, requestPath);
  const existing = memory.get(cacheKey) as CacheRecord<T> | undefined;
  if (existing) return existing;
  try {
    const stored = getPrivateEsiDatasetRecord(characterId, requestPath);
    if (stored) {
      const record = recordFromDatabase<T>(stored);
      memory.set(cacheKey, record as CacheRecord);
      return record;
    }
  } catch (error) {
    void logEvent("error", "private_esi.decrypt_failed", {
      characterId,
      path: requestPath,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return readLegacyRecord<T>(characterId, requestPath);
}

async function writeRecord<T>(record: CacheRecord<T>) {
  savePrivateEsiDatasetRecord({
    characterId: record.characterId,
    requestPath: record.path,
    datasetId: record.datasetId,
    scopeRequired: record.scopeRequired ?? null,
    encryptedPayload: encryptPayload(record.data),
    encryptionVersion: ENCRYPTION_VERSION,
    keyFingerprint: encryptionKeyFingerprint,
    status: record.state,
    lastHttpStatus: Number.isFinite(record.status) ? record.status : null,
    fetchedAt: record.lastSuccessAt ?? null,
    lastAttemptAt: record.lastAttemptAt,
    lastSuccessAt: record.lastSuccessAt ?? null,
    nextEligibleAt: record.nextEligibleAt,
    etag: record.etag ?? null,
    lastModified: record.lastModified ?? null,
    cacheControl: record.cacheControl ?? null,
    expires: record.expires ?? null,
    rateGroup: record.rateGroup ?? null,
    xPages: Math.max(1, Number(record.xPages ?? 1)),
    lastError: record.lastError ?? null,
    failureKind: record.failureKind ?? null,
    schemaVersion: RECORD_SCHEMA_VERSION,
  });
  memory.set(key(record.characterId, record.path), record as CacheRecord);
}

function result<T>(record: CacheRecord<T>, fromCache: boolean): PrivateEsiResult<T> {
  return {
    data: record.data,
    status: record.status,
    xPages: Math.max(1, Number(record.xPages ?? 1)),
    fromCache,
    checkedAt: record.checkedAt,
    nextEligibleAt: record.nextEligibleAt,
    state: record.state,
    datasetId: record.datasetId,
    scopeRequired: record.scopeRequired ?? null,
    lastSuccessAt: record.lastSuccessAt ?? null,
    lastAttemptAt: record.lastAttemptAt,
    lastError: record.lastError ?? null,
    failureKind: record.failureKind ?? null,
  };
}

async function recordFailure<T>(input: {
  characterId: string;
  requestPath: string;
  retained: CacheRecord<T> | null;
  accessToken: string;
  status: number | null;
  message: string;
  nextEligibleAt?: string;
}) {
  const nowIso = new Date().toISOString();
  const failureKind = failureKindFor(input.requestPath, input.status, input.accessToken);
  const hasLastKnownGood = Boolean(input.retained?.lastSuccessAt);
  const record: CacheRecord<T> = input.retained
    ? {
        ...input.retained,
        checkedAt: nowIso,
        lastAttemptAt: nowIso,
        nextEligibleAt: input.nextEligibleAt ?? nowIso,
        state: stateForFailure(failureKind, hasLastKnownGood),
        lastError: input.message,
        failureKind,
        status: input.status ?? input.retained.status,
      }
    : {
        schemaVersion: RECORD_SCHEMA_VERSION,
        characterId: input.characterId,
        path: input.requestPath,
        datasetId: datasetIdForPrivateEsiPath(input.requestPath),
        scopeRequired: requiredScopeForPrivateEsiPath(input.requestPath),
        storedAt: nowIso,
        checkedAt: nowIso,
        nextEligibleAt: input.nextEligibleAt ?? nowIso,
        xPages: 1,
        status: input.status ?? 0,
        state: stateForFailure(failureKind, false),
        lastSuccessAt: null,
        lastAttemptAt: nowIso,
        lastError: input.message,
        failureKind,
        data: null as T,
      };
  await writeRecord(record);
  return record;
}

export function privateEsiErrorDetails(error: unknown) {
  if (error instanceof PrivateEsiRequestError) {
    return {
      unavailable: true as const,
      endpoint: error.requestPath,
      state: error.privateEsiState,
      failureKind: error.failureKind,
      scopeRequired: error.scopeRequired,
      status: error.status,
      error: error.message,
    };
  }
  return {
    unavailable: true as const,
    state: "endpoint-error" as const,
    failureKind: "endpoint-error" as const,
    status: null,
    error: error instanceof Error ? error.message : String(error),
  };
}

export async function privateEsiJson<T>(characterId: string, requestPath: string, accessToken: string): Promise<PrivateEsiResult<T>> {
  requireEncryptionKey();
  const retained = await readRecord<T>(characterId, requestPath);
  const hasLastKnownGood = Boolean(retained?.lastSuccessAt);
  const now = Date.now();
  const nextEligible = Date.parse(String(retained?.nextEligibleAt ?? ""));
  if (retained && hasLastKnownGood && Number.isFinite(nextEligible) && nextEligible > now) {
    void logEvent("info", "private_esi.cache_hit", { characterId, path: requestPath, nextEligibleAt: retained.nextEligibleAt, state: retained.state });
    return result(retained, true);
  }

  const retainedGroup = retained?.rateGroup || "default";
  const blockedUntil = groupBackoff.get(retainedGroup) ?? 0;
  if (blockedUntil > now) {
    if (retained && hasLastKnownGood) return result(retained, true);
    const message = `Private ESI rate group ${retainedGroup} is backed off until ${new Date(blockedUntil).toISOString()}.`;
    const failed = await recordFailure({ characterId, requestPath, retained, accessToken, status: 429, message, nextEligibleAt: new Date(blockedUntil).toISOString() });
    throw new PrivateEsiRequestError({ message, state: failed.state, failureKind: "rate-limited", status: 429, requestPath, scopeRequired: failed.scopeRequired });
  }

  const headers: Record<string, string> = { ...BASE_HEADERS, Authorization: `Bearer ${accessToken}` };
  if (retained?.etag && hasLastKnownGood) headers["If-None-Match"] = retained.etag;
  if (retained?.lastModified && hasLastKnownGood) headers["If-Modified-Since"] = retained.lastModified;

  let response: Response;
  try {
    response = await fetch(`${ESI}${requestPath}`, { headers, signal: AbortSignal.timeout(30_000) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failed = await recordFailure({ characterId, requestPath, retained, accessToken, status: null, message });
    void logEvent("warn", "private_esi.network_failure", { characterId, path: requestPath, state: failed.state, error: message });
    if (hasLastKnownGood) return result(failed, true);
    throw new PrivateEsiRequestError({ message, state: failed.state, failureKind: failed.failureKind ?? "endpoint-error", requestPath, scopeRequired: failed.scopeRequired });
  }

  const checkedAt = new Date().toISOString();
  const rateGroup = response.headers.get("x-ratelimit-group") || retained?.rateGroup || "default";
  const retry = retrySeconds(response.headers);
  if (retry > 0 && (response.status === 420 || response.status === 429 || response.status >= 500)) groupBackoff.set(rateGroup, now + retry * 1000);

  const ttl = cacheSeconds(response.headers);
  const nextEligibleAt = new Date(now + ttl * 1000).toISOString();
  const metadata = {
    schemaVersion: RECORD_SCHEMA_VERSION as 2,
    characterId,
    path: requestPath,
    datasetId: datasetIdForPrivateEsiPath(requestPath),
    scopeRequired: requiredScopeForPrivateEsiPath(requestPath),
    storedAt: retained?.storedAt ?? checkedAt,
    checkedAt,
    nextEligibleAt,
    etag: response.headers.get("etag") || retained?.etag || null,
    lastModified: response.headers.get("last-modified") || retained?.lastModified || null,
    cacheControl: response.headers.get("cache-control"),
    expires: response.headers.get("expires"),
    rateGroup,
    xPages: Math.max(1, Number(response.headers.get("x-pages") || retained?.xPages || 1)),
  };

  if (response.status === 304) {
    if (!retained || !hasLastKnownGood) throw new Error(`Private ESI returned 304 without local state for ${requestPath}.`);
    const record: CacheRecord<T> = {
      ...retained,
      ...metadata,
      status: retained.status || 200,
      state: "fresh",
      lastSuccessAt: checkedAt,
      lastAttemptAt: checkedAt,
      lastError: null,
      failureKind: null,
    };
    await writeRecord(record);
    void logEvent("info", "private_esi.not_modified", { characterId, path: requestPath, nextEligibleAt });
    return result(record, true);
  }

  if (response.status === 204) {
    const record: CacheRecord<T> = {
      ...metadata,
      storedAt: checkedAt,
      status: 204,
      state: "fresh",
      lastSuccessAt: checkedAt,
      lastAttemptAt: checkedAt,
      lastError: null,
      failureKind: null,
      data: null as T,
    };
    await writeRecord(record);
    return result(record, false);
  }

  if (!response.ok) {
    const message = `ESI request failed (${response.status}) for ${requestPath}.`;
    const failed = await recordFailure({ characterId, requestPath, retained, accessToken, status: response.status, message, nextEligibleAt: retry > 0 ? new Date(now + retry * 1000).toISOString() : checkedAt });
    void logEvent("warn", "private_esi.request_failed", {
      characterId,
      path: requestPath,
      status: response.status,
      state: failed.state,
      failureKind: failed.failureKind,
      scopeRequired: failed.scopeRequired,
      usingLastKnownGood: hasLastKnownGood,
    });
    if (hasLastKnownGood) return result(failed, true);
    throw new PrivateEsiRequestError({
      message,
      state: failed.state,
      failureKind: failed.failureKind ?? "endpoint-error",
      status: response.status,
      requestPath,
      scopeRequired: failed.scopeRequired,
    });
  }

  let data: T;
  try {
    data = await response.json() as T;
  } catch (error) {
    const message = `ESI returned an unreadable response for ${requestPath}: ${error instanceof Error ? error.message : String(error)}`;
    const failed = await recordFailure({ characterId, requestPath, retained, accessToken, status: response.status, message });
    if (hasLastKnownGood) return result(failed, true);
    throw new PrivateEsiRequestError({ message, state: failed.state, failureKind: "endpoint-error", status: response.status, requestPath, scopeRequired: failed.scopeRequired });
  }

  const record: CacheRecord<T> = {
    ...metadata,
    storedAt: checkedAt,
    status: response.status,
    state: "fresh",
    lastSuccessAt: checkedAt,
    lastAttemptAt: checkedAt,
    lastError: null,
    failureKind: null,
    data,
  };
  await writeRecord(record);
  void logEvent("info", "private_esi.updated", { characterId, path: requestPath, datasetId: record.datasetId, status: response.status, nextEligibleAt, rateGroup });
  return result(record, false);
}

export async function privateEsiPagedJson<T>(characterId: string, requestPath: string, accessToken: string, concurrency = 4): Promise<T[]> {
  const separator = requestPath.includes("?") ? "&" : "?";
  const firstPath = `${requestPath}${separator}page=1`;
  const first = await privateEsiJson<T[]>(characterId, firstPath, accessToken);
  if (!Array.isArray(first.data)) return [];
  const pages = Math.max(1, first.xPages);
  if (pages === 1) return first.data;
  const pageNumbers = Array.from({ length: pages - 1 }, (_, index) => index + 2);
  const output: T[][] = new Array(pageNumbers.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, pageNumbers.length) }, async () => {
    while (cursor < pageNumbers.length) {
      const index = cursor++;
      const page = pageNumbers[index];
      output[index] = (await privateEsiJson<T[]>(characterId, `${requestPath}${separator}page=${page}`, accessToken)).data;
    }
  }));
  return first.data.concat(...output.filter(Array.isArray));
}

export function listPrivateEsiDatasetStatus(characterId: string): PrivateEsiDatasetStatus[] {
  const rows = listPrivateEsiDatasetRecords(characterId);
  const grouped = new Map<string, PrivateEsiDatasetStatus>();
  const stateRank: Record<string, number> = {
    fresh: 0,
    stale: 1,
    "never-collected": 2,
    "rate-limited": 3,
    "endpoint-error": 4,
    "role-missing": 5,
    "authorization-error": 6,
    "permission-missing": 7,
  };
  for (const row of rows) {
    const current = grouped.get(row.datasetId);
    const candidateState = (row.status || (row.lastSuccessAt ? "fresh" : "never-collected")) as DatasetState;
    const next: PrivateEsiDatasetStatus = current ?? {
      datasetId: row.datasetId,
      state: candidateState,
      scopeRequired: row.scopeRequired ?? null,
      requestCount: 0,
      lastSuccessAt: null,
      lastAttemptAt: null,
      lastError: null,
      failureKind: null,
      lastHttpStatus: null,
    };
    next.requestCount += 1;
    if ((stateRank[candidateState] ?? 99) > (stateRank[next.state] ?? 99)) next.state = candidateState;
    if (!next.scopeRequired && row.scopeRequired) next.scopeRequired = row.scopeRequired;
    if (row.lastSuccessAt && (!next.lastSuccessAt || row.lastSuccessAt > next.lastSuccessAt)) next.lastSuccessAt = row.lastSuccessAt;
    if (row.lastAttemptAt && (!next.lastAttemptAt || row.lastAttemptAt > next.lastAttemptAt)) {
      next.lastAttemptAt = row.lastAttemptAt;
      next.lastError = row.lastError ?? null;
      next.failureKind = (row.failureKind ?? null) as PrivateEsiFailureKind | null;
      next.lastHttpStatus = row.lastHttpStatus ?? null;
    }
    grouped.set(row.datasetId, next);
  }
  return [...grouped.values()].sort((a, b) => a.datasetId.localeCompare(b.datasetId));
}

export async function migrateLegacyPrivateEsiCache() {
  requireEncryptionKey();
  let migrated = 0;
  let failed = 0;
  try {
    const characterDirs = await fs.readdir(LEGACY_ROOT, { withFileTypes: true });
    for (const directory of characterDirs) {
      if (!directory.isDirectory()) continue;
      const dir = path.join(LEGACY_ROOT, directory.name);
      const files = await fs.readdir(dir);
      for (const name of files) {
        if (!name.endsWith(".json")) continue;
        const target = path.join(dir, name);
        try {
          const parsed = JSON.parse(await fs.readFile(target, "utf8")) as any;
          if (parsed?.schemaVersion !== 1 || !parsed.characterId || !parsed.path) continue;
          const successAt = String(parsed.checkedAt ?? parsed.storedAt ?? new Date().toISOString());
          await writeRecord({
            schemaVersion: RECORD_SCHEMA_VERSION,
            characterId: String(parsed.characterId),
            path: String(parsed.path),
            datasetId: datasetIdForPrivateEsiPath(String(parsed.path)),
            scopeRequired: requiredScopeForPrivateEsiPath(String(parsed.path)),
            storedAt: String(parsed.storedAt ?? successAt),
            checkedAt: successAt,
            nextEligibleAt: String(parsed.nextEligibleAt ?? successAt),
            etag: parsed.etag ?? null,
            lastModified: parsed.lastModified ?? null,
            cacheControl: parsed.cacheControl ?? null,
            expires: parsed.expires ?? null,
            rateGroup: parsed.rateGroup ?? null,
            xPages: Math.max(1, Number(parsed.xPages ?? 1)),
            status: Number(parsed.status ?? 200),
            state: "fresh",
            lastSuccessAt: successAt,
            lastAttemptAt: successAt,
            lastError: null,
            failureKind: null,
            data: parsed.data,
          });
          await fs.rm(target, { force: true });
          migrated += 1;
        } catch {
          failed += 1;
        }
      }
      try { await fs.rmdir(dir); } catch { /* non-empty or already removed */ }
    }
    try { await fs.rmdir(LEGACY_ROOT); } catch { /* non-empty or absent */ }
  } catch {
    return { migrated: 0, failed: 0 };
  }
  await logEvent(failed ? "warn" : "info", "private_esi.legacy_cache_migrated", { migrated, failed });
  return { migrated, failed };
}
