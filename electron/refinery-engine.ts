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
export type RefineryYieldOverride = {
  enabled?: boolean;
  reprocessingLevel?: number;
  efficiencyLevel?: number;
  processingLevel?: number;
  processingLevels?: Record<string, number>;
  baseYieldPercent?: number;
  structureBonusPercent?: number;
  rigBonusPercent?: number;
  securityMultiplierPercent?: number;
  implantBonusPercent?: number;
};

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

const finiteOr = (value: unknown, fallback: number) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clampPercent = (value: unknown, min = 0, max = 200) => Math.max(min, Math.min(max, finiteOr(value, 0)));

export function refineryYieldFraction(input: {
  facility: RefineryFacility;
  rig: RefineryRig;
  security: RefinerySecurity;
  reprocessingLevel: number;
  efficiencyLevel: number;
  processingLevel: number;
  implant: RefineryImplant;
  override?: RefineryYieldOverride;
}) {
  const facility = input.facility ?? "npc";
  const manual = input.override?.enabled ? input.override : undefined;
  const baseYieldPercent = manual ? clampPercent(manual.baseYieldPercent ?? 50, 0, 100) : 50;
  const rigAddition = manual
    ? clampPercent(manual.rigBonusPercent ?? 0, 0, 100)
    : facility === "npc" ? 0 : input.rig === "t2" ? 3 : input.rig === "t1" ? 1 : 0;
  const securityMultiplier = manual
    ? clampPercent(manual.securityMultiplierPercent ?? 100, 0, 200) / 100
    : facility === "npc" ? 1 : input.security === "null" ? 1.12 : input.security === "low" ? 1.06 : 1;
  const structureMultiplier = manual
    ? 1 + clampPercent(manual.structureBonusPercent ?? 0, 0, 100) / 100
    : facility === "tatara" ? 1.055 : facility === "athanor" ? 1.02 : 1;
  const implantMultiplier = manual
    ? 1 + clampPercent(manual.implantBonusPercent ?? 0, 0, 100) / 100
    : input.implant === "rx804" ? 1.04 : input.implant === "rx802" ? 1.02 : input.implant === "rx801" ? 1.01 : 1;
  const reprocessingLevel = manual ? clampSkillLevel(manual.reprocessingLevel ?? input.reprocessingLevel) : clampSkillLevel(input.reprocessingLevel);
  const efficiencyLevel = manual ? clampSkillLevel(manual.efficiencyLevel ?? input.efficiencyLevel) : clampSkillLevel(input.efficiencyLevel);
  const processingLevel = manual ? clampSkillLevel(manual.processingLevel ?? input.processingLevel) : clampSkillLevel(input.processingLevel);
  const reprocessingMultiplier = 1 + reprocessingLevel * 0.03;
  const efficiencyMultiplier = 1 + efficiencyLevel * 0.02;
  const processingMultiplier = 1 + processingLevel * 0.02;
  const yieldFraction = ((baseYieldPercent + rigAddition) / 100) * securityMultiplier * structureMultiplier * reprocessingMultiplier * efficiencyMultiplier * processingMultiplier * implantMultiplier;
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
  yieldOverride?: RefineryYieldOverride;
}) {
  const facility: RefineryFacility = input.facility === "tatara" || input.facility === "npc" ? input.facility : "athanor";
  const rig: RefineryRig = input.rig === "t1" || input.rig === "none" ? input.rig : "t2";
  const security: RefinerySecurity = input.security === "low" || input.security === "null" ? input.security : "high";
  const implant: RefineryImplant = input.implant === "rx801" || input.implant === "rx802" || input.implant === "rx804" ? input.implant : "none";
  const index = await requireRefineryIndex();
  const skills = trainedSkillMap(input.snapshot);
  const reprocessingLevel = input.yieldOverride?.enabled ? clampSkillLevel(input.yieldOverride.reprocessingLevel ?? 0) : clampSkillLevel(skills.get(REPROCESSING_SKILL_ID) ?? 0);
  const efficiencyLevel = input.yieldOverride?.enabled ? clampSkillLevel(input.yieldOverride.efficiencyLevel ?? 0) : clampSkillLevel(skills.get(REPROCESSING_EFFICIENCY_SKILL_ID) ?? 0);

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
    const manualProcessingLevel = definition.processingSkillId == null ? undefined : input.yieldOverride?.processingLevels?.[String(definition.processingSkillId)];
    const processingLevel = input.yieldOverride?.enabled
      ? clampSkillLevel(manualProcessingLevel ?? input.yieldOverride.processingLevel ?? 0)
      : definition.processingSkillId == null ? 0 : clampSkillLevel(skills.get(definition.processingSkillId) ?? 0);
    const yieldFraction = refineryYieldFraction({ facility, rig, security, reprocessingLevel, efficiencyLevel, processingLevel, implant, override: input.yieldOverride });
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
    yieldOverride: input.yieldOverride?.enabled ? { ...input.yieldOverride, enabled: true } : null,
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


function installedRefineryImplant(snapshot: any): RefineryImplant {
  const implants = Array.isArray(snapshot?.extended?.implants) ? snapshot.extended.implants : [];
  const names = implants.map((implant: any) => typeof implant === "number" ? "" : String(implant?.name ?? implant?.typeName ?? implant?.type_name ?? "")).join(" ");
  if (/\bRX-?804\b/i.test(names)) return "rx804";
  if (/\bRX-?802\b/i.test(names)) return "rx802";
  if (/\bRX-?801\b/i.test(names)) return "rx801";
  return "none";
}

// SDE reprocessing data does not encode ore spawn-security locations; keep this Catalyst-era access table aligned with the EVE patch doctrine.
const MINING_REACH_RANK: Record<RefinerySecurity, number> = { high: 0, low: 1, null: 2 };

export function oreAccessProfile(name: string, groupName: string) {
  const text = (groupName + " " + name).toLowerCase();
  let tier = 90;
  let reach: RefinerySecurity | "special" = "special";
  let label = "Special-space ore";
  let accessDetail = "Not part of the normal high / low / null mining path";
  let sourceKind: "belt" | "site" | "border-site" | "sov-site" | "special" = "special";

  if (/veldspar|scordite|pyroxeres|plagioclase/.test(text)) {
    tier = 0;
    reach = "high";
    label = "High-sec belt";
    sourceKind = "belt";
    accessDetail = /pyroxeres/.test(text)
      ? "Ordinary high-sec belt · Amarr / Caldari space"
      : /plagioclase/.test(text)
        ? "Ordinary high-sec belt · available at 0.7 and below by region"
        : "Ordinary high-sec asteroid belt";
  } else if (/omber|kernite/.test(text)) {
    tier = 1;
    reach = "high";
    label = "High-sec mining site";
    sourceKind = "site";
    accessDetail = "Rare Omber / Kernite ore anomaly · 0.5–0.8 high-sec";
  } else if (/ducinium|eifyrium|ytirium/.test(text)) {
    tier = 2;
    reach = "high";
    label = "High-sec border site";
    sourceKind = "border-site";
    accessDetail = "Empire Border Rare Asteroids · 0.5 high-sec bordering low-sec";
  } else if (/mordunium/.test(text)) {
    tier = 2;
    reach = "high";
    label = "High-sec mining site";
    sourceKind = "border-site";
    accessDetail = "Small Mordunium Deposit · rare 0.5 high-sec system bordering low-sec";
  } else if (/dark ochre|crokite/.test(text) && /iv-grade/.test(text)) {
    tier = 2;
    reach = "high";
    label = "High-sec border site";
    sourceKind = "border-site";
    accessDetail = "Empire Border Rare Asteroids · IV-Grade ore in 0.5 high-sec bordering low-sec";
  } else if (/jaspet|hemorphite|hedbergite/.test(text)) {
    tier = 3;
    reach = "low";
    label = "Low-sec belt / site";
    sourceKind = "belt";
    accessDetail = "Low-sec asteroid belts or ore anomalies";
  } else if (/gneiss|dark ochre|crokite/.test(text)) {
    tier = 4;
    reach = "low";
    label = "Low-sec mining site";
    sourceKind = "site";
    accessDetail = "Low-sec Gneiss / Dark Ochre / Crokite ore anomaly; hidden variants require probing";
  } else if (/arkonor|bistot|mercoxit|griemeer|hezorime|kylixium|nocxite|ueganite/.test(text)) {
    tier = 5;
    reach = "null";
    sourceKind = /griemeer|hezorime|kylixium|nocxite|ueganite/.test(text) ? "sov-site" : "site";
    label = sourceKind === "sov-site" ? "Null-sec prospecting site" : "Null-sec belt / site";
    accessDetail = sourceKind === "sov-site"
      ? "Sovereign null-sec Ore Prospecting Array deposit"
      : /mercoxit/.test(text)
        ? "Null-sec belt / anomaly · requires Deep Core Mining equipment"
        : "Null-sec asteroid belt or ore anomaly";
  } else if (/spodumain|bezdnacine|rakovene|talassonite/.test(text)) {
    tier = 90;
    reach = "special";
    sourceKind = "special";
    label = "Pochven / special";
    accessDetail = "Special-space ore; not treated as ordinary high / low / null access";
  }

  const variantPenalty =
    /\b(?:iv-grade|iii-grade)\b/.test(text) ? -0.15 :
    /\bii-grade\b/.test(text) ? -0.08 :
    /\b(?:dense|massive|glazed|pristine|radiant|fiery|glowing|gleaming|flawless|luminous|brilliant|sparkling|rich|viscous|pure|crystalline)\b/.test(text) ? 0.25 :
    /\b(?:concentrated|solid|azure|golden|silvery|motley|lustrous|sharp|bright|smooth|iridescent|platinoid)\b/.test(text) ? 0.12 : 0;
  const reachRank = reach === "special" ? 99 : MINING_REACH_RANK[reach];
  return { tier, label, accessDetail, sourceKind, reach, reachRank, variantPenalty };
}

export async function planRefineryAcquisition(input: {
  snapshot: any;
  requiredMaterials: Array<{ typeId: number; name?: string; required: number }>;
  facility?: RefineryFacility;
  rig?: RefineryRig;
  security?: RefinerySecurity;
  miningReach?: RefinerySecurity;
  implant?: RefineryImplant | "auto";
  yieldOverride?: RefineryYieldOverride;
}) {
  const index = await requireRefineryIndex();
  const skills = trainedSkillMap(input.snapshot);
  const reprocessingLevel = input.yieldOverride?.enabled ? clampSkillLevel(input.yieldOverride.reprocessingLevel ?? 0) : clampSkillLevel(skills.get(REPROCESSING_SKILL_ID) ?? 0);
  const efficiencyLevel = input.yieldOverride?.enabled ? clampSkillLevel(input.yieldOverride.efficiencyLevel ?? 0) : clampSkillLevel(skills.get(REPROCESSING_EFFICIENCY_SKILL_ID) ?? 0);
  const facility: RefineryFacility = input.facility === "tatara" || input.facility === "npc" ? input.facility : "athanor";
  const rig: RefineryRig = facility === "npc" ? "none" : input.rig === "t1" || input.rig === "none" ? input.rig : "t2";
  const security: RefinerySecurity = input.security === "low" || input.security === "null" ? input.security : "high";
  const miningReach: RefinerySecurity = input.miningReach === "low" || input.miningReach === "null" ? input.miningReach : "high";
  const allowedReachRank = MINING_REACH_RANK[miningReach];
  const detectedImplant = installedRefineryImplant(input.snapshot);
  const implant: RefineryImplant = input.implant && input.implant !== "auto" ? input.implant : detectedImplant;

  const required = new Map<number, { typeId: number; name: string; required: number }>();
  for (const row of input.requiredMaterials ?? []) {
    const typeId = Number(row?.typeId ?? 0);
    const quantity = Math.max(0, Math.ceil(Number(row?.required ?? 0)));
    if (!(typeId > 0) || quantity <= 0) continue;
    const current = required.get(typeId) ?? { typeId, name: String(row?.name ?? ("Type " + typeId)), required: 0 };
    current.required += quantity;
    if (row?.name) current.name = String(row.name);
    required.set(typeId, current);
  }

  const mineralIds = new Set<number>();
  const allCandidates = [...index.refinables.values()].flatMap((definition) => {
    if (/moon asteroids|ice/i.test(definition.groupName) || /compressed/i.test(definition.name)) return [];
    const relevantOutputs = definition.outputs.filter((output) => required.has(output.typeId));
    if (!relevantOutputs.length) return [];
    for (const output of relevantOutputs) mineralIds.add(output.typeId);
    const manualProcessingLevel = definition.processingSkillId == null ? undefined : input.yieldOverride?.processingLevels?.[String(definition.processingSkillId)];
    const processingLevel = input.yieldOverride?.enabled
      ? clampSkillLevel(manualProcessingLevel ?? input.yieldOverride.processingLevel ?? 0)
      : definition.processingSkillId == null ? 0 : clampSkillLevel(skills.get(definition.processingSkillId) ?? 0);
    const yieldFraction = refineryYieldFraction({ facility, rig, security, reprocessingLevel, efficiencyLevel, processingLevel, implant, override: input.yieldOverride });
    const ease = oreAccessProfile(definition.name, definition.groupName);
    const batchVolume = Math.max(0.000001, definition.volumeM3 * definition.portionSize);
    const outputs = relevantOutputs.map((output) => ({
      typeId: output.typeId,
      name: output.name,
      baseUnitsPerBatch: output.quantity,
      effectiveUnitsPerBatch: Math.max(0, output.quantity * yieldFraction),
    }));
    return [{ definition, processingLevel, yieldFraction, ease, batchVolume, outputs }];
  });

  const candidates = allCandidates.filter((candidate) => candidate.ease.reachRank <= allowedReachRank);
  const reachableMineralIds = new Set<number>();
  for (const candidate of candidates) for (const output of candidate.outputs) reachableMineralIds.add(output.typeId);

  const mineableMaterials = [...required.values()].filter((row) => mineralIds.has(row.typeId));
  const nonOreMaterials = [...required.values()].filter((row) => !mineralIds.has(row.typeId));
  const remaining = new Map(mineableMaterials.map((row) => [row.typeId, Number(row.required)]));
  const selected = new Map<number, number>();

  for (let guard = 0; guard < 256; guard += 1) {
    const open = [...remaining.entries()].filter(([, value]) => value > 0.000001);
    if (!open.length) break;
    const eligible = candidates.filter((candidate) => candidate.outputs.some((output) => (remaining.get(output.typeId) ?? 0) > 0.000001 && output.effectiveUnitsPerBatch > 0));
    if (!eligible.length) break;
    const minTier = Math.min(...eligible.map((candidate) => candidate.ease.tier));
    const tierPool = eligible.filter((candidate) => candidate.ease.tier === minTier);
    tierPool.sort((a, b) => {
      const coverage = (candidate: any) => candidate.outputs.reduce((sum: number, output: any) => {
        const deficit = Math.max(0, remaining.get(output.typeId) ?? 0);
        return sum + Math.min(deficit, output.effectiveUnitsPerBatch);
      }, 0) / candidate.batchVolume;
      return coverage(b) - coverage(a)
        || a.ease.variantPenalty - b.ease.variantPenalty
        || a.definition.volumeM3 - b.definition.volumeM3
        || a.definition.name.localeCompare(b.definition.name);
    });
    const chosen = tierPool[0];
    const batchNeeds = chosen.outputs.flatMap((output: any) => {
      const deficit = Math.max(0, remaining.get(output.typeId) ?? 0);
      return deficit > 0 && output.effectiveUnitsPerBatch > 0 ? [Math.max(1, Math.ceil(deficit / output.effectiveUnitsPerBatch))] : [];
    });
    const batches = Math.max(1, Math.min(...batchNeeds));
    selected.set(chosen.definition.typeId, (selected.get(chosen.definition.typeId) ?? 0) + batches);
    for (const output of chosen.outputs) remaining.set(output.typeId, Math.max(0, (remaining.get(output.typeId) ?? 0) - output.effectiveUnitsPerBatch * batches));
  }

  const buildPlanRows = () => [...selected.entries()].map(([typeId, batches]) => {
    const candidate = candidates.find((row) => row.definition.typeId === typeId)!;
    const quantity = batches * candidate.definition.portionSize;
    const outputs = candidate.outputs.map((output: any) => ({
      typeId: output.typeId,
      name: output.name,
      refinedUnits: refineryBatchOutput({ quantity, portionSize: candidate.definition.portionSize, baseOutputQuantity: output.baseUnitsPerBatch, yieldFraction: candidate.yieldFraction }).refinedUnits,
    }));
    return { candidate, batches, quantity, outputs };
  });

  for (let guard = 0; guard < 256; guard += 1) {
    const producedNow = new Map<number, number>();
    for (const row of buildPlanRows()) for (const output of row.outputs) producedNow.set(output.typeId, (producedNow.get(output.typeId) ?? 0) + output.refinedUnits);
    const deficits = mineableMaterials.filter((row) => (producedNow.get(row.typeId) ?? 0) < row.required);
    if (!deficits.length) break;
    const deficitIds = new Set(deficits.map((row) => row.typeId));
    const eligible = candidates.filter((candidate) => candidate.outputs.some((output) => deficitIds.has(output.typeId) && output.effectiveUnitsPerBatch > 0));
    if (!eligible.length) break;
    eligible.sort((a, b) => a.ease.tier - b.ease.tier || a.ease.variantPenalty - b.ease.variantPenalty || a.batchVolume - b.batchVolume || a.definition.name.localeCompare(b.definition.name));
    const chosen = eligible[0];
    selected.set(chosen.definition.typeId, (selected.get(chosen.definition.typeId) ?? 0) + 1);
  }

  const produced = new Map<number, number>();
  const orePlan = buildPlanRows().map(({ candidate, batches, quantity, outputs }) => {
    for (const output of outputs) produced.set(output.typeId, (produced.get(output.typeId) ?? 0) + output.refinedUnits);
    return {
      typeId: candidate.definition.typeId,
      name: candidate.definition.name,
      groupName: candidate.definition.groupName,
      easeTier: candidate.ease.tier,
      easeLabel: candidate.ease.label,
      accessDetail: candidate.ease.accessDetail,
      sourceKind: candidate.ease.sourceKind,
      miningReach: candidate.ease.reach,
      portionSize: candidate.definition.portionSize,
      batches,
      oreUnits: quantity,
      volumeM3: quantity * candidate.definition.volumeM3,
      yieldFraction: candidate.yieldFraction,
      yieldPercent: candidate.yieldFraction * 100,
      processingSkill: candidate.definition.processingSkillId == null ? null : { typeId: candidate.definition.processingSkillId, name: candidate.definition.processingSkillName, trainedLevel: candidate.processingLevel },
      outputs,
    };
  }).sort((a, b) => a.easeTier - b.easeTier || a.volumeM3 - b.volumeM3 || a.name.localeCompare(b.name));

  const materials = [...required.values()].map((row) => ({
    ...row,
    mineableFromOre: mineralIds.has(row.typeId),
    mineableWithinReach: reachableMineralIds.has(row.typeId),
    plannedOutput: produced.get(row.typeId) ?? 0,
    plannedSurplus: Math.max(0, (produced.get(row.typeId) ?? 0) - row.required),
    plannedShortfall: Math.max(0, row.required - (produced.get(row.typeId) ?? 0)),
  })).sort((a, b) => Number(b.mineableFromOre) - Number(a.mineableFromOre) || b.required - a.required || a.name.localeCompare(b.name));

  const buyMaterials = materials
    .filter((row) => row.mineableFromOre && row.plannedShortfall > 0)
    .map((row) => ({
      typeId: row.typeId,
      name: row.name,
      required: row.required,
      plannedOutput: row.plannedOutput,
      buyQuantity: Math.ceil(row.plannedShortfall),
      reason: miningReach === "high"
        ? "BUY THIS · no ordinary high-sec ore route covers the remaining requirement"
        : miningReach === "low"
          ? "BUY THIS · no ordinary high-sec or low-sec ore route covers the remaining requirement"
          : "BUY THIS · no ordinary high / low / null ore route covers the remaining requirement",
    }));

  return {
    generatedAt: new Date().toISOString(),
    facility: { id: facility, label: facilityLabel(facility), rig, security, implant },
    detectedImplant,
    miningReach,
    miningReachLabel: miningReach === "high" ? "High-sec only" : miningReach === "low" ? "High + low-sec" : "High + low + null-sec",
    yieldOverride: input.yieldOverride?.enabled ? { ...input.yieldOverride, enabled: true } : null,
    skills: {
      reprocessing: { typeId: REPROCESSING_SKILL_ID, name: "Reprocessing", trainedLevel: reprocessingLevel },
      efficiency: { typeId: REPROCESSING_EFFICIENCY_SKILL_ID, name: "Reprocessing Efficiency", trainedLevel: efficiencyLevel },
    },
    materials,
    mineableMaterials,
    nonOreMaterials,
    buyMaterials,
    orePlan,
    totals: {
      baseMaterialTypes: materials.length,
      mineableMaterialTypes: mineableMaterials.length,
      nonOreMaterialTypes: nonOreMaterials.length,
      oreTypes: orePlan.length,
      oreUnits: orePlan.reduce((sum, row) => sum + row.oreUnits, 0),
      oreVolumeM3: orePlan.reduce((sum, row) => sum + row.volumeM3, 0),
      buyMaterialTypes: buyMaterials.length,
      buyUnits: buyMaterials.reduce((sum, row) => sum + row.buyQuantity, 0),
      unresolvedMineralTypes: buyMaterials.length,
    },
    notes: [
      "Mining reach is " + miningReach + ". Sage always exhausts high-sec sources first, then low-sec only if the selected reach permits it, then null-sec only if still required.",
      "High-sec mining sites and rare 0.5 border anomalies are treated as high-sec sources and are labelled explicitly instead of silently escalating the plan to low/null.",
      "Within the same access tier Sage prefers the ore that covers the remaining mineral deficit with the least mined volume.",
      "Yield uses the selected character's Reprocessing, Reprocessing Efficiency, resource-specific processing skill and active RX-series reprocessing implant when present.",
      "Structure reprocessing rigs are not exposed by ESI, so the selected rig profile remains an explicit planning input.",
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
