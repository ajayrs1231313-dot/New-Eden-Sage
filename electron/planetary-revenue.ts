import AdmZip from "adm-zip";
import path from "node:path";
import { STATIC_DATA_ROOT } from "./data-paths";
import { loadGlobalMarketQuotes, type GlobalMarketQuote } from "./market-intelligence";
import { ensureStaticDataArchive } from "./type-volumes";

const ARCHIVE = path.join(STATIC_DATA_ROOT, "eve-static-data-jsonl.zip");
const DAY_SECONDS = 86_400;
const PI_SKILL_IDS = [2495, 2505, 2406, 2403, 13279] as const;

export type PlanetaryTier = "P0" | "P1" | "P2" | "P3" | "P4" | "unknown";
export type PlanetarySecurityBand = "high" | "low" | "null";
export type PlanetaryPlanMode = "buy" | "full" | "hybrid";

export type PlanetaryAlertSettingsOverride = {
  enabled?:Record<string,boolean>;
  extractorWarningHours?:number[];
  storageThresholds?:number[];
  stockpileDays?:number;
  optimizerMinIskPerDay?:number;
};

export type PlanetaryAlertSettings = PlanetaryAlertSettingsOverride & {
  overrides?:Record<string,PlanetaryAlertSettingsOverride>;
};

export type PlanetaryResourceObservation = {
  planetId:number;
  systemId?:number;
  systemName?:string;
  planetTypeId?:number;
  planetType?:string;
  radiusKm?:number;
  resourceTypeId?:number;
  resourceName?:string;
  percent?:number;
  /** Legacy 1-5 observation retained for migration only. */
  score?:number;
  note?:string;
  characterId?:string;
  characterName?:string;
  source?:string;
  confidence?:number;
  scope?:"personal"|"corporation";
  observedAt?:string;
};

export type PlanetaryRevenueSettings = {
  pocoOwnerTaxPercent?: number;
  brokerFeePercent?: number | null;
  assumedSecurity?: "auto" | PlanetarySecurityBand;
  cargoM3?: number;
  haulingCostPerTripIsk?: number;
  maxJumps?: number;
  runtimeHours?: number;
  /** Internal prepared PI evidence injected by the main process. */
  resourceObservations?:PlanetaryResourceObservation[];
  alertSettings?:PlanetaryAlertSettings;
};

export type PlanetaryPlanInput = PlanetaryRevenueSettings & {
  characterId:string;
  productTypeId:number;
  finalProcessors?:number;
  mode?:PlanetaryPlanMode;
  hybridBuildTypeIds?:number[];
  originSystemId?:number;
  maxJumps?:number;
  finderSecurity?:"any"|PlanetarySecurityBand;
  planetId?:number|null;
  planetTypeId?:number|null;
  resourceObservations?:PlanetaryResourceObservation[];
};

type SdeType = { _key:number; name?:{en?:string}; groupID?:number; volume?:number; packagedVolume?:number; capacity?:number };
type SdeGroup = { _key:number; name?:{en?:string} };
type SdeSystem = { _key:number; name?:{en?:string}; securityStatus?:number; regionID?:number; planetIDs?:number[] };
type SdeRegion = { _key:number; name?:{en?:string} };
type SdePlanet = { _key:number; solarSystemID:number; typeID:number; radius:number; celestialIndex?:number };
type SdeGate = { solarSystemID:number; destination:{solarSystemID:number} };
type SchematicType = { _key:number; isInput:boolean; quantity:number };
type Schematic = { _key:number; cycleTime:number; name?:{en?:string}; types?:SchematicType[] };
type SdeTypeDogma = { _key:number; dogmaAttributes?:Array<{attributeID:number;value:number}> };
type SdeBlueprint = { _key:number; activities?:{manufacturing?:{materials?:Array<{quantity:number;typeID:number}>}} };

type IndexedType = { id:number; name:string; groupId:number; volume:number; capacity:number };
type IndexedSystem = { id:number; name:string; securityStatus:number; regionId:number; regionName:string; planetIds:number[] };
type IndexedPlanet = { id:number; systemId:number; typeId:number; typeName:string; radiusM:number; celestialIndex:number };
type FacilityKind = "command"|"basic"|"advanced"|"hightech"|"launchpad"|"storage"|"ecu";
type FacilityStats = { typeId:number; name:string; planetTypeId:number; kind:FacilityKind; cpuLoad:number; powerLoad:number; cpuOutput:number; powerOutput:number; capacityM3:number; requiredLevel:number; headCpu:number; headPower:number; decayFactor:number; noiseFactor:number };
type BlueprintPiDemand = { blueprintTypeId:number; materials:Array<{typeId:number;quantity:number}> };

type PiIndex = {
  names:Map<number,string>;
  typeByName:Map<string,number>;
  types:Map<number,IndexedType>;
  tiers:Map<number,PlanetaryTier>;
  systems:Map<number,IndexedSystem>;
  planets:Map<number,IndexedPlanet>;
  planetsBySystem:Map<number,IndexedPlanet[]>;
  schematics:Map<number,Schematic>;
  schematicByOutput:Map<number,Schematic>;
  productTypeIds:Set<number>;
  facilities:FacilityStats[];
  facilityByTypeId:Map<number,FacilityStats>;
  adjacency:Map<number,number[]>;
  resourcesByPlanetType:Map<number,Set<number>>;
  blueprints:Map<number,BlueprintPiDemand>;
};

let indexCache:Promise<PiIndex> | undefined;

const RESOURCE_MATRIX:Record<string,string[]> = {
  Barren:["Aqueous Liquids","Base Metals","Carbon Compounds","Microorganisms","Noble Metals"],
  Gas:["Aqueous Liquids","Base Metals","Ionic Solutions","Noble Gas","Reactive Gas"],
  Ice:["Aqueous Liquids","Heavy Metals","Microorganisms","Noble Gas","Planktic Colonies"],
  Lava:["Base Metals","Felsic Magma","Heavy Metals","Non-CS Crystals","Suspended Plasma"],
  Oceanic:["Aqueous Liquids","Carbon Compounds","Complex Organisms","Microorganisms","Planktic Colonies"],
  Plasma:["Base Metals","Heavy Metals","Noble Metals","Non-CS Crystals","Suspended Plasma"],
  Storm:["Aqueous Liquids","Base Metals","Ionic Solutions","Noble Gas","Suspended Plasma"],
  Temperate:["Aqueous Liquids","Autotrophs","Carbon Compounds","Complex Organisms","Microorganisms"],
};

const TAXABLE_VALUE:Record<PlanetaryTier,number> = { P0:5, P1:400, P2:7200, P3:60_000, P4:1_200_000, unknown:0 };

function parseJsonl<T>(entry: AdmZip.IZipEntry | null):T[] {
  if (!entry) return [];
  return entry.getData().toString("utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as T);
}

function planetTypeLabel(name:string) { const match=name.match(/^Planet \(([^)]+)\)$/i); return match?.[1] ?? name.replace(/ Planet$/i,"").replace(/^Planet /i,""); }

function tierFromGroupName(groupName:string):PlanetaryTier {
  if (/Raw Resource/i.test(groupName)) return "P0";
  const match = groupName.match(/Tier\s+([1-4])/i);
  return match ? (`P${match[1]}` as PlanetaryTier) : "unknown";
}

function dogmaValue(row:SdeTypeDogma|undefined, attributeId:number, fallback=0) {
  return Number(row?.dogmaAttributes?.find((entry) => Number(entry.attributeID) === attributeId)?.value ?? fallback);
}

function facilityKind(name:string, groupId:number):FacilityKind|null {
  if (groupId === 1027) return "command";
  if (groupId === 1030) return "launchpad";
  if (groupId === 1029) return "storage";
  if (groupId === 1063) return "ecu";
  if (groupId === 1028) {
    if (/High-Tech/i.test(name)) return "hightech";
    if (/Advanced/i.test(name)) return "advanced";
    if (/Basic/i.test(name)) return "basic";
  }
  return null;
}

