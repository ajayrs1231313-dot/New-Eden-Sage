import { getSnapshot } from "./database";
import { analyzeInventionOpportunities, prepareIndustrialDataLocal } from "./industrial-engine";
import { prepareIndustrialCommand } from "./industrial-preparation";
import { savePersistedResult } from "./persistent-result-cache";
import { prepareRefineryStaticDataLocal } from "./refinery-engine";
import { analyzeShipReadiness } from "./readiness";

type FeaturePrepInput =
  | { task: "industry" }
  | { task: "refinery" }
  | { task: "industrial-command"; characterId: string }
  | { task: "invention"; characterId: string; decryptorTypeId?: number | null; cacheKey: unknown }
  | { task: "ship-readiness"; characterId: string; hullTypeId: number; cloneState: "alpha" | "omega"; masteryLevel: number; cacheKey: unknown };

function send(message: unknown) {
  process.send?.(message);
}

function sendAndExit(message: unknown) {
  if (typeof process.send !== "function") {
    process.exitCode = 1;
    return;
  }
  process.send(message, () => {
    if (process.connected) process.disconnect?.();
  });
}

async function main(input: FeaturePrepInput) {
  if (!input?.task) throw new Error("Feature preparation task is missing.");

  if (input.task === "industry") {
    send({ type: "progress", percent: 10, message: "Preparing industrial blueprint data." });
    const result = await prepareIndustrialDataLocal();
    sendAndExit({ type: "complete", result });
    return;
  }

  if (input.task === "refinery") {
    send({ type: "progress", percent: 5, message: "Preparing versioned refinery static cache." });
    const result = await prepareRefineryStaticDataLocal();
    send({ type: "progress", percent: 100, message: `Refinery cache ready (${result.refinableTypes.toLocaleString()} refinable types).` });
    sendAndExit({ type: "complete", result });
    return;
  }

  if (input.task === "industrial-command") {
    const result = await prepareIndustrialCommand(input.characterId, (percent, message) => {
      send({ type: "progress", percent, message });
    });
    sendAndExit({ type: "complete", result });
    return;
  }

  const snapshot = getSnapshot(input.characterId) as any;
  if (!snapshot) throw new Error("The selected character snapshot is not available.");

  if (input.task === "invention") {
    send({ type: "progress", percent: 10, message: "Pricing invention routes against the retained market." });
    const result = await analyzeInventionOpportunities({ snapshot, decryptorTypeId: input.decryptorTypeId ?? null });
    await savePersistedResult("industry-invention-opportunities", input.cacheKey, result);
    sendAndExit({
      type: "complete",
      result: { candidateCount: result.candidateCount, ownedSourceCount: result.ownedSourceCount, schema: result.schema },
    });
    return;
  }

  send({ type: "progress", percent: 15, message: "Preparing current-ship progression readiness." });
  const result = await analyzeShipReadiness(snapshot, input.hullTypeId, input.cloneState, input.masteryLevel);
  await savePersistedResult("ship-readiness", input.cacheKey, result);
  sendAndExit({ type: "complete", result: { readinessPercent: result.readinessPercent } });
}

process.once("message", (message) => {
  void main(message as FeaturePrepInput).catch((error) => {
    sendAndExit({ type: "error", error: error instanceof Error ? error.message : String(error) });
  });
});
