import { getSnapshot, listSnapshots } from "./database";
import {
  analyzeBlueprintActivities,
  analyzeManufacturingPlan,
  getIndustrySystemCostIndices,
  getIndustrialTypeNames,
} from "./industrial-engine";
import { filterRegionalMarket } from "./regional-market-filter";
import { getMarketSystemIndex } from "./market-static-index";
import { universeRoute } from "./universe-route-graph";
import { loadCurrentMarketRevision } from "./shared-market-data";
import { loadPersistedResult, savePersistedResult } from "./persistent-result-cache";

type SecurityBand = "high" | "low" | "null";

export type ManufacturingPlanInput = {
  characterId: string;
  blueprintTypeId: number;
  materialEfficiency?: number;
  timeEfficiency?: number;
  targetQuantity?: number;
  runs?: number;
  availableRuns?: number;
  includeConnectedStock?: boolean;
  sharedCharacterIds?: string[];
};

export type IndustrialOpportunityInput = {
  characterId: string;
  systemQuery?: string;
  maxJumps?: number | null;
  security?: SecurityBand[];
  includeConnectedStock?: boolean;
  sharedCharacterIds?: string[];
};

function requireSnapshot(characterId: string) {
  const snapshot = getSnapshot(String(characterId)) as any;
  if (!snapshot) throw new Error("Select and sync a connected character.");
  return snapshot;
}

function enrichAssets(item: any) {
  const characterId = String(item.characterId);
  const rawAssets = Array.isArray(item.extended?.assets) ? item.extended.assets : [];
  return rawAssets.map((asset: any, index: number) => ({
    ...asset,
    ownerCharacterId: characterId,
    sourceAssetId: `${characterId}:${asset.item_id ?? `stack-${index}`}`,
  }));
}

function scopedSnapshots(input: { characterId: string; includeConnectedStock?: boolean; sharedCharacterIds?: string[] }) {
  const snapshot = requireSnapshot(input.characterId);
  if (!input.includeConnectedStock) return [snapshot];
  const activeCharacterId = String(input.characterId);
  const permitted = new Set([activeCharacterId, ...(input.sharedCharacterIds ?? []).map(String)]);
  return (listSnapshots() as any[])
    .filter((item) => item?.characterId && permitted.has(String(item.characterId)))
    .sort((a, b) =>
      String(a.characterId) === activeCharacterId
        ? -1
        : String(b.characterId) === activeCharacterId
          ? 1
          : String(a.character?.name ?? "").localeCompare(String(b.character?.name ?? "")),
    );
}

function ownedBlueprintDescriptors(snapshots: any[]) {
  return snapshots.flatMap((item) => {
    const personal = Array.isArray(item.extended?.blueprints) ? item.extended.blueprints : [];
    const corporation = Array.isArray(item.extended?.corporation?.blueprints)
      ? item.extended.corporation.blueprints
      : [];
    const trainedSkills = (item.skills?.skills ?? []).map((skill: any) => ({
      skillId: Number(skill.skill_id),
      level: Number(skill.trained_skill_level ?? 0),
    }));
    const mapBlueprint = (blueprint: any, corporationOwned = false) => {
      const blueprintTypeId = Number(blueprint.type_id ?? 0);
      if (!blueprintTypeId) return [];
      return [{
        characterId: corporationOwned
          ? `corp:${String(item.character?.corporation_id ?? item.characterId)}`
          : String(item.characterId),
        characterName: corporationOwned
          ? `${String(item.character?.corporation_name ?? "Corporation")} (corp, via ${String(item.character?.name ?? item.characterId)})`
          : String(item.character?.name ?? item.characterId),
        blueprintTypeId,
        materialEfficiency: Number(blueprint.material_efficiency ?? 0),
        timeEfficiency: Number(blueprint.time_efficiency ?? 0),
        availableRuns: Number(blueprint.runs ?? -1),
        trainedSkills,
      }];
    };
    return [
      ...personal.flatMap((blueprint: any) => mapBlueprint(blueprint)),
      ...corporation.flatMap((blueprint: any) => mapBlueprint(blueprint, true)),
    ];
  });
}

