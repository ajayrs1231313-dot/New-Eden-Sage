import { randomUUID } from "node:crypto";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { app } from "electron";
import type { OpportunityQuery } from "./opportunity-engine";
import type { FullTradeAnalysisMode, FullTradeSearchConstraints } from "./full-market-trade";
import type { RawMarketSearchInput } from "./raw-market-search";
import type { RegionalMarketFilterInput } from "./regional-market-filter";
import type { PveLocationQuery } from "./pve-location-intelligence";
import type { CloneState } from "./skill-training";

export type AnalysisKind = "opportunity" | "capability" | "trade" | "raw-market" | "regional-filter" | "pve-location";
type AnalysisLane = "market" | "raw-query" | "regional-query" | "character" | "location";

export type AnalysisProgress = {
  jobId: string;
  kind: AnalysisKind;
  stage: string;
  message: string;
  completed?: number;
  total?: number;
  percent?: number;
  cached?: boolean;
  startedAt: string;
};

type ActiveJob = {
  jobId: string;
  kind: AnalysisKind;
  startedAt: string;
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  onProgress?: (progress: AnalysisProgress) => void;
};

type LaneState = {
  worker: Worker | null;
  active: ActiveJob | null;
  lastActivityAt: number;
  watchdog: NodeJS.Timeout | null;
};

const lanes: Record<AnalysisLane, LaneState> = {
  market: { worker: null, active: null, lastActivityAt: Date.now(), watchdog: null },
  "raw-query": { worker: null, active: null, lastActivityAt: Date.now(), watchdog: null },
  "regional-query": { worker: null, active: null, lastActivityAt: Date.now(), watchdog: null },
  character: { worker: null, active: null, lastActivityAt: Date.now(), watchdog: null },
  location: { worker: null, active: null, lastActivityAt: Date.now(), watchdog: null },
};
let disposed = false;

function laneFor(kind: AnalysisKind): AnalysisLane {
  if (kind === "capability") return "character";
  if (kind === "pve-location") return "location";
  if (kind === "raw-market") return "raw-query";
  if (kind === "regional-filter") return "regional-query";
  return "market";
}

function workerPath() {
  return path.join(__dirname, "analysis-worker.js");
}

function workerHeapLimitMb(lane: AnalysisLane) {
  // Market analysis can legitimately build large indexes, but an unbounded
  // worker must never be allowed to consume the whole Electron process.
  if (lane === "market" || lane === "raw-query" || lane === "regional-query") return 1024;
  return 512;
}

function analysisError(message: string, code: string) {
  const error = new Error(message) as Error & { code?: string };
  error.code = code;
  return error;
}

function stopWatchdog(lane: AnalysisLane) {
  const state = lanes[lane];
  if (state.watchdog) clearInterval(state.watchdog);
  state.watchdog = null;
}

function watchdogTimeoutMs(kind: AnalysisKind) {
  // The first regional query may synchronously decompress CCP's static-data archive
  // and build a 200k+ row persisted index. It is isolated from the UI, but that
  // CPU-bound stage cannot emit timer heartbeats reliably on slower machines.
  if (kind === "regional-filter") return 5 * 60_000;
  if (kind === "raw-market" || kind === "opportunity" || kind === "trade") return 2 * 60_000;
  return 45_000;
}

function startWatchdog(lane: AnalysisLane) {
  stopWatchdog(lane);
  const state = lanes[lane];
  state.watchdog = setInterval(() => {
    if (!state.active || Date.now() - state.lastActivityAt <= watchdogTimeoutMs(state.active.kind)) return;
    const stale = state.active;
    state.active = null;
    stale.reject(analysisError("Background analysis stopped responding. Sage restarted that worker; try again.", "ANALYSIS_WATCHDOG"));
    void restartLane(lane);
  }, 5_000);
  state.watchdog.unref();
}

