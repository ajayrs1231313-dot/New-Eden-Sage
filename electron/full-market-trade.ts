import { loadRecentRawMarketManifests } from "./raw-market-storage";
import { loadSharedPreparedTradeDataset } from "./shared-market-data";
import { buildFullMarketAnalysisIndex, loadFullMarketMarginSnapshot, type FullMarketOrder } from "./raw-market-analysis";
import { universeRoute } from "./universe-route-graph";
import { itemCategoryIds } from "./type-volumes";
import { getFittingTypeInfoLocal } from "./fitting-dogma";
import { availableParallelism } from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";

export type FullTradeRuntime = {
  snapshots?: any[];
  progress?: (progress: { stage: string; message: string; completed?: number; total?: number; percent?: number; cached?: boolean }) => void;
  shouldCancel?: () => boolean;
};

export type FullTradeSearchConstraints = {
  maxCapital?: number | null;
  cargoCapacityM3?: number | null;
  maxJumps?: number | null;
  maxMinutes?: number | null;
};

export type FullTradeAnalysisMode =
  | "top"
  | "top1000"
  | "widened"
  | "likely"
  | "capital"
  | "under10"
  | "wallet100m"
  | "viator"
  | "iskm3";

const cargoCapacityCache = new Map<number, Promise<number>>();

async function baseCargoCapacity(typeId: number) {
  if (!cargoCapacityCache.has(typeId)) cargoCapacityCache.set(typeId, (async () => {
    const detail = await getFittingTypeInfoLocal(typeId).catch(() => null);
    return Number(detail?.physical?.capacityM3 ?? 0);
  })());
  return cargoCapacityCache.get(typeId)!;
}

export async function getHaulerProfiles(snapshots: any[] = []) {
  const profiles = await Promise.all(snapshots.map(async (snapshot) => {
    const assets = Array.isArray(snapshot.extended?.assets) ? snapshot.extended.assets : [];
    const typeIds: number[] = [...new Set<number>(assets.map((asset: any) => Number(asset.type_id)).filter((id: number) => id > 0))];
    const categories = await itemCategoryIds(typeIds);
    const ownedShipTypeIds = typeIds.filter((typeId) => categories.get(typeId) === 6);
    const ownedShips = await Promise.all(ownedShipTypeIds.map(async (typeId) => ({ typeId, capacityM3: await baseCargoCapacity(typeId) })));
    const bestOwnedShip = ownedShips.sort((a, b) => b.capacityM3 - a.capacityM3)[0];
    const skills = snapshot.skills?.skills ?? [];
    const transport = skills.find(
      (skill: any) => skill.name === "Transport Ships" && skill.trained_skill_level > 0,
    );
    const industrial = skills.find(
      (skill: any) => /Industrial/.test(skill.name) && skill.trained_skill_level > 0,
    );
    const capacity = Number(bestOwnedShip?.capacityM3 ?? 0) || (transport ? 62_500 : industrial ? 38_000 : 0);
    return capacity
      ? {
            characterId: snapshot.characterId,
            character: snapshot.character.name,
            capacityM3: capacity,
            basis: bestOwnedShip
              ? `Largest cargo hold found among ${ownedShipTypeIds.length} owned ship type${ownedShipTypeIds.length === 1 ? "" : "s"}`
              : transport ? "Transport Ships trained; no owned ship cargo detected" : `${industrial.name} trained; no owned ship cargo detected`,
          }
      : null;
  }));
  return profiles.filter((profile): profile is NonNullable<typeof profile> => Boolean(profile));
}


function pairKey(sell: FullMarketOrder, buy: FullMarketOrder) {
  return `${sell.orderId}:${buy.orderId}`;
}

function candidatePairs(sells: FullMarketOrder[], buys: FullMarketOrder[]) {
  const pairs = new Map<string, { sell: FullMarketOrder; buy: FullMarketOrder }>();
  for (const sell of sells) {
    const buy = buys.find((candidate) => candidate.price > sell.price);
    if (buy) pairs.set(pairKey(sell, buy), { sell, buy });
  }
  for (const buy of buys) {
    const sell = sells.find((candidate) => buy.price > candidate.price);
    if (sell) pairs.set(pairKey(sell, buy), { sell, buy });
  }
  // Price-depth edges can matter when the absolute best order has tiny volume.
  for (const sell of sells.slice(0, 12))
    for (const buy of buys.slice(0, 12))
      if (buy.price > sell.price) pairs.set(pairKey(sell, buy), { sell, buy });
  return [...pairs.values()];
}

