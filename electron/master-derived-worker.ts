import { parentPort, workerData } from "node:worker_threads";

type DerivedTask =
  | "fitting"
  | "market-static"
  | "full-market-index"
  | "regional-market-index"
  | "pve-static"
  | "industrial-static"
  | "readiness-static"
  | "routes";

type WorkerInput = { task: DerivedTask; workerCount?: number };
const input = workerData as WorkerInput;
const task = input.task;

async function run() {
  const startedAt = Date.now();
  parentPort?.postMessage({ type: "progress", task, message: `Preparing ${task}…` });
  let detail: unknown;
  switch (task) {
    case "fitting": {
      const { prepareFittingDataLocal } = await import("./fitting-dogma.js");
      detail = await prepareFittingDataLocal((progress: any) => parentPort?.postMessage({ type: "progress", task, message: progress.message, percent: progress.percent }));
      break;
    }
    case "market-static": {
      const { getMarketTaxonomy, getMarketSystemIndex, getMarketTypeIndex } = await import("./market-static-index.js");
      const [taxonomy, systems, types] = await Promise.all([getMarketTaxonomy(), getMarketSystemIndex(), getMarketTypeIndex()]);
      detail = { categories: taxonomy.categories.length, groups: taxonomy.groups.length, systems: systems.size, types: types.size };
      break;
    }
    case "full-market-index": {
      // Reliability baseline: this path is proven on the full 1.5m-order
      // snapshot. Parallel partitioning remains experimental until its memory
      // envelope is independently verified for the largest market regions.
      const { buildFullMarketAnalysisIndex } = await import("./raw-market-analysis.js");
      const value = await buildFullMarketAnalysisIndex(undefined, { progress: (progress: any) => parentPort?.postMessage({ type: "progress", task, message: progress.message, percent: progress.percent }) });
      const { buildRegionalMarketAggregateIndexFromFull } = await import("./regional-market-index.js");
      const regional = await buildRegionalMarketAggregateIndexFromFull(value, { progress: (progress: any) => parentPort?.postMessage({ type: "progress", task, message: progress.message, percent: progress.percent }) });
      detail = { orders: value.sourceOrdersInspected, items: value.items.size, regions: value.regionCount, regionalRows: regional.rows.length };
      break;
    }
    case "regional-market-index": {
      const { buildRegionalMarketAggregateIndex } = await import("./regional-market-index.js");
      const value = await buildRegionalMarketAggregateIndex({ progress: (progress: any) => parentPort?.postMessage({ type: "progress", task, message: progress.message, percent: progress.percent }) }, input.workerCount ?? 1);
      detail = { rows: value.rows.length, regions: value.regionCount };
      break;
    }
    case "pve-static": {
      const { getPveStaticIndex } = await import("./pve-static-index.js");
      const value = await getPveStaticIndex();
      detail = { systems: value.systems.size, missionStaging: value.missionStaging.length };
      break;
    }
    case "industrial-static": {
      const { prepareIndustrialDataLocal } = await import("./industrial-engine.js");
      detail = await prepareIndustrialDataLocal();
      break;
    }
    case "readiness-static": {
      const { prepareReadinessStaticData } = await import("./readiness.js");
      detail = await prepareReadinessStaticData();
      break;
    }
    case "routes": {
      const { prepareHighSecRouteGraph } = await import("./route-graph.js");
      const { prepareUniverseRouteGraph } = await import("./universe-route-graph.js");
      const [highSec, universe] = await Promise.all([prepareHighSecRouteGraph(), prepareUniverseRouteGraph()]);
      detail = { highSec, universe };
      break;
    }
    default:
      throw new Error(`Unknown master-update task: ${String(task)}`);
  }
  return { task, durationMs: Date.now() - startedAt, detail };
}

void run()
  .then((result) => parentPort?.postMessage({ type: "complete", result }))
  .catch((error) => parentPort?.postMessage({ type: "error", task, error: error instanceof Error ? error.message : String(error) }));
