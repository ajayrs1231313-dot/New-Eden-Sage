import { parentPort } from "node:worker_threads";
import {
  buildFoundryAcquisitionGuide,
  buildFoundryT2ComponentGuides,
  type FoundryAcquisitionReach,
  type FoundryBaseMaterial,
} from "./foundry-material-acquisition";

const port = parentPort;
if (!port) throw new Error("Foundry material guide worker requires a parent port.");

type GuideWorkerMessage = {
  requestId: number;
  operation: "acquisition" | "t2";
  materials: FoundryBaseMaterial[];
  selectedReach?: FoundryAcquisitionReach;
};

port.on("message", (message: GuideWorkerMessage) => {
  const materials = Array.isArray(message.materials) ? message.materials : [];
  const work = message.operation === "t2"
    ? buildFoundryT2ComponentGuides(materials, message.selectedReach === "low" || message.selectedReach === "null" ? message.selectedReach : "high")
    : Promise.all(materials.map((material) => buildFoundryAcquisitionGuide(material)));

  void work
    .then((result) => port.postMessage({ type: "complete", requestId: message.requestId, result }))
    .catch((error) => port.postMessage({
      type: "error",
      requestId: message.requestId,
      error: error instanceof Error ? error.message : String(error),
    }));
});
