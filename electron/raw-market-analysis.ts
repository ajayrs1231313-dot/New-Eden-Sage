import { loadLatestMarketDatasetByMode } from "./market-storage";
import { promises as fs } from "node:fs";
import path from "node:path";
import { gzip, gunzip } from "node:zlib";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import {
  loadCurrentRawMarketManifest,
  loadRawMarketRegion,
  RAW_MARKET_ROOT,
  type RawMarketSnapshot,
} from "./raw-market-storage";
import { getMarketSystemIndex, getMarketTypeIndex } from "./market-static-index";
import type { MarketOrder } from "./market";

export type FullMarketOrder = {
  orderId: number;
  typeId: number;
  price: number;
  volumeRemain: number;
  volumeTotal: number;
  minVolume: number;
  range: string;
  issued: string;
  durationDays: number;
  regionId: number;
  regionName: string;
  systemId: number;
  systemName: string;
  securityStatus: number;
  securityBand: "high" | "low" | "null";
  locationId: number;
  locationName: string;
};

export type FullMarketSecurityBand = "high" | "low" | "null";

export type FullMarketBandMetrics = {
  buyOrders: number;
  sellOrders: number;
  buyVolume: number;
  sellVolume: number;
  bestBuy: number | null;
  bestBuySystemId: number | null;
  bestBuySystemName: string | null;
  bestBuyVolume: number;
  bestSell: number | null;
  bestSellSystemId: number | null;
  bestSellSystemName: string | null;
  bestSellVolume: number;
};

export type FullMarketRegionMetrics = FullMarketBandMetrics & {
  regionId: number;
  regionName: string;
  security?: Record<FullMarketSecurityBand, FullMarketBandMetrics>;
};

export type FullMarketItem = {
  typeId: number;
  typeName: string;
  categoryId: number;
  categoryName: string;
  itemVolumeM3: number;
  totalBuyOrders: number;
  totalSellOrders: number;
  totalBuyVolume: number;
  totalSellVolume: number;
  buys: FullMarketOrder[];
  sells: FullMarketOrder[];
  regions: Record<string, FullMarketRegionMetrics>;
};

export type RawMarketAnalysisRuntime = {
  progress?: (progress: { stage: string; message: string; completed?: number; total?: number; percent?: number; cached?: boolean }) => void;
  shouldCancel?: () => boolean;
};

export type FullMarketAnalysisIndex = {
  snapshotId: string;
  createdAt: string;
  orderCount: number;
  regionCount: number;
  sourceOrdersInspected: number;
  candidateDepthPerSide: number;
  items: Map<number, FullMarketItem>;
};

// Keeping 64 buy and 64 sell orders for every type retained millions of
// JavaScript objects in a live worker. Sixteen strongest executable orders on
// each side still gives trade ranking ample depth while keeping the full index
// safely within desktop memory limits.
const SIDE_DEPTH = 16;
const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);
const ANALYSIS_INDEX_SCHEMA = 3;
let currentCache: { snapshotId: string; value: FullMarketAnalysisIndex } | null = null;
const historicalCache = new Map<string, FullMarketAnalysisIndex>();
let metadataCache: { createdAt: string; names: Map<number, string>; volumes: Map<number, number> } | null = null;

function persistedIndexPath(snapshot: RawMarketSnapshot) {
  return path.join(RAW_MARKET_ROOT, snapshot.id, "analysis-index-v2.json.gz");
}

