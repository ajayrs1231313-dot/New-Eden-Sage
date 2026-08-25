import { parentPort } from "node:worker_threads";
import { buildWormholeStaticCache } from "./wormhole-reference";

void buildWormholeStaticCache()
  .then((cache) => parentPort?.postMessage({
    ok: true,
    result: {
      generatedAt: cache.generatedAt,
      referenceCount: cache.reference.length,
      systemCount: cache.systems.length,
      rollingTypeCount: cache.rollingTypes.length,
    },
  }))
  .catch((error) => parentPort?.postMessage({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  }));
