import AdmZip from "adm-zip";
import { promises as fs } from "node:fs";
import path from "node:path";
import { gzip, gunzip } from "node:zlib";
import { promisify } from "node:util";
import { STATIC_DATA_ROOT } from "./data-paths";
import { ensureStaticDataArchive, itemCategoryName, MARKET_STATIC_PREPARED_CACHE, prepareStaticDataForProcess } from "./type-volumes";

const SDE_ARCHIVE = path.join(STATIC_DATA_ROOT, "eve-static-data-jsonl.zip");
const WORKER_LOOKUP_FILE = path.join(STATIC_DATA_ROOT, "market-worker-lookups-v1.json.gz");
const MARKET_STATIC_PREPARED_NAME = "market-static-prepared-v1.json.gz";
const MARKET_STATIC_PREPARED_SCHEMA = 1;
const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

export type MarketTypeEntry = {
  typeId: number;
  name: string;
  categoryId: number;
  categoryName: string;
  groupId: number;
  groupName: string;
  marketGroupId: number | null;
  marketGroupName: string;
  marketGroupAncestors: number[];
  marketGroupPath: string[];
  marketGroupPathLabel: string;
  volumeM3: number;
};

export type MarketSystemEntry = {
  systemId: number;
  name: string;
  regionId: number;
  securityStatus: number;
  securityBand: "high" | "low" | "null";
};

export type MarketTaxonomy = {
  categories: Array<{ id: number; name: string; typeCount: number }>;
  groups: Array<{ id: number; name: string; categoryId: number; categoryName: string; typeCount: number }>;
  marketGroups: Array<{ id: number; name: string; parentId: number | null; path: string[]; pathLabel: string; typeCount: number }>;
};

type MarketStaticIndex = {
  types: MarketTypeEntry[];
  typeById: Map<number, MarketTypeEntry>;
  systemById: Map<number, MarketSystemEntry>;
  taxonomy: MarketTaxonomy;
};

type SdeMarketGroup = {
  id: number;
  name: string;
  parentId: number | null;
};

let indexPromise: Promise<MarketStaticIndex> | undefined;

type SerializedMarketStaticIndex = {
  schema: number;
  generatedAt: string;
  types: MarketTypeEntry[];
  systems: MarketSystemEntry[];
  taxonomy: MarketTaxonomy;
};

function preparedCandidates(includeBundled: boolean) {
  const candidates = [MARKET_STATIC_PREPARED_CACHE];
  if (includeBundled) {
    const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
    if (resourcesPath) candidates.push(path.join(resourcesPath, "market-data", MARKET_STATIC_PREPARED_NAME));
    candidates.push(path.join(process.cwd(), "vendor", "market-data", MARKET_STATIC_PREPARED_NAME));
  }
  return [...new Set(candidates)];
}

async function readPreparedIndex(target: string): Promise<MarketStaticIndex | undefined> {
  try {
    const decoded = JSON.parse((await gunzipAsync(await fs.readFile(target))).toString("utf8")) as SerializedMarketStaticIndex;
    if (decoded.schema !== MARKET_STATIC_PREPARED_SCHEMA || !Array.isArray(decoded.types) || !Array.isArray(decoded.systems) || !decoded.taxonomy)
      return undefined;
    return {
      types: decoded.types,
      typeById: new Map(decoded.types.map((type) => [type.typeId, type])),
      systemById: new Map(decoded.systems.map((system) => [system.systemId, system])),
      taxonomy: decoded.taxonomy,
    };
  } catch {
    return undefined;
  }
}

async function loadPreparedIndex(includeBundled: boolean) {
  for (const candidate of preparedCandidates(includeBundled)) {
    const index = await readPreparedIndex(candidate);
    if (index) return index;
  }
  return undefined;
}

async function savePreparedIndex(index: MarketStaticIndex) {
  await fs.mkdir(path.dirname(MARKET_STATIC_PREPARED_CACHE), { recursive: true });
  const partial = `${MARKET_STATIC_PREPARED_CACHE}.${process.pid}.partial`;
  const payload: SerializedMarketStaticIndex = {
    schema: MARKET_STATIC_PREPARED_SCHEMA,
    generatedAt: new Date().toISOString(),
    types: index.types,
    systems: [...index.systemById.values()],
    taxonomy: index.taxonomy,
  };
  await fs.writeFile(partial, await gzipAsync(Buffer.from(JSON.stringify(payload), "utf8"), { level: 6 }));
  await fs.rm(MARKET_STATIC_PREPARED_CACHE, { force: true }).catch(() => undefined);
  await fs.rename(partial, MARKET_STATIC_PREPARED_CACHE);
}

function securityBand(value: number): MarketSystemEntry["securityBand"] {
  if (value >= 0.45) return "high";
  if (value > 0) return "low";
  return "null";
}

