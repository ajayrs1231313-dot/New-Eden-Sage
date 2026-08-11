import path from "node:path";
import { Worker } from "node:worker_threads";
import { logEvent } from "./logger";

type FittingWorkerOperation =
  | "prepare"
  | "compatible-items"
  | "charges-for-fit"
  | "catalogue"
  | "hull-profile"
  | "mutation-options"
  | "charge-compatibility"
  | "item-compatibility"
  | "remedies"
  | "type-info"
  | "resolve-types"
  | "search-types"
  | "analyze";

type PendingRequest = {
  resolve(value: unknown): void;
  reject(error: Error): void;
  onProgress?: (progress: unknown) => void;
};

let worker: Worker | null = null;
let nextRequestId = 1;
const pending = new Map<number, PendingRequest>();

function rejectAll(error: Error) {
  for (const request of pending.values()) request.reject(error);
  pending.clear();
}

function startWorker() {
  if (worker) return worker;
  const instance = new Worker(path.join(__dirname, "fitting-worker.js"));
  worker = instance;

  instance.on("message", (message: any) => {
    const requestId = Number(message?.requestId);
    const request = pending.get(requestId);
    if (!request) return;
    if (message?.type === "progress") {
      request.onProgress?.(message.progress);
      return;
    }
    pending.delete(requestId);
    if (message?.type === "error") {
      request.reject(new Error(String(message.error ?? "Fitting background task failed.")));
      return;
    }
    request.resolve(message?.result);
  });

  instance.on("error", (error) => {
    void logEvent("error", "fitting.worker_error", { error });
    rejectAll(error instanceof Error ? error : new Error(String(error)));
  });

  instance.on("exit", (code) => {
    if (worker === instance) worker = null;
    if (code !== 0) {
      const error = new Error(`Fitting background worker exited with code ${code}.`);
      void logEvent("warn", "fitting.worker_exit", { code });
      rejectAll(error);
    }
  });

  return instance;
}

export function runFittingWorker<T = unknown>(operation: FittingWorkerOperation, input?: unknown, onProgress?: (progress: unknown) => void): Promise<T> {
  const requestId = nextRequestId++;
  const instance = startWorker();
  return new Promise<T>((resolve, reject) => {
    pending.set(requestId, {
      resolve: (value) => resolve(value as T),
      reject,
      onProgress,
    });
    instance.postMessage({ requestId, operation, input });
  });
}

export async function disposeFittingWorker() {
  const instance = worker;
  worker = null;
  if (!instance) return;
  rejectAll(new Error("Fitting background worker stopped."));
  await instance.terminate().catch(() => undefined);
}
