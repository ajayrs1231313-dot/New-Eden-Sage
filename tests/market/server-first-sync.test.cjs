const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");

const shared = read("electron/shared-market-data.ts");
assert.match(shared, /\/latest-complete/, "desktop should use latest-complete");
assert.doesNotMatch(shared, /fetch[^\n]*ensure-current|request\([^\n]*ensure-current/, "desktop must not call ensure-current");
assert.match(shared, /manifestsIdentical/, "unchanged generation should compare metadata");
assert.match(shared, /if \(identical\)[\s\S]*?changed: \[\]/, "unchanged generation should return without downloads");
assert.match(shared, /globalGenerationCache/);
assert.match(shared, /regionalGenerationCache/);
assert.match(shared, /tradeGenerationCache/);
assert.match(shared, /shortageGenerationCache/);
assert.match(shared, /shared_market\.latest_manifest_ms/);
assert.match(shared, /shared_market\.generation_compare_ms/);
assert.match(shared, /shared_market\.promotion_ms/);
assert.match(shared, /shared_market\.total_ms/);

const master = read("electron/master-update.ts");
assert.match(master, /marketDownloadWorkers = 0/);
assert.match(master, /publicMarketSource: "shared-server"/);
assert.doesNotMatch(master, /master-derived-worker|stageStaticDataRefreshLowImpact|buildFullMarketAnalysisIndexParallel|buildRegionalMarketAggregateIndex/);
assert.match(master, /character_refresh\.per_character/);
assert.match(master, /character_refresh\.total/);

const trade = read("electron/full-market-trade.ts");
const tradeStart = trade.indexOf("export async function findFullMarketTrades(");
const tradeEnd = trade.indexOf("\nasync function mapLimited<", tradeStart);
const tradeBody = trade.slice(tradeStart, tradeEnd);
assert.match(tradeBody, /loadSharedPreparedTradeDataset/);
assert.doesNotMatch(tradeBody, /buildCandidatesInParallel|universeRoute|\b30_000\b|\b8_000\b/, "desktop trade path must not generate public candidates/routes");

const shortage = read("electron/regional-shortage.ts");
const shortageStart = shortage.indexOf("export async function findRegionalShortages(");
const shortageBody = shortage.slice(shortageStart);
assert.match(shortageBody, /loadSharedPreparedShortageDataset/);
assert.doesNotMatch(shortageBody, /buildFullMarketAnalysisIndex|candidateBufferLimit|retainStrongestCandidates/, "desktop shortage path must not rescan the public market");

const raw = read("electron/raw-market-analysis.ts");
assert.match(raw, /Desktop public-market reconstruction is disabled/);
assert.match(raw, /Desktop full-market shard computation is disabled/);
const regional = read("electron/regional-market-index.ts");
assert.match(regional, /Desktop regional reconstruction is disabled/);
assert.match(regional, /rowsByType: Map<number, RegionalMarketAggregateRow\[\]>/);

const industrial = read("electron/industrial-preparation.ts");
assert.match(industrial, /typeIds: \[Number\(product\.typeId\)\]/, "Industrial lookup should use exact prepared type IDs");

const modal = read("tools/modal/sage_market_benchmark.py");
assert.match(modal, /@web\.get\("\/latest-complete"\)/);
const latestStart = modal.indexOf('    @web.get("/latest-complete")');
const latestEnd = modal.indexOf('    @web.get("/ensure-current")', latestStart);
const latestBody = modal.slice(latestStart, latestEnd);
assert.doesNotMatch(latestBody, /refresh_market_if_stale|benchmark_market_pipeline/, "latest-complete must be read-only");
assert.match(modal, /schedule=modal\.Period\(minutes=5\)/);
assert.match(modal, /market-trades-v1\.json\.gz/);
assert.match(modal, /market-shortages-v1\.json\.gz/);
assert.match(modal, /generation_manifest_path/, "artifact serving should validate the requested generation's manifest");

const app = read("src/App.tsx");
assert.doesNotMatch(app, /take up to 5 minutes/i);

console.log("Server-first shared market architecture tests passed.");
