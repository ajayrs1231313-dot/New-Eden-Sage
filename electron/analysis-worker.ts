import { parentPort } from "node:worker_threads";
import { analyzeOpportunities, type OpportunityQuery } from "./opportunity-engine";
import { analyzeCapabilities } from "./capability-engine";
import { findFullMarketTrades, type FullTradeAnalysisMode, type FullTradeSearchConstraints, type FullTradeRuntime } from "./full-market-trade";
import { searchRawMarketOrders, type RawMarketSearchInput } from "./raw-market-search";
import { filterRegionalMarket, type RegionalMarketFilterInput } from "./regional-market-filter";
import { loadCurrentRawMarketManifest } from "./raw-market-storage";
import { analyzePveLocations, type PveLocationQuery } from "./pve-location-intelligence";
import type { CloneState } from "./skill-training";

type WorkerMessage =
  | { type: "run-opportunity"; jobId: string; input: OpportunityQuery; snapshots: any[] }
  | { type: "run-capability"; jobId: string; snapshot: any; cloneState: CloneState }
  | { type: "run-trade"; jobId: string; mode: FullTradeAnalysisMode; constraints: FullTradeSearchConstraints; snapshots: any[] }
  | { type: "run-raw-market"; jobId: string; input: RawMarketSearchInput }
  | { type: "run-regional-filter"; jobId: string; input: RegionalMarketFilterInput }
  | { type: "run-pve-location"; jobId: string; input: PveLocationQuery; snapshot: any; cloneState: CloneState };

type WorkerProgress = {
  stage: string;
  message: string;
  completed?: number;
  total?: number;
  percent?: number;
  cached?: boolean;
};

if (!parentPort) throw new Error("Analysis worker requires a parent port.");

const resultCache = new Map<string, { expiresAt: number; result: unknown }>();
let activeJobId: string | null = null;

function post(message: unknown) {
  parentPort!.postMessage(message);
}

function snapshotFingerprint(snapshots: any[]) {
  return snapshots
    .map((snapshot) => `${snapshot.characterId ?? "?"}:${snapshot.updatedAt ?? "?"}`)
    .sort()
    .join("|");
}

async function opportunityCacheKey(input: OpportunityQuery, snapshots: any[]) {
  const manifest = await loadCurrentRawMarketManifest("all");
  return JSON.stringify({ snapshotId: manifest?.id ?? "none", input, characters: snapshotFingerprint(snapshots) });
}

function pveCacheKey(input: PveLocationQuery, snapshot: any, cloneState: CloneState) {
  return JSON.stringify({
    kind: "pve-location",
    input: { ...input, forceLive: false },
    characterId: snapshot?.characterId ?? "none",
    updatedAt: snapshot?.updatedAt ?? "none",
    cloneState,
  });
}

function progress(jobId: string, value: WorkerProgress) {
  post({ type: "progress", jobId, progress: value });
}

setInterval(() => {
  post({ type: "heartbeat", jobId: activeJobId, at: Date.now() });
}, 2_000).unref();

parentPort.on("message", async (message: WorkerMessage) => {
  if (!message?.jobId || activeJobId) return;
  activeJobId = message.jobId;
  const startedAt = Date.now();
  try {
    progress(message.jobId, { stage: "starting", message: "Preparing background analysis…", percent: 0 });
    let result: unknown;
    let cached = false;

    if (message.type === "run-opportunity") {
      const key = await opportunityCacheKey(message.input, message.snapshots);
      const existing = resultCache.get(key);
      if (existing && existing.expiresAt > Date.now()) {
        result = existing.result;
        cached = true;
        progress(message.jobId, { stage: "cache", message: "Reusing the completed analysis for these limits.", percent: 100, cached: true });
      } else {
        result = await analyzeOpportunities(message.input, {
          snapshots: message.snapshots,
          progress: (value) => progress(message.jobId, value),
        });
        resultCache.set(key, { expiresAt: Date.now() + 5 * 60_000, result });
      }
    } else if (message.type === "run-capability") {
      progress(message.jobId, { stage: "capabilities", message: "Evaluating character capabilities in the background…", percent: 10 });
      result = await analyzeCapabilities(message.snapshot, message.cloneState);
      progress(message.jobId, { stage: "capabilities", message: "Capability analysis complete.", percent: 100 });
    } else if (message.type === "run-trade") {
      const runtime: FullTradeRuntime = {
        snapshots: message.snapshots,
        progress: (value) => progress(message.jobId, value),
      };
      result = await findFullMarketTrades(message.mode, message.constraints, runtime);
    } else if (message.type === "run-raw-market") {
      progress(message.jobId, { stage: "market-search", message: "Searching the complete raw market order book…", percent: 20 });
      result = await searchRawMarketOrders(message.input);
      progress(message.jobId, { stage: "market-search", message: "Market search complete.", percent: 100 });
    } else if (message.type === "run-regional-filter") {
      progress(message.jobId, { stage: "regional-filter", message: "Filtering the regional market index…", percent: 20 });
      result = await filterRegionalMarket(message.input, { progress: (value) => progress(message.jobId, value) });
      progress(message.jobId, { stage: "regional-filter", message: "Regional market filter complete.", percent: 100 });
    } else {
      const key = pveCacheKey(message.input, message.snapshot, message.cloneState);
      const existing = !message.input.forceLive ? resultCache.get(key) : undefined;
      if (existing && existing.expiresAt > Date.now()) {
        result = existing.result;
        cached = true;
        progress(message.jobId, { stage: "pve-cache", message: "Reusing recent PvE/location intelligence for these travel limits.", percent: 100, cached: true });
      } else {
        result = await analyzePveLocations(message.input, {
          snapshot: message.snapshot,
          cloneState: message.cloneState,
          progress: (value) => progress(message.jobId, value),
        });
        resultCache.set(key, { expiresAt: Date.now() + 2 * 60_000, result });
      }
    }

    for (const [key, value] of resultCache) {
      if (value.expiresAt <= Date.now() || resultCache.size > 16) resultCache.delete(key);
      if (resultCache.size <= 16) break;
    }
    post({ type: "result", jobId: message.jobId, result, durationMs: Date.now() - startedAt, cached });
  } catch (error) {
    post({
      type: "error",
      jobId: message.jobId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
  } finally {
    if (activeJobId === message.jobId) activeJobId = null;
  }
});
