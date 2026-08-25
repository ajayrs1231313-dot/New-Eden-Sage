import type { FullMarketAnalysisIndex, FullMarketOrder, FullMarketRegionMetrics } from "./raw-market-analysis";
import { universeRoute } from "./universe-route-graph";

export type PreparedPublicTradeDataset = {
  schemaVersion: 1;
  dataset: "market-trades";
  snapshotId: string;
  createdAt: string;
  routeChecks: number;
  viablePairs: number;
  opportunities: PreparedPublicTradeCandidate[];
};

export type PreparedPublicTradeCandidate = {
  typeId: number;
  item: string;
  categoryId: number;
  categoryName: string;
  itemVolumeM3: number;
  sell: FullMarketOrder;
  buy: FullMarketOrder;
  availableUnits: number;
  marginPerUnit: number;
  marginPercent: number;
  publicGrossPotential: number;
  fillScore: number;
  jumps: number;
  estimatedMinutes: number;
  routeSecurity: "high" | "low" | "null";
  minimumRouteSecurityStatus: number;
  risk: "Low" | "Medium" | "High";
  marginWidenedBy: null;
  publicScore: number;
};

export type PreparedPublicShortageDataset = {
  schemaVersion: 1;
  dataset: "market-shortages";
  snapshotId: string;
  createdAt: string;
  signals: PreparedPublicShortageSignal[];
};

export type PreparedPublicShortageSignal = {
  id: string;
  typeId: number;
  item: string;
  category: string;
  itemVolumeM3: number;
  target: FullMarketRegionMetrics;
  source: FullMarketRegionMetrics;
  sourcePrice: number;
  targetSellPrice: number | null;
  targetBuyPrice: number | null;
  regionalPremiumPercent: number | null;
  executableMarginPercent: number | null;
  demandPressure: number;
  supplyGap: boolean;
  score: number;
  confidenceScore: number;
  risk: "Low" | "Medium" | "High";
  targetSystemId: number;
  sourceSystemId: number;
  sourceToTargetJumps: number;
  estimatedMinutes: number;
  minimumRouteSecurityStatus: number;
  routeSecurity: "high" | "low" | "null";
  reasons: string[];
};

type Progress = (value: { stage: string; completed?: number; total?: number; message?: string }) => void;

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function routeBand(minimumSecurityStatus: number) {
  if (minimumSecurityStatus >= 0.45) return "high" as const;
  if (minimumSecurityStatus > 0) return "low" as const;
  return "null" as const;
}

function planningMinutes(jumps: number) {
  return Math.max(8, Math.round(8 + Math.max(0, jumps) * 2));
}

function orderFillScore(order: FullMarketOrder, availableUnits: number) {
  const issuedAt = Date.parse(order.issued ?? "");
  const ageDays = Number.isFinite(issuedAt) ? Math.max(0, (Date.now() - issuedAt) / 86_400_000) : 30;
  return clamp(48 + Math.min(24, Math.log10(Math.max(1, availableUnits)) * 6) + Math.max(0, 18 - ageDays) + (order.minVolume <= availableUnits ? 10 : -25));
}

function tradeRisk(routeSecurity: "high" | "low" | "null", fillScore: number, jumps: number, marginPercent: number) {
  if (routeSecurity === "null" || fillScore < 55 || marginPercent > 100) return "High" as const;
  if (routeSecurity === "low" || fillScore < 75 || jumps > 12 || marginPercent > 45) return "Medium" as const;
  return "Low" as const;
}

function pairKey(sell: FullMarketOrder, buy: FullMarketOrder) {
  return `${sell.orderId}:${buy.orderId}`;
}

function publicPairs(sells: FullMarketOrder[], buys: FullMarketOrder[]) {
  const pairs = new Map<string, { sell: FullMarketOrder; buy: FullMarketOrder }>();
  for (const sell of sells) {
    const buy = buys.find((candidate) => candidate.price > sell.price);
    if (buy) pairs.set(pairKey(sell, buy), { sell, buy });
  }
  for (const buy of buys) {
    const sell = sells.find((candidate) => buy.price > candidate.price);
    if (sell) pairs.set(pairKey(sell, buy), { sell, buy });
  }
  for (const sell of sells.slice(0, 12)) {
    for (const buy of buys.slice(0, 12)) {
      if (buy.price > sell.price) pairs.set(pairKey(sell, buy), { sell, buy });
    }
  }
  return [...pairs.values()];
}

async function mapLimited<T, R>(items: T[], limit: number, mapper: (item: T, index: number) => Promise<R>) {
  const results = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, Math.max(1, items.length)) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await mapper(items[index], index);
    }
  }));
  return results;
}

