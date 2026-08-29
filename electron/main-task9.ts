import { app, BrowserWindow, clipboard, dialog, ipcMain, powerMonitor, protocol, shell } from "electron";
import { autoUpdater } from "electron-updater";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fork, type ChildProcess } from "node:child_process";
import AdmZip from "adm-zip";
import ExcelJS from "exceljs";
import {
  decrypt,
  encrypt,
  publicConfig,
  readConfig,
  writeConfig,
  CURRENT_IDENTITY_SCHEMA_VERSION,
} from "./config";
import { createConnectedCharacterBootstrapSnapshot, fetchCharacterCoreSnapshot, fetchCharacterCurrentShipSnapshot, fetchCharacterSnapshot, fetchWalletOnlySnapshot, loginWithEve, refreshEveToken } from "./eve";
import { announceSageOperationToDiscord, applySageOperationRole, cancelSageOperation, setSageOperationApplicationNotifications, takeSageOperationOwnership, claimSageIdentity, configureSageDiscord, decideSageOperationApplication, ensureSageCorporationWorkspace, getSageDiscordLinkUrl, getSageDiscordServerStructure, getSageDiscordStatus, getSageOperation, linkSageCharacter, listSageOperations, publishSageOperation, sendSageDiscordAnnouncement, testSageDiscordDm, unlinkSageDiscord, updateSageDiscordNotificationTargets, updateSageOperation, getSageCorporationPermissions, updateSageCorporationPermission } from "./sage-online";
import {
  addImportedInformation,
  clearCharacterSnapshots,
  deleteSnapshot,
  exportDatabaseData,
  getSnapshot,
  importDatabaseData,
  listImportedInformation,
  getPlanetaryAlertSettings,
  listPlanetaryPlans,
  listPlanetaryResourceObservations,
  listSnapshots,
  replacePlanetaryResourceObservations,
  savePlanetaryAlertSettings,
  savePlanetaryPlan,
  deletePlanetaryPlan,
  saveSnapshot,
} from "./database";
import { listPublishedShips, stageStaticDataRefreshLowImpact } from "./type-volumes";
import { runMasterUpdate } from "./master-update";
import { getSyncMemorySnapshot, syncMemoryHeadroom } from "./sync-resources";
import { CRASH_LOG_FILE, LOG_FILE, logCrash, logEvent } from "./logger";
import { buildFitShoppingRoute, findRadiusTrades } from "./trade";
import { getEveNews } from "./news";
import { runFittingWorker, disposeFittingWorker } from "./fitting-worker-manager";
import { getFittingTypeInfoLocal } from "./fitting-dogma";
import { analyzeBlueprintActivities, analyzeManufacturingPlan, analyzeReactionPlan, getIndustrySystemCostIndices, getReactionCatalogue } from "./industrial-engine";
import { analyzeRefinery, getRefineryCatalogue } from "./refinery-engine";
import { createFoundryProject, getFoundryProjects, getFoundryWorkspace, removeFoundryProject, searchFoundryBlueprintCatalogue, synchronizeFoundryLifecycle, updateFoundryProject } from "./project-foundry";
import { getLootAcquisition, prepareLootDataLocal, searchLootItems } from "./loot-engine";
import { analyzeHullAccessPreviews, analyzeShipReadiness } from "./readiness";
import { analyzeActivityReadiness } from "./activity-readiness";
import { analyzeCurrentShipUse, type CurrentShipUseProfileId } from "./capability-engine";
import { loadPersistedResult, savePersistedResult } from "./persistent-result-cache";
import { searchRawMarketOrders } from "./raw-market-search";
import { checkSharedMarketDataAvailability, ensureCurrentSharedMarketData, loadCurrentMarketRevision, loadCurrentSharedMarketManifest, loadSharedPublicContractsDataset, loadSharedRegionalMarketAggregateIndex, SHARED_MARKET_ROOT, startSharedPublicDataListener, type SharedMarketSyncResult } from "./shared-market-data";
import { loadSharedMarketBrowserDataset, loadSharedMarketBrowserRegion, loadSharedMarketBrowserRegions, loadSharedMarketBrowserSummaries } from "./shared-market-browser";
import {
  runOpportunityAnalysis,
  runCapabilityAnalysis,
  runTradeAnalysis,
  runRawMarketSearch,
  runRegionalMarketFilter,
  runPveLocationAnalysis,
  loadPreparedOpportunityAnalysis,
  loadPreparedPveLocationAnalysis,
  cancelAnalysis,
  analysisStatus,
  disposeAnalysisWorker,
  stopAnalysisWorkersForExclusiveTask,
  releaseIdleMarketAnalysisWorker,
  releaseIdleAnalysisWorkers,
} from "./analysis-job-manager";
import {
  getBlueprintActivitiesPrepared,
  getIndustrialOpportunitiesPrepared,
  getManufacturingPlanPrepared,
  getSystemCostIndexPrepared,
  loadIndustrialPreparedState,
} from "./industrial-preparation";
import { configureAndStartMcpTunnel, getMcpTunnelStatus, startMcpTunnel } from "./mcp-tunnel";
import { startMcpWriteBridge, stopMcpWriteBridge } from "./mcp-write-bridge";
import { claudeSetupText, ensureClaudeCompatibility, getClaudeCompatibilityStatus, installClaudeCompatibility, repairClaudeDesktopDirectConfig, showClaudeDesktopBundle } from "./claude-integration";
import { typeImageProtocolResponse } from "./eve-assets";
import { getHostClockInfo, setHostClock, syncHostClock } from "./system-time";
import { getContractMarketIntelligence, loadGlobalMarketQuotes } from "./market-intelligence";
import { analyzeLpCorporation, getLpEarningCandidates, resolveLpCorporations } from "./lp-store";
import { applyProfitBulkBookkeeping, completeProfitDeal, getProfitLedger, getProfitPurchaseReview, getProfitReconciliationReview, reconcileProfitLedger, removeProfitLedgerRecord, setProfitMatchDecision, setProfitMaterialProvenance, setProfitPurchaseTransactionOverride, setProfitTransactionOverride } from "./profit-ledger";
import { analyzePlanetaryRevenue, buildPlanetaryPlan, type PlanetaryPlanInput, type PlanetaryRevenueSettings } from "./planetary-revenue";
import { analyzePlanetaryAdvanced, buildPlanetaryBasketPlan, buildPlanetaryDesignerEveTemplate, buildPlanetaryDesignerSeedFromSnapshot, evaluatePlanetaryDesignerLayout, generatePlanetaryDesignerLayouts, type PlanetaryBasketInput, type PlanetaryDesignerInput } from "./planetary-advanced";
import { getSagePiObject, listSagePiObjects, publishSagePiObject, unpublishSagePiObject, updateSagePiObject } from "./planetary-online";
import { exportNavigationWaypoints } from "./navigation-eve-export";
import { registerWormholeCommandIpc } from "./wormhole-command-store";
import { getWormholeReference, getWormholeReferenceEntry, getWormholeRollingShipMass, getWormholeSystemReferences } from "./wormhole-reference";

protocol.registerSchemesAsPrivileged([{
  scheme: "sage-asset",
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
}]);

let window: BrowserWindow | null = null;
let masterUpdateActive = false;
const STARTUP_SYNC_GUARD_MS = 30_000;
const startupSyncGuardUntil = Date.now() + STARTUP_SYNC_GUARD_MS;

let stopSharedPublicListener: (() => void) | undefined;
let publicReconcileTimer: NodeJS.Timeout | undefined;
const PUBLIC_RECONCILE_INTERVAL_MS = 60 * 60 * 1000;
let publicAvailability = {
  updateAvailable: false,
  availableGeneration: null as string | null,
  lastCheckedAt: null as string | null,
};

function announceInstalledPublicData(result: SharedMarketSyncResult) {
  window?.webContents.send("prepared:data-updated", {
    completedAt: new Date().toISOString(),
    publicDataUpdated: true,
    publicGeneration: result.manifest.generation,
    publicArtifacts: result.changed,
  });
}

async function loadPublicDataStatus() {
  const manifest = await loadCurrentSharedMarketManifest();
  return {
    installed: Boolean(manifest),
    generation: manifest?.generation ?? null,
    createdAt: manifest?.sourceCreatedAt ?? manifest?.publishedAt ?? null,
    source: manifest ? ("shared" as const) : null,
    orderCount: manifest?.orderCount ?? 0,
    regionCount: manifest?.regionCount ?? 0,
    updateAvailable: publicAvailability.updateAvailable,
    availableGeneration: publicAvailability.availableGeneration,
    lastCheckedAt: publicAvailability.lastCheckedAt,
  };
}

function publishPublicDataStatus(status: Awaited<ReturnType<typeof loadPublicDataStatus>>) {
  window?.webContents.send("public-data:status-changed", status);
}

async function refreshPublicDataAvailability() {
  const availability = await checkSharedMarketDataAvailability();
  publicAvailability = {
    updateAvailable: availability.updateAvailable,
    availableGeneration: availability.availableGeneration,
    lastCheckedAt: availability.checkedAt,
  };
  const status = await loadPublicDataStatus();
  publishPublicDataStatus(status);
  return status;
}

function markPublicDataAvailable(generation: string) {
  publicAvailability = { updateAvailable: true, availableGeneration: generation, lastCheckedAt: new Date().toISOString() };
  void loadPublicDataStatus().then(publishPublicDataStatus).catch(() => undefined);
}

function publicInstallPercent(message: string, completed?: number, total?: number) {
  if (/ready/i.test(message)) return 100;
  if (/install/i.test(message)) return 96;
  if (/validat/i.test(message)) return 90;
  if (/download/i.test(message) && total && total > 0) return Math.min(84, 10 + Math.round((Math.max(0, completed ?? 0) / total) * 74));
  if (/check/i.test(message)) return 5;
  return 8;
}

async function installSharedPublicData() {
  window?.webContents.send("public-data:progress", { running: true, percent: 2, message: "Checking server generation..." });
  try {
    const result = await ensureCurrentSharedMarketData((message, completed, total) => {
      window?.webContents.send("public-data:progress", { running: true, percent: publicInstallPercent(message, completed, total), message, completed, total });
    });
    if (result.changed.length) announceInstalledPublicData(result);
    publicAvailability = { updateAvailable: false, availableGeneration: result.manifest.generation, lastCheckedAt: new Date().toISOString() };
    const status = await loadPublicDataStatus();
    publishPublicDataStatus(status);
    window?.webContents.send("public-data:progress", { running: false, percent: 100, message: result.changed.length ? "Public data updated." : "Public data is current." });
    return { ...status, changed: result.changed.length > 0, changedArtifacts: result.changed };
  } catch (error) {
    window?.webContents.send("public-data:progress", { running: false, percent: 0, message: "Public data update failed.", error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

function startSharedPublicDataFlow() {
  stopSharedPublicListener?.();
  stopSharedPublicListener = startSharedPublicDataListener((notice) => markPublicDataAvailable(notice.generation));
  if (publicReconcileTimer) clearInterval(publicReconcileTimer);
  publicReconcileTimer = setInterval(() => {
    void refreshPublicDataAvailability().catch((error) => void logEvent("warn", "shared_public.hourly_availability_check_failed", { error: error instanceof Error ? error.message : String(error) }));
  }, PUBLIC_RECONCILE_INTERVAL_MS);
  publicReconcileTimer.unref?.();
  powerMonitor.on("resume", () => {
    void refreshPublicDataAvailability().catch((error) => void logEvent("warn", "shared_public.resume_availability_check_failed", { error: error instanceof Error ? error.message : String(error) }));
  });
}

function automaticSyncStatePath() {
  return path.join(app.getPath("userData"), "automatic-sync-state.json");
}

function syncPreparationPreferencesPath() {
  return path.join(app.getPath("userData"), "sync-preparation-preferences.json");
}

async function readSyncPreparationOptions(): Promise<CompleteSyncOptions> {
  try {
    return JSON.parse(await fs.readFile(syncPreparationPreferencesPath(), "utf8")) as CompleteSyncOptions;
  } catch {
    return {};
  }
}

async function saveSyncPreparationOptions(options: CompleteSyncOptions) {
  await fs.writeFile(syncPreparationPreferencesPath(), JSON.stringify(options), "utf8");
}

async function hasSyncedThisVersion() {
  try {
    const state = JSON.parse(await fs.readFile(automaticSyncStatePath(), "utf8")) as { version?: string };
    return state.version === app.getVersion();
  } catch {
    return false;
  }
}

async function markVersionSynced() {
  await fs.writeFile(automaticSyncStatePath(), JSON.stringify({ version: app.getVersion(), syncedAt: new Date().toISOString() }), "utf8");
}

type PrepTrackStatus = "waiting" | "running" | "done" | "error";
type PrepTrackId = "core" | "industrial-command" | "isk-lab" | "market-scanner" | "opportunities" | "inventions" | "pve-locations" | "progression";
type PrepTrack = { id: PrepTrackId; label: string; percent: number; status: PrepTrackStatus; message: string };
type CompleteSyncOptions = { cloneStates?: Record<string, "alpha" | "omega">; characterIds?: string[] };

const DEFAULT_ACTIVITY_PREPARATION = {
  activityId: "pve",
  subcategoryId: "missions",
  contentId: "missions-l1-l2",
  selectorValues: { shipClass: "Destroyer" },
  coreSkills: [
    { skill: "CPU Management", level: 5 },
    { skill: "Power Grid Management", level: 5 },
    { skill: "Navigation", level: 4 },
    { skill: "Evasive Maneuvering", level: 4 },
  ],
  supportSkills: [
    { skill: "Target Management", level: 3 },
    { skill: "Social", level: 3 },
  ],
  shipNames: ["Cormorant", "Catalyst", "Coercer", "Thrasher"],
};

const PREP_TRACK_LABELS: Array<[PrepTrackId, string]> = [
  ["core", "Live data & indexes"],
  ["industrial-command", "Industrial Command"],
  ["isk-lab", "ISK Lab"],
  ["market-scanner", "Market Scanner"],
  ["opportunities", "Opportunities"],
  ["inventions", "Invention results"],
  ["pve-locations", "PvE & Locations"],
  ["progression", "Progression"],
];

function newPrepTracks(): PrepTrack[] {
  return PREP_TRACK_LABELS.map(([id, label]) => ({ id, label, percent: 0, status: "waiting", message: "Waiting for shared data." }));
}

function clampPrepPercent(value: unknown) {
  const numeric = Number(value ?? 0);
  return Math.max(0, Math.min(100, Number.isFinite(numeric) ? numeric : 0));
}

function prepTrack(tracks: PrepTrack[], id: PrepTrackId) {
  const track = tracks.find((item) => item.id === id);
  if (!track) throw new Error(`Preparation track ${id} is missing.`);
  return track;
}

function refreshIskLabTrack(tracks: PrepTrack[]) {
  const children = (["market-scanner", "opportunities", "inventions", "pve-locations"] as PrepTrackId[]).map((id) => prepTrack(tracks, id));
  const parent = prepTrack(tracks, "isk-lab");
  parent.percent = Math.round(children.reduce((sum, item) => sum + item.percent, 0) / children.length);
  parent.status = children.some((item) => item.status === "error")
    ? "error"
    : children.every((item) => item.status === "done")
      ? "done"
      : children.some((item) => item.status === "running" || item.percent > 0)
        ? "running"
        : "waiting";
  parent.message = parent.status === "done"
    ? "All ISK Lab intelligence is prepared."
    : parent.status === "error"
      ? "One or more ISK Lab preparations need retrying."
      : "Preparing the ISK Lab intelligence set.";
}

function completeSyncPercent(tracks: PrepTrack[]) {
  const core = prepTrack(tracks, "core").percent;
  const leaves = (["industrial-command", "market-scanner", "inventions", "pve-locations", "progression"] as PrepTrackId[]).map((id) => prepTrack(tracks, id).percent);
  const prepared = leaves.reduce((sum, value) => sum + value, 0) / Math.max(1, leaves.length);
  return Math.min(99, Math.round(core * 0.55 + prepared * 0.45));
}

let featurePrepProcessQueue: Promise<void> = Promise.resolve();

async function runFeaturePrepProcessNow<T = unknown>(
  processData: any,
  onProgress?: (progress: { percent?: number; message?: string }) => void,
) {
  const task = String(processData?.task ?? "unknown");
  const headroom = await ensureSyncMemoryHeadroom(`feature-process:${task}`);
  if (!headroom.ok) {
    throw new Error(
      `Not enough memory to start ${task} safely (${headroom.sample.freeSystemMb.toLocaleString()} MB free; ${headroom.minFreeSystemMb.toLocaleString()} MB reserved). Existing prepared data was kept.`,
    );
  }

  return new Promise<T>((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = fork(path.join(__dirname, "feature-prep-process.js"), [], {
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: "1",
          NEW_EDEN_SAGE_USER_DATA: app.getPath("userData"),
        },
        stdio: ["ignore", "ignore", "pipe", "ipc"],
        execArgv: ["--max-old-space-size=1536"],
      });
    } catch (error) {
      reject(error);
      return;
    }

    void logSyncMemory("master_update.feature_process_start", { task, pid: child.pid });
    let settled = false;
    let timeout: NodeJS.Timeout | undefined;
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr = `${stderr}${String(chunk)}`.slice(-4_000);
    });

    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      child.removeAllListeners("message");
      child.removeAllListeners("error");
      child.removeAllListeners("exit");

      let finished = false;
      const afterExit = () => {
        if (finished) return;
        finished = true;
        callback();
      };
      child.once("exit", afterExit);
      try {
        if (child.connected) child.disconnect();
      } catch {
        // The process may already have closed its IPC channel.
      }
      if (child.exitCode !== null || child.signalCode !== null) {
        afterExit();
      } else {
        child.kill();
        const killFallback = setTimeout(afterExit, 2_000);
        killFallback.unref();
      }
    };

    timeout = setTimeout(
      () => finish(() => reject(new Error(`Feature preparation timed out after 15 minutes (${task}).`))),
      15 * 60_000,
    );
    timeout.unref();

    child.on("message", (message: any) => {
      if (message?.type === "progress") onProgress?.(message);
      if (message?.type === "complete") {
        finish(() => {
          void logSyncMemory("master_update.feature_process_complete", { task, pid: child.pid });
          resolve(message.result as T);
        });
      }
      if (message?.type === "error") {
        finish(() => reject(new Error(String(message.error ?? "Feature preparation failed."))));
      }
    });
    child.once("error", (error) => finish(() => {
      void logSyncMemory("master_update.feature_process_error", {
        task,
        pid: child.pid,
        error: error instanceof Error ? error.message : String(error),
        stderr,
      });
      reject(error);
    }));
    child.once("exit", (code, signal) => {
      void logSyncMemory("master_update.feature_process_exit", { task, pid: child.pid, code, signal, settled, stderr });
      if (!settled) {
        finish(() => reject(new Error(`Feature preparation process exited before completion (${code ?? signal ?? "unknown"}).`)));
      }
    });
    child.once("spawn", () => {
      child.send?.(processData, (error) => {
        if (error) finish(() => reject(error));
      });
    });
  });
}

