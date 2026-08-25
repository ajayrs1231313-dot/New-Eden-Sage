import {
  buildRegionalMarketAggregateIndex,
  type RegionalMarketAggregateIndex,
  type RegionalMarketAggregateRow,
  type RegionalMarketBandMetrics,
} from "./regional-market-index";
import {
  getMarketSystemIndex,
  getMarketTaxonomy,
  getMarketTypeIndex,
  type MarketTaxonomy,
  type MarketTypeEntry,
} from "./market-static-index";
import { loadCurrentMarketRevision } from "./shared-market-data";

export type RegionalMarketFilterSecurity = "all" | "high" | "low" | "null";
export type RegionalMarketPresence = "any" | "buy" | "sell" | "both";
export type RegionalMarketSignal = "all" | "supply-gap" | "thin-supply" | "premium" | "buy-pressure";
export type RegionalMarketSort =
  | "signal"
  | "name"
  | "best-buy"
  | "best-sell"
  | "buy-orders"
  | "sell-orders"
  | "buy-volume"
  | "sell-volume"
  | "spread"
  | "premium"
  | "demand-pressure"
  | "cargo-size";

export type RegionalMarketFilterInput = {
  query?: string;
  typeIds?: number[];
  categoryIds?: number[];
  groupIds?: number[];
  marketGroupIds?: number[];
  regionIds?: number[];
  security?: RegionalMarketFilterSecurity;
  presence?: RegionalMarketPresence;
  signal?: RegionalMarketSignal;
  minBestBuy?: number | null;
  maxBestBuy?: number | null;
  minBestSell?: number | null;
  maxBestSell?: number | null;
  minBuyOrders?: number | null;
  maxBuyOrders?: number | null;
  minSellOrders?: number | null;
  maxSellOrders?: number | null;
  minBuyVolume?: number | null;
  minSellVolume?: number | null;
  maxSellVolume?: number | null;
  minSpreadPercent?: number | null;
  maxSpreadPercent?: number | null;
  minRegionalPremiumPercent?: number | null;
  minDemandSupplyRatio?: number | null;
  maxItemVolumeM3?: number | null;
  sort?: RegionalMarketSort;
  offset?: number;
  limit?: number;
};

export type RegionalMarketFilterRow = {
  typeId: number;
  item: string;
  categoryId: number;
  category: string;
  groupId: number;
  group: string;
  marketGroupId: number | null;
  marketGroup: string;
  marketGroupPath: string;
  itemVolumeM3: number;
  regionId: number;
  region: string;
  security: RegionalMarketFilterSecurity;
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
  spreadPercent: number | null;
  globalCheapestSell: number | null;
  globalCheapestSellRegion: string | null;
  regionalPremiumPercent: number | null;
  demandSupplyRatio: number;
  supplyGap: boolean;
  thinSupply: boolean;
  buyPressure: boolean;
  signalScore: number;
};

export type RegionalMarketFilterResult = {
  available: boolean;
  message?: string;
  snapshot: null | { id: string; createdAt: string; orderCount: number; regionCount: number };
  filters: Required<Pick<RegionalMarketFilterInput, "security" | "presence" | "signal" | "sort">> & {
    query: string;
    typeIds: number[];
    categoryIds: number[];
    groupIds: number[];
    marketGroupIds: number[];
    regionIds: number[];
  };
  taxonomy: MarketTaxonomy;
  regionOptions: Array<{ regionId: number; regionName: string }>;
  totalRows: number;
  totalItems: number;
  offset: number;
  limit: number;
  rows: RegionalMarketFilterRow[];
  summary: {
    supplyGaps: number;
    thinSupply: number;
    premiumRows: number;
    buyPressureRows: number;
    regionsRepresented: number;
    categoriesRepresented: number;
    highestPremiumPercent: number;
    highestDemandSupplyRatio: number;
  };
};

export type RegionalMarketFilterRuntime = {
  progress?: (value: {
    stage: string;
    message: string;
    completed?: number;
    total?: number;
    percent?: number;
    cached?: boolean;
  }) => void;
};

type RegionalWithIdentity = RegionalMarketBandMetrics & { regionId: number; regionName: string };