function securityBand(minimumSecurityStatus: number) {
  if (minimumSecurityStatus >= 0.45) return "high" as const;
  if (minimumSecurityStatus > 0) return "low" as const;
  return "null" as const;
}

async function buildCandidatesInParallel(market: any, previousMargins: Record<string, number | null>, cargoCapacity: number, capitalLimit: number, runtime: FullTradeRuntime) {
  const entries = [...market.items] as Array<[number, any]>;
  const workers = Math.max(1, Math.min(6, availableParallelism(), entries.length));
  const chunkSize = Math.ceil(entries.length / workers);
  let completed = 0;
  const results = await Promise.all(Array.from({ length: workers }, (_, index) => new Promise<{ prelim: any[]; pairCount: number }>((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, "trade-candidate-worker.js"), {
      workerData: { entries: entries.slice(index * chunkSize, (index + 1) * chunkSize), previousMargins, cargoCapacity, capitalLimit },
      resourceLimits: { maxOldGenerationSizeMb: 256 },
    });
    worker.on("message", (message: any) => {
      if (message?.type === "complete") { completed += 1; runtime.progress?.({ stage: "candidates", message: `Building candidates across ${workers} cores: ${completed}/${workers} batches`, completed, total: workers, percent: Math.round(completed / workers * 100) }); resolve(message); }
      if (message?.type === "error") reject(new Error(message.error));
    });
    worker.once("error", reject);
    worker.once("exit", (code) => { if (code !== 0) reject(new Error(`Trade candidate worker exited (${code}).`)); });
  })));
  return { prelim: results.flatMap((result) => result.prelim), pairCount: results.reduce((sum, result) => sum + result.pairCount, 0) };
}

function rankTrades<
  T extends {
    profit: number;
    investment: number;
    iskPerM3: number;
    fillScore: number;
    marginWidenedBy: number | null;
  },
>(trades: T[], mode: FullTradeAnalysisMode) {
  return trades.sort((a, b) => {
    if (mode === "widened") return (b.marginWidenedBy ?? 0) - (a.marginWidenedBy ?? 0);
    if (mode === "likely") return b.fillScore - a.fillScore || b.profit - a.profit;
    if (mode === "capital")
      return b.profit / Math.max(1, b.investment) - a.profit / Math.max(1, a.investment);
    if (mode === "iskm3") return b.iskPerM3 - a.iskPerM3;
    return b.profit - a.profit;
  });
}