function manufacturingKey(input: ManufacturingPlanInput, snapshots: any[]) {
  return {
    schema: 2,
    input: {
      characterId: String(input.characterId),
      blueprintTypeId: Number(input.blueprintTypeId),
      materialEfficiency: Number(input.materialEfficiency ?? 0),
      timeEfficiency: Number(input.timeEfficiency ?? 0),
      targetQuantity: input.targetQuantity == null ? null : Number(input.targetQuantity),
      runs: input.runs == null ? null : Number(input.runs),
      availableRuns: input.availableRuns == null ? null : Number(input.availableRuns),
      includeConnectedStock: Boolean(input.includeConnectedStock),
      sharedCharacterIds: [...(input.sharedCharacterIds ?? [])].map(String).sort(),
    },
    snapshots: snapshots.map((item) => [String(item.characterId), String(item.updatedAt ?? "")]),
  };
}

export async function getManufacturingPlanPrepared(input: ManufacturingPlanInput, force = false) {
  const snapshot = requireSnapshot(input.characterId);
  const snapshots = scopedSnapshots(input);
  const key = manufacturingKey(input, snapshots);
  if (!force) {
    const saved = await loadPersistedResult<any>("industry-manufacturing-plan", key);
    if (saved) return saved;
  }
  const assets = enrichAssets(snapshot);
  const stockSources = input.includeConnectedStock
    ? snapshots.map((item) => ({
        characterId: String(item.characterId),
        characterName: String(item.character?.name ?? item.characterId),
        assets: enrichAssets(item),
      }))
    : undefined;
  const result = await analyzeManufacturingPlan({
    ...input,
    assets,
    stockSources,
    ownedBlueprints: ownedBlueprintDescriptors(snapshots),
    snapshot,
  });
  await savePersistedResult("industry-manufacturing-plan", key, result);
  return result;
}

function blueprintActivitiesKey(characterId: string, blueprintTypeId: number, snapshot: any) {
  return {
    schema: 2,
    characterId: String(characterId),
    blueprintTypeId: Number(blueprintTypeId),
    snapshot: String(snapshot.updatedAt ?? ""),
  };
}

export async function getBlueprintActivitiesPrepared(
  input: { characterId: string; blueprintTypeId: number },
  force = false,
) {
  const snapshot = requireSnapshot(input.characterId);
  const key = blueprintActivitiesKey(input.characterId, input.blueprintTypeId, snapshot);
  if (!force) {
    const saved = await loadPersistedResult<any>("industry-blueprint-activities", key);
    if (saved) return saved;
  }
  const result = await analyzeBlueprintActivities({ blueprintTypeId: Number(input.blueprintTypeId), snapshot });
  await savePersistedResult("industry-blueprint-activities", key, result);
  return result;
}

async function systemCostKey(characterId: string, snapshot: any) {
  const solarSystemId = Number(snapshot.location?.solar_system_id ?? 0);
  if (!solarSystemId) throw new Error("The selected character has no resolved solar-system location.");
  return {
    schema: 2,
    characterId: String(characterId),
    system: solarSystemId,
    snapshot: String(snapshot.updatedAt ?? ""),
    market: (await loadCurrentMarketRevision())?.id ?? "none",
  };
}

export async function getSystemCostIndexPrepared(characterId: string, force = false) {
  const snapshot = requireSnapshot(characterId);
  const key = await systemCostKey(characterId, snapshot);
  if (!force) {
    const saved = await loadPersistedResult<any>("industry-system-cost", key);
    if (saved) return saved;
  }
  const result = await getIndustrySystemCostIndices(Number(snapshot.location.solar_system_id));
  await savePersistedResult("industry-system-cost", key, result);
  return result;
}

