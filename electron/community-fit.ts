import { promises as fs } from "node:fs";
import path from "node:path";
import { fetchTypeDetail } from "./readiness";
import { USER_DATA_ROOT } from "./data-paths";

const ESI = "https://esi.evetech.net";
const ZKILL = "https://zkillboard.com/api";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const EMPTY_CACHE_TTL_MS = 60 * 60 * 1000;
const SAMPLE_LIMIT = 24;
const MAX_COMMON_ITEMS = 22;
const WINDOW_SECONDS = 7 * 24 * 60 * 60;
const REQUEST_TIMEOUT_MS = 8_000;

const esiHeaders = {
  "X-Compatibility-Date": "2026-08-02",
  "X-User-Agent": "NewEdenSage/0.1.4",
};

const zkillHeaders = {
  "Accept-Encoding": "gzip",
  "User-Agent": "New Eden Sage/0.1.4 contact: local desktop application",
};

type KillReference = { killmail_id: number; zkb?: { hash?: string } };
type KillItem = {
  item_type_id: number;
  flag: number;
  quantity_destroyed?: number;
  quantity_dropped?: number;
  items?: KillItem[];
};
type Killmail = {
  killmail_id: number;
  killmail_time: string;
  victim: { ship_type_id: number; items?: KillItem[] };
};

export type CommunityFitSample = {
  id: string;
  observedAt: string;
  itemTypeIds: number[];
  items: Array<{ typeId: number; name: string }>;
};

export type CommunityFitSamples = {
  hullTypeId: number;
  hull: string;
  source: "zkillboard-recent-losses";
  fetchedAt: string;
  windowDays: number;
  sampleCount: number;
  confidence: "none" | "low" | "medium" | "high";
  status: "ready" | "no-data" | "error";
  note?: string;
  samples: CommunityFitSample[];
};

export type CommunityFitItem = {
  typeId: number;
  name: string;
  seenInFits: number;
  presencePercent: number;
};

export type CommunityFitProfile = {
  hullTypeId: number;
  hull: string;
  source: "zkillboard-recent-losses";
  fetchedAt: string;
  windowDays: number;
  sampleCount: number;
  confidence: "none" | "low" | "medium" | "high";
  items: CommunityFitItem[];
  status: "ready" | "no-data" | "error";
  note?: string;
};

let zkillSerial: Promise<unknown> = Promise.resolve();
let lastZkillRequestAt = 0;

function samplesCachePath(hullTypeId: number) {
  return path.join(USER_DATA_ROOT, "community-fit-samples", `${hullTypeId}.json`);
}
function profileCachePath(hullTypeId: number) {
  return path.join(USER_DATA_ROOT, "community-fit-cache", `${hullTypeId}.json`);
}

async function readCache<T>(file: string): Promise<T | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(file, "utf8")) as T & { expiresAt?: number };
    if ((parsed.expiresAt ?? 0) > Date.now()) return parsed;
  } catch {
    // Cache misses are normal.
  }
  return null;
}

async function writeCache<T extends object>(file: string, value: T, ttlMs: number) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify({ ...value, expiresAt: Date.now() + ttlMs }, null, 2), "utf8");
}

