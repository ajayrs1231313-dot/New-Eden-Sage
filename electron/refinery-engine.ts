import AdmZip from "adm-zip";
import path from "node:path";
import { promises as fs } from "node:fs";
import { STATIC_DATA_ROOT } from "./data-paths";
import { ensureStaticDataArchive } from "./type-volumes";
import { loadGlobalMarketQuotes } from "./market-intelligence";
import { loadPersistedResult, savePersistedResult } from "./persistent-result-cache";

const ARCHIVE = path.join(STATIC_DATA_ROOT, "eve-static-data-jsonl.zip");
const REPROCESSING_SKILL_ID = 3385;
const REPROCESSING_EFFICIENCY_SKILL_ID = 3389;
const PROCESSING_SKILL_ATTRIBUTE_ID = 790;

export type RefineryFacility = "npc" | "athanor" | "tatara";
export type RefineryRig = "none" | "t1" | "t2";
export type RefinerySecurity = "high" | "low" | "null";
export type RefineryImplant = "none" | "rx801" | "rx802" | "rx804";

type SdeType = { _key: number; name?: { en?: string }; groupID?: number; portionSize?: number; volume?: number; published?: boolean };
type SdeGroup = { _key: number; categoryID?: number; name?: { en?: string } };
type SdeMaterialRow = { _key: number; materials?: Array<{ materialTypeID: number; quantity: number }> };
type SdeDogmaRow = { _key: number; dogmaAttributes?: Array<{ attributeID: number; value: number }> };

type RefineryType = {
  typeId: number;
  name: string;
  groupId: number;
  groupName: string;
  portionSize: number;
  volumeM3: number;
  processingSkillId: number | null;
  processingSkillName: string | null;
  outputs: Array<{ typeId: number; name: string; quantity: number }>;
};

type RefineryIndex = { refinables: Map<number, RefineryType> };

export type RefineryStockSource = {
  characterId: string;
  characterName: string;
  assets: Array<{ item_id?: number; type_id?: number; quantity?: number; item?: string; station?: string | null; system?: string | null }>;
};

let refineryIndexPromise: Promise<RefineryIndex | undefined> | undefined;
const REFINERY_CACHE_SCHEMA = 2;
const REFINERY_CACHE_KIND = "refinery-static-v2";

