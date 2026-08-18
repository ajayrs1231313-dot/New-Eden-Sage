import { parentPort, workerData } from "node:worker_threads";
import { analyzeInventionOpportunities, prepareIndustrialDataLocal } from "./industrial-engine";
import { analyzeShipReadiness } from "./readiness";
import { savePersistedResult } from "./persistent-result-cache";

type FeaturePrepInput =
  | { task: "industry" }
  | { task: "invention"; snapshot: any; decryptorTypeId?: number | null; cacheKey: unknown }
  | { task: "ship-readiness"; snapshot: any; hullTypeId: number; cloneState: "alpha" | "omega"; masteryLevel: number; cacheKey: unknown };

async function main() {
  const input = workerData as FeaturePrepInput;
  if (!input?.task) throw new Error("Feature preparation task is missing.");

  if (input.task === "industry") {
    parentPort?.postMessage({ type: "progress", percent: 10, message: "Preparing industrial blueprint data." });
    const result = await prepareIndustrialDataLocal();
    parentPort?.postMessage({ type: "complete", result });
    return;
  }

  if (input.task === "invention") {
    parentPort?.postMessage({ type: "progress", percent: 10, message: "Pricing invention routes against the retained market." });
    const result = await analyzeInventionOpportunities({ snapshot: input.snapshot, decryptorTypeId: input.decryptorTypeId ?? null });
    await savePersistedResult("industry-invention-opportunities", input.cacheKey, result);
    parentPort?.postMessage({
      type: "complete",
      result: { candidateCount: result.candidateCount, ownedSourceCount: result.ownedSourceCount, schema: result.schema },
    });
    return;
  }

  parentPort?.postMessage({ type: "progress", percent: 15, message: "Preparing current-ship progression readiness." });
  const result = await analyzeShipReadiness(input.snapshot, input.hullTypeId, input.cloneState, input.masteryLevel);
  await savePersistedResult("ship-readiness", input.cacheKey, result);
  parentPort?.postMessage({ type: "complete", result: { readinessPercent: result.readinessPercent } });
}

void main().catch((error) => {
  parentPort?.postMessage({ type: "error", error: error instanceof Error ? error.message : String(error) });
});
