import { getSnapshot, listSnapshots } from "./database";
import {
  loadLatestMarketDatasetByMode,
  loadRecentMarketDatasetsByMode,
} from "./market-storage";
import { highSecJumps } from "./route-graph";

type Order = {
  orderId: number;
  price: number;
  volumeRemain: number;
  locationId: number;
  locationName: string;
  systemId: number;
  systemName: string;
  issued?: string;
  minVolume?: number;
  range?: string;
  regionName?: string;
};
type Item = {
  typeId: number;
  typeName: string;
  itemVolumeM3?: number;
  topBuyOrders?: Order[];
  topSellOrders?: Order[];
};
async function jumpsBetween(from: number, to: number) {
  return highSecJumps(from, to);
}

function marketItems(data: { summaries: unknown[] }) {
  const items = new Map<
    number,
    {
      typeName: string;
      itemVolumeM3: number;
      buys: Map<number, Order>;
      sells: Map<number, Order>;
    }
  >();
  for (const region of data.summaries as Array<{
    regionName?: string;
    items?: Item[];
  }>)
    for (const item of region.items ?? []) {
      const current = items.get(item.typeId) ?? {
        typeName: item.typeName,
        itemVolumeM3: item.itemVolumeM3 ?? 0,
        buys: new Map<number, Order>(),
        sells: new Map<number, Order>(),
      };
      for (const order of item.topBuyOrders ?? [])
        current.buys.set(order.orderId, {
          ...order,
          regionName: region.regionName ?? "Unknown region",
        });
      for (const order of item.topSellOrders ?? [])
        current.sells.set(order.orderId, {
          ...order,
          regionName: region.regionName ?? "Unknown region",
        });
      items.set(item.typeId, current);
    }
  return items;
}

export async function buildFitShoppingRoute(input: {
  characterId: string;
  buyEntireFit: boolean;
  items: Array<{ typeId?: number; name: string; quantity: number }>;
}) {
  const snapshot = getSnapshot(input.characterId) as any;
  if (!snapshot?.location?.solar_system_id)
    throw new Error(
      "Sync the selected character before building a shopping route.",
    );
  const full = await loadLatestMarketDatasetByMode("all");
  if (!full) throw new Error("Run a full high-sec market pull first.");
  const market = marketItems(full);
  const owned = new Map<number, number>();
  if (!input.buyEntireFit && Array.isArray(snapshot.extended?.assets))
    for (const asset of snapshot.extended.assets)
      owned.set(
        asset.type_id,
        (owned.get(asset.type_id) ?? 0) + Math.max(0, asset.quantity ?? 0),
      );
  const required = new Map<number, { name: string; quantity: number }>();
  for (const item of input.items)
    if (item.typeId)
      required.set(item.typeId, {
        name: item.name,
        quantity: (required.get(item.typeId)?.quantity ?? 0) + item.quantity,
      });
  const purchases: Array<{
    typeId: number;
    item: string;
    quantity: number;
    price: number;
    total: number;
    station: string;
    locationId: number;
    system: string;
    systemId: number;
    jumps: number;
    savingVsLocal: number | null;
  }> = [];
  const unavailable: Array<{ item: string; quantity: number; reason: string }> =
    [];
  for (const [typeId, need] of required) {
    let remaining = Math.max(
      0,
      need.quantity - (input.buyEntireFit ? 0 : (owned.get(typeId) ?? 0)),
    );
    if (!remaining) continue;
    const listing = market.get(typeId);
    if (!listing?.sells.size) {
      unavailable.push({
        item: need.name,
        quantity: remaining,
        reason: "No retained high-sec sellers",
      });
      continue;
    }
    const sellers = [...listing.sells.values()].sort(
      (a, b) => a.price - b.price,
    );
    const local = sellers
      .filter((order) => order.systemId === snapshot.location.solar_system_id)
      .sort((a, b) => a.price - b.price)[0];
    const candidateOrders = sellers.slice(0, 12);
    if (
      local &&
      !candidateOrders.some((order) => order.orderId === local.orderId)
    )
      candidateOrders.push(local);
    const candidates = await Promise.all(
      candidateOrders.map(async (order) => ({
        order,
        jumps: await jumpsBetween(
          snapshot.location.solar_system_id,
          order.systemId,
        ),
      })),
    );
    const chosen = candidates
      .filter(({ order, jumps }) => {
        if (jumps >= 999) return false;
        if (!local || jumps === 0) return true;
        const saving = Math.max(0, (local.price - order.price) * remaining);
        return jumps < 2 ? saving >= 500_000 : saving >= 1_000_000;
      })
      .sort((a, b) => a.order.price - b.order.price || a.jumps - b.jumps);
    for (const { order, jumps } of chosen) {
      if (!remaining) break;
      const quantity = Math.min(remaining, order.volumeRemain);
      const savingVsLocal = local
        ? (local.price - order.price) * quantity
        : null;
      purchases.push({
        typeId,
        item: need.name,
        quantity,
        price: order.price,
        total: order.price * quantity,
        station: order.locationName,
        locationId: order.locationId,
        system: order.systemName,
        systemId: order.systemId,
        jumps,
        savingVsLocal,
      });
      remaining -= quantity;
    }
    if (remaining)
      unavailable.push({
        item: need.name,
        quantity: remaining,
        reason: "Insufficient qualifying sell volume",
      });
  }
  const stops = [
    ...new Set(
      purchases.map(
        (purchase) =>
          purchase.locationId ?? `${purchase.systemId}:${purchase.station}`,
      ),
    ),
  ];
  return {
    character: snapshot.character.name,
    origin: snapshot.location.place_name,
    buyEntireFit: input.buyEntireFit,
    purchases,
    unavailable,
    totalCost: purchases.reduce((sum, item) => sum + item.total, 0),
    estimatedSavings: purchases.reduce(
      (sum, item) => sum + Math.max(0, item.savingVsLocal ?? 0),
      0,
    ),
    stops: stops.length,
  };
}

