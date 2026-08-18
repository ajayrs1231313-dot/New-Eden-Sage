import { app, BrowserWindow, clipboard, dialog, ipcMain, protocol, shell } from "electron";
import { autoUpdater } from "electron-updater";
import { promises as fs } from "node:fs";
import path from "node:path";
import { Worker } from "node:worker_threads";
import AdmZip from "adm-zip";
import ExcelJS from "exceljs";
import {
  decrypt,
  encrypt,
  publicConfig,
  readConfig,
  writeConfig,
} from "./config";
import { fetchCharacterSnapshot, loginWithEve, refreshEveToken } from "./eve";
import {
  addImportedInformation,
  deleteSnapshot,
  exportDatabaseData,
  getSnapshot,
  importDatabaseData,
  listImportedInformation,
  listSnapshots,
  saveSnapshot,
} from "./database";
import {
  discoverHighSecSystems,
  discoverMarketRadius,
  listRegions,
  pullRegionContracts,
  pullRegionMarket,
} from "./market";
import {
  countMarketDatasets,
  loadLatestMarketDataset,
  loadLatestMarketDatasetByMode,
  loadMarketIndexHeaders,
  loadMarketRegion,
  marketSummaryHeaders,
  MARKET_DATA_ROOT,
  saveMarketDataset,
} from "./market-storage";
import { listPublishedShips, stageStaticDataRefreshLowImpact } from "./type-volumes";
import { runMasterUpdate } from "./master-update";
import { CRASH_LOG_FILE, LOG_FILE, logCrash, logEvent } from "./logger";
import { buildFitShoppingRoute, findRadiusTrades } from "./trade";
import { getEveNews } from "./news";
import { runFittingWorker, disposeFittingWorker } from "./fitting-worker-manager";
import { analyzeBlueprintActivities, analyzeInventionOpportunities, analyzeManufacturingPlan, getIndustrySystemCostIndices } from "./industrial-engine";
import { getLootAcquisition, prepareLootDataLocal, searchLootItems } from "./loot-engine";
import {
  beginRawMarketSnapshot,
  completeRawMarketSnapshot,
  loadCurrentRawMarketManifest,
  RAW_MARKET_ROOT,
  saveRawMarketRegion,
} from "./raw-market-storage";
import { analyzeShipReadiness } from "./readiness";
import { analyzeActivityReadiness } from "./activity-readiness";
import { loadPersistedResult, savePersistedResult } from "./persistent-result-cache";
import { searchRawMarketOrders } from "./raw-market-search";
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
} from "./analysis-job-manager";
import {
  getBlueprintActivitiesPrepared,
  getIndustrialOpportunitiesPrepared,
  getManufacturingPlanPrepared,
  getSystemCostIndexPrepared,
  loadIndustrialPreparedState,
  prepareIndustrialCommand,
} from "./industrial-preparation";
import { configureAndStartMcpTunnel, getMcpTunnelStatus, startMcpTunnel } from "./mcp-tunnel";
import { startMcpWriteBridge, stopMcpWriteBridge } from "./mcp-write-bridge";
import { claudeSetupText, ensureClaudeCompatibility, getClaudeCompatibilityStatus } from "./claude-integration";
import { typeImageProtocolResponse } from "./eve-assets";

protocol.registerSchemesAsPrivileged([{
  scheme: "sage-asset",
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
}]);

let window: BrowserWindow | null = null;
let masterUpdateActive = false;
const STARTUP_SYNC_GUARD_MS = 30_000;
const startupSyncGuardUntil = Date.now() + STARTUP_SYNC_GUARD_MS;

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
type CompleteSyncOptions = { cloneStates?: Record<string, "alpha" | "omega"> };

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

