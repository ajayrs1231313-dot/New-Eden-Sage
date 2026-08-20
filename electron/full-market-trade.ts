import { loadRecentRawMarketManifests } from "./raw-market-storage";
import { buildFullMarketAnalysisIndex, loadFullMarketMarginSnapshot, type FullMarketOrder } from "./raw-market-analysis";
import { universeRoute } from "./universe-route-graph";
import { itemCategoryIds } from "./type-volumes";
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
    const response = await fetch(`https://esi.evetech.net/universe/types/${typeId}/`, {
      headers: { "X-Compatibility-Date": "2026-08-02", "X-User-Agent": "NewEdenSage/0.1.7" },
    });
    if (!response.ok) return 0;
    const detail = await response.json() as { dogma_attributes?: Array<{ attribute_id: number; value: number }> };
    return Number(detail.dogma_attributes?.find((attribute) => attribute.attribute_id === 38)?.value ?? 0);
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
  const recent = await loadRecentRawMarketManifests("all", 2);
  const currentManifest = recent[0] ?? null;
  if (!currentManifest)
    throw new Error("Run Refresh everything to build the complete all-region raw market order book first.");
  // Historical widening only needs one margin number per type. Reduce the old
  // snapshot first, allow its full graph to become collectible, then load the
  // current full-market index. Never retain both full indexes in this worker.
  const previousMargins = recent[1]
    ? await loadFullMarketMarginSnapshot(recent[1], { shouldCancel: runtime.shouldCancel })
    : null;
  const market = await buildFullMarketAnalysisIndex(currentManifest, runtime);
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
  runtime.progress?.({ stage: "candidates", message: "Building executable market candidates across all available cores…", completed: 0, total: Math.min(6, availableParallelism()), percent: 0 });
  const { prelim, pairCount } = await buildCandidatesInParallel(market, previousMargins?.margins ?? {}, cargoCapacity, capitalLimit, runtime);

  const routesToCheck = prelim
    .sort((a, b) => b.profit - a.profit)
    .slice(0, mode === "top1000" ? 30_000 : 8_000);
  runtime.progress?.({ stage: "routes", message: `Checking ${routesToCheck.length.toLocaleString()} candidate routes…`, completed: 0, total: routesToCheck.length, percent: 0 });
  let routesCompleted = 0;
  const checked = await mapLimited(
    routesToCheck,
    24,
    async (trade) => {
      if (runtime.shouldCancel?.()) throw new Error("Analysis cancelled.");
      const route = await universeRoute(trade.sell.systemId, trade.buy.systemId);
      const jumps = route.jumps;
      const estimatedMinutes = Math.max(8, Math.round(8 + Math.max(0, jumps) * 2));
      const availableUnits = Math.min(trade.sell.volumeRemain, trade.buy.volumeRemain);
      const cargoUnits = trade.itemVolumeM3 > 0 ? Math.floor(cargoCapacity / trade.itemVolumeM3) : availableUnits;
      const capitalUnits = Math.floor(capitalLimit / trade.sell.price);
      const units = Math.min(availableUnits, cargoUnits, capitalUnits);
      const profit = (trade.buy.price - trade.sell.price) * units;
      const investment = trade.sell.price * units;
      const margin = trade.buy.price - trade.sell.price;
      const marginPercent = trade.sell.price > 0 ? (margin / trade.sell.price) * 100 : 0;
      const iskPerM3 = trade.itemVolumeM3 > 0 ? margin / trade.itemVolumeM3 : profit > 0 ? Infinity : 0;
      const marginWidenedBy = trade.previousMargin == null ? null : margin - trade.previousMargin;
      const issuedAt = Date.parse(trade.buy.issued ?? "");
      const ageDays = Number.isFinite(issuedAt) ? Math.max(0, (Date.now() - issuedAt) / 86_400_000) : 30;
      const minimumVolumeAdjustment = trade.buy.minVolume <= units ? 10 : -20;
      const fillScore = Math.round(
        Math.max(
          0,
          Math.min(
            100,
            45 +
              Math.min(25, Math.log10(Math.max(1, availableUnits)) * 6) +
              Math.max(0, 20 - ageDays) +
              minimumVolumeAdjustment,
          ),
        ),
      );
      const iskPerJump = profit / Math.max(1, jumps);
      const routeSecurity = securityBand(route.minimumSecurityStatus);
      const risk =
        routeSecurity === "null" || fillScore < 55 || marginPercent > 100 || units < 2
          ? "High"
          : routeSecurity === "low" || fillScore < 75 || jumps > 12 || marginPercent > 45
            ? "Medium"
            : "Low";
      routesCompleted += 1;
      if (routesCompleted % 100 === 0 || routesCompleted === routesToCheck.length) {
        runtime.progress?.({ stage: "routes", message: `Checking routes: ${routesCompleted.toLocaleString()}/${routesToCheck.length.toLocaleString()}`, completed: routesCompleted, total: routesToCheck.length, percent: Math.round((routesCompleted / Math.max(1, routesToCheck.length)) * 100) });
      }
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
        routeSecurity,
        minimumRouteSecurityStatus: route.minimumSecurityStatus,
        marginWidenedBy,
        volumeM3: trade.itemVolumeM3,
        cargoM3: units * trade.itemVolumeM3,
        jumps,
        estimatedMinutes,
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

  runtime.progress?.({ stage: "ranking", message: "Ranking routes against your limits…", percent: 95 });
  const valid = checked.filter((trade) => {
    if (trade.jumps >= 999 || trade.units <= 0 || trade.profit <= 0) return false;
    if (maxJumps != null && trade.jumps > maxJumps) return false;
    if (maxMinutes != null && trade.estimatedMinutes > maxMinutes) return false;
    if (mode === "under10" && trade.jumps > 10) return false;
    if (mode === "widened" && (trade.marginWidenedBy ?? 0) <= 0) return false;
    return true;
  });
  runtime.progress?.({ stage: "ranking", message: `${valid.length.toLocaleString()} routes satisfy the current limits.`, percent: 100 });
  return {
    haulers,
    mode,
    opportunities: mode === "top1000" ? rankTrades(valid, mode) : rankTrades(valid, mode).slice(0, 20),
    diagnostics: {
      source: "complete raw all-region public order book",
      rawSnapshotId: market.snapshotId,
      sourceOrders: market.orderCount,
      sourceOrdersInspected: market.sourceOrdersInspected,
      sourceRegions: market.regionCount,
      sourceItems: market.items.size,
      candidateDepthPerSide: market.candidateDepthPerSide,
      viablePairs: pairCount,
      routeChecks: checked.length,
      reachableRoutes: checked.filter((trade) => trade.jumps < 999).length,
      profitableRoutes: valid.length,
      appliedMaxJumps: maxJumps,
      appliedMaxMinutes: maxMinutes,
      appliedCapitalLimit: Number.isFinite(capitalLimit) ? capitalLimit : null,
      appliedCargoCapacityM3: cargoCapacity,
      datasetCreatedAt: market.createdAt,
    },
    message:
      mode === "widened" && !previousMargins
        ? "Margin widening needs two complete raw all-region market snapshots. Run another full refresh later, then scan again."
        : undefined,
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