function haulerProfiles() {
  return (listSnapshots() as any[]).flatMap((snapshot) => {
    const skills = snapshot.skills?.skills ?? [];
    const transport = skills.find(
      (skill: any) =>
        skill.name === "Transport Ships" && skill.trained_skill_level > 0,
    );
    const industrial = skills.find(
      (skill: any) =>
        /Industrial/.test(skill.name) && skill.trained_skill_level > 0,
    );
    const capacity = transport ? 62_500 : industrial ? 38_000 : 0;
    return capacity
      ? [
          {
            characterId: snapshot.characterId,
            character: snapshot.character.name,
            capacityM3: capacity,
            basis: transport
              ? "Transport Ships trained"
              : `${industrial.name} trained`,
          },
        ]
      : [];
  });
}

export type TradeAnalysisMode =
  | "top"
  | "top1000"
  | "widened"
  | "likely"
  | "capital"
  | "under10"
  | "wallet100m"
  | "viator"
  | "iskm3";

export async function findRadiusTrades(mode: TradeAnalysisMode = "top") {
  const recent = await loadRecentMarketDatasetsByMode("all", 2);
  const full = recent[0] ?? null;
  if (!full) throw new Error("Run a full high-sec market pull first.");
  const haulers = haulerProfiles();
  const maxHauler = [...haulers].sort((a, b) => b.capacityM3 - a.capacityM3)[0];
  const analysisHauler = maxHauler ?? {
    characterId: "generic-industrial",
    character: "Generic industrial",
    capacityM3: 38_000,
    basis:
      "38,000 m3 assumption; sync an industrial pilot for a tailored limit",
  };
  const market = marketItems(full);
  const previousMarket = recent[1] ? marketItems(recent[1]) : null;
  const prelim = [];
  let pairCount = 0;
  for (const [typeId, item] of market) {
    const sells = [...item.sells.values()]
      .sort((a, b) => a.price - b.price)
      .slice(0, 10);
    const buys = [...item.buys.values()]
      .sort((a, b) => b.price - a.price)
      .slice(0, 10);
    const pairs = new Map<string, { sell: Order; buy: Order }>();
    // Retained market data contains the best ten orders in every region. Test
    // several executable station pairs instead of discarding an item when its
    // single global best pair happens to be unusable.
    for (const sell of sells) {
      const buy = buys.find(
        (candidate) =>
          candidate.price > sell.price &&
          candidate.locationId !== sell.locationId,
      );
      if (buy) pairs.set(`${sell.orderId}:${buy.orderId}`, { sell, buy });
    }
    for (const buy of buys) {
      const sell = sells.find(
        (candidate) =>
          buy.price > candidate.price &&
          candidate.locationId !== buy.locationId,
      );
      if (sell) pairs.set(`${sell.orderId}:${buy.orderId}`, { sell, buy });
    }
    for (const { sell, buy } of pairs.values()) {
      pairCount += 1;
      const availableUnits = Math.min(sell.volumeRemain, buy.volumeRemain);
      const cargoCapacity =
        mode === "viator" ? 10_000 : analysisHauler.capacityM3;
      const cargoUnits =
        item.itemVolumeM3 > 0
          ? Math.floor(cargoCapacity / item.itemVolumeM3)
          : availableUnits;
      const capitalLimit = mode === "wallet100m" ? 100_000_000 : Infinity;
      const capitalUnits = Math.floor(capitalLimit / sell.price);
      const units = Math.min(availableUnits, cargoUnits, capitalUnits);
      const profit = (buy.price - sell.price) * units;
      if (units > 0 && profit > 0)
        prelim.push({
          typeId,
          item: item.typeName,
          itemVolumeM3: item.itemVolumeM3,
          sell,
          buy,
          units,
          profit,
          previousMargin: previousMarket
            ? marketMargin(previousMarket.get(typeId))
            : null,
        });
    }
  }
  const checked = await mapLimited(
    prelim
      .sort((a, b) => b.profit - a.profit)
      .slice(0, mode === "top1000" ? 6000 : 2500),
    24,
    async (trade) => {
      const volumeM3 = trade.itemVolumeM3;
      const jumps = await jumpsBetween(trade.sell.systemId, trade.buy.systemId);
      const cargoCapacity =
        mode === "viator" ? 10_000 : analysisHauler.capacityM3;
      const cargoUnits =
        volumeM3 > 0 ? Math.floor(cargoCapacity / volumeM3) : trade.units;
      const capitalLimit = mode === "wallet100m" ? 100_000_000 : Infinity;
      const capitalUnits = Math.floor(capitalLimit / trade.sell.price);
      const units = Math.min(trade.units, cargoUnits, capitalUnits);
      const profit = (trade.buy.price - trade.sell.price) * units;
      const investment = trade.sell.price * units;
      const margin = trade.buy.price - trade.sell.price;
      const marginPercent =
        trade.sell.price > 0 ? (margin / trade.sell.price) * 100 : 0;
      const iskPerM3 =
        volumeM3 > 0 ? margin / volumeM3 : profit > 0 ? Infinity : 0;
      const currentMargin = trade.buy.price - trade.sell.price;
      const marginWidenedBy =
        trade.previousMargin == null
          ? null
          : currentMargin - trade.previousMargin;
      const issuedAt = Date.parse(trade.buy.issued ?? "");
      const ageDays = Number.isFinite(issuedAt)
        ? Math.max(0, (Date.now() - issuedAt) / 86_400_000)
        : 30;
      const minimumVolumeAdjustment =
        (trade.buy.minVolume ?? 1) <= units ? 10 : -20;
      const fillScore = Math.round(
        Math.max(
          0,
          Math.min(
            100,
            45 +
              Math.min(25, Math.log10(Math.max(1, trade.units)) * 6) +
              Math.max(0, 20 - ageDays) +
              minimumVolumeAdjustment,
          ),
        ),
      );
      const iskPerJump = profit / Math.max(1, jumps);
      const risk =
        fillScore < 55 || marginPercent > 100 || units < 2
          ? "High"
          : fillScore < 75 || jumps > 10 || marginPercent > 40
            ? "Medium"
            : "Low";
      return {
        ...trade,
        units,
        profit,
        investment,
        marginPercent,
        iskPerM3,
        fillScore,
        iskPerJump,
        risk,
        marginWidenedBy,
        volumeM3,
        cargoM3: units * volumeM3,
        jumps,
        hauler:
          mode === "viator"
            ? {
                characterId: "viator-assumption",
                character: "Viator",
                capacityM3: 10_000,
                basis: "10,000 m3 fitted-cargo assumption",
              }
            : analysisHauler,
      };
    },
  );
  return {
    haulers,
    mode,
    opportunities: rankTrades(
      checked.filter((trade) => {
        if (trade.jumps >= 999 || trade.units <= 0 || trade.profit <= 0)
          return false;
        if (mode === "under10" && trade.jumps > 10) return false;
        if (mode === "widened" && (trade.marginWidenedBy ?? 0) <= 0)
          return false;
        return true;
      }),
      mode,
    ).slice(0, mode === "top1000" ? 1000 : 20),
    diagnostics: {
      sourceItems: market.size,
      viablePairs: pairCount,
      routeChecks: checked.length,
      reachableRoutes: checked.filter((trade) => trade.jumps < 999).length,
      profitableRoutes: checked.filter(
        (trade) => trade.jumps < 999 && trade.units > 0 && trade.profit > 0,
      ).length,
      datasetCreatedAt: full.createdAt,
    },
    message:
      mode === "widened" && !previousMarket
        ? "Margins need two full high-sec snapshots. Run another pull later, then scan again."
        : undefined,
  };
}

function marketMargin(item?: {
  buys: Map<number, Order>;
  sells: Map<number, Order>;
}) {
  if (!item) return null;
  const buy = [...item.buys.values()].sort((a, b) => b.price - a.price)[0];
  const sell = [...item.sells.values()].sort((a, b) => a.price - b.price)[0];
  return buy && sell ? buy.price - sell.price : null;
}

function rankTrades<
  T extends {
    profit: number;
    investment: number;
    iskPerM3: number;
    fillScore: number;
    marginWidenedBy: number | null;
  },
>(trades: T[], mode: TradeAnalysisMode) {
  return trades.sort((a, b) => {
    if (mode === "widened")
      return (b.marginWidenedBy ?? 0) - (a.marginWidenedBy ?? 0);
    if (mode === "likely")
      return b.fillScore - a.fillScore || b.profit - a.profit;
    if (mode === "capital")
      return (
        b.profit / Math.max(1, b.investment) -
        a.profit / Math.max(1, a.investment)
      );
    if (mode === "iskm3") return b.iskPerM3 - a.iskPerM3;
    return b.profit - a.profit;
  });
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