export async function buildPreparedPublicTradeDataset(index: FullMarketAnalysisIndex, progress?: Progress): Promise<PreparedPublicTradeDataset> {
  const preliminary: Array<PreparedPublicTradeCandidate & { preScore: number }> = [];
  let viablePairs = 0;
  let itemNo = 0;
  for (const item of index.items.values()) {
    itemNo += 1;
    const pairs = publicPairs(item.sells, item.buys);
    viablePairs += pairs.length;
    for (const { sell, buy } of pairs) {
      const availableUnits = Math.min(sell.volumeRemain, buy.volumeRemain);
      if (!(availableUnits > 0) || buy.minVolume > availableUnits || !(buy.price > sell.price)) continue;
      const marginPerUnit = buy.price - sell.price;
      const marginPercent = sell.price > 0 ? (marginPerUnit / sell.price) * 100 : 0;
      const publicGrossPotential = marginPerUnit * availableUnits;
      const fillScore = orderFillScore(buy, availableUnits);
      const preScore = Math.log10(Math.max(1, publicGrossPotential)) * 12 + Math.min(80, Math.max(0, marginPercent)) + fillScore * 0.3;
      preliminary.push({
        typeId: item.typeId,
        item: item.typeName,
        categoryId: item.categoryId,
        categoryName: item.categoryName,
        itemVolumeM3: item.itemVolumeM3,
        sell,
        buy,
        availableUnits,
        marginPerUnit,
        marginPercent,
        publicGrossPotential,
        fillScore,
        jumps: 999,
        estimatedMinutes: 0,
        routeSecurity: "null",
        minimumRouteSecurityStatus: -1,
        risk: "High",
        marginWidenedBy: null,
        publicScore: 0,
        preScore,
      });
    }
    if (preliminary.length > 90_000) {
      preliminary.sort((a, b) => b.preScore - a.preScore);
      preliminary.length = 45_000;
    }
    if (itemNo % 2000 === 0) progress?.({ stage: "trade-candidates", completed: itemNo, total: index.items.size, message: "Building public trade candidates" });
  }

  const routesToCheck = preliminary.sort((a, b) => b.preScore - a.preScore).slice(0, 30_000);
  let routed = 0;
  const checked = await mapLimited(routesToCheck, 32, async (candidate) => {
    const route = await universeRoute(candidate.sell.systemId, candidate.buy.systemId);
    routed += 1;
    if (routed % 500 === 0 || routed === routesToCheck.length) progress?.({ stage: "trade-routes", completed: routed, total: routesToCheck.length, message: "Precomputing public trade routes" });
    const jumps = route.jumps;
    const routeSecurity = routeBand(route.minimumSecurityStatus);
    const estimatedMinutes = planningMinutes(jumps);
    const routeScore = jumps >= 999 ? 0 : Math.max(0, 100 - Math.min(80, jumps * 3));
    const publicScore = clamp(candidate.preScore * 0.55 + candidate.fillScore * 0.2 + routeScore * 0.25);
    const { preScore: _preScore, ...base } = candidate;
    return {
      ...base,
      jumps,
      estimatedMinutes,
      routeSecurity,
      minimumRouteSecurityStatus: route.minimumSecurityStatus,
      risk: tradeRisk(routeSecurity, candidate.fillScore, jumps, candidate.marginPercent),
      publicScore,
    } satisfies PreparedPublicTradeCandidate;
  });

  return {
    schemaVersion: 1,
    dataset: "market-trades",
    snapshotId: index.snapshotId,
    createdAt: index.createdAt,
    routeChecks: checked.length,
    viablePairs,
    opportunities: checked
      .filter((candidate) => candidate.jumps < 999 && candidate.availableUnits > 0 && candidate.publicGrossPotential > 0)
      .sort((a, b) => b.publicScore - a.publicScore || b.publicGrossPotential - a.publicGrossPotential),
  };
}

function shortageDepthConfidence(source: FullMarketRegionMetrics, target: FullMarketRegionMetrics) {
  const sourceDepth = clamp(Math.log10(source.sellVolume + 1) * 24 + source.sellOrders * 4);
  const targetDepth = clamp(Math.log10(target.buyVolume + target.sellVolume + 1) * 22 + (target.buyOrders + target.sellOrders) * 2);
  return clamp(35 + sourceDepth * 0.3 + targetDepth * 0.35);
}

function shortageScore(input: { premium: number | null; pressure: number; supplyGap: boolean; target: FullMarketRegionMetrics; executableMargin: number | null }) {
  const premiumScore = input.supplyGap ? 100 : clamp(Math.max(0, input.premium ?? 0) * 2.5);
  const pressureScore = clamp(Math.log10(Math.max(1, input.pressure) + 1) * 45);
  const scarcityScore = input.supplyGap ? 100 : clamp(100 - input.target.sellOrders * 8);
  const executableScore = input.executableMargin == null ? 25 : clamp(input.executableMargin * 3);
  return clamp(premiumScore * 0.35 + pressureScore * 0.25 + scarcityScore * 0.25 + executableScore * 0.15);
}