async function loadPersistedAnalysisIndex(snapshot: RawMarketSnapshot): Promise<FullMarketAnalysisIndex | null> {
  try {
    const compressed = await fs.readFile(persistedIndexPath(snapshot));
    const payload = JSON.parse((await gunzipAsync(compressed)).toString("utf8")) as {
      schemaVersion: number; snapshotId: string; createdAt: string; orderCount: number; regionCount: number; sourceOrdersInspected: number; candidateDepthPerSide: number; items: FullMarketItem[];
    };
    if (payload.schemaVersion !== ANALYSIS_INDEX_SCHEMA || payload.snapshotId !== snapshot.id || payload.orderCount !== snapshot.orderCount || payload.candidateDepthPerSide !== SIDE_DEPTH) return null;
    return {
      snapshotId: payload.snapshotId, createdAt: payload.createdAt, orderCount: payload.orderCount, regionCount: payload.regionCount, sourceOrdersInspected: payload.sourceOrdersInspected, candidateDepthPerSide: payload.candidateDepthPerSide, items: new Map(payload.items.map((item) => [item.typeId, item])),
    };
  } catch {
    return null;
  }
}

async function savePersistedAnalysisIndex(snapshot: RawMarketSnapshot, value: FullMarketAnalysisIndex) {
  const target = persistedIndexPath(snapshot);
  const partial = `${target}.${process.pid}.${randomUUID()}.partial`;
  const payload = {
    schemaVersion: ANALYSIS_INDEX_SCHEMA,
    snapshotId: value.snapshotId,
    createdAt: value.createdAt,
    orderCount: value.orderCount,
    regionCount: value.regionCount,
    sourceOrdersInspected: value.sourceOrdersInspected,
    candidateDepthPerSide: value.candidateDepthPerSide,
    items: [...value.items.values()].map((item) => ({
      ...item,
      regions: Object.fromEntries(Object.entries(item.regions).map(([key, region]) => {
        const { security: _security, ...persistedRegion } = region;
        return [key, persistedRegion];
      })),
    })),
  };
  const compressed = await gzipAsync(Buffer.from(JSON.stringify(payload), "utf8"), { level: 6 });
  await fs.writeFile(partial, compressed);
  await fs.rename(partial, target);
}

async function retainedMarketMetadata() {
  const data = await loadLatestMarketDatasetByMode("all");
  if (!data) return { names: new Map<number, string>(), volumes: new Map<number, number>() };
  if (metadataCache?.createdAt === data.createdAt) return metadataCache;
  const names = new Map<number, string>();
  const volumes = new Map<number, number>();
  for (const region of data.summaries as Array<{
    items?: Array<{
      typeId: number;
      itemVolumeM3?: number;
      topBuyOrders?: Array<{ locationId: number; locationName: string }>;
      topSellOrders?: Array<{ locationId: number; locationName: string }>;
    }>;
  }>)
    for (const item of region.items ?? []) {
      if (typeof item.itemVolumeM3 === "number" && item.itemVolumeM3 >= 0)
        volumes.set(item.typeId, item.itemVolumeM3);
      for (const order of [...(item.topBuyOrders ?? []), ...(item.topSellOrders ?? [])])
        if (order.locationName) names.set(order.locationId, order.locationName);
    }
  metadataCache = { createdAt: data.createdAt, names, volumes };
  return metadataCache;
}

function insertCandidate(list: FullMarketOrder[], order: FullMarketOrder, buy: boolean) {
  const compare = (left: FullMarketOrder, right: FullMarketOrder) =>
    buy
      ? right.price - left.price || right.volumeRemain - left.volumeRemain
      : left.price - right.price || right.volumeRemain - left.volumeRemain;
  let low = 0;
  let high = list.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (compare(order, list[middle]) < 0) high = middle;
    else low = middle + 1;
  }
  if (list.length >= SIDE_DEPTH && low >= SIDE_DEPTH) return;
  list.splice(low, 0, order);
  if (list.length > SIDE_DEPTH) list.pop();
}

function emptyBandMetrics(): FullMarketBandMetrics {
  return {
    buyOrders: 0, sellOrders: 0, buyVolume: 0, sellVolume: 0,
    bestBuy: null, bestBuySystemId: null, bestBuySystemName: null, bestBuyVolume: 0,
    bestSell: null, bestSellSystemId: null, bestSellSystemName: null, bestSellVolume: 0,
  };
}

