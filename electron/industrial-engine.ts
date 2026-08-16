import AdmZip from "adm-zip";
import path from "node:path";
import fs from "node:fs/promises";
import { promisify } from "node:util";
import { gzip, gunzip } from "node:zlib";
import { STATIC_DATA_ROOT } from "./data-paths";
import { ensureStaticDataArchive, INDUSTRIAL_PREPARED_CACHE, prepareStaticDataForProcess } from "./type-volumes";
import { loadLatestMarketDatasetByMode } from "./market-storage";

const ARCHIVE = path.join(STATIC_DATA_ROOT, "eve-static-data-jsonl.zip");
const INDUSTRIAL_PREPARED_SCHEMA = 1;
const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

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

type SerializedIndustrialIndex = {
  schema: number;
  generatedAt: string;
  blueprints: Array<[number, BlueprintDefinition]>;
  names: Array<[number, string]>;
  volumes: Array<[number, number]>;
  productBlueprints: Array<[number, number[]]>;
};

async function readPreparedIndustrialIndex(): Promise<IndustrialIndex | undefined> {
  try {
    const parsed = JSON.parse((await gunzipAsync(await fs.readFile(INDUSTRIAL_PREPARED_CACHE))).toString("utf8")) as SerializedIndustrialIndex;
    if (parsed.schema !== INDUSTRIAL_PREPARED_SCHEMA || !Array.isArray(parsed.blueprints) || !Array.isArray(parsed.names) || !Array.isArray(parsed.volumes) || !Array.isArray(parsed.productBlueprints))
      return undefined;
    const blueprints = new Map(parsed.blueprints.map(([id, value]) => [Number(id), value]));
    return {
      blueprints,
      names: new Map(parsed.names.map(([id, value]) => [Number(id), String(value)])),
      volumes: new Map(parsed.volumes.map(([id, value]) => [Number(id), Number(value)])),
      productBlueprints: new Map(parsed.productBlueprints.map(([productId, blueprintIds]) => [Number(productId), blueprintIds.map((id) => blueprints.get(Number(id))).filter((value): value is BlueprintDefinition => Boolean(value))])),
    };
  } catch {
    return undefined;
  }
}

async function savePreparedIndustrialIndex(index: IndustrialIndex) {
  await fs.mkdir(path.dirname(INDUSTRIAL_PREPARED_CACHE), { recursive: true });
  const payload: SerializedIndustrialIndex = {
    schema: INDUSTRIAL_PREPARED_SCHEMA,
    generatedAt: new Date().toISOString(),
    blueprints: [...index.blueprints],
    names: [...index.names],
    volumes: [...index.volumes],
    productBlueprints: [...index.productBlueprints].map(([productId, blueprints]) => [productId, blueprints.map((blueprint) => blueprint.blueprintTypeID ?? blueprint._key)]),
  };
  const partial = `${INDUSTRIAL_PREPARED_CACHE}.${process.pid}.partial`;
  await fs.writeFile(partial, await gzipAsync(Buffer.from(JSON.stringify(payload), "utf8"), { level: 6 }));
  await fs.rm(INDUSTRIAL_PREPARED_CACHE, { force: true }).catch(() => undefined);
  await fs.rename(partial, INDUSTRIAL_PREPARED_CACHE);
}

function index() {
  return (cache ??= Promise.resolve().then(async () => {
    const processState = await prepareStaticDataForProcess();
    if (!processState.promoted) {
      const prepared = await readPreparedIndustrialIndex();
      if (prepared) return prepared;
    }
    await ensureStaticDataArchive();
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
    const value = { blueprints, names, volumes, productBlueprints };
    await savePreparedIndustrialIndex(value);
    return value;
  }));
}

