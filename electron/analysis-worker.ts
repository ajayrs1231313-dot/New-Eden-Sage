import { parentPort } from "node:worker_threads";
import { promises as fs } from "node:fs";
import path from "node:path";
import { ANALYSIS_CACHE_ROOT } from "./data-paths";
import { createHash, randomUUID } from "node:crypto";
import { gzip, gunzip } from "node:zlib";
import { promisify } from "node:util";
import { analyzeOpportunities, type OpportunityAnalysis, type OpportunityQuery } from "./opportunity-engine";
import { analyzeCapabilities } from "./capability-engine";
import { findFullMarketTrades, type FullTradeAnalysisMode, type FullTradeSearchConstraints, type FullTradeRuntime } from "./full-market-trade";
import { searchRawMarketOrders, type RawMarketSearchInput } from "./raw-market-search";
import { filterRegionalMarket, type RegionalMarketFilterInput } from "./regional-market-filter";
import { loadCurrentRawMarketManifest } from "./raw-market-storage";
import { loadCurrentMarketRevision, loadCurrentSharedMarketManifest } from "./shared-market-data";
import { analyzePveLocations, type PveLocationAnalysis, type PveLocationQuery } from "./pve-location-intelligence";
import { loadPveStaticRevision } from "./pve-static-index";
import {
  exactPreparedPageState,
  lastKnownGoodPreparedPageState,
  loadLastKnownGoodPageState,
  saveLastKnownGoodPageState,
  type PageStateSource,
} from "./page-state-persistence";
import type { CloneState } from "./skill-training";

type WorkerMessage =
  | { type: "peek-opportunity"; jobId: string; input: OpportunityQuery; snapshots: any[] }
  | { type: "peek-capability"; jobId: string; snapshot: any; cloneState: CloneState }
  | { type: "peek-pve-location"; jobId: string; input: PveLocationQuery; snapshot: any; cloneState: CloneState }
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
const MAX_MEMORY_RESULT_CACHE_ENTRIES = 2;
let activeJobId: string | null = null;

function rememberResult(key: string, result: unknown, ttlMs: number) {
  resultCache.delete(key);
  resultCache.set(key, { expiresAt: Date.now() + ttlMs, result });
  while (resultCache.size > MAX_MEMORY_RESULT_CACHE_ENTRIES) {
    const oldest = resultCache.keys().next().value as string | undefined;
    if (!oldest) break;
    resultCache.delete(oldest);
  }
}
const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);
const PERSISTED_ANALYSIS_ROOT = ANALYSIS_CACHE_ROOT;

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
  const partial = `${target}.${process.pid}.${randomUUID()}.partial`;
  await fs.writeFile(partial, await gzipAsync(Buffer.from(JSON.stringify(result), "utf8"), { level: 6 }));
  try {
    await fs.rename(partial, target);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EEXIST" && code !== "EPERM" && code !== "EACCES") throw error;
    const backup = `${target}.${process.pid}.${randomUUID()}.backup`;
    let backedUp = false;
    try {
      await fs.rename(target, backup);
      backedUp = true;
    } catch (targetError) {
      if ((targetError as NodeJS.ErrnoException).code !== "ENOENT") throw targetError;
    }
    try {
      await fs.rename(partial, target);
    } catch (replaceError) {
      if (backedUp) await fs.rename(backup, target).catch(() => undefined);
      throw replaceError;
    }
    if (backedUp) await fs.rm(backup, { force: true }).catch(() => undefined);
  }
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

async function opportunityCacheContext(input: OpportunityQuery, snapshots: any[]) {
  const manifest = await loadCurrentMarketRevision();
  const selected = input.characterId
    ? snapshots.find((snapshot: any) => String(snapshot?.characterId) === String(input.characterId)) ?? null
    : null;
  const character = selected
    ? String(selected.characterId ?? "?") + ":" + String(selected.updatedAt ?? "?")
    : snapshotFingerprint(snapshots);
  const key = JSON.stringify({ version: OPPORTUNITY_MODEL_VERSION, snapshotId: manifest?.id ?? "none", input, character });
  return { key, manifest, selected };
}

