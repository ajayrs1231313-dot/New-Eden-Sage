import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { USER_DATA_ROOT } from "./data-paths";
import { logEvent } from "./logger";

const ROOT = path.join(USER_DATA_ROOT, "Private ESI Cache");
const ESI = "https://esi.evetech.net";
const BASE_HEADERS = {
  "X-Compatibility-Date": "2026-08-02",
  "X-User-Agent": "NewEdenSage/1.1.12",
};

type CacheRecord<T = unknown> = {
  schemaVersion: 1;
  characterId: string;
  path: string;
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
  data: T;
};

export type PrivateEsiResult<T> = {
  data: T;
  status: number;
  xPages: number;
  fromCache: boolean;
  checkedAt: string;
  nextEligibleAt: string;
};

const memory = new Map<string, CacheRecord>();
const groupBackoff = new Map<string, number>();

function key(characterId: string, requestPath: string) {
  return `${characterId}:${requestPath}`;
}
function filePath(characterId: string, requestPath: string) {
  const digest = createHash("sha256").update(requestPath).digest("hex");
  return path.join(ROOT, characterId.replace(/[^0-9A-Za-z._-]/g, "_"), `${digest}.json`);
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
async function readRecord<T>(characterId: string, requestPath: string): Promise<CacheRecord<T> | null> {
  const cacheKey = key(characterId, requestPath);
  const existing = memory.get(cacheKey) as CacheRecord<T> | undefined;
  if (existing) return existing;
  try {
    const parsed = JSON.parse(await fs.readFile(filePath(characterId, requestPath), "utf8")) as CacheRecord<T>;
    if (parsed?.schemaVersion !== 1 || parsed.characterId !== characterId || parsed.path !== requestPath) return null;
    memory.set(cacheKey, parsed as CacheRecord);
    return parsed;
  } catch {
    return null;
  }
}
async function writeRecord<T>(record: CacheRecord<T>) {
  const target = filePath(record.characterId, record.path);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const partial = `${target}.${process.pid}.${randomUUID()}.partial`;
  await fs.writeFile(partial, JSON.stringify(record), "utf8");
  await fs.rename(partial, target).catch(async () => {
    await fs.copyFile(partial, target);
    await fs.rm(partial, { force: true });
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
  };
}

export async function privateEsiJson<T>(characterId: string, requestPath: string, accessToken: string): Promise<PrivateEsiResult<T>> {
  const retained = await readRecord<T>(characterId, requestPath);
  const now = Date.now();
  const nextEligible = Date.parse(String(retained?.nextEligibleAt ?? ""));
  if (retained && Number.isFinite(nextEligible) && nextEligible > now) {
    void logEvent("info", "private_esi.cache_hit", { characterId, path: requestPath, nextEligibleAt: retained.nextEligibleAt });
    return result(retained, true);
  }

  const retainedGroup = retained?.rateGroup || "default";
  const blockedUntil = groupBackoff.get(retainedGroup) ?? 0;
  if (blockedUntil > now) {
    if (retained) return result(retained, true);
    throw new Error(`Private ESI rate group ${retainedGroup} is backed off until ${new Date(blockedUntil).toISOString()}.`);
  }

  const headers: Record<string, string> = { ...BASE_HEADERS, Authorization: `Bearer ${accessToken}` };
  if (retained?.etag) headers["If-None-Match"] = retained.etag;
  if (retained?.lastModified) headers["If-Modified-Since"] = retained.lastModified;
  const response = await fetch(`${ESI}${requestPath}`, { headers, signal: AbortSignal.timeout(30_000) });
  const checkedAt = new Date().toISOString();
  const rateGroup = response.headers.get("x-ratelimit-group") || retained?.rateGroup || "default";
  const retry = retrySeconds(response.headers);
  if (retry > 0 && (response.status === 420 || response.status === 429 || response.status >= 500)) groupBackoff.set(rateGroup, now + retry * 1000);

  const ttl = cacheSeconds(response.headers);
  const nextEligibleAt = new Date(now + ttl * 1000).toISOString();
  const metadata = {
    schemaVersion: 1 as const,
    characterId,
    path: requestPath,
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
    if (!retained) throw new Error(`Private ESI returned 304 without local state for ${requestPath}.`);
    const record: CacheRecord<T> = { ...retained, ...metadata, status: retained.status };
    await writeRecord(record);
    void logEvent("info", "private_esi.not_modified", { characterId, path: requestPath, nextEligibleAt });
    return result(record, true);
  }
  if (response.status === 204) {
    const record: CacheRecord<T> = { ...metadata, storedAt: checkedAt, status: 204, data: null as T };
    await writeRecord(record);
    return result(record, false);
  }
  if (!response.ok) {
    if (retained && (response.status === 420 || response.status === 429 || response.status >= 500)) {
      void logEvent("warn", "private_esi.backoff_using_local", { characterId, path: requestPath, status: response.status, retrySeconds: retry, rateGroup });
      return result(retained, true);
    }
    throw new Error(`ESI request failed (${response.status}) for ${requestPath}.`);
  }
  const data = await response.json() as T;
  const record: CacheRecord<T> = { ...metadata, storedAt: checkedAt, status: response.status, data };
  await writeRecord(record);
  void logEvent("info", "private_esi.updated", { characterId, path: requestPath, status: response.status, nextEligibleAt, rateGroup });
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
