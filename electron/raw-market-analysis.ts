import { createWriteStream, promises as fs } from "node:fs";
import path from "node:path";
import { createGzip, gzip, gunzip } from "node:zlib";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Worker } from "node:worker_threads";
import { loadLatestMarketDatasetByMode } from "./market-storage";
import {
  loadCurrentRawMarketManifest,
  loadRawMarketRegion,
  RAW_MARKET_ROOT,
  type RawMarketSnapshot,
} from "./raw-market-storage";
import { getMarketSystemIndex, getMarketTypeIndex, loadMarketWorkerLookups, prepareMarketWorkerLookups } from "./market-static-index";
import type { MarketOrder } from "./market";
import { logEvent } from "./logger";
import { loadSharedFullMarketAnalysisIndex } from "./shared-market-data";

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
  skipPersist?: boolean;
  bypassCache?: boolean;
  /** Historical snapshots used for one-off comparisons must not stay resident beside the current full-market index. */
  retainHistoricalCache?: boolean;
  staticLookupPath?: string;
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
const gunzipAsync = promisify(gunzip);
const gzipAsync = promisify(gzip);
const MARGIN_SNAPSHOT_SCHEMA = 1;
const ANALYSIS_INDEX_SCHEMA = 4;
const ANALYSIS_SAVE_TIMEOUT_MS = 5 * 60_000;
let currentCache: { snapshotId: string; value: FullMarketAnalysisIndex } | null = null;
const historicalCache = new Map<string, FullMarketAnalysisIndex>();
let metadataCache: { createdAt: string; names: Map<number, string>; volumes: Map<number, number> } | null = null;

function persistedIndexPath(snapshot: RawMarketSnapshot) {
  return path.join(RAW_MARKET_ROOT, snapshot.id, "analysis-index-v2.json.gz");
}

function persistedMarginPath(snapshot: RawMarketSnapshot) {
  return path.join(RAW_MARKET_ROOT, snapshot.id, "analysis-margins-v1.json.gz");
}

function marginMapFromIndex(index: FullMarketAnalysisIndex) {
  const margins: Record<string, number | null> = {};
  for (const [typeId, item] of index.items) {
    const buy = item.buys[0];
    const sell = item.sells[0];
    margins[String(typeId)] = buy && sell ? buy.price - sell.price : null;
  }
  return margins;
}

async function readPersistedMarginSnapshot(snapshot: RawMarketSnapshot) {
  try {
    const payload = JSON.parse((await gunzipAsync(await fs.readFile(persistedMarginPath(snapshot)))).toString("utf8")) as {
      schema: number;
      snapshotId: string;
      itemCount: number;
      margins: Record<string, number | null>;
    };
    if (payload.schema !== MARGIN_SNAPSHOT_SCHEMA || payload.snapshotId !== snapshot.id || !payload.margins || typeof payload.margins !== "object") return null;
    return { snapshotId: payload.snapshotId, itemCount: payload.itemCount, margins: payload.margins };
  } catch {
    return null;
  }
}

async function savePersistedMarginMap(snapshot: RawMarketSnapshot, margins: Record<string, number | null>) {
  const target = persistedMarginPath(snapshot);
  const partial = target + "." + process.pid + "." + randomUUID() + ".partial";
  const itemCount = Object.keys(margins).length;
  const compressed = await gzipAsync(Buffer.from(JSON.stringify({
    schema: MARGIN_SNAPSHOT_SCHEMA,
    snapshotId: snapshot.id,
    itemCount,
    margins,
  }), "utf8"), { level: 6 });
  await fs.writeFile(partial, compressed, { flag: "wx" });
  await fs.rm(target, { force: true }).catch(() => undefined);
  await fs.rename(partial, target);
  return { snapshotId: snapshot.id, itemCount, bytes: compressed.byteLength };
}

