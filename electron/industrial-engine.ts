import AdmZip from "adm-zip";
import path from "node:path";
import { STATIC_DATA_ROOT } from "./data-paths";
import { loadLatestMarketDatasetByMode } from "./market-storage";

const ARCHIVE = path.join(STATIC_DATA_ROOT, "eve-static-data-jsonl.zip");

type BlueprintMaterial = { typeID: number; quantity: number };
type BlueprintProduct = { typeID: number; quantity: number; probability?: number };
type BlueprintSkill = { typeID: number; level: number };
type BlueprintActivity = {
  materials?: BlueprintMaterial[];
  products?: BlueprintProduct[];
  skills?: BlueprintSkill[];
  time?: number;
};
type BlueprintDefinition = {
  _key: number;
  blueprintTypeID: number;
  maxProductionLimit?: number;
  activities?: Record<string, BlueprintActivity>;
};

type IndustrialIndex = {
  blueprints: Map<number, BlueprintDefinition>;
  names: Map<number, string>;
  volumes: Map<number, number>;
  productBlueprints: Map<number, BlueprintDefinition[]>;
};

let cache: Promise<IndustrialIndex> | undefined;

function index() {
  return (cache ??= Promise.resolve().then(() => {
    const zip = new AdmZip(ARCHIVE);
    const blueprintEntry = zip.getEntry("blueprints.jsonl");
    const typesEntry = zip.getEntry("types.jsonl");
    if (!blueprintEntry || !typesEntry) throw new Error("Official CCP SDE industry data is unavailable.");

    const blueprints = new Map<number, BlueprintDefinition>();
    for (const line of blueprintEntry.getData().toString("utf8").split(/\r?\n/)) {
      if (!line) continue;
      const row = JSON.parse(line) as BlueprintDefinition;
      blueprints.set(row.blueprintTypeID ?? row._key, row);
    }

    const productBlueprints = new Map<number, BlueprintDefinition[]>();
    for (const blueprint of blueprints.values()) {
      for (const product of blueprint.activities?.manufacturing?.products ?? []) {
        const list = productBlueprints.get(product.typeID) ?? [];
        list.push(blueprint);
        productBlueprints.set(product.typeID, list);
      }
    }

    const names = new Map<number, string>();
    const volumes = new Map<number, number>();
    for (const line of typesEntry.getData().toString("utf8").split(/\r?\n/)) {
      if (!line) continue;
      const row = JSON.parse(line) as { _key: number; name?: { en?: string }; volume?: number };
      if (row.name?.en) names.set(row._key, row.name.en);
      volumes.set(row._key, row.volume ?? 0);
    }
    return { blueprints, names, volumes, productBlueprints };
  }));
}

type IndustrialMarketQuote = {
  typeId: number;
  bestSell: number | null;
  bestBuy: number | null;
  sellRegion?: string;
  sellLocation?: string;
  buyRegion?: string;
  buyLocation?: string;
};

async function marketPrices(typeIds: number[]) {
  const dataset = await loadLatestMarketDatasetByMode("all");
  const wanted = new Set(typeIds);
  const quotes = new Map<number, IndustrialMarketQuote>();
  if (!dataset) return { createdAt: null as string | null, quotes };
  for (const region of dataset.summaries as any[]) {
    for (const item of region?.items ?? []) {
      if (!wanted.has(item.typeId)) continue;
      const current: IndustrialMarketQuote = quotes.get(item.typeId) ?? { typeId: Number(item.typeId), bestSell: null, bestBuy: null };
      if (typeof item.bestSell === "number" && (current.bestSell == null || item.bestSell < current.bestSell)) {
        const order = (item.topSellOrders ?? []).find((entry: any) => entry.price === item.bestSell) ?? item.topSellOrders?.[0];
        current.bestSell = item.bestSell;
        current.sellRegion = region.regionName;
        current.sellLocation = order?.locationName;
      }
      if (typeof item.bestBuy === "number" && (current.bestBuy == null || item.bestBuy > current.bestBuy)) {
        const order = (item.topBuyOrders ?? []).find((entry: any) => entry.price === item.bestBuy) ?? item.topBuyOrders?.[0];
        current.bestBuy = item.bestBuy;
        current.buyRegion = region.regionName;
        current.buyLocation = order?.locationName;
      }
      quotes.set(item.typeId, current);
    }
  }
  return { createdAt: dataset.createdAt, quotes };
}

