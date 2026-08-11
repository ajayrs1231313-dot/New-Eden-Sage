import { logEvent } from "./logger";
import {
  itemCategoryIds,
  itemCategoryName,
  itemVolumes,
} from "./type-volumes";

export interface MarketOrder {
  duration: number;
  is_buy_order: boolean;
  issued: string;
  location_id: number;
  min_volume: number;
  order_id: number;
  price: number;
  range: string;
  system_id: number;
  type_id: number;
  volume_remain: number;
  volume_total: number;
}

export interface RegionInfo {
  regionId: number;
  name: string;
}

export interface PublicContract {
  contractId: number;
  title: string;
  price: number;
  volume: number;
  expires: string;
  startLocationId: number;
  startLocationName: string;
  systemId: number;
  systemName: string;
  items: Array<{
    typeId: number;
    typeName: string;
    itemVolumeM3: number;
    quantity: number;
    included: boolean;
  }>;
}

const HEADERS = {
  "X-Compatibility-Date": "2026-08-02",
  "X-User-Agent": "NewEdenSage/0.1.0",
};

let marketPricesPromise: Promise<Map<number, number>> | undefined;
let highSecSystemsPromise: Promise<Set<number>> | undefined;

async function esiFetch(
  url: string,
  attempts = 3,
  allowNotFound = false,
): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: HEADERS,
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    if (attempts > 0) {
      void logEvent("warn", "esi.network_retry", {
        url,
        attemptsRemaining: attempts,
        error: error instanceof Error ? error.message : String(error),
      });
      await new Promise((resolve) => setTimeout(resolve, (4 - attempts) * 1000));
      return esiFetch(url, attempts - 1, allowNotFound);
    }
    throw new Error("EVE market data timed out after several retries. Please try again shortly.");
  }
  if (response.status === 429 && attempts > 0) {
    const waitSeconds = Math.max(
      1,
      Number(response.headers.get("retry-after") ?? 2),
    );
    void logEvent("warn", "esi.rate_limited", {
      url,
      waitSeconds,
      attemptsRemaining: attempts,
    });
    await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000));
    return esiFetch(url, attempts - 1, allowNotFound);
  }
  if (response.status === 404 && allowNotFound) return response;
  if (response.status >= 500 && attempts > 0) {
    void logEvent("warn", "esi.server_retry", {
      url,
      status: response.status,
      attemptsRemaining: attempts,
    });
    await new Promise((resolve) => setTimeout(resolve, (4 - attempts) * 1000));
    return esiFetch(url, attempts - 1, allowNotFound);
  }
  if (!response.ok) {
    void logEvent("error", "esi.request_failed", {
      url,
      status: response.status,
    });
    throw new Error(`ESI market request failed (${response.status}).`);
  }
  return response;
}

async function esiJson<T>(
  url: string,
  attempts = 3,
  allowNotFound = false,
): Promise<{ response: Response; data: T | null }> {
  const response = await esiFetch(url, attempts, allowNotFound);
  if (response.status === 404 && allowNotFound) return { response, data: null };
  const body = await response.text();
  try {
    if (!body.trim()) throw new SyntaxError("Empty JSON response");
    return { response, data: JSON.parse(body) as T };
  } catch (error) {
    if (attempts > 0) {
      void logEvent("warn", "esi.invalid_json_retry", {
        url,
        bodyBytes: body.length,
        attemptsRemaining: attempts,
        error: error instanceof Error ? error.message : String(error),
      });
      await new Promise((resolve) => setTimeout(resolve, (4 - attempts) * 500));
      return esiJson<T>(url, attempts - 1, allowNotFound);
    }
    throw new Error("EVE market data was incomplete after several retries. Please try again shortly.");
  }
}

