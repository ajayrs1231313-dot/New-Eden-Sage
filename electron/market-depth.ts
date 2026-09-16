import type { MarketOrder } from "./market";
import { getMarketType, searchMarketTypes } from "./market-static-index";
import { loadCurrentRawMarketManifest, loadRawMarketRegion } from "./raw-market-storage";
import { loadSharedMarketHubDepthDataset } from "./shared-market-data";

export const THE_FORGE_REGION_ID = 10000002;
export const JITA_44_LOCATION_ID = 60003760;
export const JITA_44_NAME = "Jita IV - Moon 4 - Caldari Navy Assembly Plant";

export type MarketDepthSide = "buy" | "sell";

export type MarketDepthInputItem = {
  typeId?: number;
  name?: string;
  quantity: number;
};

export type MarketDepthQuoteInput = {
  items?: MarketDepthInputItem[];
  typeId?: number;
  name?: string;
  quantity?: number;
  regionId?: number;
  locationId?: number;
  side?: MarketDepthSide;
  fresh?: boolean;
};

export type MarketDepthFill = {
  orderId: number;
  price: number;
  availableVolume: number;
  minVolume: number;
  quantity: number;
  realisedIsk: number;
  remainingRequestedAfter: number;
};

export type MarketDepthItemQuote = {
  inputName: string | null;
  itemName: string;
  typeId: number | null;
  requestedQuantity: number;
  filledQuantity: number;
  unfilledQuantity: number;
  highestBidUsed: number | null;
  lowestBidCrossed: number | null;
  lowestAskUsed: number | null;
  highestAskCrossed: number | null;
  weightedAverageRealisedUnitPrice: number | null;
  ordersConsumed: number;
  ordersCrossed: number;
  ordersExamined: number;
  ordersSkippedForMinVolume: number;
  totalRealisedIsk: number;
  unfilledReferenceValueIsk: number | null;
  fullMarketDepthSufficient: boolean;
  fills: MarketDepthFill[];
  error?: string;
};

export type MarketDepthQuote = {
  schemaVersion: 1;
  quoteType: "market-depth";
  createdAt: string;
  regionId: number;
  locationId: number;
  locationName: string;
  side: MarketDepthSide;
  source: {
    kind: "shared-hub-depth" | "raw-region" | "esi-live" | "mixed";
    createdAt: string;
    completeOrderCoverage: true;
    freshRequested: boolean;
  };
  items: MarketDepthItemQuote[];
  grandTotalRealisedIsk: number;
  totalRequestedQuantity: number;
  totalFilledQuantity: number;
  totalUnfilledQuantity: number;
  totalUnfilledReferenceValueIsk: number | null;
  fullMarketDepthSufficient: boolean;
};

type ResolvedType = { typeId: number; name: string };
type OrderLoad = { orders: MarketOrder[]; source: MarketDepthQuote["source"]["kind"]; createdAt: string };

const HEADERS = {
  Accept: "application/json",
  "X-Compatibility-Date": "2026-08-02",
  "X-User-Agent": "NewEdenSage-MarketDepth/1.0",
};
const liveOrderCache = new Map<string, { expiresAt: number; value: Promise<OrderLoad> }>();

function normalizedItems(input: MarketDepthQuoteInput): MarketDepthInputItem[] {
  if (Array.isArray(input.items) && input.items.length) return input.items;
  if (input.typeId != null || input.name != null || input.quantity != null) {
    return [{ typeId: input.typeId, name: input.name, quantity: Number(input.quantity) }];
  }
  return [];
}