async function routeScope(systemQuery: string, maxJumps: number, targetSystemIds: number[]) {
  const systems = await getMarketSystemIndex();
  const query = String(systemQuery ?? "").trim().toLowerCase();
  if (!query) throw new Error("Type a system to search around.");
  const candidates = [...systems.values()]
    .filter((system) => system.name.toLowerCase().includes(query))
    .sort((a, b) => {
      const aa = a.name.toLowerCase();
      const bb = b.name.toLowerCase();
      const ar = aa === query ? 0 : aa.startsWith(query) ? 1 : 2;
      const br = bb === query ? 0 : bb.startsWith(query) ? 1 : 2;
      return ar - br || a.name.length - b.name.length || a.name.localeCompare(b.name);
    });
  const origin = candidates[0];
  if (!origin) throw new Error(`No EVE solar system matches "${systemQuery.trim()}".`);
  const radius = Math.max(0, Math.min(50, Math.floor(Number(maxJumps ?? 10))));
  const ids = [...new Set(targetSystemIds.map(Number).filter((value) => Number.isInteger(value) && value > 0))];
  const routes = await Promise.all(ids.map(async (systemId) => {
    const target = systems.get(systemId);
    if (!target) return { systemId, systemName: `System ${systemId}`, securityBand: "unknown", jumps: 999, withinRange: false };
    const route = await universeRoute(origin.systemId, systemId);
    return {
      systemId,
      systemName: target.name,
      securityBand: target.securityBand,
      securityStatus: target.securityStatus,
      jumps: route.jumps,
      minimumSecurityStatus: route.minimumSecurityStatus,
      withinRange: route.jumps <= radius,
    };
  }));
  return {
    origin: {
      systemId: origin.systemId,
      systemName: origin.name,
      securityBand: origin.securityBand,
      securityStatus: origin.securityStatus,
    },
    maxJumps: radius,
    routes,
  };
}

function normalizeOpportunityInput(input: IndustrialOpportunityInput) {
  const security = [...new Set((input.security?.length ? input.security : ["high", "low", "null"]) as SecurityBand[])].sort();
  const systemQuery = String(input.systemQuery ?? "").trim();
  const maxJumps = input.maxJumps == null ? null : Math.max(0, Math.min(50, Math.floor(Number(input.maxJumps))));
  return {
    characterId: String(input.characterId),
    systemQuery,
    maxJumps,
    security,
    includeConnectedStock: Boolean(input.includeConnectedStock),
    sharedCharacterIds: [...(input.sharedCharacterIds ?? [])].map(String).sort(),
  };
}

async function industrialOpportunityKey(input: IndustrialOpportunityInput) {
  const normalized = normalizeOpportunityInput(input);
  const snapshots = scopedSnapshots(normalized);
  const manifest = await loadCurrentMarketRevision();
  return {
    schema: 2,
    input: normalized,
    marketSnapshotId: manifest?.id ?? "none",
    snapshots: snapshots.map((item) => [String(item.characterId), String(item.updatedAt ?? "")]),
  };
}

export async function loadPreparedIndustrialOpportunities(input: IndustrialOpportunityInput) {
  return loadPersistedResult<any>("industrial-opportunities", await industrialOpportunityKey(input));
}

