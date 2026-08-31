import { USER_DATA_ROOT } from "./data-paths";
import { app } from "electron";
import { fork, type ChildProcess } from "node:child_process";
import path from "node:path";
import { randomUUID } from "node:crypto";

type Pending = {
  resolve(value: any): void;
  reject(error: Error): void;
  onProgress?: (progress: { percent?: number; message?: string }) => void;
  timeout: NodeJS.Timeout;
};

let worker: ChildProcess | null = null;
let starting: Promise<ChildProcess> | null = null;
const pending = new Map<string, Pending>();

function rejectPending(reason: string) {
  for (const request of pending.values()) {
    clearTimeout(request.timeout);
    request.reject(new Error(reason));
  }
  pending.clear();
}

function wireWorker(child: ChildProcess) {
  child.on("message", (message: any) => {
    const id = String(message?.id ?? "");
    if (!id) return;
    const request = pending.get(id);
    if (!request) return;
    if (message?.type === "progress") {
      request.onProgress?.({ percent: message.percent, message: message.message });
      return;
    }
    if (message?.type !== "result" && message?.type !== "error") return;
    pending.delete(id);
    clearTimeout(request.timeout);
    if (message.type === "error") request.reject(new Error(String(message.error ?? "Contract intelligence failed.")));
    else request.resolve(message.result);
  });
  child.on("error", (error) => {
    if (worker === child) worker = null;
    rejectPending(`Contract data preparation failed: ${error.message}`);
  });
  child.on("exit", (code, signal) => {
    if (worker === child) worker = null;
    rejectPending(`Contract data preparation stopped unexpectedly (${signal ?? code ?? "unknown"}).`);
  });
  return child;
}

async function ensureWorker() {
  if (worker?.connected && worker.exitCode == null) return worker;
  if (starting) return starting;
  starting = Promise.resolve().then(() => {
    const child = fork(path.join(__dirname, "contract-intelligence-process.js"), [], {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        NEW_EDEN_SAGE_USER_DATA: USER_DATA_ROOT,
      },
      stdio: ["ignore", "ignore", "pipe", "ipc"],
      execArgv: ["--max-old-space-size=1536"],
    });
    worker = wireWorker(child);
    child.stderr?.on("data", () => undefined);
    return child;
  }).finally(() => { starting = null; });
  return starting;
}

async function request<T>(type: "workspace" | "search", payload: Record<string, unknown> = {}, onProgress?: Pending["onProgress"]): Promise<T> {
  const child = await ensureWorker();
  const id = randomUUID();
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error("Contract data preparation timed out after 2 minutes."));
    }, 120_000);
    timeout.unref();
    pending.set(id, { resolve, reject, onProgress, timeout });
    try {
      child.send({ id, type, ...payload }, (error) => {
        if (!error) return;
        const current = pending.get(id);
        if (!current) return;
        pending.delete(id);
        clearTimeout(current.timeout);
        current.reject(error);
      });
    } catch (error) {
      pending.delete(id);
      clearTimeout(timeout);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

export function getContractMarketWorkspace(onProgress?: Pending["onProgress"]) {
  return request<any>("workspace", {}, onProgress);
}

export function searchContractMarketWorkspace(query: unknown) {
  return request<any>("search", { query });
}

export function disposeContractIntelligenceProcess() {
  const child = worker;
  worker = null;
  rejectPending("Contract data preparation stopped.");
  if (!child) return;
  try { if (child.connected) child.disconnect(); } catch { /* already closing */ }
  if (child.exitCode == null && child.signalCode == null) child.kill();
}
