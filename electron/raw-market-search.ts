import { loadLatestMarketDatasetByMode } from "./market-storage";
import {
  loadCurrentRawMarketManifest,
  loadRawMarketRegion,
  type RawMarketSnapshot,
} from "./raw-market-storage";
import {
  getMarketSystemIndex,
  getMarketType,
  searchMarketTypes,
} from "./market-static-index";
import type { MarketOrder } from "./market";

export type RawMarketSearchInput = {
  query: string;
  typeId?: number;
  side?: "all" | "buy" | "sell";
  security?: "all" | "high" | "low" | "null";
  regionId?: number | null;
  minPrice?: number | null;
  maxPrice?: number | null;
  sort?: "sell-lowest" | "buy-highest" | "price-low" | "price-high" | "volume" | "newest";
  offset?: number;
  limit?: number;
};

export type RawMarketSearchOrder = {
  orderId: number;
  typeId: number;
  typeName: string;
  side: "buy" | "sell";
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
  securityStatus: number | null;
  securityBand: "high" | "low" | "null" | "unknown";
  locationId: number;
  locationName: string;
};

export type RawMarketSearchResult = {
  available: boolean;
  message?: string;
  snapshot: null | {
    id: string;
    createdAt: string;
    completedAt?: string;
    orderCount: number;
    regionCount: number;
  };
  query: string;
  typeMatches: Array<{
    typeId: number;
    name: string;
    categoryId: number;
    categoryName: string;
  }>;
  selectedType: null | {
    typeId: number;
    name: string;
    categoryId: number;
    categoryName: string;
  };
  filters: {
    side: "all" | "buy" | "sell";
    security: "all" | "high" | "low" | "null";
    regionId: number | null;
    minPrice: number | null;
    maxPrice: number | null;
    sort: "sell-lowest" | "buy-highest" | "price-low" | "price-high" | "volume" | "newest";
  };
  regionOptions: Array<{ regionId: number; regionName: string }>;
  totalOrders: number;
  buyOrders: number;
  sellOrders: number;
  regionsWithOrders: number;
  bestBuy: number | null;
  bestSell: number | null;
  offset: number;
  limit: number;
  orders: RawMarketSearchOrder[];
};

type CachedTypeOrders = {
  snapshotId: string;
  typeId: number;
  expiresAt: number;
  orders: RawMarketSearchOrder[];
};

let locationNameCache: { datasetCreatedAt: string; names: Map<number, string> } | null = null;
const typeOrderCache = new Map<string, CachedTypeOrders>();

function cleanNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function classifySecurity(value: number | null) {
  if (value == null) return "unknown" as const;
  if (value >= 0.45) return "high" as const;
  if (value > 0) return "low" as const;
  return "null" as const;
}

async function locationNames() {
  const full = await loadLatestMarketDatasetByMode("all");
  if (!full) return new Map<number, string>();
  if (locationNameCache?.datasetCreatedAt === full.createdAt) return locationNameCache.names;
  const names = new Map<number, string>();
  for (const region of full.summaries as Array<{
    items?: Array<{
      topBuyOrders?: Array<{ locationId: number; locationName: string }>;
      topSellOrders?: Array<{ locationId: number; locationName: string }>;
    }>;
  }>) {
    for (const item of region.items ?? []) {
      for (const order of [...(item.topBuyOrders ?? []), ...(item.topSellOrders ?? [])]) {
        if (order.locationName) names.set(order.locationId, order.locationName);
      }
    }
  }
  locationNameCache = { datasetCreatedAt: full.createdAt, names };
  return names;
}