export async function getIndustrialOpportunitiesPrepared(
  input: IndustrialOpportunityInput,
  options: { force?: boolean; onProgress?: (percent: number, message: string) => void } = {},
) {
  const normalized = normalizeOpportunityInput(input);
  const proximityEnabled = Boolean(normalized.systemQuery && normalized.maxJumps != null);
  if ((normalized.systemQuery && normalized.maxJumps == null) || (!normalized.systemQuery && normalized.maxJumps != null)) {
    throw new Error("To use proximity filtering, choose both a system and a jump radius.");
  }
  if (!normalized.security.length) throw new Error("Select at least one security band.");

  const key = await industrialOpportunityKey(normalized);
  if (!options.force) {
    const saved = await loadPersistedResult<any>("industrial-opportunities", key);
    if (saved) return saved;
  }

  const snapshot = requireSnapshot(normalized.characterId);
  const extended = snapshot.extended as any;
  const personal = Array.isArray(extended?.blueprints) ? extended.blueprints : [];
  const corporation = Array.isArray(extended?.corporation?.blueprints) ? extended.corporation.blueprints : [];
  const ownedBlueprints = [...personal, ...corporation]
    .filter((blueprint: any, index: number, all: any[]) =>
      blueprint.type_id && all.findIndex((item) => item.type_id === blueprint.type_id) === index)
    .slice(0, 40);

  if (!ownedBlueprints.length) {
    const empty = {
      generatedAt: new Date().toISOString(),
      opportunities: [],
      status: "No owned blueprints are available to analyse.",
      scope: normalized,
    };
    await savePersistedResult("industrial-opportunities", key, empty);
    return empty;
  }

  const output: any[] = [];
  for (let index = 0; index < ownedBlueprints.length; index += 1) {
    const blueprint = ownedBlueprints[index];
    if (!blueprint.type_id) continue;
    try {
      const activities = await getBlueprintActivitiesPrepared({
        characterId: normalized.characterId,
        blueprintTypeId: Number(blueprint.type_id),
      });
      const manufacturing = activities?.activities?.find((activity: any) => activity.id === "manufacturing");
      const product = manufacturing?.products?.[0];
      if (!product?.name || !product?.typeId) continue;
      options.onProgress?.(
        (index / ownedBlueprints.length) * 100,
        proximityEnabled
          ? `Checking ${product.name} within ${normalized.maxJumps} jumps of ${normalized.systemQuery}.`
          : `Checking ${product.name} across selected security space.`,
      );

      const plan = await getManufacturingPlanPrepared({
        characterId: normalized.characterId,
        blueprintTypeId: Number(blueprint.type_id),
        materialEfficiency: Number(blueprint.material_efficiency ?? 0),
        timeEfficiency: Number(blueprint.time_efficiency ?? 0),
        targetQuantity: Math.max(1, Number(product.quantity ?? 1)),
        availableRuns: Number(blueprint.runs ?? -1) >= 0 ? Number(blueprint.runs) : undefined,
        includeConnectedStock: normalized.includeConnectedStock,
        sharedCharacterIds: normalized.sharedCharacterIds,
      });

      const marketResults = await Promise.all(normalized.security.map((security) =>
        filterRegionalMarket({
          query: "",
          typeIds: [Number(product.typeId)],
          categoryIds: [],
          groupIds: [],
          marketGroupIds: [],
          regionIds: [],
          security,
          presence: "any",
          signal: "all",
          sort: "signal",
          offset: 0,
          limit: 80,
        }),
      ));
      const marketRows = marketResults.flatMap((market: any) =>
        (market?.rows ?? []).filter((row: any) => row.item === product.name));
      const candidateSystemIds = marketRows
        .map((row: any) => Number(row.bestBuySystemId ?? row.bestSellSystemId ?? 0))
        .filter((value: number) => value > 0);
      const routes = proximityEnabled
        ? await routeScope(normalized.systemQuery, normalized.maxJumps!, candidateSystemIds)
        : null;
      const routeBySystem = new Map<number, any>((routes?.routes ?? []).map((route: any) => [Number(route.systemId), route]));
      const buildUnitCost =
        Number(plan?.market?.fullBomMarketCost ?? plan?.market?.shortageMarketCost ?? 0) /
        Math.max(1, Number(plan?.outputQuantity ?? product.quantity ?? 1));

      for (const row of marketRows.slice(0, 60)) {
        const demandSystemId = Number(row.bestBuySystemId ?? row.bestSellSystemId ?? 0);
        const route = proximityEnabled ? routeBySystem.get(demandSystemId) : null;
        if (proximityEnabled && !route?.withinRange) continue;
        const immediateUnitRevenue = Number(row.bestBuy ?? 0);
        const listUnitRevenue = Number(row.bestSell ?? row.bestBuy ?? 0);
        const demandUnits = Math.max(0, Number(row.buyVolume ?? 0));
        const supplyUnits = Math.max(0, Number(row.sellVolume ?? 0));
        const demandGap = Math.max(0, demandUnits - supplyUnits);
        const batch = Math.max(1, Math.min(100, Math.ceil(Math.max(demandGap * 0.25, Number(row.buyOrders ?? 0) * 2, 1))));
        const unitRevenue = immediateUnitRevenue > 0 ? immediateUnitRevenue : listUnitRevenue;
        const unitProfit = buildUnitCost > 0 && unitRevenue > 0 ? unitRevenue - buildUnitCost : null;
        const batchProfit = unitProfit == null ? null : unitProfit * batch;
        if (batchProfit == null || batchProfit <= 0) continue;
        const confidence =
          row.supplyGap || (row.buyPressure && Number(row.demandSupplyRatio ?? 0) >= 2)
            ? "HIGH"
            : row.thinSupply || Number(row.signalScore ?? 0) >= 60
              ? "MEDIUM"
              : "WATCH";
        const score =
          Number(row.signalScore ?? 0) +
          (row.supplyGap ? 45 : 0) +
          (row.buyPressure ? 25 : 0) +
          (row.thinSupply ? 15 : 0) +
          Math.min(35, Math.max(0, Number(row.demandSupplyRatio ?? 0) * 5)) +
          Math.min(40, Math.log10(batchProfit + 1) * 5) +
          (proximityEnabled ? Math.max(0, 20 - Number(route?.jumps ?? 20)) : 0);
        output.push({
          blueprintTypeId: blueprint.type_id,
          blueprintName: activities?.blueprintName ?? "Owned blueprint",
          productTypeId: product.typeId,
          productName: product.name,
          region: row.region,
          security: row.security,
          system: route?.systemName ?? row.bestBuySystemName ?? row.bestSellSystemName ?? row.region,
          systemId: demandSystemId,
          jumps: proximityEnabled ? route?.jumps : null,
          originSystem: proximityEnabled ? (routes?.origin?.systemName ?? normalized.systemQuery) : null,
          bestBuy: row.bestBuy,
          bestSell: row.bestSell,
          buyOrders: row.buyOrders,
          sellOrders: row.sellOrders,
          buyVolume: demandUnits,
          sellVolume: supplyUnits,
          demandSupplyRatio: row.demandSupplyRatio,
          regionalPremiumPercent: row.regionalPremiumPercent,
          supplyGap: row.supplyGap,
          thinSupply: row.thinSupply,
          buyPressure: row.buyPressure,
          signalScore: row.signalScore,
          buildUnitCost,
          unitProfit,
          batch,
          batchProfit,
          confidence,
          score,
          materialEfficiency: blueprint.material_efficiency ?? 0,
          timeEfficiency: blueprint.time_efficiency ?? 0,
        });
      }
    } catch {
      // One unavailable blueprint/product should not block the rest of the owned library.
    }
  }

  const opportunities = [...new Map(
    output
      .sort((a, b) => b.score - a.score)
      .map((item) => [`${item.productTypeId}:${item.region}:${item.system}`, item]),
  ).values()].slice(0, 40);
  const status = opportunities.length
    ? proximityEnabled
      ? `Ranked ${opportunities.length} profitable opportunities within ${normalized.maxJumps} jumps of ${opportunities[0]?.originSystem ?? normalized.systemQuery}.`
      : `Ranked ${opportunities.length} profitable opportunities across the selected security space.`
    : proximityEnabled
      ? "No profitable retained-market opportunities matched those security and jump filters."
      : "No profitable retained-market opportunities matched the selected security filters.";
  const result = {
    generatedAt: new Date().toISOString(),
    opportunities,
    status,
    scope: normalized,
  };
  await savePersistedResult("industrial-opportunities", key, result);
  options.onProgress?.(100, status);
  return result;
}

