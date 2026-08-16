import { parentPort } from "node:worker_threads";
import { pullRegionMarket, type RegionInfo } from "./market";
import { saveRawMarketRegionDetached, type RawMarketSnapshot } from "./raw-market-storage";

type RegionJob = {
  jobId: number;
  region: RegionInfo;
  rawSnapshot: RawMarketSnapshot;
};

if (!parentPort) throw new Error("Master market region worker requires a parent port.");

parentPort.on("message", (job: RegionJob) => {
  void (async () => {
    try {
      let rawEntry: Awaited<ReturnType<typeof saveRawMarketRegionDetached>> | null = null;
      const summary = await pullRegionMarket(
        job.region,
        (pagesDone, pagesTotal) => parentPort?.postMessage({
          type: "progress",
          jobId: job.jobId,
          regionId: job.region.regionId,
          regionName: job.region.name,
          pagesDone,
          pagesTotal,
        }),
        undefined,
        async (orders) => {
          rawEntry = await saveRawMarketRegionDetached(job.rawSnapshot, job.region, orders);
        },
      );
      parentPort?.postMessage({ type: "result", jobId: job.jobId, summary, rawEntry });
    } catch (error) {
      parentPort?.postMessage({
        type: "error",
        jobId: job.jobId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  })();
});
