import assert from "node:assert/strict";
import fs from "node:fs";

const main = fs.readFileSync(new URL("../../electron/main-task9.ts", import.meta.url), "utf8");
const manager = fs.readFileSync(new URL("../../electron/lp-store-worker-manager.ts", import.meta.url), "utf8");
const worker = fs.readFileSync(new URL("../../electron/lp-store-worker.ts", import.meta.url), "utf8");
const lpStore = fs.readFileSync(new URL("../../electron/lp-store.ts", import.meta.url), "utf8");
const renderer = fs.readFileSync(new URL("../../src/LpStore.tsx", import.meta.url), "utf8");

assert.match(main, /from "\.\/lp-store-worker-manager"/, "main process should route LP Store work through the worker manager");
assert.doesNotMatch(main, /from "\.\/lp-store"/, "main process must not import the heavy LP Store analyzer directly");
assert.match(main, /lp-store:offers[\s\S]*analyzeLpCorporation/, "offer IPC should call the worker-backed facade");
assert.match(main, /disposeLpStoreWorker\(\)/, "LP worker should be disposed on app shutdown/memory pressure");

assert.match(manager, /new Worker\(path\.join\(__dirname, "lp-store-worker\.js"\)/, "LP Store needs a dedicated worker thread");
assert.match(manager, /const inFlightByKey = new Map/, "identical LP requests should be deduplicated");
assert.match(manager, /offers:\$\{Number\(input\?\.corporationId\)\}:\$\{Number\(input\?\.marketRevision\) \|\| 0\}/, "market revision should invalidate only price-dependent corporation analysis");
assert.match(manager, /getLpStoreWorkerStatus/, "background layer should expose preparation state for diagnostics/progress");

assert.match(worker, /warmLpStoreStaticData\(\)/, "worker should warm immutable static LP relationships once");
assert.match(worker, /queue = queue\.then\(\(\) => handle\(message\)/, "LP jobs should be serialized in the resident worker");
assert.match(worker, /completedRequests/, "worker should retain reusable state rather than recreate per visit");
assert.match(worker, /loadInstalledSharedMarketManifestFresh\(\)[\s\S]*requestedGeneration !== marketGeneration[\s\S]*invalidateLpStoreMarketData\(\)/, "installed public-market generation changes should invalidate price data without recreating the worker");

assert.match(lpStore, /export async function warmLpStoreStaticData\(\)/, "LP implementation should provide an explicit warm-once entrypoint");
assert.match(lpStore, /getMarketTypeIndex\(\)/, "market type relationships belong in worker warm state");
assert.match(lpStore, /getMarketSystemIndex\(\)/, "market system relationships belong in worker warm state");
assert.match(lpStore, /getPveStaticIndex\(\)/, "mission/LP static relationships belong in worker warm state");
assert.match(lpStore, /const cacheKey = `\$\{corporationId\}:\$\{marketRevision\}`/, "market revision should key price/profit analysis without rebuilding static state");
assert.match(lpStore, /invalidateLpStoreMarketData[\s\S]*analysisCache\.clear\(\)[\s\S]*invalidateSharedMarketMemoryCache\(\)/, "LP market invalidation should preserve static/offers caches and clear only price-dependent state");

assert.match(renderer, /Preparing LP intelligence/, "LP page should show a local preparing state while the worker runs");
assert.match(renderer, /let cancelled=false;setLoading\(true\)/, "renderer should ignore stale results after navigation/selection changes");

console.log("lp-store worker isolation regression: ok");