export async function loadIndustrialPreparedState(characterId: string) {
  const snapshot = requireSnapshot(characterId);
  const defaultInput: IndustrialOpportunityInput = {
    characterId: String(characterId),
    systemQuery: "",
    maxJumps: null,
    security: ["high", "low", "null"],
    includeConnectedStock: false,
    sharedCharacterIds: [],
  };
  const opportunities = await loadPreparedIndustrialOpportunities(defaultInput);
  const allSnapshots = listSnapshots() as any[];
  const typeIds = [...new Set(allSnapshots.flatMap((item) => {
    const extended = item.extended as any;
    const blueprints = Array.isArray(extended?.blueprints) ? extended.blueprints : [];
    const corpBlueprints = Array.isArray(extended?.corporation?.blueprints) ? extended.corporation.blueprints : [];
    const jobs = Array.isArray(extended?.industryJobs) ? extended.industryJobs : [];
    const corpJobs = Array.isArray(extended?.corporation?.industryJobs) ? extended.corporation.industryJobs : [];
    return [
      ...blueprints.map((blueprint: any) => Number(blueprint.type_id ?? 0)),
      ...corpBlueprints.map((blueprint: any) => Number(blueprint.type_id ?? 0)),
      ...jobs.flatMap((job: any) => [Number(job.blueprint_type_id ?? 0), Number(job.product_type_id ?? 0)]),
      ...corpJobs.flatMap((job: any) => [Number(job.blueprint_type_id ?? 0), Number(job.product_type_id ?? 0)]),
    ];
  }).filter((typeId: number) => typeId > 0))];
  const typeNames = await getIndustrialTypeNames(typeIds);
  let systemCostIndex: any = null;
  try {
    systemCostIndex = await loadPersistedResult<any>("industry-system-cost", await systemCostKey(characterId, snapshot));
  } catch {
    systemCostIndex = null;
  }
  return {
    characterId: String(characterId),
    opportunities: opportunities?.opportunities ?? null,
    opportunityStatus: opportunities?.status ?? null,
    systemCostIndex,
    typeNames,
  };
}