function attachWorker(lane: AnalysisLane, next: Worker) {
  const state = lanes[lane];
  next.on("message", (message: any) => {
    state.lastActivityAt = Date.now();
    if (message?.type === "heartbeat") return;
    if (!state.active || message?.jobId !== state.active.jobId) return;
    if (message.type === "progress") {
      state.active.onProgress?.({
        jobId: state.active.jobId,
        kind: state.active.kind,
        startedAt: state.active.startedAt,
        ...message.progress,
      });
      return;
    }
    if (message.type === "result") {
      const current = state.active;
      state.active = null;
      current.resolve(message.result);
      return;
    }
    if (message.type === "error") {
      const current = state.active;
      state.active = null;
      current.reject(analysisError(message.error || "Analysis failed.", "ANALYSIS_WORKER_ERROR"));
    }
  });
  next.on("error", (error: unknown) => {
    if (state.worker !== next) return;
    const current = state.active;
    state.active = null;
    state.worker = null;
    const message = error instanceof Error ? error.message : String(error);
    current?.reject(analysisError(`Analysis worker crashed: ${message}`, "ANALYSIS_WORKER_CRASH"));
  });
  next.on("exit", (code) => {
    if (state.worker !== next) return;
    state.worker = null;
    if (state.active) {
      const current = state.active;
      state.active = null;
      current.reject(analysisError(`Analysis worker exited unexpectedly (${code}).`, "ANALYSIS_WORKER_EXIT"));
    }
  });
}

function ensureWorker(lane: AnalysisLane) {
  if (disposed) throw analysisError("Analysis service is shutting down.", "ANALYSIS_SHUTDOWN");
  const state = lanes[lane];
  if (state.worker) return state.worker;
  const next = new Worker(workerPath(), {
    name: `new-eden-sage-${lane}-analysis`,
    env: {
      ...process.env,
      NEW_EDEN_SAGE_USER_DATA: app.getPath("userData"),
    },
    resourceLimits: {
      maxOldGenerationSizeMb: workerHeapLimitMb(lane),
      maxYoungGenerationSizeMb: 64,
    },
  });
  state.worker = next;
  state.lastActivityAt = Date.now();
  attachWorker(lane, next);
  startWatchdog(lane);
  return next;
}

async function restartLane(lane: AnalysisLane) {
  const state = lanes[lane];
  const previous = state.worker;
  state.worker = null;
  if (previous) await previous.terminate().catch(() => undefined);
  if (!disposed) ensureWorker(lane);
}

async function cancelLane(lane: AnalysisLane, reason: string) {
  const state = lanes[lane];
  const current = state.active;
  state.active = null;
  current?.reject(analysisError(reason, "ANALYSIS_CANCELLED"));
  if (current) await restartLane(lane);
  return Boolean(current);
}

export async function cancelAnalysis(reason = "Analysis cancelled.", kind?: AnalysisKind) {
  if (kind) return cancelLane(laneFor(kind), reason);
  const results = await Promise.all([
    cancelLane("market", reason),
    cancelLane("raw-query", reason),
    cancelLane("regional-query", reason),
    cancelLane("character", reason),
    cancelLane("location", reason),
  ]);
  return results.some(Boolean);
}

export function analysisStatus() {
  return Object.fromEntries((Object.keys(lanes) as AnalysisLane[]).map((lane) => {
    const state = lanes[lane];
    return [lane, state.active
      ? { running: true, jobId: state.active.jobId, kind: state.active.kind, startedAt: state.active.startedAt, lastActivityAt: new Date(state.lastActivityAt).toISOString() }
      : { running: false, jobId: null, kind: null, startedAt: null, lastActivityAt: new Date(state.lastActivityAt).toISOString() }];
  }));
}

