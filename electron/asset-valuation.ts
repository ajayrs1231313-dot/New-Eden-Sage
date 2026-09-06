import type { BlueprintContractValuationEvidence } from "./blueprint-contract-history";

export type BlueprintIdentityRecord = {
  item_id?: number;
  type_id?: number;
  quantity?: number;
  runs?: number;
  material_efficiency?: number;
  time_efficiency?: number;
};

export type AssetMarketPriceSource = "market" | "adjusted" | "unpriced";
export type AssetValuationSource =
  | "market"
  | "adjusted"
  | "contract-history-exact"
  | "contract-history-comparable"
  | "bpo-base-fallback"
  | "bpc-contract-history"
  | "bpc-unpriced"
  | "blueprint-identity-unavailable"
  | "unpriced";

export type BlueprintKind = "BPO" | "BPC" | "UNKNOWN";

function finiteNumber(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function nullableFinite(value: unknown) {
  if (value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function blueprintResearchFraction(blueprint: BlueprintIdentityRecord | undefined) {
  if (!blueprint) return 0;
  const material = Math.max(0, Math.min(1, finiteNumber(blueprint.material_efficiency) / 10));
  const time = Math.max(0, Math.min(1, finiteNumber(blueprint.time_efficiency) / 20));
  return (material + time) / 2;
}

export function blueprintRecordsByItemId(value: unknown) {
  const map = new Map<number, BlueprintIdentityRecord>();
  if (!Array.isArray(value)) return map;
  for (const blueprint of value as BlueprintIdentityRecord[]) {
    const itemId = finiteNumber(blueprint?.item_id);
    if (itemId > 0) map.set(itemId, blueprint);
  }
  return map;
}

function contractEvidenceMatchesBlueprint(
  blueprint: BlueprintIdentityRecord | undefined,
  evidence: BlueprintContractValuationEvidence | undefined,
) {
  if (!blueprint || !evidence) return false;
  const quantity = finiteNumber(blueprint.quantity, Number.NaN);
  const kind = quantity === -1 ? "BPO" : quantity === -2 ? "BPC" : "UNKNOWN";
  if (kind === "UNKNOWN" || evidence.blueprintKind !== kind) return false;
  if (finiteNumber(blueprint.type_id) !== finiteNumber(evidence.typeId)) return false;
  if (finiteNumber(blueprint.material_efficiency) !== finiteNumber(evidence.materialEfficiency)) return false;
  if (finiteNumber(blueprint.time_efficiency) !== finiteNumber(evidence.timeEfficiency)) return false;
  if (kind === "BPC" && finiteNumber(blueprint.runs) !== finiteNumber(evidence.runs)) return false;
  return true;
}

function contractEvidenceFields(evidence: BlueprintContractValuationEvidence | undefined) {
  if (!evidence) return {};
  return {
    valuation_confidence: evidence.confidence,
    valuation_sample_count: finiteNumber(evidence.sampleCount),
    valuation_exact_match_count: finiteNumber(evidence.exactMatchCount),
    valuation_comparable_match_count: finiteNumber(evidence.comparableMatchCount),
    valuation_raw_exact_match_count: finiteNumber(evidence.rawExactMatchCount),
    valuation_raw_comparable_match_count: finiteNumber(evidence.rawComparableMatchCount),
    valuation_outlier_count: finiteNumber(evidence.outlierCount),
    valuation_rejected_outlier_count: finiteNumber(evidence.rejectedOutlierCount, finiteNumber(evidence.outlierCount)),
    valuation_removed_before_expiry_count: finiteNumber(evidence.removedBeforeExpiryCount),
    valuation_research_match: evidence.researchMatch,
    valuation_research_match_type: evidence.researchMatchType ?? evidence.researchMatch,
    valuation_runs_match: evidence.runsMatch ?? true,
    valuation_lookback_days: finiteNumber(evidence.lookbackDays),
    valuation_calculated_midpoint_value: nullableFinite(evidence.calculatedMidpointValue),
    valuation_median_value: nullableFinite(evidence.medianValue),
    valuation_trimmed_mean_value: nullableFinite(evidence.trimmedMeanValue),
    valuation_min_value: nullableFinite(evidence.minValue),
    valuation_max_value: nullableFinite(evidence.maxValue),
    valuation_lowest_accepted_price: nullableFinite(evidence.lowestAcceptedPrice),
    valuation_highest_accepted_price: nullableFinite(evidence.highestAcceptedPrice),
    valuation_base_blueprint_value: nullableFinite(evidence.baseBlueprintValue),
    valuation_max_research_anchor: nullableFinite(evidence.maxResearchAnchor),
    valuation_derived_research_premium: nullableFinite(evidence.derivedResearchPremium),
    valuation_applied_research_fraction: nullableFinite(evidence.appliedResearchFraction),
    valuation_newest_sample_at: evidence.newestSampleAt ?? null,
    valuation_oldest_sample_at: evidence.oldestSampleAt ?? null,
    valuation_evidence_basis: evidence.evidenceBasis,
    valuation_evidence_note: evidence.evidenceNote,
    valuation_observed_sale_evidence: false,
    valuation_history_revision: evidence.historyRevision ?? null,
    valuation_history_retention_days: finiteNumber(evidence.historyRetentionDays),
    valuation_history_oldest_retained_at: evidence.historyOldestRetainedAt ?? null,
    valuation_history_newest_retained_at: evidence.historyNewestRetainedAt ?? null,
    valuation_history_generated_at: evidence.generatedAt ?? null,
    valuation_cache_status: evidence.cacheStatus ?? null,
  };
}

function evidenceFromAsset(asset: any, blueprint: BlueprintIdentityRecord | undefined): BlueprintContractValuationEvidence | undefined {
  if (!asset || !blueprint) return undefined;
  const source = String(asset.valuation_source ?? "");
  if (!["contract-history-exact", "contract-history-comparable", "bpc-contract-history"].includes(source)) return undefined;
  const blueprintQuantity = finiteNumber(blueprint.quantity, Number.NaN);
  const blueprintKind = blueprintQuantity === -1 ? "BPO" : blueprintQuantity === -2 ? "BPC" : null;
  if (!blueprintKind) return undefined;
  const estimatedValue = nullableFinite(asset.estimated_unit_value ?? asset.estimatedValue);
  if (estimatedValue == null || estimatedValue <= 0) return undefined;
  return {
    typeId: finiteNumber(blueprint.type_id),
    blueprintKind,
    materialEfficiency: finiteNumber(blueprint.material_efficiency),
    timeEfficiency: finiteNumber(blueprint.time_efficiency),
    runs: blueprintKind === "BPC" ? finiteNumber(blueprint.runs) : null,
    estimatedValue,
    calculatedMidpointValue: nullableFinite(asset.valuation_calculated_midpoint_value) ?? estimatedValue,
    medianValue: nullableFinite(asset.valuation_median_value) ?? estimatedValue,
    trimmedMeanValue: nullableFinite(asset.valuation_trimmed_mean_value),
    minValue: nullableFinite(asset.valuation_min_value),
    maxValue: nullableFinite(asset.valuation_max_value),
    lowestAcceptedPrice: nullableFinite(asset.valuation_lowest_accepted_price) ?? nullableFinite(asset.valuation_min_value),
    highestAcceptedPrice: nullableFinite(asset.valuation_highest_accepted_price) ?? nullableFinite(asset.valuation_max_value),
    sampleCount: finiteNumber(asset.valuation_sample_count),
    rawExactMatchCount: finiteNumber(asset.valuation_raw_exact_match_count),
    rawComparableMatchCount: finiteNumber(asset.valuation_raw_comparable_match_count),
    exactMatchCount: finiteNumber(asset.valuation_exact_match_count),
    comparableMatchCount: finiteNumber(asset.valuation_comparable_match_count),
    outlierCount: finiteNumber(asset.valuation_outlier_count),
    rejectedOutlierCount: finiteNumber(asset.valuation_rejected_outlier_count, finiteNumber(asset.valuation_outlier_count)),
    confidence: ["high", "medium", "low", "none"].includes(asset.valuation_confidence) ? asset.valuation_confidence : "low",
    researchMatch: ["exact", "extremely-close", "max-research-reference", "research-interpolation", "nearby", "comparable", "none"].includes(asset.valuation_research_match) ? asset.valuation_research_match : "none",
    researchMatchType: ["exact", "extremely-close", "max-research-reference", "research-interpolation", "nearby", "comparable", "none"].includes(asset.valuation_research_match_type) ? asset.valuation_research_match_type : (["exact", "extremely-close", "max-research-reference", "research-interpolation", "nearby", "comparable", "none"].includes(asset.valuation_research_match) ? asset.valuation_research_match : "none"),
    runsMatch: asset.valuation_runs_match !== false,
    baseBlueprintValue: nullableFinite(asset.valuation_base_blueprint_value),
    maxResearchAnchor: nullableFinite(asset.valuation_max_research_anchor),
    derivedResearchPremium: nullableFinite(asset.valuation_derived_research_premium),
    appliedResearchFraction: nullableFinite(asset.valuation_applied_research_fraction),
    lookbackDays: Math.max(1, finiteNumber(asset.valuation_lookback_days, 120)),
    newestSampleAt: asset.valuation_newest_sample_at ?? null,
    oldestSampleAt: asset.valuation_oldest_sample_at ?? null,
    removedBeforeExpiryCount: finiteNumber(asset.valuation_removed_before_expiry_count),
    valuationSource: source as BlueprintContractValuationEvidence["valuationSource"],
    evidenceBasis: String(asset.valuation_evidence_basis || "retained-public-contract-asking-price"),
    observedSaleEvidence: false,
    evidenceNote: String(asset.valuation_evidence_note || "Historical public-contract asking-price evidence."),
    historyRevision: asset.valuation_history_revision ?? undefined,
    historyRetentionDays: finiteNumber(asset.valuation_history_retention_days) || undefined,
    historyOldestRetainedAt: asset.valuation_history_oldest_retained_at ?? undefined,
    historyNewestRetainedAt: asset.valuation_history_newest_retained_at ?? undefined,
    generatedAt: asset.valuation_history_generated_at ?? undefined,
    cacheStatus: asset.valuation_cache_status ?? "last-known-good",
  };
}

export function valueAssetWithBlueprintIdentity(input: {
  asset: { item_id?: number; quantity?: number };
  categoryId: number;
  marketUnitValue: number;
  marketPriceSource: AssetMarketPriceSource;
  blueprint?: BlueprintIdentityRecord;
  contractEvidence?: BlueprintContractValuationEvidence;
}) {
  const quantity = finiteNumber(input.asset.quantity) > 0 ? finiteNumber(input.asset.quantity) : 1;
  const marketUnitValue = Math.max(0, finiteNumber(input.marketUnitValue));
  const blueprintQuantity = input.blueprint ? finiteNumber(input.blueprint.quantity, Number.NaN) : Number.NaN;
  const blueprintBase = input.blueprint ? {
    blueprint_quantity: Number.isFinite(blueprintQuantity) ? blueprintQuantity : null,
    blueprint_runs: finiteNumber(input.blueprint.runs),
    blueprint_material_efficiency: finiteNumber(input.blueprint.material_efficiency),
    blueprint_time_efficiency: finiteNumber(input.blueprint.time_efficiency),
  } : {};
  const evidence = contractEvidenceMatchesBlueprint(input.blueprint, input.contractEvidence)
    ? input.contractEvidence
    : undefined;
  const contractUnitValue = Math.max(0, finiteNumber(evidence?.estimatedValue));

  if (blueprintQuantity === -2) {
    if (evidence && contractUnitValue > 0) {
      return {
        estimated_unit_value: contractUnitValue,
        estimatedValue: contractUnitValue * quantity,
        valuation_status: "priced" as const,
        valuation_source: "bpc-contract-history" as AssetValuationSource,
        valuation_price_source: null,
        blueprint_kind: "BPC" as BlueprintKind,
        isBlueprintCopy: true,
        ...blueprintBase,
        ...contractEvidenceFields(evidence),
      };
    }
    return {
      estimated_unit_value: 0,
      estimatedValue: 0,
      valuation_status: "unpriced" as const,
      valuation_source: "bpc-unpriced" as AssetValuationSource,
      valuation_price_source: null,
      blueprint_kind: "BPC" as BlueprintKind,
      isBlueprintCopy: true,
      ...blueprintBase,
      ...contractEvidenceFields(evidence),
    };
  }

  if (blueprintQuantity === -1) {
    if (evidence && contractUnitValue > 0) {
      const usesMaxResearchReference = evidence.researchMatch === "max-research-reference" || evidence.researchMatch === "research-interpolation";
      const maxResearchAnchor = Math.max(0, finiteNumber(evidence.maxResearchAnchor, contractUnitValue));
      const evidenceFraction = nullableFinite(evidence.appliedResearchFraction);
      const appliedResearchFraction = Math.max(0, Math.min(1, evidenceFraction ?? blueprintResearchFraction(input.blueprint)));
      const canScaleResearchPremium = usesMaxResearchReference && marketUnitValue > 0 && maxResearchAnchor > 0;
      const derivedResearchPremium = canScaleResearchPremium ? Math.max(0, maxResearchAnchor - marketUnitValue) : null;
      const effectiveContractUnitValue = canScaleResearchPremium
        ? marketUnitValue + (derivedResearchPremium ?? 0) * appliedResearchFraction
        : usesMaxResearchReference
          ? 0
          : contractUnitValue;
      if (effectiveContractUnitValue > 0) {
        const source: AssetValuationSource = evidence.valuationSource === "contract-history-exact" && evidence.researchMatch === "exact"
          ? "contract-history-exact"
          : "contract-history-comparable";
        return {
          estimated_unit_value: effectiveContractUnitValue,
          estimatedValue: effectiveContractUnitValue * quantity,
          valuation_status: "priced" as const,
          valuation_source: source,
          valuation_price_source: null,
          blueprint_kind: "BPO" as BlueprintKind,
          isBlueprintCopy: false,
          blueprint_base_unit_value: marketUnitValue,
          blueprint_base_price_source: input.marketPriceSource === "unpriced" ? null : input.marketPriceSource,
          ...blueprintBase,
          ...contractEvidenceFields(evidence),
          valuation_max_research_anchor: canScaleResearchPremium ? maxResearchAnchor : nullableFinite(evidence.maxResearchAnchor),
          valuation_derived_research_premium: derivedResearchPremium ?? nullableFinite(evidence.derivedResearchPremium),
          valuation_applied_research_fraction: canScaleResearchPremium ? appliedResearchFraction : nullableFinite(evidence.appliedResearchFraction),
        };
      }
    }
    return {
      estimated_unit_value: marketUnitValue,
      estimatedValue: marketUnitValue * quantity,
      valuation_status: marketUnitValue > 0 ? "priced" as const : "unpriced" as const,
      valuation_source: "bpo-base-fallback" as AssetValuationSource,
      valuation_price_source: input.marketPriceSource === "unpriced" ? null : input.marketPriceSource,
      blueprint_kind: "BPO" as BlueprintKind,
      isBlueprintCopy: false,
      blueprint_base_unit_value: marketUnitValue,
      blueprint_base_price_source: input.marketPriceSource === "unpriced" ? null : input.marketPriceSource,
      ...blueprintBase,
      ...contractEvidenceFields(evidence),
    };
  }

  if (input.blueprint || input.categoryId === 9) {
    return {
      estimated_unit_value: 0,
      estimatedValue: 0,
      valuation_status: "unpriced" as const,
      valuation_source: "blueprint-identity-unavailable" as AssetValuationSource,
      valuation_price_source: null,
      blueprint_kind: "UNKNOWN" as BlueprintKind,
      isBlueprintCopy: undefined,
      ...blueprintBase,
    };
  }

  return {
    estimated_unit_value: marketUnitValue,
    estimatedValue: marketUnitValue * quantity,
    valuation_status: marketUnitValue > 0 ? "priced" as const : "unpriced" as const,
    valuation_source: marketUnitValue > 0 ? input.marketPriceSource : "unpriced" as AssetValuationSource,
    valuation_price_source: input.marketPriceSource === "unpriced" ? null : input.marketPriceSource,
  };
}

export function summarizeAssets(assets: Array<any>) {
  const categoryNames: Record<number, string> = {
    6: "Ships",
    7: "Modules",
    8: "Ammo",
    9: "Blueprints",
    16: "Skillbooks",
  };
  const byCategory: Record<string, number> = {
    Ships: 0,
    Modules: 0,
    Ammo: 0,
    Blueprints: 0,
    Skillbooks: 0,
    Misc: 0,
  };
  const stationTotals = new Map<string, { station: string; system: string | null; estimatedValue: number; items: number }>();
  const ownedShips: any[] = [];
  let unpricedBlueprintCopies = 0;
  let pricedBlueprintCopies = 0;
  let unpricedBlueprintUnknown = 0;
  let pricedBlueprintOriginals = 0;
  let fallbackBlueprintOriginals = 0;

  for (const asset of assets) {
    const value = Math.max(0, finiteNumber(asset?.estimatedValue));
    const category = categoryNames[finiteNumber(asset?.category_id)] ?? "Misc";
    byCategory[category] += value;
    const station = asset?.station ?? asset?.system ?? "Unresolved location";
    const stationTotal = stationTotals.get(station) ?? {
      station,
      system: asset?.system ?? null,
      estimatedValue: 0,
      items: 0,
    };
    stationTotal.estimatedValue += value;
    stationTotal.items += finiteNumber(asset?.quantity) > 0 ? finiteNumber(asset.quantity) : 1;
    stationTotals.set(station, stationTotal);

    if (asset?.blueprint_kind === "BPC") {
      if (value > 0) pricedBlueprintCopies += 1;
      else unpricedBlueprintCopies += 1;
    } else if (asset?.blueprint_kind === "UNKNOWN") unpricedBlueprintUnknown += 1;
    else if (asset?.blueprint_kind === "BPO" && value > 0) {
      pricedBlueprintOriginals += 1;
      if (asset?.valuation_source === "bpo-base-fallback") fallbackBlueprintOriginals += 1;
    }

    if (finiteNumber(asset?.category_id) === 6) {
      ownedShips.push({
        item: asset.item,
        station: asset.station,
        system: asset.system,
        quantity: finiteNumber(asset.quantity) > 0 ? finiteNumber(asset.quantity) : 1,
        estimatedValue: value,
        item_volume_m3: finiteNumber(asset.item_volume_m3),
        total_volume_m3: finiteNumber(asset.total_volume_m3),
        type_id: finiteNumber(asset.type_id),
        item_id: finiteNumber(asset.item_id),
      });
    }
  }

  return {
    valuation_basis: "Ordinary assets use ESI average market price, falling back to adjusted price. Identified BPOs prefer retained public-contract asking-price evidence matched to research state, with the generic BPO type price explicitly retained only as a base fallback. BPCs use defensible same-type/run/research contract evidence or remain unpriced at 0. Public contract disappearance is not labelled as a completed sale because CCP public ESI does not expose authoritative completion status.",
    byCategory,
    totalAssetValue: Object.values(byCategory).reduce((total, value) => total + value, 0),
    assetsByStation: [...stationTotals.values()].sort((a, b) => b.estimatedValue - a.estimatedValue),
    ownedShips: ownedShips.sort((a, b) => String(a.item).localeCompare(String(b.item))),
    valuationBreakdown: {
      pricedBlueprintOriginals,
      fallbackBlueprintOriginals,
      pricedBlueprintCopies,
      unpricedBlueprintCopies,
      unpricedBlueprintUnknown,
    },
  };
}

export function normalizeSnapshotBlueprintAssetValuation<T>(snapshot: T): T {
  if (!snapshot || typeof snapshot !== "object") return snapshot;
  const source = snapshot as any;
  const assets = source.extended?.assets;
  const blueprints = source.extended?.blueprints;
  if (!Array.isArray(assets) || !Array.isArray(blueprints)) return snapshot;

  const blueprintByItemId = blueprintRecordsByItemId(blueprints);
  const normalizedAssets = assets.map((asset: any) => {
    const categoryId = finiteNumber(asset?.category_id);
    const blueprint = blueprintByItemId.get(finiteNumber(asset?.item_id));
    if (!blueprint && categoryId !== 9) return asset;

    const quantity = finiteNumber(asset?.quantity) > 0 ? finiteNumber(asset.quantity) : 1;
    const preservedContractEvidence = evidenceFromAsset(asset, blueprint);
    const baseUnit = Math.max(0, finiteNumber(
      asset?.blueprint_base_unit_value,
      preservedContractEvidence
        ? finiteNumber(asset?.blueprint_base_unit_value)
        : finiteNumber(asset?.estimated_unit_value, quantity > 0 ? finiteNumber(asset?.estimatedValue) / quantity : 0),
    ));
    const priceSourceValue = asset?.blueprint_base_price_source ?? asset?.valuation_price_source;
    const existingSource: AssetMarketPriceSource = priceSourceValue === "adjusted"
      ? "adjusted"
      : priceSourceValue === "market"
        ? "market"
        : baseUnit > 0
          ? "market"
          : "unpriced";
    return {
      ...asset,
      ...valueAssetWithBlueprintIdentity({
        asset,
        categoryId,
        marketUnitValue: baseUnit,
        marketPriceSource: existingSource,
        blueprint,
        contractEvidence: preservedContractEvidence,
      }),
    };
  });

  return {
    ...source,
    extended: {
      ...source.extended,
      assets: normalizedAssets,
      assetSummary: summarizeAssets(normalizedAssets),
    },
  } as T;
}