export async function listRegions(): Promise<RegionInfo[]> {
  const { data: regionIds } = await esiJson<number[]>("https://esi.evetech.net/universe/regions/");
  const ids = regionIds ?? [];
  const regions = await mapLimited(ids, 8, async (regionId) => {
    const { data } = await esiJson<{ name: string }>(
      `https://esi.evetech.net/universe/regions/${regionId}/`,
    );
    if (!data) throw new Error(`EVE region ${regionId} was not found.`);
    return { regionId, name: data.name };
  });
  return regions.sort((a, b) => a.name.localeCompare(b.name));
}

export async function pullRegionMarket(
  region: RegionInfo,
  progress?: (pagesDone: number, pagesTotal: number) => void,
  allowedSystemIds?: Set<number>,
  rawOrderSink?: (orders: MarketOrder[]) => Promise<void>,
) {
  const base = `https://esi.evetech.net/markets/${region.regionId}/orders/?order_type=all`;
  const { response: firstResponse, data: first } = await esiJson<MarketOrder[]>(`${base}&page=1`);
  if (!first) throw new Error(`EVE returned no market data for ${region.name}.`);
  const totalPages = Number(firstResponse.headers.get("x-pages") ?? 1);
  progress?.(1, totalPages);
  let completed = 1;
  const remainingPages = Array.from(
    { length: Math.max(0, totalPages - 1) },
    (_, index) => index + 2,
  );
  const chunks = await mapLimited(remainingPages, 4, async (page) => {
    const { data } = await esiJson<MarketOrder[]>(`${base}&page=${page}`, 3, true);
    const orders = data ?? [];
    completed += 1;
    progress?.(completed, totalPages);
    return orders;
  });
  const downloadedOrders = first.concat(...chunks);
  await rawOrderSink?.(downloadedOrders);
  const orders = allowedSystemIds
    ? downloadedOrders.filter((order) => allowedSystemIds.has(order.system_id))
    : downloadedOrders;
  const top = [...orders]
    .sort((a, b) => b.price * b.volume_remain - a.price * a.volume_remain)
    .slice(0, 20);
  const typeIds = [...new Set(orders.map((order) => order.type_id))];
  const names = (
    await mapLimited(chunk(typeIds, 1000), 4, (ids) => resolveNames(ids))
  ).flat();
  const nameById = new Map(names.map((item) => [item.id, item.name]));
  const volumeById = await itemVolumes(typeIds);
  const categoryById = await itemCategoryIds(typeIds);
  const priceByType = await marketPriceMap();
  const grouped = new Map<number, MarketOrder[]>();
  for (const order of orders) {
    const current = grouped.get(order.type_id);
    if (current) current.push(order);
    else grouped.set(order.type_id, [order]);
  }
  const retainedByType = Array.from(grouped, ([typeId, typeOrders]) => {
    const buys = typeOrders.filter((order) => order.is_buy_order);
    const sells = typeOrders.filter((order) => !order.is_buy_order);
    return {
      typeId,
      buys,
      sells,
      topBuys: [...buys]
        .sort((a, b) => b.price - a.price || b.volume_remain - a.volume_remain)
        .slice(0, 10),
      topSells: [...sells]
        .sort((a, b) => a.price - b.price || b.volume_remain - a.volume_remain)
        .slice(0, 10),
    };
  });
  const retainedOrders = retainedByType.flatMap((item) => [
    ...item.topBuys,
    ...item.topSells,
  ]);
  const locationReferenceIds = [
    ...new Set(
      retainedOrders.flatMap((order) => {
        const ids = [order.system_id];
        if (order.location_id >= 60_000_000 && order.location_id < 64_000_000)
          ids.push(order.location_id);
        return ids;
      }),
    ),
  ];
  const locationNames = (
    await mapLimited(chunk(locationReferenceIds, 1000), 4, (ids) =>
      resolveNames(ids),
    )
  ).flat();
  const locationNameById = new Map(
    locationNames.map((item) => [item.id, item.name]),
  );
  const compactOrder = (order: MarketOrder) => ({
    orderId: order.order_id,
    price: order.price,
    volumeRemain: order.volume_remain,
    locationId: order.location_id,
    locationName:
      locationNameById.get(order.location_id) ??
      `Location ${order.location_id}`,
    systemId: order.system_id,
    systemName:
      locationNameById.get(order.system_id) ?? `System ${order.system_id}`,
    issued: order.issued,
    minVolume: order.min_volume,
    range: order.range,
    durationDays: order.duration,
  });
  const items = retainedByType
    .map(({ typeId, buys, sells, topBuys, topSells }) => {
      const bestBuy = buys.length
        ? Math.max(...buys.map((order) => order.price))
        : null;
      const bestSell = sells.length
        ? Math.min(...sells.map((order) => order.price))
        : null;
      return {
        typeId,
        typeName: nameById.get(typeId) ?? `Type ${typeId}`,
        categoryId: categoryById.get(typeId) ?? 0,
        categoryName: itemCategoryName(categoryById.get(typeId) ?? 0),
        itemVolumeM3: volumeById.get(typeId) ?? 0,
        estimatedUnitValue: priceByType.get(typeId) ?? bestSell ?? bestBuy ?? 0,
        buyOrderCount: buys.length,
        sellOrderCount: sells.length,
        buyVolume: buys.reduce((sum, order) => sum + order.volume_remain, 0),
        sellVolume: sells.reduce((sum, order) => sum + order.volume_remain, 0),
        bestBuy,
        bestSell,
        spreadPercent:
          bestBuy !== null && bestSell !== null && bestSell > 0
            ? ((bestSell - bestBuy) / bestSell) * 100
            : null,
        topBuyOrders: topBuys.map(compactOrder),
        topSellOrders: topSells.map(compactOrder),
        omittedBuyOrders: Math.max(0, buys.length - topBuys.length),
        omittedSellOrders: Math.max(0, sells.length - topSells.length),
      };
    })
    .sort(
      (a, b) =>
        b.buyOrderCount +
        b.sellOrderCount -
        (a.buyOrderCount + a.sellOrderCount),
    );
  return {
    regionId: region.regionId,
    regionName: region.name,
    orderCount: orders.length,
    pageCount: totalPages,
    buyOrders: orders.filter((order) => order.is_buy_order).length,
    sellOrders: orders.filter((order) => !order.is_buy_order).length,
    uniqueTypes: new Set(orders.map((order) => order.type_id)).size,
    remainingUnits: orders.reduce((sum, order) => sum + order.volume_remain, 0),
    items,
    topOrders: top.map((order) => ({
      ...order,
      typeName: nameById.get(order.type_id) ?? `Type ${order.type_id}`,
      totalValue: order.price * order.volume_remain,
    })),
    updatedAt: new Date().toISOString(),
  };
}

