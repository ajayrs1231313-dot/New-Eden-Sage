const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (p) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
const wrangler = read("backend/wrangler.jsonc");
const backend = read("backend/src/index.ts");
const online = read("electron/sage-online.ts");
const modal = read("tools/modal/sage_market_benchmark.py");
const publicWorker = read("tools/modal/public_data_worker.mjs");

test("Sage Online production runtime is cloud-hosted and has no Windows-host dependency", () => {
  assert.match(online, /https:\/\/new-eden-sage-online\.[^"]+\.workers\.dev/);
  assert.match(wrangler, /"d1_databases"/);
  assert.match(wrangler, /"durable_objects"/);
  assert.match(wrangler, /"queues"/);
  assert.match(wrangler, /"crons"/);
  assert.doesNotMatch(backend, /localhost|127\.0\.0\.1|[A-Z]:\\\\/i);
});

test("market and contracts run as separate Modal schedules", () => {
  assert.match(modal, /modal\.Period\(minutes=5\)/);
  assert.match(modal, /modal\.Period\(minutes=10\)/);
  assert.match(modal, /def scheduled_market_refresh\(\)/);
  assert.match(modal, /def scheduled_contract_refresh\(\)/);
  assert.match(modal, /MARKET_REFRESH_GUARD_KEY = "public-refresh"/);
  assert.match(modal, /CONTRACT_REFRESH_GUARD_KEY = "contract-refresh"/);
  assert.match(modal, /NEW_EDEN_SAGE_PUBLIC_PIPELINE_MODE"] = "market"/);
  assert.match(modal, /NEW_EDEN_SAGE_PUBLIC_PIPELINE_MODE"] = "contracts"/);
  assert.match(modal, /refresh_market_if_stale\.spawn\(\)/);
  assert.match(modal, /refresh_contracts_if_stale\.spawn\(\)/);
});

test("market publication no longer waits for a contract refresh", () => {
  const marketMain = publicWorker.slice(
    publicWorker.indexOf("async function runMarketPublicRefresh"),
    publicWorker.indexOf("async function main()"),
  );
  const contractMain = publicWorker.slice(
    publicWorker.indexOf("async function runContractSourceRefresh"),
    publicWorker.indexOf("async function runMarketPublicRefresh"),
  );
  assert.doesNotMatch(marketMain, /refreshPublicContracts\(/);
  assert.match(marketMain, /loadCurrentContractState\(previousManifest\)/);
  assert.match(contractMain, /refreshPublicContracts\(regions, \{ writeHistory: false \}\)/);
  assert.match(publicWorker, /if \(writeHistoryEnabled\) await writeContractHistory\(previous, snapshot\)/);
});

test("only market/public pipeline publishes the shared manifest", () => {
  const contractMain = publicWorker.slice(
    publicWorker.indexOf("async function runContractSourceRefresh"),
    publicWorker.indexOf("async function runMarketPublicRefresh"),
  );
  assert.doesNotMatch(contractMain, /manifest\.json|generationRoot|contractBundle\(/);
  assert.match(contractMain, /contract-scheduler-status\.json/);
});

test("refresh leases outlive each pipeline maximum runtime", () => {
  assert.match(modal, /MARKET_PIPELINE_SUBPROCESS_TIMEOUT_SECONDS = 10 \* 60/);
  assert.match(modal, /MARKET_REFRESH_GUARD_LEASE_SECONDS = MARKET_REFRESH_FUNCTION_TIMEOUT_SECONDS \+ 10 \* 60/);
  assert.match(modal, /CONTRACT_PIPELINE_SUBPROCESS_TIMEOUT_SECONDS = 25 \* 60/);
  assert.match(modal, /CONTRACT_REFRESH_GUARD_LEASE_SECONDS = CONTRACT_REFRESH_FUNCTION_TIMEOUT_SECONDS \+ 10 \* 60/);
  assert.match(modal, /timeout=MARKET_PIPELINE_SUBPROCESS_TIMEOUT_SECONDS/);
  assert.match(modal, /timeout=CONTRACT_PIPELINE_SUBPROCESS_TIMEOUT_SECONDS/);
});

test("public-data runtime uses cloud storage, not a Windows host", () => {
  assert.match(modal, /modal\.Volume\.from_name/);
  assert.match(modal, /PUBLISH_ROOT\s*=\s*Path\("\/published"\)/);
  assert.doesNotMatch(publicWorker, /localhost|127\.0\.0\.1|[A-Z]:\\\\/i);
  assert.match(publicWorker, /const RAW_ROOT = process\.env\.NEW_EDEN_SAGE_RAW_MARKET_ROOT \|\| path\.join\(CURRENT_ROOT/);
});
