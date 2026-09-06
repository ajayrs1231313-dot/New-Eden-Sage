import { resolveMarketLocationNames } from "./market";
import { getMarketSystemIndex, getMarketType, searchMarketTypes } from "./market-static-index";
import { searchRawMarketOrders, type RawMarketSearchInput, type RawMarketSearchOrder, type RawMarketSearchResult } from "./raw-market-search";
import { loadSharedFullMarketAnalysisIndex } from "./shared-market-data";
import { universeRoute } from "./universe-route-graph";

export type McpMarketRegionalBest = {
  kind: "regional-best";
  side: "buy" | "sell";
  price: number;
  volumeRemain: number;
  orderId: number | null;
  locationId: number | null;
  locationName: string;
  locationResolved: boolean;
  regionId: number;
  regionName: string;
  systemId: number;
  systemName: string;
  securityStatus: number | null;
  securityBand: "high" | "low" | "null" | "unknown";
  jumpsFromOrigin: number | null;
  sourceOrderCount: number;
  sourceVolume: number;
};

export type McpMarketSearchResult = RawMarketSearchResult & {
  coverage: {
    source: "raw-complete" | "shared-prepared" | "unavailable";
    completeOrderCoverage: boolean;
    sourceOrders: number;
    candidateDepthPerSide: number | null;
    note: string;
  };
  regionalBest: McpMarketRegionalBest[];
};

type NormalizedFilters = RawMarketSearchResult["filters"];

function cleanNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeFilters(input: RawMarketSearchInput): NormalizedFilters {
  return {
    side: input.side ?? "all",
    security: input.security ?? "all",
    regionId: cleanNumber(input.regionId),
    minPrice: cleanNumber(input.minPrice),
    maxPrice: cleanNumber(input.maxPrice),
    minVolume: cleanNumber(input.minVolume),
    systemNames: Array.isArray(input.systemNames) ? input.systemNames.map(String) : [],
    systemQuery: String(input.systemQuery ?? ""),
    locationQuery: String(input.locationQuery ?? ""),
    originSystemId: cleanNumber(input.originSystemId),
    maxJumps: cleanNumber(input.maxJumps),
    sort: input.sort ?? "sell-lowest",
  };
}

function classifySecurity(value: number | null) {
  if (value == null) return "unknown" as const;
  if (value >= 0.45) return "high" as const;
  if (value > 0) return "low" as const;
  return "null" as const;
}

function candidateOrder(order: any, side: "buy" | "sell", typeName: string): RawMarketSearchOrder {
  return {
    orderId: Number(order.orderId),
    typeId: Number(order.typeId),
    typeName,
    side,
    price: Number(order.price),
    volumeRemain: Number(order.volumeRemain),
    volumeTotal: Number(order.volumeTotal ?? order.volumeRemain),
    minVolume: Number(order.minVolume ?? 1),
    range: String(order.range ?? ""),
    issued: String(order.issued ?? ""),
    durationDays: Number(order.durationDays ?? 0),
    regionId: Number(order.regionId),
    regionName: String(order.regionName ?? `Region ${order.regionId}`),
    systemId: Number(order.systemId),
    systemName: String(order.systemName ?? `System ${order.systemId}`),
    securityStatus: cleanNumber(order.securityStatus),
    securityBand: order.securityBand === "high" || order.securityBand === "low" || order.securityBand === "null"
      ? order.securityBand
      : classifySecurity(cleanNumber(order.securityStatus)),
    locationId: Number(order.locationId),
    locationName: String(order.locationName ?? `Location ${order.locationId}`),
    jumpsFromOrigin: null,
  };
}

function filterCandidate(order: RawMarketSearchOrder, filters: NormalizedFilters, systemNames: Set<string>, systemQuery: string, locationQuery: string) {
  return (filters.side === "all" || order.side === filters.side) &&
    (filters.security === "all" || order.securityBand === filters.security) &&
    (filters.regionId == null || order.regionId === filters.regionId) &&
    (filters.minPrice == null || order.price >= filters.minPrice) &&
    (filters.maxPrice == null || order.price <= filters.maxPrice) &&
    (filters.minVolume == null || order.volumeRemain >= filters.minVolume) &&
    (!systemNames.size || systemNames.has(order.systemName.toLowerCase())) &&
    (!systemQuery || order.systemName.toLowerCase().includes(systemQuery)) &&
    (!locationQuery || order.locationName.toLowerCase().includes(locationQuery));
}