async function opportunityCacheKey(input: OpportunityQuery, snapshots: any[]) {
  return (await opportunityCacheContext(input, snapshots)).key;
}

function defaultPreparedOpportunityQuery(input: OpportunityQuery) {
  return input.characterId != null && input.maxCapital == null && input.cargoCapacityM3 == null && input.maxJumps == null && input.maxMinutes == null;
}

async function loadCompatiblePreparedOpportunity(input: OpportunityQuery, snapshots: any[]) {
  if (!defaultPreparedOpportunityQuery(input)) return undefined;
  const { key, manifest, selected } = await opportunityCacheContext(input, snapshots);
  if (!manifest || !selected) return undefined;
  let entries: import("node:fs").Dirent[];
  try { entries = await fs.readdir(PERSISTED_ANALYSIS_ROOT, { withFileTypes: true }); } catch { return undefined; }
  const candidates = await Promise.all(entries
    .filter((entry) => entry.isFile() && /^opportunity-[a-f0-9]{64}\.json\.gz$/i.test(entry.name))
    .map(async (entry) => {
      const file = path.join(PERSISTED_ANALYSIS_ROOT, entry.name);
      try { return { file, mtimeMs: (await fs.stat(file)).mtimeMs }; } catch { return null; }
    }));
  const selectedUpdatedAt = Date.parse(String(selected.updatedAt ?? ""));
  const marketCreatedAt = Date.parse(String(manifest.createdAt ?? ""));
  const freshnessFloor = Math.max(
    Number.isFinite(selectedUpdatedAt) ? selectedUpdatedAt : 0,
    Number.isFinite(marketCreatedAt) ? marketCreatedAt : 0,
  );
  // A persisted result cannot have been generated from a character/market
  // revision newer than the cache file itself. Reject obviously stale files by
  // mtime before reading and gunzipping potentially large opportunity payloads.
  const freshCandidates = candidates
    .filter((candidate): candidate is { file: string; mtimeMs: number } => Boolean(candidate))
    .filter((candidate) => freshnessFloor <= 0 || candidate.mtimeMs >= freshnessFloor)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, 80);
  for (const candidate of freshCandidates) {
    let value: any;
    try { value = JSON.parse((await gunzipAsync(await fs.readFile(candidate.file))).toString("utf8")); } catch { continue; }
    if (String(value?.character?.characterId ?? "") !== String(input.characterId)) continue;
    if (String(value?.signals?.marketDatasetCreatedAt ?? "") !== String(manifest.createdAt ?? "")) continue;
    const generatedMs = Date.parse(String(value?.generatedAt ?? ""));
    if (Number.isFinite(selectedUpdatedAt) && (!Number.isFinite(generatedMs) || generatedMs < selectedUpdatedAt)) continue;
    if (value?.constraints?.maxCapital != null || value?.constraints?.maxJumps != null || value?.constraints?.maxMinutes != null) continue;
    await savePersistedResult("opportunity", key, value);
    return value;
  }
  return undefined;
}

const OPPORTUNITY_MODEL_VERSION = 4;
const PVE_MODEL_VERSION = 2;
const MARKET_LKG_MODULE = "isk.market";
const PVE_LKG_MODULE = "isk.pve";

function characterPageScope(characterId: string) {
  return { kind: "character" as const, id: String(characterId) };
}

function pvePageScope(characterId: string, cloneState: CloneState) {
  return { kind: "character" as const, id: `character:${characterId}|clone:${cloneState}` };
}