function parseJsonl<T>(entry: AdmZip.IZipEntry | null): T[] {
  if (!entry) return [];
  return entry.getData().toString("utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as T);
}

async function refineryCacheKey() {
  try {
    const stat = await fs.stat(ARCHIVE);
    return { schema: REFINERY_CACHE_SCHEMA, archive: path.basename(ARCHIVE), size: stat.size, mtimeMs: Math.floor(stat.mtimeMs) };
  } catch {
    return null;
  }
}

function indexFromPrepared(refinables: RefineryType[]): RefineryIndex {
  return { refinables: new Map(refinables.map((item) => [item.typeId, item])) };
}

async function buildRefineryIndex(): Promise<RefineryIndex> {
  await ensureStaticDataArchive();
  const zip = new AdmZip(ARCHIVE);
  const types = parseJsonl<SdeType>(zip.getEntry("types.jsonl"));
  const groups = new Map(parseJsonl<SdeGroup>(zip.getEntry("groups.jsonl")).map((row) => [row._key, row]));
  const materialRows = new Map(parseJsonl<SdeMaterialRow>(zip.getEntry("typeMaterials.jsonl")).map((row) => [row._key, row]));
  const dogmaRows = new Map(parseJsonl<SdeDogmaRow>(zip.getEntry("typeDogma.jsonl")).map((row) => [row._key, row]));
  const names = new Map(types.map((row) => [row._key, row.name?.en ?? `Type ${row._key}`]));
  const refinables = new Map<number, RefineryType>();
  for (const row of types) {
    if (row.published === false) continue;
    const group = groups.get(Number(row.groupID ?? 0));
    if (Number(group?.categoryID ?? 0) !== 25) continue;
    const materials = materialRows.get(row._key)?.materials ?? [];
    if (!materials.length) continue;
    const portionSize = Math.max(1, Math.floor(Number(row.portionSize ?? 1)));
    const skillIdRaw = dogmaRows.get(row._key)?.dogmaAttributes?.find((attribute) => attribute.attributeID === PROCESSING_SKILL_ATTRIBUTE_ID)?.value;
    const processingSkillId = Number.isFinite(Number(skillIdRaw)) && Number(skillIdRaw) > 0 ? Number(skillIdRaw) : null;
    refinables.set(row._key, {
      typeId: row._key,
      name: names.get(row._key) ?? `Type ${row._key}`,
      groupId: Number(row.groupID ?? 0),
      groupName: group?.name?.en ?? `Group ${row.groupID ?? 0}`,
      portionSize,
      volumeM3: Math.max(0, Number(row.volume ?? 0)),
      processingSkillId,
      processingSkillName: processingSkillId == null ? null : names.get(processingSkillId) ?? `Skill ${processingSkillId}`,
      outputs: materials.map((material) => ({
        typeId: Number(material.materialTypeID),
        name: names.get(Number(material.materialTypeID)) ?? `Type ${material.materialTypeID}`,
        quantity: Math.max(0, Number(material.quantity ?? 0)),
      })),
    });
  }
  return { refinables };
}

export async function prepareRefineryStaticDataLocal() {
  const startedAt = Date.now();
  const index = await buildRefineryIndex();
  const key = await refineryCacheKey();
  if (!key) throw new Error("CCP static-data archive is unavailable after preparation.");
  const prepared = [...index.refinables.values()];
  await savePersistedResult(REFINERY_CACHE_KIND, key, { schema: REFINERY_CACHE_SCHEMA, generatedAt: new Date().toISOString(), refinables: prepared });
  return { preparedAt: new Date().toISOString(), refinableTypes: prepared.length, durationMs: Date.now() - startedAt };
}

async function refineryIndex() {
  return (refineryIndexPromise ??= Promise.resolve().then(async () => {
    const key = await refineryCacheKey();
    if (!key) return undefined;
    const prepared = await loadPersistedResult<{ schema:number; generatedAt:string; refinables:RefineryType[] }>(REFINERY_CACHE_KIND, key);
    if (!prepared || prepared.schema !== REFINERY_CACHE_SCHEMA || !Array.isArray(prepared.refinables)) return undefined;
    return indexFromPrepared(prepared.refinables);
  }));
}

async function requireRefineryIndex() {
  const index = await refineryIndex();
  if (!index) throw new Error("Refinery static data is still preparing locally. Wait for static-data preparation to finish; opening this page will not parse the SDE.");
  return index;
}

function trainedSkillMap(snapshot: any) {
  return new Map<number, number>((snapshot?.skills?.skills ?? []).map((skill: any) => [Number(skill.skill_id), Number(skill.trained_skill_level ?? 0)]));
}

const clampSkillLevel = (level: number) => Math.max(0, Math.min(5, Math.floor(Number(level) || 0)));

export function refineryYieldFraction(input: {
  facility: RefineryFacility;
  rig: RefineryRig;
  security: RefinerySecurity;
  reprocessingLevel: number;
  efficiencyLevel: number;
  processingLevel: number;
  implant: RefineryImplant;
}) {
  const facility = input.facility ?? "npc";
  const rigAddition = facility === "npc" ? 0 : input.rig === "t2" ? 3 : input.rig === "t1" ? 1 : 0;
  const securityMultiplier = facility === "npc" ? 1 : input.security === "null" ? 1.12 : input.security === "low" ? 1.06 : 1;
  const structureMultiplier = facility === "tatara" ? 1.055 : facility === "athanor" ? 1.02 : 1;
  const implantMultiplier = input.implant === "rx804" ? 1.04 : input.implant === "rx802" ? 1.02 : input.implant === "rx801" ? 1.01 : 1;
  const reprocessingMultiplier = 1 + clampSkillLevel(input.reprocessingLevel) * 0.03;
  const efficiencyMultiplier = 1 + clampSkillLevel(input.efficiencyLevel) * 0.02;
  const processingMultiplier = 1 + clampSkillLevel(input.processingLevel) * 0.02;
  const yieldFraction = ((50 + rigAddition) / 100) * securityMultiplier * structureMultiplier * reprocessingMultiplier * efficiencyMultiplier * processingMultiplier * implantMultiplier;
  return Math.max(0, Math.min(1, yieldFraction));
}

export function refineryBatchOutput(input: { quantity: number; portionSize: number; baseOutputQuantity: number; yieldFraction: number }) {
  const quantity = Math.max(0, Math.floor(Number(input.quantity) || 0));
  const portionSize = Math.max(1, Math.floor(Number(input.portionSize) || 1));
  const fullBatches = Math.floor(quantity / portionSize);
  const leftoverUnits = quantity - fullBatches * portionSize;
  const refinedUnits = Math.floor(Math.max(0, Number(input.baseOutputQuantity) || 0) * fullBatches * Math.max(0, Math.min(1, Number(input.yieldFraction) || 0)));
  return { fullBatches, leftoverUnits, refinedUnits };
}

function facilityLabel(facility: RefineryFacility) {
  if (facility === "tatara") return "Tatara";
  if (facility === "athanor") return "Athanor";
  return "NPC station";
}

export async function analyzeRefinery(input: {
  snapshot: any;
  stockSources: RefineryStockSource[];
  facility?: RefineryFacility;
  rig?: RefineryRig;
  security?: RefinerySecurity;
  implant?: RefineryImplant;
}) {
  const facility: RefineryFacility = input.facility === "tatara" || input.facility === "npc" ? input.facility : "athanor";
  const rig: RefineryRig = input.rig === "t1" || input.rig === "none" ? input.rig : "t2";
  const security: RefinerySecurity = input.security === "low" || input.security === "null" ? input.security : "high";
  const implant: RefineryImplant = input.implant === "rx801" || input.implant === "rx802" || input.implant === "rx804" ? input.implant : "none";
  const index = await requireRefineryIndex();
  const skills = trainedSkillMap(input.snapshot);
  const reprocessingLevel = clampSkillLevel(skills.get(REPROCESSING_SKILL_ID) ?? 0);
  const efficiencyLevel = clampSkillLevel(skills.get(REPROCESSING_EFFICIENCY_SKILL_ID) ?? 0);

  const stock = new Map<number, { quantity: number; owners: Map<string, { characterId: string; characterName: string; quantity: number; sourceAssetIds: string[] }> }>();
  for (const source of input.stockSources ?? []) {
    for (const [assetIndex, asset] of (source.assets ?? []).entries()) {
      const typeId = Number(asset.type_id ?? 0);
      const quantity = Math.max(0, Math.floor(Number(asset.quantity ?? 0)));
      if (!index.refinables.has(typeId) || quantity <= 0) continue;
      const current = stock.get(typeId) ?? { quantity: 0, owners: new Map() };
      current.quantity += quantity;
      const owner = current.owners.get(source.characterId) ?? { characterId: source.characterId, characterName: source.characterName, quantity: 0, sourceAssetIds: [] };
      owner.quantity += quantity;
      owner.sourceAssetIds.push(`${source.characterId}:${asset.item_id ?? `stack-${assetIndex}`}`);
      current.owners.set(source.characterId, owner);
      stock.set(typeId, current);
    }
  }

  const priceTypeIds = new Set<number>();
  for (const typeId of stock.keys()) {
    priceTypeIds.add(typeId);
    for (const output of index.refinables.get(typeId)?.outputs ?? []) priceTypeIds.add(output.typeId);
  }
  const market = await loadGlobalMarketQuotes([...priceTypeIds]);
  const quotes = new Map(market.quotes.map((quote) => [Number(quote.typeId), quote]));

  const stacks = [...stock.entries()].map(([typeId, held]) => {
    const definition = index.refinables.get(typeId)!;
    const processingLevel = definition.processingSkillId == null ? 0 : clampSkillLevel(skills.get(definition.processingSkillId) ?? 0);
    const yieldFraction = refineryYieldFraction({ facility, rig, security, reprocessingLevel, efficiencyLevel, processingLevel, implant });
    const batch = refineryBatchOutput({ quantity: held.quantity, portionSize: definition.portionSize, baseOutputQuantity: 0, yieldFraction });
    const rawQuote = quotes.get(typeId);
    const rawBestBuy = rawQuote?.bestBuy ?? null;
    const rawValue = rawBestBuy == null ? null : held.quantity * rawBestBuy;
    const leftoverRawValue = rawBestBuy == null ? null : batch.leftoverUnits * rawBestBuy;
    const outputs = definition.outputs.map((output) => {
      const outputBatch = refineryBatchOutput({ quantity: held.quantity, portionSize: definition.portionSize, baseOutputQuantity: output.quantity, yieldFraction });
      const quote = quotes.get(output.typeId);
      const bestBuy = quote?.bestBuy ?? null;
      return {
        typeId: output.typeId,
        name: output.name,
        baseUnitsPerBatch: output.quantity,
        refinedUnits: outputBatch.refinedUnits,
        bestBuy,
        bestBuySystem: quote?.bestBuySystem ?? null,
        bestBuyRegion: quote?.buyOrders?.[0]?.regionName ?? null,
        bestBuyLocation: quote?.buyOrders?.[0]?.locationName ?? null,
        value: bestBuy == null ? null : outputBatch.refinedUnits * bestBuy,
      };
    });
    const refinedOutputValue = outputs.every((output) => output.value != null) ? outputs.reduce((sum, output) => sum + Number(output.value ?? 0), 0) : null;
    const refinedStrategyValue = refinedOutputValue == null || leftoverRawValue == null ? null : refinedOutputValue + leftoverRawValue;
    const valueDelta = rawValue == null || refinedStrategyValue == null ? null : refinedStrategyValue - rawValue;
    return {
      typeId,
      name: definition.name,
      groupName: definition.groupName,
      quantity: held.quantity,
      portionSize: definition.portionSize,
      fullBatches: batch.fullBatches,
      leftoverUnits: batch.leftoverUnits,
      inputVolumeM3: definition.volumeM3 * held.quantity,
      processingSkill: definition.processingSkillId == null ? null : { typeId: definition.processingSkillId, name: definition.processingSkillName, trainedLevel: processingLevel },
      yieldFraction,
      yieldPercent: yieldFraction * 100,
      rawBestBuy,
      rawBestBuySystem: rawQuote?.bestBuySystem ?? null,
      rawBestBuyRegion: rawQuote?.buyOrders?.[0]?.regionName ?? null,
      rawBestBuyLocation: rawQuote?.buyOrders?.[0]?.locationName ?? null,
      rawValue,
      outputs,
      refinedOutputValue,
      leftoverRawValue,
      refinedStrategyValue,
      valueDelta,
      valueDeltaPercent: valueDelta == null || rawValue == null || rawValue <= 0 ? null : valueDelta / rawValue * 100,
      completeValuation: rawValue != null && refinedStrategyValue != null,
      recommendation: batch.fullBatches <= 0 ? "insufficient-batch" : valueDelta == null ? "unknown" : valueDelta > 0 ? "refine" : "sell",
      owners: [...held.owners.values()],
    };
  }).sort((a, b) => (b.valueDelta ?? Number.NEGATIVE_INFINITY) - (a.valueDelta ?? Number.NEGATIVE_INFINITY) || b.inputVolumeM3 - a.inputVolumeM3 || a.name.localeCompare(b.name));

  const completeValuation = stacks.every((stack) => stack.completeValuation);
  const knownRawValue = stacks.reduce((sum, stack) => sum + Number(stack.rawValue ?? 0), 0);
  const knownRefinedStrategyValue = stacks.reduce((sum, stack) => sum + Number(stack.refinedStrategyValue ?? 0), 0);
  const yieldPercents = stacks.map((stack) => stack.yieldPercent);
  const totalRawValue = completeValuation ? knownRawValue : null;
  const totalRefinedStrategyValue = completeValuation ? knownRefinedStrategyValue : null;
  const totalValueDelta = totalRawValue == null || totalRefinedStrategyValue == null ? null : totalRefinedStrategyValue - totalRawValue;
  return {
    generatedAt: new Date().toISOString(),
    marketCreatedAt: market.createdAt,
    source: "CCP EVE static data (offline) + retained all-region market snapshot",
    facility: { id: facility, label: facilityLabel(facility), rig, security, implant, taxIncluded: false },
    skills: {
      reprocessing: { typeId: REPROCESSING_SKILL_ID, name: "Reprocessing", trainedLevel: reprocessingLevel },
      efficiency: { typeId: REPROCESSING_EFFICIENCY_SKILL_ID, name: "Reprocessing Efficiency", trainedLevel: efficiencyLevel },
    },
    stockSources: (input.stockSources ?? []).map((source) => ({ characterId: source.characterId, characterName: source.characterName, assetStackCount: source.assets?.length ?? 0 })),
    stacks,
    totals: {
      stackCount: stacks.length,
      inputUnits: stacks.reduce((sum, stack) => sum + stack.quantity, 0),
      inputVolumeM3: stacks.reduce((sum, stack) => sum + stack.inputVolumeM3, 0),
      fullBatches: stacks.reduce((sum, stack) => sum + stack.fullBatches, 0),
      minYieldPercent: yieldPercents.length ? Math.min(...yieldPercents) : 0,
      maxYieldPercent: yieldPercents.length ? Math.max(...yieldPercents) : 0,
      knownRawValue,
      knownRefinedStrategyValue,
      rawValue: totalRawValue,
      refinedStrategyValue: totalRefinedStrategyValue,
      valueDelta: totalValueDelta,
      valuationComplete: completeValuation,
      refineRecommendations: stacks.filter((stack) => stack.recommendation === "refine").length,
      sellRecommendations: stacks.filter((stack) => stack.recommendation === "sell").length,
    },
    notes: [
      "Sage uses each resource type's SDE portion size and exact typeMaterials outputs. Only complete processing batches are refined; leftovers remain raw.",
      "The resource-specific processing skill is read directly from the ore type's current CCP dogma attribute, so new ore families do not require a hard-coded mapping.",
      "ISK comparisons use the best retained all-region public buy orders. Missing quotes leave that row's valuation incomplete rather than inventing a price.",
      "Facility tax and hauling cost are not included in this first refinery model.",
    ],
  };
}

export async function getRefineryCatalogue() {
  const index = await refineryIndex();
  if (!index) return [];
  return [...index.refinables.values()]
    .filter((item) => !/unused/i.test(item.name))
    .map((item) => ({
      typeId: item.typeId,
      name: item.name,
      groupName: item.groupName,
      portionSize: item.portionSize,
      volumeM3: item.volumeM3,
      outputs: item.outputs.map((output) => ({ ...output })),
      kind: /moon asteroids/i.test(item.groupName) ? "moon" : /ice/i.test(item.groupName) ? "ice" : "ore",
    }))
    .sort((a, b) => a.groupName.localeCompare(b.groupName) || a.name.localeCompare(b.name));
}

export async function getRefineryStaticSummary() {
  const index = await refineryIndex();
  return { refinableTypes: index?.refinables.size ?? 0, prepared: Boolean(index), source: "CCP EVE static data (offline prepared cache)" };
}
