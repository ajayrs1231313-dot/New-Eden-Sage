import { createReadStream } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { createGunzip } from "node:zlib";
import { getMarketTypeIndex } from "./market-static-index";
import type { RegionalMarketAggregateRow } from "./regional-market-index";
import {
  SHARED_MARKET_ROOT,
  loadCurrentSharedMarketManifest,
  type SharedMarketManifest,
} from "./shared-market-data";

export type McpMarketBrowserItem = {
  typeId: number;
  typeName: string;
  categoryId?: number;
  categoryName?: string;
  itemVolumeM3?: number;
  buyOrderCount: number;
  sellOrderCount: number;
  buyVolume: number;
  sellVolume: number;
  bestBuy: number | null;
  bestSell: number | null;
  spreadPercent: number | null;
  topBuyOrders: never[];
  topSellOrders: never[];
  omittedBuyOrders: number;
  omittedSellOrders: number;
  security: {
    high: RegionalMarketAggregateRow["high"];
    low: RegionalMarketAggregateRow["low"];
    null: RegionalMarketAggregateRow["null"];
  };
};

export type McpMarketRegionSummary = {
  regionId: number;
  regionName: string;
  orderCount: number;
  pageCount: number;
  buyOrders: number;
  sellOrders: number;
  uniqueTypes: number;
  remainingUnits: number;
  updatedAt: string;
  items?: McpMarketBrowserItem[];
  topOrders: never[];
  candidateDepthAvailable: false;
};

type RegionalArtifactHeader = {
  schemaVersion: number;
  dataset: string;
  snapshotId: string;
  createdAt: string;
  orderCount: number;
  regionCount: number;
  rowCount: number;
};

type SummaryAccumulator = Omit<McpMarketRegionSummary, "updatedAt" | "topOrders" | "candidateDepthAvailable">;

let summaryCache: { generation: string; summaries: McpMarketRegionSummary[] } | null = null;

function sharedRegionalArtifactPath(manifest: SharedMarketManifest) {
  const artifact = manifest.files["market-regional"];
  if (!artifact?.path) throw new Error("The installed shared market manifest has no regional market artifact.");
  const normalized = artifact.path.replace(/\\/g, "/");
  if (!normalized.startsWith("generations/") || normalized.includes("../"))
    throw new Error("The installed shared regional market artifact path is invalid.");
  return path.join(SHARED_MARKET_ROOT, "generations", manifest.generation, path.posix.basename(normalized));
}

function validateRegionalHeader(header: RegionalArtifactHeader, manifest: SharedMarketManifest) {
  const artifact = manifest.files["market-regional"];
  if (
    header.schemaVersion !== 1 ||
    header.dataset !== "market-regional" ||
    header.snapshotId !== artifact?.version ||
    header.orderCount !== manifest.orderCount ||
    header.regionCount !== manifest.regionCount ||
    header.rowCount !== manifest.regionalRowCount
  ) throw new Error("The installed shared regional market artifact does not match its manifest.");
}

async function streamRegionalRows(
  manifest: SharedMarketManifest,
  visit: (row: RegionalMarketAggregateRow) => void,
) {
  const input = createReadStream(sharedRegionalArtifactPath(manifest));
  const gunzip = createGunzip();
  const rl = createInterface({ input: input.pipe(gunzip), crlfDelay: Infinity });
  let header: RegionalArtifactHeader | null = null;
  let rowsRead = 0;
  try {
    for await (const line of rl) {
      if (!line) continue;
      if (!header) {
        header = JSON.parse(line) as RegionalArtifactHeader;
        validateRegionalHeader(header, manifest);
        continue;
      }
      visit(JSON.parse(line) as RegionalMarketAggregateRow);
      rowsRead += 1;
    }
  } finally {
    rl.close();
    input.destroy();
    gunzip.destroy();
  }
  if (!header) throw new Error("The installed shared regional market artifact has no header.");
  if (rowsRead !== header.rowCount)
    throw new Error(`The installed shared regional market artifact ended early (${rowsRead}/${header.rowCount} rows).`);
  return header;
}

