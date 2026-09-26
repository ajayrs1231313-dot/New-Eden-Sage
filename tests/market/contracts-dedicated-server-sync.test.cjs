const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const shared = read("electron/shared-market-data.ts");
const modal = read("tools/modal/sage_market_benchmark.py");
const worker = read("tools/modal/public_data_worker.mjs");
const preload = read("electron/preload.ts");
const types = read("src/types.ts");

test("desktop contract refresh downloads only the dedicated Sage server contract snapshot", () => {
  assert.match(shared, /ensureCurrentSharedPublicContractsData/);
  assert.match(shared, /\/v1\/contracts\/latest/);
  assert.match(shared, /\/v1\/contracts\/latest\.gz/);
  assert.match(shared, /createHash\("sha256"\)/);
  assert.match(shared, /loadDedicatedContractSnapshot\(\)/);
  assert.match(preload, /contracts:refresh-server/);
  assert.match(types, /refreshServerContracts\(\)/);
});

test("dedicated contract snapshot remains independent from the market generation", () => {
  assert.match(shared, /SHARED_CONTRACT_ROOT/);
  assert.match(shared, /loadCurrentSharedPublicContractsRevision/);
  assert.match(shared, /if \(dedicated\) return dedicated/);
});

test("Modal exposes current contract source and refreshes it more frequently", () => {
  assert.match(modal, /@web\.get\("\/v1\/contracts\/latest"\)/);
  assert.match(modal, /@web\.get\("\/v1\/contracts\/latest\.gz"\)/);
  assert.match(modal, /modal\.Period\(minutes=10\)/);
  assert.match(worker, /CONTRACT_DETAIL_CONCURRENCY = Math\.max\(1, Number\(process\.env\.NEW_EDEN_SAGE_CONTRACT_DETAIL_CONCURRENCY \|\| 20\)\)/);
});