function pathForMarketGroup(
  marketGroupId: number | null,
  marketGroups: Map<number, SdeMarketGroup>,
) {
  if (marketGroupId == null) return { ids: [] as number[], names: [] as string[] };
  const ids: number[] = [];
  const names: string[] = [];
  const seen = new Set<number>();
  let cursor: number | null = marketGroupId;
  while (cursor != null && !seen.has(cursor) && ids.length < 20) {
    seen.add(cursor);
    const group = marketGroups.get(cursor);
    if (!group) break;
    ids.push(group.id);
    names.push(group.name);
    cursor = group.parentId;
  }
  ids.reverse();
  names.reverse();
  return { ids, names };
}

async function loadMarketStaticIndex(): Promise<MarketStaticIndex> {
  if (indexPromise) return indexPromise;
  indexPromise = (async () => {
    const processState = await prepareStaticDataForProcess();
    // A bundled snapshot is only a first-install fallback. Once Sage has an
    // active CCP archive, only its matching local snapshot may be reused.
    const prepared = await loadPreparedIndex(!processState.hasArchive && !processState.promoted);
    if (prepared) return prepared;
    await ensureStaticDataArchive();
    const zip = new AdmZip(SDE_ARCHIVE);
    const typesEntry = zip.getEntry("types.jsonl");
    const groupsEntry = zip.getEntry("groups.jsonl");
    const categoriesEntry = zip.getEntry("categories.jsonl");
    const marketGroupsEntry = zip.getEntry("marketGroups.jsonl");
    const systemsEntry = zip.getEntry("mapSolarSystems.jsonl");
    if (!typesEntry || !groupsEntry || !systemsEntry)
      throw new Error("Official EVE static data is missing market lookup data.");

    const categoryNames = new Map<number, string>();
    if (categoriesEntry) {
      for (const line of categoriesEntry.getData().toString("utf8").split(/\r?\n/)) {
        if (!line) continue;
        const category = JSON.parse(line) as { _key: number; name?: { en?: string } };
        if (category.name?.en) categoryNames.set(category._key, category.name.en);
      }
    }

    const groupById = new Map<number, { categoryId: number; name: string }>();
    for (const line of groupsEntry.getData().toString("utf8").split(/\r?\n/)) {
      if (!line) continue;
      const group = JSON.parse(line) as { _key: number; categoryID: number; name?: { en?: string } };
      groupById.set(group._key, {
        categoryId: group.categoryID,
        name: group.name?.en ?? `Group ${group._key}`,
      });
    }

    const marketGroups = new Map<number, SdeMarketGroup>();
    if (marketGroupsEntry) {
      for (const line of marketGroupsEntry.getData().toString("utf8").split(/\r?\n/)) {
        if (!line) continue;
        const group = JSON.parse(line) as {
          _key: number;
          name?: { en?: string };
          parentGroupID?: number;
        };
        marketGroups.set(group._key, {
          id: group._key,
          name: group.name?.en ?? `Market group ${group._key}`,
          parentId: Number.isFinite(group.parentGroupID) ? Number(group.parentGroupID) : null,
        });
      }
    }

    const types: MarketTypeEntry[] = [];
    const typeById = new Map<number, MarketTypeEntry>();
    for (const line of typesEntry.getData().toString("utf8").split(/\r?\n/)) {
      if (!line) continue;
      const type = JSON.parse(line) as {
        _key: number;
        groupID: number;
        marketGroupID?: number;
        published?: boolean;
        name?: { en?: string };
        volume?: number;
      };
      if (!type.published || !type.name?.en) continue;
      const group = groupById.get(type.groupID);
      const categoryId = group?.categoryId ?? 0;
      const marketGroupId = Number.isFinite(type.marketGroupID) ? Number(type.marketGroupID) : null;
      const marketPath = pathForMarketGroup(marketGroupId, marketGroups);
      const value: MarketTypeEntry = {
        typeId: type._key,
        name: type.name.en,
        categoryId,
        categoryName: categoryNames.get(categoryId) ?? itemCategoryName(categoryId),
        groupId: type.groupID,
        groupName: group?.name ?? `Group ${type.groupID}`,
        marketGroupId,
        marketGroupName:
          marketGroupId == null ? "Unclassified" : (marketGroups.get(marketGroupId)?.name ?? `Market group ${marketGroupId}`),
        marketGroupAncestors: marketPath.ids,
        marketGroupPath: marketPath.names,
        marketGroupPathLabel: marketPath.names.join(" › ") || "Unclassified",
        volumeM3: Number(type.volume ?? 0),
      };
      types.push(value);
      typeById.set(value.typeId, value);
    }
    types.sort((a, b) => a.name.localeCompare(b.name));

    const categoryCounts = new Map<number, { name: string; count: number }>();
    const groupCounts = new Map<number, { name: string; categoryId: number; categoryName: string; count: number }>();
    const marketGroupCounts = new Map<number, number>();
    for (const type of types) {
      const category = categoryCounts.get(type.categoryId) ?? { name: type.categoryName, count: 0 };
      category.count += 1;
      categoryCounts.set(type.categoryId, category);
      const group = groupCounts.get(type.groupId) ?? {
        name: type.groupName,
        categoryId: type.categoryId,
        categoryName: type.categoryName,
        count: 0,
      };
      group.count += 1;
      groupCounts.set(type.groupId, group);
      for (const id of type.marketGroupAncestors)
        marketGroupCounts.set(id, (marketGroupCounts.get(id) ?? 0) + 1);
    }

    const taxonomy: MarketTaxonomy = {
      categories: [...categoryCounts.entries()]
        .map(([id, value]) => ({ id, name: value.name, typeCount: value.count }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      groups: [...groupCounts.entries()]
        .map(([id, value]) => ({
          id,
          name: value.name,
          categoryId: value.categoryId,
          categoryName: value.categoryName,
          typeCount: value.count,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      marketGroups: [...marketGroups.values()]
        .filter((group) => (marketGroupCounts.get(group.id) ?? 0) > 0)
        .map((group) => {
          const marketPath = pathForMarketGroup(group.id, marketGroups);
          return {
            id: group.id,
            name: group.name,
            parentId: group.parentId,
            path: marketPath.names,
            pathLabel: marketPath.names.join(" › "),
            typeCount: marketGroupCounts.get(group.id) ?? 0,
          };
        })
        .sort((a, b) => a.pathLabel.localeCompare(b.pathLabel)),
    };

    const systemById = new Map<number, MarketSystemEntry>();
    for (const line of systemsEntry.getData().toString("utf8").split(/\r?\n/)) {
      if (!line) continue;
      const system = JSON.parse(line) as {
        _key: number;
        name?: { en?: string };
        regionID: number;
        securityStatus: number;
      };
      if (!system.name?.en) continue;
      systemById.set(system._key, {
        systemId: system._key,
        name: system.name.en,
        regionId: system.regionID,
        securityStatus: system.securityStatus,
        securityBand: securityBand(system.securityStatus),
      });
    }
    const index = { types, typeById, systemById, taxonomy };
    await savePreparedIndex(index);
    return index;
  })();
  return indexPromise;
}

export async function searchMarketTypes(query: string, limit = 50) {
  const index = await loadMarketStaticIndex();
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  return index.types
    .filter((type) =>
      `${type.name} ${type.groupName} ${type.marketGroupPathLabel} ${type.categoryName}`
        .toLowerCase()
        .includes(needle),
    )
    .sort((a, b) => {
      const aa = a.name.toLowerCase();
      const bb = b.name.toLowerCase();
      const aExact = aa === needle ? 0 : aa.startsWith(needle) ? 1 : 2;
      const bExact = bb === needle ? 0 : bb.startsWith(needle) ? 1 : 2;
      return aExact - bExact || a.name.length - b.name.length || a.name.localeCompare(b.name);
    })
    .slice(0, Math.max(1, Math.min(200, limit)));
}

export async function getMarketTypeIndex() {
  return (await loadMarketStaticIndex()).typeById;
}

/** A compact shared lookup file so market shards never unpack the SDE archive. */
export async function prepareMarketWorkerLookups() {
  const index = await loadMarketStaticIndex();
  const payload = {
    types: index.types,
    systems: [...index.systemById.values()],
  };
  await fs.mkdir(STATIC_DATA_ROOT, { recursive: true });
  const partial = `${WORKER_LOOKUP_FILE}.${process.pid}.partial`;
  await fs.writeFile(partial, await gzipAsync(Buffer.from(JSON.stringify(payload), "utf8"), { level: 1 }));
  await fs.rm(WORKER_LOOKUP_FILE, { force: true }).catch(() => undefined);
  await fs.rename(partial, WORKER_LOOKUP_FILE);
  return WORKER_LOOKUP_FILE;
}

/** Creates the complete immutable market-static snapshot included with an app build. */
export async function copyPreparedMarketStaticBundle(destination: string) {
  await loadMarketStaticIndex();
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.copyFile(MARKET_STATIC_PREPARED_CACHE, destination);
  return destination;
}

export async function loadMarketWorkerLookups(file: string) {
  const payload = JSON.parse((await gunzipAsync(await fs.readFile(file))).toString("utf8")) as {
    types: MarketTypeEntry[];
    systems: MarketSystemEntry[];
  };
  return {
    types: new Map(payload.types.map((type) => [type.typeId, type])),
    systems: new Map(payload.systems.map((system) => [system.systemId, system])),
  };
}

export async function getMarketType(typeId: number) {
  return (await loadMarketStaticIndex()).typeById.get(typeId) ?? null;
}

export async function getMarketTaxonomy() {
  return (await loadMarketStaticIndex()).taxonomy;
}

export async function getMarketSystem(systemId: number) {
  return (await loadMarketStaticIndex()).systemById.get(systemId) ?? null;
}

export async function getMarketSystemIndex() {
  return (await loadMarketStaticIndex()).systemById;
}