function emptySummary(regionId: number, regionName: string): SummaryAccumulator {
  return {
    regionId,
    regionName,
    orderCount: 0,
    pageCount: 0,
    buyOrders: 0,
    sellOrders: 0,
    uniqueTypes: 0,
    remainingUnits: 0,
  };
}

function addRowToSummary(summary: SummaryAccumulator, row: RegionalMarketAggregateRow) {
  summary.buyOrders += row.all.buyOrders;
  summary.sellOrders += row.all.sellOrders;
  summary.orderCount += row.all.buyOrders + row.all.sellOrders;
  summary.remainingUnits += row.all.buyVolume + row.all.sellVolume;
  if (row.all.buyOrders + row.all.sellOrders > 0) summary.uniqueTypes += 1;
}

function finishSummary(summary: SummaryAccumulator, updatedAt: string): McpMarketRegionSummary {
  return {
    ...summary,
    updatedAt,
    topOrders: [],
    candidateDepthAvailable: false,
  };
}

export async function loadMcpMarketRegionSummaries(): Promise<McpMarketRegionSummary[]> {
  const manifest = await loadCurrentSharedMarketManifest();
  if (!manifest) return [];
  if (summaryCache?.generation === manifest.generation)
    return summaryCache.summaries.map((summary) => ({ ...summary }));

  const byRegion = new Map<number, SummaryAccumulator>();
  const header = await streamRegionalRows(manifest, (row) => {
    let summary = byRegion.get(row.regionId);
    if (!summary) {
      summary = emptySummary(row.regionId, row.regionName);
      byRegion.set(row.regionId, summary);
    }
    addRowToSummary(summary, row);
  });
  const summaries = [...byRegion.values()]
    .map((summary) => finishSummary(summary, header.createdAt))
    .sort((a, b) => a.regionName.localeCompare(b.regionName));
  summaryCache = { generation: manifest.generation, summaries };
  return summaries.map((summary) => ({ ...summary }));
}

export async function loadMcpMarketRegion(regionId: number): Promise<McpMarketRegionSummary | null> {
  const manifest = await loadCurrentSharedMarketManifest();
  if (!manifest) return null;
  const rows: RegionalMarketAggregateRow[] = [];
  let summary: SummaryAccumulator | null = null;
  const header = await streamRegionalRows(manifest, (row) => {
    if (row.regionId !== regionId) return;
    rows.push(row);
    if (!summary) summary = emptySummary(row.regionId, row.regionName);
    addRowToSummary(summary, row);
  });
  if (!summary || rows.length === 0) return null;

  const typeIndex = await getMarketTypeIndex();
  const items: McpMarketBrowserItem[] = rows.map((row) => {
    const meta = typeIndex.get(row.typeId);
    const bestBuy = row.all.bestBuy;
    const bestSell = row.all.bestSell;
    return {
      typeId: row.typeId,
      typeName: meta?.name ?? `Type ${row.typeId}`,
      categoryId: meta?.categoryId,
      categoryName: meta?.categoryName,
      itemVolumeM3: meta?.volumeM3,
      buyOrderCount: row.all.buyOrders,
      sellOrderCount: row.all.sellOrders,
      buyVolume: row.all.buyVolume,
      sellVolume: row.all.sellVolume,
      bestBuy,
      bestSell,
      spreadPercent: bestBuy != null && bestSell != null && bestSell > 0
        ? ((bestSell - bestBuy) / bestSell) * 100
        : null,
      topBuyOrders: [],
      topSellOrders: [],
      omittedBuyOrders: row.all.buyOrders,
      omittedSellOrders: row.all.sellOrders,
      security: { high: row.high, low: row.low, null: row.null },
    };
  });
  items.sort((a, b) => a.typeName.localeCompare(b.typeName));
  return { ...finishSummary(summary, header.createdAt), items };
}
