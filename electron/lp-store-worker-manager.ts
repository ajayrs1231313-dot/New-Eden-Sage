import path from "node:path";
import { Worker } from "node:worker_threads";
import { USER_DATA_ROOT } from "./data-paths";
import { logEvent } from "./logger";
import type { LpCorporationAnalysis, LpEarningCandidate } from "./lp-store";

type LpWorkerOperation = "corporations" | "offers" | "earning-candidates" | "status";
type PendingRequest = { resolve(value: unknown): void; reject(error: Error): void; key: string };

type LpWorkerStatus = {
  state: "cold" | "warming" | "ready" | "busy" | "error" | "stopped";
  message: string;
  workerStarts: number;
  completedRequests: number;
  warmStartedAt: number | null;
  warmCompletedAt: number | null;
  lastOperation: LpWorkerOperation | null;
  updatedAt: number;
};

let worker: Worker | null = null;
let nextRequestId = 1;
let workerStarts = 0;
const pending = new Map<number, PendingRequest>();
const inFlightByKey = new Map<string, Promise<unknown>>();
const intentionallyStopped = new WeakSet<Worker>();
let status: LpWorkerStatus = {
  state: "cold",
  message: "LP Store background worker has not started.",
  workerStarts: 0,
  completedRequests: 0,
  warmStartedAt: null,
  warmCompletedAt: null,
  lastOperation: null,
  updatedAt: Date.now(),
};

function rejectAll(error: Error) {
  for (const request of pending.values()) request.reject(error);
  pending.clear();
  inFlightByKey.clear();
}

function updateStatus(message: any) {
  status = {
    state: message?.state ?? status.state,
    message: String(message?.message ?? status.message),
    workerStarts,
    completedRequests: Number(message?.completedRequests ?? status.completedRequests),
    warmStartedAt: Number.isFinite(Number(message?.warmStartedAt)) ? Number(message.warmStartedAt) : status.warmStartedAt,
    warmCompletedAt: Number.isFinite(Number(message?.warmCompletedAt)) ? Number(message.warmCompletedAt) : status.warmCompletedAt,
    lastOperation: message?.lastOperation ?? status.lastOperation,
    updatedAt: Number(message?.at ?? Date.now()),
  };
}

function startWorker() {
  if (worker) return worker;
  const instance = new Worker(path.join(__dirname, "lp-store-worker.js"), {
    name: "new-eden-sage-lp-store",
    env: { ...process.env, NEW_EDEN_SAGE_USER_DATA: USER_DATA_ROOT },
    resourceLimits: { maxOldGenerationSizeMb: 1024, maxYoungGenerationSizeMb: 64 },
  });
  worker = instance;
  workerStarts += 1;
  status = {
    ...status,
    state: "warming",
    message: "Starting LP Store background worker.",
    workerStarts,
    updatedAt: Date.now(),
  };

  instance.on("message", (message: any) => {
    if (message?.type === "state") {
      updateStatus(message);
      return;
    }
    const requestId = Number(message?.requestId);
    const request = pending.get(requestId);
    if (!request) return;
    pending.delete(requestId);
    if (message?.type === "error") {
      request.reject(new Error(String(message.error ?? "LP Store background task failed.")));
      return;
    }
    request.resolve(message?.result);
  });

  instance.on("error", (error: unknown) => {
    if (worker === instance) worker = null;
    const normalized = error instanceof Error ? error : new Error(String(error));
    status = { ...status, state: "error", message: normalized.message, updatedAt: Date.now() };
    void logEvent("error", "lp_store.worker_error", { error: normalized });
    rejectAll(normalized);
  });

  instance.on("exit", (code) => {
    const deliberate = intentionallyStopped.has(instance);
    intentionallyStopped.delete(instance);
    if (worker === instance) worker = null;
    if (deliberate) {
      status = { ...status, state: "stopped", message: "LP Store background worker stopped.", updatedAt: Date.now() };
      return;
    }
    if (code !== 0) {
      const error = new Error(`LP Store background worker exited with code ${code}.`);
      status = { ...status, state: "error", message: error.message, updatedAt: Date.now() };
      void logEvent("warn", "lp_store.worker_exit", { code });
      rejectAll(error);
    } else {
      status = { ...status, state: "stopped", message: "LP Store background worker stopped.", updatedAt: Date.now() };
    }
  });

  return instance;
}

function requestKey(operation: LpWorkerOperation, input: any) {
  if (operation === "offers") return `offers:${Number(input?.corporationId)}:${Number(input?.marketRevision) || 0}`;
  if (operation === "corporations") {
    const ids = (Array.isArray(input?.corporationIds) ? input.corporationIds : []).map(Number).filter((id: number) => id > 0).sort((a: number, b: number) => a - b);
    return `corporations:${ids.join(",")}`;
  }
  if (operation === "earning-candidates") return `earning:${JSON.stringify(input ?? {})}`;
  return "status";
}

function runLpWorker<T>(operation: LpWorkerOperation, input?: unknown): Promise<T> {
  const key = requestKey(operation, input);
  const existing = inFlightByKey.get(key);
  if (existing) return existing as Promise<T>;

  const requestId = nextRequestId++;
  const instance = startWorker();
  const promise = new Promise<T>((resolve, reject) => {
    pending.set(requestId, { resolve: (value) => resolve(value as T), reject, key });
    instance.postMessage({ requestId, operation, input });
  }).finally(() => {
    if (inFlightByKey.get(key) === promise) inFlightByKey.delete(key);
  });
  inFlightByKey.set(key, promise);
  return promise;
}

export function resolveLpCorporations(corporationIds: number[]) {
  return runLpWorker<Array<{ corporationId: number; corporationName: string }>>("corporations", { corporationIds });
}

export function analyzeLpCorporation(corporationId: number, marketRevision = 0) {
  return runLpWorker<LpCorporationAnalysis>("offers", { corporationId, marketRevision });
}

export function getLpEarningCandidates(standings: unknown, currentCorporationIds: unknown) {
  return runLpWorker<LpEarningCandidate[]>("earning-candidates", { standings, currentCorporationIds });
}

export function getLpStoreWorkerStatus() {
  return { ...status, pendingRequests: pending.size, inFlightKeys: inFlightByKey.size };
}

export async function disposeLpStoreWorker() {
  const instance = worker;
  worker = null;
  if (!instance) {
    status = { ...status, state: "stopped", message: "LP Store background worker stopped.", updatedAt: Date.now() };
    return;
  }
  rejectAll(new Error("LP Store background worker stopped."));
  intentionallyStopped.add(instance);
  await instance.terminate().catch(() => undefined);
  status = { ...status, state: "stopped", message: "LP Store background worker stopped.", updatedAt: Date.now() };
}