export async function findFullMarketTrades(
  mode: FullTradeAnalysisMode = "top",
  constraints: FullTradeSearchConstraints = {},
  runtime: FullTradeRuntime = {},
) {
  const preparedStartedAt = Date.now();
  const prepared = await loadSharedPreparedTradeDataset();
  runtime.progress?.({ stage: "prepared-market", message: "Loading server-prepared public market intelligence...", percent: 90, cached: true });
  const haulers = await getHaulerProfiles(runtime.snapshots ?? []);
  const maxHauler = [...haulers].sort((a, b) => b.capacityM3 - a.capacityM3)[0];
  const analysisHauler = maxHauler ?? {
    characterId: "generic-industrial",
    character: "Generic industrial",
    capacityM3: 38_000,
    basis: "38,000 m3 assumption; sync an industrial pilot for a tailored limit",
  };
  const cargoCapacity = mode === "viator"
    ? 10_000
    : constraints.cargoCapacityM3 == null
      ? analysisHauler.capacityM3
      : Math.max(1, Number(constraints.cargoCapacityM3));
  const capitalLimit = mode === "wallet100m"
    ? 100_000_000
    : constraints.maxCapital == null
      ? Infinity
      : Math.max(0, Number(constraints.maxCapital));
  const maxJumps = constraints.maxJumps == null ? null : Math.max(0, Number(constraints.maxJumps));
  const maxMinutes = constraints.maxMinutes == null ? null : Math.max(0, Number(constraints.maxMinutes));

  if (!prepared) {
    return {
      haulers,
      mode,
      opportunities: [],
      diagnostics: {
        source: "shared-server-prepared-intelligence-unavailable",
        rawSnapshotId: null,
        sourceOrders: 0,
        sourceOrdersInspected: 0,
        sourceRegions: 0,
        sourceItems: 0,
        candidateDepthPerSide: 0,
        viablePairs: 0,
        routeChecks: 0,
        reachableRoutes: 0,
        profitableRoutes: 0,
        appliedMaxJumps: maxJumps,
        appliedMaxMinutes: maxMinutes,
        appliedCapitalLimit: Number.isFinite(capitalLimit) ? capitalLimit : null,
        appliedCargoCapacityM3: cargoCapacity,
        datasetCreatedAt: null,
        localFilterMs: Date.now() - preparedStartedAt,
      },
      message: "The current shared generation does not include prepared trade intelligence yet. Sage will not rebuild the public market locally.",
    };
  }

  const valid = (prepared.opportunities as any[]).map((trade) => {
    const availableUnits = Math.max(0, Math.min(Number(trade.availableUnits ?? trade.sell?.volumeRemain ?? 0), Number(trade.buy?.volumeRemain ?? 0)));
    const sellPrice = Number(trade.sell?.price ?? 0);
    const buyPrice = Number(trade.buy?.price ?? 0);
    const itemVolumeM3 = Math.max(0, Number(trade.itemVolumeM3 ?? 0));
    const cargoUnits = itemVolumeM3 > 0 ? Math.floor(cargoCapacity / itemVolumeM3) : availableUnits;
    const capitalUnits = Number.isFinite(capitalLimit) ? Math.floor(capitalLimit / Math.max(0.000001, sellPrice)) : availableUnits;
    const units = Math.max(0, Math.min(availableUnits, cargoUnits, capitalUnits));
    const profit = (buyPrice - sellPrice) * units;
    const investment = sellPrice * units;
    const marginPercent = sellPrice > 0 ? ((buyPrice - sellPrice) / sellPrice) * 100 : 0;
    const iskPerM3 = itemVolumeM3 > 0 ? (buyPrice - sellPrice) / itemVolumeM3 : profit > 0 ? Infinity : 0;
    const jumps = Number(trade.jumps ?? 999);
    return {
      ...trade,
      units,
      profit,
      investment,
      marginPercent,
      iskPerM3,
      iskPerJump: profit / Math.max(1, jumps),
      cargoM3: units * itemVolumeM3,
      volumeM3: itemVolumeM3,
      hauler: mode === "viator"
        ? { characterId: "viator-assumption", character: "Viator", capacityM3: 10_000, basis: "10,000 m3 fitted-cargo assumption" }
        : analysisHauler,
    };
  }).filter((trade) => {
    if (trade.jumps >= 999 || trade.units <= 0 || trade.profit <= 0) return false;
    if (Number(trade.buy?.minVolume ?? 1) > trade.units) return false;
    if (maxJumps != null && trade.jumps > maxJumps) return false;
    if (maxMinutes != null && Number(trade.estimatedMinutes ?? 0) > maxMinutes) return false;
    if (mode === "under10" && trade.jumps > 10) return false;
    if (mode === "widened") return false;
    return true;
  });

  runtime.progress?.({ stage: "ranking", message: "Applying character limits to server-prepared opportunities...", percent: 100, cached: true });
  const ranked = rankTrades(valid, mode);
  return {
    haulers,
    mode,
    opportunities: mode === "top1000" ? ranked : ranked.slice(0, 20),
    diagnostics: {
      source: "server-prepared public market intelligence",
      rawSnapshotId: prepared.snapshotId,
      sourceOrders: 0,
      sourceOrdersInspected: 0,
      sourceRegions: 0,
      sourceItems: 0,
      candidateDepthPerSide: 0,
      viablePairs: prepared.viablePairs,
      routeChecks: prepared.routeChecks,
      reachableRoutes: prepared.opportunities.length,
      profitableRoutes: valid.length,
      appliedMaxJumps: maxJumps,
      appliedMaxMinutes: maxMinutes,
      appliedCapitalLimit: Number.isFinite(capitalLimit) ? capitalLimit : null,
      appliedCargoCapacityM3: cargoCapacity,
      datasetCreatedAt: prepared.createdAt,
      localFilterMs: Date.now() - preparedStartedAt,
    },
    message: mode === "widened" ? "Margin-widening history is not rebuilt on the desktop; the server-prepared current market remains available in other modes." : undefined,
  };
}

async function mapLimited<T, R>(items: T[], limit: number, mapper: (item: T) => Promise<R>) {
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
