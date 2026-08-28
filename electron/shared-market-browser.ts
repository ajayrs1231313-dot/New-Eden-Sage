import { loadSharedFullMarketAnalysisIndex, loadSharedRegionalMarketAggregateIndex } from "./shared-market-data";

export type SharedMarketBrowserOrder = {
  orderId: number;
  price: number;
  volumeRemain: number;
  locationId: number;
  locationName: string;
  systemId: number;
  systemName: string;
  issued: string;
  minVolume?: number;
  range?: string;
  durationDays?: number;
};

export type SharedMarketBrowserItem = {
  typeId: number;
  typeName: string;
  categoryId?: number;
  categoryName?: string;
  itemVolumeM3?: number;
  estimatedUnitValue?: number;
  buyOrderCount: number;
  sellOrderCount: number;
  buyVolume: number;
  sellVolume: number;
  bestBuy: number | null;
  bestSell: number | null;
  spreadPercent: number | null;
  topBuyOrders?: SharedMarketBrowserOrder[];
  topSellOrders?: SharedMarketBrowserOrder[];
  omittedBuyOrders?: number;
  omittedSellOrders?: number;
};

export type SharedMarketBrowserSummary = {
  regionId: number;
  regionName: string;
  orderCount: number;
  pageCount: number;
  buyOrders: number;
  sellOrders: number;
  uniqueTypes: number;
  remainingUnits: number;
  updatedAt: string;
  items?: SharedMarketBrowserItem[];
  topOrders: Array<{
    order_id: number;
    is_buy_order: boolean;
    price: number;
    volume_remain: number;
    typeName: string;
    totalValue: number;
  }>;
};

type BrowserState = {
  snapshotId: string;
  createdAt: string;
  headers: SharedMarketBrowserSummary[];
  details: Map<number, SharedMarketBrowserSummary>;
};

let stateCache: BrowserState | null = null;

async function browserState() {
  const [global, regional] = await Promise.all([
    loadSharedFullMarketAnalysisIndex(),
    loadSharedRegionalMarketAggregateIndex(),
  ]);
  if (!global || !regional) return null;
  if (stateCache?.snapshotId === global.snapshotId && regional.snapshotId === global.snapshotId) return { state: stateCache, global };

  const byRegion = new Map<number, SharedMarketBrowserSummary>();
  for (const row of regional.rows) {
    let summary = byRegion.get(row.regionId);
    if (!summary) {
      summary = {
        regionId: row.regionId,
        regionName: row.regionName,
        orderCount: 0,
        pageCount: 0,
        buyOrders: 0,
        sellOrders: 0,
        uniqueTypes: 0,
        remainingUnits: 0,
        updatedAt: regional.createdAt,
        topOrders: [],
      };
      byRegion.set(row.regionId, summary);
    }
    summary.buyOrders += row.all.buyOrders;
    summary.sellOrders += row.all.sellOrders;
    summary.orderCount += row.all.buyOrders + row.all.sellOrders;
    summary.remainingUnits += row.all.buyVolume + row.all.sellVolume;
    if (row.all.buyOrders + row.all.sellOrders > 0) summary.uniqueTypes += 1;
  }
  const headers = [...byRegion.values()].sort((a, b) => a.regionName.localeCompare(b.regionName));
  stateCache = { snapshotId: global.snapshotId, createdAt: global.createdAt, headers, details: new Map() };
  return { state: stateCache, global };
}

function compactOrder(order: any): SharedMarketBrowserOrder {
  return {
    orderId: Number(order.orderId),
    price: Number(order.price),
    volumeRemain: Number(order.volumeRemain),
    locationId: Number(order.locationId),
    locationName: String(order.locationName || `Location ${order.locationId}`),
    systemId: Number(order.systemId),
    systemName: String(order.systemName || `System ${order.systemId}`),
    issued: String(order.issued || ""),
    minVolume: Number(order.minVolume || 0),
    range: String(order.range || ""),
    durationDays: Number(order.durationDays || 0),
  };
}

export async function loadSharedMarketBrowserSummaries(): Promise<SharedMarketBrowserSummary[]> {
  const loaded = await browserState();
  return loaded ? loaded.state.headers.map((header) => ({ ...header })) : [];
}

export async function loadSharedMarketBrowserRegions() {
  const summaries = await loadSharedMarketBrowserSummaries();
  return summaries.map((summary) => ({ regionId: summary.regionId, name: summary.regionName }));
}

export async function loadSharedMarketBrowserRegion(regionId: number): Promise<SharedMarketBrowserSummary | null> {
  const loaded = await browserState();
  if (!loaded) return null;
  const cached = loaded.state.details.get(regionId);
  if (cached) return cached;
  const header = loaded.state.headers.find((summary) => summary.regionId === regionId);
  if (!header) return null;

  const items: SharedMarketBrowserItem[] = [];
  const topOrders: SharedMarketBrowserSummary["topOrders"] = [];
  for (const item of loaded.global.items.values()) {
    const metrics = item.regions[String(regionId)];
    if (!metrics) continue;
    const buys = item.buys.filter((order) => order.regionId === regionId);
    const sells = item.sells.filter((order) => order.regionId === regionId);
    const topBuyOrders = buys.map(compactOrder);
    const topSellOrders = sells.map(compactOrder);
    items.push({
      typeId: item.typeId,
      typeName: item.typeName,
      categoryId: item.categoryId,
      categoryName: item.categoryName,
      itemVolumeM3: item.itemVolumeM3,
      buyOrderCount: metrics.buyOrders,
      sellOrderCount: metrics.sellOrders,
      buyVolume: metrics.buyVolume,
      sellVolume: metrics.sellVolume,
      bestBuy: metrics.bestBuy,
      bestSell: metrics.bestSell,
      spreadPercent: metrics.bestBuy != null && metrics.bestSell != null && metrics.bestSell > 0
        ? ((metrics.bestSell - metrics.bestBuy) / metrics.bestSell) * 100
        : null,
      topBuyOrders,
      topSellOrders,
      omittedBuyOrders: Math.max(0, metrics.buyOrders - topBuyOrders.length),
      omittedSellOrders: Math.max(0, metrics.sellOrders - topSellOrders.length),
    });
    for (const order of buys) topOrders.push({ order_id: order.orderId, is_buy_order: true, price: order.price, volume_remain: order.volumeRemain, typeName: item.typeName, totalValue: order.price * order.volumeRemain });
    for (const order of sells) topOrders.push({ order_id: order.orderId, is_buy_order: false, price: order.price, volume_remain: order.volumeRemain, typeName: item.typeName, totalValue: order.price * order.volumeRemain });
  }
  items.sort((a, b) => a.typeName.localeCompare(b.typeName));
  topOrders.sort((a, b) => b.totalValue - a.totalValue);
  const detail: SharedMarketBrowserSummary = { ...header, items, topOrders: topOrders.slice(0, 20) };
  loaded.state.details.set(regionId, detail);
  return detail;
}

export async function loadSharedMarketBrowserDataset() {
  const summaries = await loadSharedMarketBrowserSummaries();
  const detailed = [];
  for (const summary of summaries) {
    const detail = await loadSharedMarketBrowserRegion(summary.regionId);
    if (detail) detailed.push(detail);
  }
  return { createdAt: summaries[0]?.updatedAt ?? new Date(0).toISOString(), summaries: detailed };
}
