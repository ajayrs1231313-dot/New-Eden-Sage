import { parentPort } from "node:worker_threads";
import { loadInstalledSharedMarketManifestFresh } from "./shared-market-data";
import {
  analyzeLpCorporation,
  getLpEarningCandidates,
  invalidateLpStoreMarketData,
  resolveLpCorporations,
  warmLpStoreStaticData,
} from "./lp-store";

type LpWorkerOperation = "corporations" | "offers" | "earning-candidates" | "status";

type LpWorkerRequest = {
  requestId: number;
  operation: LpWorkerOperation;
  input?: any;
};

if (!parentPort) throw new Error("LP Store worker requires a parent port.");

let activeRequestId: number | null = null;
let completedRequests = 0;
let warmStartedAt = Date.now();
let warmCompletedAt: number | null = null;
let lastOperation: LpWorkerOperation | null = null;
let marketGeneration: string | null = null;
let queue: Promise<void> = Promise.resolve();

function postState(state: "warming" | "ready" | "busy" | "error", message: string, requestId?: number) {
  parentPort!.postMessage({
    type: "state",
    state,
    message,
    requestId: requestId ?? activeRequestId,
    completedRequests,
    warmStartedAt,
    warmCompletedAt,
    lastOperation,
    at: Date.now(),
  });
}

const warmPromise = (async () => {
  postState("warming", "Preparing LP Store static relationships in the background.");
  await warmLpStoreStaticData();
  warmCompletedAt = Date.now();
  postState("ready", "LP Store background data is warm.");
})().catch((error) => {
  postState("error", error instanceof Error ? error.message : String(error));
  throw error;
});

async function handle(message: LpWorkerRequest) {
  const requestId = Number(message?.requestId);
  if (!Number.isSafeInteger(requestId) || requestId <= 0) return;
  activeRequestId = requestId;
  lastOperation = message.operation;
  try {
    await warmPromise;
    postState("busy", message.operation === "offers" ? "Pricing LP offers in the background." : "Preparing LP Store data in the background.", requestId);
    let result: unknown;
    if (message.operation === "corporations") {
      result = await resolveLpCorporations(Array.isArray(message.input?.corporationIds) ? message.input.corporationIds : []);
    } else if (message.operation === "offers") {
      const installedManifest = await loadInstalledSharedMarketManifestFresh();
      const requestedGeneration = installedManifest?.generation ?? "no-shared-market";
      if (marketGeneration != null && requestedGeneration !== marketGeneration) invalidateLpStoreMarketData();
      marketGeneration = requestedGeneration;
      result = await analyzeLpCorporation(Number(message.input?.corporationId), requestedGeneration);
    } else if (message.operation === "earning-candidates") {
      result = await getLpEarningCandidates(message.input?.standings, message.input?.currentCorporationIds);
    } else {
      result = {
        state: warmCompletedAt ? "ready" : "warming",
        completedRequests,
        warmStartedAt,
        warmCompletedAt,
        lastOperation,
      };
    }
    completedRequests += 1;
    postState("ready", "LP Store background worker is ready.", requestId);
    parentPort!.postMessage({ type: "result", requestId, result });
  } catch (error) {
    parentPort!.postMessage({
      type: "error",
      requestId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    postState("error", error instanceof Error ? error.message : String(error), requestId);
  } finally {
    if (activeRequestId === requestId) activeRequestId = null;
  }
}

parentPort.on("message", (message: LpWorkerRequest) => {
  // Serialize LP jobs in one resident worker. This prevents duplicate full
  // market/static builds while preserving the worker's warm module caches.
  queue = queue.then(() => handle(message), () => handle(message));
});