function recordRegionalOrder(metrics: FullMarketBandMetrics, raw: MarketOrder, order: FullMarketOrder) {
  if (raw.is_buy_order) {
    metrics.buyOrders += 1;
    metrics.buyVolume += raw.volume_remain;
    if (metrics.bestBuy == null || raw.price > metrics.bestBuy) {
      metrics.bestBuy = raw.price;
      metrics.bestBuySystemId = order.systemId;
      metrics.bestBuySystemName = order.systemName;
      metrics.bestBuyVolume = raw.volume_remain;
    }
  } else {
    metrics.sellOrders += 1;
    metrics.sellVolume += raw.volume_remain;
    if (metrics.bestSell == null || raw.price < metrics.bestSell) {
      metrics.bestSell = raw.price;
      metrics.bestSellSystemId = order.systemId;
      metrics.bestSellSystemName = order.systemName;
      metrics.bestSellVolume = raw.volume_remain;
    }
  }
}

function convertOrder(
  raw: MarketOrder,
  regionId: number,
  regionName: string,
  systems: Awaited<ReturnType<typeof getMarketSystemIndex>>,
  locations: Map<number, string>,
): FullMarketOrder {
  const system = systems.get(raw.system_id);
  const securityStatus = system?.securityStatus ?? -1;
  const securityBand = system?.securityBand ?? (securityStatus >= 0.45 ? "high" : securityStatus > 0 ? "low" : "null");
  return {
    orderId: raw.order_id,
    typeId: raw.type_id,
    price: raw.price,
    volumeRemain: raw.volume_remain,
    volumeTotal: raw.volume_total,
    minVolume: raw.min_volume,
    range: String(raw.range),
    issued: raw.issued,
    durationDays: raw.duration,
    regionId,
    regionName,
    systemId: raw.system_id,
    systemName: system?.name ?? `System ${raw.system_id}`,
    securityStatus,
    securityBand,
    locationId: raw.location_id,
    locationName: locations.get(raw.location_id) ?? `Location ${raw.location_id}`,
  };
}

