import { parentPort } from "node:worker_threads";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { gzip, gunzip } from "node:zlib";
import { promisify } from "node:util";
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
const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);
const PERSISTED_ANALYSIS_ROOT = path.join(process.env.NEW_EDEN_SAGE_USER_DATA ?? process.cwd(), "Analysis Cache");

function persistedResultPath(kind: string, key: string) {
  return path.join(PERSISTED_ANALYSIS_ROOT, `${kind}-${createHash("sha256").update(key).digest("hex")}.json.gz`);
}

async function loadPersistedResult(kind: string, key: string) {
  try {
    return JSON.parse((await gunzipAsync(await fs.readFile(persistedResultPath(kind, key)))).toString("utf8"));
  } catch {
    return undefined;
  }
}

async function savePersistedResult(kind: string, key: string, result: unknown) {
  await fs.mkdir(PERSISTED_ANALYSIS_ROOT, { recursive: true });
  const target = persistedResultPath(kind, key);
  const partial = `${target}.${process.pid}.partial`;
  await fs.writeFile(partial, await gzipAsync(Buffer.from(JSON.stringify(result), "utf8"), { level: 6 }));
  await fs.rename(partial, target).catch(async () => {
    await fs.rm(target, { force: true });
    await fs.rename(partial, target);
  });
}

function genericCacheKey(kind: string, input: unknown, snapshots: unknown) {
  return JSON.stringify({ kind, input, snapshots });
}

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
        const persisted = await loadPersistedResult("opportunity", key);
        if (persisted) {
          result = persisted;
          cached = true;
          progress(message.jobId, { stage: "disk-cache", message: "Loaded the prepared ISK Lab result for this market snapshot.", percent: 100, cached: true });
        } else {
          result = await analyzeOpportunities(message.input, {
            snapshots: message.snapshots,
            progress: (value) => progress(message.jobId, value),
          });
          await savePersistedResult("opportunity", key, result);
        }
        resultCache.set(key, { expiresAt: Date.now() + 5 * 60_000, result });
      }
    } else if (message.type === "run-capability") {
      const key = genericCacheKey("capability", message.cloneState, { id: message.snapshot?.characterId, updatedAt: message.snapshot?.updatedAt });
      result = await loadPersistedResult("capability", key);
      if (result) {
        cached = true;
        progress(message.jobId, { stage: "disk-cache", message: "Loaded saved character progression intelligence.", percent: 100, cached: true });
      } else {
        progress(message.jobId, { stage: "capabilities", message: "Evaluating character capabilities in the background…", percent: 10 });
        result = await analyzeCapabilities(message.snapshot, message.cloneState);
        await savePersistedResult("capability", key, result);
        progress(message.jobId, { stage: "capabilities", message: "Capability analysis complete.", percent: 100 });
      }
    } else if (message.type === "run-trade") {
      const key = await opportunityCacheKey({ ...(message.constraints as any), mode: message.mode } as OpportunityQuery, message.snapshots);
      result = await loadPersistedResult("trade", key);
      if (result) { cached = true; progress(message.jobId, { stage: "disk-cache", message: "Loaded saved market trade analysis.", percent: 100, cached: true }); }
      else { const runtime: FullTradeRuntime = { snapshots: message.snapshots, progress: (value) => progress(message.jobId, value) }; result = await findFullMarketTrades(message.mode, message.constraints, runtime); await savePersistedResult("trade", key, result); }
    } else if (message.type === "run-raw-market") {
      const manifest = await loadCurrentRawMarketManifest("all"); const key = genericCacheKey("raw-market", message.input, manifest?.id);
      result = await loadPersistedResult("raw-market", key);
      if (result) { cached = true; progress(message.jobId, { stage: "disk-cache", message: "Loaded saved market search.", percent: 100, cached: true }); }
      else { progress(message.jobId, { stage: "market-search", message: "Searching the complete raw market order book…", percent: 20 }); result = await searchRawMarketOrders(message.input); await savePersistedResult("raw-market", key, result); progress(message.jobId, { stage: "market-search", message: "Market search complete.", percent: 100 }); }
    } else if (message.type === "run-regional-filter") {
      const manifest = await loadCurrentRawMarketManifest("all"); const key = genericCacheKey("regional-filter", message.input, manifest?.id);
      result = await loadPersistedResult("regional-filter", key);
      if (result) { cached = true; progress(message.jobId, { stage: "disk-cache", message: "Loaded saved regional market result.", percent: 100, cached: true }); }
      else { progress(message.jobId, { stage: "regional-filter", message: "Filtering the regional market index…", percent: 20 }); result = await filterRegionalMarket(message.input, { progress: (value) => progress(message.jobId, value) }); await savePersistedResult("regional-filter", key, result); progress(message.jobId, { stage: "regional-filter", message: "Regional market filter complete.", percent: 100 }); }
    } else {
      const key = pveCacheKey(message.input, message.snapshot, message.cloneState);
      const existing = !message.input.forceLive ? resultCache.get(key) : undefined;
      if (existing && existing.expiresAt > Date.now()) {
        result = existing.result;
        cached = true;
        progress(message.jobId, { stage: "pve-cache", message: "Reusing recent PvE/location intelligence for these travel limits.", percent: 100, cached: true });
      } else {
        const persisted = !message.input.forceLive ? await loadPersistedResult("pve", key) : undefined;
        if (persisted) {
          result = persisted;
          cached = true;
          progress(message.jobId, { stage: "disk-cache", message: "Loaded saved PvE and location intelligence.", percent: 100, cached: true });
        } else result = await analyzePveLocations(message.input, {
          snapshot: message.snapshot,
          cloneState: message.cloneState,
          progress: (value) => progress(message.jobId, value),
        });
        if (!message.input.forceLive && !persisted) await savePersistedResult("pve", key, result);
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