export async function prepareIndustrialCommand(
  characterId: string,
  onProgress?: (percent: number, message: string) => void,
) {
  const snapshot = requireSnapshot(characterId);
  const extended = snapshot.extended as any;
  const uniqueBlueprintTypeIds = [...new Set([
    ...(Array.isArray(extended?.blueprints) ? extended.blueprints : []),
    ...(Array.isArray(extended?.corporation?.blueprints) ? extended.corporation.blueprints : []),
  ].map((blueprint: any) => Number(blueprint.type_id ?? 0)).filter((typeId: number) => typeId > 0))];

  onProgress?.(3, `${snapshot.character?.name ?? "Character"}: preparing current-system industry costs.`);
  try {
    await getSystemCostIndexPrepared(characterId);
  } catch {
    // Characters without a resolved system can still prepare every other industrial view.
  }

  for (let index = 0; index < uniqueBlueprintTypeIds.length; index += 1) {
    await getBlueprintActivitiesPrepared({ characterId, blueprintTypeId: uniqueBlueprintTypeIds[index] });
    const percent = 10 + ((index + 1) / Math.max(1, uniqueBlueprintTypeIds.length)) * 25;
    onProgress?.(percent, `${snapshot.character?.name ?? "Character"}: preparing blueprint activity intelligence.`);
  }

  const opportunities = await getIndustrialOpportunitiesPrepared(
    {
      characterId,
      systemQuery: "",
      maxJumps: null,
      security: ["high", "low", "null"],
      includeConnectedStock: false,
      sharedCharacterIds: [],
    },
    {
      onProgress: (percent, message) => onProgress?.(35 + percent * 0.65, `${snapshot.character?.name ?? "Character"}: ${message}`),
    },
  );
  onProgress?.(100, `${snapshot.character?.name ?? "Character"}: Industrial Command ready.`);
  return {
    blueprintActivities: uniqueBlueprintTypeIds.length,
    opportunities: opportunities.opportunities.length,
  };
}