export async function pullRegionContracts(
  region: RegionInfo,
  allowedSystemIds?: Set<number>,
): Promise<PublicContract[]> {
  const base = `https://esi.evetech.net/contracts/public/${region.regionId}/`;
  const firstResponse = await esiFetch(`${base}?page=1`);
  const first = (await firstResponse.json()) as Array<{
    contract_id: number;
    type: string;
    availability: string;
    price?: number;
    volume?: number;
    title?: string;
    date_expired: string;
    start_location_id: number;
  }>;
  const totalPages = Number(firstResponse.headers.get("x-pages") ?? 1);
  const pages = await mapLimited(
    Array.from(
      { length: Math.max(0, totalPages - 1) },
      (_, index) => index + 2,
    ),
    4,
    async (page) => {
      const response = await esiFetch(`${base}?page=${page}`, 3, true);
      if (response.status === 404) return [];
      return response.json() as Promise<typeof first>;
    },
  );
  const candidates = first
    .concat(...pages)
    .filter(
      (contract) =>
        contract.type === "item_exchange" && (contract.price ?? 0) > 0,
    );
  const stationIds = [
    ...new Set(
      candidates
        .map((contract) => contract.start_location_id)
        .filter((id) => id >= 60_000_000 && id < 64_000_000),
    ),
  ];
  const stations = await mapLimited(stationIds, 10, async (stationId) => {
    const response = await esiFetch(
      `https://esi.evetech.net/universe/stations/${stationId}/`,
    );
    const station = (await response.json()) as {
      name: string;
      system_id: number;
    };
    return { stationId, ...station };
  });
  const stationById = new Map(
    stations.map((station) => [station.stationId, station]),
  );
  const filtered = candidates.filter((contract) => {
    const station = stationById.get(contract.start_location_id);
    return (
      station && (!allowedSystemIds || allowedSystemIds.has(station.system_id))
    );
  });
  const details = await mapLimited(filtered, 8, async (contract) => {
    const response = await esiFetch(
      `https://esi.evetech.net/contracts/public/items/${contract.contract_id}/`,
      3,
      true,
    );
    if (response.status === 404) return { contract, items: [] };
    const items = (await response.json()) as Array<{
      is_included: boolean;
      quantity: number;
      type_id: number;
    }>;
    return { contract, items };
  });
  const typeIds = [
    ...new Set(
      details.flatMap((detail) => detail.items.map((item) => item.type_id)),
    ),
  ];
  const names = (
    await mapLimited(chunk(typeIds, 1000), 4, (ids) => resolveNames(ids))
  ).flat();
  const nameById = new Map(names.map((item) => [item.id, item.name]));
  const volumeById = await itemVolumes(typeIds);
  const priceByType = await marketPriceMap();
  const systemIds = [...new Set(stations.map((station) => station.system_id))];
  const systemNames = (
    await mapLimited(chunk(systemIds, 1000), 4, (ids) => resolveNames(ids))
  ).flat();
  const systemNameById = new Map(
    systemNames.map((item) => [item.id, item.name]),
  );
  return details.map(({ contract, items }) => {
    const station = stationById.get(contract.start_location_id)!;
    return {
      contractId: contract.contract_id,
      title: contract.title ?? "Untitled contract",
      price: contract.price ?? 0,
      volume: contract.volume ?? 0,
      expires: contract.date_expired,
      startLocationId: contract.start_location_id,
      startLocationName: station.name,
      systemId: station.system_id,
      systemName:
        systemNameById.get(station.system_id) ?? `System ${station.system_id}`,
      items: items.map((item) => ({
        typeId: item.type_id,
        typeName: nameById.get(item.type_id) ?? `Type ${item.type_id}`,
        itemVolumeM3: volumeById.get(item.type_id) ?? 0,
        estimatedUnitValue: priceByType.get(item.type_id) ?? 0,
        estimatedValue: (priceByType.get(item.type_id) ?? 0) * item.quantity,
        quantity: item.quantity,
        included: item.is_included,
      })),
    };
  });
}