function trainedSkillMap(snapshot: any) {
  return new Map<number, number>(
    (snapshot?.skills?.skills ?? []).map((skill: any) => [Number(skill.skill_id), Number(skill.trained_skill_level ?? 0)]),
  );
}

export async function analyzeManufacturingPlan(input: {
  blueprintTypeId: number;
  materialEfficiency?: number;
  timeEfficiency?: number;
  targetQuantity?: number;
  runs?: number;
  availableRuns?: number;
  assets?: Array<{ type_id?: number; quantity?: number }>;
  stockSources?: Array<{ characterId: string; characterName: string; assets: Array<{ type_id?: number; quantity?: number }> }>;
  ownedBlueprints?: Array<{ characterId: string; characterName: string; blueprintTypeId: number; materialEfficiency?: number; timeEfficiency?: number; availableRuns?: number; trainedSkills?: Array<{ skillId: number; level: number }> }>;
  snapshot?: any;
}) {
  const { blueprints, names, volumes, productBlueprints } = await index();
  const blueprint = blueprints.get(input.blueprintTypeId);
  const manufacturing = blueprint?.activities?.manufacturing;
  if (!blueprint || !manufacturing?.products?.length) {
    throw new Error(`${names.get(input.blueprintTypeId) ?? `Blueprint ${input.blueprintTypeId}`} has no manufacturing activity in the CCP SDE.`);
  }

  const primaryProduct = manufacturing.products[0];
  const productPerRun = Math.max(1, primaryProduct.quantity || 1);
  const requestedUnits = Math.max(1, Math.floor(input.targetQuantity ?? productPerRun));
  const requestedRuns = Math.max(1, Math.floor(input.runs ?? Math.ceil(requestedUnits / productPerRun)));
  const outputQuantity = requestedRuns * productPerRun;
  const me = Math.max(0, Math.min(10, Number(input.materialEfficiency ?? 0)));
  const te = Math.max(0, Math.min(20, Number(input.timeEfficiency ?? 0)));

  const stockSources = input.stockSources?.length
    ? input.stockSources
    : [{ characterId: String(input.snapshot?.characterId ?? "selected"), characterName: String(input.snapshot?.character?.name ?? "Selected character"), assets: input.assets ?? [] }];
  const stockByOwner = stockSources.map((source) => {
    const quantities = new Map<number, number>();
    for (const asset of source.assets ?? []) {
      const typeId = Number(asset.type_id ?? 0);
      const quantity = Number(asset.quantity ?? 0);
      if (typeId > 0 && quantity > 0) quantities.set(typeId, (quantities.get(typeId) ?? 0) + quantity);
    }
    return { characterId: source.characterId, characterName: source.characterName, quantities };
  });

  const ownedBlueprints = input.ownedBlueprints ?? [];

  const chainStock = stockByOwner.map((owner) => ({
    characterId: owner.characterId,
    characterName: owner.characterName,
    quantities: new Map(owner.quantities),
  }));
  function allocateChainStock(typeId: number, quantity: number) {
    let remaining = Math.max(0, quantity);
    const contributions: Array<{ characterId: string; characterName: string; used: number }> = [];
    for (const owner of chainStock) {
      if (remaining <= 0) break;
      const available = owner.quantities.get(typeId) ?? 0;
      if (available <= 0) continue;
      const used = Math.min(remaining, available);
      owner.quantities.set(typeId, available - used);
      remaining -= used;
      contributions.push({ characterId: owner.characterId, characterName: owner.characterName, used });
    }
    return { used: quantity - remaining, remaining, contributions };
  }
  function blueprintChoicesForProduct(productTypeId: number, quantity: number) {
    return (productBlueprints.get(productTypeId) ?? []).flatMap((definition) => {
      const activity = definition.activities?.manufacturing;
      const product = activity?.products?.find((item) => item.typeID === productTypeId);
      const perRun = Math.max(1, product?.quantity ?? 1);
      const runsNeeded = Math.ceil(quantity / perRun);
      return ownedBlueprints
        .filter((owned) => owned.blueprintTypeId === definition.blueprintTypeID)
        .map((owned) => {
          const unlimited = owned.availableRuns == null || owned.availableRuns < 0;
          const buildRuns = unlimited ? runsNeeded : Math.min(runsNeeded, Math.max(0, Number(owned.availableRuns ?? 0)));
          const trained = new Map((owned.trainedSkills ?? []).map((skill) => [skill.skillId, skill.level]));
          const skillRequirements = (activity?.skills ?? []).map((skill) => ({ typeId: skill.typeID, name: names.get(skill.typeID) ?? `Skill ${skill.typeID}`, requiredLevel: skill.level, trainedLevel: trained.get(skill.typeID) ?? 0, met: owned.trainedSkills == null ? true : (trained.get(skill.typeID) ?? 0) >= skill.level }));
          return { definition, activity, owned, perRun, runsNeeded, buildRuns, canCoverRuns: buildRuns >= runsNeeded, skillRequirements, skillsReady: skillRequirements.every((skill) => skill.met) };
        })
        .filter((choice) => choice.buildRuns > 0)
        .sort((a, b) => Number(b.skillsReady) - Number(a.skillsReady) || Number(b.canCoverRuns) - Number(a.canCoverRuns) || b.buildRuns * b.perRun - a.buildRuns * a.perRun || Number(b.owned.materialEfficiency ?? 0) - Number(a.owned.materialEfficiency ?? 0) || Number(b.owned.timeEfficiency ?? 0) - Number(a.owned.timeEfficiency ?? 0));
    });
  }
  function expandChainMaterial(typeId: number, quantity: number, depth: number, ancestry: Set<number>): any {
    const stock = allocateChainStock(typeId, quantity);
    const itemName = names.get(typeId) ?? `Type ${typeId}`;
    if (stock.remaining <= 0) return { typeId, name: itemName, required: quantity, stockUsed: stock.used, stockContributions: stock.contributions, remaining: 0, mode: "stock", depth };
    if (depth >= 6 || ancestry.has(typeId)) return { typeId, name: itemName, required: quantity, stockUsed: stock.used, stockContributions: stock.contributions, remaining: stock.remaining, mode: depth >= 6 ? "depth-limit" : "cycle-guard", depth };
    const choices = blueprintChoicesForProduct(typeId, stock.remaining);
    const choice = choices.find((item) => item.skillsReady);
    if (!choice?.activity?.materials?.length) return { typeId, name: itemName, required: quantity, stockUsed: stock.used, stockContributions: stock.contributions, remaining: stock.remaining, mode: "market", depth };
    const me = Math.max(0, Math.min(10, Number(choice.owned.materialEfficiency ?? 0)));
    const nextAncestry = new Set(ancestry);
    nextAncestry.add(typeId);
    const children = choice.activity.materials.map((material) => {
      const baseRequired = material.quantity * choice.buildRuns;
      const required = Math.max(1, Math.ceil(baseRequired * (1 - me / 100) - 1e-12));
      return expandChainMaterial(material.typeID, required, depth + 1, nextAncestry);
    });
    return {
      typeId, name: itemName, required: quantity, stockUsed: stock.used, stockContributions: stock.contributions, remaining: stock.remaining, marketRemainder: Math.max(0, stock.remaining - choice.buildRuns * choice.perRun), mode: choice.canCoverRuns ? "build" : "mixed-build-market", depth,
      blueprint: {
        characterId: choice.owned.characterId, characterName: choice.owned.characterName, blueprintTypeId: choice.owned.blueprintTypeId,
        blueprintName: names.get(choice.owned.blueprintTypeId) ?? `Blueprint ${choice.owned.blueprintTypeId}`,
        materialEfficiency: me, timeEfficiency: Number(choice.owned.timeEfficiency ?? 0),
        availableRuns: choice.owned.availableRuns == null || choice.owned.availableRuns < 0 ? null : choice.owned.availableRuns,
        runs: choice.buildRuns, requestedRuns: choice.runsNeeded, canCoverRuns: choice.canCoverRuns, skillsReady: choice.skillsReady, skillRequirements: choice.skillRequirements, outputPerRun: choice.perRun, outputQuantity: choice.buildRuns * choice.perRun,
      },
      children,
    };
  }

  const materials = (manufacturing.materials ?? []).map((material) => {
    const baseRequired = material.quantity * requestedRuns;
    // Blueprint ME is applied to the whole job and rounded up to whole items.
    // Facility/rig/system modifiers are intentionally separate future inputs.
    const required = Math.max(1, Math.ceil(baseRequired * (1 - me / 100) - 1e-12));
    const ownership = stockByOwner.map((owner) => ({
      characterId: owner.characterId,
      characterName: owner.characterName,
      owned: owner.quantities.get(material.typeID) ?? 0,
      used: 0,
    })).filter((owner) => owner.owned > 0);
    let remaining = required;
    for (const owner of ownership) {
      owner.used = Math.min(remaining, owner.owned);
      remaining -= owner.used;
      if (remaining <= 0) break;
    }
    const owned = ownership.reduce((sum, owner) => sum + owner.owned, 0);
    const usedFromStock = ownership.reduce((sum, owner) => sum + owner.used, 0);
    const missing = Math.max(0, remaining);
    return {
      typeId: material.typeID,
      name: names.get(material.typeID) ?? `Type ${material.typeID}`,
      basePerRun: material.quantity,
      baseRequired,
      required,
      owned,
      usedFromStock,
      missing,
      volumeM3: (volumes.get(material.typeID) ?? 0) * missing,
      ownership,
      buildOptions: (productBlueprints.get(material.typeID) ?? []).flatMap((definition) =>
        ownedBlueprints.filter((owned) => owned.blueprintTypeId === definition.blueprintTypeID).map((owned) => {
          const activity = definition.activities?.manufacturing;
          const product = activity?.products?.find((item) => item.typeID === material.typeID);
          const perRun = Math.max(1, product?.quantity ?? 1);
          const runsNeeded = Math.ceil(missing / perRun);
          return {
            characterId: owned.characterId,
            characterName: owned.characterName,
            blueprintTypeId: owned.blueprintTypeId,
            blueprintName: names.get(owned.blueprintTypeId) ?? `Blueprint ${owned.blueprintTypeId}`,
            materialEfficiency: Number(owned.materialEfficiency ?? 0),
            timeEfficiency: Number(owned.timeEfficiency ?? 0),
            availableRuns: owned.availableRuns == null || owned.availableRuns < 0 ? null : owned.availableRuns,
            runsNeeded,
            canCoverRuns: owned.availableRuns == null || owned.availableRuns < 0 || runsNeeded <= owned.availableRuns,
            outputPerRun: perRun,
            skillRequirements: (activity?.skills ?? []).map((skill) => { const trained = new Map((owned.trainedSkills ?? []).map((entry) => [entry.skillId, entry.level])); const trainedLevel = trained.get(skill.typeID) ?? 0; return { typeId: skill.typeID, name: names.get(skill.typeID) ?? `Skill ${skill.typeID}`, requiredLevel: skill.level, trainedLevel, met: owned.trainedSkills == null ? true : trainedLevel >= skill.level }; }),
          };
        })
      ),
    };
  });

  const trained = trainedSkillMap(input.snapshot);
  const skills = (manufacturing.skills ?? []).map((skill) => {
    const trainedLevel = trained.get(skill.typeID) ?? 0;
    return {
      typeId: skill.typeID,
      name: names.get(skill.typeID) ?? `Skill ${skill.typeID}`,
      requiredLevel: skill.level,
      trainedLevel,
      met: trainedLevel >= skill.level,
    };
  });

  const productionChain = materials.map((material) => expandChainMaterial(material.typeId, material.required, 0, new Set([primaryProduct.typeID])));
  const chainLeaves = new Map<number, number>();
  function collectChainLeaves(node: any) {
    if (node.mode === "build" || node.mode === "mixed-build-market") {
      for (const child of node.children ?? []) collectChainLeaves(child);
      if (node.mode === "mixed-build-market" && node.marketRemainder > 0) chainLeaves.set(node.typeId, (chainLeaves.get(node.typeId) ?? 0) + node.marketRemainder);
      return;
    }
    if ((node.mode === "market" || node.mode === "depth-limit" || node.mode === "cycle-guard") && node.remaining > 0) chainLeaves.set(node.typeId, (chainLeaves.get(node.typeId) ?? 0) + node.remaining);
  }
  for (const node of productionChain) collectChainLeaves(node);
  const market = await marketPrices([primaryProduct.typeID, ...materials.map((item) => item.typeId), ...chainLeaves.keys()]);
  const pricedMaterials = materials.map((item) => {
    const quote = market.quotes.get(item.typeId);
    const bestSell = quote?.bestSell ?? null;
    return {
      ...item,
      bestSell,
      bestBuy: quote?.bestBuy ?? null,
      sourceRegion: quote?.sellRegion,
      sourceLocation: quote?.sellLocation,
      missingMarketCost: bestSell == null ? null : item.missing * bestSell,
      fullMarketCost: bestSell == null ? null : item.required * bestSell,
    };
  });
  const shortageMarketCost = pricedMaterials.every((item) => item.missing === 0 || item.missingMarketCost != null)
    ? pricedMaterials.reduce((sum, item) => sum + (item.missingMarketCost ?? 0), 0)
    : null;
  const fullBomMarketCost = pricedMaterials.every((item) => item.fullMarketCost != null)
    ? pricedMaterials.reduce((sum, item) => sum + (item.fullMarketCost ?? 0), 0)
    : null;
  const productQuote = market.quotes.get(primaryProduct.typeID);
  const finishedBuyCost = productQuote?.bestSell == null ? null : productQuote.bestSell * outputQuantity;
  const immediateSaleRevenue = productQuote?.bestBuy == null ? null : productQuote.bestBuy * outputQuantity;
  const cashBuildVsBuyDelta = shortageMarketCost == null || finishedBuyCost == null ? null : finishedBuyCost - shortageMarketCost;
  const economicBuildVsBuyDelta = fullBomMarketCost == null || finishedBuyCost == null ? null : finishedBuyCost - fullBomMarketCost;

  const availableRuns = input.availableRuns == null || input.availableRuns < 0 ? null : Math.max(0, Math.floor(input.availableRuns));
  const baseTimeSeconds = Math.max(0, manufacturing.time ?? 0) * requestedRuns;
  const blueprintTimeSeconds = Math.ceil(baseTimeSeconds * (1 - te / 100));

  return {
    blueprintTypeId: input.blueprintTypeId,
    blueprintName: names.get(input.blueprintTypeId) ?? `Blueprint ${input.blueprintTypeId}`,
    productTypeId: primaryProduct.typeID,
    productName: names.get(primaryProduct.typeID) ?? `Type ${primaryProduct.typeID}`,
    productPerRun,
    requestedUnits,
    runs: requestedRuns,
    outputQuantity,
    materialEfficiency: me,
    timeEfficiency: te,
    maxProductionLimit: blueprint.maxProductionLimit ?? null,
    availableRuns,
    runsAvailable: availableRuns == null || requestedRuns <= availableRuns,
    baseTimeSeconds,
    blueprintTimeSeconds,
    materials: pricedMaterials,
    productionChain,
    chainLeafRequirements: [...chainLeaves.entries()].map(([typeId, quantity]) => {
      const quote = market.quotes.get(typeId);
      return { typeId, name: names.get(typeId) ?? `Type ${typeId}`, quantity, bestSell: quote?.bestSell ?? null, marketCost: quote?.bestSell == null ? null : quantity * quote.bestSell, sourceRegion: quote?.sellRegion, sourceLocation: quote?.sellLocation };
    }),
    market: {
      available: Boolean(market.createdAt),
      createdAt: market.createdAt,
      shortageMarketCost,
      fullBomMarketCost,
      productBestSell: productQuote?.bestSell ?? null,
      productBestBuy: productQuote?.bestBuy ?? null,
      productSellRegion: productQuote?.sellRegion,
      productSellLocation: productQuote?.sellLocation,
      finishedBuyCost,
      immediateSaleRevenue,
      cashBuildVsBuyDelta,
      economicBuildVsBuyDelta,
      ownedChainMarketCost: [...chainLeaves.entries()].every(([typeId]) => market.quotes.get(typeId)?.bestSell != null)
        ? [...chainLeaves.entries()].reduce((sum, [typeId, quantity]) => sum + quantity * Number(market.quotes.get(typeId)?.bestSell ?? 0), 0)
        : null,
    },
    totalMissingStacks: materials.filter((item) => item.missing > 0).length,
    totalMissingUnits: pricedMaterials.reduce((sum, item) => sum + item.missing, 0),
    missingVolumeM3: pricedMaterials.reduce((sum, item) => sum + item.volumeM3, 0),
    skills,
    skillsReady: skills.every((skill) => skill.met),
    source: "CCP EVE static data (offline)",
    stockSources: stockByOwner.map((owner) => ({ characterId: owner.characterId, characterName: owner.characterName })),
    scope: `Blueprint ME/TE + ${stockByOwner.length > 1 ? "connected-character stock with ownership preserved" : "selected-character stock"}; facility, rig and final installation-cost modifiers are not yet applied.`,
  };
}


