import { createReadStream, createWriteStream, promises as fs } from "node:fs";
import path from "node:path";
import { createGzip, createGunzip, gunzip } from "node:zlib";
import { promisify } from "node:util";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import { Worker } from "node:worker_threads";
import {
  loadCurrentRawMarketManifest,
  loadRawMarketRegion,
  RAW_MARKET_ROOT,
  type RawMarketSnapshot,
} from "./raw-market-storage";
import { getMarketSystemIndex, loadMarketWorkerLookups, prepareMarketWorkerLookups } from "./market-static-index";
import type { MarketOrder } from "./market";
import type { FullMarketAnalysisIndex, FullMarketBandMetrics } from "./raw-market-analysis";

const gunzipAsync = promisify(gunzip);

export type RegionalMarketSecurityBand = "all" | "high" | "low" | "null";

export type RegionalMarketBandMetrics = {
  buyOrders: number;
  sellOrders: number;
  buyVolume: number;
  sellVolume: number;
  bestBuy: number | null;
  bestBuySystemId: number | null;
  bestBuyVolume: number;
  bestSell: number | null;
  bestSellSystemId: number | null;
  bestSellVolume: number;
};

export type RegionalMarketAggregateRow = {
  typeId: number;
  regionId: number;
  regionName: string;
  all: RegionalMarketBandMetrics;
  high: RegionalMarketBandMetrics;
  low: RegionalMarketBandMetrics;
  null: RegionalMarketBandMetrics;
};

type CheapestSell = { price: number; regionId: number; regionName: string } | null;
export type RegionalMarketAggregateIndex = {
  snapshotId: string;
  createdAt: string;
  orderCount: number;
  regionCount: number;
  rows: RegionalMarketAggregateRow[];
  cheapestSellByType: Map<number, Record<RegionalMarketSecurityBand, CheapestSell>>;
};

export type RegionalMarketIndexRuntime = {
  progress?: (progress: {
    stage: string;
    message: string;
    completed?: number;
    total?: number;
    percent?: number;
    cached?: boolean;
  }) => void;
};

const SCHEMA_VERSION = 1;
const FILE_NAME = "regional-filter-index-v1.jsonl.gz";
let currentCache: { snapshotId: string; value: RegionalMarketAggregateIndex } | null = null;

export async function buildRegionalRowsForEntries(
  manifest: RawMarketSnapshot,
  entries: RawMarketSnapshot["regions"],
  staticLookupPath?: string,
) {
  const sharedLookups = staticLookupPath ? await loadMarketWorkerLookups(staticLookupPath) : null;
  const systems = sharedLookups?.systems ?? await getMarketSystemIndex();
  const rows: RegionalMarketAggregateRow[] = [];
  for (const regionEntry of entries) {
    const region = await loadRawMarketRegion(regionEntry.regionId, manifest);
    if (!region) continue;
    const byType = new Map<number, RegionalMarketAggregateRow>();
    for (const order of region.orders) {
      let row = byType.get(order.type_id);
      if (!row) {
        row = { typeId: order.type_id, regionId: regionEntry.regionId, regionName: regionEntry.regionName, all: emptyBand(), high: emptyBand(), low: emptyBand(), null: emptyBand() };
        byType.set(order.type_id, row);
      }
      recordOrder(row.all, order);
      recordOrder(row[systems.get(order.system_id)?.securityBand ?? "null"], order);
    }
    rows.push(...byType.values());
  }
  return rows;
}

function persistedPath(snapshot: RawMarketSnapshot) {
  return path.join(RAW_MARKET_ROOT, snapshot.id, FILE_NAME);
}

function emptyBand(): RegionalMarketBandMetrics {
  return {
    buyOrders: 0,
    sellOrders: 0,
    buyVolume: 0,
    sellVolume: 0,
    bestBuy: null,
    bestBuySystemId: null,
    bestBuyVolume: 0,
    bestSell: null,
    bestSellSystemId: null,
    bestSellVolume: 0,
  };
}