function runFeaturePrepWorker<T = unknown>(workerData: unknown, onProgress?: (progress: { percent?: number; message?: string }) => void) {
  return new Promise<T>((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, "feature-prep-worker.js"), {
      workerData,
      env: { ...process.env, NEW_EDEN_SAGE_USER_DATA: app.getPath("userData") },
    });
    let settled = false;
    let timeout: NodeJS.Timeout | undefined;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      callback();
      void worker.terminate().catch(() => undefined);
    };
    timeout = setTimeout(() => finish(() => reject(new Error("Feature preparation timed out after 15 minutes."))), 15 * 60_000);
    timeout.unref();
    worker.on("message", (message: any) => {
      if (message?.type === "progress") onProgress?.(message);
      if (message?.type === "complete") finish(() => resolve(message.result as T));
      if (message?.type === "error") finish(() => reject(new Error(String(message.error ?? "Feature preparation failed."))));
    });
    worker.once("error", (error) => finish(() => reject(error)));
    worker.once("exit", (code) => {
      if (!settled) finish(() => reject(new Error(`Feature preparation worker exited before completion (${code}).`)));
    });
  });
}

async function inventionPreparedCacheKey(input: { characterId: string; decryptorTypeId?: number | null }, snapshot: any) {
  const manifest = await loadCurrentRawMarketManifest("all");
  return {
    schema: 10,
    characterId: input.characterId,
    snapshot: snapshot.updatedAt,
    marketSnapshotId: manifest?.id ?? "none",
    decryptorTypeId: Number(input.decryptorTypeId ?? 0),
  };
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
  const preparationFailures: Array<{ track: PrepTrackId; error: string }> = [];
  let coreResult: any = null;

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

  const updateTrack = (id: PrepTrackId, patch: Partial<PrepTrack>, announce = true) => {
    Object.assign(prepTrack(tracks, id), patch);
    refreshIskLabTrack(tracks);
    if (announce) publish(patch.message ?? prepTrack(tracks, id).message);
  };

  const runTrack = async (id: PrepTrackId, work: (report: (percent: number, message: string) => void) => Promise<void>) => {
    updateTrack(id, { percent: 1, status: "running", message: `Preparing ${prepTrack(tracks, id).label}.` });
    try {
      await work((percent, message) => updateTrack(id, { percent: clampPrepPercent(percent), status: "running", message }));
      updateTrack(id, { percent: 100, status: "done", message: `${prepTrack(tracks, id).label} ready.` });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      preparationFailures.push({ track: id, error: message });
      updateTrack(id, { percent: 100, status: "error", message: `${prepTrack(tracks, id).label} needs retrying.` });
      await logEvent("error", "master_update.feature_prepare_failed", { track: id, error: message });
    }
  };

  const cloneStateFor = (snapshot: any): "alpha" | "omega" => options.cloneStates?.[String(snapshot.characterId)] ?? "omega";
  const combinedCharacterPercent = (index: number, total: number, localPercent: number) => total ? ((index + clampPrepPercent(localPercent) / 100) / total) * 100 : 100;

  try {
    await Promise.all([disposeFittingWorker(), stopAnalysisWorkersForExclusiveTask()]);
    await logEvent("info", "master_update.sync_started", { source: "automatic-or-sync-all" });
    updateTrack("core", { percent: 0, status: "running", message: "Refreshing live data and shared indexes." });

    coreResult = await runMasterUpdate((progress: any) => {
      lastProgress = progress;
      Object.assign(prepTrack(tracks, "core"), {
        percent: clampPrepPercent(progress.percent),
        status: progress.percent >= 100 ? "done" : "running",
        message: String(progress.message ?? "Refreshing shared data."),
      });
      publish(String(progress.message ?? "Refreshing shared data."), { ...progress, running: true });
    });

    const coreFailures = Array.isArray(coreResult?.failures) ? coreResult.failures : [];
    updateTrack("core", {
      percent: 100,
      status: coreFailures.length ? "error" : "done",
      message: coreFailures.length ? `Core update completed with ${coreFailures.length} failed job(s).` : "Live data and shared indexes ready.",
    });

    const snapshots = listSnapshots() as any[];
    if (!snapshots.length) {
      updateTrack("market-scanner", { percent: 100, status: "done", message: "No connected characters to prepare." }, false);
      updateTrack("opportunities", { percent: 100, status: "done", message: "No connected characters to prepare." });
    } else {
      updateTrack("market-scanner", { percent: 1, status: "running", message: "Preparing retained market scanner results." }, false);
      updateTrack("opportunities", { percent: 1, status: "running", message: "Preparing ranked opportunities." });
      try {
        for (let index = 0; index < snapshots.length; index += 1) {
          const snapshot = snapshots[index];
          const input = {
            characterId: snapshot.characterId,
            maxCapital: snapshot.wallet ? Math.round(Number(snapshot.wallet)) : null,
            cargoCapacityM3: null,
            maxJumps: null,
            maxMinutes: null,
          };
          await runOpportunityAnalysis(input, snapshots, (progress) => {
            const percent = combinedCharacterPercent(index, snapshots.length, progress.percent ?? 0);
            const message = `${snapshot.character?.name ?? "Character"}: ${progress.message}`;
            updateTrack("market-scanner", { percent, status: "running", message }, false);
            updateTrack("opportunities", { percent, status: "running", message });
          });
        }
        updateTrack("market-scanner", { percent: 100, status: "done", message: "Market Scanner ready." }, false);
        updateTrack("opportunities", { percent: 100, status: "done", message: "Opportunities ready." });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        preparationFailures.push({ track: "market-scanner", error: message });
        updateTrack("market-scanner", { percent: 100, status: "error", message: "Market Scanner needs retrying." }, false);
        updateTrack("opportunities", { percent: 100, status: "error", message: "Opportunities need retrying." });
        await logEvent("error", "master_update.feature_prepare_failed", { track: "market-scanner", error: message });
      } finally {
        await releaseIdleMarketAnalysisWorker().catch(() => undefined);
      }
    }

    const inventionPrep = runTrack("inventions", async (report) => {
      if (!snapshots.length) { report(100, "No connected characters to prepare."); return; }
      for (let index = 0; index < snapshots.length; index += 1) {
        const snapshot = snapshots[index];
        report((index / snapshots.length) * 100, `Refreshing character + market invention results for ${snapshot.character?.name ?? "character"}.`);
        const key = await inventionPreparedCacheKey({ characterId: String(snapshot.characterId), decryptorTypeId: null }, snapshot);
        const saved = await loadPersistedResult("industry-invention-opportunities", key);
        if (!saved) await runFeaturePrepWorker({ task: "invention", snapshot, decryptorTypeId: null, cacheKey: key });
        report(((index + 1) / snapshots.length) * 100, `Invention results ready for ${snapshot.character?.name ?? "character"}.`);
      }
    });

    const pvePrep = runTrack("pve-locations", async (report) => {
      if (!snapshots.length) { report(100, "No connected characters to prepare."); return; }
      for (let index = 0; index < snapshots.length; index += 1) {
        const snapshot = snapshots[index];
        await runPveLocationAnalysis(
          { characterId: String(snapshot.characterId), maxJumps: null, maxMinutes: null, forceLive: false },
          snapshot,
          cloneStateFor(snapshot),
          (progress) => report(combinedCharacterPercent(index, snapshots.length, progress.percent ?? 0), `${snapshot.character?.name ?? "Character"}: ${progress.message}`),
        );
        report(((index + 1) / snapshots.length) * 100, `PvE/location intelligence ready for ${snapshot.character?.name ?? "character"}.`);
      }
    });

    const progressionPrep = runTrack("progression", async (report) => {
      if (!snapshots.length) { report(100, "No connected characters to prepare."); return; }
      for (let index = 0; index < snapshots.length; index += 1) {
        const snapshot = snapshots[index];
        const cloneState = cloneStateFor(snapshot);
        const segmentStart = index / snapshots.length * 100;
        const segmentSize = 100 / snapshots.length;
        await runCapabilityAnalysis(snapshot, cloneState, (progress) => {
          report(segmentStart + segmentSize * 0.45 * clampPrepPercent(progress.percent ?? 0) / 100, `${snapshot.character?.name ?? "Character"}: ${progress.message}`);
        });
        const hullTypeId = Number(snapshot.ship?.ship_type_id ?? 0);
        if (hullTypeId > 0) {
          const input = { characterId: String(snapshot.characterId), hullTypeId, cloneState, masteryLevel: 3 };
          const key = { input, snapshot: snapshot.updatedAt, readinessModel: "strict-skill-aware-fits-v4" };
          const saved = await loadPersistedResult("ship-readiness", key);
          if (!saved) await runFeaturePrepWorker({ task: "ship-readiness", snapshot, hullTypeId, cloneState, masteryLevel: 3, cacheKey: key });
        }
        const shipCatalogue = await listPublishedShips();
        const shipByName = new Map(shipCatalogue.map((ship) => [ship.name, ship]));
        const activityShips = DEFAULT_ACTIVITY_PREPARATION.shipNames
          .map((name) => shipByName.get(name))
          .filter((ship): ship is { typeId: number; name: string } => Boolean(ship));
        for (let activityIndex = 0; activityIndex < activityShips.length; activityIndex += 1) {
          const ship = activityShips[activityIndex];
          const activityInput = {
            characterId: String(snapshot.characterId),
            hullTypeId: ship.typeId,
            cloneState,
            coreSkills: DEFAULT_ACTIVITY_PREPARATION.coreSkills,
            supportSkills: DEFAULT_ACTIVITY_PREPARATION.supportSkills,
            context: {
              activityId: DEFAULT_ACTIVITY_PREPARATION.activityId,
              subcategoryId: DEFAULT_ACTIVITY_PREPARATION.subcategoryId,
              contentId: DEFAULT_ACTIVITY_PREPARATION.contentId,
              selectorValues: DEFAULT_ACTIVITY_PREPARATION.selectorValues,
            },
          };
          const key = { input: activityInput, snapshot: snapshot.updatedAt, readinessModel: "strict-skill-aware-fits-v4" };
          const saved = await loadPersistedResult("activity-readiness", key);
          if (!saved) {
            const result = await analyzeActivityReadiness(snapshot, activityInput);
            await savePersistedResult("activity-readiness", key, result);
          }
          report(
            segmentStart + segmentSize * (0.55 + 0.4 * ((activityIndex + 1) / Math.max(1, activityShips.length))),
            `${snapshot.character?.name ?? "Character"}: preparing default Activity Planner readiness.`,
          );
        }
        report(((index + 1) / snapshots.length) * 100, `Progression ready for ${snapshot.character?.name ?? "character"}.`);
      }
    });

    const industrialPrep = runTrack("industrial-command", async (report) => {
      if (!snapshots.length) { report(100, "No connected characters to prepare."); return; }
      for (let index = 0; index < snapshots.length; index += 1) {
        const snapshot = snapshots[index];
        await prepareIndustrialCommand(String(snapshot.characterId), (percent, message) => {
          report(combinedCharacterPercent(index, snapshots.length, percent), message);
        });
        report(((index + 1) / snapshots.length) * 100, `Industrial Command ready for ${snapshot.character?.name ?? "character"}.`);
      }
    });

    await Promise.all([inventionPrep, pvePrep, progressionPrep, industrialPrep]);

    const coreFailuresAfter = Array.isArray(coreResult?.failures) ? coreResult.failures : [];
    if (!coreFailuresAfter.length && !preparationFailures.length) await markVersionSynced();
    const totalDurationMs = Date.now() - startedAtMs;
    const failures = [...coreFailuresAfter, ...preparationFailures];
    const finalMessage = failures.length
      ? `Update finished, but ${failures.length} preparation step(s) need retrying.`
      : "Everything is synced and prepared. Sage is ready.";
    publish(finalMessage, {
      stage: failures.length ? "complete-with-errors" : "complete",
      totalDurationMs,
      downloadDurationMs: coreResult?.downloadDurationMs,
      completed: PREP_TRACK_LABELS.length,
      total: PREP_TRACK_LABELS.length,
    }, false);
    await logEvent("info", "master_update.full_preparation_completed", { totalDurationMs, preparationFailures });
    return { ...coreResult, totalDurationMs, preparationFailures };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logCrash("master_update.crashed", { error, lastProgress });
    publish(`Update stopped: ${message}`, { stage: "failed", totalDurationMs: Date.now() - startedAtMs }, false);
    throw error;
  } finally {
    masterUpdateActive = false;
  }
}
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

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  });

  app.whenReady().then(() => {
  protocol.handle("sage-asset", (request) => typeImageProtocolResponse(request.url));
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
  ipcMain.handle("external:open-zkillboard", () => shell.openExternal("https://zkillboard.com/"));
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
  ipcMain.handle("mcp:claude-repair", () => ensureClaudeCompatibility());
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
  ipcMain.handle("clipboard:write", (_event, value: string) => {
    clipboard.writeText(value);
    return clipboard.readText() === value;
  });
  ipcMain.handle("fitting:resolve-types-local", (_event, names: string[]) => runFittingWorker("resolve-types", { names }));
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
      const key = await inventionPreparedCacheKey(input, snapshot);
      const saved = await loadPersistedResult("industry-invention-opportunities", key);
      if (saved) return saved;
      const result = await analyzeInventionOpportunities({ snapshot, decryptorTypeId: input.decryptorTypeId });
      await savePersistedResult("industry-invention-opportunities", key, result);
      return result;
    },
  );
  ipcMain.handle("industrial:manufacturing-plan", async (_event, input: any) =>
    getManufacturingPlanPrepared(input, Boolean(input?.force)));
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
      const key = { input, snapshot: snapshot.updatedAt, readinessModel: "strict-skill-aware-fits-v4" };
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
      const key = { input, snapshot: snapshot.updatedAt, readinessModel: "strict-skill-aware-fits-v4" };
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
          const response = await fetch(
            `https://esi.evetech.net/universe/types/${typeId}/`,
            {
              headers: {
                "X-Compatibility-Date": "2026-08-02",
                "X-User-Agent": "NewEdenSage/0.1.0",
              },
            },
          );
          if (!response.ok)
            throw new Error(
              `EVE fitting analysis failed (${response.status}).`,
            );
          return response.json() as Promise<{
            type_id: number;
            name: string;
            dogma_attributes?: Array<{
              attribute_id: number;
              value: number;
            }>;
          }>;
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
      if (requiredSkillIds.length) {
        const response = await fetch(
          "https://esi.evetech.net/universe/names/",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Compatibility-Date": "2026-08-02",
              "X-User-Agent": "NewEdenSage/0.1.0",
            },
            body: JSON.stringify(requiredSkillIds),
          },
        );
        if (response.ok)
          for (const item of (await response.json()) as Array<{
            id: number;
            name: string;
          }>)
            skillNames.set(item.id, item.name);
      }
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
    await writeConfig(config);
    const snapshot = await fetchCharacterSnapshot(
      login.characterId,
      login.accessToken,
    );
    saveSnapshot(snapshot);
    return {
      characterId: login.characterId,
      characterName: login.characterName,
      snapshot,
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
    const snapshot = await fetchCharacterSnapshot(
      characterId,
      tokens.access_token,
    );
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
        const full = await loadLatestMarketDatasetByMode("all");
        if (!full)
          throw new Error(
            "No full public market dataset exists yet. Run a full market pull first.",
          );
        const contracts = await loadLatestMarketDatasetByMode("contracts");
        if (!contracts)
          throw new Error(
            "No full high-sec contracts dataset exists yet. Run the contracts pull first.",
          );
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
  ipcMain.handle("market:regions", async () => listRegions());
  ipcMain.handle("fit:shopping-route", async (_event, input) =>
    buildFitShoppingRoute(input),
  );
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
      maxCapital: snapshot.wallet ? Math.round(Number(snapshot.wallet)) : null,
      cargoCapacityM3: null,
      maxJumps: null,
      maxMinutes: null,
    };
    const pveInput = { characterId: String(snapshot.characterId), maxJumps: null, maxMinutes: null, forceLive: false };
    const inventionKey = await inventionPreparedCacheKey({ characterId: String(snapshot.characterId), decryptorTypeId: null }, snapshot);
    const [market, pve, invention] = await Promise.all([
      loadPreparedOpportunityAnalysis(marketInput, snapshots),
      loadPreparedPveLocationAnalysis(pveInput, snapshot, input.cloneState ?? "omega"),
      loadPersistedResult("industry-invention-opportunities", inventionKey),
    ]);
    await releaseIdleMarketAnalysisWorker().catch(() => undefined);
    return { market: market ?? null, pve: pve ?? null, invention: invention ?? null };
  });
  ipcMain.handle("analysis:cancel", async (_event, kind) => cancelAnalysis("Analysis cancelled.", kind));
  ipcMain.handle("analysis:status", () => analysisStatus());
  ipcMain.handle("master:update-all", async (event, input?: CompleteSyncOptions) => {
    const options = input ?? {};
    if (options.cloneStates) await saveSyncPreparationOptions(options);
    return runCompleteSync((progress) => {
      if (!event.sender.isDestroyed()) event.sender.send("master:update-progress", progress);
    }, Date.now() < startupSyncGuardUntil, options);
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
      title: "Export Top 1,000 arbitrage opportunities",
      defaultPath: `new-eden-sage-top-1000-arbitrage-${exportStamp}.csv`,
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
    await logEvent("info", "arbitrage.top1000_exported", {
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
  ipcMain.handle("market:summaries", () => loadMarketIndexHeaders());
  ipcMain.handle("market:region", (_event, regionId: number) =>
    loadMarketRegion(regionId),
  );
  ipcMain.handle("market:storage", async () => {
    const raw = await loadCurrentRawMarketManifest("all");
    return {
      path: MARKET_DATA_ROOT,
      retainedDatasets: await countMarketDatasets(),
      raw: raw
        ? { root: RAW_MARKET_ROOT, snapshotId: raw.id, createdAt: raw.createdAt, orderCount: raw.orderCount, regionCount: raw.regionCount, complete: raw.complete }
        : null,
    };
  });
  ipcMain.handle(
    "market:pull",
    async (
      _event,
      input: {
        mode: "single" | "all" | "radius" | "contracts";
        regionId?: number;
        characterId?: string;
        includeLowSec?: boolean;
      },
    ) => {
      const pullStartedAt = Date.now();
      await logEvent("info", "market_pull.started", {
        mode: input.mode,
        regionId: input.regionId,
        includeLowSec: Boolean(input.includeLowSec),
      });
      const regions = await listRegions();
      let allowedSystemIds: Set<number> | undefined;
      let selected =
        input.mode === "all" || input.mode === "contracts"
          ? regions
          : regions.filter((region) => region.regionId === input.regionId);
      const rawSnapshot = input.mode === "contracts" ? null : await beginRawMarketSnapshot(input.mode);
      if (input.mode === "contracts") {
        allowedSystemIds = await discoverHighSecSystems((completed, total) => {
          window?.webContents.send("market:progress", {
            mode: input.mode,
            regionName: "Mapping every high-sec system",
            regionsDone: 0,
            regionsTotal: regions.length,
            pagesDone: completed,
            pagesTotal: total,
          });
        });
      }
      if (input.mode === "radius") {
        const snapshot = getSnapshot(input.characterId) as {
          location?: { solar_system_id?: number };
          character?: { name?: string };
        } | null;
        const origin = snapshot?.location?.solar_system_id;
        if (!origin)
          throw new Error(
            "Sync the selected character before using the 20-jump pull.",
          );
        const radius = await discoverMarketRadius(
          origin,
          20,
          Boolean(input.includeLowSec),
          (systems, depth) => {
            window?.webContents.send("market:progress", {
              mode: input.mode,
              regionName: `Mapping from ${snapshot?.character?.name ?? "character"}`,
              regionsDone: depth,
              regionsTotal: 20,
              pagesDone: systems,
              pagesTotal: systems,
            });
          },
        );
        allowedSystemIds = radius.systemIds;
        selected = regions.filter((region) =>
          radius.regionIds.has(region.regionId),
        );
      }
      if (!selected.length) throw new Error("Select a market region first.");
      if (input.mode === "contracts") {
        const contractSummaries = [];
        for (let index = 0; index < selected.length; index += 1) {
          const region = selected[index];
          window?.webContents.send("market:progress", {
            mode: input.mode,
            regionName: `Contracts: ${region.name}`,
            regionsDone: index,
            regionsTotal: selected.length,
            pagesDone: index,
            pagesTotal: selected.length,
          });
          const publicContracts = await pullRegionContracts(
            region,
            allowedSystemIds,
          );
          await logEvent("info", "contracts.region_completed", {
            regionId: region.regionId,
            regionName: region.name,
            contracts: publicContracts.length,
            regionNumber: index + 1,
            regionTotal: selected.length,
          });
          contractSummaries.push({
            regionId: region.regionId,
            regionName: region.name,
            updatedAt: new Date().toISOString(),
            publicContracts,
          });
        }
        const storage = await saveMarketDataset("contracts", contractSummaries);
        await logEvent("info", "market_pull.completed", {
          mode: input.mode,
          regions: selected.length,
          durationMs: Date.now() - pullStartedAt,
          datasetPath: storage.path,
          snapshotsStored: storage.retained,
        });
        const stationDataset = await loadLatestMarketDatasetByMode("all");
        return {
          summaries: await loadMarketIndexHeaders(),
          storage,
        };
      }
      let regionsDone = 0;
      const existing = (
        input.mode === "single" ? await loadLatestMarketDataset() : []
      ) as Array<{ regionId: number }>;
      const summaryByRegion = new Map(
        existing.map((summary) => [summary.regionId, summary]),
      );
      for (const region of selected) {
        const summary = await pullRegionMarket(
          region,
          (pagesDone, pagesTotal) => {
            window?.webContents.send("market:progress", {
              mode: input.mode,
              regionName: region.name,
              regionsDone,
              regionsTotal: selected.length,
              pagesDone,
              pagesTotal,
            });
          },
          allowedSystemIds,
          rawSnapshot
            ? (orders) => saveRawMarketRegion(rawSnapshot, region, orders).then(() => undefined)
            : undefined,
        );
        summaryByRegion.set(summary.regionId, summary);
        regionsDone += 1;
        await logEvent("info", "market.region_completed", {
          regionId: region.regionId,
          regionName: region.name,
          orders: summary.orderCount,
          itemTypes: summary.uniqueTypes,
          pages: summary.pageCount,
          regionNumber: regionsDone,
          regionTotal: selected.length,
        });
        window?.webContents.send("market:progress", {
          mode: input.mode,
          regionName: region.name,
          regionsDone,
          regionsTotal: selected.length,
          pagesDone: summary.pageCount,
          pagesTotal: summary.pageCount,
        });
      }
      const summaries = Array.from(summaryByRegion.values()).sort((a, b) =>
        String((a as { regionName?: string }).regionName).localeCompare(
          String((b as { regionName?: string }).regionName),
        ),
      );
      const storage = await saveMarketDataset(input.mode, summaries);
      const rawStorage = rawSnapshot ? await completeRawMarketSnapshot(rawSnapshot) : null;
      await logEvent("info", "market_pull.completed", {
        mode: input.mode,
        regions: selected.length,
        durationMs: Date.now() - pullStartedAt,
        datasetPath: storage.path,
        snapshotsStored: storage.retained,
        rawOrderCount: rawStorage?.orderCount ?? 0,
        rawRegionCount: rawStorage?.regionCount ?? 0,
      });
      return {
        summaries: marketSummaryHeaders(summaries),
        storage: {
          ...storage,
          raw: rawStorage
            ? { root: RAW_MARKET_ROOT, snapshotId: rawStorage.id, orderCount: rawStorage.orderCount, regionCount: rawStorage.regionCount }
            : null,
        },
      };
    },
  );
  createWindow();
  window?.webContents.once("did-finish-load", () => {
    void readConfig().then(async (config) => {
      if (!Object.keys(config.encryptedRefreshTokens ?? {}).length) {
        await logEvent("info", "master_update.awaiting_first_characters", {});
        return;
      }
      if (await hasSyncedThisVersion()) {
        await logEvent("info", "master_update.already_synced_this_version", { version: app.getVersion() });
        return;
      }
      await runCompleteSync((progress) => window?.webContents.send("master:update-progress", progress), true, await readSyncPreparationOptions());
    }).catch((error) => logCrash("master_update.auto_start_failed", { error }));
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
  void logEvent("info", "app.window_all_closed");
  void disposeAnalysisWorker();
  void disposeFittingWorker();
  void stopMcpWriteBridge();
  if (process.platform !== "darwin") app.quit();
});
