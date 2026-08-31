import { USER_DATA_ROOT } from "./data-paths";
import path from "node:path";
import { fork, type ChildProcess } from "node:child_process";
import { app } from "electron";
import type { SharedMarketSyncResult } from "./shared-market-data";

type PublicRefreshProgress = (message: string, completed?: number, total?: number) => void;

let activePublicRefreshProcess: ChildProcess | undefined;
let activePublicRefreshPromise: Promise<SharedMarketSyncResult> | undefined;

export function disposePublicDataRefreshProcess() {
  const child = activePublicRefreshProcess;
  activePublicRefreshProcess = undefined;
  activePublicRefreshPromise = undefined;
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  try { if (child.connected) child.disconnect(); } catch { /* already disconnected */ }
  try { child.kill(); } catch { /* already gone */ }
}

export function runPublicDataRefresh(onProgress?: PublicRefreshProgress): Promise<SharedMarketSyncResult> {
  if (activePublicRefreshPromise) return activePublicRefreshPromise;

  const promise = new Promise<SharedMarketSyncResult>((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = fork(path.join(__dirname, "public-data-refresh-process.js"), [], {
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: "1",
          NEW_EDEN_SAGE_USER_DATA: USER_DATA_ROOT,
        },
        stdio: ["ignore", "ignore", "pipe", "ipc"],
        execArgv: ["--max-old-space-size=2048"],
      });
    } catch (error) {
      reject(error);
      return;
    }

    activePublicRefreshProcess = child;
    let settled = false;
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr = `${stderr}${String(chunk)}`.slice(-4_000);
    });

    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      if (activePublicRefreshProcess === child) activePublicRefreshProcess = undefined;
      child.removeAllListeners("message");
      child.removeAllListeners("error");
      child.removeAllListeners("exit");
      try { if (child.connected) child.disconnect(); } catch { /* already disconnected */ }
      callback();
    };

    child.on("message", (message: any) => {
      if (message?.type === "progress") {
        onProgress?.(String(message.message ?? "Updating public data."), Number.isFinite(message.completed) ? Number(message.completed) : undefined, Number.isFinite(message.total) ? Number(message.total) : undefined);
        return;
      }
      if (message?.type === "complete" && message.result) {
        finish(() => resolve(message.result as SharedMarketSyncResult));
        return;
      }
      if (message?.type === "error") {
        finish(() => reject(new Error(String(message.error ?? "Public-data refresh worker failed."))));
      }
    });
    child.once("error", (error) => finish(() => reject(error)));
    child.once("exit", (code, signal) => {
      if (settled) return;
      const detail = stderr.trim() ? ` ${stderr.trim()}` : "";
      finish(() => reject(new Error(`Public-data refresh worker exited unexpectedly (${signal ?? code ?? "unknown"}).${detail}`)));
    });
  });

  activePublicRefreshPromise = promise.finally(() => {
    if (activePublicRefreshPromise) activePublicRefreshPromise = undefined;
  });
  return activePublicRefreshPromise;
}
