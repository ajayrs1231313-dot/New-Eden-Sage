import AdmZip from "adm-zip";
import fs from "node:fs/promises";
import path from "node:path";
import { logEvent } from "./logger";
import { STATIC_DATA_ROOT } from "./data-paths";

const STATIC_ROOT = STATIC_DATA_ROOT;
const SDE_ARCHIVE = path.join(STATIC_ROOT, "eve-static-data-jsonl.zip");
const VOLUME_CACHE = path.join(STATIC_ROOT, "item-volumes.json");
const SDE_URL =
  "https://developers.eveonline.com/static-data/eve-online-static-data-latest-jsonl.zip";
const REPACKAGED_URL =
  "https://sde.jita.space/latest/universe/repackagedVolumes";

type CacheFile = {
  volumes: Record<string, number>;
  resolvedOverrides: number[];
  categoryIds?: Record<string, number>;
};

let cachePromise: Promise<CacheFile> | undefined;
let shipsPromise: Promise<Array<{ typeId: number; name: string }>> | undefined;

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

export async function listPublishedShips() {
  if (!shipsPromise)
    shipsPromise = (async () => {
      const zip = new AdmZip(SDE_ARCHIVE);
      const typesEntry = zip.getEntry("types.jsonl");
      const groupsEntry = zip.getEntry("groups.jsonl");
      if (!typesEntry || !groupsEntry)
        throw new Error("Official EVE static data is missing ship types.");
      const shipGroups = new Set<number>();
      for (const line of groupsEntry.getData().toString("utf8").split(/\r?\n/)) {
        if (!line) continue;
        const group = JSON.parse(line) as { _key: number; categoryID: number };
        if (group.categoryID === 6) shipGroups.add(group._key);
      }
      const ships: Array<{ typeId: number; name: string }> = [];
      for (const line of typesEntry.getData().toString("utf8").split(/\r?\n/)) {
        if (!line) continue;
        const type = JSON.parse(line) as {
          _key: number;
          groupID: number;
          published?: boolean;
          name?: { en?: string };
        };
        if (type.published && shipGroups.has(type.groupID) && type.name?.en)
          ships.push({ typeId: type._key, name: type.name.en });
      }
      return ships.sort((a, b) => a.name.localeCompare(b.name));
    })();
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

async function loadCache() {
  if (!cachePromise) cachePromise = readOrBuildCache();
  return cachePromise;
}

async function readOrBuildCache(): Promise<CacheFile> {
  try {
    const cached = JSON.parse(
      await fs.readFile(VOLUME_CACHE, "utf8"),
    ) as CacheFile;
    if (cached.categoryIds) return cached;
    return addCategoryIds(cached);
  } catch {
    await fs.mkdir(STATIC_ROOT, { recursive: true });
    await downloadSde();
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
    await saveCache(cache);
    await logEvent("info", "static_data.item_volumes_built", {
      types: Object.keys(volumes).length,
    });
    return cache;
  }
}

async function addCategoryIds(cache: CacheFile) {
  try {
    await fs.access(SDE_ARCHIVE);
  } catch {
    await fs.mkdir(STATIC_ROOT, { recursive: true });
    await downloadSde();
  }
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

async function downloadSde() {
  const response = await fetch(SDE_URL);
  if (!response.ok)
    throw new Error(`CCP static-data download failed (${response.status}).`);
  await fs.writeFile(SDE_ARCHIVE, Buffer.from(await response.arrayBuffer()));
}

async function saveCache(cache: CacheFile) {
  await fs.mkdir(STATIC_ROOT, { recursive: true });
  await fs.writeFile(VOLUME_CACHE, JSON.stringify(cache), "utf8");
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: { "X-User-Agent": "NewEdenSage/0.1.0" },
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
