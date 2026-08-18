import AdmZip from "adm-zip";
import fs from "node:fs/promises";
import path from "node:path";
import { isMainThread, threadId, Worker } from "node:worker_threads";
import { logEvent } from "./logger";
import { STATIC_DATA_ROOT } from "./data-paths";

const STATIC_ROOT = STATIC_DATA_ROOT;
const SDE_ARCHIVE = path.join(STATIC_ROOT, "eve-static-data-jsonl.zip");
const SDE_STAGED_ARCHIVE = path.join(STATIC_ROOT, "eve-static-data-jsonl.next.zip");
const SDE_PARTIAL_ARCHIVE = path.join(STATIC_ROOT, "eve-static-data-jsonl.partial.zip");
const SDE_BACKUP_ARCHIVE = path.join(STATIC_ROOT, "eve-static-data-jsonl.previous.zip");
const SDE_UPDATE_STATE = path.join(STATIC_ROOT, "sde-update-state.json");
const SDE_PROMOTION_LOCK = path.join(STATIC_ROOT, "sde-promotion.lock");
const VOLUME_CACHE = path.join(STATIC_ROOT, "item-volumes.json");
const VOLUME_CACHE_LOCK = path.join(STATIC_ROOT, "item-volumes.lock");
export const FITTING_PREPARED_CACHE = path.join(STATIC_ROOT, "fitting-dogma-prepared-v1.json.gz");
export const FITTING_CATALOGUE_CACHE = path.join(STATIC_ROOT, "fitting-catalogue-prepared-v1.json.gz");
export const MARKET_STATIC_PREPARED_CACHE = path.join(STATIC_ROOT, "market-static-prepared-v1.json.gz");
export const INDUSTRIAL_PREPARED_CACHE = path.join(STATIC_ROOT, "industrial-blueprint-index-v1.json.gz");
const SDE_URL =
  "https://developers.eveonline.com/static-data/eve-online-static-data-latest-jsonl.zip";
const REPACKAGED_URL =
  "https://sde.jita.space/latest/universe/repackagedVolumes";

type CacheFile = {
  volumes: Record<string, number>;
  resolvedOverrides: number[];
  categoryIds?: Record<string, number>;
};

type ProcessStaticState = { promoted: boolean; hasArchive: boolean };

let cachePromise: Promise<CacheFile> | undefined;
let shipsPromise: Promise<Array<{ typeId: number; name: string }>> | undefined;
let processStaticPromise: Promise<ProcessStaticState> | undefined;
let refreshPromise: Promise<unknown> | undefined;

const CATEGORY_NAMES: Record<number, string> = {
  6: "Ships",
  7: "Modules",
  8: "Charges & ammunition",
  9: "Blueprints",
  16: "Skills",
  18: "Drones",
  20: "Implants & boosters",
  22: "Deployables",
  25: "Asteroids & ore",
  32: "Subsystems",
  34: "Ancient relics",
  35: "Decryptors",
  41: "Planetary interaction",
  42: "Planetary resources",
  43: "Planetary commodities",
  65: "Structures",
  66: "Structure modules",
  87: "Fighters",
};

export function itemCategoryName(categoryId: number) {
  return CATEGORY_NAMES[categoryId] ?? "Other";
}

async function exists(target: string) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function validateStaticArchive(target: string) {
  const zip = new AdmZip(target);
  const entries = new Set(zip.getEntries().map((entry) => entry.entryName));
  const required = [
    "types.jsonl",
    "groups.jsonl",
    "typeDogma.jsonl",
    "dogmaEffects.jsonl",
    "dogmaAttributes.jsonl",
    "marketGroups.jsonl",
  ];
  const missing = required.filter((entry) => !entries.has(entry));
  if (missing.length)
    throw new Error(`CCP static data is missing ${missing.join(", ")}.`);
  if (!zip.test()) throw new Error("CCP static-data ZIP failed its integrity check.");
}

