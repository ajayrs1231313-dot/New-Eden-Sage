import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const historyClient = await readFile(new URL("../../electron/blueprint-contract-history.ts", import.meta.url), "utf8");
const eveSource = await readFile(new URL("../../electron/eve.ts", import.meta.url), "utf8");
const assetsUi = await readFile(new URL("../../src/AssetsCommand.tsx", import.meta.url), "utf8");
const databaseSource = await readFile(new URL("../../electron/database.ts", import.meta.url), "utf8");

test("blueprint history client has memory TTL and persistent last-known-good caching", () => {
  assert.match(historyClient, /MEMORY_TTL_MS\s*=\s*30\s*\*\s*60\s*\*\s*1000/);
  assert.match(historyClient, /loadPersistedResult<BlueprintContractValuationEvidence>/);
  assert.match(historyClient, /savePersistedResult\(CACHE_KIND/);
  assert.match(historyClient, /cacheStatus:\s*"last-known-good"/);
  assert.match(historyClient, /cacheStatus:\s*"memory"/);
  assert.match(historyClient, /cacheStatus:\s*"live"/);
  assert.match(historyClient, /CACHE_KIND\s*=\s*"blueprint-contract-valuation-v3"/);
  assert.match(historyClient, /schemaVersion\s*!==\s*2/);
});

test("asset enrichment batches unique blueprint research queries exactly once per enrichment pass", () => {
  const enrichmentStart = eveSource.indexOf("async function enrichAssets(");
  assert.ok(enrichmentStart >= 0);
  const enrichmentEnd = eveSource.indexOf("\nfunction captureStatus", enrichmentStart);
  assert.ok(enrichmentEnd > enrichmentStart);
  const enrichment = eveSource.slice(enrichmentStart, enrichmentEnd);
  assert.equal((enrichment.match(/loadBlueprintContractValuations\(/g) ?? []).length, 1);
  assert.match(enrichment, /new Map\(assets\.map/);
  assert.match(enrichment, /blueprintContractQueryKey\(query\)/);
});

test("Assets tab renders prepared valuation evidence and never calls contract history itself", () => {
  assert.doesNotMatch(assetsUi, /loadBlueprintContractValuations|contract-history\/blueprint-valuations/);
  assert.match(assetsUi, /valuationSampleCount/);
  assert.match(assetsUi, /valuationConfidence/);
  assert.match(assetsUi, /valuationResearchMatch/);
});

test("database reads normalize prepared snapshot valuation without a network query", () => {
  assert.match(databaseSource, /normalizeSnapshotBlueprintAssetValuation\(decryptSnapshotPayload/);
  assert.doesNotMatch(databaseSource, /loadBlueprintContractValuations|contract-history\/blueprint-valuations/);
});