type OwnedAssetStack = { item_id?: number; type_id?: number; quantity?: number; sourceAssetId?: string; ownerCharacterId?: string };

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
  assets?: OwnedAssetStack[];
  stockSources?: Array<{ characterId: string; characterName: string; assets: OwnedAssetStack[] }>;
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
    const stacks = new Map<number, Array<{ sourceAssetId: string; quantity: number }>>();
    for (const [assetIndex, asset] of (source.assets ?? []).entries()) {
      const typeId = Number(asset.type_id ?? 0);
      const quantity = Number(asset.quantity ?? 0);
      if (typeId <= 0 || quantity <= 0) continue;
      quantities.set(typeId, (quantities.get(typeId) ?? 0) + quantity);
      const list = stacks.get(typeId) ?? [];
      list.push({ sourceAssetId: asset.sourceAssetId ?? `${source.characterId}:${asset.item_id ?? `stack-${assetIndex}`}`, quantity });
      stacks.set(typeId, list);
    }
    return { characterId: source.characterId, characterName: source.characterName, quantities, stacks };
  });

  const ownedBlueprints = input.ownedBlueprints ?? [];

  const chainStock = stockByOwner.map((owner) => ({
    characterId: owner.characterId,
    characterName: owner.characterName,
    quantities: new Map(owner.quantities),
    stacks: new Map([...owner.stacks.entries()].map(([typeId, stacks]) => [typeId, stacks.map((stack) => ({ ...stack }))])),
  }));
  function allocateChainStock(typeId: number, quantity: number) {
    let remaining = Math.max(0, quantity);
    const contributions: Array<{ characterId: string; characterName: string; used: number; sourceAssetIds: string[] }> = [];
    for (const owner of chainStock) {
      if (remaining <= 0) break;
      const available = owner.quantities.get(typeId) ?? 0;
      if (available <= 0) continue;
      let ownerUsed = 0;
      const sourceAssetIds: string[] = [];
      for (const stack of owner.stacks.get(typeId) ?? []) {
        if (remaining <= 0) break;
        if (stack.quantity <= 0) continue;
        const stackUsed = Math.min(remaining, stack.quantity);
        stack.quantity -= stackUsed;
        remaining -= stackUsed;
        ownerUsed += stackUsed;
        if (stackUsed > 0) sourceAssetIds.push(stack.sourceAssetId);
      }
      if (ownerUsed > 0) {
        owner.quantities.set(typeId, Math.max(0, available - ownerUsed));
        contributions.push({ characterId: owner.characterId, characterName: owner.characterName, used: ownerUsed, sourceAssetIds });
      }
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
      sourceAssetIds: (owner.stacks.get(material.typeID) ?? []).map((stack) => stack.sourceAssetId),
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
    stockSources: stockByOwner.map((owner) => ({ characterId: owner.characterId, characterName: owner.characterName, assetStackCount: [...owner.stacks.values()].reduce((sum, stacks) => sum + stacks.length, 0) })),
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


export async function prepareIndustrialDataLocal() {
  const value = await index();
  return { blueprints: value.blueprints.size, namedTypes: value.names.size, productMappings: value.productBlueprints.size };
}

const INVENTION_DECRYPTORS = [
  { typeId: 34201, name: "Accelerant Decryptor", probabilityMultiplier: 1.2, runModifier: 1, meModifier: 2, teModifier: 10 },
  { typeId: 34202, name: "Attainment Decryptor", probabilityMultiplier: 1.8, runModifier: 4, meModifier: -1, teModifier: 4 },
  { typeId: 34203, name: "Augmentation Decryptor", probabilityMultiplier: 0.6, runModifier: 9, meModifier: -2, teModifier: 2 },
  { typeId: 34204, name: "Parity Decryptor", probabilityMultiplier: 1.5, runModifier: 3, meModifier: 1, teModifier: -2 },
  { typeId: 34205, name: "Process Decryptor", probabilityMultiplier: 1.1, runModifier: 0, meModifier: 3, teModifier: 6 },
  { typeId: 34206, name: "Symmetry Decryptor", probabilityMultiplier: 1, runModifier: 2, meModifier: 1, teModifier: 8 },
  { typeId: 34207, name: "Optimized Attainment Decryptor", probabilityMultiplier: 1.9, runModifier: 2, meModifier: 1, teModifier: -2 },
  { typeId: 34208, name: "Optimized Augmentation Decryptor", probabilityMultiplier: 0.9, runModifier: 7, meModifier: 2, teModifier: 0 },
] as const;

export async function analyzeInventionOpportunities(input: { snapshot?: any; decryptorTypeId?: number | null }) {
  const { blueprints, names } = await index();
  const trained = trainedSkillMap(input.snapshot);
  const selectedDecryptor = INVENTION_DECRYPTORS.find((item) => item.typeId === Number(input.decryptorTypeId ?? 0)) ?? null;
  const ownedOriginals = new Set<number>(
    [
      ...(Array.isArray(input.snapshot?.extended?.blueprints) ? input.snapshot.extended.blueprints : []),
      ...(Array.isArray(input.snapshot?.extended?.corporation?.blueprints) ? input.snapshot.extended.corporation.blueprints : []),
    ]
      .filter((blueprint: any) => Number(blueprint.quantity) === -1)
      .map((blueprint: any) => Number(blueprint.type_id)),
  );
  const candidates: Array<{
    sourceBlueprint: BlueprintDefinition;
    invention: BlueprintActivity;
    inventedBlueprint: BlueprintDefinition;
    inventionProduct: BlueprintProduct;
    manufacturing: BlueprintActivity;
    finalProduct: BlueprintProduct;
  }> = [];
  const priceTypeIds = new Set<number>();
  for (const decryptor of INVENTION_DECRYPTORS) priceTypeIds.add(decryptor.typeId);
  for (const sourceBlueprint of blueprints.values()) {
    const invention = sourceBlueprint.activities?.invention;
    if (!invention?.products?.length) continue;
    priceTypeIds.add(sourceBlueprint.blueprintTypeID ?? sourceBlueprint._key);
    for (const material of invention.materials ?? []) priceTypeIds.add(material.typeID);
    for (const inventionProduct of invention.products) {
      const inventedBlueprint = blueprints.get(inventionProduct.typeID);
      const manufacturing = inventedBlueprint?.activities?.manufacturing;
      const finalProduct = manufacturing?.products?.[0];
      if (!inventedBlueprint || !manufacturing || !finalProduct) continue;
      priceTypeIds.add(finalProduct.typeID);
      for (const material of manufacturing.materials ?? []) priceTypeIds.add(material.typeID);
      candidates.push({ sourceBlueprint, invention, inventedBlueprint, inventionProduct, manufacturing, finalProduct });
    }
  }
  const market = await marketPrices([...priceTypeIds]);
  const decryptors = INVENTION_DECRYPTORS.map((decryptor) => ({
    ...decryptor,
    marketCost: market.quotes.get(decryptor.typeId)?.bestSell ?? null,
  }));
  const selectedDecryptorCost = selectedDecryptor ? market.quotes.get(selectedDecryptor.typeId)?.bestSell ?? null : 0;
  const priced = candidates.map((candidate) => {
    const sourceBlueprintTypeId = candidate.sourceBlueprint.blueprintTypeID ?? candidate.sourceBlueprint._key;
    const inventedBlueprintTypeId = candidate.inventedBlueprint.blueprintTypeID ?? candidate.inventedBlueprint._key;
    const ownsSourceOriginal = ownedOriginals.has(sourceBlueprintTypeId);
    const priceLines = (materials: BlueprintMaterial[]) => materials.map((material) => {
      const unitPrice = market.quotes.get(material.typeID)?.bestSell ?? null;
      return { typeId: material.typeID, name: names.get(material.typeID) ?? `Type ${material.typeID}`, quantity: material.quantity, unitPrice, cost: unitPrice == null ? null : unitPrice * material.quantity };
    });
    const inventionMaterials = priceLines(candidate.invention.materials ?? []);
    const skillRequirements = (candidate.invention.skills ?? []).map((skill) => ({
      typeId: skill.typeID,
      name: names.get(skill.typeID) ?? `Skill ${skill.typeID}`,
      requiredLevel: skill.level,
      trainedLevel: trained.get(skill.typeID) ?? 0,
    }));
    const encryptionSkill = skillRequirements.find((skill) => /Encryption Methods/i.test(skill.name)) ?? skillRequirements[0];
    const scienceSkills = skillRequirements.filter((skill) => skill.typeId !== encryptionSkill?.typeId).slice(0, 2);
    const skillProbabilityMultiplier = 1 + Number(encryptionSkill?.trainedLevel ?? 0) / 40 + scienceSkills.reduce((sum, skill) => sum + skill.trainedLevel, 0) / 30;
    const baseProbability = candidate.inventionProduct.probability ?? null;
    const probability = baseProbability == null ? null : Math.min(1, baseProbability * skillProbabilityMultiplier * (selectedDecryptor?.probabilityMultiplier ?? 1));
    const maxSkillProbabilityMultiplier = 1 + 5 / 40 + 10 / 30;
    const maxSkillsProbability = baseProbability == null ? null : Math.min(1, baseProbability * maxSkillProbabilityMultiplier * (selectedDecryptor?.probabilityMultiplier ?? 1));
    const skillImpacts = skillRequirements.map((skill) => {
      const encryption = skill.typeId === encryptionSkill?.typeId;
      const divisor = encryption ? 40 : 30;
      return {
        ...skill,
        role: encryption ? "Encryption method" : "Science field",
        currentRelativeBoost: skill.trainedLevel / divisor,
        maximumRelativeBoost: 5 / divisor,
        remainingRelativeBoost: Math.max(0, (5 - skill.trainedLevel) / divisor),
      };
    });
    const outputRuns = Math.max(1, Number(candidate.inventionProduct.quantity || 1) + Number(selectedDecryptor?.runModifier ?? 0));
    const materialEfficiency = 2 + Number(selectedDecryptor?.meModifier ?? 0);
    const timeEfficiency = 4 + Number(selectedDecryptor?.teModifier ?? 0);
    const manufacturingMaterials = (candidate.manufacturing.materials ?? []).map((material) => {
      const quantity = Math.max(1, Math.ceil(material.quantity * outputRuns * (1 - materialEfficiency / 100) - 1e-12));
      const unitPrice = market.quotes.get(material.typeID)?.bestSell ?? null;
      return { typeId: material.typeID, name: names.get(material.typeID) ?? `Type ${material.typeID}`, quantity, unitPrice, cost: unitPrice == null ? null : unitPrice * quantity };
    });
    const manufacturingMaterialsPerRun = (candidate.manufacturing.materials ?? []).map((material) => {
      const quantity = Math.max(1, Math.ceil(material.quantity * (1 - materialEfficiency / 100) - 1e-12));
      const unitPrice = market.quotes.get(material.typeID)?.bestSell ?? null;
      return { typeId: material.typeID, name: names.get(material.typeID) ?? `Type ${material.typeID}`, quantity, unitPrice, cost: unitPrice == null ? null : unitPrice * quantity };
    });
    const inventionMaterialCost = inventionMaterials.every((line) => line.cost != null) ? inventionMaterials.reduce((sum, line) => sum + Number(line.cost), 0) : null;
    const manufacturingCost = manufacturingMaterials.every((line) => line.cost != null) ? manufacturingMaterials.reduce((sum, line) => sum + Number(line.cost), 0) : null;
    const sourceBlueprintMarketCost = ownsSourceOriginal ? 0 : market.quotes.get(sourceBlueprintTypeId)?.bestSell ?? null;
    const outputQuantity = Math.max(1, candidate.finalProduct.quantity || 1) * outputRuns;
    const productQuote = market.quotes.get(candidate.finalProduct.typeID);
    const immediateSaleRevenue = productQuote?.bestBuy == null ? null : productQuote.bestBuy * outputQuantity;
    const attemptCost = inventionMaterialCost == null || sourceBlueprintMarketCost == null || selectedDecryptorCost == null ? null : inventionMaterialCost + sourceBlueprintMarketCost + selectedDecryptorCost;
    const successCost = attemptCost == null || manufacturingCost == null ? null : attemptCost + manufacturingCost;
    const successfulCopyProfit = successCost == null || immediateSaleRevenue == null ? null : immediateSaleRevenue - successCost;
    const manufacturingCostPerRun = manufacturingMaterialsPerRun.every((line) => line.cost != null) ? manufacturingMaterialsPerRun.reduce((sum, line) => sum + Number(line.cost), 0) : null;
    const revenuePerRun = immediateSaleRevenue == null ? null : immediateSaleRevenue / outputRuns;
    const successfulRunProfit = manufacturingCostPerRun == null || revenuePerRun == null || attemptCost == null ? null : revenuePerRun - manufacturingCostPerRun - attemptCost / outputRuns;
    const expectedProfitPerAttempt = probability == null || inventionMaterialCost == null || manufacturingCost == null || sourceBlueprintMarketCost == null || selectedDecryptorCost == null || immediateSaleRevenue == null
      ? null
      : probability * (immediateSaleRevenue - manufacturingCost) - inventionMaterialCost - sourceBlueprintMarketCost - Number(selectedDecryptorCost ?? 0);
    return {
      sourceBlueprintTypeId,
      sourceBlueprintName: names.get(sourceBlueprintTypeId) ?? `Blueprint ${sourceBlueprintTypeId}`,
      inventedBlueprintTypeId,
      inventedBlueprintName: names.get(inventedBlueprintTypeId) ?? `Blueprint ${inventedBlueprintTypeId}`,
      productTypeId: candidate.finalProduct.typeID,
      productName: names.get(candidate.finalProduct.typeID) ?? `Type ${candidate.finalProduct.typeID}`,
      outputQuantity,
      ownsSourceOriginal,
      sourceCopyCostBasis: ownsSourceOriginal ? "Owned BPO: source-copy acquisition treated as free" : sourceBlueprintMarketCost == null ? "No retained public market quote for source blueprint" : "Lowest retained public sell order for source blueprint",
      sourceBlueprintMarketCost,
      baseProbability,
      probability,
      skillProbabilityMultiplier,
      maxSkillProbabilityMultiplier,
      maxSkillsProbability,
      trainingProbabilityGain: probability == null || maxSkillsProbability == null ? null : Math.max(0, maxSkillsProbability - probability),
      skillImpacts,
      encryptionSkill,
      scienceSkills,
      outputRuns,
      materialEfficiency,
      timeEfficiency,
      selectedDecryptor: selectedDecryptor ? { ...selectedDecryptor, marketCost: selectedDecryptorCost } : null,
      inventionMaterials,
      manufacturingMaterials,
      manufacturingMaterialsPerRun,
      inventionMaterialCost,
      attemptCost,
      manufacturingCost,
      manufacturingCostPerRun,
      immediateSaleRevenue,
      revenuePerRun,
      successfulCopyProfit,
      successfulRunProfit,
      expectedProfitPerAttempt,
      skills: skillRequirements,
    };
  });
  priced.sort((a, b) => (b.expectedProfitPerAttempt ?? Number.NEGATIVE_INFINITY) - (a.expectedProfitPerAttempt ?? Number.NEGATIVE_INFINITY));
  return {
    schema: 4,
    generatedAt: new Date().toISOString(),
    marketCreatedAt: market.createdAt,
    candidateCount: priced.length,
    ownedSourceCount: priced.filter((item) => item.ownsSourceOriginal).length,
    decryptors,
    selectedDecryptorTypeId: selectedDecryptor?.typeId ?? null,
    opportunities: priced,
    notes: [
      "Invented blueprint copies are primarily traded through contracts, not the public regional order book; Sage values the manufacturable output instead of inventing a BPC market price.",
      "Character probability uses the relevant encryption-method skill and two science skills. The selected decryptor changes probability, output runs, ME, TE and attempt cost.",
      "Figures use current retained public orders and do not yet include facility, tax or job-installation modifiers.",
    ],
  };
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
