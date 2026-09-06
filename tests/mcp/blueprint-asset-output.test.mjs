import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { normalizeSnapshotBlueprintAssetValuation, valueAssetWithBlueprintIdentity } from "../../electron/asset-valuation.ts";

const bpoRecord = {
  item_id: 7000,
  type_id: 621,
  quantity: -1,
  runs: -1,
  material_efficiency: 10,
  time_efficiency: 20,
};
const bpoEvidence = {
  typeId: 621,
  blueprintKind: "BPO",
  materialEfficiency: 10,
  timeEfficiency: 20,
  runs: null,
  estimatedValue: 890_000_000,
  medianValue: 890_000_000,
  trimmedMeanValue: 885_000_000,
  minValue: 800_000_000,
  maxValue: 950_000_000,
  sampleCount: 7,
  rawExactMatchCount: 8,
  rawComparableMatchCount: 2,
  exactMatchCount: 7,
  comparableMatchCount: 2,
  outlierCount: 1,
  confidence: "high",
  researchMatch: "exact",
  lookbackDays: 120,
  newestSampleAt: "2026-09-05T20:00:00.000Z",
  oldestSampleAt: "2026-08-28T20:00:00.000Z",
  removedBeforeExpiryCount: 3,
  valuationSource: "contract-history-exact",
  evidenceBasis: "retained-public-contract-asking-price",
  observedSaleEvidence: false,
  evidenceNote: "Historical asking-price evidence; disappearance is not authoritative sale status.",
  historyRevision: "public-contracts/2026-09-05/history.json.gz",
  historyRetentionDays: 120,
  historyOldestRetainedAt: "2026-08-27T00:00:00.000Z",
  historyNewestRetainedAt: "2026-09-05T23:00:00.000Z",
  generatedAt: "2026-09-05T23:01:00.000Z",
  cacheStatus: "live",
};

const bpoValuation = valueAssetWithBlueprintIdentity({
  asset: { item_id: 7000, quantity: 1 },
  categoryId: 9,
  marketUnitValue: 580_000_000,
  marketPriceSource: "market",
  blueprint: bpoRecord,
  contractEvidence: bpoEvidence,
});

const snapshot = normalizeSnapshotBlueprintAssetValuation({
  characterId: "769483498",
  character: { name: "Nedoode" },
  updatedAt: "2026-09-05T00:00:00.000Z",
  extended: {
    assets: [
      {
        item_id: 7000,
        type_id: 621,
        item: "Caracal Blueprint",
        category_id: 9,
        quantity: 1,
        station: "Test",
        system: "Test",
        item_volume_m3: 0.01,
        total_volume_m3: 0.01,
        ...bpoValuation,
      },
      {
        item_id: 7001,
        type_id: 28607,
        item: "Orca Blueprint",
        category_id: 9,
        quantity: 1,
        station: "Test",
        system: "Test",
        estimated_unit_value: 919_200_000,
        estimatedValue: 919_200_000,
        item_volume_m3: 0.01,
        total_volume_m3: 0.01,
      },
    ],
    blueprints: [
      bpoRecord,
      {
        item_id: 7001,
        type_id: 28607,
        quantity: -2,
        runs: 4,
        material_efficiency: 10,
        time_efficiency: 20,
      },
    ],
  },
});

const serialized = JSON.parse(JSON.stringify(snapshot));
const bpo = serialized.extended.assets.find((item) => item.item_id === 7000);
const bpc = serialized.extended.assets.find((item) => item.item_id === 7001);

assert.equal(bpo.blueprint_kind, "BPO");
assert.equal(bpo.blueprint_material_efficiency, 10);
assert.equal(bpo.blueprint_time_efficiency, 20);
assert.equal(bpo.valuation_status, "priced");
assert.equal(bpo.valuation_source, "contract-history-exact");
assert.equal(bpo.estimated_unit_value, 890_000_000);
assert.equal(bpo.estimatedValue, 890_000_000);
assert.equal(bpo.blueprint_base_unit_value, 580_000_000);
assert.equal(bpo.valuation_confidence, "high");
assert.equal(bpo.valuation_sample_count, 7);
assert.equal(bpo.valuation_lookback_days, 120);
assert.equal(bpo.valuation_evidence_basis, "retained-public-contract-asking-price");
assert.equal(bpo.valuation_observed_sale_evidence, false);
assert.equal(bpo.valuation_history_revision, "public-contracts/2026-09-05/history.json.gz");

assert.equal(bpc.blueprint_kind, "BPC");
assert.equal(bpc.blueprint_quantity, -2);
assert.equal(bpc.blueprint_runs, 4);
assert.equal(bpc.blueprint_material_efficiency, 10);
assert.equal(bpc.blueprint_time_efficiency, 20);
assert.equal(bpc.valuation_status, "unpriced");
assert.equal(bpc.valuation_source, "bpc-unpriced");
assert.equal(bpc.estimated_unit_value, 0);
assert.equal(bpc.estimatedValue, 0);

const serverSource = await readFile(new URL("../../electron/mcp-server.ts", import.meta.url), "utf8");
const databaseSource = await readFile(new URL("../../electron/database.ts", import.meta.url), "utf8");
assert.match(serverSource, /const extended = \(snapshot\.extended[\s\S]*?\?\.\[section\]/);
assert.match(serverSource, /return result\(\{ characterId, section, data: direct \?\? extended \?\? null \}\)/);
assert.match(databaseSource, /normalizeSnapshotBlueprintAssetValuation\(JSON\.parse\(row\.payload\)/);
assert.match(databaseSource, /JSON\.stringify\(normalized\)/);

console.log(JSON.stringify({
  bpo: {
    blueprintKind: bpo.blueprint_kind,
    me: bpo.blueprint_material_efficiency,
    te: bpo.blueprint_time_efficiency,
    valuationSource: bpo.valuation_source,
    confidence: bpo.valuation_confidence,
    sampleCount: bpo.valuation_sample_count,
    lookbackDays: bpo.valuation_lookback_days,
    estimatedValue: bpo.estimatedValue,
  },
  bpc: {
    blueprintKind: bpc.blueprint_kind,
    runs: bpc.blueprint_runs,
    valuationSource: bpc.valuation_source,
    estimatedValue: bpc.estimatedValue,
  },
}, null, 2));
console.log("MCP BLUEPRINT ASSET OUTPUT: PASS");
