import { promises as fs } from "node:fs";
import path from "node:path";
import { gzip } from "node:zlib";
import { promisify } from "node:util";
import { parentPort, workerData } from "node:worker_threads";
import { RAW_MARKET_ROOT, type RawMarketSnapshot } from "./raw-market-storage";

const input = workerData as { manifest: RawMarketSnapshot; shard: number; staticLookupPath: string };
const gzipAsync = promisify(gzip);

void import("./raw-market-analysis.js")
  .then(({ buildFullMarketAnalysisIndex }) => buildFullMarketAnalysisIndex(input.manifest, { skipPersist: true, bypassCache: true, staticLookupPath: input.staticLookupPath }))
  .then(async (result) => {
    const directory = path.join(RAW_MARKET_ROOT, input.manifest.id, "fragments");
    await fs.mkdir(directory, { recursive: true });
    const output = path.join(directory, `full-market-${input.shard}.json.gz`);
    await fs.writeFile(output, await gzipAsync(Buffer.from(JSON.stringify([...result.items]), "utf8"), { level: 1 }));
    parentPort?.postMessage({ type: "complete", result: { path: output, sourceOrdersInspected: result.sourceOrdersInspected } });
  })
  .catch((error) => parentPort?.postMessage({ type: "error", error: error instanceof Error ? error.message : String(error) }));