export async function analyzeBlueprintActivities(input: { blueprintTypeId: number; snapshot?: any }) {
  const { blueprints, names } = await index();
  const blueprint = blueprints.get(input.blueprintTypeId);
  if (!blueprint) throw new Error(`${names.get(input.blueprintTypeId) ?? `Blueprint ${input.blueprintTypeId}`} is not present in the CCP blueprint SDE.`);
  const trained = trainedSkillMap(input.snapshot);
  const labels: Record<string, string> = { copying: "Copying", invention: "Invention", research_material: "Material Efficiency Research", research_time: "Time Efficiency Research", manufacturing: "Manufacturing", reaction: "Reaction" };
  const activityOrder = ["copying", "invention", "research_material", "research_time", "manufacturing", "reaction"];
  const activities = activityOrder.flatMap((activityId) => {
    const activity = blueprint.activities?.[activityId];
    if (!activity) return [];
    return [{
      id: activityId,
      label: labels[activityId] ?? activityId,
      baseTimeSeconds: Math.max(0, activity.time ?? 0),
      materials: (activity.materials ?? []).map((material) => ({ typeId: material.typeID, name: names.get(material.typeID) ?? `Type ${material.typeID}`, quantity: material.quantity })),
      products: (activity.products ?? []).map((product) => ({ typeId: product.typeID, name: names.get(product.typeID) ?? `Type ${product.typeID}`, quantity: product.quantity, probability: product.probability ?? null })),
      skills: (activity.skills ?? []).map((skill) => { const trainedLevel = trained.get(skill.typeID) ?? 0; return { typeId: skill.typeID, name: names.get(skill.typeID) ?? `Skill ${skill.typeID}`, requiredLevel: skill.level, trainedLevel, met: trainedLevel >= skill.level }; }),
    }];
  });
  return { blueprintTypeId: input.blueprintTypeId, blueprintName: names.get(input.blueprintTypeId) ?? `Blueprint ${input.blueprintTypeId}`, maxProductionLimit: blueprint.maxProductionLimit ?? null, activities, source: "CCP EVE static data (offline)" };
}


type IndustrySystemRow = { solar_system_id: number; cost_indices: Array<{ activity: string; cost_index: number }> };
let industrySystemCache: { expiresAt: number; rows: IndustrySystemRow[] } | null = null;

async function industrySystems() {
  if (industrySystemCache && industrySystemCache.expiresAt > Date.now()) return industrySystemCache.rows;
  const response = await fetch("https://esi.evetech.net/industry/systems/?datasource=tranquility", { headers: { "X-Compatibility-Date": "2026-08-02", "X-User-Agent": "NewEdenSage/0.1.12" } });
  if (!response.ok) throw new Error(`EVE industry system indices failed (${response.status}).`);
  const rows = await response.json() as IndustrySystemRow[];
  industrySystemCache = { rows, expiresAt: Date.now() + 55 * 60 * 1000 };
  return rows;
}

export async function getIndustrySystemCostIndices(solarSystemId: number) {
  const row = (await industrySystems()).find((item) => item.solar_system_id === solarSystemId);
  return {
    solarSystemId,
    available: Boolean(row),
    indices: Object.fromEntries((row?.cost_indices ?? []).map((item) => [item.activity, item.cost_index])),
    fetchedAt: new Date().toISOString(),
    source: "EVE ESI /industry/systems",
  };
}
