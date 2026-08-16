import { promises as fs } from "node:fs";
import path from "node:path";
import { gzip } from "node:zlib";
import { promisify } from "node:util";
import { parentPort, workerData } from "node:worker_threads";
import { RAW_MARKET_ROOT, type RawMarketSnapshot } from "./raw-market-storage";

const input = workerData as { manifest: RawMarketSnapshot; entries: RawMarketSnapshot["regions"]; index: number; staticLookupPath: string };
const gzipAsync = promisify(gzip);

void import("./regional-market-index.js")
  .then(async ({ buildRegionalRowsForEntries }) => {
    const rows = await buildRegionalRowsForEntries(input.manifest, input.entries, input.staticLookupPath);
    const directory = path.join(RAW_MARKET_ROOT, input.manifest.id, "fragments");
    await fs.mkdir(directory, { recursive: true });
    const output = path.join(directory, `regional-market-${input.index}.json.gz`);
    await fs.writeFile(output, await gzipAsync(Buffer.from(JSON.stringify(rows), "utf8"), { level: 1 }));
    parentPort?.postMessage({ ok: true, path: output });
  })
  .catch((error) => parentPort?.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) }));