async function savePersistedMarginSnapshot(snapshot: RawMarketSnapshot, index: FullMarketAnalysisIndex) {
  return savePersistedMarginMap(snapshot, marginMapFromIndex(index));
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

function persistedItem(item: FullMarketItem): FullMarketItem {
  // Regional high/low/null metrics are part of the canonical full-market
  // index. Persist them intact so the regional view can be reconstructed
  // without reopening 1.5m+ raw orders.
  return item;
}

async function savePersistedAnalysisIndex(snapshot: RawMarketSnapshot, value: FullMarketAnalysisIndex, runtime: RawMarketAnalysisRuntime) {
  const target = persistedIndexPath(snapshot);
  const partial = `${target}.${process.pid}.${randomUUID()}.partial`;
  const startedAt = Date.now();
  const itemCount = value.items.size;
  await fs.mkdir(path.dirname(target), { recursive: true });

  await logEvent("info", "full_market_index.save_started", {
    snapshotId: snapshot.id,
    target,
    itemCount,
    sourceOrdersInspected: value.sourceOrdersInspected,
  });

  async function* serialisedPayload() {
    const header = JSON.stringify({
      schemaVersion: ANALYSIS_INDEX_SCHEMA,
      snapshotId: value.snapshotId,
      createdAt: value.createdAt,
      orderCount: value.orderCount,
      regionCount: value.regionCount,
      sourceOrdersInspected: value.sourceOrdersInspected,
      candidateDepthPerSide: value.candidateDepthPerSide,
    });
    yield Buffer.from(`${header.slice(0, -1)},"items":[`, "utf8");

    let first = true;
    let completed = 0;
    for (const item of value.items.values()) {
      yield Buffer.from(`${first ? "" : ","}${JSON.stringify(persistedItem(item))}`, "utf8");
      first = false;
      completed += 1;
      if (completed % 250 === 0 || completed === itemCount) {
        runtime.progress?.({
          stage: "market-index-save",
          message: `Saving compact analysis index: ${completed}/${itemCount} items…`,
          completed,
          total: itemCount,
          percent: 99,
        });
      }
      if (completed % 100 === 0) await new Promise<void>((resolve) => setImmediate(resolve));
    }
    yield Buffer.from("]}", "utf8");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ANALYSIS_SAVE_TIMEOUT_MS);
  timeout.unref();

  try {
    runtime.progress?.({ stage: "market-index-save", message: "Streaming compact analysis index to disk…", completed: 0, total: itemCount, percent: 99 });
    await pipeline(
      Readable.from(serialisedPayload()),
      createGzip({ level: 6 }),
      createWriteStream(partial, { flags: "wx" }),
      { signal: controller.signal },
    );
    clearTimeout(timeout);

    const staged = await fs.stat(partial);
    await logEvent("info", "full_market_index.save_stream_complete", {
      snapshotId: snapshot.id,
      partial,
      bytes: staged.size,
      durationMs: Date.now() - startedAt,
    });

    runtime.progress?.({ stage: "market-index-save", message: "Promoting compact analysis index…", completed: itemCount, total: itemCount, percent: 99 });
    await fs.rm(target, { force: true });
    await fs.rename(partial, target);
    const marginSnapshot = await savePersistedMarginSnapshot(snapshot, value).catch(async (error) => {
      await logEvent("warn", "full_market_margin_snapshot.save_failed", {
        snapshotId: snapshot.id,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    });

    await logEvent("info", "full_market_index.save_complete", {
      snapshotId: snapshot.id,
      target,
      bytes: staged.size,
      durationMs: Date.now() - startedAt,
      marginSnapshot,
    });
  } catch (error) {
    clearTimeout(timeout);
    await fs.rm(partial, { force: true }).catch(() => undefined);
    const normalized = error instanceof Error ? error : new Error(String(error));
    if (controller.signal.aborted && normalized.name === "AbortError") {
      normalized.message = `Saving the full-market analysis index exceeded ${Math.round(ANALYSIS_SAVE_TIMEOUT_MS / 60_000)} minutes and was aborted.`;
    }
    await logEvent("error", "full_market_index.save_failed", {
      snapshotId: snapshot.id,
      target,
      durationMs: Date.now() - startedAt,
      error: normalized,
    });
    throw normalized;
  }
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
  if (!snapshot && process.env.NEW_EDEN_SAGE_DISABLE_SHARED_MARKET !== "1") {
    const shared = await loadSharedFullMarketAnalysisIndex();
    if (!shared) throw new Error("The shared server generation is unavailable. Desktop public-market reconstruction is disabled.");
    currentCache = { snapshotId: shared.snapshotId, value: shared };
    runtime.progress?.({ stage: "market-index", message: "Loaded the validated shared full-market generation.", completed: shared.regionCount, total: shared.regionCount, percent: 100, cached: true });
    return shared;
  }
  const manifest = snapshot ?? (await loadCurrentRawMarketManifest("all"));
  if (!manifest?.complete || manifest.mode !== "all")
    throw new Error("Run Refresh everything to build the complete all-region raw market order book first.");
  if (!runtime.bypassCache && !snapshot && currentCache?.snapshotId === manifest.id) {
    runtime.progress?.({ stage: "market-index", message: "Reusing the in-memory full-market index.", percent: 100, cached: true });
    return currentCache.value;
  }
  const retainHistoricalCache = runtime.retainHistoricalCache !== false;
  const historical = runtime.bypassCache || !retainHistoricalCache ? undefined : historicalCache.get(manifest.id);
  if (snapshot && historical) return historical;
  const persisted = runtime.bypassCache ? null : await loadPersistedAnalysisIndex(manifest);
  if (persisted) {
    if (snapshot) {
      if (retainHistoricalCache) historicalCache.set(manifest.id, persisted);
    } else currentCache = { snapshotId: manifest.id, value: persisted };
    runtime.progress?.({ stage: "market-index", message: "Loaded the saved full-market analysis index.", completed: manifest.regions.length, total: manifest.regions.length, percent: 100, cached: true });
    return persisted;
  }
  runtime.progress?.({ stage: "market-index", message: "Reading the complete raw market order book…", completed: 0, total: manifest.regions.length, percent: 0 });

  const sharedLookups = runtime.staticLookupPath ? await loadMarketWorkerLookups(runtime.staticLookupPath) : null;
  const systems = sharedLookups?.systems ?? await getMarketSystemIndex();
  const types = sharedLookups?.types ?? await getMarketTypeIndex();
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
  if (!runtime.bypassCache) {
    if (snapshot) {
      if (retainHistoricalCache) historicalCache.set(manifest.id, value);
    } else currentCache = { snapshotId: manifest.id, value };
  }
  for (const key of historicalCache.keys()) if (key !== manifest.id && historicalCache.size > 3) historicalCache.delete(key);
  if (!runtime.skipPersist) {
    runtime.progress?.({ stage: "market-index-save", message: "Saving the compact analysis index for fast reuse…", percent: 99 });
    try {
      await savePersistedAnalysisIndex(manifest, value, runtime);
    } catch (error) {
      runtime.progress?.({
        stage: "market-index-save",
        message: `Could not save the reusable market index: ${error instanceof Error ? error.message : String(error)}`,
        percent: 100,
      });
    }
  }
  runtime.progress?.({ stage: "market-index", message: `Market index ready: ${sourceOrdersInspected.toLocaleString()} orders inspected.`, completed: manifest.regions.length, total: manifest.regions.length, percent: 100 });
  return value;
}

/**
 * Load exactly the historical signal the scanner needs. Historical margins are
 * persisted as a tiny sidecar. For pre-sidecar snapshots, derive the lookup
 * directly from one raw region at a time so no historical full-market graph is
 * ever allocated in the Market Scanner worker.
 */
export async function loadFullMarketMarginSnapshot(
  snapshot: RawMarketSnapshot,
  runtime: Pick<RawMarketAnalysisRuntime, "shouldCancel"> = {},
) {
  const saved = await readPersistedMarginSnapshot(snapshot);
  if (saved) return saved;

  const best = new Map<number, { buy: number | null; sell: number | null }>();
  for (const entry of snapshot.regions) {
    if (runtime.shouldCancel?.()) throw new Error("Analysis cancelled.");
    const region = await loadRawMarketRegion(entry.regionId, snapshot);
    if (!region) continue;
    for (const order of region.orders) {
      if (runtime.shouldCancel?.()) throw new Error("Analysis cancelled.");
      let item = best.get(order.type_id);
      if (!item) {
        item = { buy: null, sell: null };
        best.set(order.type_id, item);
      }
      if (order.is_buy_order) {
        if (item.buy == null || order.price > item.buy) item.buy = order.price;
      } else if (item.sell == null || order.price < item.sell) {
        item.sell = order.price;
      }
    }
    // Drop the decompressed region before opening the next one.
    await new Promise<void>((resolve) => setImmediate(resolve));
  }

  const margins: Record<string, number | null> = {};
  for (const [typeId, item] of best) margins[String(typeId)] = item.buy != null && item.sell != null ? item.buy - item.sell : null;
  await savePersistedMarginMap(snapshot, margins).catch(() => undefined);
  return { snapshotId: snapshot.id, itemCount: best.size, margins };
}

function mergeFullMarketItem(target: FullMarketItem, source: FullMarketItem) {
  target.totalBuyOrders += source.totalBuyOrders;
  target.totalSellOrders += source.totalSellOrders;
  target.totalBuyVolume += source.totalBuyVolume;
  target.totalSellVolume += source.totalSellVolume;
  for (const order of source.buys) insertCandidate(target.buys, order, true);
  for (const order of source.sells) insertCandidate(target.sells, order, false);
  Object.assign(target.regions, source.regions);
}

export async function buildFullMarketAnalysisIndexParallel(
  workerCount: number,
  runtime: RawMarketAnalysisRuntime = {},
): Promise<FullMarketAnalysisIndex> {
  if (process.env.NEW_EDEN_SAGE_DISABLE_SHARED_MARKET !== "1") throw new Error("Desktop full-market shard computation is disabled; use the shared server generation.");
  const manifest = await loadCurrentRawMarketManifest("all");
  if (!manifest?.complete) throw new Error("Run Refresh everything to build the complete all-region raw market order book first.");
  const saved = await loadPersistedAnalysisIndex(manifest);
  if (saved) return saved;
  const count = Math.min(Math.max(1, workerCount), manifest.regions.length);
  const staticLookupPath = await prepareMarketWorkerLookups();
  // Keep each worker's live order graph bounded. Six workers stay active, but
  // each receives a small batch and writes a fragment before taking another.
  const regionsPerChunk = Math.max(1, Math.ceil(manifest.regions.length / (count * 5)));
  const shards = Array.from({ length: Math.ceil(manifest.regions.length / regionsPerChunk) }, (_, index) =>
    manifest.regions.slice(index * regionsPerChunk, (index + 1) * regionsPerChunk),
  );
  let completed = 0;
  runtime.progress?.({ stage: "market-index", message: `Processing the full market across ${count} CPU cores…`, percent: 0 });
  const runShard = (regions: typeof manifest.regions, index: number) => new Promise<{ path: string; sourceOrdersInspected: number }>((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, "master-full-market-shard-worker.js"), {
      workerData: { manifest: { ...manifest, regions, regionCount: regions.length, orderCount: regions.reduce((sum, entry) => sum + entry.orderCount, 0) }, shard: index + 1, staticLookupPath },
      env: process.env,
      resourceLimits: { maxOldGenerationSizeMb: 384 },
    });
    let settled = false;
    const finish = (callback: () => void) => { if (settled) return; settled = true; callback(); void worker.terminate().catch(() => undefined); };
    worker.on("message", (message: any) => {
      if (message?.type === "complete") finish(() => { completed += 1; runtime.progress?.({ stage: "market-index", message: `Market chunks complete: ${completed}/${shards.length}`, completed, total: shards.length, percent: Math.round((completed / shards.length) * 90) }); resolve(message.result); });
      else if (message?.type === "error") finish(() => reject(new Error(message.error)));
    });
    worker.once("error", (error) => finish(() => reject(error)));
    worker.once("exit", (code) => { if (code !== 0) finish(() => reject(new Error(`Market CPU shard ${index + 1} stopped (${code}).`))); });
  });
  let nextShard = 0;
  const partials: Array<{ path: string; sourceOrdersInspected: number }> = [];
  await Promise.all(Array.from({ length: count }, async () => {
    while (true) {
      const index = nextShard++;
      if (index >= shards.length) return;
      partials[index] = await runShard(shards[index], index);
    }
  }));
  const items = new Map<number, FullMarketItem>();
  let sourceOrdersInspected = 0;
  for (const partial of partials) {
    sourceOrdersInspected += partial.sourceOrdersInspected;
    const compressed = await fs.readFile(partial.path);
    const entries = JSON.parse((await gunzipAsync(compressed)).toString("utf8")) as Array<[number, FullMarketItem]>;
    for (const [typeId, source] of entries) {
      const target = items.get(typeId);
      if (target) mergeFullMarketItem(target, source);
      else items.set(typeId, source);
    }
    await fs.rm(partial.path, { force: true }).catch(() => undefined);
  }
  const value: FullMarketAnalysisIndex = { snapshotId: manifest.id, createdAt: manifest.createdAt, orderCount: manifest.orderCount, regionCount: manifest.regionCount, sourceOrdersInspected, candidateDepthPerSide: SIDE_DEPTH, items };
  currentCache = { snapshotId: manifest.id, value };
  runtime.progress?.({ stage: "market-index-save", message: "Merging and saving the six-core market index…", percent: 95 });
  await savePersistedAnalysisIndex(manifest, value, runtime);
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