function orderFromRaw(
  raw: MarketOrder,
  typeName: string,
  regionId: number,
  regionName: string,
  systems: Awaited<ReturnType<typeof getMarketSystemIndex>>,
  locations: Map<number, string>,
): RawMarketSearchOrder {
  const system = systems.get(raw.system_id);
  const securityStatus = system?.securityStatus ?? null;
  return {
    orderId: raw.order_id,
    typeId: raw.type_id,
    typeName,
    side: raw.is_buy_order ? "buy" : "sell",
    price: raw.price,
    volumeRemain: raw.volume_remain,
    volumeTotal: raw.volume_total,
    minVolume: raw.min_volume,
    range: raw.range,
    issued: raw.issued,
    durationDays: raw.duration,
    regionId,
    regionName,
    systemId: raw.system_id,
    systemName: system?.name ?? `System ${raw.system_id}`,
    securityStatus,
    securityBand: system?.securityBand ?? classifySecurity(securityStatus),
    locationId: raw.location_id,
    locationName: locations.get(raw.location_id) ?? `Location ${raw.location_id}`,
  };
}

async function loadTypeOrders(snapshot: RawMarketSnapshot, typeId: number, typeName: string) {
  const key = `${snapshot.id}:${typeId}`;
  const cached = typeOrderCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.orders;

  const systems = await getMarketSystemIndex();
  const locations = await locationNames();
  const orders: RawMarketSearchOrder[] = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(6, snapshot.regions.length) }, async () => {
    while (cursor < snapshot.regions.length) {
      const entry = snapshot.regions[cursor++];
      const region = await loadRawMarketRegion(entry.regionId, snapshot);
      if (!region) continue;
      for (const raw of region.orders) {
        if (raw.type_id !== typeId) continue;
        orders.push(orderFromRaw(raw, typeName, entry.regionId, entry.regionName, systems, locations));
      }
    }
  });
  await Promise.all(workers);
  typeOrderCache.set(key, {
    snapshotId: snapshot.id,
    typeId,
    orders,
    expiresAt: Date.now() + 5 * 60 * 1000,
  });
  for (const [cacheKey, value] of typeOrderCache) {
    if (value.expiresAt <= Date.now() || value.snapshotId !== snapshot.id) typeOrderCache.delete(cacheKey);
  }
  return orders;
}

function sortOrders(orders: RawMarketSearchOrder[], sort: RawMarketSearchResult["filters"]["sort"]) {
  const copy = [...orders];
  if (sort === "buy-highest")
    return copy.sort((a, b) => {
      if (a.side !== b.side) return a.side === "buy" ? -1 : 1;
      return a.side === "buy" ? b.price - a.price || b.volumeRemain - a.volumeRemain : a.price - b.price || b.volumeRemain - a.volumeRemain;
    });
  if (sort === "price-low") return copy.sort((a, b) => a.price - b.price || b.volumeRemain - a.volumeRemain);
  if (sort === "price-high") return copy.sort((a, b) => b.price - a.price || b.volumeRemain - a.volumeRemain);
  if (sort === "volume") return copy.sort((a, b) => b.volumeRemain - a.volumeRemain || a.price - b.price);
  if (sort === "newest") return copy.sort((a, b) => Date.parse(b.issued) - Date.parse(a.issued));
  return copy.sort((a, b) => {
    if (a.side !== b.side) return a.side === "sell" ? -1 : 1;
    return a.side === "sell" ? a.price - b.price || b.volumeRemain - a.volumeRemain : b.price - a.price || b.volumeRemain - a.volumeRemain;
  });
}

function emptyResult(
  input: RawMarketSearchInput,
  typeMatches: RawMarketSearchResult["typeMatches"],
  snapshot: RawMarketSnapshot | null,
  selectedType: RawMarketSearchResult["selectedType"] = null,
  message?: string,
): RawMarketSearchResult {
  const limit = Math.max(25, Math.min(500, input.limit ?? 200));
  return {
    available: Boolean(snapshot?.complete),
    message,
    snapshot: snapshot
      ? {
          id: snapshot.id,
          createdAt: snapshot.createdAt,
          completedAt: snapshot.completedAt,
          orderCount: snapshot.orderCount,
          regionCount: snapshot.regionCount,
        }
      : null,
    query: input.query,
    typeMatches,
    selectedType,
    filters: {
      side: input.side ?? "all",
      security: input.security ?? "all",
      regionId: cleanNumber(input.regionId),
      minPrice: cleanNumber(input.minPrice),
      maxPrice: cleanNumber(input.maxPrice),
      sort: input.sort ?? "sell-lowest",
    },
    regionOptions: snapshot?.regions.map((region) => ({ regionId: region.regionId, regionName: region.regionName })) ?? [],
    totalOrders: 0,
    buyOrders: 0,
    sellOrders: 0,
    regionsWithOrders: 0,
    bestBuy: null,
    bestSell: null,
    offset: Math.max(0, input.offset ?? 0),
    limit,
    orders: [],
  };
}