async function resolveInputType(input: MarketDepthInputItem): Promise<ResolvedType | null> {
  if (Number.isSafeInteger(Number(input.typeId)) && Number(input.typeId) > 0) {
    const type = await getMarketType(Number(input.typeId));
    return type ? { typeId: type.typeId, name: type.name } : null;
  }
  const requested = String(input.name ?? "").trim();
  if (!requested) return null;
  const candidates = await searchMarketTypes(requested, 200);
  const lower = requested.toLowerCase();
  let exact = candidates.find((type) => type.name.toLowerCase() === lower);
  if (exact) return { typeId: exact.typeId, name: exact.name };

  // Common mining shorthand: "Omber II" means the literal EVE type "Omber II-Grade".
  const quality = requested.match(/^(.+?)\s+(II|III|IV)$/i);
  if (quality) {
    const canonical = `${quality[1].trim()} ${quality[2].toUpperCase()}-Grade`.toLowerCase();
    exact = candidates.find((type) => type.name.toLowerCase() === canonical);
    if (exact) return { typeId: exact.typeId, name: exact.name };
  }
  return null;
}

function errorQuote(input: MarketDepthInputItem, message: string): MarketDepthItemQuote {
  const quantity = Number.isFinite(Number(input.quantity)) ? Number(input.quantity) : 0;
  return {
    inputName: input.name?.trim() || null,
    itemName: input.name?.trim() || (input.typeId ? `Type ${input.typeId}` : "Unknown item"),
    typeId: Number.isSafeInteger(Number(input.typeId)) && Number(input.typeId) > 0 ? Number(input.typeId) : null,
    requestedQuantity: quantity,
    filledQuantity: 0,
    unfilledQuantity: quantity > 0 ? quantity : 0,
    highestBidUsed: null,
    lowestBidCrossed: null,
    lowestAskUsed: null,
    highestAskCrossed: null,
    weightedAverageRealisedUnitPrice: null,
    ordersConsumed: 0,
    ordersCrossed: 0,
    ordersExamined: 0,
    ordersSkippedForMinVolume: 0,
    totalRealisedIsk: 0,
    unfilledReferenceValueIsk: null,
    fullMarketDepthSufficient: false,
    fills: [],
    error: message,
  };
}

export function quoteMarketDepthFromOrders(input: {
  orders: MarketOrder[];
  typeId: number;
  itemName: string;
  inputName?: string | null;
  quantity: number;
  locationId: number;
  side: MarketDepthSide;
}): MarketDepthItemQuote {
  const requestedQuantity = Number(input.quantity);
  if (!Number.isSafeInteger(requestedQuantity) || requestedQuantity <= 0) {
    return errorQuote({ typeId: input.typeId, name: input.inputName ?? input.itemName, quantity: requestedQuantity }, "Quantity must be a positive whole number.");
  }

  const wantsBuyOrders = input.side === "buy";
  const candidates = input.orders
    .filter((order) =>
      Number(order.type_id) === input.typeId
      && Number(order.location_id) === input.locationId
      && Boolean(order.is_buy_order) === wantsBuyOrders
      && Number(order.volume_remain) > 0
      && Number(order.price) > 0)
    .sort((left, right) =>
      wantsBuyOrders
        ? Number(right.price) - Number(left.price) || Number(left.order_id) - Number(right.order_id)
        : Number(left.price) - Number(right.price) || Number(left.order_id) - Number(right.order_id));

  let remaining = requestedQuantity;
  let realised = 0;
  let examined = 0;
  let skippedForMin = 0;
  const fills: MarketDepthFill[] = [];

  for (const order of candidates) {
    if (remaining <= 0) break;
    examined += 1;
    const available = Math.max(0, Math.floor(Number(order.volume_remain)));
    const configuredMin = Math.max(1, Math.floor(Number(order.min_volume) || 1));
    const effectiveMin = Math.min(configuredMin, available);
    const quantity = Math.min(remaining, available);
    if (quantity < effectiveMin) {
      skippedForMin += 1;
      continue;
    }
    const price = Number(order.price);
    const lineValue = quantity * price;
    remaining -= quantity;
    realised += lineValue;
    fills.push({
      orderId: Number(order.order_id),
      price,
      availableVolume: available,
      minVolume: configuredMin,
      quantity,
      realisedIsk: lineValue,
      remainingRequestedAfter: remaining,
    });
  }

  const filled = requestedQuantity - remaining;
  const weighted = filled > 0 ? realised / filled : null;
  const first = fills[0]?.price ?? null;
  const last = fills.at(-1)?.price ?? null;
  const unfilledReference = remaining > 0 && last != null ? remaining * last : null;
  return {
    inputName: input.inputName ?? null,
    itemName: input.itemName,
    typeId: input.typeId,
    requestedQuantity,
    filledQuantity: filled,
    unfilledQuantity: remaining,
    highestBidUsed: wantsBuyOrders ? first : null,
    lowestBidCrossed: wantsBuyOrders ? last : null,
    lowestAskUsed: wantsBuyOrders ? null : first,
    highestAskCrossed: wantsBuyOrders ? null : last,
    weightedAverageRealisedUnitPrice: weighted,
    ordersConsumed: fills.length,
    ordersCrossed: fills.length,
    ordersExamined: examined,
    ordersSkippedForMinVolume: skippedForMin,
    totalRealisedIsk: realised,
    unfilledReferenceValueIsk: unfilledReference,
    fullMarketDepthSufficient: remaining === 0,
    fills,
  };
}

