import { availableParallelism } from "node:os";

export const RESERVED_INTERACTIVE_CORES = 1;

/**
 * CPU budget for work triggered by an interactive page load.
 *
 * Sage keeps one logical core out of the worker budget so Electron's renderer,
 * IPC and the OS still have headroom while the active page is being prepared.
 */
export function pageLoadCpuBudget(cpuCount = availableParallelism()) {
  const logicalCores = Math.max(1, Math.floor(Number(cpuCount) || 1));
  return Math.max(1, logicalCores - RESERVED_INTERACTIVE_CORES);
}

/**
 * Bound an interactive worker fan-out by both the global CPU budget and the
 * amount of useful work available.
 */
export function pageLoadWorkerCount(workItems = Number.POSITIVE_INFINITY, cpuCount = availableParallelism()) {
  const usefulItems = Number.isFinite(workItems)
    ? Math.max(1, Math.floor(workItems))
    : Number.POSITIVE_INFINITY;
  return Math.max(1, Math.min(pageLoadCpuBudget(cpuCount), usefulItems));
}