async function piIndex():Promise<PiIndex> {
  return (indexCache ??= Promise.resolve().then(async () => {
    await ensureStaticDataArchive();
    const zip = new AdmZip(ARCHIVE);
    const types = parseJsonl<SdeType>(zip.getEntry("types.jsonl"));
    const groups = parseJsonl<SdeGroup>(zip.getEntry("groups.jsonl"));
    const systems = parseJsonl<SdeSystem>(zip.getEntry("mapSolarSystems.jsonl"));
    const regions = parseJsonl<SdeRegion>(zip.getEntry("mapRegions.jsonl"));
    const planets = parseJsonl<SdePlanet>(zip.getEntry("mapPlanets.jsonl"));
    const gates = parseJsonl<SdeGate>(zip.getEntry("mapStargates.jsonl"));
    const schematics = parseJsonl<Schematic>(zip.getEntry("planetSchematics.jsonl"));
    const typeDogma = parseJsonl<SdeTypeDogma>(zip.getEntry("typeDogma.jsonl"));
    const blueprints = parseJsonl<SdeBlueprint>(zip.getEntry("blueprints.jsonl"));
    if (!types.length || !groups.length || !schematics.length || !systems.length || !planets.length) throw new Error("Official CCP SDE planetary data is unavailable.");

    const groupNames = new Map(groups.map((group) => [Number(group._key), group.name?.en ?? `Group ${group._key}`]));
    const indexedTypes = new Map<number,IndexedType>();
    const names = new Map<number,string>();
    const typeByName = new Map<string,number>();
    const tiers = new Map<number,PlanetaryTier>();
    for (const type of types) {
      const id = Number(type._key);
      const name = type.name?.en ?? `Type ${id}`;
      names.set(id,name);
      typeByName.set(name.toLowerCase(),id);
      indexedTypes.set(id,{ id,name,groupId:Number(type.groupID ?? 0),volume:Number(type.volume ?? type.packagedVolume ?? 0),capacity:Number(type.capacity ?? 0) });
      tiers.set(id,tierFromGroupName(groupNames.get(Number(type.groupID ?? 0)) ?? ""));
    }

    const regionNames = new Map(regions.map((region) => [Number(region._key),region.name?.en ?? `Region ${region._key}`]));
    const indexedSystems = new Map<number,IndexedSystem>();
    for (const system of systems) {
      const regionId = Number(system.regionID ?? 0);
      indexedSystems.set(Number(system._key),{
        id:Number(system._key),
        name:system.name?.en ?? `System ${system._key}`,
        securityStatus:Number(system.securityStatus ?? 0),
        regionId,
        regionName:regionNames.get(regionId) ?? `Region ${regionId}`,
        planetIds:(system.planetIDs ?? []).map(Number),
      });
    }

    const indexedPlanets = new Map<number,IndexedPlanet>();
    const planetsBySystem = new Map<number,IndexedPlanet[]>();
    for (const planet of planets) {
      const type = indexedTypes.get(Number(planet.typeID));
      const row:IndexedPlanet = { id:Number(planet._key), systemId:Number(planet.solarSystemID), typeId:Number(planet.typeID), typeName:type ? planetTypeLabel(type.name) : `Type ${planet.typeID}`, radiusM:Number(planet.radius ?? 0), celestialIndex:Number(planet.celestialIndex ?? 0) };
      indexedPlanets.set(row.id,row);
      const collection = planetsBySystem.get(row.systemId) ?? [];
      collection.push(row);
      planetsBySystem.set(row.systemId,collection);
    }

    const schematicMap = new Map(schematics.map((schematic) => [Number(schematic._key), schematic]));
    const schematicByOutput = new Map<number,Schematic>();
    const productTypeIds = new Set<number>();
    for (const schematic of schematics) {
      for (const line of schematic.types ?? []) {
        productTypeIds.add(Number(line._key));
        if (!line.isInput) schematicByOutput.set(Number(line._key),schematic);
      }
    }

    const dogmaByType = new Map(typeDogma.map((row) => [Number(row._key),row]));
    const facilities:FacilityStats[] = [];
    for (const type of indexedTypes.values()) {
      const kind = facilityKind(type.name,type.groupId);
      if (!kind) continue;
      const dogma = dogmaByType.get(type.id);
      const planetTypeId = dogmaValue(dogma,1632,0);
      if (!planetTypeId) continue;
      facilities.push({
        typeId:type.id,
        name:type.name,
        planetTypeId,
        kind,
        cpuLoad:dogmaValue(dogma,49,0),
        powerLoad:dogmaValue(dogma,15,0),
        cpuOutput:dogmaValue(dogma,48,0),
        powerOutput:dogmaValue(dogma,11,0),
        capacityM3:type.capacity,
        requiredLevel:dogmaValue(dogma,277,0),
        headCpu:dogmaValue(dogma,1690,110),
        headPower:dogmaValue(dogma,1691,550),
        decayFactor:dogmaValue(dogma,1683,0.012),
        noiseFactor:dogmaValue(dogma,1687,0.8),
      });
    }
    const facilityByTypeId = new Map(facilities.map((facility) => [facility.typeId,facility]));

    const adjacency = new Map<number,number[]>();
    for (const systemId of indexedSystems.keys()) adjacency.set(systemId,[]);
    for (const gate of gates) {
      const from = Number(gate.solarSystemID), to = Number(gate.destination?.solarSystemID ?? 0);
      if (!adjacency.has(from) || !adjacency.has(to)) continue;
      adjacency.get(from)!.push(to);
    }

    const resourcesByPlanetType = new Map<number,Set<number>>();
    for (const [planetName,resources] of Object.entries(RESOURCE_MATRIX)) {
      const planetTypeId = [...indexedTypes.values()].find((type) => planetTypeLabel(type.name) === planetName)?.id;
      if (!planetTypeId) continue;
      resourcesByPlanetType.set(planetTypeId,new Set(resources.map((name) => typeByName.get(name.toLowerCase()) ?? 0).filter(Boolean)));
    }

    const blueprintMap = new Map<number,BlueprintPiDemand>();
    for (const blueprint of blueprints) {
      const materials = (blueprint.activities?.manufacturing?.materials ?? []).filter((material) => productTypeIds.has(Number(material.typeID))).map((material) => ({typeId:Number(material.typeID),quantity:Number(material.quantity)}));
      if (materials.length) blueprintMap.set(Number(blueprint._key),{blueprintTypeId:Number(blueprint._key),materials});
    }

    return { names,typeByName,types:indexedTypes,tiers,systems:indexedSystems,planets:indexedPlanets,planetsBySystem,schematics:schematicMap,schematicByOutput,productTypeIds,facilities,facilityByTypeId,adjacency,resourcesByPlanetType,blueprints:blueprintMap };
  }));
}