export async function searchRawMarketOrders(input: RawMarketSearchInput): Promise<RawMarketSearchResult> {
  const query = String(input.query ?? "").trim();
  const snapshot = await loadCurrentRawMarketManifest("all");
  const typeMatches = query ? await searchMarketTypes(query, 75) : [];
  if (!snapshot?.complete)
    return emptyResult(
      { ...input, query },
      typeMatches,
      snapshot,
      null,
      "No complete raw all-region order book is available yet. Run Refresh everything to build it.",
    );
  if (!query && !input.typeId)
    return emptyResult({ ...input, query }, typeMatches, snapshot, null, "Search for an item name.");

  let selected = input.typeId ? await getMarketType(input.typeId) : null;
  if (!selected) {
    const exact = typeMatches.find((type) => type.name.toLowerCase() === query.toLowerCase());
    if (exact) selected = exact;
    else if (typeMatches.length === 1) selected = typeMatches[0];
  }
  if (!selected) {
    return emptyResult(
      { ...input, query },
      typeMatches,
      snapshot,
      null,
      typeMatches.length ? "Choose an item to load its complete all-region order book." : "No published market item matches that search.",
    );
  }

  const allOrders = await loadTypeOrders(snapshot, selected.typeId, selected.name);
  const side = input.side ?? "all";
  const security = input.security ?? "all";
  const regionId = cleanNumber(input.regionId);
  const minPrice = cleanNumber(input.minPrice);
  const maxPrice = cleanNumber(input.maxPrice);
  const sort = input.sort ?? "sell-lowest";
  const filtered = allOrders.filter((order) =>
    (side === "all" || order.side === side) &&
    (security === "all" || order.securityBand === security) &&
    (regionId == null || order.regionId === regionId) &&
    (minPrice == null || order.price >= minPrice) &&
    (maxPrice == null || order.price <= maxPrice),
  );
  const sorted = sortOrders(filtered, sort);
  const offset = Math.max(0, Math.min(sorted.length, input.offset ?? 0));
  const limit = Math.max(25, Math.min(500, input.limit ?? 200));
  const buyPrices = filtered.filter((order) => order.side === "buy").map((order) => order.price);
  const sellPrices = filtered.filter((order) => order.side === "sell").map((order) => order.price);
  return {
    available: true,
    snapshot: {
      id: snapshot.id,
      createdAt: snapshot.createdAt,
      completedAt: snapshot.completedAt,
      orderCount: snapshot.orderCount,
      regionCount: snapshot.regionCount,
    },
    query,
    typeMatches,
    selectedType: selected,
    filters: { side, security, regionId, minPrice, maxPrice, sort },
    regionOptions: snapshot.regions.map((region) => ({ regionId: region.regionId, regionName: region.regionName })),
    totalOrders: filtered.length,
    buyOrders: filtered.filter((order) => order.side === "buy").length,
    sellOrders: filtered.filter((order) => order.side === "sell").length,
    regionsWithOrders: new Set(filtered.map((order) => order.regionId)).size,
    bestBuy: buyPrices.length ? Math.max(...buyPrices) : null,
    bestSell: sellPrices.length ? Math.min(...sellPrices) : null,
    offset,
    limit,
    orders: sorted.slice(offset, offset + limit),
  };
}
