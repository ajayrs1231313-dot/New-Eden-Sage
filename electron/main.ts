import nodeFs from "node:fs";
import os from "node:os";
import path from "node:path";
import { app, crashReporter, ipcMain } from "electron";
import { LOG_ROOT, installProcessErrorLogging, logCrash, logEvent } from "./logger";

const MCP_MODE = process.argv.includes("--mcp");
const DESKTOP_SINGLE_INSTANCE_LOCK = MCP_MODE ? true : app.requestSingleInstanceLock();
(globalThis as typeof globalThis & { __sageSingleInstanceLockHeld?: boolean }).__sageSingleInstanceLockHeld = DESKTOP_SINGLE_INSTANCE_LOCK;

const DEV_RUNTIME_USER_DATA = process.argv.includes("--dev")
  ? process.env.NEW_EDEN_SAGE_USER_DATA?.trim()
  : undefined;
if (DESKTOP_SINGLE_INSTANCE_LOCK && DEV_RUNTIME_USER_DATA) {
  const chromiumProfile = app.getPath("userData");
  app.setPath("sessionData", chromiumProfile);
}

if (!DESKTOP_SINGLE_INSTANCE_LOCK) app.quit();

const HEARTBEAT_FILE = path.join(LOG_ROOT, `electron-heartbeat-${process.pid}.json`);
const HEALTH_LOG_FILE = path.join(LOG_ROOT, "electron-health.jsonl");
let rendererHeartbeatAt = 0;
let rendererHeartbeat: Record<string, unknown> | null = null;
let healthRecorderRunning = false;

try {
  crashReporter.start({
    uploadToServer: false,
    productName: "New Eden Sage",
    extra: { appVersion: app.getVersion(), channel: process.argv.includes("--dev") ? "dev" : "desktop" },
  });
} catch (error) {
  logCrash("crash_reporter.start_failed", { error });
}

installProcessErrorLogging("electron-main");

ipcMain.on("diagnostics:renderer-heartbeat", (_event, report) => {
  rendererHeartbeatAt = Date.now();
  rendererHeartbeat = report && typeof report === "object" ? report as Record<string, unknown> : null;
});

async function writeHealthSample() {
  if (healthRecorderRunning || !app.isReady()) return;
  healthRecorderRunning = true;
  try {
    const processMemory = await process.getProcessMemoryInfo();
    const sample = {
      timestamp: new Date().toISOString(),
      mainPid: process.pid,
      argv: process.argv.slice(0, 3),
      processMemory,
      systemMemory: { freeBytes: os.freemem(), totalBytes: os.totalmem() },
      rendererHeartbeatAgeMs: rendererHeartbeatAt ? Date.now() - rendererHeartbeatAt : null,
      rendererHeartbeat,
      gpuFeatureStatus: app.getGPUFeatureStatus(),
      appMetrics: app.getAppMetrics(),
      crashDumpsPath: app.getPath("crashDumps"),
    };
    nodeFs.mkdirSync(LOG_ROOT, { recursive: true });
    const temp = `${HEARTBEAT_FILE}.${process.pid}.tmp`;
    nodeFs.writeFileSync(temp, JSON.stringify(sample), "utf8");
    nodeFs.renameSync(temp, HEARTBEAT_FILE);
    nodeFs.appendFileSync(HEALTH_LOG_FILE, `${JSON.stringify(sample)}\n`, "utf8");
  } catch (error) {
    void logEvent("warn", "diagnostics.health_sample_failed", { error });
  } finally {
    healthRecorderRunning = false;
  }
}

app.whenReady().then(() => {
  void logEvent("info", "diagnostics.crash_monitor_ready", {
    heartbeatFile: HEARTBEAT_FILE,
    healthLogFile: HEALTH_LOG_FILE,
    crashDumpsPath: app.getPath("crashDumps"),
  });
  void app.getGPUInfo("complete").then((gpuInfo) => logEvent("info", "diagnostics.gpu_info", { gpuInfo })).catch((error) => logEvent("warn", "diagnostics.gpu_info_failed", { error }));
  void writeHealthSample();
  const timer = setInterval(() => void writeHealthSample(), 5000);
  timer.unref();
});

app.on("render-process-gone", (_event, webContents, details) => {
  logCrash("renderer.process_gone", { webContentsId: webContents.id, reason: details.reason, exitCode: details.exitCode, url: webContents.getURL() });
  void logEvent("error", "renderer.process_gone", {
    webContentsId: webContents.id,
    reason: details.reason,
    exitCode: details.exitCode,
  });
});

app.on("child-process-gone", (_event, details) => {
  logCrash("electron.child_process_gone", { type: details.type, reason: details.reason, exitCode: details.exitCode, serviceName: details.serviceName, name: details.name });
  void logEvent("error", "electron.child_process_gone", {
    type: details.type,
    reason: details.reason,
    exitCode: details.exitCode,
    serviceName: details.serviceName,
    name: details.name,
  });
});

app.on("web-contents-created", (_event, contents) => {
  contents.on("unresponsive", () => {
    logCrash("renderer.unresponsive", { webContentsId: contents.id, url: contents.getURL() });
    void logEvent("error", "renderer.unresponsive", {
      webContentsId: contents.id,
      url: contents.getURL(),
    });
  });

  contents.on("did-fail-load", (_loadEvent, errorCode, errorDescription, validatedURL, isMainFrame) => {
    void logEvent("error", "renderer.did_fail_load", {
      webContentsId: contents.id,
      errorCode,
      errorDescription,
      validatedURL,
      isMainFrame,
    });
  });
});

if (!DESKTOP_SINGLE_INSTANCE_LOCK) {
  // The existing desktop instance receives Electron's second-instance event.
} else if (MCP_MODE) {
  void app.whenReady().then(async () => {
    const { startMcpServer } = await import("./mcp-server.js");
    await startMcpServer();
  });
} else {
  void import("./market-intelligence-ipc.js");
  void import("./system-intelligence-ipc.js");
  void import("./navigation-command-ipc.js");
  void import("./main-task9.js");
}