export async function discoverHighSecSystems(
  progress?: (completed: number, total: number) => void,
) {
  if (!highSecSystemsPromise)
    highSecSystemsPromise = buildHighSecSystems(progress).catch((error) => {
      highSecSystemsPromise = undefined;
      throw error;
    });
  return highSecSystemsPromise;
}

async function buildHighSecSystems(
  progress?: (completed: number, total: number) => void,
) {
  const response = await esiFetch("https://esi.evetech.net/universe/systems/");
  const systemIds = (await response.json()) as number[];
  let completed = 0;
  const systems = await mapLimited(systemIds, 20, async (systemId) => {
    const detail = await esiFetch(
      `https://esi.evetech.net/universe/systems/${systemId}/`,
    );
    const system = (await detail.json()) as { security_status: number };
    completed += 1;
    if (completed % 50 === 0 || completed === systemIds.length)
      progress?.(completed, systemIds.length);
    return system.security_status >= 0.45 ? systemId : null;
  });
  return new Set(
    systems.filter((systemId): systemId is number => systemId !== null),
  );
}

export async function discoverMarketRadius(
  originSystemId: number,
  maxJumps: number,
  includeLowSec: boolean,
  progress?: (systems: number, depth: number) => void,
) {
  const systemCache = new Map<
    number,
    Promise<{
      security_status: number;
      constellation_id: number;
      stargates?: number[];
    }>
  >();
  const gateCache = new Map<
    number,
    Promise<{ destination: { system_id: number } }>
  >();
  const constellationCache = new Map<number, Promise<{ region_id: number }>>();
  const getSystem = (id: number) => {
    if (!systemCache.has(id))
      systemCache.set(
        id,
        esiFetch(`https://esi.evetech.net/universe/systems/${id}/`).then(
          (response) =>
            response.json() as Promise<{
              security_status: number;
              constellation_id: number;
              stargates?: number[];
            }>,
        ),
      );
    return systemCache.get(id)!;
  };
  const getGate = (id: number) => {
    if (!gateCache.has(id))
      gateCache.set(
        id,
        esiFetch(`https://esi.evetech.net/universe/stargates/${id}/`).then(
          (response) =>
            response.json() as Promise<{ destination: { system_id: number } }>,
        ),
      );
    return gateCache.get(id)!;
  };
  const getConstellation = (id: number) => {
    if (!constellationCache.has(id))
      constellationCache.set(
        id,
        esiFetch(`https://esi.evetech.net/universe/constellations/${id}/`).then(
          (response) => response.json() as Promise<{ region_id: number }>,
        ),
      );
    return constellationCache.get(id)!;
  };
  const visited = new Set<number>();
  const included = new Set<number>();
  const regionIds = new Set<number>();
  let frontier = [originSystemId];
  for (let depth = 0; depth <= maxJumps && frontier.length; depth += 1) {
    const next = new Set<number>();
    await mapLimited(frontier, 12, async (systemId) => {
      if (visited.has(systemId)) return;
      visited.add(systemId);
      const system = await getSystem(systemId);
      const allowed =
        system.security_status >= 0.45 ||
        (includeLowSec && system.security_status > 0);
      if (!allowed) return;
      included.add(systemId);
      regionIds.add(
        (await getConstellation(system.constellation_id)).region_id,
      );
      if (depth < maxJumps) {
        const gates = await mapLimited(system.stargates ?? [], 8, getGate);
        for (const gate of gates)
          if (!visited.has(gate.destination.system_id))
            next.add(gate.destination.system_id);
      }
    });
    frontier = [...next];
    progress?.(included.size, depth);
  }
  return { systemIds: included, regionIds };
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size)
    chunks.push(items.slice(index, index + size));
  return chunks;
}