async function politeZkillFetch(url: string) {
  const run = zkillSerial.then(async () => {
    const wait = Math.max(0, 350 - (Date.now() - lastZkillRequestAt));
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    const response = await fetch(url, {
      headers: zkillHeaders,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    lastZkillRequestAt = Date.now();
    return response;
  });
  zkillSerial = run.then(() => undefined, () => undefined);
  return run;
}

function isFittingFlag(flag: number) {
  return (
    (flag >= 11 && flag <= 34) ||
    flag === 87 ||
    (flag >= 92 && flag <= 99) ||
    (flag >= 125 && flag <= 132) ||
    (flag >= 158 && flag <= 163)
  );
}

function collectFittedTypeIds(items: KillItem[] | undefined, output = new Set<number>()) {
  for (const item of items ?? []) {
    if (isFittingFlag(item.flag)) output.add(item.item_type_id);
    if (item.items?.length) collectFittedTypeIds(item.items, output);
  }
  return output;
}

async function fetchKillmail(reference: KillReference): Promise<Killmail | null> {
  const hash = reference.zkb?.hash;
  if (!hash) return null;
  try {
    const response = await fetch(
      `${ESI}/killmails/${reference.killmail_id}/${encodeURIComponent(hash)}/`,
      { headers: esiHeaders, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
    );
    if (!response.ok) return null;
    return (await response.json()) as Killmail;
  } catch {
    return null;
  }
}

async function fetchKillmailBatch(references: KillReference[]) {
  const results: Array<Killmail | null> = [];
  for (let index = 0; index < references.length; index += 4)
    results.push(...(await Promise.all(references.slice(index, index + 4).map(fetchKillmail))));
  return results.filter((item): item is Killmail => Boolean(item));
}

function confidenceFor(sampleCount: number): CommunityFitSamples["confidence"] {
  if (sampleCount >= 15) return "high";
  if (sampleCount >= 8) return "medium";
  if (sampleCount >= 3) return "low";
  return "none";
}

async function resolveNames(typeIds: number[]) {
  const names = new Map<number, string>();
  for (let index = 0; index < typeIds.length; index += 1000) {
    try {
      const response = await fetch(`${ESI}/universe/names/`, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        method: "POST",
        headers: { ...esiHeaders, "Content-Type": "application/json" },
        body: JSON.stringify(typeIds.slice(index, index + 1000)),
      });
      if (!response.ok) continue;
      for (const item of (await response.json()) as Array<{ id: number; name: string }>)
        names.set(item.id, item.name);
    } catch {
      // Type IDs remain usable even if display-name enrichment times out.
    }
  }
  return names;
}

export async function getRecentHullFitSamples(
  hullTypeId: number,
  force = false,
): Promise<CommunityFitSamples> {
  if (!force) {
    const cached = await readCache<CommunityFitSamples>(samplesCachePath(hullTypeId));
    if (cached) return cached;
  }

  const hull = await fetchTypeDetail(hullTypeId);
  if (!hull.group_id) {
    const empty: CommunityFitSamples = {
      hullTypeId,
      hull: hull.name,
      source: "zkillboard-recent-losses",
      fetchedAt: new Date().toISOString(),
      windowDays: 7,
      sampleCount: 0,
      confidence: "none",
      status: "no-data",
      note: "The ship group could not be resolved for recent-fit sampling.",
      samples: [],
    };
    await writeCache(samplesCachePath(hullTypeId), empty, EMPTY_CACHE_TTL_MS);
    return empty;
  }

  try {
    const query = `${ZKILL}/losses/shipTypeID/${hullTypeId}/groupID/${hull.group_id}/pastSeconds/${WINDOW_SECONDS}/`;
    const response = await politeZkillFetch(query);
    if (!response.ok) throw new Error(`zKillboard returned ${response.status}.`);
    const references = ((await response.json()) as KillReference[])
      .filter((item) => item.killmail_id && item.zkb?.hash)
      .slice(0, SAMPLE_LIMIT);
    const killmails = (await fetchKillmailBatch(references)).filter(
      (killmail) => killmail.victim.ship_type_id === hullTypeId,
    );
    const perKill = killmails.map((killmail) => ({
      killmail,
      typeIds: [...collectFittedTypeIds(killmail.victim.items)],
    }));
    const allTypeIds = [...new Set(perKill.flatMap((item) => item.typeIds))];
    const names = await resolveNames(allTypeIds);
    const samples = perKill
      .filter((item) => item.typeIds.length)
      .map(({ killmail, typeIds }) => ({
        id: String(killmail.killmail_id),
        observedAt: killmail.killmail_time,
        itemTypeIds: typeIds,
        items: typeIds.map((typeId) => ({ typeId, name: names.get(typeId) ?? `Type ${typeId}` })),
      }));
    const result: CommunityFitSamples = {
      hullTypeId,
      hull: hull.name,
      source: "zkillboard-recent-losses",
      fetchedAt: new Date().toISOString(),
      windowDays: 7,
      sampleCount: samples.length,
      confidence: confidenceFor(samples.length),
      status: samples.length ? "ready" : "no-data",
      note: samples.length ? undefined : "Not enough recent public losses were available to build fitting samples.",
      samples,
    };
    await writeCache(
      samplesCachePath(hullTypeId),
      result,
      result.status === "ready" ? CACHE_TTL_MS : EMPTY_CACHE_TTL_MS,
    );
    return result;
  } catch (error) {
    const failed: CommunityFitSamples = {
      hullTypeId,
      hull: hull.name,
      source: "zkillboard-recent-losses",
      fetchedAt: new Date().toISOString(),
      windowDays: 7,
      sampleCount: 0,
      confidence: "none",
      status: "error",
      note: error instanceof Error ? error.message : "Recent-fit lookup failed.",
      samples: [],
    };
    await writeCache(samplesCachePath(hullTypeId), failed, EMPTY_CACHE_TTL_MS).catch(() => undefined);
    return failed;
  }
}

export async function getCommunityFitProfile(
  hullTypeId: number,
  force = false,
): Promise<CommunityFitProfile> {
  if (!force) {
    const cached = await readCache<CommunityFitProfile>(profileCachePath(hullTypeId));
    if (cached) return cached;
  }
  const samples = await getRecentHullFitSamples(hullTypeId, force);
  const presence = new Map<number, { count: number; name: string }>();
  for (const sample of samples.samples) {
    for (const item of sample.items) {
      const current = presence.get(item.typeId) ?? { count: 0, name: item.name };
      current.count += 1;
      presence.set(item.typeId, current);
    }
  }
  const ranked = [...presence.entries()]
    .sort((a, b) => b[1].count - a[1].count || a[0] - b[0])
    .filter(([, item], index) => samples.sampleCount > 0 && (item.count / samples.sampleCount >= 0.2 || index < 12))
    .slice(0, MAX_COMMON_ITEMS);
  const profile: CommunityFitProfile = {
    hullTypeId,
    hull: samples.hull,
    source: samples.source,
    fetchedAt: samples.fetchedAt,
    windowDays: samples.windowDays,
    sampleCount: samples.sampleCount,
    confidence: samples.confidence,
    status: samples.status,
    note: samples.note,
    items: ranked.map(([typeId, item]) => ({
      typeId,
      name: item.name,
      seenInFits: item.count,
      presencePercent: Math.round((item.count / Math.max(1, samples.sampleCount)) * 100),
    })),
  };
  await writeCache(
    profileCachePath(hullTypeId),
    profile,
    profile.status === "ready" ? CACHE_TTL_MS : EMPTY_CACHE_TTL_MS,
  );
  return profile;
}