function recordOrder(metrics: RegionalMarketBandMetrics, order: MarketOrder) {
  if (order.is_buy_order) {
    metrics.buyOrders += 1;
    metrics.buyVolume += order.volume_remain;
    if (metrics.bestBuy == null || order.price > metrics.bestBuy) {
      metrics.bestBuy = order.price;
      metrics.bestBuySystemId = order.system_id;
      metrics.bestBuyVolume = order.volume_remain;
    }
  } else {
    metrics.sellOrders += 1;
    metrics.sellVolume += order.volume_remain;
    if (metrics.bestSell == null || order.price < metrics.bestSell) {
      metrics.bestSell = order.price;
      metrics.bestSellSystemId = order.system_id;
      metrics.bestSellVolume = order.volume_remain;
    }
  }
}

function encodeBand(metrics: RegionalMarketBandMetrics) {
  return [
    metrics.buyOrders,
    metrics.sellOrders,
    metrics.buyVolume,
    metrics.sellVolume,
    metrics.bestBuy,
    metrics.bestBuySystemId,
    metrics.bestBuyVolume,
    metrics.bestSell,
    metrics.bestSellSystemId,
    metrics.bestSellVolume,
  ];
}

function decodeBand(values: unknown[]): RegionalMarketBandMetrics {
  return {
    buyOrders: Number(values[0] ?? 0),
    sellOrders: Number(values[1] ?? 0),
    buyVolume: Number(values[2] ?? 0),
    sellVolume: Number(values[3] ?? 0),
    bestBuy: values[4] == null ? null : Number(values[4]),
    bestBuySystemId: values[5] == null ? null : Number(values[5]),
    bestBuyVolume: Number(values[6] ?? 0),
    bestSell: values[7] == null ? null : Number(values[7]),
    bestSellSystemId: values[8] == null ? null : Number(values[8]),
    bestSellVolume: Number(values[9] ?? 0),
  };
}

function encodeRow(row: RegionalMarketAggregateRow) {
  return [row.typeId, row.regionId, encodeBand(row.all), encodeBand(row.high), encodeBand(row.low), encodeBand(row.null)];
}

function decodeRow(values: unknown[], regionNames: Map<number, string>): RegionalMarketAggregateRow {
  const typeId = Number(values[0]);
  const regionId = Number(values[1]);
  return {
    typeId,
    regionId,
    regionName: regionNames.get(regionId) ?? `Region ${regionId}`,
    all: decodeBand((values[2] as unknown[]) ?? []),
    high: decodeBand((values[3] as unknown[]) ?? []),
    low: decodeBand((values[4] as unknown[]) ?? []),
    null: decodeBand((values[5] as unknown[]) ?? []),
  };
}

function buildCheapestSellMap(rows: RegionalMarketAggregateRow[]) {
  const result = new Map<number, Record<RegionalMarketSecurityBand, CheapestSell>>();
  for (const row of rows) {
    const current = result.get(row.typeId) ?? { all: null, high: null, low: null, null: null };
    for (const band of ["all", "high", "low", "null"] as RegionalMarketSecurityBand[]) {
      const price = row[band].bestSell;
      if (price == null || price <= 0) continue;
      if (!current[band] || price < current[band]!.price)
        current[band] = { price, regionId: row.regionId, regionName: row.regionName };
    }
    result.set(row.typeId, current);
  }
  return result;
}

function regionalBand(metrics: FullMarketBandMetrics): RegionalMarketBandMetrics {
  return {
    buyOrders: metrics.buyOrders,
    sellOrders: metrics.sellOrders,
    buyVolume: metrics.buyVolume,
    sellVolume: metrics.sellVolume,
    bestBuy: metrics.bestBuy,
    bestBuySystemId: metrics.bestBuySystemId,
    bestBuyVolume: metrics.bestBuyVolume,
    bestSell: metrics.bestSell,
    bestSellSystemId: metrics.bestSellSystemId,
    bestSellVolume: metrics.bestSellVolume,
  };
}

/**
 * Produces the Regional view from the already-complete canonical market index.
 * No raw order files are opened again; this preserves the same all/high/low/null
 * aggregates that were calculated while the full index read each order.
 */