function filterRegionalBest(order: McpMarketRegionalBest, filters: NormalizedFilters, systemNames: Set<string>, systemQuery: string, locationQuery: string) {
  return (filters.side === "all" || order.side === filters.side) &&
    (filters.security === "all" || order.securityBand === filters.security) &&
    (filters.regionId == null || order.regionId === filters.regionId) &&
    (filters.minPrice == null || order.price >= filters.minPrice) &&
    (filters.maxPrice == null || order.price <= filters.maxPrice) &&
    (filters.minVolume == null || order.volumeRemain >= filters.minVolume) &&
    (!systemNames.size || systemNames.has(order.systemName.toLowerCase())) &&
    (!systemQuery || order.systemName.toLowerCase().includes(systemQuery)) &&
    (!locationQuery || order.locationName.toLowerCase().includes(locationQuery));
}

function sortCandidateOrders(orders: RawMarketSearchOrder[], sort: NormalizedFilters["sort"]) {
  const copy = [...orders];
  if (sort === "buy-highest") return copy.sort((a, b) => a.side !== b.side ? (a.side === "buy" ? -1 : 1) : a.side === "buy" ? b.price - a.price || b.volumeRemain - a.volumeRemain : a.price - b.price || b.volumeRemain - a.volumeRemain);
  if (sort === "price-low") return copy.sort((a, b) => a.price - b.price || b.volumeRemain - a.volumeRemain);
  if (sort === "price-high") return copy.sort((a, b) => b.price - a.price || b.volumeRemain - a.volumeRemain);
  if (sort === "volume") return copy.sort((a, b) => b.volumeRemain - a.volumeRemain || a.price - b.price);
  if (sort === "newest") return copy.sort((a, b) => Date.parse(b.issued) - Date.parse(a.issued));
  if (sort === "distance") return copy.sort((a, b) => {
    const distance = Number(a.jumpsFromOrigin ?? 999) - Number(b.jumpsFromOrigin ?? 999);
    if (distance) return distance;
    if (a.side !== b.side) return a.side === "buy" ? -1 : 1;
    return a.side === "buy" ? b.price - a.price || b.volumeRemain - a.volumeRemain : a.price - b.price || b.volumeRemain - a.volumeRemain;
  });
  return copy.sort((a, b) => a.side !== b.side ? (a.side === "sell" ? -1 : 1) : a.side === "sell" ? a.price - b.price || b.volumeRemain - a.volumeRemain : b.price - a.price || b.volumeRemain - a.volumeRemain);
}

function sortRegionalBest(orders: McpMarketRegionalBest[], sort: NormalizedFilters["sort"]) {
  const copy = [...orders];
  if (sort === "buy-highest") return copy.sort((a, b) => a.side !== b.side ? (a.side === "buy" ? -1 : 1) : a.side === "buy" ? b.price - a.price : a.price - b.price);
  if (sort === "price-low") return copy.sort((a, b) => a.price - b.price);
  if (sort === "price-high") return copy.sort((a, b) => b.price - a.price);
  if (sort === "volume") return copy.sort((a, b) => b.volumeRemain - a.volumeRemain || a.price - b.price);
  if (sort === "distance") return copy.sort((a, b) => Number(a.jumpsFromOrigin ?? 999) - Number(b.jumpsFromOrigin ?? 999) || (a.side === "buy" ? b.price - a.price : a.price - b.price));
  return copy.sort((a, b) => a.side !== b.side ? (a.side === "sell" ? -1 : 1) : a.side === "sell" ? a.price - b.price : b.price - a.price);
}

async function addJumpDistances<T extends { systemId: number; jumpsFromOrigin: number | null }>(orders: T[], originSystemId: number | null, maxJumps: number | null, jumpBySystem: Map<number, number>) {
  if (originSystemId == null) return orders;
  for (const systemId of new Set(orders.map((order) => order.systemId))) {
    if (jumpBySystem.has(systemId)) continue;
    const route = await universeRoute(originSystemId, systemId);
    jumpBySystem.set(systemId, route.jumps);
  }
  return orders
    .map((order) => ({ ...order, jumpsFromOrigin: jumpBySystem.get(order.systemId) ?? 999 }))
    .filter((order) => maxJumps == null || Number(order.jumpsFromOrigin ?? 999) <= maxJumps) as T[];
}

