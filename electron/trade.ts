import { getSnapshot, listSnapshots } from "./database";
import {
  loadLatestMarketDatasetByMode,
  loadRecentMarketDatasetsByMode,
} from "./market-storage";
import { highSecJumps } from "./route-graph";
import { findFullMarketTrades } from "./full-market-trade";

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
  categoryId?: number;
  categoryName?: string;
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
      categoryId: number;
      categoryName: string;
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
        categoryId: item.categoryId ?? 0,
        categoryName: item.categoryName ?? "Other",
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
  if (!full) throw new Error("Run a full public market pull first.");
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
        reason: "No retained qualifying sellers",
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

export async function findRadiusTrades(
  mode: TradeAnalysisMode = "top",
  constraints: {
    maxCapital?: number | null;
    cargoCapacityM3?: number | null;
    maxJumps?: number | null;
    maxMinutes?: number | null;
  } = {},
) {
  return findFullMarketTrades(mode, constraints, { snapshots: listSnapshots() as any[] });
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