export async function buildRegionalMarketAggregateIndexFromFull(
  full: FullMarketAnalysisIndex,
  runtime: RegionalMarketIndexRuntime = {},
): Promise<RegionalMarketAggregateIndex> {
  const manifest = await loadCurrentRawMarketManifest("all");
  if (!manifest?.complete || manifest.id !== full.snapshotId)
    throw new Error("The full-market snapshot changed before its regional view could be published.");
  const rows: RegionalMarketAggregateRow[] = [];
  let inspected = 0;
  for (const item of full.items.values()) {
    for (const region of Object.values(item.regions)) {
      if (!region.security) throw new Error("Full-market index is missing regional security-band metrics.");
      rows.push({
        typeId: item.typeId,
        regionId: region.regionId,
        regionName: region.regionName,
        all: regionalBand(region),
        high: regionalBand(region.security.high),
        low: regionalBand(region.security.low),
        null: regionalBand(region.security.null),
      });
    }
    inspected += 1;
    if (inspected % 500 === 0) {
      runtime.progress?.({ stage: "regional-index", message: `Deriving regional intelligence: ${inspected}/${full.items.size} items`, completed: inspected, total: full.items.size, percent: Math.round((inspected / full.items.size) * 100) });
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }
  const value: RegionalMarketAggregateIndex = {
    snapshotId: full.snapshotId,
    createdAt: full.createdAt,
    orderCount: full.orderCount,
    regionCount: full.regionCount,
    rows,
    cheapestSellByType: buildCheapestSellMap(rows),
  };
  currentCache = { snapshotId: full.snapshotId, value };
  await savePersisted(manifest, value);
  runtime.progress?.({ stage: "regional-index", message: `Regional intelligence derived from the canonical market index: ${rows.length.toLocaleString()} rows.`, completed: full.items.size, total: full.items.size, percent: 100 });
  return value;
}

async function loadPersisted(snapshot: RawMarketSnapshot): Promise<RegionalMarketAggregateIndex | null> {
  const target = persistedPath(snapshot);
  try {
    await fs.access(target);
  } catch {
    return null;
  }
  const regionNames = new Map(snapshot.regions.map((region) => [region.regionId, region.regionName]));
  const rows: RegionalMarketAggregateRow[] = [];
  let headerSeen = false;
  const input = createReadStream(target);
  const gunzip = createGunzip();
  const rl = createInterface({ input: input.pipe(gunzip), crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      if (!line) continue;
      if (!headerSeen) {
        headerSeen = true;
        const header = JSON.parse(line) as {
          schemaVersion: number;
          snapshotId: string;
          orderCount: number;
          regionCount: number;
        };
        if (
          header.schemaVersion !== SCHEMA_VERSION ||
          header.snapshotId !== snapshot.id ||
          header.orderCount !== snapshot.orderCount ||
          header.regionCount !== snapshot.regionCount
        ) {
          rl.close();
          input.destroy();
          return null;
        }
        continue;
      }
      rows.push(decodeRow(JSON.parse(line) as unknown[], regionNames));
    }
  } catch {
    return null;
  }
  if (!headerSeen || !rows.length) return null;
  return {
    snapshotId: snapshot.id,
    createdAt: snapshot.createdAt,
    orderCount: snapshot.orderCount,
    regionCount: snapshot.regionCount,
    rows,
    cheapestSellByType: buildCheapestSellMap(rows),
  };
}

async function savePersisted(snapshot: RawMarketSnapshot, value: RegionalMarketAggregateIndex) {
  const target = persistedPath(snapshot);
  try {
    const existing = await loadPersisted(snapshot);
    if (existing) return;
  } catch {
    // No usable saved aggregate exists yet.
  }
  const partial = `${target}.${process.pid}.${randomUUID()}.partial`;
  const source = Readable.from(
    (async function* () {
      yield `${JSON.stringify({
        schemaVersion: SCHEMA_VERSION,
        snapshotId: value.snapshotId,
        createdAt: value.createdAt,
        orderCount: value.orderCount,
        regionCount: value.regionCount,
      })}\n`;
      for (const row of value.rows) yield `${JSON.stringify(encodeRow(row))}\n`;
    })(),
  );
  await pipeline(source, createGzip({ level: 6 }), createWriteStream(partial));
  try {
    await fs.rename(partial, target);
  } catch (error) {
    const anotherWorkerSaved = await loadPersisted(snapshot).catch(() => null);
    if (!anotherWorkerSaved) throw error;
    await fs.rm(partial, { force: true }).catch(() => undefined);
  }
}

export async function buildRegionalMarketAggregateIndex(
  runtime: RegionalMarketIndexRuntime = {},
  workerCount = 1,
): Promise<RegionalMarketAggregateIndex> {
  const manifest = await loadCurrentRawMarketManifest("all");
  if (!manifest?.complete)
    throw new Error("Run Refresh everything to build the complete all-region raw market order book first.");
  if (currentCache?.snapshotId === manifest.id) {
    runtime.progress?.({ stage: "regional-index", message: "Reusing the in-memory regional market index.", percent: 100, cached: true });
    return currentCache.value;
  }

  const persisted = await loadPersisted(manifest).catch(() => null);
  if (persisted) {
    currentCache = { snapshotId: manifest.id, value: persisted };
    runtime.progress?.({ stage: "regional-index", message: "Loaded the saved regional market index.", completed: manifest.regionCount, total: manifest.regionCount, percent: 100, cached: true });
    return persisted;
  }

  runtime.progress?.({ stage: "regional-index", message: "Building the security-aware regional market index…", completed: 0, total: manifest.regionCount, percent: 0 });
  const parallelism = Math.min(Math.max(1, workerCount), manifest.regions.length);
  const staticLookupPath = await prepareMarketWorkerLookups();
  const chunkSize = Math.max(1, Math.ceil(manifest.regions.length / (parallelism * 4)));
  const chunks = Array.from({ length: Math.ceil(manifest.regions.length / chunkSize) }, (_, index) => manifest.regions.slice(index * chunkSize, (index + 1) * chunkSize));
  let completed = 0;
  const runChunk = (entries: RawMarketSnapshot["regions"], index: number) => new Promise<{ path: string }>((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, "master-regional-market-shard-worker.js"), { workerData: { manifest, entries, index, staticLookupPath }, env: process.env, resourceLimits: { maxOldGenerationSizeMb: 384 } });
    let settled = false;
    const finish = (callback: () => void) => { if (settled) return; settled = true; callback(); void worker.terminate().catch(() => undefined); };
    worker.once("message", (message: any) => finish(() => message?.ok ? resolve(message) : reject(new Error(message?.error ?? "Regional market shard failed."))));
    worker.once("error", (error) => finish(() => reject(error)));
    worker.once("exit", (code) => { if (code !== 0) finish(() => reject(new Error(`Regional market shard ${index + 1} stopped (${code}).`))); });
  });
  let next = 0;
  const fragments: Array<{ path: string }> = [];
  await Promise.all(Array.from({ length: parallelism }, async () => {
    while (true) {
      const index = next++;
      if (index >= chunks.length) return;
      fragments[index] = await runChunk(chunks[index], index);
      completed += chunks[index].length;
      runtime.progress?.({ stage: "regional-index", message: `Building regional index: ${completed}/${manifest.regionCount} regions`, completed, total: manifest.regionCount, percent: Math.round((completed / Math.max(1, manifest.regionCount)) * 100) });
    }
  }));
  const rows: RegionalMarketAggregateRow[] = [];
  for (const fragment of fragments) {
    rows.push(...JSON.parse((await gunzipAsync(await fs.readFile(fragment.path))).toString("utf8")) as RegionalMarketAggregateRow[]);
    await fs.rm(fragment.path, { force: true }).catch(() => undefined);
  }

  const value: RegionalMarketAggregateIndex = {
    snapshotId: manifest.id,
    createdAt: manifest.createdAt,
    orderCount: manifest.orderCount,
    regionCount: manifest.regionCount,
    rows,
    cheapestSellByType: buildCheapestSellMap(rows),
  };
  currentCache = { snapshotId: manifest.id, value };
  runtime.progress?.({ stage: "regional-index-save", message: "Saving the regional market index for fast reuse…", percent: 99 });
  try {
    await savePersisted(manifest, value);
  } catch (error) {
    runtime.progress?.({
      stage: "regional-index-save",
      message: `Could not save the regional market index: ${error instanceof Error ? error.message : String(error)}`,
      percent: 100,
    });
  }
  runtime.progress?.({ stage: "regional-index", message: `Regional index ready: ${rows.length.toLocaleString()} item-region rows.`, completed: manifest.regionCount, total: manifest.regionCount, percent: 100 });
  return value;
}