async function fetchEsiOrders(regionId: number, typeId: number, side: MarketDepthSide, fresh: boolean): Promise<OrderLoad> {
  const key = `${regionId}:${typeId}:${side}`;
  const cached = liveOrderCache.get(key);
  if (!fresh && cached && cached.expiresAt > Date.now()) return cached.value;
  const value = (async () => {
    const base = `https://esi.evetech.net/markets/${regionId}/orders/?datasource=tranquility&order_type=${side}&type_id=${typeId}`;
    const firstResponse = await fetch(`${base}&page=1`, { headers: HEADERS, signal: AbortSignal.timeout(30_000) });
    if (!firstResponse.ok) throw new Error(`ESI market depth request failed (${firstResponse.status}).`);
    const first = await firstResponse.json() as MarketOrder[];
    const pages = Math.max(1, Number(firstResponse.headers.get("x-pages") ?? 1));
    const remainingPages = Array.from({ length: Math.max(0, pages - 1) }, (_, index) => index + 2);
    const chunks: MarketOrder[][] = [];
    for (let offset = 0; offset < remainingPages.length; offset += 4) {
      chunks.push(...await Promise.all(remainingPages.slice(offset, offset + 4).map(async (page) => {
        const response = await fetch(`${base}&page=${page}`, { headers: HEADERS, signal: AbortSignal.timeout(30_000) });
        if (response.status === 404) return [];
        if (!response.ok) throw new Error(`ESI market depth page ${page} failed (${response.status}).`);
        return await response.json() as MarketOrder[];
      })));
    }
    return { orders: first.concat(...chunks), source: "esi-live" as const, createdAt: new Date().toISOString() };
  })();
  liveOrderCache.set(key, { expiresAt: Date.now() + 60_000, value });
  try {
    return await value;
  } catch (error) {
    liveOrderCache.delete(key);
    throw error;
  }
}

async function loadOrders(regionId: number, locationId: number, typeId: number, side: MarketDepthSide, fresh: boolean): Promise<OrderLoad> {
  if (!fresh) {
    const hub = await loadSharedMarketHubDepthDataset();
    if (hub && hub.regionId === regionId && hub.locationId === locationId) {
      return {
        orders: hub.orders.filter((order) => Number(order.type_id) === typeId && Boolean(order.is_buy_order) === (side === "buy")),
        source: "shared-hub-depth",
        createdAt: hub.createdAt,
      };
    }
    const manifest = await loadCurrentRawMarketManifest("all");
    if (manifest?.complete) {
      const region = await loadRawMarketRegion(regionId, manifest);
      if (region) {
        return {
          orders: region.orders.filter((order) => Number(order.type_id) === typeId && Boolean(order.is_buy_order) === (side === "buy")),
          source: "raw-region",
          createdAt: region.snapshotCreatedAt,
        };
      }
    }
  }
  return fetchEsiOrders(regionId, typeId, side, fresh);
}