function runFeaturePrepProcess<T = unknown>(
  processData: any,
  onProgress?: (progress: { percent?: number; message?: string }) => void,
) {
  const queued = featurePrepProcessQueue.then(
    () => runFeaturePrepProcessNow<T>(processData, onProgress),
    () => runFeaturePrepProcessNow<T>(processData, onProgress),
  );
  featurePrepProcessQueue = queued.then(() => undefined, () => undefined);
  return queued;
}

async function logSyncMemory(event: string, detail: Record<string, unknown> = {}) {
  await logEvent("info", event, { ...detail, memory: getSyncMemorySnapshot() });
}

async function ensureSyncMemoryHeadroom(context: string) {
  let decision = syncMemoryHeadroom(getSyncMemorySnapshot());
  if (!decision.ok) {
    await Promise.all([
      disposeFittingWorker(),
      releaseIdleMarketAnalysisWorker(),
      releaseIdleAnalysisWorkers(),
    ]);
    await new Promise((resolve) => setTimeout(resolve, 750));
    decision = syncMemoryHeadroom(getSyncMemorySnapshot());
  }
  await logEvent(decision.ok ? "info" : "warn", "master_update.memory_guard", {
    context,
    ...decision,
  });
  return decision;
}

function inventionSkillFingerprint(snapshot: any) {
  return (snapshot?.skills?.skills ?? [])
    .map((skill: any) => `${skill.skill_id}:${skill.trained_skill_level ?? 0}`)
    .sort()
    .join("|");
}

function inventionOwnedOriginalIds(snapshot: any) {
  return [...new Set([
    ...(Array.isArray(snapshot?.extended?.blueprints) ? snapshot.extended.blueprints : []),
    ...(Array.isArray(snapshot?.extended?.corporation?.blueprints) ? snapshot.extended.corporation.blueprints : []),
  ]
    .filter((blueprint: any) => Number(blueprint?.quantity) === -1)
    .map((blueprint: any) => Number(blueprint.type_id))
    .filter((typeId: number) => Number.isInteger(typeId) && typeId > 0))]
    .sort((a: number, b: number) => a - b);
}
async function inventionPreparedCacheKey(input: { characterId: string; decryptorTypeId?: number | null }, snapshot: any) {
  const manifest = await loadCurrentMarketRevision();
  return {
    schema: 11,
    characterId: String(input.characterId),
    skills: inventionSkillFingerprint(snapshot),
    ownedOriginals: inventionOwnedOriginalIds(snapshot),
    marketSnapshotId: manifest?.id ?? "none",
    decryptorTypeId: Number(input.decryptorTypeId ?? 0),
  };
}

async function loadPreparedInventionResult(input: { characterId: string; decryptorTypeId?: number | null }, snapshot: any) {
  const key = await inventionPreparedCacheKey(input, snapshot);
  const exact = await loadPersistedResult<any>("industry-invention-opportunities", key);
  return { key, result: exact };
}

async function runCompleteSync(sendProgress: (progress: any) => void, skipIfVersionSynced = false, options: CompleteSyncOptions = {}) {
  if (masterUpdateActive) return { alreadyRunning: true };
  if (skipIfVersionSynced && await hasSyncedThisVersion()) {
    await logEvent("info", "master_update.skipped_already_synced", { version: app.getVersion() });
    return { alreadySynced: true, version: app.getVersion() };
  }

  const startedAtMs = Date.now();
  let lastProgress: any = null;
  masterUpdateActive = true;
  const tracks = newPrepTracks();

  const publish = (message: string, extra: Record<string, unknown> = {}, running = true) => {
    refreshIskLabTrack(tracks);
    sendProgress({
      ...extra,
      running,
      message,
      percent: running ? completeSyncPercent(tracks) : 100,
      tracks: tracks.map((item) => ({ ...item })),
    });
  };

  const setTrack = (id: PrepTrackId, patch: Partial<PrepTrack>) => {
    Object.assign(prepTrack(tracks, id), patch);
  };

  try {
    await logEvent("info", "private_refresh.sync_started", { source: "automatic-or-manual-private-refresh", publicMarketCompute: "server-only", privateDataDestination: "local-only" });
    setTrack("core", { percent: 0, status: "running", message: "Refreshing private data locally." });
    publish("Refreshing private data", { stage: "private-starting" });

    const coreResult = await runMasterUpdate((progress: any) => {
      lastProgress = progress;
      setTrack("core", {
        percent: clampPrepPercent(progress.percent),
        status: progress.running === false || progress.percent >= 100 ? "done" : "running",
        message: String(progress.message ?? "Refreshing private data."),
      });
      publish(String(progress.message ?? "Refreshing private data."), { ...progress, running: true });
    }, options.characterIds);

    const coreFailures = Array.isArray(coreResult?.failures) ? coreResult.failures : [];
    setTrack("core", {
      percent: 100,
      status: coreFailures.length ? "error" : "done",
      message: coreFailures.length ? `Private refresh completed with ${coreFailures.length} failed source(s).` : "Private character data is ready.",
    });

    // Private refresh ends at the player-data boundary. Public intelligence is prepared by the server;
    // private/feature-specific work stays local and is evaluated on demand by its module.
    setTrack("market-scanner", { percent: 100, status: "done", message: "Uses server-prepared public market intelligence." });
    setTrack("opportunities", { percent: 100, status: "done", message: "Uses server-prepared public market intelligence." });
    setTrack("industrial-command", { percent: 100, status: "done", message: "Uses shared market data with local character data on demand." });
    setTrack("pve-locations", { percent: 100, status: "done", message: "Prepared on demand when opened." });
    setTrack("progression", { percent: 100, status: "done", message: "Prepared on demand when opened." });
    setTrack("inventions", { percent: 100, status: "done", message: "Prepared on demand when Invention is opened." });
    refreshIskLabTrack(tracks);

    if (!coreFailures.length) await markVersionSynced();
    const snapshots = listSnapshots() as any[];
    const totalDurationMs = Date.now() - startedAtMs;
    const finalMessage = coreFailures.length ? `Private refresh finished with ${coreFailures.length} failed source(s).` : "Private data refreshed";
    publish(finalMessage, {
      stage: coreFailures.length ? "complete-with-core-errors" : "ready",
      totalDurationMs,
      downloadDurationMs: coreResult?.downloadDurationMs,
      completed: PREP_TRACK_LABELS.length,
      total: PREP_TRACK_LABELS.length,
    }, false);
    window?.webContents.send("prepared:data-updated", {
      completedAt: new Date().toISOString(),
      characterIds: options.characterIds?.length ? options.characterIds : snapshots.map((snapshot) => String(snapshot.characterId)),
      preparationFailures: 0,
      privateDataReady: !coreFailures.length,
    });
    await logEvent("info", "private_refresh.total_ms", { durationMs: totalDurationMs, failures: coreFailures.length });
    await logEvent("info", "master_update.sync_ready", { totalDurationMs, coreFailures: coreFailures.length, publicMarketCompute: "server-only" });
    return { ...coreResult, totalDurationMs, preparationFailures: [] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logCrash("master_update.crashed", { error, lastProgress });
    publish(`Update stopped: ${message}`, { stage: "failed", totalDurationMs: Date.now() - startedAtMs }, false);
    throw error;
  } finally {
    masterUpdateActive = false;
  }
}
app.on("render-process-gone", (_event, contents, details) => {
  void logEvent("error", "electron.render_process_gone", { webContentsId: contents.id, reason: details.reason, exitCode: details.exitCode });
});
app.on("child-process-gone", (_event, details) => {
  void logEvent("error", "electron.child_process_gone", { type: details.type, reason: details.reason, exitCode: details.exitCode, serviceName: details.serviceName, name: details.name });
});

process.on(
  "uncaughtException",
  (error) => void logEvent("error", "process.uncaught_exception", { error }),
);
process.on(
  "unhandledRejection",
  (error) =>
    void logEvent("error", "process.unhandled_rejection", {
      error: error instanceof Error ? error : String(error),
    }),
);

let walletReconciliationRunning = false;

async function runWalletOnlyReconciliation() {
  if (walletReconciliationRunning) return { skipped: true, reason: "already-running" };
  walletReconciliationRunning = true;
  const startedAt = Date.now();
  let refreshed = 0;
  let failed = 0;
  try {
    const config = await readConfig();
    const characterIds = Object.keys(config.encryptedRefreshTokens ?? {});
    let configChanged = false;
    for (const characterId of characterIds) {
      const encrypted = config.encryptedRefreshTokens[characterId];
      const existing = getSnapshot(characterId) as any;
      if (!encrypted || !existing) continue;
      try {
        const tokens = await refreshEveToken(config.eveClientId, decrypt(encrypted));
        if (tokens.refresh_token) {
          config.encryptedRefreshTokens[characterId] = encrypt(tokens.refresh_token);
          configChanged = true;
        }
        const snapshot = await fetchWalletOnlySnapshot(characterId, tokens.access_token, existing);
        saveSnapshot(snapshot);
        refreshed += 1;
      } catch (error) {
        failed += 1;
        await logEvent("warn", "wallet_reconciliation.character_refresh_failed", { characterId, error: error instanceof Error ? error.message : String(error) });
      }
    }
    if (configChanged) await writeConfig(config);
    const ledger = reconcileProfitLedger();
    const result = { skipped: false, refreshed, failed, ledgerRecords: ledger.length, durationMs: Date.now() - startedAt, completedAt: new Date().toISOString() };
    window?.webContents.send("wallet:reconciled", result);
    await logEvent("info", "wallet_reconciliation.completed", result);
    return result;
  } finally {
    walletReconciliationRunning = false;
  }
}

async function eveWriteAccessToken(characterId: string) {
  const config = await readConfig();
  const stored = config.encryptedRefreshTokens[characterId];
  if (!stored) throw new Error("This character is not connected. Reconnect it in Settings first.");
  const tokens = await refreshEveToken(config.eveClientId, decrypt(stored));
  if (tokens.refresh_token) {
    config.encryptedRefreshTokens[characterId] = encrypt(tokens.refresh_token);
    await writeConfig(config);
  }
  return tokens.access_token;
}

async function resolveOnlineEveUiCharacter(preferredCharacterId: string) {
  const config = await readConfig();
  const connectedCharacterIds = Object.keys(config.encryptedRefreshTokens ?? {});
  const orderedCharacterIds = [preferredCharacterId, ...connectedCharacterIds.filter((id) => id !== preferredCharacterId)].filter(Boolean);
  if (!orderedCharacterIds.length) throw new Error("Connect a character to Sage before using Find in EVE.");
  let permissionDenied = false;
  for (const characterId of orderedCharacterIds) {
    try {
      const accessToken = await eveWriteAccessToken(characterId);
      const response = await fetch(`https://esi.evetech.net/characters/${encodeURIComponent(characterId)}/online/`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "X-Compatibility-Date": "2026-08-02",
          "X-User-Agent": "NewEdenSage/1.1.12",
        },
      });
      if (response.status === 401 || response.status === 403) {
        permissionDenied = true;
        continue;
      }
      if (!response.ok) continue;
      const state = await response.json() as { online?: boolean };
      if (!state.online) continue;
      const snapshot = getSnapshot(characterId) as any;
      return {
        characterId,
        characterName: String(snapshot?.character?.name ?? characterId),
        accessToken,
        usedFallback: characterId !== preferredCharacterId,
      };
    } catch {
      continue;
    }
  }
  if (permissionDenied) throw new Error("Find in EVE needs the EVE online/UI permissions. Reconnect your EVE characters once with Add character, then try again.");
  throw new Error("No connected Sage character is currently online in EVE. Log into EVE with one of your connected characters, then try Find in EVE again.");
}

async function eveWriteRequest(characterId: string, url: string, body?: unknown, accessToken?: string) {
  const token = accessToken ?? await eveWriteAccessToken(characterId);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-Compatibility-Date": "2026-08-02",
      "X-User-Agent": "NewEdenSage/1.1.7",
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    const error = new Error(`EVE action failed (${response.status})${detail ? `: ${detail}` : "."}`) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  if (response.status === 204) return { success: true };
  return response.json() as Promise<any>;
}