function isOpportunityAnalysis(value: unknown, characterId: string): value is OpportunityAnalysis {
  const candidate = value as OpportunityAnalysis | null;
  return Boolean(
    candidate
    && typeof candidate.generatedAt === "string"
    && String(candidate.character?.characterId ?? "") === String(characterId)
    && candidate.constraints && typeof candidate.constraints === "object"
    && candidate.market && Array.isArray(candidate.market.opportunities)
    && Array.isArray(candidate.ranked)
    && candidate.signals && typeof candidate.signals === "object"
  );
}

function marketSourceRevision(
  context: Awaited<ReturnType<typeof opportunityCacheContext>>,
  result: OpportunityAnalysis,
): PageStateSource {
  return {
    opportunityModelVersion: OPPORTUNITY_MODEL_VERSION,
    characterSnapshotUpdatedAt: String(context.selected?.updatedAt ?? "none"),
    marketSnapshotId: context.manifest?.id ?? "none",
    marketCreatedAt: context.manifest?.createdAt ?? null,
    generatedAt: result.generatedAt,
  };
}

async function loadMarketLastKnownGood(input: OpportunityQuery, snapshots: any[]) {
  if (!defaultPreparedOpportunityQuery(input) || input.characterId == null) return undefined;
  const characterId = String(input.characterId);
  return loadLastKnownGoodPageState<OpportunityAnalysis>({
    moduleId: MARKET_LKG_MODULE,
    scope: characterPageScope(characterId),
    validatePayload: (value): value is OpportunityAnalysis => isOpportunityAnalysis(value, characterId),
  });
}

async function saveMarketLastKnownGood(input: OpportunityQuery, snapshots: any[], value: unknown) {
  if (!defaultPreparedOpportunityQuery(input) || input.characterId == null) return false;
  const characterId = String(input.characterId);
  if (!isOpportunityAnalysis(value, characterId)) return false;
  const context = await opportunityCacheContext(input, snapshots);
  if (!context.selected) return false;
  return saveLastKnownGoodPageState({
    moduleId: MARKET_LKG_MODULE,
    scope: characterPageScope(characterId),
    source: marketSourceRevision(context, value),
    payload: value,
    validatePayload: (candidate): candidate is OpportunityAnalysis => isOpportunityAnalysis(candidate, characterId),
    savedAt: value.generatedAt,
  });
}

function defaultPreparedPveQuery(input: PveLocationQuery) {
  return input.characterId != null && input.maxJumps == null && input.maxMinutes == null;
}

async function pveCacheContext(input: PveLocationQuery, snapshot: any, cloneState: CloneState) {
  const [manifest, staticRevision] = await Promise.all([
    loadCurrentSharedMarketManifest(),
    loadPveStaticRevision(),
  ]);
  const publicArtifact = manifest?.files?.["public-shared"];
  const publicSharedRevision = publicArtifact?.version ?? (manifest ? `generation:${manifest.generation}:no-public-shared` : "none");
  const normalizedInput = {
    ...input,
    characterId: String(input.characterId ?? snapshot?.characterId ?? "none"),
    maxJumps: input.maxJumps ?? null,
    maxMinutes: input.maxMinutes ?? null,
    forceLive: false,
  };
  const key = JSON.stringify({
    kind: "pve-location",
    version: PVE_MODEL_VERSION,
    input: normalizedInput,
    characterId: snapshot?.characterId ?? "none",
    updatedAt: snapshot?.updatedAt ?? "none",
    cloneState,
    publicSharedRevision,
    staticRevision,
  });
  return { key, manifest, publicSharedRevision, staticRevision, normalizedInput };
}

function isPveLocationAnalysis(value: unknown, characterId: string): value is PveLocationAnalysis {
  const candidate = value as PveLocationAnalysis | null;
  return Boolean(
    candidate
    && typeof candidate.generatedAt === "string"
    && String(candidate.character?.characterId ?? "") === String(characterId)
    && candidate.constraints && typeof candidate.constraints === "object"
    && Array.isArray(candidate.locations)
    && Array.isArray(candidate.ranked)
    && candidate.counts && typeof candidate.counts === "object"
    && candidate.dataStatus && typeof candidate.dataStatus === "object"
  );
}