function isoOrNull(value:unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function getField(value:any, ...keys:string[]) {
  for (const key of keys) if (value?.[key] != null) return value[key];
  return undefined;
}

function pinId(pin:any) { return Number(getField(pin,"pin_id","pinId") ?? 0); }
function pinTypeId(pin:any) { return Number(getField(pin,"type_id","typeId") ?? 0); }
function pinSchematicId(pin:any) { return Number(getField(pin,"schematic_id","schematicId") ?? getField(pin?.factory_details,"schematic_id","schematicId") ?? getField(pin?.factoryDetails,"schematic_id","schematicId") ?? 0); }
function extractorDetails(pin:any) { return pin?.extractor_details ?? pin?.extractorDetails ?? null; }
function pinContents(pin:any):any[] { return Array.isArray(pin?.contents) ? pin.contents : []; }
function contentTypeId(content:any) { return Number(getField(content,"type_id","typeId") ?? 0); }
function contentAmount(content:any) { return Number(getField(content,"amount","quantity") ?? 0); }

function skillLevel(snapshot:any, skillId:number) {
  const row = (snapshot?.skills?.skills ?? []).find((skill:any) => Number(skill.skill_id) === skillId);
  return Number(row?.trained_skill_level ?? 0);
}

function skillLevelByName(snapshot:any, name:string) {
  const row = (snapshot?.skills?.skills ?? []).find((skill:any) => String(skill.name ?? "").toLowerCase() === name.toLowerCase());
  return Number(row?.trained_skill_level ?? 0);
}

function securityBand(securityStatus:number):PlanetarySecurityBand {
  if (securityStatus >= 0.45) return "high";
  if (securityStatus > 0) return "low";
  return "null";
}

function normalizedSettings(snapshot:any, input?:PlanetaryRevenueSettings) {
  const assumedSecurity = input?.assumedSecurity === "low" || input?.assumedSecurity === "null" || input?.assumedSecurity === "high" ? input.assumedSecurity : "high";
  const accountingLevel = skillLevelByName(snapshot,"Accounting");
  const brokerRelationsLevel = skillLevelByName(snapshot,"Broker Relations");
  const customsCodeExpertiseLevel = skillLevelByName(snapshot,"Customs Code Expertise");
  const salesTaxPercent = 7.5 * (1 - 0.11 * accountingLevel);
  const brokerFeePercent = input?.brokerFeePercent == null ? Math.max(0,3 - 0.3 * brokerRelationsLevel) : Math.max(0,Number(input.brokerFeePercent));
  return {
    pocoOwnerTaxPercent:Math.max(0,Number(input?.pocoOwnerTaxPercent ?? 0)),
    brokerFeePercent,
    assumedSecurity,
    cargoM3:Math.max(1,Number(input?.cargoM3 ?? 10_000)),
    haulingCostPerTripIsk:Math.max(0,Number(input?.haulingCostPerTripIsk ?? 0)),
    maxJumps:Math.max(0,Math.floor(Number(input?.maxJumps ?? 15))),
    runtimeHours:Math.max(1,Math.min(168,Number(input?.runtimeHours ?? 24))),
    accountingLevel,
    brokerRelationsLevel,
    customsCodeExpertiseLevel,
    salesTaxPercent,
  };
}

function pocoTaxPercent(settings:ReturnType<typeof normalizedSettings>, band:PlanetarySecurityBand) {
  const npc = band === "high" ? Math.max(0,10 - settings.customsCodeExpertiseLevel) : 0;
  return settings.pocoOwnerTaxPercent + npc;
}

function quoteLine(typeId:number, quantityPerCycle:number, cyclesPerDay:number, index:PiIndex, quotes:Map<number,GlobalMarketQuote>) {
  const quote = quotes.get(typeId);
  const quantityPerDay = quantityPerCycle * cyclesPerDay;
  const volumeM3 = Number(index.types.get(typeId)?.volume ?? 0);
  return {
    typeId,
    name:index.names.get(typeId) ?? `Type ${typeId}`,
    tier:index.tiers.get(typeId) ?? "unknown" as PlanetaryTier,
    quantityPerCycle,
    quantityPerDay,
    volumeM3,
    volumePerDayM3:volumeM3 * quantityPerDay,
    bestBuy:quote?.bestBuy ?? null,
    bestSell:quote?.bestSell ?? null,
    bestBuySystem:quote?.bestBuySystem ?? null,
    bestSellSystem:quote?.bestSellSystem ?? null,
    valuePerDay:quote?.bestBuy == null ? null : quantityPerDay * quote.bestBuy,
  };
}

function fillMarket(quantity:number, orders:Array<{price:number;volumeRemain:number}>) {
  let remaining = Math.max(0,quantity), gross=0,units=0;
  for (const order of orders) {
    if (remaining <= 1e-9) break;
    const available = Math.max(0,Number(order.volumeRemain ?? 0));
    if (!available) continue;
    const take = Math.min(remaining,available);
    gross += take * Number(order.price);
    units += take;
    remaining -= take;
  }
  return { gross,units,remaining,coverage:quantity <= 0 ? 1 : Math.min(1,units/quantity) };
}

function customsTax(typeId:number, quantity:number, tier:PlanetaryTier, settings:ReturnType<typeof normalizedSettings>, band:PlanetarySecurityBand, direction:"import"|"export") {
  const base = TAXABLE_VALUE[tier] ?? 0;
  if (!base || !typeId || !quantity) return 0;
  const rate = pocoTaxPercent(settings,band) / 100;
  return base * quantity * rate * (direction === "import" ? 0.5 : 1);
}

function pricePlanetarySchematic(schematic:Schematic,index:PiIndex,quotes:Map<number,GlobalMarketQuote>,settings:ReturnType<typeof normalizedSettings>,band:PlanetarySecurityBand) {
  const cycleTimeSeconds = Math.max(1,Number(schematic.cycleTime || 0));
  const cyclesPerDay = DAY_SECONDS / cycleTimeSeconds;
  const inputs = (schematic.types ?? []).filter((line) => line.isInput).map((line) => quoteLine(Number(line._key),Number(line.quantity),cyclesPerDay,index,quotes));
  const outputDef = (schematic.types ?? []).find((line) => !line.isInput);
  if (!outputDef) return null;
  const output = quoteLine(Number(outputDef._key),Number(outputDef.quantity),cyclesPerDay,index,quotes);
  const inputCostPerDay = inputs.every((line) => line.bestSell != null) ? inputs.reduce((sum,line) => sum + line.quantityPerDay * Number(line.bestSell),0) : null;
  const inputDepth = inputs.map((line) => ({ line,fill:fillMarket(line.quantityPerDay,quotes.get(line.typeId)?.sellOrders ?? []) }));
  const executableInputCostPerDay = inputDepth.every((row) => row.fill.coverage >= 0.999999) ? inputDepth.reduce((sum,row) => sum + row.fill.gross,0) : null;
  const outputGrossPerDay = output.bestBuy == null ? null : output.quantityPerDay * output.bestBuy;
  const outputSellOrderValuePerDay = output.bestSell == null ? null : output.quantityPerDay * output.bestSell;
  const buyFill = fillMarket(output.quantityPerDay,quotes.get(output.typeId)?.buyOrders ?? []);
  const executableOutputGrossPerDay = buyFill.coverage >= 0.999999 ? buyFill.gross : null;
  const inputCoveragePercent = inputDepth.length ? inputDepth.reduce((sum,row) => sum + row.fill.coverage,0) / inputDepth.length * 100 : 100;
  const outputCoveragePercent = buyFill.coverage * 100;
  const buyDepthUnits = (quotes.get(output.typeId)?.buyOrders ?? []).reduce((sum,row) => sum + Math.max(0,Number(row.volumeRemain ?? 0)),0);
  const buyDepthDays = output.quantityPerDay > 0 ? buyDepthUnits/output.quantityPerDay : 0;
  const liquidityScore = Math.max(0,Math.min(100,Math.min(inputCoveragePercent,outputCoveragePercent) * Math.min(1,Math.max(0.15,buyDepthDays/3))));

  const importTaxPerDay = inputs.reduce((sum,line) => sum + customsTax(line.typeId,line.quantityPerDay,line.tier,settings,band,"import"),0);
  const exportTaxPerDay = customsTax(output.typeId,output.quantityPerDay,output.tier,settings,band,"export");
  const salesTaxRate = settings.salesTaxPercent/100;
  const brokerRate = settings.brokerFeePercent/100;
  const immediateGross = executableOutputGrossPerDay ?? outputGrossPerDay;
  const marketInput = executableInputCostPerDay ?? inputCostPerDay;
  const hauledVolumePerDay = inputs.reduce((sum,line)=>sum+line.volumePerDayM3,0)+output.volumePerDayM3;
  const haulingCostPerDay = hauledVolumePerDay/Math.max(1,settings.cargoM3)*settings.haulingCostPerTripIsk;
  const taxAdjustedMarginPerDay = immediateGross == null || marketInput == null ? null : immediateGross * (1-salesTaxRate) - marketInput - importTaxPerDay - exportTaxPerDay - haulingCostPerDay;
  const sellOrderMarginPerDay = outputSellOrderValuePerDay == null || marketInput == null ? null : outputSellOrderValuePerDay * (1-salesTaxRate-brokerRate) - marketInput - importTaxPerDay - exportTaxPerDay - haulingCostPerDay;
  const marginPerDay = outputGrossPerDay == null || inputCostPerDay == null ? null : outputGrossPerDay-inputCostPerDay;
  const marginPercent = taxAdjustedMarginPerDay == null || marketInput == null || marketInput <= 0 ? null : taxAdjustedMarginPerDay/marketInput*100;
  const score = taxAdjustedMarginPerDay == null ? -1e15 : taxAdjustedMarginPerDay * (0.35 + 0.65*liquidityScore/100);
  return {
    schematicId:Number(schematic._key),name:schematic.name?.en ?? output.name,tier:output.tier,cycleTimeSeconds,cyclesPerDay,output,inputs,
    outputGrossPerDay,outputSellOrderValuePerDay,inputCostPerDay,marginPerDay,marginPercent,fullyPriced:outputGrossPerDay != null && inputCostPerDay != null,
    executableInputCostPerDay,executableOutputGrossPerDay,inputCoveragePercent,outputCoveragePercent,buyDepthDays,liquidityScore,
    importTaxPerDay,exportTaxPerDay,salesTaxPerDay:immediateGross == null ? null : immediateGross*salesTaxRate,brokerFeePerDay:outputSellOrderValuePerDay == null ? null : outputSellOrderValuePerDay*brokerRate,haulingCostPerDay,
    taxAdjustedMarginPerDay,sellOrderMarginPerDay,score,assumedSecurity:band,pocoTaxPercent:pocoTaxPercent(settings,band),
  };
}

export function calculateExtractorCycleValues(qtyPerCycle:number,cycleTimeSeconds:number,totalCycles:number,decayFactor=0.012,noiseFactor=0.8) {
  const values:number[] = [];
  if (!(qtyPerCycle > 0) || !(cycleTimeSeconds > 0) || !(totalCycles > 0)) return values;
  const barWidth = cycleTimeSeconds/900;
  for (let cycle=0; cycle<Math.floor(totalCycles); cycle += 1) {
    const t = (cycle+0.5)*barWidth;
    const decayValue = qtyPerCycle/(1+t*decayFactor);
    const phaseShift = Math.pow(qtyPerCycle,0.7);
    const sinA = Math.cos(phaseShift+t*(1/12));
    const sinB = Math.cos(phaseShift/2+t*0.2);
    const sinC = Math.cos(t*0.5);
    const sinStuff = Math.max((sinA+sinB+sinC)/3,0);
    const output = barWidth*decayValue*(1+noiseFactor*sinStuff);
    values.push(Math.max(0,Math.ceil(output)-1));
  }
  return values;
}

function extractorForecast(pin:any,index:PiIndex,quotes:Map<number,GlobalMarketQuote>,now=Date.now()) {
  const details = extractorDetails(pin);
  if (!details) return null;
  const install = isoOrNull(getField(pin,"install_time","installTime"));
  const expiry = isoOrNull(getField(pin,"expiry_time","expiryTime"));
  const cycleTimeSeconds = Number(getField(details,"cycle_time","cycleTime") ?? 0);
  const qtyPerCycle = Number(getField(details,"qty_per_cycle","qtyPerCycle") ?? 0);
  const productTypeId = Number(getField(details,"product_type_id","productTypeId") ?? 0);
  const facility = index.facilityByTypeId.get(pinTypeId(pin));
  if (!install || !expiry || cycleTimeSeconds <= 0 || qtyPerCycle <= 0) return { pinId:pinId(pin),active:false,productTypeId,cycleTimeSeconds,qtyPerCycle,totalUnits:0,remainingUnits:0,next24hUnits:0,hoursUntilExpiry:0,grossNext24h:null,grossRemaining:null,heads:Array.isArray(details?.heads)?details.heads.length:0 };
  const installMs=Date.parse(install), expiryMs=Date.parse(expiry);
  const totalCycles = Math.max(0,Math.floor((expiryMs-installMs)/1000/cycleTimeSeconds));
  const values = calculateExtractorCycleValues(qtyPerCycle,cycleTimeSeconds,totalCycles,facility?.decayFactor ?? 0.012,facility?.noiseFactor ?? 0.8);
  const elapsedCycles = Math.max(0,Math.floor((now-installMs)/1000/cycleTimeSeconds));
  const next24Cycles = Math.ceil(DAY_SECONDS/cycleTimeSeconds);
  const totalUnits = values.reduce((a,b)=>a+b,0);
  const remainingUnits = values.slice(Math.min(values.length,elapsedCycles)).reduce((a,b)=>a+b,0);
  const next24hUnits = values.slice(Math.min(values.length,elapsedCycles),Math.min(values.length,elapsedCycles+next24Cycles)).reduce((a,b)=>a+b,0);
  const quote = quotes.get(productTypeId);
  return {
    pinId:pinId(pin),active:expiryMs>now,productTypeId,productName:index.names.get(productTypeId) ?? `Type ${productTypeId}`,cycleTimeSeconds,qtyPerCycle,totalCycles,elapsedCycles,totalUnits,remainingUnits,next24hUnits,
    hoursUntilExpiry:Math.max(0,(expiryMs-now)/3_600_000),grossNext24h:quote?.bestBuy == null ? null : next24hUnits*quote.bestBuy,grossRemaining:quote?.bestBuy == null ? null : remainingUnits*quote.bestBuy,
    heads:Array.isArray(details?.heads)?details.heads.length:0,installTime:install,expiryTime:expiry,decayFactor:facility?.decayFactor ?? 0.012,noiseFactor:facility?.noiseFactor ?? 0.8,
  };
}

function routeFields(route:any) {
  return {
    routeId:Number(getField(route,"route_id","routeId") ?? 0),
    sourcePinId:Number(getField(route,"source_pin_id","sourcePinId") ?? 0),
    destinationPinId:Number(getField(route,"destination_pin_id","destinationPinId") ?? 0),
    typeId:Number(getField(route,"content_type_id","contentTypeId") ?? 0),
    quantity:Number(getField(route,"quantity") ?? 0),
    waypoints:(getField(route,"waypoints") ?? []).map(Number),
  };
}

function linkKey(a:number,b:number) { return a < b ? `${a}:${b}` : `${b}:${a}`; }

function auditCharacterColonies(snapshot:any,index:PiIndex,quotes:Map<number,GlobalMarketQuote>,opportunityMap:Map<number,any>,settings:ReturnType<typeof normalizedSettings>) {
  const planets = Array.isArray(snapshot?.extended?.planets) ? snapshot.extended.planets : [];
  const planetDetails = Array.isArray(snapshot?.extended?.planetDetails) ? snapshot.extended.planetDetails : [];
  const alerts:any[] = [];
  const colonies = planets.map((planet:any) => {
    const planetId = Number(getField(planet,"planet_id","planetId") ?? 0);
    const detailWrapper = planetDetails.find((item:any) => Number(getField(item,"planet_id","planetId") ?? 0) === planetId) ?? {};
    const detail = detailWrapper?.colony ?? detailWrapper;
    const pins = Array.isArray(detail?.pins) ? detail.pins : [];
    const links = Array.isArray(detail?.links) ? detail.links : [];
    const routesRaw = Array.isArray(detail?.routes) ? detail.routes : [];
    const pinMap = new Map(pins.map((pin:any) => [pinId(pin),pin]));
    const linkSet = new Set(links.map((link:any) => linkKey(Number(getField(link,"source_pin_id","sourcePinId") ?? 0),Number(getField(link,"destination_pin_id","destinationPinId") ?? 0))));
    const routeRows = routesRaw.map((raw:any) => {
      const route = routeFields(raw);
      const path = [route.sourcePinId,...route.waypoints,route.destinationPinId].filter((value,index,array) => value>0 && (index===0 || value!==array[index-1]));
      const missingPin = !pinMap.has(route.sourcePinId) || !pinMap.has(route.destinationPinId);
      let connected = !missingPin;
      for (let i=0;i<path.length-1;i+=1) if (!linkSet.has(linkKey(path[i],path[i+1]))) connected=false;
      return {...route,path,valid:connected && path.length>=2,issue:missingPin?"Missing source/destination pin":connected?null:"Route path contains an unlinked hop"};
    });
    const systemId = Number(getField(planet,"solar_system_id","solarSystemId") ?? index.planets.get(planetId)?.systemId ?? 0);
    const system = index.systems.get(systemId);
    const band = securityBand(system?.securityStatus ?? 0);
    const processors = pins.filter((pin:any) => pinSchematicId(pin)>0 && opportunityMap.has(pinSchematicId(pin)));
    const extractorRows = pins.map((pin:any) => extractorForecast(pin,index,quotes)).filter(Boolean).map((row:any) => { const outputRoutes=routeRows.filter((route:any)=>route.sourcePinId===row.pinId&&route.typeId===row.productTypeId);const validOutputRoutes=outputRoutes.filter((route:any)=>route.valid);return {...row,outputRoutes:outputRoutes.length,validOutputRoutes:validOutputRoutes.length,unrouted:validOutputRoutes.length===0}; }) as any[];
    const processorHealth = processors.map((pin:any) => {
      const schematicId=pinSchematicId(pin), recipe=opportunityMap.get(schematicId), id=pinId(pin);
      const inputStatuses = recipe.inputs.map((input:any) => {
        const inbound = routeRows.filter((route:any) => route.destinationPinId===id && route.typeId===input.typeId);
        const validInbound = inbound.filter((route:any) => route.valid);
        let available=pinContents(pin).filter((content:any)=>contentTypeId(content)===input.typeId).reduce((sum:number,content:any)=>sum+contentAmount(content),0);
        let continuous=false;
        for (const route of validInbound) {
          const source=pinMap.get(route.sourcePinId);
          if (!source) continue;
          available += pinContents(source).filter((content:any)=>contentTypeId(content)===input.typeId).reduce((sum:number,content:any)=>sum+contentAmount(content),0);
          const upstream = opportunityMap.get(pinSchematicId(source));
          if (upstream?.output?.typeId===input.typeId) continuous=true;
        }
        const hoursRemaining = continuous ? null : input.quantityPerDay>0 ? available/input.quantityPerDay*24 : null;
        return {typeId:input.typeId,name:input.name,requiredPerDay:input.quantityPerDay,inboundRoutes:inbound.length,validInboundRoutes:validInbound.length,availableUnits:available,continuous,hoursRemaining,starved:validInbound.length===0};
      });
      const outputRoutes=routeRows.filter((route:any)=>route.sourcePinId===id && route.typeId===recipe.output.typeId);
      const validOutputRoutes=outputRoutes.filter((route:any)=>route.valid);
      const starving=inputStatuses.some((row:any)=>row.starved), lowestHours=Math.min(...inputStatuses.map((row:any)=>row.hoursRemaining ?? Infinity));
      return {pinId:id,schematicId,name:recipe.name,outputTypeId:recipe.output.typeId,outputName:recipe.output.name,inputs:inputStatuses,outputRoutes:outputRoutes.length,validOutputRoutes:validOutputRoutes.length,starving,lowestHoursRemaining:Number.isFinite(lowestHours)?lowestHours:null,unroutedOutput:validOutputRoutes.length===0};
    });

    const storagePins = pins.filter((pin:any) => { const kind=index.facilityByTypeId.get(pinTypeId(pin))?.kind; return kind==="launchpad"||kind==="storage"; });
    const storage = storagePins.map((pin:any) => {
      const facility=index.facilityByTypeId.get(pinTypeId(pin));
      const usedM3=pinContents(pin).reduce((sum:number,content:any)=>sum+contentAmount(content)*Number(index.types.get(contentTypeId(content))?.volume ?? 0),0);
      const capacityM3=Number(facility?.capacityM3 ?? index.types.get(pinTypeId(pin))?.capacity ?? 0);
      const id=pinId(pin);let inboundM3PerDay=0,outboundM3PerDay=0;for(const route of routeRows.filter((row:any)=>row.valid&&row.destinationPinId===id)){const source=pinMap.get(route.sourcePinId);const sourceRecipe=source?opportunityMap.get(pinSchematicId(source)):null;const sourceExtractor=extractorRows.find((row:any)=>row.pinId===route.sourcePinId&&row.productTypeId===route.typeId);let units=0;if(sourceRecipe)units=route.quantity*(DAY_SECONDS/sourceRecipe.cycleTimeSeconds);else if(sourceExtractor)units=sourceExtractor.next24hUnits/Math.max(1,sourceExtractor.validOutputRoutes);inboundM3PerDay+=units*Number(index.types.get(route.typeId)?.volume??0);}for(const route of routeRows.filter((row:any)=>row.valid&&row.sourcePinId===id)){const destination=pinMap.get(route.destinationPinId);const destRecipe=destination?opportunityMap.get(pinSchematicId(destination)):null;let units=0;if(destRecipe)units=route.quantity*(DAY_SECONDS/destRecipe.cycleTimeSeconds);outboundM3PerDay+=units*Number(index.types.get(route.typeId)?.volume??0);}const netInflowM3PerDay=inboundM3PerDay-outboundM3PerDay;const hoursToFull=capacityM3>usedM3&&netInflowM3PerDay>0?(capacityM3-usedM3)/netInflowM3PerDay*24:null;return {pinId:id,name:facility?.name ?? index.names.get(pinTypeId(pin)) ?? "Storage",usedM3,capacityM3,fillPercent:capacityM3>0?usedM3/capacityM3*100:0,inboundM3PerDay,outboundM3PerDay,netInflowM3PerDay,hoursToFull};
    });

    const badRoutes=routeRows.filter((route:any)=>!route.valid).length;
    const expiredExtractors=extractorRows.filter((row:any)=>!row.active).length;
    const expiringExtractors=extractorRows.filter((row:any)=>row.active&&row.hoursUntilExpiry<=24).length;
    const unroutedExtractors=extractorRows.filter((row:any)=>row.active&&row.unrouted).length;
    const starvedProcessors=processorHealth.filter((row:any)=>row.starving).length;
    const unroutedProcessors=processorHealth.filter((row:any)=>row.unroutedOutput).length;
    const lowStockProcessors=processorHealth.filter((row:any)=>row.lowestHoursRemaining!=null&&row.lowestHoursRemaining<=24&&!row.starving).length;
    const fullStorage=storage.filter((row:any)=>row.fillPercent>=85||(row.hoursToFull!=null&&row.hoursToFull<=24)).length;
    let healthScore=100;
    healthScore-=Math.min(45,starvedProcessors*15+unroutedProcessors*10);
    healthScore-=Math.min(25,badRoutes*10);
    healthScore-=Math.min(20,expiredExtractors*10+expiringExtractors*4+unroutedExtractors*5);
    healthScore-=Math.min(15,lowStockProcessors*5+fullStorage*5);
    healthScore=Math.max(0,healthScore);
    const characterName=String(snapshot?.character?.name ?? "Unknown character");
    const planetLabel=`${system?.name ?? `System ${systemId}`} ${index.planets.get(planetId)?.celestialIndex ? `Planet ${index.planets.get(planetId)?.celestialIndex}` : "planet"}`;
    const addAlert=(severity:string,type:string,message:string,hoursUntil:number|null=null)=>alerts.push({id:`${snapshot.characterId}:${planetId}:${type}:${message}`,severity,type,characterId:String(snapshot.characterId),characterName,planetId,planetLabel,message,hoursUntil});
    if (expiredExtractors) addAlert("critical","extractor-expired",`${expiredExtractors} extractor program${expiredExtractors===1?" has":"s have"} expired.`,0);
    for (const extractor of extractorRows.filter((row:any)=>row.active&&row.hoursUntilExpiry<=24)) addAlert(extractor.hoursUntilExpiry<=6?"critical":"warning","extractor-expiring",`${extractor.productName} extractor expires in ${extractor.hoursUntilExpiry.toFixed(1)}h.`,extractor.hoursUntilExpiry);
    if (unroutedExtractors) addAlert("critical","extractor-unrouted",`${unroutedExtractors} active extractor${unroutedExtractors===1?" has":"s have"} no valid output route.`,0);
    if (starvedProcessors) addAlert("critical","processor-starved",`${starvedProcessors} processor${starvedProcessors===1?" has":"s have"} no valid inbound route for at least one input.`,0);
    if (unroutedProcessors) addAlert("warning","output-unrouted",`${unroutedProcessors} processor${unroutedProcessors===1?" has":"s have"} no valid output route.`,null);
    if (badRoutes) addAlert("warning","broken-route",`${badRoutes} PI route${badRoutes===1?" is":"s are"} disconnected from the colony link graph.`,null);
    const lowestStock=processorHealth.map((row:any)=>row.lowestHoursRemaining).filter((value:any)=>value!=null&&value<=24).sort((a:number,b:number)=>a-b)[0];
    if (lowestStock!=null) addAlert(lowestStock<=6?"critical":"warning","input-low",`A factory input buffer is estimated to run dry in ${lowestStock.toFixed(1)}h.`,lowestStock);
    if (fullStorage) { const soonest=storage.map((row:any)=>row.hoursToFull).filter((value:any)=>value!=null&&value<=24).sort((a:number,b:number)=>a-b)[0]??null;addAlert(soonest!=null&&soonest<=6?"critical":"warning","storage-full",soonest!=null?`${fullStorage} storage pin${fullStorage===1?" is":"s are"} projected to fill; soonest in ${soonest.toFixed(1)}h.`:`${fullStorage} storage pin${fullStorage===1?" is":"s are"} at least 85% full.`,soonest); }

    const recipesById=new Map<number,number>();
    for (const pin of processors) recipesById.set(pinSchematicId(pin),(recipesById.get(pinSchematicId(pin))??0)+1);
    const recipes=[...recipesById].map(([schematicId,count])=>{const recipe=opportunityMap.get(schematicId);return {schematicId,name:recipe.name,outputTypeId:recipe.output.typeId,outputName:recipe.output.name,outputPerDay:recipe.output.quantityPerDay*count,processors:count,grossPerDay:recipe.outputGrossPerDay==null?null:recipe.outputGrossPerDay*count,marginPerDay:recipe.taxAdjustedMarginPerDay==null?null:recipe.taxAdjustedMarginPerDay*count};});
    let storageValue=0;
    for (const pin of pins) for (const content of pinContents(pin)) { const quote=quotes.get(contentTypeId(content)); if (quote?.bestBuy!=null) storageValue += contentAmount(content)*quote.bestBuy; }
    const extractorGrossNext24h=extractorRows.every((row:any)=>row.grossNext24h!=null)?extractorRows.reduce((sum:number,row:any)=>sum+Number(row.grossNext24h),0):null;
    const configuredMarginCapacityPerDay=recipes.every((row:any)=>row.marginPerDay!=null)?recipes.reduce((sum:number,row:any)=>sum+Number(row.marginPerDay),0):null;
    const attentionCandidates=[...extractorRows.map((row:any)=>row.active?row.hoursUntilExpiry:null),...processorHealth.map((row:any)=>row.lowestHoursRemaining)].filter((value:any)=>value!=null&&Number.isFinite(value));
    return {
      characterId:String(snapshot.characterId),characterName,planetId,planetType:index.planets.get(planetId)?.typeName ?? String(getField(planet,"planet_type","planetType") ?? "unknown"),planetTypeId:index.planets.get(planetId)?.typeId ?? 0,
      solarSystemId:systemId,solarSystemName:system?.name ?? `System ${systemId}`,regionName:system?.regionName ?? "Unknown region",securityStatus:system?.securityStatus ?? 0,securityBand:band,
      upgradeLevel:Number(getField(planet,"upgrade_level","upgradeLevel") ?? 0),pinCount:Number(getField(planet,"num_pins","numPins") ?? pins.length),processors:processors.length,activeExtractors:extractorRows.filter((row:any)=>row.active).length,expiredExtractors,
      extractorGrossPerDay:extractorGrossNext24h,configuredGrossPerDay:recipes.reduce((sum:number,row:any)=>sum+Number(row.grossPerDay??0),0),configuredMarginCapacityPerDay,storageValue,lastUpdate:isoOrNull(getField(planet,"last_update","lastUpdate")),
      healthScore,status:healthScore>=90?"healthy":healthScore>=70?"watch":"attention",badRoutes,starvedProcessors,unroutedProcessors,unroutedExtractors,lowStockProcessors,fullStorage,attentionHours:attentionCandidates.length?Math.min(...attentionCandidates):null,
      routes:routeRows,processorsHealth:processorHealth,storage,extractors:extractorRows,recipes,
    };
  });
  return {colonies,alerts};
}

function stockpileAcrossSnapshots(snapshots:any[],index:PiIndex) {
  const map=new Map<number,{typeId:number;name:string;tier:PlanetaryTier;quantity:number;volumeM3:number;characters:Set<string>;locations:Set<string>}>();
  const add=(typeId:number,quantity:number,character:string,location:string)=>{
    if (!index.productTypeIds.has(typeId)||quantity<=0) return;
    const current=map.get(typeId)??{typeId,name:index.names.get(typeId)??`Type ${typeId}`,tier:index.tiers.get(typeId)??"unknown",quantity:0,volumeM3:Number(index.types.get(typeId)?.volume??0),characters:new Set<string>(),locations:new Set<string>()};
    current.quantity+=quantity;current.characters.add(character);if(location)current.locations.add(location);map.set(typeId,current);
  };
  for (const snapshot of snapshots) {
    const character=String(snapshot?.character?.name??"Unknown");
    for (const asset of Array.isArray(snapshot?.extended?.assets)?snapshot.extended.assets:[]) add(Number(asset.type_id??asset.typeId??0),Math.max(0,Number(asset.quantity??0)),character,String(asset.station??asset.system??"Assets"));
    for (const wrapper of Array.isArray(snapshot?.extended?.planetDetails)?snapshot.extended.planetDetails:[]) {
      const detail=wrapper?.colony??wrapper;
      for(const pin of Array.isArray(detail?.pins)?detail.pins:[]) for(const content of pinContents(pin)) add(contentTypeId(content),contentAmount(content),character,"PI colony storage");
    }
  }
  return [...map.values()].map((row)=>({...row,characters:[...row.characters],locations:[...row.locations]})).sort((a,b)=>b.quantity-a.quantity);
}

function industryDemandAcrossSnapshots(snapshots:any[],index:PiIndex) {
  const map=new Map<number,{typeId:number;name:string;tier:PlanetaryTier;baseQuantity:number;jobs:number;characters:Set<string>}>();
  for(const snapshot of snapshots){
    const character=String(snapshot?.character?.name??"Unknown");
    for(const job of Array.isArray(snapshot?.extended?.industryJobs)?snapshot.extended.industryJobs:[]){
      const status=String(job.status??"").toLowerCase();
      if (["delivered","cancelled","reverted"].includes(status)) continue;
      const blueprint=index.blueprints.get(Number(job.blueprint_type_id??job.blueprintTypeId??0));
      if(!blueprint)continue;
      const runs=Math.max(1,Number(job.runs??1));
      for(const material of blueprint.materials){
        const current=map.get(material.typeId)??{typeId:material.typeId,name:index.names.get(material.typeId)??`Type ${material.typeId}`,tier:index.tiers.get(material.typeId)??"unknown",baseQuantity:0,jobs:0,characters:new Set<string>()};
        current.baseQuantity+=material.quantity*runs;current.jobs+=1;current.characters.add(character);map.set(material.typeId,current);
      }
    }
  }
  return [...map.values()].map((row)=>({...row,characters:[...row.characters]})).sort((a,b)=>b.baseQuantity-a.baseQuantity);
}

function characterPiSummary(snapshot:any,index:PiIndex) {
  const colonies=Array.isArray(snapshot?.extended?.planets)?snapshot.extended.planets.length:0;
  const interplanetary=skillLevel(snapshot,2495), ccu=skillLevel(snapshot,2505);
  return {characterId:String(snapshot?.characterId??""),characterName:String(snapshot?.character?.name??"Unknown"),colonies,maxColonies:Math.min(6,Math.max(1,interplanetary+1)),spareColonies:Math.max(0,Math.min(6,Math.max(1,interplanetary+1))-colonies),commandCenterUpgrades:ccu,interplanetaryConsolidation:interplanetary,systemId:Number(snapshot?.location?.solar_system_id??0),systemName:String(snapshot?.location?.solar_system_name??"Unknown")};
}

function maxBuildableFromStockpile(root:any,stockpile:Map<number,number>) {
  if (!root?.inputs?.length) return null;
  const cycles=root.inputs.map((input:any)=>input.quantityPerCycle>0?(stockpile.get(input.typeId)??0)/input.quantityPerCycle:Infinity);
  const cycleCount=Math.floor(Math.min(...cycles));
  return {cycles:Math.max(0,cycleCount),outputUnits:Math.max(0,cycleCount)*root.output.quantityPerCycle};
}

export async function analyzePlanetaryRevenue(snapshot:any,allSnapshots:any[]=[],inputSettings?:PlanetaryRevenueSettings) {
  const index=await piIndex();
  const snapshots=allSnapshots.length?allSnapshots:[snapshot];
  const settings=normalizedSettings(snapshot,inputSettings);
  const extraContentTypeIds=new Set<number>();
  for(const candidate of snapshots) for(const wrapper of Array.isArray(candidate?.extended?.planetDetails)?candidate.extended.planetDetails:[]) for(const pin of wrapper?.colony?.pins??wrapper?.pins??[]) for(const content of pinContents(pin)) extraContentTypeIds.add(contentTypeId(content));
  const market=await loadGlobalMarketQuotes([...index.productTypeIds,...extraContentTypeIds]);
  const quoteMap=new Map(market.quotes.map((quote)=>[Number(quote.typeId),quote]));
  const opportunityMap=new Map<number,any>();
  const opportunities=[...index.schematics.values()].flatMap((schematic)=>{const priced=pricePlanetarySchematic(schematic,index,quoteMap,settings,settings.assumedSecurity);if(!priced)return[];opportunityMap.set(priced.schematicId,priced);return[priced];}).sort((a,b)=>b.score-a.score||Number(b.taxAdjustedMarginPerDay??-Infinity)-Number(a.taxAdjustedMarginPerDay??-Infinity));
  const empireAudits=snapshots.map((candidate)=>auditCharacterColonies(candidate,index,quoteMap,opportunityMap,normalizedSettings(candidate,inputSettings)));
  const colonies=empireAudits.flatMap((row)=>row.colonies);
  const alerts=empireAudits.flatMap((row)=>row.alerts).sort((a,b)=>({critical:0,warning:1,info:2}[a.severity as "critical"|"warning"|"info"]??3)-({critical:0,warning:1,info:2}[b.severity as "critical"|"warning"|"info"]??3)||(a.hoursUntil??Infinity)-(b.hoursUntil??Infinity));
  const stockpile=stockpileAcrossSnapshots(snapshots,index);
  const stockpileMap=new Map(stockpile.map((row)=>[row.typeId,row.quantity]));
  const industryDemand=industryDemandAcrossSnapshots(snapshots,index);
  const characters=snapshots.map((candidate)=>characterPiSummary(candidate,index));
  for (const character of characters.filter((row)=>row.spareColonies>0)) alerts.push({id:`${character.characterId}:unused-slots:${character.spareColonies}`,severity:"info",type:"unused-colony-slot",characterId:character.characterId,characterName:character.characterName,planetId:0,planetLabel:"Empire capacity",message:`${character.spareColonies} unused colony slot${character.spareColonies===1?"":"s"} available.`,hoursUntil:null});
  alerts.sort((a,b)=>({critical:0,warning:1,info:2}[a.severity as "critical"|"warning"|"info"]??3)-({critical:0,warning:1,info:2}[b.severity as "critical"|"warning"|"info"]??3)||(a.hoursUntil??Infinity)-(b.hoursUntil??Infinity));
  const selectedAudit=empireAudits.find((_row,indexValue)=>String(snapshots[indexValue]?.characterId)===String(snapshot?.characterId))??{colonies:[],alerts:[]};
  const selectedColonies:any[]=selectedAudit.colonies;
  const skills=PI_SKILL_IDS.map((typeId)=>({typeId,name:index.names.get(typeId)??`Skill ${typeId}`,level:skillLevel(snapshot,typeId)}));
  const best=opportunities.find((row)=>Number(row.taxAdjustedMarginPerDay)>0)??opportunities[0]??null;
  return {
    generatedAt:new Date().toISOString(),marketCreatedAt:market.createdAt,
    character:{id:String(snapshot?.characterId??""),name:String(snapshot?.character?.name??"Unknown character")},
    settings:{...settings,pocoTaxPercent:pocoTaxPercent(settings,settings.assumedSecurity)},
    capacity:{colonies:selectedColonies.length,maxColonies:characterPiSummary(snapshot,index).maxColonies,spare:characterPiSummary(snapshot,index).spareColonies,skills},
    summary:{
      processors:selectedColonies.reduce((sum,row)=>sum+row.processors,0),activeExtractors:selectedColonies.reduce((sum,row)=>sum+row.activeExtractors,0),expiredExtractors:selectedColonies.reduce((sum,row)=>sum+row.expiredExtractors,0),
      extractorGrossPerDay:selectedColonies.every((row)=>row.extractorGrossPerDay!=null)?selectedColonies.reduce((sum,row)=>sum+Number(row.extractorGrossPerDay),0):null,
      configuredGrossPerDay:selectedColonies.reduce((sum,row)=>sum+row.configuredGrossPerDay,0),configuredMarginCapacityPerDay:selectedColonies.every((row)=>row.configuredMarginCapacityPerDay!=null)?selectedColonies.reduce((sum,row)=>sum+Number(row.configuredMarginCapacityPerDay),0):null,
      storedPiValue:selectedColonies.reduce((sum,row)=>sum+row.storageValue,0),bestOpportunityMarginPerDay:best?.taxAdjustedMarginPerDay??null,healthScore:selectedColonies.length?selectedColonies.reduce((sum,row)=>sum+row.healthScore,0)/selectedColonies.length:null,
    },
    empire:{characters,colonies,alerts,totals:{characters:characters.length,colonies:colonies.length,spareColonies:characters.reduce((sum,row)=>sum+row.spareColonies,0),processors:colonies.reduce((sum,row)=>sum+row.processors,0),activeExtractors:colonies.reduce((sum,row)=>sum+row.activeExtractors,0),stockpileUnits:stockpile.reduce((sum,row)=>sum+row.quantity,0),alerts:alerts.length}},
    colonies:selectedColonies,alerts:selectedAudit.alerts,opportunities,stockpile,industryDemand,
    stockpileBuildability:opportunities.slice(0,100).map((row)=>({typeId:row.output.typeId,name:row.output.name,...maxBuildableFromStockpile(row,stockpileMap)})),
    notes:[
      "Extractor forecasts use CCP's documented decay/noise curve over the actual ESI program window; qty_per_cycle is a base value, not a flat realized cycle yield.",
      "Factory profitability includes configured POCO import/export tax plus character Accounting/Broker Relations assumptions. Immediate liquidation uses retained buy-order depth; sell-order potential is a separate estimate.",
      "Market liquidity is based on Sage's retained executable order depth, not historical trade volume.",
      "Actual planetary resource density is not exposed by ESI or the CCP SDE. Sage can rank compatible planet types deterministically and can incorporate player-entered density observations in the planner.",
      "Active-industry PI demand is a base SDE material signal; blueprint ME and already-consumed job materials can make actual requirements differ.",
    ],
  };
}

function buildChain(root:any,finalProcessors:number,opportunities:any[],mode:PlanetaryPlanMode,hybridBuildTypeIds:Set<number>) {
  const byOutput=new Map(opportunities.map((row)=>[Number(row.output.typeId),row]));
  const processors=new Map<number,{row:any;equivalent:number}>();
  const external=new Map<number,{typeId:number;name:string;tier:PlanetaryTier;quantityPerDay:number;volumeM3:number}>();
  const visit=(row:any,equivalent:number,trail:Set<number>)=>{
    const current=processors.get(row.schematicId);processors.set(row.schematicId,{row,equivalent:(current?.equivalent??0)+equivalent});
    const nextTrail=new Set(trail);nextTrail.add(row.schematicId);
    for(const input of row.inputs){
      const required=input.quantityPerDay*equivalent;
      const upstream=byOutput.get(Number(input.typeId));
      const buildUpstream=upstream&&input.tier!=="P0"&&!nextTrail.has(upstream.schematicId)&&(mode==="full"||(mode==="hybrid"&&hybridBuildTypeIds.has(input.typeId)));
      if(buildUpstream&&upstream.output.quantityPerDay>0)visit(upstream,required/upstream.output.quantityPerDay,nextTrail);
      else {const existing=external.get(input.typeId);external.set(input.typeId,{typeId:input.typeId,name:input.name,tier:input.tier,quantityPerDay:(existing?.quantityPerDay??0)+required,volumeM3:input.volumeM3});}
    }
  };
  visit(root,Math.max(0.000001,finalProcessors),new Set());
  const processorRows=[...processors.values()].map(({row,equivalent})=>({schematicId:row.schematicId,name:row.name,tier:row.tier,outputTypeId:row.output.typeId,outputName:row.output.name,equivalent,dedicated:Math.max(1,Math.ceil(equivalent-1e-9)),cycleTimeSeconds:row.cycleTimeSeconds,inputs:row.inputs,output:row.output})).sort((a,b)=>Number(b.tier.slice(1)||0)-Number(a.tier.slice(1)||0));
  return {processors:processorRows,externalInputs:[...external.values()].sort((a,b)=>b.quantityPerDay-a.quantityPerDay),processorEquivalent:processorRows.reduce((sum,row)=>sum+row.equivalent,0),dedicatedProcessors:processorRows.reduce((sum,row)=>sum+row.dedicated,0)};
}

function recommendedHybridBuildIds(opportunities:any[]) {
  return opportunities.filter((row)=>row.tier!=="P1"&&row.inputCostPerDay!=null&&row.output.bestSell!=null&&row.output.quantityPerDay>0&&row.inputCostPerDay/row.output.quantityPerDay < row.output.bestSell*0.9).map((row)=>Number(row.output.typeId));
}

function bfsDistances(origin:number,adjacency:Map<number,number[]>,max=50) {
  const distances=new Map<number,number>([[origin,0]]), queue=[origin];
  for(let cursor=0;cursor<queue.length;cursor+=1){const current=queue[cursor],distance=distances.get(current)!;if(distance>=max)continue;for(const next of adjacency.get(current)??[]){if(distances.has(next))continue;distances.set(next,distance+1);queue.push(next);}}
  return distances;
}

function rawResourceIdsForPlan(chain:ReturnType<typeof buildChain>) { return [...new Set(chain.externalInputs.filter((row)=>row.tier==="P0").map((row)=>row.typeId))]; }

function observationPercent(row:PlanetaryResourceObservation) {
  const direct=Number(row.percent);
  if(Number.isFinite(direct))return Math.max(0,Math.min(100,direct));
  const legacy=Number(row.score);
  return Number.isFinite(legacy)?Math.max(0,Math.min(100,legacy<=5?legacy*20:legacy)):null;
}

function observationTime(row:PlanetaryResourceObservation){const value=Date.parse(String(row.observedAt??""));return Number.isFinite(value)?value:0;}

function latestObservationFor(planetId:number,resourceId:number,observations:PlanetaryResourceObservation[],index:PiIndex) {
  const resourceName=(index.names.get(resourceId)??"").toLowerCase();
  return observations
    .filter((row)=>Number(row.planetId)===planetId && (Number(row.resourceTypeId)===resourceId || (row.resourceTypeId==null && String(row.resourceName??"").toLowerCase()===resourceName)))
    .filter((row)=>observationPercent(row)!=null)
    .sort((a,b)=>observationTime(b)-observationTime(a))[0]??null;
}

export function summarizePlanetaryDensityEvidence(planetId:number,resourceIds:number[],observations:PlanetaryResourceObservation[],nameByTypeId?:Map<number,string>) {
  const indexLike={names:nameByTypeId??new Map<number,string>()} as PiIndex;
  const resources=resourceIds.map((resourceTypeId)=>{const row=latestObservationFor(planetId,resourceTypeId,observations,indexLike);return {resourceTypeId,resourceName:nameByTypeId?.get(resourceTypeId)??row?.resourceName??`Type ${resourceTypeId}`,percent:row?observationPercent(row):null,confidence:row?.confidence==null?null:Math.max(0,Math.min(1,Number(row.confidence))),observedAt:row?.observedAt??null,source:row?.source??null,scope:row?.scope??"personal"};});
  const known=resources.filter((row)=>row.percent!=null) as Array<typeof resources[number]&{percent:number}>;
  const complete=resourceIds.length>0 && known.length===resourceIds.length;
  return {resources,knownResources:known.length,requiredResources:resourceIds.length,complete,bottleneckPercent:complete?Math.min(...known.map((row)=>row.percent)):null,averagePercent:known.length?known.reduce((sum,row)=>sum+row.percent,0)/known.length:null,knownPercent:resourceIds.length?known.length/resourceIds.length*100:100};
}

function findSystemsForPlan(index:PiIndex,rawResourceIds:number[],originSystemId:number,maxJumps:number,securityFilter:"any"|PlanetarySecurityBand,observations:PlanetaryResourceObservation[]) {
  const distances=originSystemId?bfsDistances(originSystemId,index.adjacency,maxJumps):new Map([...index.systems.keys()].map((id)=>[id,0]));
  const systems:any[]=[];const planets:any[]=[];
  for(const [systemId,distance] of distances){
    if(distance>maxJumps)continue;const system=index.systems.get(systemId);if(!system)continue;const band=securityBand(system.securityStatus);if(securityFilter!=="any"&&band!==securityFilter)continue;
    const systemPlanets=(index.planetsBySystem.get(systemId)??[]).filter((planet)=>index.resourcesByPlanetType.has(planet.typeId));
    if(!systemPlanets.length)continue;
    const available=new Set<number>();
    const systemBest=new Map<number,number>();
    for(const planet of systemPlanets){
      const resources=index.resourcesByPlanetType.get(planet.typeId)??new Set<number>();
      for(const id of resources)if(rawResourceIds.includes(id))available.add(id);
      const covers=rawResourceIds.filter((id)=>resources.has(id));
      if(covers.length||!rawResourceIds.length){
        const evidence=summarizePlanetaryDensityEvidence(planet.id,covers.length?covers:rawResourceIds,observations,index.names);
        for(const row of evidence.resources)if(row.percent!=null)systemBest.set(row.resourceTypeId,Math.max(systemBest.get(row.resourceTypeId)??0,row.percent));
        const coverage=rawResourceIds.length?covers.length/rawResourceIds.length:1;
        const densityBonus=evidence.bottleneckPercent==null?0:evidence.bottleneckPercent*.35;
        planets.push({planetId:planet.id,systemId,systemName:system.name,regionName:system.regionName,securityStatus:system.securityStatus,securityBand:band,jumps:distance,planetTypeId:planet.typeId,planetType:planet.typeName,planetIndex:planet.celestialIndex,radiusKm:planet.radiusM/1000,resources:covers.map((id)=>({typeId:id,name:index.names.get(id)??`Type ${id}`})),coveragePercent:coverage*100,observationScore:evidence.averagePercent,densityAveragePercent:evidence.averagePercent,densityBottleneckPercent:evidence.bottleneckPercent,densityKnownPercent:evidence.knownPercent,observedResources:evidence.resources,score:coverage*100-distance*2-(planet.radiusM/1e6)*0.15+densityBonus});
      }
    }
    const coverage=rawResourceIds.length?available.size/rawResourceIds.length*100:100;
    const densityRows=rawResourceIds.map((id)=>systemBest.get(id)).filter((value):value is number=>value!=null);
    const densityComplete=rawResourceIds.length>0&&densityRows.length===rawResourceIds.length;
    const bottleneck=densityComplete?Math.min(...densityRows):null;
    systems.push({systemId,systemName:system.name,regionName:system.regionName,securityStatus:system.securityStatus,securityBand:band,jumps:distance,planetCount:systemPlanets.length,coveredResources:[...available].map((id)=>({typeId:id,name:index.names.get(id)??`Type ${id}`})),coveragePercent:coverage,fullCoverage:coverage>=99.999,densityBottleneckPercent:bottleneck,densityKnownPercent:rawResourceIds.length?densityRows.length/rawResourceIds.length*100:100,score:coverage-distance*2+Math.min(20,systemPlanets.length)+(bottleneck??0)*.25});
  }
  systems.sort((a,b)=>b.score-a.score||a.jumps-b.jumps);planets.sort((a,b)=>b.score-a.score||a.jumps-b.jumps||a.radiusKm-b.radiusKm);
  return {systems:systems.slice(0,50),planets:planets.slice(0,100)};
}

function greedyPlanetTypes(index:PiIndex,resourceIds:number[]) {
  const remaining=new Set(resourceIds),roles:any[]=[];
  while(remaining.size){
    let best:{planetTypeId:number;covered:number[]}|null=null;
    for(const [planetTypeId,resources] of index.resourcesByPlanetType){const covered=[...remaining].filter((id)=>resources.has(id));if(!best||covered.length>best.covered.length)best={planetTypeId,covered};}
    if(!best||!best.covered.length)break;
    roles.push({planetTypeId:best.planetTypeId,planetType:planetTypeLabel(index.names.get(best.planetTypeId)??`Type ${best.planetTypeId}`),resourceTypeIds:best.covered,resources:best.covered.map((id)=>index.names.get(id)??`Type ${id}`)});for(const id of best.covered)remaining.delete(id);
  }
  return {roles,uncovered:[...remaining]};
}

function allocateCharacters(characters:any[],roles:any[],includeFactory:boolean) {
  const slots=characters.flatMap((character)=>Array.from({length:character.spareColonies},()=>character));
  slots.sort((a,b)=>b.commandCenterUpgrades-a.commandCenterUpgrades||b.spareColonies-a.spareColonies);
  const tasks=[...(includeFactory?[{role:"Factory",detail:"Factory / launchpad colony",planetType:null,resources:[]}]:[]),...roles.map((role)=>({role:"Extraction",detail:`Extract ${role.resources.join(", ")}`,planetType:role.planetType,resources:role.resources}))];
  const assignments=tasks.map((task,index)=>({ ...task,characterId:slots[index]?.characterId??null,characterName:slots[index]?.characterName??null,ccuLevel:slots[index]?.commandCenterUpgrades??null,assigned:Boolean(slots[index]) }));
  return {assignments,requiredColonies:tasks.length,availableColonies:slots.length,deficit:Math.max(0,tasks.length-slots.length)};
}

function facilityForTier(index:PiIndex,planetTypeId:number,tier:PlanetaryTier) {
  const kind:FacilityKind=tier==="P1"?"basic":tier==="P2"||tier==="P3"?"advanced":tier==="P4"?"hightech":"basic";
  return index.facilities.find((facility)=>facility.planetTypeId===planetTypeId&&facility.kind===kind)??null;
}

function launchpadFor(index:PiIndex,planetTypeId:number){return index.facilities.find((facility)=>facility.planetTypeId===planetTypeId&&facility.kind==="launchpad")??null;}
function commandCenterFor(index:PiIndex,planetTypeId:number,ccuLevel:number){const rows=index.facilities.filter((facility)=>facility.planetTypeId===planetTypeId&&facility.kind==="command"&&facility.requiredLevel<=ccuLevel);return rows.sort((a,b)=>b.requiredLevel-a.requiredLevel||b.powerOutput-a.powerOutput)[0]??null;}

function simulateLayout(index:PiIndex,chain:ReturnType<typeof buildChain>,planetTypeId:number,ccuLevel:number,planet:IndexedPlanet|null,runtimeHours:number) {
  const cc=commandCenterFor(index,planetTypeId,ccuLevel), launchpad=launchpadFor(index,planetTypeId);
  const runtimeDays=runtimeHours/24;
  const externalVolume=chain.externalInputs.reduce((sum,row)=>sum+row.quantityPerDay*row.volumeM3*runtimeDays,0);
  const root=chain.processors[0];
  const outputVolume=root?root.output.quantityPerDay*root.output.volumeM3*runtimeDays:0;
  const launchpads=Math.max(1,Math.ceil((externalVolume+outputVolume)/Math.max(1,launchpad?.capacityM3??10_000)));
  const facilities:any[]=[];let cpu=0,power=0;
  for(const processor of chain.processors){const facility=facilityForTier(index,planetTypeId,processor.tier);if(!facility){facilities.push({schematicId:processor.schematicId,name:processor.name,tier:processor.tier,count:processor.dedicated,facility:null});continue;}facilities.push({schematicId:processor.schematicId,name:processor.name,tier:processor.tier,count:processor.dedicated,facility:{typeId:facility.typeId,name:facility.name,cpu:facility.cpuLoad,power:facility.powerLoad}});cpu+=facility.cpuLoad*processor.dedicated;power+=facility.powerLoad*processor.dedicated;}
  if(launchpad){cpu+=launchpad.cpuLoad*launchpads;power+=launchpad.powerLoad*launchpads;}
  const facilityCpuUsed=cpu, facilityPowerUsed=power;
  const structureCount=chain.dedicatedProcessors+launchpads;
  const linkCount=Math.max(0,structureCount-1);
  const radiusKm=(planet?.radiusM??([...index.planets.values()].filter((row)=>row.typeId===planetTypeId).reduce((sum,row)=>sum+row.radiusM,0)/Math.max(1,[...index.planets.values()].filter((row)=>row.typeId===planetTypeId).length)))/1000;
  const minLinkKm=0.012008578*radiusKm;
  const linkCpu=linkCount*(15+0.2*minLinkKm);
  const linkPower=linkCount*(10+0.15*minLinkKm);
  cpu+=linkCpu;power+=linkPower;
  const missingFacilities=facilities.filter((row)=>!row.facility).map((row)=>row.tier);
  const cpuCapacity=cc?.cpuOutput??0,powerCapacity=cc?.powerOutput??0;
  const designerPalette=index.facilities.filter((facility)=>facility.planetTypeId===planetTypeId).map((facility)=>({typeId:facility.typeId,name:facility.name,kind:facility.kind,cpu:facility.cpuLoad,power:facility.powerLoad,capacityM3:facility.capacityM3,requiredLevel:facility.requiredLevel,headCpu:facility.headCpu,headPower:facility.headPower}));
  return {planetTypeId,planetType:planetTypeLabel(index.names.get(planetTypeId)??`Type ${planetTypeId}`),planetId:planet?.id??null,planetRadiusKm:radiusKm,ccuLevel,commandCenter:cc?{typeId:cc.typeId,name:cc.name,cpuOutput:cc.cpuOutput,powerOutput:cc.powerOutput}:null,launchpad:launchpad?{typeId:launchpad.typeId,name:launchpad.name,capacityM3:launchpad.capacityM3,count:launchpads}:null,facilities,designerPalette,processors:chain.dedicatedProcessors,launchpads,linkCount,minLinkKm,linkCpu,linkPower,facilityCpuUsed,facilityPowerUsed,cpuUsed:cpu,powerUsed:power,cpuCapacity,powerCapacity,cpuSpare:cpuCapacity-cpu,powerSpare:powerCapacity-power,fits:Boolean(cc&&launchpad&&!missingFacilities.length&&cpu<=cpuCapacity&&power<=powerCapacity),missingFacilities:[...new Set(missingFacilities)],bufferVolumeM3:externalVolume+outputVolume,runtimeHours};
}

function buildEveTemplate(index:PiIndex,chain:ReturnType<typeof buildChain>,layout:any) {
  if(!layout?.fits||!layout?.launchpad)return null;
  const pins:any[]=[{H:0,La:1.12,Lo:1.55,S:null,T:layout.launchpad.typeId}];const links:any[]=[];const routes:any[]=[];let pinIndex=2;
  for(const processor of chain.processors){const facility=facilityForTier(index,layout.planetTypeId,processor.tier);if(!facility)continue;for(let count=0;count<processor.dedicated;count+=1){const angle=(pinIndex-2)*2.3999632297;const ring=0.014+Math.floor((pinIndex-2)/12)*0.012;const currentIndex=pinIndex;const actual=index.schematics.get(processor.schematicId);pins.push({H:0,La:Number((1.12+Math.sin(angle)*ring).toFixed(5)),Lo:Number((1.55+Math.cos(angle)*ring).toFixed(5)),S:processor.outputTypeId,T:facility.typeId});links.push({D:currentIndex,Lv:0,S:1});for(const input of actual?.types?.filter((line)=>line.isInput)??[])routes.push({P:[1,currentIndex],Q:Number(input.quantity),T:Number(input._key)});const output=actual?.types?.find((line)=>!line.isInput);if(output)routes.push({P:[currentIndex,1],Q:Number(output.quantity),T:Number(output._key)});pinIndex+=1;}}
  return {CmdCtrLv:layout.ccuLevel,Cmt:`Sage - ${chain.processors[0]?.outputName??"PI Plan"}`,Diam:Number((layout.planetRadiusKm*2).toFixed(3)),L:links,P:pins,Pln:layout.planetTypeId,R:routes};
}

function haulingPlan(chain:ReturnType<typeof buildChain>,root:any,cargoM3:number,jumps:number|null,costPerTripIsk:number) {
  const inboundM3=chain.externalInputs.reduce((sum,row)=>sum+row.quantityPerDay*row.volumeM3,0);
  const outboundM3=root.output.quantityPerDay*root.output.volumeM3;
  const totalM3=inboundM3+outboundM3;
  const tripsPerWeek=totalM3>0?Math.ceil(totalM3*7/Math.max(1,cargoM3)):0;
  const tripsPerDay=tripsPerWeek/7;
  const jumpLegs=jumps==null?null:jumps*2*tripsPerWeek;
  const costPerWeek=tripsPerWeek*Math.max(0,costPerTripIsk);
  return {cargoM3,inboundM3PerDay:inboundM3,outboundM3PerDay:outboundM3,totalM3PerDay:totalM3,tripsPerDay,tripsPerWeek,jumpsOneWay:jumps,jumpLegsPerWeek:jumpLegs,estimatedMinutesPerWeek:jumpLegs==null?null:jumpLegs*1.5,costPerTripIsk:Math.max(0,costPerTripIsk),costPerDay:costPerWeek/7,costPerWeek,basis:"Commodity volume uses CCP type data. Trips/week are whole cargo loads over seven days; time assumes 1.5 minutes per gate leg and hauling cost uses your ISK/trip assumption."};
}

function planEconomics(chain:ReturnType<typeof buildChain>,root:any,quoteMap:Map<number,GlobalMarketQuote>,settings:ReturnType<typeof normalizedSettings>,mode:PlanetaryPlanMode,finalProcessors:number,haulingCostPerDay:number) {
  let inputAcquisitionCostPerDay=0, acquisitionPriced=true, importTaxPerDay=0, exportTaxPerDay=0;
  for(const input of chain.externalInputs){
    const extracted=input.tier==="P0"&&mode!=="buy";
    if(!extracted){
      const quote=quoteMap.get(input.typeId);
      const fill=fillMarket(input.quantityPerDay,quote?.sellOrders??[]);
      const cost=fill.coverage>=0.999999?fill.gross:quote?.bestSell==null?null:quote.bestSell*input.quantityPerDay;
      if(cost==null)acquisitionPriced=false; else inputAcquisitionCostPerDay+=cost;
    }
    importTaxPerDay+=customsTax(input.typeId,input.quantityPerDay,input.tier,settings,settings.assumedSecurity,"import");
    if(extracted) exportTaxPerDay+=customsTax(input.typeId,input.quantityPerDay,input.tier,settings,settings.assumedSecurity,"export");
  }
  const outputQuantity=root.output.quantityPerDay*finalProcessors;
  exportTaxPerDay+=customsTax(root.output.typeId,outputQuantity,root.output.tier,settings,settings.assumedSecurity,"export");
  const outputQuote=quoteMap.get(root.output.typeId);
  const buyFill=fillMarket(outputQuantity,outputQuote?.buyOrders??[]);
  const immediateRevenuePerDay=buyFill.coverage>=0.999999?buyFill.gross:outputQuote?.bestBuy==null?null:outputQuote.bestBuy*outputQuantity;
  const sellOrderRevenuePerDay=outputQuote?.bestSell==null?null:outputQuote.bestSell*outputQuantity;
  const immediateMarketFeesPerDay=immediateRevenuePerDay==null?null:immediateRevenuePerDay*settings.salesTaxPercent/100;
  const sellOrderMarketFeesPerDay=sellOrderRevenuePerDay==null?null:sellOrderRevenuePerDay*(settings.salesTaxPercent+settings.brokerFeePercent)/100;
  const directCost=acquisitionPriced?inputAcquisitionCostPerDay+importTaxPerDay+exportTaxPerDay+haulingCostPerDay:null;
  const immediateNetPerDay=immediateRevenuePerDay==null||directCost==null||immediateMarketFeesPerDay==null?null:immediateRevenuePerDay-immediateMarketFeesPerDay-directCost;
  const sellOrderNetPerDay=sellOrderRevenuePerDay==null||directCost==null||sellOrderMarketFeesPerDay==null?null:sellOrderRevenuePerDay-sellOrderMarketFeesPerDay-directCost;
  const trueMarginPercent=immediateNetPerDay==null||directCost==null||directCost<=0?null:immediateNetPerDay/directCost*100;
  return {inputAcquisitionCostPerDay:acquisitionPriced?inputAcquisitionCostPerDay:null,importTaxPerDay,exportTaxPerDay,immediateRevenuePerDay,sellOrderRevenuePerDay,immediateMarketFeesPerDay,sellOrderMarketFeesPerDay,haulingCostPerDay,immediateNetPerDay,sellOrderNetPerDay,trueMarginPercent};
}

export async function buildPlanetaryPlan(snapshot:any,allSnapshots:any[]=[],input:PlanetaryPlanInput) {
  const index=await piIndex();const snapshots=allSnapshots.length?allSnapshots:[snapshot];const settings=normalizedSettings(snapshot,input);const market=await loadGlobalMarketQuotes([...index.productTypeIds]);const quoteMap=new Map(market.quotes.map((quote)=>[Number(quote.typeId),quote]));
  const opportunities=[...index.schematics.values()].flatMap((schematic)=>{const row=pricePlanetarySchematic(schematic,index,quoteMap,settings,settings.assumedSecurity);return row?[row]:[];});
  const root=opportunities.find((row)=>Number(row.output.typeId)===Number(input.productTypeId));if(!root)throw new Error("The selected PI product does not have a CCP planetary schematic.");
  const recommendedBuildTypeIds=recommendedHybridBuildIds(opportunities);const mode:PlanetaryPlanMode=input.mode??"full";const buildSet=new Set((input.hybridBuildTypeIds !== undefined ? input.hybridBuildTypeIds : recommendedBuildTypeIds).map(Number));const finalProcessors=Math.max(1,Math.min(40,Math.floor(Number(input.finalProcessors??1))));const chain=buildChain(root,finalProcessors,opportunities,mode,buildSet);const fullChain=buildChain(root,finalProcessors,opportunities,"full",new Set());const hybridCandidates=fullChain.processors.slice(1).map((processor)=>({typeId:processor.outputTypeId,name:processor.outputName,tier:processor.tier,recommended:recommendedBuildTypeIds.includes(processor.outputTypeId)}));
  const stockpileRows=stockpileAcrossSnapshots(snapshots,index);const stockpile=new Map(stockpileRows.map((row)=>[row.typeId,row.quantity]));
  const refill=chain.externalInputs.map((row)=>{const have=stockpile.get(row.typeId)??0,need=row.quantityPerDay*settings.runtimeHours/24,shortage=Math.max(0,need-have);return {...row,have,need,shortage,shortageVolumeM3:shortage*row.volumeM3,coveredPercent:need>0?Math.min(100,have/need*100):100};});
  const stockpileRuntimeHours=chain.externalInputs.length?Math.min(...chain.externalInputs.map((row)=>row.quantityPerDay>0?(stockpile.get(row.typeId)??0)/row.quantityPerDay*24:Infinity)):Infinity;
  const rawResourceIds=rawResourceIdsForPlan(chain);const finder=findSystemsForPlan(index,rawResourceIds,Number(input.originSystemId??snapshot?.location?.solar_system_id??0),Math.max(0,Number(input.maxJumps??settings.maxJumps)),input.finderSecurity??"any",input.resourceObservations??[]);
  const planetRoles=greedyPlanetTypes(index,rawResourceIds);const characters=snapshots.map((candidate)=>characterPiSummary(candidate,index));const allocation=allocateCharacters(characters,planetRoles.roles,true);
  const requestedPlanet=input.planetId?index.planets.get(Number(input.planetId))??null:null;let planetTypeId=Number(input.planetTypeId??requestedPlanet?.typeId??0);if(!planetTypeId){planetTypeId=root.tier==="P4"?(index.typeByName.get("planet (barren)")??2016):(index.typeByName.get("barren planet")??2016);}const selectedPlanet=requestedPlanet&&requestedPlanet.typeId===planetTypeId?requestedPlanet:null;const ccuLevel=skillLevel(snapshot,2505);const layout=simulateLayout(index,chain,planetTypeId,ccuLevel,selectedPlanet,settings.runtimeHours);const eveTemplate=buildEveTemplate(index,chain,layout);
  const industryDemand=industryDemandAcrossSnapshots(snapshots,index).filter((row)=>row.typeId===root.output.typeId||chain.processors.some((processor)=>processor.outputTypeId===row.typeId));
  const bestSystem=finder.systems[0]??null;const haul=haulingPlan(chain,root,settings.cargoM3,bestSystem?.jumps??null,settings.haulingCostPerTripIsk);
  const economics=planEconomics(chain,root,quoteMap,settings,mode,finalProcessors,haul.costPerDay);
  const sourceDecisions=[...chain.processors.map((processor)=>({typeId:processor.outputTypeId,name:processor.outputName,tier:processor.tier,decision:"PRODUCE" as const,quantityPerDay:processor.output.quantityPerDay*processor.equivalent,reason:processor===chain.processors[0]?"Selected final product.":"This intermediate is included in the chosen production chain."})),...chain.externalInputs.map((input)=>{const extract=input.tier==="P0"&&mode!=="buy";return {typeId:input.typeId,name:input.name,tier:input.tier,decision:(extract?"EXTRACT":"BUY") as "EXTRACT"|"BUY",quantityPerDay:input.quantityPerDay,reason:extract?"Raw resource supplied by extraction planets; no market purchase cost is assumed.":"External commodity is acquired from the market under this plan."};})];
  const buildable=maxBuildableFromStockpile(root,stockpile);
  return {generatedAt:new Date().toISOString(),marketCreatedAt:market.createdAt,character:{id:String(snapshot.characterId),name:String(snapshot?.character?.name??"Unknown")},settings:{...settings,pocoTaxPercent:pocoTaxPercent(settings,settings.assumedSecurity)},target:{typeId:root.output.typeId,name:root.output.name,tier:root.tier,finalProcessors,outputPerDay:root.output.quantityPerDay*finalProcessors,immediateRevenuePerDay:economics.immediateRevenuePerDay,taxAdjustedProfitPerDay:economics.immediateNetPerDay,sellOrderProfitPerDay:economics.sellOrderNetPerDay,liquidityScore:root.liquidityScore,buyDepthDays:root.buyDepthDays,inputAcquisitionCostPerDay:economics.inputAcquisitionCostPerDay,importTaxPerDay:economics.importTaxPerDay,exportTaxPerDay:economics.exportTaxPerDay,marketFeesPerDay:economics.immediateMarketFeesPerDay,haulingCostPerDay:economics.haulingCostPerDay,trueMarginPercent:economics.trueMarginPercent},mode,chain:{...chain,rawResourceIds,rawResources:rawResourceIds.map((id)=>({typeId:id,name:index.names.get(id)??('Type '+id)}))},recommendedHybridBuildTypeIds:recommendedBuildTypeIds,hybridCandidates,sourceDecisions,refill,stockpileRuntimeHours:Number.isFinite(stockpileRuntimeHours)?stockpileRuntimeHours:null,stockpileBuildable:buildable,layout,eveTemplate,systemFinder:finder,allocation:{...allocation,planetRoles:planetRoles.roles,uncoveredResourceIds:planetRoles.uncovered},hauling:haul,industryDemand,stockpile:stockpileRows,netPerDay:economics.immediateNetPerDay??0,
    notes:["Hybrid recommendations compare the CCP recipe's current retained input cost with buying the intermediate directly; you can override every build/buy choice. The headline plan net is recalculated from the chosen external inputs, customs, market fees and configured hauling cost.","System and planet compatibility is deterministic from planet type. Actual extraction richness is not public ESI/SDE data, so density observations remain explicit user/corp evidence.","The generated EVE template uses a compact launchpad hub, direct links, exact schematic quantities and the selected planet's facility types. EVE will adapt the planet-specific facility variants when importing compatible templates.","Layout fitting reports deterministic CCP SDE facility CPU/PG separately from radius-aware compact-link estimates. Real manual placement can use more link CPU/PG." ]};
}