async function invalidateStaticDerivedCaches() {
  cachePromise = undefined;
  shipsPromise = undefined;
  await Promise.all([
    fs.rm(VOLUME_CACHE, { force: true }).catch(() => undefined),
    fs.rm(FITTING_PREPARED_CACHE, { force: true }).catch(() => undefined),
    fs.rm(FITTING_CATALOGUE_CACHE, { force: true }).catch(() => undefined),
    fs.rm(MARKET_STATIC_PREPARED_CACHE, { force: true }).catch(() => undefined),
    fs.rm(INDUSTRIAL_PREPARED_CACHE, { force: true }).catch(() => undefined),
  ]);
}

async function withSdePromotionLock<T>(work: () => Promise<T>): Promise<T> {
  const deadline = Date.now() + 120_000;
  while (true) {
    try {
      const handle = await fs.open(SDE_PROMOTION_LOCK, "wx");
      try {
        return await work();
      } finally {
        await handle.close().catch(() => undefined);
        await fs.rm(SDE_PROMOTION_LOCK, { force: true }).catch(() => undefined);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        const stat = await fs.stat(SDE_PROMOTION_LOCK);
        if (Date.now() - stat.mtimeMs > 120_000) {
          await fs.rm(SDE_PROMOTION_LOCK, { force: true }).catch(() => undefined);
          continue;
        }
      } catch {
        continue;
      }
      if (Date.now() >= deadline)
        throw new Error("Timed out waiting for the static-data promotion lock.");
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}

async function promoteStagedArchive() {
  return withSdePromotionLock(async () => {
    if (!(await exists(SDE_STAGED_ARCHIVE))) return false;
    const stagedStat = await fs.stat(SDE_STAGED_ARCHIVE);
    if (stagedStat.size < 1024 * 1024) throw new Error("Staged CCP static-data archive is unexpectedly small.");
    const hadActive = await exists(SDE_ARCHIVE);
    await fs.rm(SDE_BACKUP_ARCHIVE, { force: true }).catch(() => undefined);
    try {
      if (hadActive) await fs.rename(SDE_ARCHIVE, SDE_BACKUP_ARCHIVE);
      await fs.rename(SDE_STAGED_ARCHIVE, SDE_ARCHIVE);
      await invalidateStaticDerivedCaches();
      await fs.rm(SDE_BACKUP_ARCHIVE, { force: true }).catch(() => undefined);
      await logEvent("info", "static_data.sde_promoted", { archive: SDE_ARCHIVE });
      return true;
    } catch (error) {
      await fs.rm(SDE_ARCHIVE, { force: true }).catch(() => undefined);
      if (hadActive && (await exists(SDE_BACKUP_ARCHIVE)))
        await fs.rename(SDE_BACKUP_ARCHIVE, SDE_ARCHIVE).catch(() => undefined);
      throw error;
    }
  });
}

/**
 * Establishes one coherent static-data generation for this Sage process.
 * A staged CCP update is promoted before any consumer opens the active archive;
 * after this promise resolves the active archive is never swapped underneath the app.
 */
export async function prepareStaticDataForProcess(): Promise<ProcessStaticState> {
  return (processStaticPromise ??= Promise.resolve().then(async () => {
    await fs.mkdir(STATIC_ROOT, { recursive: true });
    let promoted = false;
    if (isMainThread) {
      try {
        promoted = await promoteStagedArchive();
      } catch (error) {
        await logEvent("error", "static_data.sde_promotion_failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return { promoted, hasArchive: await exists(SDE_ARCHIVE) };
  }));
}

/**
 * Quietly checks CCP for a newer SDE. Downloads and validates in a worker,
 * then leaves the new archive staged for the next Sage process. The current
 * process keeps its last-good generation, preventing cross-tab mixed data.
 */
export async function stageStaticDataRefreshLowImpact(force = false, aggressive = false) {
  if (refreshPromise) return refreshPromise;
  refreshPromise = new Promise((resolve, reject) => {
    void fs.mkdir(STATIC_ROOT, { recursive: true }).then(() => {
      const worker = new Worker(path.join(__dirname, "static-data-update-worker.js"), {
        workerData: {
          staticRoot: STATIC_ROOT,
          activeArchive: SDE_ARCHIVE,
          stagedArchive: SDE_STAGED_ARCHIVE,
          partialArchive: SDE_PARTIAL_ARCHIVE + "." + process.pid,
          statePath: SDE_UPDATE_STATE,
          force,
          aggressive,
        },
      });
      let settled = false;
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        callback();
      };
      worker.once("message", (message: { ok: boolean; result?: unknown; error?: string }) => {
        finish(() => {
          if (message.ok) resolve(message.result);
          else reject(new Error(message.error ?? "Static-data refresh failed."));
        });
      });
      worker.once("error", (error) => finish(() => reject(error)));
      worker.once("exit", (code) => {
        if (code !== 0) finish(() => reject(new Error(`Static-data refresh worker stopped (${code}).`)));
      });
    }, reject);
  }).finally(() => {
    refreshPromise = undefined;
  });
  return refreshPromise;
}

export async function listPublishedShips() {
  if (!shipsPromise)
    shipsPromise = ensureStaticDataArchive().then(() => new Promise<Array<{ typeId: number; name: string }>>((resolve, reject) => {
      const worker = new Worker(path.join(__dirname, "ship-index-worker.js"), {
        workerData: { archive: SDE_ARCHIVE },
      });
      worker.once("message", (message: { ships?: Array<{ typeId: number; name: string }>; error?: string }) => {
        if (message.error) reject(new Error(message.error));
        else resolve(message.ships ?? []);
      });
      worker.once("error", reject);
      worker.once("exit", (code) => {
        if (code !== 0) reject(new Error(`Ship catalogue worker stopped (${code}).`));
      });
    }));
  return shipsPromise;
}

export async function itemVolumes(typeIds: number[]) {
  const cache = await loadCache();
  const requested = [...new Set(typeIds)];
  const overrideIds = await fetchJson<number[]>(REPACKAGED_URL).catch(() => []);
  const overrideSet = new Set(overrideIds);
  const resolved = new Set(cache.resolvedOverrides);
  const missingOverrides = requested.filter(
    (typeId) => overrideSet.has(typeId) && !resolved.has(typeId),
  );
  if (missingOverrides.length) {
    const values = await mapLimited(missingOverrides, 20, async (typeId) => {
      try {
        const volume = await fetchJson<number>(`${REPACKAGED_URL}/${typeId}`);
        return { typeId, volume: Number(volume) };
      } catch {
        return { typeId, volume: cache.volumes[String(typeId)] ?? 0 };
      }
    });
    for (const value of values) {
      cache.volumes[String(value.typeId)] = value.volume;
      resolved.add(value.typeId);
    }
    cache.resolvedOverrides = [...resolved];
    await saveCache(cache);
  }
  return new Map(
    requested.map((typeId) => [
      typeId,
      Number(cache.volumes[String(typeId)] ?? 0),
    ]),
  );
}

export async function itemCategoryIds(typeIds: number[]) {
  const cache = await loadCache();
  return new Map(
    [...new Set(typeIds)].map((typeId) => [
      typeId,
      Number(cache.categoryIds?.[String(typeId)] ?? 0),
    ]),
  );
}

async function withVolumeCacheLock<T>(work: () => Promise<T>): Promise<T> {
  const deadline = Date.now() + 120_000;
  while (true) {
    try {
      const handle = await fs.open(VOLUME_CACHE_LOCK, "wx");
      try {
        return await work();
      } finally {
        await handle.close().catch(() => undefined);
        await fs.rm(VOLUME_CACHE_LOCK, { force: true }).catch(() => undefined);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        const stat = await fs.stat(VOLUME_CACHE_LOCK);
        if (Date.now() - stat.mtimeMs > 120_000) {
          await fs.rm(VOLUME_CACHE_LOCK, { force: true }).catch(() => undefined);
          continue;
        }
      } catch {
        continue;
      }
      if (Date.now() >= deadline)
        throw new Error("Timed out waiting for the shared item-volume cache lock.");
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}

async function loadCache() {
  if (!cachePromise) {
    cachePromise = (async () => {
      try {
        const cached = JSON.parse(await fs.readFile(VOLUME_CACHE, "utf8")) as CacheFile;
        if (cached.categoryIds) return cached;
      } catch {
        // Missing/incomplete cache: one worker will rebuild it below.
      }
      return withVolumeCacheLock(async () => {
        try {
          const cached = JSON.parse(await fs.readFile(VOLUME_CACHE, "utf8")) as CacheFile;
          if (cached.categoryIds) return cached;
        } catch {
          // Still missing after taking the lock: build it now.
        }
        return readOrBuildCache();
      });
    })().catch((error) => {
      cachePromise = undefined;
      throw error;
    });
  }
  return cachePromise;
}

async function readOrBuildCache(): Promise<CacheFile> {
  await prepareStaticDataForProcess();
  try {
    const cached = JSON.parse(
      await fs.readFile(VOLUME_CACHE, "utf8"),
    ) as CacheFile;
    if (cached.categoryIds) return cached;
    return addCategoryIds(cached);
  } catch {
    await fs.mkdir(STATIC_ROOT, { recursive: true });
    await ensureStaticDataArchive();
    const zip = new AdmZip(SDE_ARCHIVE);
    const entry = zip.getEntry("types.jsonl");
    if (!entry)
      throw new Error("CCP SDE archive does not contain types.jsonl.");
    const volumes: Record<string, number> = {};
    for (const line of entry.getData().toString("utf8").split(/\r?\n/)) {
      if (!line) continue;
      const type = JSON.parse(line) as { _key: number; volume?: number };
      if (typeof type.volume === "number")
        volumes[String(type._key)] = type.volume;
    }
    const cache = await addCategoryIds({ volumes, resolvedOverrides: [] });
    await logEvent("info", "static_data.item_volumes_built", {
      types: Object.keys(volumes).length,
    });
    return cache;
  }
}

async function addCategoryIds(cache: CacheFile) {
  await ensureStaticDataArchive();
  const zip = new AdmZip(SDE_ARCHIVE);
  const typesEntry = zip.getEntry("types.jsonl");
  const groupsEntry = zip.getEntry("groups.jsonl");
  if (!typesEntry || !groupsEntry)
    throw new Error("CCP SDE archive is missing type category data.");
  const groupCategories = new Map<number, number>();
  for (const line of groupsEntry.getData().toString("utf8").split(/\r?\n/)) {
    if (!line) continue;
    const group = JSON.parse(line) as { _key: number; categoryID: number };
    groupCategories.set(group._key, group.categoryID);
  }
  const categoryIds: Record<string, number> = {};
  for (const line of typesEntry.getData().toString("utf8").split(/\r?\n/)) {
    if (!line) continue;
    const type = JSON.parse(line) as { _key: number; groupID: number };
    categoryIds[String(type._key)] = groupCategories.get(type.groupID) ?? 0;
  }
  cache.categoryIds = categoryIds;
  await saveCache(cache);
  return cache;
}

export async function ensureStaticDataArchive() {
  await prepareStaticDataForProcess();
  if (!(await exists(SDE_ARCHIVE))) {
    await fs.mkdir(STATIC_ROOT, { recursive: true });
    await stageStaticDataRefreshLowImpact(true);
    if (await exists(SDE_STAGED_ARCHIVE)) await promoteStagedArchive();
  }
  if (!(await exists(SDE_ARCHIVE))) throw new Error("No validated CCP static-data archive is available yet.");
  return SDE_ARCHIVE;
}

async function saveCache(cache: CacheFile) {
  await fs.mkdir(STATIC_ROOT, { recursive: true });
  const partial = `${VOLUME_CACHE}.${process.pid}.${threadId}.${Date.now()}.${Math.random().toString(16).slice(2)}.partial`;
  await fs.writeFile(partial, JSON.stringify(cache), "utf8");
  await fs.rm(VOLUME_CACHE, { force: true }).catch(() => undefined);
  await fs.rename(partial, VOLUME_CACHE);
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: { "X-User-Agent": "NewEdenSage/1.0.1" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok)
    throw new Error(`Static-data request failed (${response.status}).`);
  return response.json() as Promise<T>;
}

async function mapLimited<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T) => Promise<R>,
) {
  const results = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor++;
        results[index] = await mapper(items[index]);
      }
    }),
  );
  return results;
}