function pveSourceRevision(
  context: Awaited<ReturnType<typeof pveCacheContext>>,
  snapshot: any,
  cloneState: CloneState,
  result: PveLocationAnalysis,
): PageStateSource {
  return {
    pveModelVersion: PVE_MODEL_VERSION,
    characterSnapshotUpdatedAt: String(snapshot?.updatedAt ?? "none"),
    publicSharedRevision: context.publicSharedRevision,
    staticRevision: context.staticRevision,
    cloneState,
    maxJumps: context.normalizedInput.maxJumps,
    maxMinutes: context.normalizedInput.maxMinutes,
    liveFetchedAt: result.dataStatus?.fetchedAt ?? null,
    generatedAt: result.generatedAt,
  };
}

async function loadPveLastKnownGood(input: PveLocationQuery, snapshot: any, cloneState: CloneState) {
  if (!defaultPreparedPveQuery(input)) return undefined;
  const characterId = String(snapshot?.characterId ?? input.characterId ?? "");
  if (!characterId) return undefined;
  return loadLastKnownGoodPageState<PveLocationAnalysis>({
    moduleId: PVE_LKG_MODULE,
    scope: pvePageScope(characterId, cloneState),
    validatePayload: (value): value is PveLocationAnalysis => isPveLocationAnalysis(value, characterId),
  });
}

