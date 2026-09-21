const assert = require("node:assert/strict");
const fs = require("node:fs");

const policy = require("../../dist-electron/interactive-processing-policy.js");

assert.equal(policy.pageLoadCpuBudget(1), 1, "single-core systems must still have one worker");
assert.equal(policy.pageLoadCpuBudget(2), 1, "two logical cores must reserve one for UI/OS");
assert.equal(policy.pageLoadCpuBudget(8), 7, "eight logical cores should expose seven to page-load work");
assert.equal(policy.pageLoadCpuBudget(16), 15, "sixteen logical cores should expose fifteen to page-load work");

assert.equal(policy.pageLoadWorkerCount(2, 8), 2, "worker count must not exceed useful work");
assert.equal(policy.pageLoadWorkerCount(100, 8), 7, "worker count must use the global all-minus-one budget");
assert.equal(policy.pageLoadWorkerCount(0, 8), 1, "worker count must never fall below one");

const trade = fs.readFileSync("electron/full-market-trade.ts", "utf8");
assert.match(trade, /pageLoadWorkerCount\(entries\.length\)/, "Full Market Trade must use the global page-load CPU policy");
assert.doesNotMatch(trade, /Math\.min\(6,\s*availableParallelism\(\)/, "Full Market Trade must not retain the old six-core cap");

const pve = fs.readFileSync("electron/pve-location-intelligence.ts", "utf8");
assert.match(pve, /pageLoadWorkerCount\(2\)\s*>=\s*2/, "PVE page readiness must use the global interactive CPU policy");

const regional = fs.readFileSync("electron/regional-market-filter.ts", "utf8");
assert.match(
  regional,
  /buildRegionalMarketAggregateIndex\(\{ progress: runtime\.progress \}, pageLoadWorkerCount\(\)\)/,
  "interactive regional filtering must pass the global page-load CPU budget",
);

console.log("Interactive page-load processing policy checks passed.");