function eveFittingPayload(fit: any) {
  const hullTypeId = Number(fit?.hull?.typeId);
  if (!Number.isSafeInteger(hullTypeId) || hullTypeId <= 0) throw new Error("Resolve the fitting hull before exporting it to EVE.");
  const items: Array<{ type_id: number; flag: string; quantity: number }> = [];
  const rack = (values: any[], prefix: string) => {
    let slot = 0;
    for (const item of values ?? []) {
      const typeId = Number(item?.typeId);
      if (!Number.isSafeInteger(typeId) || typeId <= 0) throw new Error(`Resolve ${item?.name ?? "a fitted module"} before exporting to EVE.`);
      const quantity = Math.max(1, Math.floor(Number(item?.quantity ?? 1)));
      for (let index = 0; index < quantity; index += 1) items.push({ type_id: typeId, flag: `${prefix}${slot++}`, quantity: 1 });
    }
  };
  rack(fit.low, "LoSlot");
  rack(fit.mid, "MedSlot");
  rack(fit.high, "HiSlot");
  rack(fit.rig, "RigSlot");
  rack(fit.subsystem, "SubSystemSlot");
  const bay = new Map<string, { type_id: number; flag: string; quantity: number }>();
  const addBay = (values: any[], flag: string) => {
    for (const item of values ?? []) {
      const typeId = Number(item?.typeId);
      if (!Number.isSafeInteger(typeId) || typeId <= 0) throw new Error(`Resolve ${item?.name ?? "a fitting item"} before exporting to EVE.`);
      const quantity = Math.max(1, Math.floor(Number(item?.quantity ?? 1)));
      const key = `${flag}:${typeId}`;
      const current = bay.get(key);
      bay.set(key, { type_id: typeId, flag, quantity: (current?.quantity ?? 0) + quantity });
    }
  };
  addBay(fit.drones, "DroneBay");
  addBay(fit.fighters, "FighterBay");
  addBay(fit.cargo, "Cargo");
  const fitted = [...(fit.low ?? []), ...(fit.mid ?? []), ...(fit.high ?? [])];
  for (const item of fitted) {
    const chargeTypeId = Number(item?.chargeTypeId);
    if (!Number.isSafeInteger(chargeTypeId) || chargeTypeId <= 0) continue;
    const quantity = Math.max(1, Math.floor(Number(item?.chargeQuantity ?? 1)));
    const key = `Cargo:${chargeTypeId}`;
    const current = bay.get(key);
    bay.set(key, { type_id: chargeTypeId, flag: "Cargo", quantity: (current?.quantity ?? 0) + quantity });
  }
  items.push(...bay.values());
  return {
    name: String(fit?.name || fit?.hull?.name || "New Eden Sage fit").slice(0, 50),
    description: "Exported from New Eden Sage.",
    ship_type_id: hullTypeId,
    items,
  };
}
async function ensurePrimaryIdentityMigration() {
  if (!app.isPackaged) return;
  const config = await readConfig();
  if (config.identitySchemaVersion >= CURRENT_IDENTITY_SCHEMA_VERSION) return;

  const disconnectedCharacterIds = Object.keys(config.encryptedRefreshTokens);
  config.encryptedRefreshTokens = {};
  config.encryptedSageSessionToken = undefined;
  config.sageAccountId = undefined;
  config.primaryCharacterId = undefined;
  config.identitySchemaVersion = CURRENT_IDENTITY_SCHEMA_VERSION;
  config.identityMigratedAt = new Date().toISOString();
  await writeConfig(config);
  clearCharacterSnapshots();
  await logEvent("info", "identity.migration.reset-characters", {
    identitySchemaVersion: CURRENT_IDENTITY_SCHEMA_VERSION,
    disconnectedCharacters: disconnectedCharacterIds.length,
  });
}

async function planetaryCorporationContext(characterId: string) {
  const config = await readConfig();
  if (!config.encryptedSageSessionToken) {
    throw new Error("Sage Online is not connected. Reconnect your primary Sage character first.");
  }

  const requested = String(characterId ?? "").trim();
  if (!requested) {
    throw new Error("Select a connected EVE character for corporation verification.");
  }

  const refreshEncrypted = config.encryptedRefreshTokens[requested];
  if (!refreshEncrypted) {
    throw new Error("No EVE refresh token is available for the selected character. Reconnect that character before using corporation tools.");
  }

  const refreshed = await refreshEveToken(config.eveClientId, decrypt(refreshEncrypted));
  const sessionToken = decrypt(config.encryptedSageSessionToken);
  const workspace = await ensureSageCorporationWorkspace(sessionToken, refreshed.access_token);
  const verifiedCharacterId = String(workspace.character_id ?? "");

  if (verifiedCharacterId !== requested) {
    if (refreshed.refresh_token && verifiedCharacterId) {
      config.encryptedRefreshTokens[verifiedCharacterId] = encrypt(refreshed.refresh_token);
    }
    delete config.encryptedRefreshTokens[requested];
    await writeConfig(config);
    throw new Error(
      `Stored EVE credentials for character ${requested} resolved to ${workspace.character_name || verifiedCharacterId}. Reconnect the selected character before using corporation tools.`,
    );
  }

  if (refreshed.refresh_token) {
    config.encryptedRefreshTokens[requested] = encrypt(refreshed.refresh_token);
    await writeConfig(config);
  }

  return { sessionToken, workspace, eveAccessToken: refreshed.access_token };
}

async function sageOnlineSessionTokenOnly() {
  const config=await readConfig();
  if(!config.encryptedSageSessionToken) throw new Error("Sage Online is not connected. Reconnect your primary Sage character first.");
  return decrypt(config.encryptedSageSessionToken);
}
async function loadPlanetaryCorporationLibrary(characterId:string) {
  const {sessionToken,workspace}=await planetaryCorporationContext(characterId);
  const [surveySummaries,templateSummaries]=await Promise.all([listSagePiObjects(sessionToken,workspace.workspace_id,"sage.pi-survey"),listSagePiObjects(sessionToken,workspace.workspace_id,"sage.pi-template")]);
  const [surveys,templates]=await Promise.all([
    Promise.all(surveySummaries.slice(0,100).map(async summary=>({summary,payload:(await getSagePiObject(sessionToken,workspace.workspace_id,summary.id)).payload}))),
    Promise.all(templateSummaries.slice(0,100).map(async summary=>({summary,payload:(await getSagePiObject(sessionToken,workspace.workspace_id,summary.id)).payload}))),
  ]);
  return {workspace,surveys,templates};
}

function createWindow() {
  window = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1040,
    minHeight: 700,
    backgroundColor: "#071018",
    title: "New Eden Sage",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  if (process.argv.includes("--dev")) window.loadURL("http://localhost:42814");
  else window.loadFile(path.join(__dirname, "../dist/index.html"));
}

