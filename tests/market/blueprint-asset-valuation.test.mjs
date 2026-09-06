import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeSnapshotBlueprintAssetValuation,
  summarizeAssets,
  valueAssetWithBlueprintIdentity,
} from "../../electron/asset-valuation.ts";

const BLUEPRINT_TYPE = 24699;
const BPO_BASE_PRICE = 580_000_000;

function contractEvidence({
  kind = "BPO",
  me = 10,
  te = 20,
  runs = null,
  value = 700_000_000,
  source = kind === "BPC" ? "bpc-contract-history" : "contract-history-exact",
  confidence = "high",
  sampleCount = 6,
  researchMatch = "exact",
} = {}) {
  return {
    typeId: BLUEPRINT_TYPE,
    blueprintKind: kind,
    materialEfficiency: me,
    timeEfficiency: te,
    runs: kind === "BPC" ? runs : null,
    estimatedValue: value,
    medianValue: value,
    trimmedMeanValue: value,
    minValue: value * 0.9,
    maxValue: value * 1.1,
    sampleCount,
    rawExactMatchCount: researchMatch === "exact" ? sampleCount : 0,
    rawComparableMatchCount: researchMatch === "comparable" ? sampleCount : 0,
    exactMatchCount: researchMatch === "exact" ? sampleCount : 0,
    comparableMatchCount: researchMatch === "comparable" ? sampleCount : 0,
    outlierCount: 0,
    confidence,
    researchMatch,
    lookbackDays: 120,
    newestSampleAt: "2026-09-05T00:00:00.000Z",
    oldestSampleAt: "2026-08-28T00:00:00.000Z",
    removedBeforeExpiryCount: 2,
    valuationSource: source,
    evidenceBasis: "retained-public-contract-asking-price",
    observedSaleEvidence: false,
    evidenceNote: "CCP public contract history exposes listing evidence, not authoritative completed-sale status.",
    historyRevision: "public-contracts/2026-09-05/example.json.gz",
    historyRetentionDays: 120,
    historyOldestRetainedAt: "2026-08-27T00:00:00.000Z",
    historyNewestRetainedAt: "2026-09-05T00:00:00.000Z",
    generatedAt: "2026-09-05T00:01:00.000Z",
    cacheStatus: "live",
  };
}

function valuedAsset({ itemId, blueprint, station = "Test Station", me = 0, te = 0, runs = 0, evidence, basePrice = BPO_BASE_PRICE }) {
  const record = blueprint == null ? undefined : {
    item_id: itemId,
    type_id: BLUEPRINT_TYPE,
    quantity: blueprint,
    runs,
    material_efficiency: me,
    time_efficiency: te,
  };
  return {
    item_id: itemId,
    type_id: BLUEPRINT_TYPE,
    item: "Drake Blueprint",
    category_id: 9,
    quantity: 1,
    station,
    system: "Test System",
    item_volume_m3: 0.01,
    total_volume_m3: 0.01,
    ...valueAssetWithBlueprintIdentity({
      asset: { item_id: itemId, quantity: 1 },
      categoryId: 9,
      marketUnitValue: basePrice,
      marketPriceSource: "market",
      blueprint: record,
      contractEvidence: evidence,
    }),
  };
}

test("BPO without contract evidence uses explicitly labelled base fallback", () => {
  const asset = valuedAsset({ itemId: 1, blueprint: -1, me: 10, te: 20 });
  assert.equal(asset.blueprint_kind, "BPO");
  assert.equal(asset.estimated_unit_value, BPO_BASE_PRICE);
  assert.equal(asset.estimatedValue, BPO_BASE_PRICE);
  assert.equal(asset.valuation_source, "bpo-base-fallback");
  assert.equal(asset.blueprint_base_unit_value, BPO_BASE_PRICE);
  assert.equal(asset.blueprint_material_efficiency, 10);
  assert.equal(asset.blueprint_time_efficiency, 20);
});

test("max-researched BPO exact history replaces generic base price and retains the base reference", () => {
  const exact = contractEvidence({ value: 825_000_000, me: 10, te: 20 });
  const asset = valuedAsset({ itemId: 2, blueprint: -1, me: 10, te: 20, evidence: exact });
  assert.equal(asset.estimated_unit_value, 825_000_000);
  assert.equal(asset.estimatedValue, 825_000_000);
  assert.equal(asset.valuation_source, "contract-history-exact");
  assert.equal(asset.valuation_confidence, "high");
  assert.equal(asset.valuation_sample_count, 6);
  assert.equal(asset.valuation_research_match, "exact");
  assert.equal(asset.blueprint_base_unit_value, BPO_BASE_PRICE);
  assert.equal(asset.valuation_observed_sale_evidence, false);
});

test("researched BPO can differ from unresearched BPO when evidence supports it", () => {
  const fresh = valuedAsset({ itemId: 3, blueprint: -1, me: 0, te: 0, evidence: contractEvidence({ me: 0, te: 0, value: 580_000_000 }) });
  const researched = valuedAsset({ itemId: 4, blueprint: -1, me: 10, te: 20, evidence: contractEvidence({ me: 10, te: 20, value: 825_000_000 }) });
  assert.equal(fresh.estimatedValue, 580_000_000);
  assert.equal(researched.estimatedValue, 825_000_000);
  assert.notEqual(fresh.estimatedValue, researched.estimatedValue);
});