async function resolveNames(ids: number[]) {
  if (!ids.length) return [];
  const response = await fetch("https://esi.evetech.net/universe/names/", {
    method: "POST",
    headers: { ...HEADERS, "Content-Type": "application/json" },
    body: JSON.stringify(ids),
  });
  if (!response.ok)
    throw new Error(`Market type-name lookup failed (${response.status}).`);
  return response.json() as Promise<Array<{ id: number; name: string }>>;
}

async function marketPriceMap() {
  if (!marketPricesPromise)
    marketPricesPromise = (async () => {
      try {
        const response = await esiFetch(
          "https://esi.evetech.net/markets/prices/",
        );
        const prices = (await response.json()) as Array<{
          type_id: number;
          average_price?: number;
          adjusted_price?: number;
        }>;
        return new Map(
          prices.map((price) => [
            price.type_id,
            price.average_price ?? price.adjusted_price ?? 0,
          ]),
        );
      } catch (error) {
        await logEvent("warn", "market_prices.unavailable", {
          error: error instanceof Error ? error.message : String(error),
        });
        return new Map<number, number>();
      }
    })();
  return marketPricesPromise;
}

async function mapLimited<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T) => Promise<R>,
) {
  const results = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor++;
        results[index] = await mapper(items[index]);
      }
    }),
  );
  return results;
}