export async function buildFullMarketAnalysisIndex(
  snapshot?: RawMarketSnapshot,
  runtime: RawMarketAnalysisRuntime = {},
): Promise<FullMarketAnalysisIndex> {
  const manifest = snapshot ?? (await loadCurrentRawMarketManifest("all"));
  if (!manifest?.complete || manifest.mode !== "all")
    throw new Error("Run Refresh everything to build the complete all-region raw market order book first.");
  if (!snapshot && currentCache?.snapshotId === manifest.id) {
    runtime.progress?.({ stage: "market-index", message: "Reusing the in-memory full-market index.", percent: 100, cached: true });
    return currentCache.value;
  }
  const historical = historicalCache.get(manifest.id);
  if (snapshot && historical) return historical;
  const persisted = await loadPersistedAnalysisIndex(manifest);
  if (persisted) {
    if (snapshot) historicalCache.set(manifest.id, persisted); else currentCache = { snapshotId: manifest.id, value: persisted };
    runtime.progress?.({ stage: "market-index", message: "Loaded the saved full-market analysis index.", completed: manifest.regions.length, total: manifest.regions.length, percent: 100, cached: true });
    return persisted;
  }
  runtime.progress?.({ stage: "market-index", message: "Reading the complete raw market order book…", completed: 0, total: manifest.regions.length, percent: 0 });

  const systems = await getMarketSystemIndex();
  const types = await getMarketTypeIndex();
  const metadata = await retainedMarketMetadata();
  const locations = metadata.names;
  const items = new Map<number, FullMarketItem>();
  let sourceOrdersInspected = 0;
  let completedRegions = 0;
  let cursor = 0;
  const workers = Array.from({ length: Math.min(6, manifest.regions.length) }, async () => {
    while (cursor < manifest.regions.length) {
      const entry = manifest.regions[cursor++];
      const region = await loadRawMarketRegion(entry.regionId, manifest);
      if (!region) continue;
      let regionOrders = 0;
      for (const raw of region.orders) {
        if (runtime.shouldCancel?.()) throw new Error("Analysis cancelled.");
        sourceOrdersInspected += 1;
        regionOrders += 1;
        if (regionOrders % 20_000 === 0) await new Promise<void>((resolve) => setImmediate(resolve));
        const meta = types.get(raw.type_id);
        if (!meta) continue;
        let item = items.get(raw.type_id);
        if (!item) {
          item = {
            typeId: raw.type_id,
            typeName: meta.name,
            categoryId: meta.categoryId,
            categoryName: meta.categoryName,
            itemVolumeM3: metadata.volumes.get(raw.type_id) ?? meta.volumeM3,
            totalBuyOrders: 0,
            totalSellOrders: 0,
            totalBuyVolume: 0,
            totalSellVolume: 0,
            buys: [],
            sells: [],
            regions: {},
          };
          items.set(raw.type_id, item);
        }
        const order = convertOrder(raw, entry.regionId, entry.regionName, systems, locations);
        const regionKey = String(entry.regionId);
        const regional = item.regions[regionKey] ?? {
          regionId: entry.regionId,
          regionName: entry.regionName,
          ...emptyBandMetrics(),
          security: { high: emptyBandMetrics(), low: emptyBandMetrics(), null: emptyBandMetrics() },
        };
        item.regions[regionKey] = regional;
        recordRegionalOrder(regional, raw, order);
        recordRegionalOrder(regional.security![order.securityBand], raw, order);
        if (raw.is_buy_order) {
          item.totalBuyOrders += 1;
          item.totalBuyVolume += raw.volume_remain;
          insertCandidate(item.buys, order, true);
        } else {
          item.totalSellOrders += 1;
          item.totalSellVolume += raw.volume_remain;
          insertCandidate(item.sells, order, false);
        }
      }
      completedRegions += 1;
      const percent = Math.round((completedRegions / Math.max(1, manifest.regions.length)) * 100);
      runtime.progress?.({
        stage: "market-index",
        message: `Reading full market: ${completedRegions}/${manifest.regions.length} regions`,
        completed: completedRegions,
        total: manifest.regions.length,
        percent,
      });
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  });
  await Promise.all(workers);

  const value: FullMarketAnalysisIndex = {
    snapshotId: manifest.id,
    createdAt: manifest.createdAt,
    orderCount: manifest.orderCount,
    regionCount: manifest.regionCount,
    sourceOrdersInspected,
    candidateDepthPerSide: SIDE_DEPTH,
    items,
  };
  if (snapshot) historicalCache.set(manifest.id, value);
  else currentCache = { snapshotId: manifest.id, value };
  for (const key of historicalCache.keys()) if (key !== manifest.id && historicalCache.size > 3) historicalCache.delete(key);
  runtime.progress?.({ stage: "market-index-save", message: "Saving the compact analysis index for fast reuse…", percent: 99 });
  try {
    await savePersistedAnalysisIndex(manifest, value);
  } catch (error) {
    runtime.progress?.({
      stage: "market-index-save",
      message: `Could not save the reusable market index: ${error instanceof Error ? error.message : String(error)}`,
      percent: 100,
    });
  }
  runtime.progress?.({ stage: "market-index", message: `Market index ready: ${sourceOrdersInspected.toLocaleString()} orders inspected.`, completed: manifest.regions.length, total: manifest.regions.length, percent: 100 });
  return value;
}

export async function bestRawBuyOrdersForTypes(typeIds: Iterable<number>) {
  const wanted = new Set(typeIds);
  const index = await buildFullMarketAnalysisIndex();
  const result = new Map<number, FullMarketOrder>();
  for (const typeId of wanted) {
    const buy = index.items.get(typeId)?.buys[0];
    if (buy) result.set(typeId, buy);
  }
  return { index, orders: result };
}