export async function quoteMarketDepth(input: MarketDepthQuoteInput): Promise<MarketDepthQuote> {
  const regionId = Number(input.regionId ?? THE_FORGE_REGION_ID);
  const locationId = Number(input.locationId ?? JITA_44_LOCATION_ID);
  const side: MarketDepthSide = input.side === "sell" ? "sell" : "buy";
  const requestedItems = normalizedItems(input);
  const results: MarketDepthItemQuote[] = [];
  const sources: OrderLoad[] = [];

  for (const requested of requestedItems) {
    const quantity = Number(requested.quantity);
    if (!Number.isSafeInteger(quantity) || quantity <= 0) {
      results.push(errorQuote(requested, "Quantity must be a positive whole number."));
      continue;
    }
    const type = await resolveInputType(requested);
    if (!type) {
      results.push(errorQuote(requested, `Unknown EVE market type${requested.name ? `: ${requested.name}` : requested.typeId ? ` ID ${requested.typeId}` : ""}.`));
      continue;
    }
    try {
      const loaded = await loadOrders(regionId, locationId, type.typeId, side, input.fresh === true);
      sources.push(loaded);
      results.push(quoteMarketDepthFromOrders({
        orders: loaded.orders,
        typeId: type.typeId,
        itemName: type.name,
        inputName: requested.name ?? null,
        quantity,
        locationId,
        side,
      }));
    } catch (error) {
      results.push(errorQuote({ ...requested, typeId: type.typeId, name: requested.name ?? type.name }, error instanceof Error ? error.message : String(error)));
    }
  }

  const sourceKinds = new Set(sources.map((source) => source.source));
  const sourceKind = sourceKinds.size === 1 ? [...sourceKinds][0] : sourceKinds.size > 1 ? "mixed" : "esi-live";
  const sourceCreatedAt = sources.map((source) => source.createdAt).sort().at(-1) ?? new Date().toISOString();
  const grandTotalRealisedIsk = results.reduce((sum, item) => sum + item.totalRealisedIsk, 0);
  const totalRequestedQuantity = results.reduce((sum, item) => sum + Math.max(0, item.requestedQuantity), 0);
  const totalFilledQuantity = results.reduce((sum, item) => sum + item.filledQuantity, 0);
  const totalUnfilledQuantity = results.reduce((sum, item) => sum + item.unfilledQuantity, 0);
  const unfilledReferences = results.filter((item) => item.unfilledQuantity > 0).map((item) => item.unfilledReferenceValueIsk);

  return {
    schemaVersion: 1,
    quoteType: "market-depth",
    createdAt: new Date().toISOString(),
    regionId,
    locationId,
    locationName: locationId === JITA_44_LOCATION_ID ? JITA_44_NAME : `Location ${locationId}`,
    side,
    source: {
      kind: sourceKind,
      createdAt: sourceCreatedAt,
      completeOrderCoverage: true,
      freshRequested: input.fresh === true,
    },
    items: results,
    grandTotalRealisedIsk,
    totalRequestedQuantity,
    totalFilledQuantity,
    totalUnfilledQuantity,
    totalUnfilledReferenceValueIsk: unfilledReferences.length && unfilledReferences.every((value) => value != null)
      ? unfilledReferences.reduce((sum, value) => sum + Number(value), 0)
      : null,
    fullMarketDepthSufficient: results.length > 0 && results.every((item) => item.fullMarketDepthSufficient && !item.error),
  };
}

export async function calculateCorpOreBuyback(input: MarketDepthQuoteInput & { payoutPercent?: number }) {
  const quote = await quoteMarketDepth({ ...input, side: input.side ?? "buy" });
  const payoutPercent = Math.max(0, Math.min(100, Number(input.payoutPercent ?? 90)));
  return {
    schemaVersion: 1,
    calculationType: "corp-ore-buyback",
    grossRealisedIsk: quote.grandTotalRealisedIsk,
    payoutPercent,
    corpPayoutIsk: quote.grandTotalRealisedIsk * payoutPercent / 100,
    marketQuote: quote,
  };
}