export async function searchMcpMarketOrders(input: RawMarketSearchInput): Promise<McpMarketSearchResult> {
  const exact = await searchRawMarketOrders(input);
  if (exact.available) {
    return {
      ...exact,
      coverage: {
        source: "raw-complete",
        completeOrderCoverage: true,
        sourceOrders: exact.snapshot?.orderCount ?? exact.totalOrders,
        candidateDepthPerSide: null,
        note: "Exact retained all-region order-book search. All requested filters are applied before pagination.",
      },
      regionalBest: [],
    };
  }

  const shared = await loadSharedFullMarketAnalysisIndex();
  if (!shared) {
    return {
      ...exact,
      coverage: { source: "unavailable", completeOrderCoverage: false, sourceOrders: 0, candidateDepthPerSide: null, note: exact.message ?? "No Sage market generation is available." },
      regionalBest: [],
    };
  }

  const query = String(input.query ?? "").trim();
  const typeMatches = query ? await searchMarketTypes(query, 75) : [];
  let selected = input.typeId ? await getMarketType(input.typeId) : null;
  if (!selected) {
    const exactType = typeMatches.find((type) => type.name.toLowerCase() === query.toLowerCase());
    if (exactType) selected = exactType;
    else if (typeMatches.length === 1) selected = typeMatches[0];
  }
  const filters = normalizeFilters({ ...input, query });
  const limit = Math.max(25, Math.min(500, input.limit ?? 200));
  const offsetRequested = Math.max(0, input.offset ?? 0);
  const base = {
    available: true,
    snapshot: { id: shared.snapshotId, createdAt: shared.createdAt, orderCount: shared.orderCount, regionCount: shared.regionCount },
    query,
    typeMatches,
    selectedType: selected,
    filters,
    regionOptions: [] as Array<{ regionId: number; regionName: string }>,
    totalOrders: 0,
    buyOrders: 0,
    sellOrders: 0,
    regionsWithOrders: 0,
    bestBuy: null as number | null,
    bestSell: null as number | null,
    offset: offsetRequested,
    limit,
    orders: [] as RawMarketSearchOrder[],
    coverage: {
      source: "shared-prepared" as const,
      completeOrderCoverage: false,
      sourceOrders: shared.orderCount,
      candidateDepthPerSide: shared.candidateDepthPerSide,
      note: `The shared generation accounts for all ${shared.orderCount.toLocaleString()} source orders in exact regional/security aggregates and retains the strongest ${shared.candidateDepthPerSide} executable orders per side for full order-level system/location/distance filtering. regionalBest contains exact best-price signals from all source orders; order-level filters beyond retained candidate depth can omit non-best orders.`,
    },
    regionalBest: [] as McpMarketRegionalBest[],
  };
  if (!query && !input.typeId) return { ...base, message: "Search for an item name or provide typeId." };
  if (!selected) return { ...base, message: typeMatches.length ? "Choose one matching item or provide typeId." : "No published market item matches that search." };
  const item = shared.items.get(selected.typeId);
  if (!item) return { ...base, message: "That published item has no orders in the installed Sage market generation." };

  base.regionOptions = Object.values(item.regions)
    .map((region) => ({ regionId: region.regionId, regionName: region.regionName }))
    .sort((a, b) => a.regionName.localeCompare(b.regionName));
  const systemIndex = await getMarketSystemIndex();
  let candidateOrders = [
    ...item.buys.map((order) => candidateOrder(order, "buy", selected.name)),
    ...item.sells.map((order) => candidateOrder(order, "sell", selected.name)),
  ];
  const unresolvedLocationIds = candidateOrders
    .filter((order) => !order.locationName || /^Location \d+$/.test(order.locationName))
    .map((order) => order.locationId);
  if (unresolvedLocationIds.length) {
    const resolvedLocations = await resolveMarketLocationNames(unresolvedLocationIds);
    candidateOrders = candidateOrders.map((order) => ({
      ...order,
      locationName: resolvedLocations.get(order.locationId) ?? order.locationName,
    }));
  }
  const regionalBest: McpMarketRegionalBest[] = [];
  for (const region of Object.values(item.regions)) {
    const metrics = filters.security === "all" ? region : region.security?.[filters.security];
    if (!metrics) continue;
    for (const side of ["buy", "sell"] as const) {
      if (filters.side !== "all" && filters.side !== side) continue;
      const price = side === "buy" ? metrics.bestBuy : metrics.bestSell;
      const systemId = side === "buy" ? metrics.bestBuySystemId : metrics.bestSellSystemId;
      if (price == null || systemId == null) continue;
      const system = systemIndex.get(systemId);
      const preparedOrderId = cleanNumber(side === "buy" ? metrics.bestBuyOrderId : metrics.bestSellOrderId);
      const preparedLocationId = cleanNumber(side === "buy" ? metrics.bestBuyLocationId : metrics.bestSellLocationId);
      const preparedLocationName = String(side === "buy" ? (metrics.bestBuyLocationName ?? "") : (metrics.bestSellLocationName ?? "")).trim();
      const retainedWinner = candidateOrders
        .filter((order) => order.side === side && order.regionId === region.regionId && order.systemId === systemId && order.price === price)
        .sort((left, right) => right.volumeRemain - left.volumeRemain || left.orderId - right.orderId)[0];
      const locationId = preparedLocationId ?? retainedWinner?.locationId ?? null;
      const locationName = preparedLocationName || retainedWinner?.locationName || (locationId != null ? `Location ${locationId}` : (side === "buy" ? (metrics.bestBuySystemName ?? system?.name ?? `System ${systemId}`) : (metrics.bestSellSystemName ?? system?.name ?? `System ${systemId}`)));
      regionalBest.push({
        kind: "regional-best",
        side,
        price,
        volumeRemain: side === "buy" ? metrics.bestBuyVolume : metrics.bestSellVolume,
        orderId: preparedOrderId ?? retainedWinner?.orderId ?? null,
        locationId,
        locationName,
        locationResolved: locationId != null && !/^(?:Location|Structure) \d+$|^Unresolved market location$/i.test(locationName),
        regionId: region.regionId,
        regionName: region.regionName,
        systemId,
        systemName: side === "buy"
          ? (metrics.bestBuySystemName ?? system?.name ?? `System ${systemId}`)
          : (metrics.bestSellSystemName ?? system?.name ?? `System ${systemId}`),
        securityStatus: system?.securityStatus ?? null,
        securityBand: filters.security === "all" ? (system?.securityBand ?? classifySecurity(system?.securityStatus ?? null)) : filters.security,
        jumpsFromOrigin: null,
        sourceOrderCount: side === "buy" ? metrics.buyOrders : metrics.sellOrders,
        sourceVolume: side === "buy" ? metrics.buyVolume : metrics.sellVolume,
      });
    }
  }

  const unresolvedRegionalLocationIds = regionalBest
    .filter((row) => row.locationId != null && !row.locationResolved)
    .map((row) => Number(row.locationId));
  if (unresolvedRegionalLocationIds.length) {
    const resolvedLocations = await resolveMarketLocationNames(unresolvedRegionalLocationIds);
    for (const row of regionalBest) {
      if (row.locationId == null || row.locationResolved) continue;
      const resolved = resolvedLocations.get(row.locationId);
      if (resolved) {
        row.locationName = resolved;
        row.locationResolved = true;
      }
    }
  }

  const systemNames = new Set(filters.systemNames.map((name) => name.trim().toLowerCase()).filter(Boolean));
  const systemQuery = filters.systemQuery.trim().toLowerCase();
  const locationQuery = filters.locationQuery.trim().toLowerCase();
  candidateOrders = candidateOrders.filter((order) => filterCandidate(order, filters, systemNames, systemQuery, locationQuery));
  let filteredRegional = regionalBest.filter((order) => filterRegionalBest(order, filters, systemNames, systemQuery, locationQuery));
  const jumpBySystem = new Map<number, number>();
  candidateOrders = await addJumpDistances(candidateOrders, filters.originSystemId, filters.maxJumps, jumpBySystem);
  filteredRegional = await addJumpDistances(filteredRegional, filters.originSystemId, filters.maxJumps, jumpBySystem);
  const sortedOrders = sortCandidateOrders(candidateOrders, filters.sort);
  const sortedRegional = sortRegionalBest(filteredRegional, filters.sort);
  const offset = Math.max(0, Math.min(sortedOrders.length, offsetRequested));
  const buyPrices = [
    ...candidateOrders.filter((order) => order.side === "buy").map((order) => order.price),
    ...filteredRegional.filter((order) => order.side === "buy").map((order) => order.price),
  ];
  const sellPrices = [
    ...candidateOrders.filter((order) => order.side === "sell").map((order) => order.price),
    ...filteredRegional.filter((order) => order.side === "sell").map((order) => order.price),
  ];
  return {
    ...base,
    totalOrders: candidateOrders.length,
    buyOrders: candidateOrders.filter((order) => order.side === "buy").length,
    sellOrders: candidateOrders.filter((order) => order.side === "sell").length,
    regionsWithOrders: new Set([...candidateOrders.map((order) => order.regionId), ...filteredRegional.map((order) => order.regionId)]).size,
    bestBuy: buyPrices.length ? Math.max(...buyPrices) : null,
    bestSell: sellPrices.length ? Math.min(...sellPrices) : null,
    offset,
    orders: sortedOrders.slice(offset, offset + limit),
    regionalBest: sortedRegional,
  };
}
