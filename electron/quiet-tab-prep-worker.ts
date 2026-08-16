import { parentPort } from "node:worker_threads";

void import("./industrial-engine.js").then(({ prepareIndustrialDataLocal }) => prepareIndustrialDataLocal()).then((industrial) => {
  parentPort?.postMessage({ type: "complete", industrial });
}).catch((error) => {
  parentPort?.postMessage({ type: "error", error: error instanceof Error ? error.message : String(error) });
});