const hasSingleInstanceLock =
  (globalThis as typeof globalThis & { __sageSingleInstanceLockHeld?: boolean }).__sageSingleInstanceLockHeld
  ?? app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  });

  app.whenReady().then(async () => {
    await ensurePrimaryIdentityMigration();
  protocol.handle("sage-asset", (request) => typeImageProtocolResponse(request.url));
  registerWormholeCommandIpc();
  ipcMain.handle("wormhole:reference-list", () => getWormholeReference());
  ipcMain.handle("wormhole:reference-get", (_event, code: unknown) => getWormholeReferenceEntry(code));
  ipcMain.handle("wormhole:system-reference", (_event, systemIds: unknown) => getWormholeSystemReferences(systemIds));
  ipcMain.handle("wormhole:rolling-ship-mass", (_event, input: unknown) => getWormholeRollingShipMass(input));
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  const sendUpdateStatus = (status: string, detail?: unknown) => window?.webContents.send("update:status", { status, detail });
  autoUpdater.on("checking-for-update", () => sendUpdateStatus("checking"));
  autoUpdater.on("update-available", (info) => sendUpdateStatus("available", info));
  autoUpdater.on("update-not-available", (info) => sendUpdateStatus("current", info));
  autoUpdater.on("download-progress", (progress) => sendUpdateStatus("downloading", progress));
  autoUpdater.on("update-downloaded", (info) => sendUpdateStatus("downloaded", info));
  autoUpdater.on("error", (error) => sendUpdateStatus("error", error.message));
  ipcMain.handle("update:get-state", () => ({ version: app.getVersion(), packaged: app.isPackaged }));
  ipcMain.handle("update:check", async () => {
    if (!app.isPackaged) return { status: "current", development: true, version: app.getVersion() };
    const result = await autoUpdater.checkForUpdates();
    const available = Boolean(result?.updateInfo?.version && result.updateInfo.version !== app.getVersion());
    return { status: available ? "available" : "current", detail: result?.updateInfo };
  });
  ipcMain.handle("update:download", () => autoUpdater.downloadUpdate());
  ipcMain.handle("update:install", () => { autoUpdater.quitAndInstall(false, true); return true; });
  ipcMain.handle("external:open-support", () =>
    shell.openExternal("https://www.paypal.com/donate/?hosted_button_id=5ZE4R48W6UWMC"),
  );
  ipcMain.handle("external:open-discord-url", (_event, raw:string) => {
    const url=new URL(String(raw??""));
    if(url.protocol!=="https:" || (url.hostname!=="discord.com" && url.hostname!=="www.discord.com")) throw new Error("Only Discord HTTPS links may be opened from Discord Integration.");
    return shell.openExternal(url.toString());
  });  ipcMain.handle("external:open-zkillboard", (_event, killmailId?: number) => {
    const id = Number(killmailId ?? 0);
    const url = Number.isSafeInteger(id) && id > 0 ? `https://zkillboard.com/kill/${id}/` : "https://zkillboard.com/";
    return shell.openExternal(url);
  });
  ipcMain.handle("mcp:get-setup", () => {
    const command = app.getPath("exe");
    const script = path.join(app.getAppPath(), "dist-electron", "mcp-cli.js");
    const args = [script];
    const env = { ELECTRON_RUN_AS_NODE: "1" };
    return {
      command,
      args,
      json: JSON.stringify({ mcpServers: { "new-eden-sage": { command, args, env } } }, null, 2),
      codex: `[mcp_servers.new-eden-sage]\ncommand = ${JSON.stringify(command)}\nargs = [${JSON.stringify(script)}]\nenv = { ELECTRON_RUN_AS_NODE = "1" }`,
      access: "Local read access plus explicit fitting write actions. Live EVE writes require Sage to be open and a reconnected character. Credentials, tokens, secrets and encrypted values are never exposed.",
      claudeDesktop: claudeSetupText().desktopJson,
      claudeCode: claudeSetupText().claudeCodeCommand,
    };
  });
  ipcMain.handle("mcp:claude-status", () => getClaudeCompatibilityStatus());
  ipcMain.handle("mcp:claude-repair", () => installClaudeCompatibility());
  ipcMain.handle("mcp:claude-direct-repair", () => repairClaudeDesktopDirectConfig());
  ipcMain.handle("mcp:claude-show-bundle", () => showClaudeDesktopBundle());
  ipcMain.handle("mcp:tunnel-status", () => getMcpTunnelStatus());
  ipcMain.handle("mcp:tunnel-configure", (_event, input: { tunnelId: string; runtimeKey: string }) => configureAndStartMcpTunnel(input));
  ipcMain.handle("mcp:open-chatgpt", () => shell.openExternal("https://chatgpt.com/plugins"));
  ipcMain.handle("mcp:open-tunnels", () => shell.openExternal("https://platform.openai.com/settings/organization/tunnels"));
  ipcMain.handle("mcp:open-api-keys", () => shell.openExternal("https://platform.openai.com/settings/organization/api-keys"));
  void startMcpTunnel().catch((error) => void logEvent("error", "mcp.tunnel_start_failed", { error }));
  void startMcpWriteBridge(() => window).catch((error) => void logEvent("error", "mcp.write_bridge_start_failed", { error }));
  void ensureClaudeCompatibility()
    .then((status) => void logEvent("info", "mcp.claude_compatibility", { desktop: status.desktop, code: status.code }))
    .catch((error) => void logEvent("warn", "mcp.claude_compatibility_failed", { error }));
  ipcMain.handle("mcp:sync-renderer-data", async (_event, value: unknown) => {
    const target = path.join(app.getPath("userData"), "mcp-renderer-data.json");
    await fs.writeFile(target, JSON.stringify(value), { encoding: "utf8", mode: 0o600 });
    return true;
  });
  ipcMain.handle("system-time:get", () => getHostClockInfo());
  ipcMain.handle("system-time:sync", () => syncHostClock());
  ipcMain.handle("system-time:set", (_event, value:string) => setHostClock(String(value ?? "")));
  ipcMain.handle("corp:discord-state", async (_event, characterId:string) => {
    const {sessionToken,workspace}=await planetaryCorporationContext(String(characterId??""));
    return {workspace,status:await getSageDiscordStatus(sessionToken,workspace.workspace_id,Number(workspace.character_id))};
  });
  ipcMain.handle("corp:discord-server-structure", async (_event, characterId:string) => {
    const {sessionToken,workspace}=await planetaryCorporationContext(String(characterId??""));
    if(!workspace.can_manage_fleet_ops) throw new Error("Command Ops authority is required to configure corporation Discord channels.");
    return getSageDiscordServerStructure(sessionToken,workspace.workspace_id,Number(workspace.character_id));
  });
  ipcMain.handle("corp:discord-configure", async (_event, input:{characterId:string;guildId:string;channelId:string;allowedChannelIds?:string[];enabled:boolean}) => {
    const {sessionToken,workspace,eveAccessToken}=await planetaryCorporationContext(String(input?.characterId??""));
    if(!workspace.can_manage_fleet_ops) throw new Error("Command Ops authority is required to configure corporation Discord.");
    return configureSageDiscord(sessionToken,eveAccessToken,workspace.workspace_id,Number(workspace.character_id),{guildId:String(input.guildId??""),channelId:String(input.channelId??""),allowedChannelIds:Array.isArray(input.allowedChannelIds)?input.allowedChannelIds.map(String):[],enabled:Boolean(input.enabled)});
  });
  ipcMain.handle("corp:discord-link-url", async (_event, characterId:string) => {
    const {sessionToken,workspace}=await planetaryCorporationContext(String(characterId??""));
    return getSageDiscordLinkUrl(sessionToken,workspace.workspace_id,Number(workspace.character_id));
  });
  ipcMain.handle("corp:discord-announce", async (_event, input:{characterId:string;content:string;channelId?:string;roleIds?:string[];userIds?:string[]}) => {
    const {sessionToken,workspace,eveAccessToken}=await planetaryCorporationContext(String(input?.characterId??""));
    if(!workspace.can_manage_fleet_ops) throw new Error("Command Ops authority is required to send corporation Discord announcements.");
    return sendSageDiscordAnnouncement(sessionToken,eveAccessToken,workspace.workspace_id,Number(workspace.character_id),{content:String(input.content??""),channelId:String(input.channelId??""),roleIds:Array.isArray(input.roleIds)?input.roleIds.map(String):[],userIds:Array.isArray(input.userIds)?input.userIds.map(String):[]});
  });
  ipcMain.handle("corp:discord-notification-targets", async (_event, input:{characterId:string;characterIds:number[]}) => {
    const {sessionToken,workspace,eveAccessToken}=await planetaryCorporationContext(String(input?.characterId??""));
    return updateSageDiscordNotificationTargets(sessionToken,eveAccessToken,workspace.workspace_id,Number(workspace.character_id),Array.isArray(input.characterIds)?input.characterIds.map(Number):[]);
  });
  ipcMain.handle("corp:discord-test-dm", async (_event, characterId:string) => {
    const {sessionToken,workspace,eveAccessToken}=await planetaryCorporationContext(String(characterId??""));
    return testSageDiscordDm(sessionToken,eveAccessToken,workspace.workspace_id,Number(workspace.character_id));
  });
  ipcMain.handle("corp:discord-unlink", async (_event, characterId:string) => {
    const {sessionToken,workspace,eveAccessToken}=await planetaryCorporationContext(String(characterId??""));
    return unlinkSageDiscord(sessionToken,eveAccessToken,workspace.workspace_id,Number(workspace.character_id));
  });
  ipcMain.handle("corp:ops-workspace", async (_event, characterId:string) => (await planetaryCorporationContext(String(characterId??""))).workspace);
  ipcMain.handle("corp:ops-list", async (_event, input:{workspaceId:string}) => {
    const token=await sageOnlineSessionTokenOnly();
    const summaries=await listSageOperations(token,String(input?.workspaceId??""));
    return Promise.all(summaries.slice(0,100).map(async summary=>({summary,payload:(await getSageOperation(token,String(input.workspaceId),summary.id)).payload})));
  });
  ipcMain.handle("corp:ops-publish", async (_event, input:{characterId:string;payload:Record<string,unknown>}) => {
    const {sessionToken,workspace}=await planetaryCorporationContext(String(input?.characterId??""));
    const result=await publishSageOperation(sessionToken,workspace.workspace_id,Number(workspace.character_id),input?.payload??{});
    return {...result,workspace};
  });
  ipcMain.handle("corp:ops-announce-discord", async (_event, input:{characterId:string;workspaceId:string;objectId:string}) => {
    const {sessionToken,workspace,eveAccessToken}=await planetaryCorporationContext(String(input?.characterId??""));
    if(workspace.workspace_id!==String(input.workspaceId)) throw new Error("The selected character is not in this operation workspace.");
    if(!workspace.can_manage_fleet_ops) throw new Error("Command Ops authority is required to announce operations to Discord.");
    return announceSageOperationToDiscord(sessionToken,eveAccessToken,workspace.workspace_id,Number(workspace.character_id),String(input.objectId));
  });
  ipcMain.handle("corp:ops-cancel", async (_event, input:{characterId:string;workspaceId:string;objectId:string;message?:string}) => {
    const {sessionToken,workspace,eveAccessToken}=await planetaryCorporationContext(String(input?.characterId??""));
    if(workspace.workspace_id!==String(input.workspaceId)) throw new Error("The selected character is not in this operation workspace.");
    if(!workspace.can_manage_fleet_ops) throw new Error("Command Ops authority is required to cancel operations.");
    return cancelSageOperation(sessionToken,eveAccessToken,workspace.workspace_id,Number(workspace.character_id),String(input.objectId),String(input.message??""));
  });
  ipcMain.handle("corp:ops-take-ownership", async (_event, input:{characterId:string;workspaceId:string;objectId:string}) => {
    const {sessionToken,workspace}=await planetaryCorporationContext(String(input?.characterId??""));
    if(workspace.workspace_id!==String(input.workspaceId)) throw new Error("The selected character is not in this operation workspace.");
    if(!workspace.can_manage_fleet_ops) throw new Error("Command Ops authority is required to take ownership of an operation.");
    return takeSageOperationOwnership(sessionToken,workspace.workspace_id,Number(workspace.character_id),String(input.objectId));
  });
  ipcMain.handle("corp:ops-application-notifications", async (_event, input:{characterId:string;workspaceId:string;objectId:string;enabled:boolean}) => {
    const {sessionToken,workspace,eveAccessToken}=await planetaryCorporationContext(String(input?.characterId??""));
    if(workspace.workspace_id!==String(input.workspaceId)) throw new Error("The selected character is not in this operation workspace.");
    if(!workspace.can_manage_fleet_ops) throw new Error("Command Ops authority is required for operation application notifications.");
    return setSageOperationApplicationNotifications(sessionToken,eveAccessToken,workspace.workspace_id,Number(workspace.character_id),String(input.objectId),input.enabled===true);
  });
  ipcMain.handle("corp:ops-update", async (_event, input:{characterId:string;workspaceId:string;objectId:string;payload:Record<string,unknown>;expectedVersion:number}) => {
    const {sessionToken,workspace}=await planetaryCorporationContext(String(input?.characterId??""));
    if(workspace.workspace_id!==String(input.workspaceId)) throw new Error("The selected character is not in this operation workspace.");
    return updateSageOperation(sessionToken,workspace.workspace_id,Number(workspace.character_id),String(input.objectId),input?.payload??{},Number(input.expectedVersion));
  });
  ipcMain.handle("corp:ops-apply", async (_event, input:{characterId:string;workspaceId:string;objectId:string;roleId:string;fitName?:string;fitText?:string;hullName?:string}) => {
    const {sessionToken,workspace}=await planetaryCorporationContext(String(input?.characterId??""));
    if(workspace.workspace_id!==String(input.workspaceId)) throw new Error("The selected character is not in this operation workspace.");
    return applySageOperationRole(sessionToken,workspace.workspace_id,String(input.objectId),{characterId:Number(workspace.character_id),roleId:String(input.roleId),fitName:input.fitName,fitText:input.fitText,hullName:input.hullName});
  });
  ipcMain.handle("corp:ops-decision", async (_event, input:{characterId:string;workspaceId:string;objectId:string;applicationId:string;decision:"approved"|"denied";message?:string}) => {
    const {sessionToken,workspace}=await planetaryCorporationContext(String(input?.characterId??""));
    if(workspace.workspace_id!==String(input.workspaceId)) throw new Error("The selected character is not in this operation workspace.");
    return decideSageOperationApplication(sessionToken,workspace.workspace_id,Number(workspace.character_id),String(input.objectId),String(input.applicationId),{decision:input.decision,message:input.message});
  });
  ipcMain.handle("corp:roles-state", async (_event, characterId:string) => {
    const {sessionToken,workspace}=await planetaryCorporationContext(String(characterId??""));
    return {workspace,policy:await getSageCorporationPermissions(sessionToken,workspace.workspace_id,Number(workspace.character_id))};
  });
  ipcMain.handle("corp:roles-update", async (_event, input:{characterId:string;permissionKey:string;authorities:Array<{type:"eve_role"|"eve_title";value:string}>}) => {
    const {sessionToken,workspace}=await planetaryCorporationContext(String(input?.characterId??""));
    const authorities=Array.isArray(input?.authorities)?input.authorities.filter(item=>(item?.type==="eve_role"||item?.type==="eve_title")&&typeof item?.value==="string"):[];
    const policy=await updateSageCorporationPermission(sessionToken,workspace.workspace_id,Number(workspace.character_id),String(input?.permissionKey??""),authorities);
    return {workspace,policy};
  });
  ipcMain.handle("market:global-quotes", (_event, typeIds:number[]) => loadGlobalMarketQuotes(Array.isArray(typeIds) ? typeIds : []));
  ipcMain.handle("lp-store:corporations", (_event, corporationIds:number[]) => resolveLpCorporations(Array.isArray(corporationIds) ? corporationIds : []));
  ipcMain.handle("lp-store:offers", (_event, corporationId:number, marketRevision:number) => analyzeLpCorporation(Number(corporationId), Number(marketRevision)));
  ipcMain.handle("lp-store:earning-candidates", (_event, standings:unknown, currentCorporationIds:unknown) => getLpEarningCandidates(standings, currentCorporationIds));
  ipcMain.handle("market:contract-intelligence", () => getContractMarketIntelligence());
  ipcMain.handle("profit-ledger:list", (_event, characterId?:string) => getProfitLedger(characterId ? String(characterId) : undefined));
  ipcMain.handle("profit-ledger:complete", (_event, input: any) => completeProfitDeal(input));
  ipcMain.handle("profit-ledger:reconcile", (_event, characterId?:string) => reconcileProfitLedger(characterId ? String(characterId) : undefined));
  ipcMain.handle("profit-ledger:remove", (_event, id:string) => removeProfitLedgerRecord(String(id)));
  ipcMain.handle("profit-ledger:review", (_event, recordId:string) => getProfitReconciliationReview(String(recordId)));
  ipcMain.handle("profit-ledger:transaction-override", (_event, input:any) => setProfitTransactionOverride({ recordId:String(input?.recordId??""), walletTransactionId:Number(input?.walletTransactionId??0), assigned:Boolean(input?.assigned) }));
  ipcMain.handle("profit-ledger:match-decision", (_event, input:any) => setProfitMatchDecision({ recordId:String(input?.recordId??""), walletTransactionId:Number(input?.walletTransactionId??0), decision:input?.decision === "rejected" ? "rejected" : "confirmed" }));
  ipcMain.handle("profit-ledger:material-provenance", (_event, input:any) => setProfitMaterialProvenance({ recordId:String(input?.recordId??""), mined:Boolean(input?.mined), donated:Boolean(input?.donated), owned:Boolean(input?.owned), bought:Boolean(input?.bought) }));
  ipcMain.handle("profit-ledger:purchase-review", (_event, recordId:string) => getProfitPurchaseReview(String(recordId)));
  ipcMain.handle("profit-ledger:purchase-override", (_event, input:any) => setProfitPurchaseTransactionOverride({ recordId:String(input?.recordId??""), walletTransactionId:Number(input?.walletTransactionId??0), assigned:Boolean(input?.assigned) }));
  ipcMain.handle("profit-ledger:bulk-bookkeeping", (_event, input:any) => applyProfitBulkBookkeeping({ recordIds:Array.isArray(input?.recordIds)?input.recordIds.map(String):[], matchDecision:input?.matchDecision === "confirmed" || input?.matchDecision === "rejected" ? input.matchDecision : undefined, transactionDecisions:Array.isArray(input?.transactionDecisions)?input.transactionDecisions.map((row:any)=>({recordId:String(row?.recordId??""),walletTransactionId:Number(row?.walletTransactionId??0),decision:row?.decision === "rejected" ? "rejected" as const : "confirmed" as const})):undefined, provenance:input?.provenance ? { mined:Boolean(input.provenance.mined), donated:Boolean(input.provenance.donated), owned:Boolean(input.provenance.owned), bought:Boolean(input.provenance.bought) } : undefined }));
  ipcMain.handle("eve:open-contract", async (_event, input: { characterId: string; contractId: number }) => {
    const characterId = String(input?.characterId ?? "").trim();
    const contractId = Number(input?.contractId);
    if (!characterId) throw new Error("Select a connected character before using Find in EVE.");
    if (!Number.isSafeInteger(contractId) || contractId <= 0) throw new Error("This contract does not have a valid EVE contract ID.");
    const url = `https://esi.evetech.net/v1/ui/openwindow/contract/?contract_id=${contractId}`;
    try {
      const target = await resolveOnlineEveUiCharacter(characterId);
      await eveWriteRequest(target.characterId, url, undefined, target.accessToken);
      return { success: true, contractId, characterId: target.characterId, characterName: target.characterName, usedFallback: target.usedFallback };
    } catch (error) {
      const status = (error as Error & { status?: number }).status;
      if (status === 401 || status === 403) {
        throw new Error("Find in EVE needs the EVE UI permission. Reconnect this character once with Add character, then try again.");
      }
      if (status === 400 || status === 404) {
        throw new Error("EVE could not open this contract. It may have expired or already been accepted.");
      }
      throw error;
    }
  });
  ipcMain.handle("eve:open-market-type", async (_event, input:{characterId:string;typeId:number}) => {
    const characterId=String(input?.characterId??"").trim(); const typeId=Number(input?.typeId);
    if(!characterId) throw new Error("Select a connected character before opening the EVE market.");
    if(!Number.isSafeInteger(typeId)||typeId<=0) throw new Error("This shopping-list item does not have a valid EVE type ID.");
    const target=await resolveOnlineEveUiCharacter(characterId);
    try{
      await eveWriteRequest(target.characterId,`https://esi.evetech.net/v1/ui/openwindow/marketdetails/?type_id=${typeId}`,undefined,target.accessToken);
      return {success:true,typeId,characterId:target.characterId,characterName:target.characterName,usedFallback:target.usedFallback};
    } catch(error){
      const status=(error as Error & {status?:number}).status;
      if(status===401||status===403) throw new Error("Open in EVE needs the EVE UI permission. Reconnect this character once, then try again.");
      throw error;
    }
  });
  ipcMain.handle("isklab:planetary-revenue", async (_event, input:{ characterId:string; settings?:PlanetaryRevenueSettings }) => {
    const characterId = String(input?.characterId ?? "").trim();
    if (!characterId) throw new Error("Select and sync a connected character.");
    const snapshot = getSnapshot(characterId) as any;
    if (!snapshot) throw new Error("Select and sync a connected character.");
    return analyzePlanetaryAdvanced(snapshot, listSnapshots() as any[], { settings:input?.settings, observations:listPlanetaryResourceObservations() as any[], alertSettings:getPlanetaryAlertSettings() });
  });
  ipcMain.handle("isklab:planetary-plan", async (_event, input:PlanetaryPlanInput) => {
    const characterId = String(input?.characterId ?? "").trim();
    if (!characterId) throw new Error("Select and sync a connected character.");
    const snapshot = getSnapshot(characterId) as any;
    if (!snapshot) throw new Error("Select and sync a connected character.");
    return buildPlanetaryPlan(snapshot, listSnapshots() as any[], { ...input, resourceObservations:input.resourceObservations ?? listPlanetaryResourceObservations() as any[] });
  });
  ipcMain.handle("isklab:planetary-state", () => ({ plans:listPlanetaryPlans(), observations:listPlanetaryResourceObservations(), alertSettings:getPlanetaryAlertSettings() }));
  ipcMain.handle("isklab:planetary-save-plan", (_event, plan:any) => savePlanetaryPlan(plan));
  ipcMain.handle("isklab:planetary-delete-plan", (_event, id:string) => deletePlanetaryPlan(String(id ?? "")));
  ipcMain.handle("isklab:planetary-save-observations", (_event, observations:any[]) => replacePlanetaryResourceObservations(Array.isArray(observations) ? observations : []));
  ipcMain.handle("isklab:planetary-save-alert-settings", (_event, settings:any) => savePlanetaryAlertSettings(settings ?? {}));
  ipcMain.handle("isklab:planetary-basket", async (_event, input:PlanetaryBasketInput) => {
    const characterId=String(input?.characterId??"").trim();if(!characterId)throw new Error("Select and sync a connected character.");
    const snapshot=getSnapshot(characterId) as any;if(!snapshot)throw new Error("Select and sync a connected character.");
    const observations=(input.resourceObservations??listPlanetaryResourceObservations()) as any[];
    const analysis=await analyzePlanetaryAdvanced(snapshot,listSnapshots() as any[],{settings:input,observations,alertSettings:getPlanetaryAlertSettings()});
    return buildPlanetaryBasketPlan(snapshot,listSnapshots() as any[],analysis,{...input,resourceObservations:observations});
  });
  ipcMain.handle("isklab:planetary-evaluate-layout", (_event, input:PlanetaryDesignerInput) => evaluatePlanetaryDesignerLayout(input));
  ipcMain.handle("isklab:planetary-generate-layouts", (_event, input:PlanetaryDesignerInput) => generatePlanetaryDesignerLayouts(input));
  ipcMain.handle("isklab:planetary-designer-eve-template", (_event, input:{designer:PlanetaryDesignerInput;baseTemplate:any;comment?:string}) => buildPlanetaryDesignerEveTemplate(input.designer,input.baseTemplate,input.comment));
  ipcMain.handle("isklab:planetary-designer-seed", (_event, input:{characterId:string;planetId:number;designer:PlanetaryDesignerInput}) => {
    const snapshot=getSnapshot(String(input?.characterId??"")) as any;if(!snapshot)throw new Error("Select and sync a connected character.");
    const seed=buildPlanetaryDesignerSeedFromSnapshot(snapshot,Number(input?.planetId));
    if(!seed)throw new Error("No synced ESI colony detail exists for that planet.");
    return evaluatePlanetaryDesignerLayout({...input.designer,...seed});
  });
  ipcMain.handle("isklab:planetary-corp-state", async (_event,input:{characterId:string}) => loadPlanetaryCorporationLibrary(String(input?.characterId??"")));
  ipcMain.handle("isklab:planetary-corp-publish-survey", async (_event,input:{characterId:string;observations:any[];objectId?:string;expectedVersion?:number}) => {
    const {sessionToken,workspace}=await planetaryCorporationContext(String(input?.characterId??""));
    const rows=(Array.isArray(input?.observations)?input.observations:[]).filter(row=>Number(row?.planetId)>0&&Number.isFinite(Number(row?.percent))).map(row=>({...row,scope:"corporation",source:"sage-online"}));
    const payload={schema:"new-eden-sage.pi-survey.v1",submittedAt:new Date().toISOString(),submittedBy:{characterId:workspace.character_id,characterName:workspace.character_name},observations:rows};
    if(input?.objectId&&Number(input?.expectedVersion)>0)return updateSagePiObject(sessionToken,workspace.workspace_id,input.objectId,{payload,expectedVersion:Number(input.expectedVersion),idempotencyKey:"pi-survey-update:"+input.objectId+":"+input.expectedVersion+":"+Date.now()});
    return publishSagePiObject(sessionToken,workspace.workspace_id,{objectType:"sage.pi-survey",payload,idempotencyKey:"pi-survey:"+workspace.workspace_id+":"+workspace.character_id+":"+Date.now()});
  });
  ipcMain.handle("isklab:planetary-corp-publish-template", async (_event,input:{characterId:string;planId:string}) => {
    const plan=listPlanetaryPlans().find(row=>row.id===String(input?.planId??""));if(!plan)throw new Error("Saved PI template not found.");
    const {sessionToken,workspace}=await planetaryCorporationContext(String(input?.characterId??""));
    const payload={schema:"new-eden-sage.pi-template.v1",name:plan.name,category:plan.category??"Corporation",savedAt:plan.savedAt,publishedAt:new Date().toISOString(),publishedBy:{characterId:workspace.character_id,characterName:workspace.character_name},input:plan.input,designerLayout:plan.designerLayout,eveTemplate:plan.eveTemplate,layoutProfile:plan.layoutProfile};
    const result=plan.publishedObjectId&&plan.publishedVersion?await updateSagePiObject(sessionToken,workspace.workspace_id,plan.publishedObjectId,{payload,expectedVersion:plan.publishedVersion,idempotencyKey:"pi-template-update:"+plan.publishedObjectId+":"+plan.publishedVersion+":"+Date.now()}):await publishSagePiObject(sessionToken,workspace.workspace_id,{objectType:"sage.pi-template",payload,idempotencyKey:"pi-template:"+workspace.workspace_id+":"+plan.id+":"+Date.now()});
    return savePlanetaryPlan({...plan,kind:"template",scope:"corporation",publishedObjectId:result.id,publishedVersion:result.version,publishedAt:new Date().toISOString()});
  });
  ipcMain.handle("isklab:planetary-corp-unpublish", async (_event,input:{characterId:string;planId:string;objectId:string}) => {
    const {sessionToken,workspace}=await planetaryCorporationContext(String(input?.characterId??""));
    await unpublishSagePiObject(sessionToken,workspace.workspace_id,String(input?.objectId??""));
    const plan=listPlanetaryPlans().find(row=>row.id===String(input?.planId??""));
    return plan?savePlanetaryPlan({...plan,scope:"personal",publishedObjectId:undefined,publishedVersion:undefined,publishedAt:undefined}):true;
  });
  ipcMain.handle("fitting:augment-guide", (_event, installedTypeIds:number[]) => runFittingWorker("augment-guide", { installedTypeIds:Array.isArray(installedTypeIds)?installedTypeIds:[] }));
  ipcMain.handle("fitting:booster-side-effects-local", (_event, boosterTypeIds:number[]) => runFittingWorker("booster-side-effects", { boosterTypeIds:Array.isArray(boosterTypeIds)?boosterTypeIds:[] }));
  ipcMain.handle("clipboard:write", (_event, value: string) => {
    clipboard.writeText(value);
    return clipboard.readText() === value;
  });
  ipcMain.handle("fitting:resolve-types-local", (_event, names: string[]) => runFittingWorker("resolve-types", { names }));
  ipcMain.handle("fitting:resolve-type-ids-local", (_event, typeIds: number[]) => runFittingWorker("resolve-type-ids", { typeIds }));
  ipcMain.handle("fitting:search-types-local", (_event, input: { query: string; limit?: number }) => runFittingWorker("search-types", { query: input?.query ?? "", limit: input?.limit ?? 60 }));
  ipcMain.handle("fitting:prepare-local", (event) => runFittingWorker("prepare", {}, (progress) => {
    if (!event.sender.isDestroyed()) event.sender.send("fitting:prepare-progress", progress);
  }));
  ipcMain.handle("fitting:compatible-items-local", (_event, input: any) => runFittingWorker("compatible-items", input ?? {}));
  ipcMain.handle("fitting:charges-for-fit-local", (_event, moduleTypeIds: number[]) => runFittingWorker("charges-for-fit", { moduleTypeIds: Array.isArray(moduleTypeIds) ? moduleTypeIds : [] }));
  ipcMain.handle("fitting:catalogue-local", () => runFittingWorker("catalogue"));
  ipcMain.handle("fitting:type-info-local", (_event, typeId:number) => runFittingWorker("type-info", { typeId:Number(typeId) }));
  ipcMain.handle("fitting:hull-profile-local", (_event, typeId:number) => runFittingWorker("hull-profile", { typeId }));
  ipcMain.handle("fitting:mutation-options", (_event, typeId: number) => runFittingWorker("mutation-options", { typeId: Number(typeId) }));
  ipcMain.handle("fitting:charge-compatibility-local", (_event, input: { moduleTypeId:number; chargeTypeId:number }) => runFittingWorker("charge-compatibility", { moduleTypeId:Number(input?.moduleTypeId), chargeTypeId:Number(input?.chargeTypeId) }));
  ipcMain.handle("fitting:item-compatibility-local", (_event, input: any) => runFittingWorker("item-compatibility", input ?? {}));
  ipcMain.handle("fitting:remedies-local", async (_event, input: any) => {
    const snapshot = input?.characterId ? getSnapshot(String(input.characterId)) as any : undefined;
    const trainedSkills = (snapshot?.skills?.skills ?? []).map((skill: any) => ({ skillId: Number(skill.skill_id), level: Number(skill.trained_skill_level ?? 0) }));
    return runFittingWorker("remedies", { ...input, trainedSkills });
  });
  ipcMain.handle("universe:resolve-types", async (_event, names: string[]) => {
    const unique = [
      ...new Set(names.map((name) => name.trim()).filter(Boolean)),
    ];
    if (!unique.length) return [];
    const resolved = [];
    for (let index = 0; index < unique.length; index += 500) {
      const response = await fetch("https://esi.evetech.net/universe/ids/", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Compatibility-Date": "2026-08-02",
          "X-User-Agent": "NewEdenSage/0.1.0",
        },
        body: JSON.stringify(unique.slice(index, index + 500)),
      });
      if (!response.ok)
        throw new Error(`EVE fitting item lookup failed (${response.status}).`);
      const data = (await response.json()) as {
        inventory_types?: Array<{ id: number; name: string }>;
      };
      resolved.push(...(data.inventory_types ?? []));
    }
    return resolved;
  });
  ipcMain.handle("universe:resolve-type-ids", async (_event, ids: number[]) => {
    const unique = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))];
    if (!unique.length) return [];
    const resolved = [];
    for (let index = 0; index < unique.length; index += 1000) {
      const response = await fetch("https://esi.evetech.net/universe/names/", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Compatibility-Date": "2026-08-02",
          "X-User-Agent": "NewEdenSage/0.1.1",
        },
        body: JSON.stringify(unique.slice(index, index + 1000)),
      });
      if (!response.ok)
        throw new Error(`EVE implant name lookup failed (${response.status}).`);
      resolved.push(...((await response.json()) as Array<{ id: number; name: string }>));
    }
    return resolved;
  });
  ipcMain.handle("loot:search", (_event, input: { query?: string; limit?: number }) =>
    searchLootItems(String(input?.query ?? ""), Number(input?.limit ?? 60)));
  ipcMain.handle("loot:acquisition", (_event, typeId: number) => getLootAcquisition(Number(typeId)));
  ipcMain.handle("loot:prepare", () => prepareLootDataLocal());
  ipcMain.handle("industrial:system-cost-index", async (_event, input: { characterId: string; force?: boolean }) =>
    getSystemCostIndexPrepared(String(input.characterId), Boolean(input.force)));
  ipcMain.handle("industrial:blueprint-activities", async (_event, input: { characterId: string; blueprintTypeId: number; force?: boolean }) =>
    getBlueprintActivitiesPrepared({ characterId: String(input.characterId), blueprintTypeId: Number(input.blueprintTypeId) }, Boolean(input.force)));
  ipcMain.handle(
    "industrial:invention-opportunities",
    async (_event, input: { characterId: string; marketDataRevision?: number; decryptorTypeId?: number | null }) => {
      const snapshot = getSnapshot(input.characterId) as any;
      if (!snapshot) throw new Error("Select and sync a connected character.");
      const prepared = await loadPreparedInventionResult(input, snapshot);
      if (prepared.result) return prepared.result;
      if (masterUpdateActive) {
        throw new Error("Wait for the private data refresh to finish before building Invention results.");
      }
      await runFeaturePrepProcess({
        task: "invention",
        characterId: String(input.characterId),
        decryptorTypeId: input.decryptorTypeId ?? null,
        cacheKey: prepared.key,
      });
      const result = await loadPersistedResult<any>("industry-invention-opportunities", prepared.key);
      if (!result) throw new Error("Invention analysis completed without a persisted result.");
      return result;
    },
  );
  ipcMain.handle("industrial:manufacturing-plan", async (_event, input: any) =>
    getManufacturingPlanPrepared(input, Boolean(input?.force)));
  ipcMain.handle("industrial:foundry-workspace", async (_event, input: any) =>
    getFoundryWorkspace(String(input?.characterId ?? ""), input?.projectId == null ? undefined : String(input.projectId)));
  ipcMain.handle("industrial:foundry-projects", (_event, input: any) =>
    getFoundryProjects(String(input?.characterId ?? "")));
  ipcMain.handle("industrial:foundry-blueprint-search", async (_event, input: any) => searchFoundryBlueprintCatalogue(input));
  ipcMain.handle("industrial:foundry-create", async (_event, input: any) => createFoundryProject(input));
  ipcMain.handle("industrial:foundry-update", async (_event, input: any) => updateFoundryProject(input));
  ipcMain.handle("industrial:foundry-delete", async (_event, input: any) =>
    removeFoundryProject(String(input?.characterId ?? ""), String(input?.projectId ?? "")));
  ipcMain.handle("industrial:refinery-catalogue", async () => getRefineryCatalogue());
  ipcMain.handle("industrial:refinery-analysis", async (_event, input: any) => {
    const characterId = String(input?.characterId ?? "");
    const snapshot = getSnapshot(characterId) as any;
    if (!snapshot) throw new Error("Select and sync a connected character.");
    const selectedIds = new Set<string>(input?.includeConnectedStock
      ? [characterId, ...(Array.isArray(input?.sharedCharacterIds) ? input.sharedCharacterIds.map(String) : [])]
      : [characterId]);
    const manualStock = Array.isArray(input?.manualStock) ? input.manualStock.map((item: any) => ({ type_id: Number(item?.typeId ?? 0), quantity: Math.max(0, Math.floor(Number(item?.quantity ?? 0))) })).filter((item: any) => item.type_id > 0 && item.quantity > 0) : [];
    const stockSources = input?.stockMode === "manual"
      ? [{ characterId: "manual", characterName: "Manual selection", assets: manualStock }]
      : (listSnapshots() as any[])
          .filter((candidate) => selectedIds.has(String(candidate.characterId)))
          .map((candidate) => ({
            characterId: String(candidate.characterId),
            characterName: String(candidate.character?.name ?? candidate.characterId),
            assets: Array.isArray(candidate.extended?.assets) ? candidate.extended.assets : [],
          }));
    return analyzeRefinery({
      snapshot,
      stockSources,
      facility: input?.facility,
      rig: input?.rig,
      security: input?.security,
      implant: input?.implant,
    });
  });
  ipcMain.handle("industrial:reaction-catalogue", async () => getReactionCatalogue());
  ipcMain.handle("industrial:reaction-plan", async (_event, input: any) => {
    const characterId = String(input?.characterId ?? "");
    const snapshot = getSnapshot(characterId) as any;
    if (!snapshot) throw new Error("Select and sync a connected character.");
    const selectedIds = new Set<string>(input?.includeConnectedStock
      ? [characterId, ...(Array.isArray(input?.sharedCharacterIds) ? input.sharedCharacterIds.map(String) : [])]
      : [characterId]);
    const stockSources = (listSnapshots() as any[])
      .filter((candidate) => selectedIds.has(String(candidate.characterId)))
      .map((candidate) => ({ characterId: String(candidate.characterId), characterName: String(candidate.character?.name ?? candidate.characterId), assets: Array.isArray(candidate.extended?.assets) ? candidate.extended.assets : [] }));
    return analyzeReactionPlan({ blueprintTypeId: Number(input?.blueprintTypeId ?? 0), runs: Number(input?.runs ?? 1), snapshot, stockSources });
  });
  ipcMain.handle("industrial:opportunities", async (_event, input: any) =>
    getIndustrialOpportunitiesPrepared(input, { force: Boolean(input?.force) }));
  ipcMain.handle("industrial:prepared-state", async (_event, input: { characterId: string }) =>
    loadIndustrialPreparedState(String(input.characterId)));
  ipcMain.handle("universe:ships", () => listPublishedShips());
  ipcMain.handle(
    "skills:ship-readiness",
    async (
      _event,
      input: { characterId: string; hullTypeId: number; cloneState?: "alpha" | "omega"; masteryLevel?: number },
    ) => {
      const snapshot = getSnapshot(input.characterId) as any;
      if (!snapshot) throw new Error("Select and sync a connected character.");
      const key = { input, snapshot: snapshot.updatedAt, readinessModel: "strict-skill-aware-fits-v5" };
      const saved = await loadPersistedResult("ship-readiness", key);
      if (saved) return saved;
      const result = await analyzeShipReadiness(
        snapshot,
        input.hullTypeId,
        input.cloneState ?? "omega",
        input.masteryLevel ?? 5,
      );
      await savePersistedResult("ship-readiness", key, result);
      return result;
    },
  );
  ipcMain.handle("activity:hull-previews", async (_event, input: { characterId: string; hullTypeIds: number[] }) => {
    const snapshot = getSnapshot(String(input?.characterId ?? "")) as any;
    if (!snapshot) throw new Error("Select and sync a connected character.");
    return analyzeHullAccessPreviews(snapshot, Array.isArray(input?.hullTypeIds) ? input.hullTypeIds : []);
  });
  ipcMain.handle(
    "activity:readiness",
    async (
      _event,
      input: {
        characterId: string;
        hullTypeId: number;
        cloneState?: "alpha" | "omega";
        coreSkills: Array<{ skill: string; level: number }>;
        supportSkills: Array<{ skill: string; level: number }>;
        context: {
          activityId: string;
          subcategoryId: string;
          contentId: string;
          selectorValues?: Record<string, string>;
        };
        archetypeId?: string;
      },
    ) => {
      const snapshot = getSnapshot(input.characterId) as any;
      if (!snapshot) throw new Error("Select and sync a connected character.");
      const key = { input, snapshot: snapshot.updatedAt, readinessModel: "strict-skill-aware-fits-v5" };
      const saved = await loadPersistedResult("activity-readiness", key);
      if (saved) return saved;
      const result = await analyzeActivityReadiness(snapshot, {
        hullTypeId: input.hullTypeId,
        cloneState: input.cloneState,
        coreSkills: input.coreSkills,
        supportSkills: input.supportSkills,
        context: input.context,
        archetypeId: input.archetypeId,
      });
      await savePersistedResult("activity-readiness", key, result);
      return result;
    },
  );
  ipcMain.handle(
    "capability:current-ship",
    async (_event, input: { characterId: string; profileId: CurrentShipUseProfileId; cloneState?: "alpha" | "omega" }) => {
      const snapshot = getSnapshot(input.characterId) as any;
      if (!snapshot) throw new Error("Select and sync a connected character.");
      return analyzeCurrentShipUse(snapshot, input.profileId, input.cloneState ?? "omega");
    },
  );
  ipcMain.handle(
    "capability:analyze",
    async (_event, input: { characterId: string; cloneState?: "alpha" | "omega" }) => {
      const snapshot = getSnapshot(input.characterId) as any;
      if (!snapshot) throw new Error("Select and sync a connected character.");
      return runCapabilityAnalysis(
        snapshot,
        input.cloneState ?? "omega",
        (progress) => window?.webContents.send("analysis:progress", progress),
      );
    },
  );
  ipcMain.handle(
    "fitting:analyze",
    async (
      _event,
      input: {
        characterId: string;
        hullTypeId?: number;
        itemTypeIds: number[];
        items?: Array<{ typeId: number; quantity?: number; rack?: string; chargeTypeId?: number; chargeQuantity?: number; activeQuantity?: number; attributeOverrides?: Record<string, number>; state?: "offline" | "online" | "active" | "overheated" }>;
        targetProfile?: { rangeM: number; signatureRadiusM: number; transverseVelocityMps: number; velocityMps: number };
        damageProfile?: { em: number; thermal: number; kinetic: number; explosive: number };
        implantTypeIds?: number[];
        boosterTypeIds?: number[];
        boosterSideEffectIds?: number[];
        projectedItems?: Array<{ typeId: number; quantity?: number; rack?: string; chargeTypeId?: number; chargeQuantity?: number; activeQuantity?: number; attributeOverrides?: Record<string, number>; state?: "offline" | "online" | "active" | "overheated"; effectiveness?: number }>;
        commandBurstItems?: Array<{ typeId: number; quantity?: number; chargeTypeId?: number; chargeQuantity?: number; activeQuantity?: number; attributeOverrides?: Record<string, number>; state?: "offline" | "online" | "active" | "overheated"; effectiveness?: number }>;
        environmentTypeIds?: number[];
      },
    ) => {
      const snapshot = getSnapshot(input.characterId) as any;
      if (!snapshot) throw new Error("Select and sync a connected character.");
      if (input.hullTypeId) {
        return runFittingWorker("analyze", {
          hullTypeId: input.hullTypeId,
          items: input.items ?? input.itemTypeIds.map((typeId) => ({ typeId })),
          snapshot,
          targetProfile: input.targetProfile,
          damageProfile: input.damageProfile,
          implantTypeIds: input.implantTypeIds,
          boosterTypeIds: input.boosterTypeIds,
          boosterSideEffectIds: input.boosterSideEffectIds,
          projectedItems: input.projectedItems,
          commandBurstItems: input.commandBurstItems,
          environmentTypeIds: input.environmentTypeIds,
        });
      }
      const typeIds = [
        ...new Set(
          [input.hullTypeId, ...input.itemTypeIds].filter((id): id is number =>
            Boolean(id),
          ),
        ),
      ];
      const details = await Promise.all(
        typeIds.map(async (typeId) => {
          const local = await getFittingTypeInfoLocal(typeId);
          return {
            type_id: local.typeId,
            name: local.name,
            dogma_attributes: local.attributes.map((attribute) => ({ attribute_id: attribute.attributeId, value: attribute.value })),
          };
        }),
      );
      const requirementPairs = [
        [182, 277],
        [183, 278],
        [184, 279],
        [1285, 1286],
        [1289, 1287],
        [1290, 1288],
      ];
      const requiredSkillIds = [
        ...new Set(
          details.flatMap((detail) => {
            const attributes = new Map(
              (detail.dogma_attributes ?? []).map((attribute) => [
                attribute.attribute_id,
                attribute.value,
              ]),
            );
            return requirementPairs
              .map(([skillAttribute]) => attributes.get(skillAttribute))
              .filter((id): id is number => Boolean(id));
          }),
        ),
      ];
      const skillNames = new Map<number, string>();
      await Promise.all(requiredSkillIds.map(async (skillId) => {
        const local = await getFittingTypeInfoLocal(skillId).catch(() => null);
        if (local) skillNames.set(skillId, local.name);
      }));
      const trained = new Map(
        (snapshot.skills?.skills ?? []).map((skill: any) => [
          skill.skill_id,
          skill.trained_skill_level,
        ]),
      );
      const requirements = details.map((detail) => {
        const attributes = new Map(
          (detail.dogma_attributes ?? []).map((attribute) => [
            attribute.attribute_id,
            attribute.value,
          ]),
        );
        const skills = requirementPairs.flatMap(
          ([skillAttribute, levelAttribute]) => {
            const skillId = attributes.get(skillAttribute);
            if (!skillId) return [];
            const requiredLevel = attributes.get(levelAttribute) ?? 1;
            const trainedLevel = Number(trained.get(skillId) ?? 0);
            return [
              {
                skillId,
                skill: skillNames.get(skillId) ?? `Skill ${skillId}`,
                requiredLevel,
                trainedLevel,
                met: trainedLevel >= requiredLevel,
              },
            ];
          },
        );
        return {
          typeId: detail.type_id,
          item: detail.name,
          usable: skills.every((skill) => skill.met),
          skills,
        };
      });
      const hull = details.find(
        (detail) => detail.type_id === input.hullTypeId,
      );
      const hullAttributes = new Map(
        (hull?.dogma_attributes ?? []).map((attribute) => [
          attribute.attribute_id,
          attribute.value,
        ]),
      );
      const statDefinitions = [
        [263, "Shield HP", "HP"],
        [265, "Armor HP", "HP"],
        [9, "Structure HP", "HP"],
        [37, "Maximum velocity", "m/s"],
        [482, "Capacitor capacity", "GJ"],
        [55, "Capacitor recharge", "ms"],
        [38, "Cargo capacity", "m3"],
        [283, "Drone bay", "m3"],
        [1271, "Drone bandwidth", "Mbit/s"],
        [12, "Low slots", ""],
        [13, "Mid slots", ""],
        [14, "High slots", ""],
        [1137, "Rig slots", ""],
        [102, "Turret hardpoints", ""],
        [101, "Launcher hardpoints", ""],
        [48, "CPU output", "tf"],
        [11, "Powergrid output", "MW"],
      ] as const;
      return {
        character: snapshot.character.name,
        totalSkillPoints: snapshot.skills?.total_sp ?? 0,
        hull: hull?.name ?? "Unknown hull",
        baseStats: statDefinitions.flatMap(([id, label, unit]) => {
          const value = hullAttributes.get(id);
          return value == null ? [] : [{ id, label, value, unit }];
        }),
        requirements,
        missingRequirements: requirements.flatMap((item) =>
          item.skills
            .filter((skill) => !skill.met)
            .map((skill) => ({ item: item.item, ...skill })),
        ),
      };
    },
  );
  void logEvent("info", "app.started", {
    version: app.getVersion(),
    platform: process.platform,
  });
  ipcMain.handle("config:get", async () => publicConfig(await readConfig()));
  ipcMain.handle(
    "config:save",
    async (_event, input: { eveClientId: string }) => {
      const current = await readConfig();
      const next = {
        ...current,
        eveClientId: input.eveClientId.trim(),
      };
      await writeConfig(next);
      return publicConfig(next);
    },
  );
  ipcMain.handle("eve:login", async () => {
    const config = await readConfig();
    const login = await loginWithEve(config.eveClientId, config.callbackUrl);
    config.encryptedRefreshTokens[login.characterId] = encrypt(
      login.refreshToken,
    );
    const becamePrimaryIdentity = !config.primaryCharacterId;
    if (becamePrimaryIdentity) {
      config.primaryCharacterId = login.characterId;
      config.sageAccountId = login.characterId;
      config.identitySchemaVersion = CURRENT_IDENTITY_SCHEMA_VERSION;
    }

    const onlineIdentitySynced = false;
    const onlineIdentityError = login.characterId !== config.primaryCharacterId && !config.encryptedSageSessionToken
      ? "Reconnect the primary Sage character to restore the online session before linking additional characters."
      : undefined;
    await writeConfig(config);
    // Add Character is an authentication/registration boundary only. Persist a
    // usable local bootstrap immediately after SSO succeeds; private ESI refreshes
    // are explicit and must never make a successful character authorization look
    // like it failed because one downstream endpoint is slow or temporarily down.
    const snapshot = createConnectedCharacterBootstrapSnapshot(
      login.characterId,
      login.characterName,
      getSnapshot(login.characterId),
    );
    saveSnapshot(snapshot);
    void logEvent("info", "character.add.connected", {
      characterId: login.characterId,
      snapshotState: snapshot.snapshotState,
    });
    // Sage Online linking is useful, but it is not part of the Add Character critical path.
    // The character is already registered locally; finish cloud identity work in the background.
    if (!onlineIdentityError) {
      void (async () => {
        try {
          if (login.characterId === config.primaryCharacterId) {
            const claimed = await claimSageIdentity(login.accessToken);
            if (claimed.account_id !== config.sageAccountId || String(claimed.primary_character_id) !== config.primaryCharacterId) {
              throw new Error("Sage Online returned an identity that did not match the selected primary character.");
            }
            const latest = await readConfig();
            if (latest.primaryCharacterId === login.characterId) {
              latest.encryptedSageSessionToken = encrypt(claimed.session_token);
              await writeConfig(latest);
            }
          } else if (config.encryptedSageSessionToken) {
            await linkSageCharacter(decrypt(config.encryptedSageSessionToken), login.accessToken);
          }
          await logEvent("info", "sage-online.identity-linked", { characterId: login.characterId });
        } catch (error) {
          await logEvent("warn", "sage-online.identity-link-deferred-failed", {
            characterId: login.characterId,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      })();
    }
    return {
      characterId: login.characterId,
      characterName: login.characterName,
      snapshot,
      becamePrimaryIdentity,
      sageAccountId: config.sageAccountId ?? login.characterId,
      primaryCharacterId: config.primaryCharacterId ?? login.characterId,
      onlineIdentitySynced,
      onlineIdentityError,
    };
  });
  ipcMain.handle("eve:refresh", async (_event, characterId: string) => {
    const config = await readConfig();
    const stored = config.encryptedRefreshTokens[characterId];
    if (!stored) throw new Error("This character is not connected.");
    const tokens = await refreshEveToken(config.eveClientId, decrypt(stored));
    if (tokens.refresh_token) {
      config.encryptedRefreshTokens[characterId] = encrypt(
        tokens.refresh_token,
      );
      await writeConfig(config);
    }
    const snapshot = await fetchCharacterCoreSnapshot(
      characterId,
      tokens.access_token,
      getSnapshot(characterId),
    );
    saveSnapshot(snapshot);
    try {
      const lifecycle = synchronizeFoundryLifecycle(characterId);
      await logEvent("info", "character_refresh.industrial_lifecycle_reconciled", { characterId, projects: lifecycle.projects, ledgerRecords: lifecycle.ledgerRecords });
    } catch (error) {
      await logEvent("warn", "character_refresh.industrial_lifecycle_reconcile_failed", { characterId, error: error instanceof Error ? error.message : String(error) });
    }
    return snapshot;
  });
  ipcMain.handle("eve:refresh-current-ship", async (_event, characterId: string) => {
    const config = await readConfig();
    const stored = config.encryptedRefreshTokens[characterId];
    if (!stored) throw new Error("This character is not connected.");
    const existingSnapshot = getSnapshot(characterId);
    if (!existingSnapshot) throw new Error("Sync this character before refreshing the current ship.");
    const tokens = await refreshEveToken(config.eveClientId, decrypt(stored));
    if (tokens.refresh_token) {
      config.encryptedRefreshTokens[characterId] = encrypt(tokens.refresh_token);
      await writeConfig(config);
    }
    const snapshot = await fetchCharacterCurrentShipSnapshot(characterId, tokens.access_token, existingSnapshot);
    saveSnapshot(snapshot);
    return snapshot;
  });
  ipcMain.handle("snapshot:list", () => listSnapshots());
  ipcMain.handle("news:list", async (_event, force = false) => getEveNews(Boolean(force)));
  ipcMain.handle("character:remove", async (_event, characterId: string) => {
    const config = await readConfig();
    delete config.encryptedRefreshTokens[characterId];
    await writeConfig(config);
    deleteSnapshot(characterId);
    await logEvent("info", "character.removed", { characterId });
    return listSnapshots();
  });
  ipcMain.handle(
    "data:export",
    async (
      _event,
      format: "json" | "chatgpt" | "chatgpt-radius",
      characterId?: string,
    ) => {
      if (!window) return null;
      const data = exportDatabaseData();
      const exportData =
        format === "chatgpt" && characterId
          ? {
              ...data,
              characterSnapshots: data.characterSnapshots.filter(
                (item: any) => item.characterId === characterId,
              ),
            }
          : data;
      if (format === "chatgpt" && !exportData.characterSnapshots.length)
        throw new Error("The selected character has no synced snapshot.");
      const extension =
        format === "json"
          ? "json"
          : format === "chatgpt-radius"
            ? "xlsx"
            : "md";
      const exportStamp = new Date().toISOString().replace(/[:.]/g, "-");
      const selectedCharacter = exportData.characterSnapshots[0] as any;
      const characterFileName = String(
        selectedCharacter?.character?.name ?? "character",
      )
        .replace(/[^a-z0-9_-]+/gi, "-")
        .replace(/^-+|-+$/g, "")
        .toLowerCase();
      const result = await dialog.showSaveDialog(window, {
        title:
          format === "json"
            ? "Export all New Eden Sage data"
            : format === "chatgpt-radius"
              ? "Export regional market analysis data"
              : `Export ${selectedCharacter?.character?.name ?? "character"} data`,
        defaultPath:
          format === "json"
            ? `new-eden-sage-complete-backup-${exportStamp}.${extension}`
            : format === "chatgpt-radius"
              ? `station-market-data-${exportStamp}.${extension}`
              : `${characterFileName}-character-data-${exportStamp}.${extension}`,
        filters: [
          {
            name:
              format === "json"
                ? "New Eden Sage backup"
                : format === "chatgpt-radius"
                  ? "Station and contract market data"
                  : "Character data",
            extensions: [extension],
          },
        ],
      });
      if (result.canceled || !result.filePath) return null;
      let content: string;
      if (format === "json") content = JSON.stringify(data, null, 2);
      else if (format === "chatgpt-radius") {
        const full = await loadSharedMarketBrowserDataset();
        if (!full.summaries.length)
          throw new Error("No server-prepared public market generation is installed yet. Let Sage install the latest shared public data and try again.");
        const sharedContracts = await loadSharedPublicContractsDataset();
        if (!sharedContracts)
          throw new Error("No server-prepared public contract generation is installed yet. Let Sage install the latest shared public data and try again.");
        const contracts = { createdAt: sharedContracts.createdAt, summaries: sharedContracts.regions };
        const parsed = path.parse(result.filePath);
        const stationPath = path.join(parsed.dir, `${parsed.name}.xlsx`);
        const contractPath = path.join(
          parsed.dir,
          `${parsed.name.replace("station-market-data", "contract-market-data")}.xlsx`,
        );
        await Promise.all([
          writeTradeWorkbook(stationPath, full, "stations"),
          writeTradeWorkbook(contractPath, contracts, "contracts"),
        ]);
        await logEvent("info", "trade_archives.exported", {
          stationPath,
          contractPath,
          stationRegions: full.summaries.length,
          contractRegions: contracts.summaries.length,
        });
        return `${stationPath} and ${contractPath}`;
      } else content = makeCompleteChatGPTMarkdown(exportData);
      await fs.writeFile(result.filePath, content, "utf8");
      return result.filePath;
    },
  );
  ipcMain.handle("data:import", async () => {
    if (!window) return null;
    const result = await dialog.showOpenDialog(window, {
      title: "Import information into New Eden Sage",
      properties: ["openFile", "multiSelections"],
      filters: [
        { name: "Supported information", extensions: ["json", "md", "txt"] },
      ],
    });
    if (result.canceled) return null;
    let snapshots = 0;
    let information = 0;
    for (const filePath of result.filePaths) {
      const content = await fs.readFile(filePath, "utf8");
      if (path.extname(filePath).toLowerCase() === ".json") {
        try {
          const imported = importDatabaseData(JSON.parse(content));
          snapshots += imported.snapshots;
          information += imported.information;
          continue;
        } catch {
          /* Store non-backup JSON as reference information. */
        }
      }
      addImportedInformation(path.basename(filePath), content);
      information += 1;
    }
    return { snapshots, information, files: result.filePaths.length };
  });
  ipcMain.handle("debug:export", async () => {
    if (!window) return null;
    const result = await dialog.showSaveDialog(window, {
      title: "Export New Eden Sage diagnostic log",
      defaultPath: "new-eden-sage-diagnostic.log",
      filters: [{ name: "Diagnostic log", extensions: ["log"] }],
    });
    if (result.canceled || !result.filePath) return null;
    try {
      await fs.copyFile(LOG_FILE, result.filePath);
    } catch {
      await fs.writeFile(
        result.filePath,
        "No diagnostic events have been recorded yet.\n",
        "utf8",
      );
    }
    await logEvent("info", "debug_log.exported", {
      destination: result.filePath,
    });
    return result.filePath;
  });
  ipcMain.handle("market:regions", () => loadSharedMarketBrowserRegions());
  ipcMain.handle("fit:shopping-route", async (_event, input) =>
    buildFitShoppingRoute(input),
  );
  ipcMain.handle("eve:export-shopping-route", async (_event, input: { characterId: string; stops: Array<{ locationId?: number; systemId: number }> }) => {
    const characterId = String(input?.characterId ?? "");
    const stops = Array.isArray(input?.stops) ? input.stops : [];
    if (!characterId || !stops.length) throw new Error("Calculate a shopping route before exporting waypoints to EVE.");
    let exported = 0;
    const accessToken = await eveWriteAccessToken(characterId);
    for (let index = 0; index < stops.length; index += 1) {
      const stop = stops[index];
      const systemId = Number(stop.systemId);
      let destinationId = Number(stop.locationId ?? systemId);
      if (!Number.isSafeInteger(destinationId) || destinationId <= 0) destinationId = systemId;
      const makeUrl = (destination: number) => {
        const url = new URL("https://esi.evetech.net/v2/ui/autopilot/waypoint");
        url.searchParams.set("add_to_beginning", "false");
        url.searchParams.set("clear_other_waypoints", index === 0 ? "true" : "false");
        url.searchParams.set("destination_id", String(destination));
        return url.toString();
      };
      try {
        await eveWriteRequest(characterId, makeUrl(destinationId), undefined, accessToken);
      } catch (error) {
        const status = (error as Error & { status?: number }).status;
        if (destinationId !== systemId && (status === 400 || status === 404)) await eveWriteRequest(characterId, makeUrl(systemId), undefined, accessToken);
        else if (status === 403) throw new Error("EVE denied waypoint access. Reconnect this character in Sage once to grant route-export permission.");
        else throw error;
      }
      exported += 1;
    }
    return { success: true, waypoints: exported };
  });
  ipcMain.handle("eve:export-navigation-route", async (_event, input: { characterId: string; systemIds: number[]; clearOtherWaypoints?: boolean }) =>
    exportNavigationWaypoints(input, {
      getAccessToken: eveWriteAccessToken,
      request: (characterId, url, accessToken) => eveWriteRequest(characterId, url, undefined, accessToken),
    }),
  );
  ipcMain.handle("eve:export-fit", async (_event, input: { characterId: string; fit: unknown }) => {
    const characterId = String(input?.characterId ?? "");
    if (!characterId) throw new Error("Choose a connected character before exporting the fit.");
    try {
      return await eveWriteRequest(characterId, `https://esi.evetech.net/v2/characters/${characterId}/fittings`, eveFittingPayload(input.fit));
    } catch (error) {
      if ((error as Error & { status?: number }).status === 403) throw new Error("EVE denied fitting-write access. Reconnect this character in Sage to refresh its fitting permission.");
      throw error;
    }
  });
  ipcMain.handle("trade:radius-opportunities", async (_event, mode) =>
    runTradeAnalysis(
      mode,
      {},
      listSnapshots() as any[],
      (progress) => window?.webContents.send("analysis:progress", progress),
    ),
  );
  ipcMain.handle("opportunity:analyze", async (_event, input: any) => {
    const { force = false, ...query } = input ?? {};
    return runOpportunityAnalysis(
      query,
      listSnapshots() as any[],
      (progress) => window?.webContents.send("analysis:progress", progress),
    );
  });
  ipcMain.handle("pve:locations", async (_event, input: { characterId: string; cloneState?: "alpha" | "omega"; maxJumps?: number | null; maxMinutes?: number | null; forceLive?: boolean }) => {
    const snapshot = getSnapshot(input.characterId) as any;
    if (!snapshot) throw new Error("Select and sync a connected character.");
    return runPveLocationAnalysis(
      { characterId: input.characterId, maxJumps: input.maxJumps, maxMinutes: input.maxMinutes, forceLive: input.forceLive },
      snapshot,
      input.cloneState ?? "omega",
      (progress) => window?.webContents.send("analysis:progress", progress),
    );
  });
  ipcMain.handle("prepared:isk-lab", async (_event, input: { characterId: string; cloneState?: "alpha" | "omega" }) => {
    const snapshot = getSnapshot(input.characterId) as any;
    if (!snapshot) throw new Error("Select and sync a connected character.");
    const snapshots = listSnapshots() as any[];
    const marketInput = {
      characterId: String(snapshot.characterId),
      maxCapital: null,
      cargoCapacityM3: null,
      maxJumps: null,
      maxMinutes: null,
    };
    const pveInput = { characterId: String(snapshot.characterId), maxJumps: null, maxMinutes: null, forceLive: false };
    const [market, pve, preparedInvention] = await Promise.all([
      loadPreparedOpportunityAnalysis(marketInput, snapshots),
      loadPreparedPveLocationAnalysis(pveInput, snapshot, input.cloneState ?? "omega"),
      loadPreparedInventionResult({ characterId: String(snapshot.characterId), decryptorTypeId: null }, snapshot),
    ]);
    const invention = preparedInvention.result;
    // Prepared reads never launch heavyweight Invention work. Cache misses remain empty
    // until the Invention tab requests the isolated feature worker on demand.
    await releaseIdleMarketAnalysisWorker().catch(() => undefined);
    return { market: market ?? null, pve: pve ?? null, invention: invention ?? null };
  });
  ipcMain.handle("analysis:cancel", async (_event, kind) => cancelAnalysis("Analysis cancelled.", kind));
  ipcMain.handle("analysis:status", () => analysisStatus());
  ipcMain.handle("master:update-all", async (event, input?: CompleteSyncOptions) => {
    const options = input ?? {};
    if (options.cloneStates) await saveSyncPreparationOptions({ cloneStates: options.cloneStates });
    return runCompleteSync((progress) => {
      if (!event.sender.isDestroyed()) event.sender.send("master:update-progress", progress);
    // A button press explicitly refreshes private/authenticated data only.
    }, false, options);
  });
  ipcMain.on("diagnostics:renderer-error", (_event, report) => logCrash("renderer.javascript_error", { report }));
  ipcMain.handle("diagnostics:crash-log-path", () => CRASH_LOG_FILE);
  ipcMain.handle("trade:export-top1000", async () => {
    if (!window) return null;
    const analysis = await runTradeAnalysis(
      "top1000",
      {},
      listSnapshots() as any[],
      (progress) => window?.webContents.send("analysis:progress", progress),
    );
    const exportStamp = new Date().toISOString().replace(/[:.]/g, "-");
    const result = await dialog.showSaveDialog(window, {
      title: "Export market arbitrage opportunities",
      defaultPath: `new-eden-sage-arbitrage-${exportStamp}.csv`,
      filters: [{ name: "ChatGPT-ready CSV", extensions: ["csv"] }],
    });
    if (result.canceled || !result.filePath) return null;
    const header = [
      "Item",
      "Buy Region",
      "Sell Region",
      "Profit",
      "Profit %",
      "ISK/m3",
      "ISK/Jump",
      "Capital Required",
      "Remaining Volume",
      "Risk",
    ];
    const rows = analysis.opportunities.map((trade: any) => [
      trade.item,
      trade.sell.regionName,
      trade.buy.regionName,
      trade.profit,
      trade.marginPercent,
      Number.isFinite(trade.iskPerM3) ? trade.iskPerM3 : "",
      trade.iskPerJump,
      trade.investment,
      trade.units,
      trade.risk,
    ]);
    const content = [header, ...rows]
      .map((row) => row.map(csvCell).join(","))
      .join("\r\n");
    await fs.writeFile(result.filePath, `${content}\r\n`, "utf8");
    await logEvent("info", "arbitrage.exported", {
      filePath: result.filePath,
      rows: rows.length,
    });
    return result.filePath;
  });
  ipcMain.handle("market:raw-search", async (_event, input) =>
    runRawMarketSearch(
      input ?? { query: "" },
      (progress) => window?.webContents.send("analysis:progress", progress),
    ),
  );
  ipcMain.handle("market:regional-filter", async (_event, input) =>
    runRegionalMarketFilter(
      input ?? {},
      (progress) => window?.webContents.send("analysis:progress", progress),
    ),
  );
  ipcMain.handle("market:summaries", () => loadSharedMarketBrowserSummaries());
  ipcMain.handle("market:region", (_event, regionId: number) => loadSharedMarketBrowserRegion(Number(regionId)));
  ipcMain.handle("public-data:status", () => loadPublicDataStatus());
  ipcMain.handle("public-data:check-availability", () => refreshPublicDataAvailability());
  ipcMain.handle("public-data:check", () => installSharedPublicData());
  ipcMain.handle("market:storage", async () => {
    const manifest = await loadCurrentSharedMarketManifest();
    return { path: SHARED_MARKET_ROOT, retainedDatasets: manifest ? 1 : 0, raw: null, generation: manifest?.generation ?? null };
  });
  ipcMain.handle("market:pull", async (_event, input?: { mode?: string; regionId?: number }) => {
    if (input?.mode !== "contracts" && input?.mode !== "single") throw new Error("Public market data is server-managed. Use Data Control to install a newer generation.");
    const manifest = await loadCurrentSharedMarketManifest();
    if (!manifest) throw new Error("No public data is installed. Use Data Control > Check for new data, then install the available update.");
    if (input.mode === "contracts") {
      const contracts = await loadSharedPublicContractsDataset();
      if (!contracts) throw new Error("The installed public generation does not contain public contracts. Check Data Control for an update.");
      window?.webContents.send("market:progress", { mode: "contracts", regionName: "Installed server-prepared public contracts", pagesDone: 1, pagesTotal: 1, regionsDone: 1, regionsTotal: 1 });
      return { summaries: contracts.regions, storage: { path: `Shared public generation ${manifest.generation}`, retained: 1 }, generation: manifest.generation, contractCount: contracts.contractCount, pendingDetailCount: contracts.pendingDetailCount };
    }
    const summaries = await loadSharedMarketBrowserSummaries();
    window?.webContents.send("market:progress", { mode: "single", regionName: "Installed server-prepared public market", pagesDone: 1, pagesTotal: 1, regionsDone: 1, regionsTotal: 1 });
    return { summaries, storage: { path: `Shared public generation ${manifest.generation}`, retained: 1 }, generation: manifest.generation };
  });
  createWindow();
  window?.webContents.once("did-finish-load", () => {
    void (async () => {
      try {
        await refreshPublicDataAvailability();
      } catch (error) {
        await logEvent("warn", "shared_public.startup_availability_check_failed", { error: error instanceof Error ? error.message : String(error) });
      }
      startSharedPublicDataFlow();
      await logEvent("info", "private_refresh.automatic_disabled", { reason: "Private data refreshes are user initiated; targeted live-location refreshes remain feature controlled." });
    })().catch((error) => logCrash("public_data.availability_start_failed", { error }));
  });
  });
}
function makeChatGPTMarkdown(data: ReturnType<typeof exportDatabaseData>) {
  const snapshots = data.characterSnapshots
    .map((item) => JSON.stringify(item, null, 2))
    .join("\n\n");
  const notes = data.importedInformation
    .map(
      (item) =>
        `### ${(item as { source_name: string }).source_name}\n\n${(item as { content: string }).content}`,
    )
    .join("\n\n");
  return `# New Eden Sage - Capsuleer Strategy Pack\n\nExported: ${data.exportedAt}\n\n## Instructions for ChatGPT\n\nAct as my overall EVE Online strategic advisor. Treat the character records below as timestamped snapshots, distinguish them from current live facts, state assumptions, and ask for missing information before making high-impact recommendations. Do not automate gameplay.\n\n## Character snapshots\n\n${snapshots || "No character snapshots stored."}\n\n## Imported information\n\n${notes || "No additional information imported."}\n`;
}

