import type { StrategicPlan } from "./strategic-router";

export type StrategicTiming = { route: string; broad: boolean; complexity: number; elapsedMs: number };
export type StrategicProgress = { message: string; estimate?: string; estimatedUpperMs?: number };

export function requestComplexity(message: string) {
  const comparisons = (message.match(/\b(compare|versus|across|and|including|then)\b/gi) ?? []).length;
  const count = Number(message.match(/\b([\d,]+)\s+(?:fits?|candidates?|iterations?|options?|systems?)\b/i)?.[1]?.replaceAll(",", "")) || 0;
  return Math.min(3, 1 + Math.min(1, comparisons * 0.12) + Math.min(1, message.length / 1500) + (count >= 1000 ? 0.5 : 0));
}

export function estimateStrategicDuration(plan: StrategicPlan, message: string, timings: StrategicTiming[] = []) {
  const complexity = requestComplexity(message);
  const comparable = timings.filter((row) => row.route === plan.route && row.broad === Boolean(plan.broadRequest)
    && Number.isFinite(row.elapsedMs) && row.elapsedMs > 0 && row.complexity > 0).slice(-12);
  const normalized = comparable.map((row) => row.elapsedMs / row.complexity * complexity).sort((a, b) => a - b);
  const learned = normalized.length >= 3;
  // Cold-start ranges model likely stages, not the request's maximum allowed duration.
  const stages: Record<string, [number, number]> = {
    fit_build: [3, 100_000], fit_evaluate: [2, 30_000], market: [3, 25_000], industry: [4, 40_000],
    navigation: [2, 15_000], live_research: [5, 25_000], overview: [4, 40_000], developer: [5, 90_000],
  };
  const [rounds, localMs] = stages[plan.route] ?? [2, 10_000];
  const center = learned ? normalized[Math.floor(normalized.length / 2)]
    : (rounds * 25_000 + localMs) * complexity * (plan.broadRequest ? 1 : 0.5);
  return { lowerMs: Math.max(15_000, center * (learned ? 0.7 : 0.5)),
    upperMs: Math.min(plan.requestBudgetMs, Math.max(30_000, center * (learned ? 1.5 : 1.8))), learned };
}

export function estimateLabel(lowerMs: number, upperMs: number) {
  const lower = Math.max(1, Math.floor(lowerMs / 60_000));
  const upper = Math.max(lower + 1, Math.ceil(upperMs / 60_000));
  return upperMs < 60_000 ? "under a minute" : `about ${lower}–${upper} minutes`;
}

export function remainingWorkEstimate(completed: number, total: number, elapsedMs: number) {
  if (completed < 20 || total <= completed || elapsedMs < 1000) return "";
  const remainingMs = elapsedMs / completed * (total - completed);
  return `Estimated ${estimateLabel(remainingMs * 0.75, remainingMs * 1.35)} left for this batch.`;
}
