import { parentPort, workerData } from "node:worker_threads";
import { analyzeCapabilities, analyzeCurrentShipUse } from "./capability-engine";
import type { CloneState } from "./skill-training";

type PveReadinessWorkerInput = {
  task: "capabilities" | "current-ship";
  snapshot: any;
  cloneState: CloneState;
};

async function main() {
  const input = workerData as PveReadinessWorkerInput;
  if (!input?.task) throw new Error("PvE readiness worker task is missing.");
  const result = input.task === "capabilities"
    ? await analyzeCapabilities(input.snapshot, input.cloneState)
    : await analyzeCurrentShipUse(input.snapshot, "pve-combat", input.cloneState);
  parentPort?.postMessage({ type: "result", result });
}

void main().catch((error) => {
  parentPort?.postMessage({
    type: "error",
    error: error instanceof Error ? error.message : String(error),
  });
});
