import path from "node:path";
import { availableParallelism } from "node:os";
import { parentPort, Worker, workerData } from "node:worker_threads";
import { listRegions, type RegionInfo } from "./market";
import {
  beginRawMarketSnapshot,
  completeRawMarketSnapshot,
  type RawMarketSnapshot,
  type RawRegionEntry,
} from "./raw-market-storage";
import { saveMarketDataset } from "./market-storage";

type WorkerInput = { workerCount?: number };
type RegionResult = { summary: any; rawEntry: RawRegionEntry };
const requestedWorkers = Math.max(1, Number((workerData as WorkerInput | undefined)?.workerCount ?? availableParallelism()));

function runRegion(worker: Worker, jobId: number, region: RegionInfo, rawSnapshot: RawMarketSnapshot) {
  return new Promise<RegionResult>((resolve, reject) => {
    let timeout: NodeJS.Timeout | undefined;
    const onMessage = (message: any) => {
      if (message?.jobId !== jobId) return;
      if (message.type === "progress") {
        parentPort?.postMessage(message);
        return;
      }
      cleanup();
      if (message.type === "result") resolve({ summary: message.summary, rawEntry: message.rawEntry });
      else reject(new Error(message.error ?? `Market worker failed for ${region.name}.`));
    };
    const onError = (error: Error) => { cleanup(); reject(error); };
    const onExit = (code: number) => {
      cleanup();
      reject(new Error(
        code === 0
          ? `Market region worker exited cleanly before returning ${region.name}.`
          : `Market region worker exited (${code}) while updating ${region.name}.`,
      ));
    };
    const cleanup = () => {
      if (timeout) clearTimeout(timeout);
      worker.off("message", onMessage);
      worker.off("error", onError);
      worker.off("exit", onExit);
    };
    worker.on("message", onMessage);
    worker.once("error", onError);
    worker.once("exit", onExit);
    timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Market region ${region.name} timed out after 5 minutes.`));
    }, 5 * 60_000);
    timeout.unref();
    worker.postMessage({ jobId, region, rawSnapshot });
  });
}

async function run() {
  const startedAt = Date.now();
  const regions = await listRegions();
  const rawSnapshot = await beginRawMarketSnapshot("all");
  const summaries = new Array<any>(regions.length);
  const rawEntries = new Array<RawRegionEntry>(regions.length);
  let cursor = 0;
  let completed = 0;
  const workerCount = Math.min(Math.max(1, requestedWorkers), Math.max(1, regions.length));
  parentPort?.postMessage({ type: "market-start", regionCount: regions.length, workerCount });

  const slots = Array.from({ length: workerCount }, async (_, slot) => {
    const worker = new Worker(path.join(__dirname, "master-market-region-worker.js"), {
      name: `sage-master-market-${slot + 1}`,
      env: process.env,
    });
    try {
      while (true) {
        const index = cursor++;
        if (index >= regions.length) break;
        const region = regions[index];
        const result = await runRegion(worker, index + 1, region, rawSnapshot);
        summaries[index] = result.summary;
        rawEntries[index] = result.rawEntry;
        completed += 1;
        parentPort?.postMessage({
          type: "region-complete",
          regionId: region.regionId,
          regionName: region.name,
          completed,
          total: regions.length,
          percent: Math.round((completed / Math.max(1, regions.length)) * 100),
        });
      }
    } finally {
      await worker.terminate().catch(() => undefined);
    }
  });
  await Promise.all(slots);

  rawSnapshot.regions = rawEntries.filter(Boolean);
  rawSnapshot.regionCount = rawSnapshot.regions.length;
  rawSnapshot.orderCount = rawSnapshot.regions.reduce((sum, item) => sum + item.orderCount, 0);
  const rawStorage = await completeRawMarketSnapshot(rawSnapshot);
  const storage = await saveMarketDataset("all", summaries.filter(Boolean));
  return {
    regions: regions.length,
    workerCount,
    durationMs: Date.now() - startedAt,
    rawOrderCount: rawStorage.orderCount,
    rawRegionCount: rawStorage.regionCount,
    storage,
  };
}

void run()
  .then((result) => parentPort?.postMessage({ type: "complete", result }))
  .catch((error) => parentPort?.postMessage({ type: "fatal", error: error instanceof Error ? error.message : String(error) }));
