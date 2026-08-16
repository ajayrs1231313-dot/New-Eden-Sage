import { app } from "electron";
import { installProcessErrorLogging, logCrash, logEvent } from "./logger";

installProcessErrorLogging("electron-main");

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

if (process.argv.includes("--mcp")) {
  void app.whenReady().then(async () => {
    const { startMcpServer } = await import("./mcp-server.js");
    await startMcpServer();
  });
} else {
  void import("./market-intelligence-ipc.js");
  void import("./main-task9.js");
}
