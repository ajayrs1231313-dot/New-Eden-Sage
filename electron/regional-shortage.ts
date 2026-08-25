import { buildFullMarketAnalysisIndex, type FullMarketRegionMetrics, type RawMarketAnalysisRuntime } from "./raw-market-analysis";
import { universeRoute } from "./universe-route-graph";
import { loadSharedPreparedShortageDataset } from "./shared-market-data";
import { logEvent } from "./logger";

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
  const startedAt = Date.now();
  const prepared = await loadSharedPreparedShortageDataset();
  if (!prepared) {
    runtime.progress?.({ stage: "regional-shortages", message: "Server-prepared shortage intelligence is not available in this generation.", percent: 100, cached: true });
    return [];
  }

  runtime.progress?.({ stage: "regional-shortages", message: "Applying character limits to server-prepared shortage signals…", percent: 96, cached: true });
  const maxJumps = query.maxJumps == null ? null : Math.max(0, Number(query.maxJumps));
  const maxMinutes = query.maxMinutes == null ? null : Math.max(0, Number(query.maxMinutes));
  const origin = Number(query.originSystemId ?? 0);
  const limit = Math.max(10, Math.min(100, Number(query.limit ?? 50)));
  const candidates = (prepared.signals as any[]).slice(0, Math.max(100, limit * 3));
  const results: RegionalShortageSignal[] = [];

  for (let index = 0; index < candidates.length; index += 1) {
    if (runtime.shouldCancel?.()) throw new Error("Analysis cancelled.");
    const candidate = candidates[index];
    let jumps = 0;
    let minSecurity = Number(candidate.minimumRouteSecurityStatus ?? 1);
    if (origin) {
      const route = await universeRoute(origin, Number(candidate.targetSystemId ?? candidate.target?.bestBuySystemId ?? candidate.target?.bestSellSystemId ?? 0));
      if (route.jumps >= 999) continue;
      jumps = route.jumps;
      minSecurity = route.minimumSecurityStatus;
    }
    const estimatedMinutes = minutesFor(jumps);
    if (maxJumps != null && jumps > maxJumps) continue;
    if (maxMinutes != null && estimatedMinutes > maxMinutes) continue;
    const travelPenalty = origin ? Math.min(30, jumps) : 0;
    results.push({
      id: String(candidate.id),
      typeId: Number(candidate.typeId),
      item: String(candidate.item),
      category: String(candidate.category ?? "Other"),
      itemVolumeM3: Number(candidate.itemVolumeM3 ?? 0),
      target: candidate.target,
      source: candidate.source,
      sourcePrice: Number(candidate.sourcePrice ?? 0),
      targetSellPrice: candidate.targetSellPrice == null ? null : Number(candidate.targetSellPrice),
      targetBuyPrice: candidate.targetBuyPrice == null ? null : Number(candidate.targetBuyPrice),
      regionalPremiumPercent: candidate.regionalPremiumPercent == null ? null : Number(candidate.regionalPremiumPercent),
      executableMarginPercent: candidate.executableMarginPercent == null ? null : Number(candidate.executableMarginPercent),
      demandPressure: Number(candidate.demandPressure ?? 0),
      supplyGap: Boolean(candidate.supplyGap),
      score: clamp(Number(candidate.score ?? 0) - travelPenalty * 0.7),
      confidenceScore: clamp(Number(candidate.confidenceScore ?? 0)),
      risk: riskFromRoute(minSecurity),
      jumpsFromCharacter: jumps,
      estimatedMinutes,
      reasons: [
        ...(Array.isArray(candidate.reasons) ? candidate.reasons.map(String) : []),
        origin ? `${jumps} jumps from the selected character to the target market area.` : `Server-prepared source-to-target route: ${Number(candidate.sourceToTargetJumps ?? 0)} jumps.`,
      ],
    });
    if (results.length >= limit && index >= limit) break;
  }

  const ranked = results.sort((a, b) => b.score - a.score || b.confidenceScore - a.confidenceScore).slice(0, limit);
  void logEvent("info", "shared_market.local_shortage_filter_ms", { durationMs: Date.now() - startedAt, generation: prepared.snapshotId, candidates: candidates.length, returned: ranked.length });
  return ranked;
}