async function runJob(kind: AnalysisKind, payload: Record<string, unknown>, onProgress?: (progress: AnalysisProgress) => void) {
  const lane = laneFor(kind);
  const state = lanes[lane];
  if (state.active) await cancelLane(lane, "Replaced by a newer analysis request.");
  const jobId = randomUUID();
  const startedAt = new Date().toISOString();
  const target = ensureWorker(lane);
  return new Promise<any>((resolve, reject) => {
    state.active = { jobId, kind, startedAt, resolve, reject, onProgress };
    state.lastActivityAt = Date.now();
    onProgress?.({ jobId, kind, stage: "queued", message: "Queued in Sage's background analysis worker…", percent: 0, startedAt });
    target.postMessage({ jobId, ...payload });
  });
}

export function runOpportunityAnalysis(input: OpportunityQuery, snapshots: any[], onProgress?: (progress: AnalysisProgress) => void) {
  return runJob("opportunity", { type: "run-opportunity", input, snapshots }, onProgress);
}

export function runCapabilityAnalysis(snapshot: any, cloneState: CloneState, onProgress?: (progress: AnalysisProgress) => void) {
  return runJob("capability", { type: "run-capability", snapshot, cloneState }, onProgress);
}

export function runTradeAnalysis(mode: FullTradeAnalysisMode, constraints: FullTradeSearchConstraints, snapshots: any[], onProgress?: (progress: AnalysisProgress) => void) {
  return runJob("trade", { type: "run-trade", mode, constraints, snapshots }, onProgress);
}

export function runRawMarketSearch(input: RawMarketSearchInput, onProgress?: (progress: AnalysisProgress) => void) {
  return runJob("raw-market", { type: "run-raw-market", input }, onProgress);
}

export function runRegionalMarketFilter(input: RegionalMarketFilterInput, onProgress?: (progress: AnalysisProgress) => void) {
  return runJob("regional-filter", { type: "run-regional-filter", input }, onProgress);
}

export function runPveLocationAnalysis(input: PveLocationQuery, snapshot: any, cloneState: CloneState, onProgress?: (progress: AnalysisProgress) => void) {
  return runJob("pve-location", { type: "run-pve-location", input, snapshot, cloneState }, onProgress);
}

export function loadPreparedOpportunityAnalysis(input: OpportunityQuery, snapshots: any[]) {
  return runJob("opportunity", { type: "peek-opportunity", input, snapshots });
}

export function loadPreparedCapabilityAnalysis(snapshot: any, cloneState: CloneState) {
  return runJob("capability", { type: "peek-capability", snapshot, cloneState });
}

export function loadPreparedPveLocationAnalysis(input: PveLocationQuery, snapshot: any, cloneState: CloneState) {
  return runJob("pve-location", { type: "peek-pve-location", input, snapshot, cloneState });
}

export async function disposeAnalysisWorker() {
  disposed = true;
  for (const lane of Object.keys(lanes) as AnalysisLane[]) stopWatchdog(lane);
  for (const lane of Object.keys(lanes) as AnalysisLane[]) {
    const state = lanes[lane];
    const current = state.active;
    state.active = null;
    current?.reject(analysisError("Sage is closing.", "ANALYSIS_SHUTDOWN"));
    const currentWorker = state.worker;
    state.worker = null;
    if (currentWorker) await currentWorker.terminate().catch(() => undefined);
  }
}

/** Stops every analysis lane without permanently shutting the service down. */
export async function stopAnalysisWorkersForExclusiveTask() {
  for (const lane of Object.keys(lanes) as AnalysisLane[]) stopWatchdog(lane);
  for (const lane of Object.keys(lanes) as AnalysisLane[]) {
    const state = lanes[lane];
    const current = state.active;
    state.active = null;
    current?.reject(analysisError("Paused for exclusive Master Update.", "ANALYSIS_CANCELLED"));
    const currentWorker = state.worker;
    state.worker = null;
    if (currentWorker) await currentWorker.terminate().catch(() => undefined);
  }
}

/** Release the large market worker after its prepared result has been persisted. */
export async function releaseIdleMarketAnalysisWorker() {
  const state = lanes.market;
  if (state.active || !state.worker) return false;
  stopWatchdog("market");
  const currentWorker = state.worker;
  state.worker = null;
  await currentWorker.terminate().catch(() => undefined);
  return true;
}
