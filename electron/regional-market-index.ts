import { createReadStream, createWriteStream, promises as fs } from "node:fs";
import path from "node:path";
import { createGzip, createGunzip } from "node:zlib";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import {
  loadCurrentRawMarketManifest,
  loadRawMarketRegion,
  RAW_MARKET_ROOT,
  type RawMarketSnapshot,
} from "./raw-market-storage";
import { getMarketSystemIndex } from "./market-static-index";
import type { MarketOrder } from "./market";

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
  const systems = await getMarketSystemIndex();
  const rows: RegionalMarketAggregateRow[] = [];
  let completed = 0;

  for (const regionEntry of manifest.regions) {
    const region = await loadRawMarketRegion(regionEntry.regionId, manifest);
    if (!region) continue;
    const byType = new Map<number, RegionalMarketAggregateRow>();
    let regionOrders = 0;
    for (const order of region.orders) {
      regionOrders += 1;
      if (regionOrders % 25_000 === 0) await new Promise<void>((resolve) => setImmediate(resolve));
      let row = byType.get(order.type_id);
      if (!row) {
        row = {
          typeId: order.type_id,
          regionId: regionEntry.regionId,
          regionName: regionEntry.regionName,
          all: emptyBand(),
          high: emptyBand(),
          low: emptyBand(),
          null: emptyBand(),
        };
        byType.set(order.type_id, row);
      }
      recordOrder(row.all, order);
      const security = systems.get(order.system_id)?.securityBand ?? "null";
      recordOrder(row[security], order);
    }
    rows.push(...byType.values());
    completed += 1;
    runtime.progress?.({
      stage: "regional-index",
      message: `Building regional index: ${completed}/${manifest.regionCount} regions`,
      completed,
      total: manifest.regionCount,
      percent: Math.round((completed / Math.max(1, manifest.regionCount)) * 100),
    });
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
