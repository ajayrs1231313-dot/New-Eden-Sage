import { buildFullMarketAnalysisIndex, type FullMarketRegionMetrics, type RawMarketAnalysisRuntime } from "./raw-market-analysis";
import { universeRoute } from "./universe-route-graph";

export type RegionalShortageSignal = {
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
  jumpsFromCharacter: number;
  estimatedMinutes: number;
  reasons: string[];
};

export type RegionalShortageQuery = {
  originSystemId?: number | null;
  maxJumps?: number | null;
  maxMinutes?: number | null;
  limit?: number;
};

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function minutesFor(jumps: number) {
  return Math.max(8, Math.round(8 + Math.max(0, jumps) * 2));
}

function depthConfidence(source: FullMarketRegionMetrics, target: FullMarketRegionMetrics) {
  const sourceDepth = clamp(Math.log10(source.sellVolume + 1) * 24 + source.sellOrders * 4);
  const targetDepth = clamp(Math.log10(target.buyVolume + target.sellVolume + 1) * 22 + (target.buyOrders + target.sellOrders) * 2);
  return clamp(35 + sourceDepth * 0.3 + targetDepth * 0.35);
}

function preliminaryScore(input: {
  premium: number | null;
  pressure: number;
  supplyGap: boolean;
  target: FullMarketRegionMetrics;
  executableMargin: number | null;
}) {
  const premiumScore = input.supplyGap ? 100 : clamp(Math.max(0, input.premium ?? 0) * 2.5);
  const pressureScore = clamp(Math.log10(Math.max(1, input.pressure) + 1) * 45);
  const scarcityScore = input.supplyGap ? 100 : clamp(100 - input.target.sellOrders * 8);
  const executableScore = input.executableMargin == null ? 25 : clamp(input.executableMargin * 3);
  return clamp(premiumScore * 0.35 + pressureScore * 0.25 + scarcityScore * 0.25 + executableScore * 0.15);
}

function riskFromRoute(minSecurity: number) {
  if (minSecurity <= 0) return "High" as const;
  if (minSecurity < 0.45) return "Medium" as const;
  return "Low" as const;
}

export async function findRegionalShortages(
  query: RegionalShortageQuery = {},
  runtime: RawMarketAnalysisRuntime = {},
): Promise<RegionalShortageSignal[]> {
  const index = await buildFullMarketAnalysisIndex(undefined, runtime);
  runtime.progress?.({ stage: "regional-shortages", message: "Finding regional shortages and price gaps…", percent: 92 });
  const candidates: Array<Omit<RegionalShortageSignal, "jumpsFromCharacter" | "estimatedMinutes" | "risk"> & { targetSystemId: number }> = [];
  // A full raw snapshot can yield millions of intermediate scarcity/premium
  // combinations. Only the strongest signals are route-ranked, so bound this
  // buffer instead of allowing the worker to consume gigabytes of memory.
  const candidateBufferLimit = 5_000;
  const candidateRetention = 2_500;

  function retainStrongestCandidates() {
    if (candidates.length < candidateBufferLimit) return;
    candidates.sort((a, b) => b.score - a.score || b.confidenceScore - a.confidenceScore);
    candidates.length = candidateRetention;
  }

  let processed = 0;
  const totalItems = Math.max(1, index.items.size);
  for (const item of index.items.values()) {
    processed += 1;
    if (runtime.shouldCancel?.()) throw new Error("Analysis cancelled.");
    if (processed % 1000 === 0) {
      runtime.progress?.({
        stage: "regional-shortages",
        message: `Checking regional shortages: ${processed.toLocaleString("en-GB")} / ${totalItems.toLocaleString("en-GB")} items`,
        completed: processed,
        total: totalItems,
        percent: 92 + Math.round((processed / totalItems) * 4),
      });
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    const regions = Object.values(item.regions ?? {}).filter((region) => region.bestSell != null && region.sellOrders > 0);
    if (!regions.length) continue;
    const source = regions.sort((a, b) => (a.bestSell ?? Infinity) - (b.bestSell ?? Infinity))[0];
    if (!(source.bestSell! > 0) || !source.bestSellSystemId) continue;
    const allRegions = Object.values(item.regions ?? {});
    for (const target of allRegions) {
      if (target.regionId === source.regionId) continue;
      if (target.buyOrders <= 0 && target.sellOrders <= 0) continue;
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
      const confidence = depthConfidence(source, target);
      const score = preliminaryScore({ premium, pressure, supplyGap, target, executableMargin });
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
        confidenceScore: confidence,
        targetSystemId,
        reasons: [
          supplyGap
            ? `${target.regionName} has active public buy demand but no retained public sell supply for this item.`
            : `${target.regionName}'s cheapest public sell is ${premium!.toFixed(1)}% above the cheapest regional source price.`,
          `${target.buyOrders.toLocaleString("en-GB")} buy orders / ${target.sellOrders.toLocaleString("en-GB")} sell orders with ${target.buyVolume.toLocaleString("en-GB")} wanted units versus ${target.sellVolume.toLocaleString("en-GB")} listed units.`,
          executableMargin == null
            ? "The signal shows regional scarcity/price pressure, not a guaranteed immediate buyer above the source price."
            : `The best regional buyer is currently ${executableMargin.toFixed(1)}% above the cheapest source-region seller before taxes, fees and hauling costs.`,
        ],
      });
      retainStrongestCandidates();
    }
  }

  const maxJumps = query.maxJumps == null ? null : Math.max(0, Number(query.maxJumps));
  const maxMinutes = query.maxMinutes == null ? null : Math.max(0, Number(query.maxMinutes));
  const origin = Number(query.originSystemId ?? 0);
  const preselected = candidates.sort((a, b) => b.score - a.score || b.confidenceScore - a.confidenceScore).slice(0, 400);
  const results: RegionalShortageSignal[] = [];
  for (let candidateIndex = 0; candidateIndex < preselected.length; candidateIndex += 1) {
    const candidate = preselected[candidateIndex];
    if (candidateIndex % 25 === 0) {
      runtime.progress?.({
        stage: "regional-shortage-routes",
        message: `Checking routes for the strongest regional signals: ${candidateIndex + 1} / ${preselected.length}`,
        completed: candidateIndex + 1,
        total: preselected.length,
        percent: 96 + Math.round((candidateIndex / Math.max(1, preselected.length)) * 3),
      });
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    let jumps = 0;
    let minSecurity = 1;
    if (origin) {
      const route = await universeRoute(origin, candidate.targetSystemId);
      if (route.jumps >= 999) continue;
      jumps = route.jumps;
      minSecurity = route.minimumSecurityStatus;
    }
    const estimatedMinutes = minutesFor(jumps);
    if (maxJumps != null && jumps > maxJumps) continue;
    if (maxMinutes != null && estimatedMinutes > maxMinutes) continue;
    const travelPenalty = origin ? Math.min(30, jumps) : 0;
    const score = clamp(candidate.score - travelPenalty * 0.7);
    const { targetSystemId: _targetSystemId, ...rest } = candidate;
    results.push({
      ...rest,
      score,
      risk: riskFromRoute(minSecurity),
      jumpsFromCharacter: jumps,
      estimatedMinutes,
      reasons: [...candidate.reasons, origin ? `${jumps} jumps from the selected character to the target market area.` : "No character origin was supplied, so travel was not included in the score."],
    });
  }
  return results
    .sort((a, b) => b.score - a.score || b.confidenceScore - a.confidenceScore)
    .slice(0, Math.max(10, Math.min(100, Number(query.limit ?? 50))));
}