export async function buildPreparedPublicShortageDataset(index: FullMarketAnalysisIndex, progress?: Progress): Promise<PreparedPublicShortageDataset> {
  type Candidate = Omit<PreparedPublicShortageSignal, "risk" | "sourceToTargetJumps" | "estimatedMinutes" | "minimumRouteSecurityStatus" | "routeSecurity">;
  const candidates: Candidate[] = [];
  let processed = 0;
  for (const item of index.items.values()) {
    processed += 1;
    const sellingRegions = Object.values(item.regions ?? {}).filter((region) => region.bestSell != null && region.sellOrders > 0);
    if (!sellingRegions.length) continue;
    const source = sellingRegions.sort((a, b) => (a.bestSell ?? Infinity) - (b.bestSell ?? Infinity))[0];
    if (!(source.bestSell! > 0) || !source.bestSellSystemId) continue;
    for (const target of Object.values(item.regions ?? {})) {
      if (target.regionId === source.regionId || (target.buyOrders <= 0 && target.sellOrders <= 0)) continue;
      const premium = target.bestSell == null ? null : ((target.bestSell - source.bestSell!) / source.bestSell!) * 100;
      const pressure = target.buyVolume / Math.max(1, target.sellVolume);
      const supplyGap = target.sellOrders === 0 && target.buyOrders > 0;
      const thinSupply = target.sellOrders <= 3 && target.buyOrders > 0 && pressure >= 1.5;
      const priceGap = premium != null && premium >= 15;
      if (!supplyGap && !thinSupply && !priceGap) continue;
      const targetSystemId = target.bestBuySystemId ?? target.bestSellSystemId;
      if (!targetSystemId) continue;
      const executableMargin = target.bestBuy != null && target.bestBuy > source.bestSell!
        ? ((target.bestBuy - source.bestSell!) / source.bestSell!) * 100
        : null;
      const confidenceScore = shortageDepthConfidence(source, target);
      const score = shortageScore({ premium, pressure, supplyGap, target, executableMargin });
      candidates.push({
        id: `shortage:${item.typeId}:${target.regionId}`,
        typeId: item.typeId,
        item: item.typeName,
        category: item.categoryName,
        itemVolumeM3: item.itemVolumeM3,
        target,
        source,
        sourcePrice: source.bestSell!,
        targetSellPrice: target.bestSell,
        targetBuyPrice: target.bestBuy,
        regionalPremiumPercent: premium,
        executableMarginPercent: executableMargin,
        demandPressure: pressure,
        supplyGap,
        score,
        confidenceScore,
        targetSystemId,
        sourceSystemId: source.bestSellSystemId,
        reasons: [
          supplyGap
            ? `${target.regionName} has active public buy demand but no retained public sell supply for this item.`
            : `${target.regionName}'s cheapest public sell is ${premium!.toFixed(1)}% above the cheapest regional source price.`,
          `${target.buyOrders.toLocaleString("en-GB")} buy orders / ${target.sellOrders.toLocaleString("en-GB")} sell orders with ${target.buyVolume.toLocaleString("en-GB")} wanted units versus ${target.sellVolume.toLocaleString("en-GB")} listed units.`,
        ],
      });
    }
    if (candidates.length > 5000) {
      candidates.sort((a, b) => b.score - a.score || b.confidenceScore - a.confidenceScore);
      candidates.length = 2500;
    }
    if (processed % 2000 === 0) progress?.({ stage: "shortage-candidates", completed: processed, total: index.items.size, message: "Building public shortage signals" });
  }

  const preselected = candidates.sort((a, b) => b.score - a.score || b.confidenceScore - a.confidenceScore).slice(0, 1000);
  let routed = 0;
  const signals = await mapLimited(preselected, 32, async (candidate) => {
    const route = await universeRoute(candidate.sourceSystemId, candidate.targetSystemId);
    routed += 1;
    if (routed % 100 === 0 || routed === preselected.length) progress?.({ stage: "shortage-routes", completed: routed, total: preselected.length, message: "Precomputing shortage routes" });
    const routeSecurity = routeBand(route.minimumSecurityStatus);
    const travelPenalty = route.jumps >= 999 ? 100 : Math.min(30, route.jumps) * 0.7;
    const score = clamp(candidate.score - travelPenalty);
    return {
      ...candidate,
      score,
      risk: routeSecurity === "null" ? "High" as const : routeSecurity === "low" ? "Medium" as const : "Low" as const,
      sourceToTargetJumps: route.jumps,
      estimatedMinutes: planningMinutes(route.jumps),
      minimumRouteSecurityStatus: route.minimumSecurityStatus,
      routeSecurity,
    } satisfies PreparedPublicShortageSignal;
  });

  return {
    schemaVersion: 1,
    dataset: "market-shortages",
    snapshotId: index.snapshotId,
    createdAt: index.createdAt,
    signals: signals
      .filter((signal) => signal.sourceToTargetJumps < 999)
      .sort((a, b) => b.score - a.score || b.confidenceScore - a.confidenceScore)
      .slice(0, 500),
  };
}