test("BPO comparable history is clearly labelled and preserves confidence metadata", () => {
  const comparable = contractEvidence({
    value: 790_000_000,
    source: "contract-history-comparable",
    confidence: "low",
    sampleCount: 2,
    researchMatch: "comparable",
  });
  const asset = valuedAsset({ itemId: 5, blueprint: -1, me: 10, te: 20, evidence: comparable });
  assert.equal(asset.valuation_source, "contract-history-comparable");
  assert.equal(asset.valuation_research_match, "comparable");
  assert.equal(asset.valuation_confidence, "low");
  assert.equal(asset.estimatedValue, 790_000_000);
});

test("BPO max-research reference scales only the research premium above the base value", () => {
  const reference = contractEvidence({
    value: 200_000_000,
    source: "contract-history-comparable",
    confidence: "low",
    sampleCount: 4,
    me: 5,
    te: 10,
    researchMatch: "max-research-reference",
  });
  reference.maxResearchAnchor = 200_000_000;
  reference.appliedResearchFraction = 0.5;
  reference.researchMatchType = "max-research-reference";
  const asset = valuedAsset({ itemId: 6, blueprint: -1, me: 5, te: 10, evidence: reference, basePrice: 100_000_000 });
  assert.equal(asset.blueprint_base_unit_value, 100_000_000);
  assert.equal(asset.valuation_max_research_anchor, 200_000_000);
  assert.equal(asset.valuation_derived_research_premium, 100_000_000);
  assert.equal(asset.valuation_applied_research_fraction, 0.5);
  assert.equal(asset.estimated_unit_value, 150_000_000);
  assert.equal(asset.estimatedValue, 150_000_000);
  assert.equal(asset.valuation_source, "contract-history-comparable");
});

test("BPC without evidence never inherits the BPO/type price", () => {
  const asset = valuedAsset({ itemId: 10, blueprint: -2, runs: 15, me: 10, te: 20 });
  assert.equal(asset.blueprint_kind, "BPC");
  assert.equal(asset.isBlueprintCopy, true);
  assert.equal(asset.estimated_unit_value, 0);
  assert.equal(asset.estimatedValue, 0);
  assert.equal(asset.valuation_source, "bpc-unpriced");
});

test("BPC exact same runs ME and TE receives contract-derived value", () => {
  const evidence = contractEvidence({ kind: "BPC", runs: 15, me: 10, te: 20, value: 22_000_000 });
  const asset = valuedAsset({ itemId: 11, blueprint: -2, runs: 15, me: 10, te: 20, evidence });
  assert.equal(asset.valuation_source, "bpc-contract-history");
  assert.equal(asset.estimatedValue, 22_000_000);
  assert.equal(asset.blueprint_runs, 15);
  assert.equal(asset.valuation_sample_count, 6);
});

test("BPC evidence with a different run count is rejected rather than normalized", () => {
  const wrongRuns = contractEvidence({ kind: "BPC", runs: 100, me: 10, te: 20, value: 100_000_000 });
  const asset = valuedAsset({ itemId: 12, blueprint: -2, runs: 15, me: 10, te: 20, evidence: wrongRuns });
  assert.equal(asset.valuation_source, "bpc-unpriced");
  assert.equal(asset.estimatedValue, 0);
});

test("BPO evidence can never be applied to a BPC", () => {
  const bpoEvidence = contractEvidence({ kind: "BPO", me: 10, te: 20, value: 900_000_000 });
  const asset = valuedAsset({ itemId: 13, blueprint: -2, runs: 10, me: 10, te: 20, evidence: bpoEvidence });
  assert.equal(asset.estimatedValue, 0);
  assert.equal(asset.valuation_source, "bpc-unpriced");
});

test("asset, blueprint-category and station totals all use the same derived blueprint values", () => {
  const assets = [
    valuedAsset({ itemId: 20, blueprint: -1, station: "Alpha", me: 10, te: 20, evidence: contractEvidence({ value: 825_000_000 }) }),
    valuedAsset({ itemId: 21, blueprint: -2, station: "Alpha", runs: 15, me: 10, te: 20, evidence: contractEvidence({ kind: "BPC", runs: 15, value: 22_000_000 }) }),
    valuedAsset({ itemId: 22, blueprint: -2, station: "Beta", runs: 1, me: 10, te: 20 }),
  ];
  const summary = summarizeAssets(assets);
  assert.equal(summary.byCategory.Blueprints, 847_000_000);
  assert.equal(summary.totalAssetValue, 847_000_000);
  assert.equal(summary.assetsByStation.find((row) => row.station === "Alpha")?.estimatedValue, 847_000_000);
  assert.equal(summary.assetsByStation.find((row) => row.station === "Beta")?.estimatedValue, 0);
  assert.deepEqual(summary.valuationBreakdown, {
    pricedBlueprintOriginals: 1,
    fallbackBlueprintOriginals: 0,
    pricedBlueprintCopies: 1,
    unpricedBlueprintCopies: 1,
    unpricedBlueprintUnknown: 0,
  });
});