async function savePveLastKnownGood(input: PveLocationQuery, snapshot: any, cloneState: CloneState, value: unknown) {
  if (!defaultPreparedPveQuery(input)) return false;
  const characterId = String(snapshot?.characterId ?? input.characterId ?? "");
  if (!characterId || !isPveLocationAnalysis(value, characterId)) return false;
  const context = await pveCacheContext(input, snapshot, cloneState);
  return saveLastKnownGoodPageState({
    moduleId: PVE_LKG_MODULE,
    scope: pvePageScope(characterId, cloneState),
    source: pveSourceRevision(context, snapshot, cloneState, value),
    payload: value,
    validatePayload: (candidate): candidate is PveLocationAnalysis => isPveLocationAnalysis(candidate, characterId),
    savedAt: value.generatedAt,
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

    if (message.type === "peek-opportunity") {
      const context = await opportunityCacheContext(message.input, message.snapshots);
      const characterId = String(message.input.characterId ?? "");
      const exact = await loadPersistedResult("opportunity", context.key) ?? await loadCompatiblePreparedOpportunity(message.input, message.snapshots);
      if (characterId && isOpportunityAnalysis(exact, characterId)) {
        result = { payload: exact, state: exactPreparedPageState(exact.generatedAt, marketSourceRevision(context, exact)) };
      } else {
        const lkg = await loadMarketLastKnownGood(message.input, message.snapshots);
        result = lkg ? { payload: lkg.payload, state: lastKnownGoodPreparedPageState(lkg) } : null;
      }
      cached = Boolean(result);
      const previous = (result as any)?.state?.source === "last-known-good";
      progress(message.jobId, { stage: previous ? "last-known-good" : cached ? "disk-cache" : "cache-miss", message: previous ? "Loaded previous coherent ISK Lab result while the current revision prepares." : cached ? "Loaded prepared ISK Lab result." : "No prepared ISK Lab result exists for this snapshot.", percent: 100, cached });
    } else if (message.type === "peek-capability") {
      const key = genericCacheKey("capability", message.cloneState, { id: message.snapshot?.characterId, updatedAt: message.snapshot?.updatedAt });
      result = await loadPersistedResult("capability", key) ?? null;
      cached = Boolean(result);
      progress(message.jobId, { stage: cached ? "disk-cache" : "cache-miss", message: cached ? "Loaded prepared progression intelligence." : "No prepared progression intelligence exists for this snapshot.", percent: 100, cached });
    } else if (message.type === "peek-pve-location") {
      const context = await pveCacheContext(message.input, message.snapshot, message.cloneState);
      const characterId = String(message.snapshot?.characterId ?? message.input.characterId ?? "");
      const exact = await loadPersistedResult("pve", context.key);
      if (characterId && isPveLocationAnalysis(exact, characterId)) {
        result = { payload: exact, state: exactPreparedPageState(exact.generatedAt, pveSourceRevision(context, message.snapshot, message.cloneState, exact)) };
      } else {
        const lkg = await loadPveLastKnownGood(message.input, message.snapshot, message.cloneState);
        result = lkg ? { payload: lkg.payload, state: lastKnownGoodPreparedPageState(lkg) } : null;
      }
      cached = Boolean(result);
      const previous = (result as any)?.state?.source === "last-known-good";
      progress(message.jobId, { stage: previous ? "last-known-good" : cached ? "disk-cache" : "cache-miss", message: previous ? "Loaded previous coherent PvE/location intelligence while the current revision prepares." : cached ? "Loaded prepared PvE/location intelligence." : "No prepared PvE/location intelligence exists for this snapshot.", percent: 100, cached });
    } else if (message.type === "run-opportunity") {
      const key = await opportunityCacheKey(message.input, message.snapshots);
      const existing = resultCache.get(key);
      if (existing && existing.expiresAt > Date.now()) {
        result = existing.result;
        cached = true;
        progress(message.jobId, { stage: "cache", message: "Reusing the completed analysis for these limits.", percent: 100, cached: true });
      } else {
        const persisted = await loadPersistedResult("opportunity", key) ?? await loadCompatiblePreparedOpportunity(message.input, message.snapshots);
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
        rememberResult(key, result, 5 * 60_000);
      }
      await saveMarketLastKnownGood(message.input, message.snapshots, result);
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
      const manifest = await loadCurrentRawMarketManifest("all"); const key = genericCacheKey("raw-market", { ...message.input, marketSearchModel: "station-names-v2" }, manifest?.id);
      result = await loadPersistedResult("raw-market", key);
      if (result) { cached = true; progress(message.jobId, { stage: "disk-cache", message: "Loaded saved market search.", percent: 100, cached: true }); }
      else { progress(message.jobId, { stage: "market-search", message: "Searching the complete raw market order book…", percent: 20 }); result = await searchRawMarketOrders(message.input); await savePersistedResult("raw-market", key, result); progress(message.jobId, { stage: "market-search", message: "Market search complete.", percent: 100 }); }
    } else if (message.type === "run-regional-filter") {
      const manifest = await loadCurrentMarketRevision(); const key = genericCacheKey("regional-filter", message.input, manifest?.id);
      result = await loadPersistedResult("regional-filter", key);
      if (result) { cached = true; progress(message.jobId, { stage: "disk-cache", message: "Loaded saved regional market result.", percent: 100, cached: true }); }
      else { progress(message.jobId, { stage: "regional-filter", message: "Filtering the regional market index…", percent: 20 }); result = await filterRegionalMarket(message.input, { progress: (value) => progress(message.jobId, value) }); await savePersistedResult("regional-filter", key, result); progress(message.jobId, { stage: "regional-filter", message: "Regional market filter complete.", percent: 100 }); }
    } else {
      const context = await pveCacheContext(message.input, message.snapshot, message.cloneState);
      const key = context.key;
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
        } else {
          result = await analyzePveLocations(message.input, {
            snapshot: message.snapshot,
            cloneState: message.cloneState,
            progress: (value) => progress(message.jobId, value),
          });
          const freshContext = await pveCacheContext(message.input, message.snapshot, message.cloneState);
          await savePersistedResult("pve", freshContext.key, result);
        }
        rememberResult(key, result, 2 * 60_000);
      }
      await savePveLastKnownGood(message.input, message.snapshot, message.cloneState, result);
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