function finite(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function numberSet(values?: number[]) {
  return new Set((values ?? []).filter((value) => Number.isFinite(value)).map(Number));
}

function effectiveRegion(row: RegionalMarketAggregateRow, security: RegionalMarketFilterSecurity): RegionalWithIdentity {
  const metrics = security === "all" ? row.all : row[security];
  return { regionId: row.regionId, regionName: row.regionName, ...metrics };
}

function searchText(meta: MarketTypeEntry) {
  return `${meta.name} ${meta.categoryName} ${meta.groupName} ${meta.marketGroupName} ${meta.marketGroupPathLabel}`.toLowerCase();
}

function spreadPercent(bestBuy: number | null, bestSell: number | null) {
  if (!(bestBuy && bestSell) || bestSell <= 0) return null;
  return ((bestSell - bestBuy) / bestSell) * 100;
}

function signalScore(row: Omit<RegionalMarketFilterRow, "signalScore">) {
  let score = 0;
  if (row.supplyGap) score += 55;
  else if (row.thinSupply) score += 28;
  if (row.buyPressure) score += 20;
  score += Math.min(28, Math.max(0, row.regionalPremiumPercent ?? 0) * 0.35);
  score += Math.min(18, Math.max(0, row.demandSupplyRatio - 1) * 4);
  if (row.sellOrders > 0) score += Math.max(0, 10 - Math.min(10, row.sellOrders));
  return Math.round(Math.max(0, Math.min(100, score)));
}

function compareRows(sort: RegionalMarketSort) {
  return (a: RegionalMarketFilterRow, b: RegionalMarketFilterRow) => {
    if (sort === "name") return a.item.localeCompare(b.item) || a.region.localeCompare(b.region);
    if (sort === "best-buy") return (b.bestBuy ?? -Infinity) - (a.bestBuy ?? -Infinity) || b.buyVolume - a.buyVolume;
    if (sort === "best-sell") return (a.bestSell ?? Infinity) - (b.bestSell ?? Infinity) || b.sellVolume - a.sellVolume;
    if (sort === "buy-orders") return b.buyOrders - a.buyOrders || b.buyVolume - a.buyVolume;
    if (sort === "sell-orders") return b.sellOrders - a.sellOrders || b.sellVolume - a.sellVolume;
    if (sort === "buy-volume") return b.buyVolume - a.buyVolume || b.buyOrders - a.buyOrders;
    if (sort === "sell-volume") return b.sellVolume - a.sellVolume || b.sellOrders - a.sellOrders;
    if (sort === "spread") return (b.spreadPercent ?? -Infinity) - (a.spreadPercent ?? -Infinity);
    if (sort === "premium") return (b.regionalPremiumPercent ?? -Infinity) - (a.regionalPremiumPercent ?? -Infinity);
    if (sort === "demand-pressure") return b.demandSupplyRatio - a.demandSupplyRatio || b.buyVolume - a.buyVolume;
    if (sort === "cargo-size") return a.itemVolumeM3 - b.itemVolumeM3 || b.signalScore - a.signalScore;
    return b.signalScore - a.signalScore || (b.regionalPremiumPercent ?? -Infinity) - (a.regionalPremiumPercent ?? -Infinity) || b.buyVolume - a.buyVolume;
  };
}

function presenceMatches(row: RegionalMarketFilterRow, presence: RegionalMarketPresence) {
  if (presence === "buy") return row.buyOrders > 0;
  if (presence === "sell") return row.sellOrders > 0;
  if (presence === "both") return row.buyOrders > 0 && row.sellOrders > 0;
  return row.buyOrders > 0 || row.sellOrders > 0;
}

function signalMatches(row: RegionalMarketFilterRow, signal: RegionalMarketSignal) {
  if (signal === "supply-gap") return row.supplyGap;
  if (signal === "thin-supply") return row.thinSupply;
  if (signal === "premium") return (row.regionalPremiumPercent ?? 0) > 0;
  if (signal === "buy-pressure") return row.buyPressure;
  return true;
}

function numericMatches(row: RegionalMarketFilterRow, input: RegionalMarketFilterInput) {
  const checks: Array<[number | null, number | null, "min" | "max"]> = [
    [row.bestBuy, finite(input.minBestBuy), "min"],
    [row.bestBuy, finite(input.maxBestBuy), "max"],
    [row.bestSell, finite(input.minBestSell), "min"],
    [row.bestSell, finite(input.maxBestSell), "max"],
    [row.buyOrders, finite(input.minBuyOrders), "min"],
    [row.buyOrders, finite(input.maxBuyOrders), "max"],
    [row.sellOrders, finite(input.minSellOrders), "min"],
    [row.sellOrders, finite(input.maxSellOrders), "max"],
    [row.buyVolume, finite(input.minBuyVolume), "min"],
    [row.sellVolume, finite(input.minSellVolume), "min"],
    [row.sellVolume, finite(input.maxSellVolume), "max"],
    [row.spreadPercent, finite(input.minSpreadPercent), "min"],
    [row.spreadPercent, finite(input.maxSpreadPercent), "max"],
    [row.regionalPremiumPercent, finite(input.minRegionalPremiumPercent), "min"],
    [row.demandSupplyRatio, finite(input.minDemandSupplyRatio), "min"],
    [row.itemVolumeM3, finite(input.maxItemVolumeM3), "max"],
  ];
  return checks.every(([actual, threshold, direction]) => {
    if (threshold == null) return true;
    if (actual == null) return false;
    return direction === "min" ? actual >= threshold : actual <= threshold;
  });
}

function globalSellReference(index: RegionalMarketAggregateIndex, typeId: number, security: RegionalMarketFilterSecurity) {
  return index.cheapestSellByType.get(typeId)?.[security] ?? null;
}

export async function filterRegionalMarket(
  input: RegionalMarketFilterInput = {},
  runtime: RegionalMarketFilterRuntime = {},
): Promise<RegionalMarketFilterResult> {
  const manifest = await loadCurrentMarketRevision();
  const taxonomy = await getMarketTaxonomy();
  const emptyBase = { taxonomy, regionOptions: [] as Array<{ regionId: number; regionName: string }> };
  const security = input.security ?? "all";
  const presence = input.presence ?? "any";
  const signal = input.signal ?? "all";
  const sort = input.sort ?? "signal";
  const query = String(input.query ?? "").trim().toLowerCase();
  const typeIds = numberSet(input.typeIds);
  const categoryIds = numberSet(input.categoryIds);
  const groupIds = numberSet(input.groupIds);
  const marketGroupIds = numberSet(input.marketGroupIds);
  const regionIds = numberSet(input.regionIds);
  const offset = Math.max(0, Math.floor(input.offset ?? 0));
  const limit = Math.max(25, Math.min(1000, Math.floor(input.limit ?? 250)));
  const filters = {
    query,
    typeIds: [...typeIds],
    categoryIds: [...categoryIds],
    groupIds: [...groupIds],
    marketGroupIds: [...marketGroupIds],
    regionIds: [...regionIds],
    security,
    presence,
    signal,
    sort,
  };
  if (!manifest) {
    return {
      available: false,
      message: "Run Sync All to download the current shared public-market generation first.",
      snapshot: null,
      filters,
      ...emptyBase,
      totalRows: 0,
      totalItems: 0,
      offset,
      limit,
      rows: [],
      summary: { supplyGaps: 0, thinSupply: 0, premiumRows: 0, buyPressureRows: 0, regionsRepresented: 0, categoriesRepresented: 0, highestPremiumPercent: 0, highestDemandSupplyRatio: 0 },
    };
  }

  runtime.progress?.({ stage: "regional-filter-index", message: "Preparing the regional market index…", percent: 5 });
  const [index, typeIndex, systemIndex] = await Promise.all([
    buildRegionalMarketAggregateIndex({ progress: runtime.progress }),
    getMarketTypeIndex(),
    getMarketSystemIndex(),
  ]);
  runtime.progress?.({ stage: "regional-filter-scan", message: "Applying regional market filters…", percent: 82 });
  const regionOptions = [...new Map(index.rows.map((row) => [row.regionId, { regionId: row.regionId, regionName: row.regionName }])).values()]
    .sort((a, b) => a.regionName.localeCompare(b.regionName));

  const rows: RegionalMarketFilterRow[] = [];
  const itemIds = new Set<number>();
  const regionsSeen = new Set<number>();
  const categoriesSeen = new Set<number>();
  const typeEligibility = new Map<number, boolean>();
  let supplyGaps = 0;
  let thinSupply = 0;
  let premiumRows = 0;
  let buyPressureRows = 0;
  let highestPremiumPercent = 0;
  let highestDemandSupplyRatio = 0;

  const candidateRows = typeIds.size
    ? [...typeIds].flatMap((typeId) => index.rowsByType.get(typeId) ?? [])
    : index.rows;
  for (const aggregate of candidateRows) {
    if (regionIds.size && !regionIds.has(aggregate.regionId)) continue;
    const meta = typeIndex.get(aggregate.typeId);
    if (!meta) continue;
    let eligible = typeEligibility.get(aggregate.typeId);
    if (eligible == null) {
      eligible =
        (!query || searchText(meta).includes(query)) &&
        (!categoryIds.size || categoryIds.has(meta.categoryId)) &&
        (!groupIds.size || groupIds.has(meta.groupId)) &&
        (!marketGroupIds.size || meta.marketGroupAncestors.some((id) => marketGroupIds.has(id)));
      typeEligibility.set(aggregate.typeId, eligible);
    }
    if (!eligible) continue;

    const metrics = effectiveRegion(aggregate, security);
    if (metrics.buyOrders === 0 && metrics.sellOrders === 0) continue;
    const globalSell = globalSellReference(index, aggregate.typeId, security);
    const spread = spreadPercent(metrics.bestBuy, metrics.bestSell);
    const premium = metrics.bestSell != null && globalSell != null && globalSell.price > 0
      ? ((metrics.bestSell - globalSell.price) / globalSell.price) * 100
      : null;
    const ratio = metrics.sellVolume > 0 ? metrics.buyVolume / metrics.sellVolume : metrics.buyVolume > 0 ? Number.POSITIVE_INFINITY : 0;
    const supplyGap = metrics.buyOrders > 0 && metrics.sellOrders === 0;
    const thin = metrics.sellOrders > 0 && metrics.buyOrders > 0 && (metrics.sellOrders <= 5 || metrics.sellVolume <= Math.max(25, metrics.buyVolume * 0.2));
    const buyPressure = metrics.buyOrders > 0 && (supplyGap || ratio >= 2 || metrics.buyOrders >= Math.max(4, metrics.sellOrders * 2));
    const partial: Omit<RegionalMarketFilterRow, "signalScore"> = {
      typeId: aggregate.typeId,
      item: meta.name,
      categoryId: meta.categoryId,
      category: meta.categoryName,
      groupId: meta.groupId,
      group: meta.groupName,
      marketGroupId: meta.marketGroupId,
      marketGroup: meta.marketGroupName,
      marketGroupPath: meta.marketGroupPathLabel,
      itemVolumeM3: meta.volumeM3,
      regionId: aggregate.regionId,
      region: aggregate.regionName,
      security,
      buyOrders: metrics.buyOrders,
      sellOrders: metrics.sellOrders,
      buyVolume: metrics.buyVolume,
      sellVolume: metrics.sellVolume,
      bestBuy: metrics.bestBuy,
      bestBuySystemId: metrics.bestBuySystemId,
      bestBuySystemName: metrics.bestBuySystemId == null ? null : (systemIndex.get(metrics.bestBuySystemId)?.name ?? `System ${metrics.bestBuySystemId}`),
      bestBuyVolume: metrics.bestBuyVolume,
      bestSell: metrics.bestSell,
      bestSellSystemId: metrics.bestSellSystemId,
      bestSellSystemName: metrics.bestSellSystemId == null ? null : (systemIndex.get(metrics.bestSellSystemId)?.name ?? `System ${metrics.bestSellSystemId}`),
      bestSellVolume: metrics.bestSellVolume,
      spreadPercent: spread,
      globalCheapestSell: globalSell?.price ?? null,
      globalCheapestSellRegion: globalSell?.regionName ?? null,
      regionalPremiumPercent: premium,
      demandSupplyRatio: ratio,
      supplyGap,
      thinSupply: thin,
      buyPressure,
    };
    const row: RegionalMarketFilterRow = { ...partial, signalScore: signalScore(partial) };
    if (!presenceMatches(row, presence) || !signalMatches(row, signal) || !numericMatches(row, input)) continue;
    rows.push(row);
    itemIds.add(row.typeId);
    regionsSeen.add(row.regionId);
    categoriesSeen.add(row.categoryId);
    if (row.supplyGap) supplyGaps += 1;
    if (row.thinSupply) thinSupply += 1;
    if ((row.regionalPremiumPercent ?? 0) > 0) premiumRows += 1;
    if (row.buyPressure) buyPressureRows += 1;
    if (Number.isFinite(row.regionalPremiumPercent)) highestPremiumPercent = Math.max(highestPremiumPercent, row.regionalPremiumPercent ?? 0);
    if (Number.isFinite(row.demandSupplyRatio)) highestDemandSupplyRatio = Math.max(highestDemandSupplyRatio, row.demandSupplyRatio);
  }

  rows.sort(compareRows(sort));
  runtime.progress?.({ stage: "regional-filter-rank", message: `Ranking ${rows.length.toLocaleString()} matching market rows…`, percent: 96 });
  return {
    available: true,
    snapshot: { id: index.snapshotId, createdAt: index.createdAt, orderCount: index.orderCount, regionCount: index.regionCount },
    filters,
    taxonomy,
    regionOptions,
    totalRows: rows.length,
    totalItems: itemIds.size,
    offset: Math.min(offset, rows.length),
    limit,
    rows: rows.slice(offset, offset + limit),
    summary: {
      supplyGaps,
      thinSupply,
      premiumRows,
      buyPressureRows,
      regionsRepresented: regionsSeen.size,
      categoriesRepresented: categoriesSeen.size,
      highestPremiumPercent,
      highestDemandSupplyRatio,
    },
  };
}