function makeCompleteChatGPTMarkdown(
  data: ReturnType<typeof exportDatabaseData>,
) {
  const snapshots = data.characterSnapshots
    .map((item) => renderCharacterForChatGPT(item))
    .join("\n\n---\n\n");
  const notes = data.importedInformation
    .map(
      (item) =>
        `### ${(item as { source_name: string }).source_name}\n\n${(item as { content: string }).content}`,
    )
    .join("\n\n");
  return `# New Eden Sage - Capsuleer Strategy Pack\n\nExported: ${data.exportedAt}\n\n## Instructions for ChatGPT\n\nAct as my overall EVE Online strategic advisor. Treat the character records below as timestamped snapshots, distinguish them from current live facts, state assumptions, and ask for missing information before making high-impact recommendations. Do not automate gameplay.\n\n## ESI character data\n\n${snapshots || "No character snapshots stored."}\n\n## Manually imported notes and reference files\n\n${notes || "None. This does not mean ESI data is missing; all captured ESI data is shown above."}\n`;
}

function renderCharacterForChatGPT(item: unknown) {
  const snapshot = item as Record<string, unknown>;
  const character = (snapshot.character ?? {}) as Record<string, unknown>;
  const extended = (snapshot.extended ?? {}) as Record<string, unknown>;
  const core = Object.fromEntries(
    Object.entries(snapshot).filter(([key]) => key !== "extended"),
  );
  const datasetNames: Record<string, string> = {
    assets: "Assets",
    assetSummary: "Asset totals, stations and owned ships",
    blueprints: "Blueprints",
    clones: "Clones and jump clones",
    implants: "Implants",
    contacts: "Contacts",
    fatigue: "Jump fatigue",
    loyaltyPoints: "Loyalty points",
    notifications: "Notifications",
    standings: "Agent and faction standings",
    contracts: "Contracts",
    contractItems: "Contract items",
    fittings: "Saved fittings",
    industryJobs: "Industry jobs",
    killmails: "Recent killmails",
    killmailDetails: "Killmail details",
    marketOrders: "Character market orders and history",
    walletJournal: "Wallet journal",
    walletTransactions: "Wallet transactions",
    walletHistorySummary: "Wallet history capture status",
    planets: "Planetary industry colonies",
    planetDetails: "Planetary industry details",
    currentShipFit: "Current ship and fitted items",
    corporation: "Corporation data",
  };
  const inventory = Object.entries(extended)
    .map(([key, value]) => {
      const state = Array.isArray(value)
        ? `${value.length} record(s)`
        : value && typeof value === "object"
          ? (value as Record<string, unknown>).unavailable
            ? `unavailable (ESI status ${(value as Record<string, unknown>).status ?? "unknown"})`
            : "captured"
          : value == null
            ? "no data"
            : "captured";
      return `- ${datasetNames[key] ?? key}: ${state}`;
    })
    .join("\n");
  const sections = Object.entries(extended)
    .map(
      ([key, value]) =>
        `### ${datasetNames[key] ?? key}\n\n\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``,
    )
    .join("\n\n");
  return `# Character: ${character.name ?? snapshot.characterId ?? "Unknown"}\n\n## ESI dataset inventory\n\n${inventory || "No extended ESI datasets were captured. Reconnect this character and sync again."}\n\n## Core character snapshot\n\n\`\`\`json\n${JSON.stringify(core, null, 2)}\n\`\`\`\n\n## Complete captured ESI datasets\n\n${sections || "No extended ESI datasets were captured."}`;
}

function csvCell(value: unknown) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

async function writeTradeWorkbook(
  filePath: string,
  data: { createdAt: string; summaries: unknown[] },
  kind: "stations" | "contracts",
) {
  const partialPath = `${filePath}.${process.pid}.${Date.now()}.partial`;
  try {
    await writeTradeWorkbookFile(partialPath, data, kind);
    validateTradeWorkbook(partialPath);
    await fs.rm(filePath, { force: true });
    await promoteValidatedWorkbook(partialPath, filePath);
  } catch (error) {
    await fs.rm(partialPath, { force: true }).catch(() => undefined);
    await logEvent("error", "trade_workbook.validation_failed", {
      filePath,
      kind,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

async function promoteValidatedWorkbook(partialPath: string, filePath: string) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    try {
      await fs.rename(partialPath, filePath);
      return;
    } catch (error) {
      lastError = error;
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EBUSY" && code !== "EPERM") throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 250));
    }
  }
  await fs.copyFile(partialPath, filePath);
  validateTradeWorkbook(filePath);
  await fs.rm(partialPath, { force: true }).catch(async () => {
    await logEvent("warn", "trade_workbook.partial_cleanup_deferred", {
      partialPath,
      error: lastError instanceof Error ? lastError.message : String(lastError),
    });
  });
}

async function writeTradeWorkbookFile(
  filePath: string,
  data: { createdAt: string; summaries: unknown[] },
  kind: "stations" | "contracts",
) {
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
    filename: filePath,
    useStyles: false,
    useSharedStrings: true,
  });
  const regions = data.summaries as Array<{
    regionName?: string;
    items?: Array<any>;
    publicContracts?: Array<any>;
  }>;
  const included = regions.filter((region) =>
    kind === "stations"
      ? Boolean(region.items?.length)
      : Boolean(region.publicContracts?.length),
  );
  const manifest = workbook.addWorksheet("Manifest");
  manifest.addRow(["New Eden Sage dataset", kind]).commit();
  manifest.addRow(["Snapshot created", data.createdAt]).commit();
  manifest.addRow(["Included regions", included.length]).commit();
  manifest
    .addRow([
      "Instructions",
      kind === "stations"
        ? "Analyze every worksheet together. BUY is demand and SELL is supply. Account for remaining volume, minimum volume, buy range, fees, cargo, jumps and risk."
        : "Group rows by contract_id before valuing bundles. Account for included/requested items, location, expiry, volume and liquidity.",
    ])
    .commit();
  manifest.commit();
  included.forEach((region, regionIndex) => {
    const sheetName = `${regionIndex + 1}-${region.regionName ?? "Region"}`
      .replace(/[\\/?*:[\]]/g, "-")
      .slice(0, 31);
    const sheet = workbook.addWorksheet(sheetName);
    if (kind === "stations") {
      sheet
        .addRow([
          "region",
          "type_id",
          "item",
          "item_volume_m3",
          "side",
          "rank",
          "price_isk",
          "volume_remaining",
          "remaining_order_cargo_m3",
          "remaining_order_value_isk",
          "minimum_volume",
          "minimum_fill_cost_isk",
          "buy_range",
          "system",
          "station",
          "issued",
          "duration_days",
          "order_id",
        ])
        .commit();
      for (const item of region.items ?? [])
        for (const [side, orders] of [
          ["BUY", item.topBuyOrders ?? []],
          ["SELL", item.topSellOrders ?? []],
        ] as Array<[string, any[]]>)
          orders.forEach((order, index) =>
            sheet
              .addRow([
                region.regionName,
                item.typeId,
                item.typeName,
                item.itemVolumeM3 ?? 0,
                side,
                index + 1,
                order.price,
                order.volumeRemain,
                order.volumeRemain * (item.itemVolumeM3 ?? 0),
                order.volumeRemain * order.price,
                order.minVolume ?? 1,
                (order.minVolume ?? 1) * order.price,
                order.range ?? "station",
                order.systemName,
                order.locationName,
                order.issued,
                order.durationDays ?? "",
                order.orderId,
              ])
              .commit(),
          );
    } else {
      sheet
        .addRow([
          "region",
          "contract_id",
          "title",
          "contract_price_isk",
          "contract_volume_m3",
          "expires",
          "system",
          "station",
          "item_included",
          "type_id",
          "item",
          "item_volume_m3",
          "quantity",
          "item_stack_volume_m3",
          "estimated_unit_value_isk",
          "estimated_stack_value_isk",
        ])
        .commit();
      for (const contract of region.publicContracts ?? [])
        for (const item of contract.items ?? [])
          sheet
            .addRow([
              region.regionName,
              contract.contractId,
              contract.title,
              contract.price,
              contract.volume,
              contract.expires,
              contract.systemName,
              contract.startLocationName,
              item.included,
              item.typeId,
              item.typeName,
              item.itemVolumeM3 ?? 0,
              item.quantity,
              item.quantity * (item.itemVolumeM3 ?? 0),
              item.estimatedUnitValue ?? 0,
              item.estimatedValue ?? 0,
            ])
            .commit();
    }
    sheet.commit();
  });
  await workbook.commit();
}

function validateTradeWorkbook(filePath: string) {
  const archive = new AdmZip(filePath);
  const entries = new Set(archive.getEntries().map((entry) => entry.entryName));
  const required = ["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml"];
  const missing = required.filter((entry) => !entries.has(entry));
  if (missing.length)
    throw new Error(
      `The XLSX export did not close correctly (missing ${missing.join(", ")}).`,
    );
  if (!archive.test())
    throw new Error("The XLSX export failed its ZIP integrity check.");
}

/* Legacy ZIP writer retained temporarily for migration reference.
async function writeTradeArchive(
  filePath: string,
  data: { createdAt: string; summaries: unknown[] },
  kind: "stations" | "contracts",
) {
  const loadedArchiver: any = await import("archiver");
  const archiver = loadedArchiver.default ?? loadedArchiver;
  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(filePath);
    const archive = archiver("zip", { zlib: { level: 9 } });
    output.on("close", resolve);
    output.on("error", reject);
    archive.on("error", reject);
    archive.pipe(output);
    const regions: Array<{
      regionName?: string;
      items?: unknown[];
      publicContracts?: unknown[];
    }> = data.summaries as Array<{
      regionName?: string;
      items?: unknown[];
      publicContracts?: unknown[];
    }>;
    const included = regions.filter((region) =>
      kind === "stations"
        ? Boolean(region.items?.length)
        : Boolean(region.publicContracts?.length),
    );
    const instructions =
      kind === "stations"
        ? "Analyze every regional CSV together. Find executable station-to-station trades using BUY rows as demand and SELL rows as supply. Account for remaining volume, minimum volume, buy range, fees, cargo, jumps and risk. Do not assume an order is executable outside its listed range."
        : "Analyze every regional contract CSV together. Group rows by contract_id before valuing a contract. Included and requested items belong to the same contract bundle. Account for location, expiry, cargo volume and market liquidity.";
    archive.append(
      JSON.stringify(
        {
          format: "New Eden Sage regional trade archive",
          kind,
          snapshotCreatedAt: data.createdAt,
          sourceRegions: regions.length,
          includedRegions: included.length,
          instructions,
        },
        null,
        2,
      ),
      { name: "manifest.json" },
    );
    for (const region of included) {
      const safeName = (region.regionName ?? "unknown-region")
        .replace(/[^a-z0-9._-]+/gi, "-")
        .replace(/^-|-$/g, "");
      const csv =
        kind === "stations"
          ? makeStationTradeCsv({ summaries: [region] })
          : makeContractCsv({ summaries: [region] });
      archive.append(csv, { name: `regions/${safeName}.csv` });
    }
    void archive.finalize();
  });
}

*/
function makeCompactStationTradeCsv(
  data: { summaries: unknown[] },
  rankDepth: number,
) {
  type Order = {
    orderId: number;
    price: number;
    volumeRemain: number;
    locationName: string;
    systemName: string;
    issued: string;
    minVolume?: number;
    range?: string;
    durationDays?: number;
  };
  type Ranked = Order & { regionName: string };
  type Item = {
    typeId: number;
    typeName: string;
    topBuyOrders?: Order[];
    topSellOrders?: Order[];
  };
  const grouped = new Map<
    number,
    { typeName: string; buys: Map<number, Ranked>; sells: Map<number, Ranked> }
  >();
  for (const region of data.summaries as Array<{
    regionName: string;
    items?: Item[];
  }>)
    for (const item of region.items ?? []) {
      const current = grouped.get(item.typeId) ?? {
        typeName: item.typeName,
        buys: new Map<number, Ranked>(),
        sells: new Map<number, Ranked>(),
      };
      for (const order of item.topBuyOrders ?? [])
        current.buys.set(order.orderId, {
          ...order,
          regionName: region.regionName,
        });
      for (const order of item.topSellOrders ?? [])
        current.sells.set(order.orderId, {
          ...order,
          regionName: region.regionName,
        });
      grouped.set(item.typeId, current);
    }
  const rows: unknown[][] = [
    [
      "region",
      "type_id",
      "item",
      "side",
      "rank",
      "price_isk",
      "volume_remaining",
      "minimum_volume",
      "buy_range",
      "system",
      "station",
      "issued",
      "duration_days",
      "order_id",
    ],
  ];
  for (const [typeId, item] of grouped)
    for (const [side, orders] of [
      [
        "BUY",
        [...item.buys.values()]
          .sort((a, b) => b.price - a.price || b.volumeRemain - a.volumeRemain)
          .slice(0, rankDepth),
      ],
      [
        "SELL",
        [...item.sells.values()]
          .sort((a, b) => a.price - b.price || b.volumeRemain - a.volumeRemain)
          .slice(0, rankDepth),
      ],
    ] as Array<[string, Ranked[]]>)
      orders.forEach((order, index) =>
        rows.push([
          order.regionName,
          typeId,
          item.typeName,
          side,
          index + 1,
          order.price,
          order.volumeRemain,
          order.minVolume ?? 1,
          order.range ?? "station",
          order.systemName,
          order.locationName,
          order.issued,
          order.durationDays ?? "",
          order.orderId,
        ]),
      );
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

function makeStationTradeCsv(data: { summaries: unknown[] }) {
  type Order = {
    orderId: number;
    price: number;
    volumeRemain: number;
    locationName: string;
    systemName: string;
    issued: string;
    minVolume?: number;
    range?: string;
    durationDays?: number;
  };
  type Item = {
    typeId: number;
    typeName: string;
    topBuyOrders?: Order[];
    topSellOrders?: Order[];
  };
  const rows: unknown[][] = [
    [
      "dataset",
      "region",
      "type_id",
      "item",
      "side",
      "rank",
      "price_isk",
      "volume_remaining",
      "minimum_volume",
      "buy_range",
      "system",
      "station",
      "issued",
      "duration_days",
      "order_id",
    ],
  ];
  for (const region of data.summaries as Array<{
    regionName: string;
    updatedAt: string;
    items?: Item[];
  }>)
    for (const item of region.items ?? []) {
      for (const [side, orders] of [
        ["BUY", item.topBuyOrders ?? []],
        ["SELL", item.topSellOrders ?? []],
      ] as Array<[string, Order[]]>)
        orders.forEach((order, index) =>
          rows.push([
            region.updatedAt,
            region.regionName,
            item.typeId,
            item.typeName,
            side,
            index + 1,
            order.price,
            order.volumeRemain,
            order.minVolume ?? 1,
            order.range ?? "station",
            order.systemName,
            order.locationName,
            order.issued,
            order.durationDays ?? "",
            order.orderId,
          ]),
        );
    }
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

function makeContractCsv(data: { summaries: unknown[] }) {
  type Contract = {
    contractId: number;
    title: string;
    price: number;
    volume: number;
    expires: string;
    startLocationName: string;
    systemName: string;
    items: Array<{
      typeId: number;
      typeName: string;
      quantity: number;
      included: boolean;
    }>;
  };
  const rows: unknown[][] = [
    [
      "dataset",
      "region",
      "contract_id",
      "title",
      "contract_price_isk",
      "contract_volume_m3",
      "expires",
      "system",
      "station",
      "item_included",
      "type_id",
      "item",
      "quantity",
    ],
  ];
  for (const region of data.summaries as Array<{
    regionName: string;
    updatedAt: string;
    publicContracts?: Contract[];
  }>)
    for (const contract of region.publicContracts ?? [])
      for (const item of contract.items)
        rows.push([
          region.updatedAt,
          region.regionName,
          contract.contractId,
          contract.title,
          contract.price,
          contract.volume,
          contract.expires,
          contract.systemName,
          contract.startLocationName,
          item.included,
          item.typeId,
          item.typeName,
          item.quantity,
        ]);
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

function makeRadiusChatGPTMarkdown(data: {
  createdAt: string;
  summaries: unknown[];
}) {
  type ExportOrder = {
    orderId: number;
    price: number;
    volumeRemain: number;
    locationName: string;
    systemName: string;
  };
  type ExportItem = {
    typeId: number;
    typeName: string;
    topBuyOrders?: ExportOrder[];
    topSellOrders?: ExportOrder[];
  };
  const clean = (value: string) => value.replace(/\t|\r?\n/g, " ");
  const sections = (
    data.summaries as Array<{
      regionName: string;
      orderCount: number;
      buyOrders: number;
      sellOrders: number;
      uniqueTypes: number;
      updatedAt: string;
      items?: ExportItem[];
    }>
  )
    .map((region) => {
      const rows = (region.items ?? [])
        .flatMap((item) => [
          ...(item.topBuyOrders ?? []).map((order, index) =>
            [
              item.typeId,
              clean(item.typeName),
              "BUY",
              index + 1,
              order.price,
              order.volumeRemain,
              clean(order.systemName),
              clean(order.locationName),
              order.orderId,
            ].join("\t"),
          ),
          ...(item.topSellOrders ?? []).map((order, index) =>
            [
              item.typeId,
              clean(item.typeName),
              "SELL",
              index + 1,
              order.price,
              order.volumeRemain,
              clean(order.systemName),
              clean(order.locationName),
              order.orderId,
            ].join("\t"),
          ),
        ])
        .join("\n");
      return `## ${region.regionName}\n\nOrders scanned: ${region.orderCount}; buy: ${region.buyOrders}; sell: ${region.sellOrders}; item types: ${region.uniqueTypes}; updated: ${region.updatedAt}. The table retains at most the 10 highest buyers and 10 lowest sellers per item.\n\n\`\`\`tsv\ntype_id\titem\tside\trank\tprice_isk\tvolume_remaining\tsystem\tlocation\torder_id\n${rows}\n\`\`\``;
    })
    .join("\n\n");
  return `# New Eden Sage - 20-Jump Market Strategy Pack\n\nDataset created: ${data.createdAt}\n\n## Instructions for ChatGPT\n\nAct as my EVE Online trade-route strategist. This dataset contains market orders filtered to the newest 20-jump radius pull from my synced character, with low-sec included only if selected during that pull. Compare buy and sell opportunities, but account for taxes, fees, cargo capacity, route risk, available volume, and the difference between listed volume and realistic traded volume. Treat prices as a timestamped snapshot, not guaranteed executions. Ask for my available capital, cargo capacity, tax skills, and risk tolerance when missing.\n\n${sections}\n`;
}

app.on("window-all-closed", () => {
  stopSharedPublicListener?.(); stopSharedPublicListener = undefined;
  if (publicReconcileTimer) { clearInterval(publicReconcileTimer); publicReconcileTimer = undefined; }
  void logEvent("info", "app.window_all_closed");
  void disposeAnalysisWorker();
  void disposeFittingWorker();
  void stopMcpWriteBridge();
  if (process.platform !== "darwin") app.quit();
});