test("fallback BPOs and unpriced BPCs are counted explicitly in the summary", () => {
  const summary = summarizeAssets([
    valuedAsset({ itemId: 30, blueprint: -1 }),
    valuedAsset({ itemId: 31, blueprint: -2, runs: 10 }),
  ]);
  assert.deepEqual(summary.valuationBreakdown, {
    pricedBlueprintOriginals: 1,
    fallbackBlueprintOriginals: 1,
    pricedBlueprintCopies: 0,
    unpricedBlueprintCopies: 1,
    unpricedBlueprintUnknown: 0,
  });
});

test("ordinary ships, modules, materials and skillbook-style assets retain normal type pricing", () => {
  for (const [categoryId, unitValue, quantity] of [[6, 250_000_000, 1], [7, 12_500_000, 3], [4, 5_500, 1000], [16, 8_000_000, 2]]) {
    const valued = valueAssetWithBlueprintIdentity({
      asset: { item_id: 100 + categoryId, quantity },
      categoryId,
      marketUnitValue: unitValue,
      marketPriceSource: "market",
    });
    assert.equal(valued.estimated_unit_value, unitValue);
    assert.equal(valued.estimatedValue, unitValue * quantity);
    assert.equal(valued.valuation_source, "market");
  }
});

test("cached snapshots preserve contract-derived BPO and BPC evidence without a network refresh", () => {
  const bpo = valuedAsset({ itemId: 501, blueprint: -1, station: "Athanor", me: 10, te: 20, evidence: contractEvidence({ value: 825_000_000 }) });
  const bpc = valuedAsset({ itemId: 502, blueprint: -2, station: "Athanor", runs: 25, me: 10, te: 20, evidence: contractEvidence({ kind: "BPC", runs: 25, value: 30_000_000 }) });
  const snapshot = {
    characterId: "769483498",
    character: { name: "Nedoode" },
    extended: {
      assets: [
        bpo,
        bpc,
        { item_id: 503, type_id: 34, item: "Tritanium", category_id: 4, quantity: 1000, station: "Athanor", system: "Somewhere", estimated_unit_value: 5, estimatedValue: 5000, item_volume_m3: 0.01, total_volume_m3: 10 },
      ],
      blueprints: [
        { item_id: 501, type_id: BLUEPRINT_TYPE, quantity: -1, runs: -1, material_efficiency: 10, time_efficiency: 20 },
        { item_id: 502, type_id: BLUEPRINT_TYPE, quantity: -2, runs: 25, material_efficiency: 10, time_efficiency: 20 },
      ],
      assetSummary: { totalAssetValue: 0 },
    },
  };
  const normalized = normalizeSnapshotBlueprintAssetValuation(snapshot);
  const normalizedBpo = normalized.extended.assets.find((row) => row.item_id === 501);
  const normalizedBpc = normalized.extended.assets.find((row) => row.item_id === 502);
  const ordinary = normalized.extended.assets.find((row) => row.item_id === 503);
  assert.equal(normalizedBpo.valuation_source, "contract-history-exact");
  assert.equal(normalizedBpo.estimatedValue, 825_000_000);
  assert.equal(normalizedBpo.blueprint_base_unit_value, BPO_BASE_PRICE);
  assert.equal(normalizedBpo.valuation_history_revision, "public-contracts/2026-09-05/example.json.gz");
  assert.equal(normalizedBpc.valuation_source, "bpc-contract-history");
  assert.equal(normalizedBpc.blueprint_runs, 25);
  assert.equal(normalizedBpc.estimatedValue, 30_000_000);
  assert.equal(ordinary.estimatedValue, 5000);
  assert.equal(normalized.extended.assetSummary.byCategory.Blueprints, 855_000_000);
  assert.equal(normalized.extended.assetSummary.totalAssetValue, 855_005_000);
});

test("cached fallback BPO retains its generic base fallback instead of masquerading as contract history", () => {
  const snapshot = {
    extended: {
      assets: [valuedAsset({ itemId: 601, blueprint: -1, me: 10, te: 20 })],
      blueprints: [{ item_id: 601, type_id: BLUEPRINT_TYPE, quantity: -1, runs: -1, material_efficiency: 10, time_efficiency: 20 }],
    },
  };
  const normalized = normalizeSnapshotBlueprintAssetValuation(snapshot);
  assert.equal(normalized.extended.assets[0].valuation_source, "bpo-base-fallback");
  assert.equal(normalized.extended.assets[0].estimatedValue, BPO_BASE_PRICE);
});

test("blueprint asset without authoritative blueprint identity is safely unpriced", () => {
  const valued = valueAssetWithBlueprintIdentity({
    asset: { item_id: 999, quantity: 1 },
    categoryId: 9,
    marketUnitValue: BPO_BASE_PRICE,
    marketPriceSource: "market",
  });
  assert.equal(valued.blueprint_kind, "UNKNOWN");
  assert.equal(valued.estimatedValue, 0);
  assert.equal(valued.valuation_source, "blueprint-identity-unavailable");
});
