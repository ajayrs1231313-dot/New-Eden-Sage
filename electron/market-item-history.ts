import { loadRecentMarketDatasetsByMode } from "./market-storage";
import { getMarketTypeIndex } from "./market-static-index";

export type MarketItemHistoryPoint = {
  createdAt: string;
  regionId: number;
  region: string;
  bestBuy: number | null;
  bestSell: number | null;
  spreadPercent: number | null;
  buyOrders: number;
  sellOrders: number;
  buyVolume: number;
  sellVolume: number;
};

type StoredItem = {
  typeId: number;
  typeName: string;
  buyOrderCount?: number;
  sellOrderCount?: number;
  buyVolume?: number;
  sellVolume?: number;
  bestBuy?: number | null;
  bestSell?: number | null;
  spreadPercent?: number | null;
};

type StoredRegion = {
  regionId: number;
  regionName: string;
  items?: StoredItem[];
};

function finite(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function point(createdAt: string, region: StoredRegion, item: StoredItem): MarketItemHistoryPoint {
  const bestBuy = finite(item.bestBuy);
  const bestSell = finite(item.bestSell);
  const spread = finite(item.spreadPercent) ?? (bestBuy != null && bestSell != null && bestSell > 0 ? ((bestSell - bestBuy) / bestSell) * 100 : null);
  return {
    createdAt,
    regionId: region.regionId,
    region: region.regionName,
    bestBuy,
    bestSell,
    spreadPercent: spread,
    buyOrders: Number(item.buyOrderCount ?? 0),
    sellOrders: Number(item.sellOrderCount ?? 0),
    buyVolume: Number(item.buyVolume ?? 0),
    sellVolume: Number(item.sellVolume ?? 0),
  };
}

export async function getMarketItemHistory(typeId: number, snapshotLimit = 120) {
  if (!Number.isInteger(typeId) || typeId <= 0) throw new Error("Choose a valid market item first.");
  const [datasets, typeIndex] = await Promise.all([
    loadRecentMarketDatasetsByMode("all", Math.max(1, Math.min(500, Math.floor(snapshotLimit)))),
    getMarketTypeIndex(),
  ]);
  const meta = typeIndex.get(typeId);
  if (!meta) throw new Error(`Type ${typeId} is not present in the market taxonomy.`);
  const snapshots = datasets.map((dataset) => {
    const rows: MarketItemHistoryPoint[] = [];
    for (const region of dataset.summaries as StoredRegion[]) {
      const item = region.items?.find((candidate) => candidate.typeId === typeId);
      if (item) rows.push(point(dataset.createdAt, region, item));
    }
    rows.sort((a, b) => a.region.localeCompare(b.region));
    return { createdAt: dataset.createdAt, rows };
  }).filter((snapshot) => snapshot.rows.length > 0);
  return {
    typeId,
    item: meta.name,
    category: meta.categoryName,
    group: meta.groupName,
    marketGroup: meta.marketGroupPathLabel,
    snapshotCount: snapshots.length,
    snapshots,
  };
}
