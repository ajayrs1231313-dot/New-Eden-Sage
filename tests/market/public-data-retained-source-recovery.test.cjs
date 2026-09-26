const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const worker = fs.readFileSync(path.join(__dirname, "..", "..", "tools", "modal", "public_data_worker.mjs"), "utf8");

test("public-data producer refetches when a retained market payload is missing", () => {
  assert.match(worker, /async function retainedMarketEntryExists\(entry\)/);
  assert.match(worker, /marketRegionsRecovered\+\+/);
  assert.match(worker, /if \(!retainedEntryAvailable\) previousEntry = null/);
  assert.match(worker, /etag: null, lastModified: null, nextEligibleAt: null/);
  assert.match(worker, /fetchWithBackoff\(`\$\{base\}&page=1`, requestState\)/);
});

 test("public-data producer refuses to publish an incomplete raw snapshot", () => {
  assert.match(worker, /async function assertRawSnapshotIntegrity\(snapshot, expectedRegionCount\)/);
  assert.match(worker, /await assertRawSnapshotIntegrity\(snapshot, regions\.length\)/);
  assert.match(worker, /missing or empty/);
});
