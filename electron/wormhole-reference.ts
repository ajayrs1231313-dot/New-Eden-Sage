import AdmZip from "adm-zip";
import fs from "node:fs/promises";
import path from "node:path";
import { Worker, threadId } from "node:worker_threads";
import { promisify } from "node:util";
import { gzip, gunzip } from "node:zlib";
import { STATIC_DATA_ROOT } from "./data-paths";
import { ensureStaticDataArchive, prepareStaticDataForProcess } from "./type-volumes";

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

const SDE_ARCHIVE = path.join(STATIC_DATA_ROOT, "eve-static-data-jsonl.zip");
export const WORMHOLE_STATIC_CACHE = path.join(STATIC_DATA_ROOT, "wormhole-static-v1.json.gz");
const WORMHOLE_STATIC_CACHE_LOCK = path.join(STATIC_DATA_ROOT, "wormhole-static-v1.lock");
const WORMHOLE_STATIC_SCHEMA_VERSION = 1;
const WORMHOLE_GROUP_ID = 988;

const ATTR_TARGET_SYSTEM_CLASS = 1381;
const ATTR_MAX_STABLE_TIME = 1382;
const ATTR_MAX_STABLE_MASS = 1383;
const ATTR_MASS_REGENERATION = 1384;
const ATTR_MAX_JUMP_MASS = 1385;
const ATTR_TARGET_DISTRIBUTION = 1457;

type SdeType = { _key: number; groupID?: number; name?: { en?: string }; published?: boolean; mass?: number };
type SdeDogma = { _key: number; dogmaAttributes?: Array<{ attributeID: number; value: number }>; dogmaEffects?: Array<{effectID:number;isDefault?:boolean}> };
type SdeEffect = { _key:number; effectCategoryID?:number; name?:string; modifierInfo?:Array<{domain?:string;func?:string;modifiedAttributeID?:number;modifyingAttributeID?:number;operation?:number}> };

export type WormholeDestinationKind =
  | "c1" | "c2" | "c3" | "c4" | "c5" | "c6"
  | "highsec" | "lowsec" | "nullsec"
  | "thera" | "frigate-shattered"
  | "drifter-sentinel" | "drifter-barbican" | "drifter-vidette" | "drifter-conflux" | "drifter-redoubt"
  | "pochven" | "unknown";

export type WormholeReferenceEntry = {
  code: string;
  typeIds: number[];
  destinationClassId: number | null;
  destinationKind: WormholeDestinationKind;
  destinationLabel: string;
  lifetimeMinutes: number | null;
  maxStableMassKg: number | null;
  massRegenerationKg: number | null;
  maxJumpMassKg: number | null;
  targetDistributionId: number | null;
  hasDogma: boolean;
  source: "CCP SDE";
};

export type WormholeRollingMassModifier = { typeId:number; name:string; locationFlag:string; effectName:string; operation:number; value:number; beforeKg:number; afterKg:number };
export type WormholeRollingPropulsion = { typeId:number; name:string; locationFlag:string; kind:"mwd"|"afterburner"; massAdditionKg:number; propOnMassKg:number };
export type WormholeRollingShipMass = { shipTypeId:number; shipName:string; baseMassKg:number; coldMassKg:number; fittedItemCount:number; passiveModifiers:WormholeRollingMassModifier[]; propulsion:WormholeRollingPropulsion[]; source:"CCP SDE + ESI current ship assets"; assumptions:string[] };

export type WormholeSystemReferenceEntry = {
  systemId: number;
  name: string;
  regionId: number;
  wormholeClassId: number | null;
  classLabel: string;
  securityStatus: number;
  securityLabel: string;
  effectTypeId: number | null;
  effectName: string | null;
  effectModifiers: Array<{ attributeId:number; name:string; value:number; unitId?:number; unitName?:string; highIsGood?:boolean }>;
  planetCount: number;
  moonCount: number;
  asteroidBeltCount: number;
  source: "CCP SDE";
};

type SdeSolarSystem = { _key:number; name?:{en?:string}; regionID?:number; securityStatus?:number; wormholeClassID?:number; planetIDs?:number[] };
type SdeRegion = { _key:number; wormholeClassID?:number };
type SdeSecondarySun = { solarSystemID?:number; effectBeaconTypeID?:number };
type SdeCelestial = { solarSystemID?:number };
type SdeDogmaAttributeDefinition = { _key:number; name?:string; displayName?:{en?:string}; unitID?:number; highIsGood?:boolean };
type SdeDogmaUnit = { _key:number; name?:string; displayName?:{en?:string} };

type PreparedRollingChange = { effectName:string; operation:number; value:number };
type PreparedRollingType = {
  typeId:number;
  name:string;
  massKg:number | null;
  changes:PreparedRollingChange[];
  propulsion:{ kind:"mwd"|"afterburner"; massAdditionKg:number } | null;
};

type WormholePreparedCache = {
  schemaVersion:number;
  generatedAt:string;
  sourceArchive:string;
  sourceArchiveSize:number;
  sourceArchiveMtimeMs:number;
  reference:WormholeReferenceEntry[];
  systems:WormholeSystemReferenceEntry[];
  rollingTypes:PreparedRollingType[];
};

type WormholePreparedRuntime = {
  cache:WormholePreparedCache;
  systemsById:Map<number,WormholeSystemReferenceEntry>;
  rollingByTypeId:Map<number,PreparedRollingType>;
};

const DESTINATIONS: Record<number, { kind: WormholeDestinationKind; label: string }> = {
  1: { kind: "c1", label: "Class 1 wormhole space" },
  2: { kind: "c2", label: "Class 2 wormhole space" },
  3: { kind: "c3", label: "Class 3 wormhole space" },
  4: { kind: "c4", label: "Class 4 wormhole space" },
  5: { kind: "c5", label: "Class 5 wormhole space" },
  6: { kind: "c6", label: "Class 6 wormhole space" },
  7: { kind: "highsec", label: "High-security known space" },
  8: { kind: "lowsec", label: "Low-security known space" },
  9: { kind: "nullsec", label: "Null-security known space" },
  12: { kind: "thera", label: "Thera" },
  13: { kind: "frigate-shattered", label: "Frigate-only shattered wormhole space" },
  14: { kind: "drifter-sentinel", label: "Drifter wormhole - Sentinel" },
  15: { kind: "drifter-barbican", label: "Drifter wormhole - Barbican" },
  16: { kind: "drifter-vidette", label: "Drifter wormhole - Vidette" },
  17: { kind: "drifter-conflux", label: "Drifter wormhole - Conflux" },
  18: { kind: "drifter-redoubt", label: "Drifter wormhole - Redoubt" },
  25: { kind: "pochven", label: "Pochven" },
  [-1]: { kind: "pochven", label: "Pochven (special distribution)" },
};

function lineObjects<T>(entry: AdmZip.IZipEntry | null): T[] {
  if (!entry) return [];
  const rows: T[] = [];
  for (const line of entry.getData().toString("utf8").split(/\r?\n/)) {
    if (!line) continue;
    rows.push(JSON.parse(line) as T);
  }
  return rows;
}

function attributeMap(row?: SdeDogma) {
  return new Map((row?.dogmaAttributes ?? []).map((attribute) => [attribute.attributeID, attribute.value]));
}

function finiteOrNull(value: number | undefined) {
  return Number.isFinite(value) ? Number(value) : null;
}

function classLabel(classId: number | null, securityStatus: number) {
  if (classId != null) {
    if (classId >= 1 && classId <= 6) return `C${classId}`;
    if (classId === 7) return "High-sec";
    if (classId === 8) return "Low-sec";
    if (classId === 9) return "Null-sec";
    if (classId === 12) return "Thera";
    if (classId === 13) return "Shattered";
    if (classId >= 14 && classId <= 18) return "Drifter";
    if (classId === 25 || classId === -1) return "Pochven";
  }
  if (securityStatus >= 0.45) return "High-sec";
  if (securityStatus > 0) return "Low-sec";
  return "Null-sec";
}

function securityLabel(classId: number | null, securityStatus: number) {
  if (classId != null && ((classId >= 1 && classId <= 6) || (classId >= 12 && classId <= 18))) return "J-space";
  return (Math.round(securityStatus * 10) / 10).toFixed(1);
}

function hydrate(cache: WormholePreparedCache): WormholePreparedRuntime {
  return {
    cache,
    systemsById: new Map(cache.systems.map((row) => [row.systemId, row])),
    rollingByTypeId: new Map(cache.rollingTypes.map((row) => [row.typeId, row])),
  };
}

async function archiveFingerprint() {
  const stat = await fs.stat(SDE_ARCHIVE);
  return { size: stat.size, mtimeMs: stat.mtimeMs };
}

async function readPreparedCache(): Promise<WormholePreparedCache | null> {
  await prepareStaticDataForProcess();
  await ensureStaticDataArchive();
  try {
    const [packed, archive] = await Promise.all([fs.readFile(WORMHOLE_STATIC_CACHE), archiveFingerprint()]);
    const parsed = JSON.parse((await gunzipAsync(packed)).toString("utf8")) as WormholePreparedCache;
    if (
      parsed?.schemaVersion !== WORMHOLE_STATIC_SCHEMA_VERSION ||
      parsed.sourceArchive !== SDE_ARCHIVE ||
      parsed.sourceArchiveSize !== archive.size ||
      parsed.sourceArchiveMtimeMs !== archive.mtimeMs ||
      !Array.isArray(parsed.reference) ||
      !Array.isArray(parsed.systems) ||
      !Array.isArray(parsed.rollingTypes)
    ) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function withCacheLock<T>(work: () => Promise<T>): Promise<T> {
  const deadline = Date.now() + 120_000;
  while (true) {
    try {
      const handle = await fs.open(WORMHOLE_STATIC_CACHE_LOCK, "wx");
      try {
        return await work();
      } finally {
        await handle.close().catch(() => undefined);
        await fs.rm(WORMHOLE_STATIC_CACHE_LOCK, { force: true }).catch(() => undefined);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const ready = await readPreparedCache();
      if (ready) return ready as T;
      if (Date.now() >= deadline) throw new Error("Timed out waiting for the prepared wormhole static-data cache.");
      await new Promise((resolve) => setTimeout(resolve, 75));
    }
  }
}

function buildReference(types: Map<number,SdeType>, dogmaByTypeId: Map<number,SdeDogma>) {
  const wormholeTypes = [...types.values()].filter((row) => row.groupID === WORMHOLE_GROUP_ID && /^Wormhole [A-Z]\d{3}$/.test(row.name?.en ?? ""));
  const byCode = new Map<string, SdeType[]>();
  for (const row of wormholeTypes) {
    const code = (row.name?.en ?? "").replace(/^Wormhole\s+/, "").toUpperCase();
    if (!code) continue;
    const bucket = byCode.get(code) ?? [];
    bucket.push(row);
    byCode.set(code, bucket);
  }
  const result: WormholeReferenceEntry[] = [];
  for (const [code, rows] of byCode) {
    const canonical = rows.find((row) => dogmaByTypeId.has(row._key)) ?? rows[0];
    const dogma = dogmaByTypeId.get(canonical._key);
    const attributes = attributeMap(dogma);
    const destinationClassId = finiteOrNull(attributes.get(ATTR_TARGET_SYSTEM_CLASS));
    const destination = destinationClassId == null
      ? { kind: "unknown" as const, label: code === "K162" ? "Exit side - destination unresolved" : "Unknown destination class" }
      : DESTINATIONS[destinationClassId] ?? { kind: "unknown" as const, label: `Wormhole class ID ${destinationClassId}` };
    result.push({
      code,
      typeIds: rows.map((row) => row._key).sort((a, b) => a - b),
      destinationClassId,
      destinationKind: destination.kind,
      destinationLabel: destination.label,
      lifetimeMinutes: finiteOrNull(attributes.get(ATTR_MAX_STABLE_TIME)),
      maxStableMassKg: finiteOrNull(attributes.get(ATTR_MAX_STABLE_MASS)),
      massRegenerationKg: finiteOrNull(attributes.get(ATTR_MASS_REGENERATION)),
      maxJumpMassKg: finiteOrNull(attributes.get(ATTR_MAX_JUMP_MASS)),
      targetDistributionId: finiteOrNull(attributes.get(ATTR_TARGET_DISTRIBUTION)),
      hasDogma: Boolean(dogma),
      source: "CCP SDE",
    });
  }
  return result.sort((a, b) => a.code.localeCompare(b.code));
}

function buildSystemReferences(
  systems:SdeSolarSystem[],
  regions:Map<number,SdeRegion>,
  secondarySuns:SdeSecondarySun[],
  types:Map<number,SdeType>,
  dogmaByType:Map<number,SdeDogma>,
  dogmaAttributes:Map<number,SdeDogmaAttributeDefinition>,
  dogmaUnits:Map<number,SdeDogmaUnit>,
  moons:SdeCelestial[],
  belts:SdeCelestial[],
) {
  const moonCountBySystem = new Map<number,number>();
  for (const row of moons) { const id=Number(row.solarSystemID??0); if(id>0) moonCountBySystem.set(id,(moonCountBySystem.get(id)??0)+1); }
  const beltCountBySystem = new Map<number,number>();
  for (const row of belts) { const id=Number(row.solarSystemID??0); if(id>0) beltCountBySystem.set(id,(beltCountBySystem.get(id)??0)+1); }
  const effectBySystem = new Map<number, number>();
  for (const row of secondarySuns) {
    const systemId = Number(row.solarSystemID ?? 0);
    const effectTypeId = Number(row.effectBeaconTypeID ?? 0);
    if (systemId > 0 && effectTypeId > 0) effectBySystem.set(systemId, effectTypeId);
  }
  return systems.map((row):WormholeSystemReferenceEntry => {
    const systemId = Number(row._key);
    const regionId = Number(row.regionID ?? 0);
    const securityStatus = Number(row.securityStatus ?? 0);
    const region = regions.get(regionId);
    const wormholeClassId = Number.isFinite(Number(row.wormholeClassID)) ? Number(row.wormholeClassID) : Number.isFinite(Number(region?.wormholeClassID)) ? Number(region?.wormholeClassID) : null;
    const effectTypeId = effectBySystem.get(systemId) ?? null;
    const effectRaw = effectTypeId ? types.get(effectTypeId)?.name?.en ?? null : null;
    const effectName = effectRaw ? effectRaw.replace(/^Class\s+\d+\s+/i, "").replace(/\s+Effects?$/i, "") : null;
    const effectModifiers = effectTypeId ? (dogmaByType.get(effectTypeId)?.dogmaAttributes ?? []).flatMap((attribute) => {
      const definition = dogmaAttributes.get(attribute.attributeID);
      const name = definition?.displayName?.en ?? definition?.name;
      if (!name || !Number.isFinite(attribute.value)) return [];
      const unit = definition?.unitID ? dogmaUnits.get(definition.unitID) : undefined;
      return [{ attributeId:attribute.attributeID, name, value:attribute.value, unitId:definition?.unitID, unitName:unit?.name ?? unit?.displayName?.en, highIsGood:definition?.highIsGood }];
    }) : [];
    return { systemId, name: row.name?.en ?? `System ${systemId}`, regionId, wormholeClassId, classLabel: classLabel(wormholeClassId, securityStatus), securityStatus, securityLabel: securityLabel(wormholeClassId, securityStatus), effectTypeId, effectName, effectModifiers, planetCount: Array.isArray(row.planetIDs) ? row.planetIDs.length : 0, moonCount:moonCountBySystem.get(systemId) ?? 0, asteroidBeltCount:beltCountBySystem.get(systemId) ?? 0, source: "CCP SDE" };
  });
}

function buildRollingTypes(types:Map<number,SdeType>, dogmaByType:Map<number,SdeDogma>, effects:Map<number,SdeEffect>) {
  const massEffects = new Map<number,SdeEffect>();
  for (const [effectId,effect] of effects) {
    if (effect.effectCategoryID !== 0 && effect.effectCategoryID !== 4) continue;
    if ((effect.modifierInfo ?? []).some((modifier) => modifier.domain === "shipID" && modifier.func === "ItemModifier" && modifier.modifiedAttributeID === 4 && modifier.modifyingAttributeID != null && modifier.operation != null)) massEffects.set(effectId,effect);
  }
  const result:PreparedRollingType[] = [];
  for (const [typeId,type] of types) {
    const dogma = dogmaByType.get(typeId);
    const attrs = attributeMap(dogma);
    const effectRefs = dogma?.dogmaEffects ?? [];
    const changes:PreparedRollingChange[] = [];
    for (const effectRef of effectRefs) {
      const effect = massEffects.get(effectRef.effectID);
      if (!effect) continue;
      for (const modifier of effect.modifierInfo ?? []) {
        if (modifier.domain !== "shipID" || modifier.func !== "ItemModifier" || modifier.modifiedAttributeID !== 4 || modifier.modifyingAttributeID == null || modifier.operation == null) continue;
        const value = modifier.modifyingAttributeID === 4 ? Number(type.mass ?? attrs.get(4) ?? 0) : Number(attrs.get(modifier.modifyingAttributeID) ?? 0);
        if (!Number.isFinite(value) || value === 0) continue;
        changes.push({ effectName:effect.name ?? `Effect ${effect._key}`, operation:modifier.operation, value });
      }
    }
    const effectIds = new Set(effectRefs.map((row) => row.effectID));
    const massAdditionKg = Number(attrs.get(796) ?? 0);
    const propulsion = massAdditionKg > 0 && (effectIds.has(6730) || effectIds.has(6731))
      ? { kind:(effectIds.has(6730) ? "mwd" : "afterburner") as "mwd"|"afterburner", massAdditionKg }
      : null;
    const massKg = Number(type.mass ?? 0) > 0 ? Number(type.mass) : null;
    if (massKg == null && changes.length === 0 && !propulsion) continue;
    result.push({ typeId, name:type.name?.en ?? `Type ${typeId}`, massKg, changes, propulsion });
  }
  return result;
}

export async function buildWormholeStaticCache(): Promise<WormholePreparedCache> {
  await prepareStaticDataForProcess();
  await ensureStaticDataArchive();
  const existing = await readPreparedCache();
  if (existing) return existing;
  return withCacheLock(async () => {
    const afterLock = await readPreparedCache();
    if (afterLock) return afterLock;
    const archive = await archiveFingerprint();
    const zip = new AdmZip(SDE_ARCHIVE);

    // Each heavyweight SDE entry is inflated and parsed once in this worker. The
    // three UI-facing wormhole features consume only the compact result below.
    const typeRows = lineObjects<SdeType>(zip.getEntry("types.jsonl"));
    const dogmaRows = lineObjects<SdeDogma>(zip.getEntry("typeDogma.jsonl"));
    const effectRows = lineObjects<SdeEffect>(zip.getEntry("dogmaEffects.jsonl"));
    const systemRows = lineObjects<SdeSolarSystem>(zip.getEntry("mapSolarSystems.jsonl"));
    const regionRows = lineObjects<SdeRegion>(zip.getEntry("mapRegions.jsonl"));
    const secondarySunRows = lineObjects<SdeSecondarySun>(zip.getEntry("mapSecondarySuns.jsonl"));
    const dogmaAttributeRows = lineObjects<SdeDogmaAttributeDefinition>(zip.getEntry("dogmaAttributes.jsonl"));
    const dogmaUnitRows = lineObjects<SdeDogmaUnit>(zip.getEntry("dogmaUnits.jsonl"));
    const moonRows = lineObjects<SdeCelestial>(zip.getEntry("mapMoons.jsonl"));
    const beltRows = lineObjects<SdeCelestial>(zip.getEntry("mapAsteroidBelts.jsonl"));

    const types = new Map(typeRows.map((row) => [row._key,row]));
    const dogmaByType = new Map(dogmaRows.map((row) => [row._key,row]));
    const effects = new Map(effectRows.map((row) => [row._key,row]));
    const regions = new Map(regionRows.map((row) => [row._key,row]));
    const dogmaAttributes = new Map(dogmaAttributeRows.map((row) => [row._key,row]));
    const dogmaUnits = new Map(dogmaUnitRows.map((row) => [row._key,row]));

    const cache:WormholePreparedCache = {
      schemaVersion:WORMHOLE_STATIC_SCHEMA_VERSION,
      generatedAt:new Date().toISOString(),
      sourceArchive:SDE_ARCHIVE,
      sourceArchiveSize:archive.size,
      sourceArchiveMtimeMs:archive.mtimeMs,
      reference:buildReference(types,dogmaByType),
      systems:buildSystemReferences(systemRows,regions,secondarySunRows,types,dogmaByType,dogmaAttributes,dogmaUnits,moonRows,beltRows),
      rollingTypes:buildRollingTypes(types,dogmaByType,effects),
    };
    await fs.mkdir(STATIC_DATA_ROOT,{recursive:true});
    const partial = `${WORMHOLE_STATIC_CACHE}.${process.pid}.${threadId}.${Date.now()}.partial`;
    try {
      await fs.writeFile(partial,await gzipAsync(Buffer.from(JSON.stringify(cache),"utf8")));
      await fs.rm(WORMHOLE_STATIC_CACHE,{force:true}).catch(() => undefined);
      await fs.rename(partial,WORMHOLE_STATIC_CACHE);
    } finally {
      await fs.rm(partial,{force:true}).catch(() => undefined);
    }
    return cache;
  });
}

function prepareInWorker() {
  return new Promise<void>((resolve,reject) => {
    const worker = new Worker(path.join(__dirname,"wormhole-static-worker.js"));
    let settled = false;
    const finish = (callback:()=>void) => {
      if (settled) return;
      settled = true;
      void worker.terminate().catch(() => undefined).finally(callback);
    };
    worker.once("message",(message:{ok?:boolean;error?:string}) => {
      if (message?.ok) finish(resolve);
      else finish(() => reject(new Error(message?.error ?? "Wormhole static-data preparation failed.")));
    });
    worker.once("error",(error) => finish(() => reject(error)));
    worker.once("exit",(code) => { if (!settled && code !== 0) finish(() => reject(new Error(`Wormhole static-data preparation worker stopped (${code}).`))); });
  });
}

let preparedRuntimePromise:Promise<WormholePreparedRuntime> | undefined;

async function preparedRuntime() {
  if (preparedRuntimePromise) return preparedRuntimePromise;
  preparedRuntimePromise = Promise.resolve().then(async () => {
    const cached = await readPreparedCache();
    if (cached) return hydrate(cached);
    await prepareInWorker();
    const prepared = await readPreparedCache();
    if (!prepared) throw new Error("Prepared wormhole static-data cache was not produced.");
    return hydrate(prepared);
  }).catch((error) => { preparedRuntimePromise = undefined; throw error; });
  return preparedRuntimePromise;
}

export async function prepareWormholeStaticData() {
  const runtime = await preparedRuntime();
  return { generatedAt:runtime.cache.generatedAt, referenceCount:runtime.cache.reference.length, systemCount:runtime.cache.systems.length, rollingTypeCount:runtime.cache.rollingTypes.length };
}

export async function invalidateWormholeStaticCache() {
  preparedRuntimePromise = undefined;
  await Promise.all([
    fs.rm(WORMHOLE_STATIC_CACHE,{force:true}).catch(() => undefined),
    fs.rm(WORMHOLE_STATIC_CACHE_LOCK,{force:true}).catch(() => undefined),
  ]);
}

export async function getWormholeReference(): Promise<WormholeReferenceEntry[]> {
  return (await preparedRuntime()).cache.reference;
}

export async function getWormholeReferenceEntry(codeValue: unknown) {
  const code = String(codeValue ?? "").trim().toUpperCase();
  if (!code) return null;
  return (await getWormholeReference()).find((entry) => entry.code === code) ?? null;
}

export async function getWormholeSystemReferences(systemIdsValue: unknown) {
  const ids = Array.isArray(systemIdsValue) ? [...new Set(systemIdsValue.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))].slice(0, 500) : [];
  const index = (await preparedRuntime()).systemsById;
  return ids.map((id) => index.get(id)).filter((row): row is WormholeSystemReferenceEntry => Boolean(row));
}

function applyRollingMassOperation(current:number, value:number, operation:number) {
  if (operation === -1 || operation === 7) return value;
  if (operation === 0 || operation === 4) return current * value;
  if (operation === 2) return current + value;
  if (operation === 3) return current - value;
  if (operation === 5) return value === 0 ? current : current / value;
  if (operation === 6) return current * (1 + value / 100);
  return current;
}

const ROLLING_OPERATION_ORDER = [-1,0,2,3,4,5,6,7] as const;
const FITTED_FLAG = /^(?:HiSlot|MedSlot|LoSlot|RigSlot|SubSystemSlot)\d+$/i;

export async function getWormholeRollingShipMass(input:any): Promise<WormholeRollingShipMass> {
  const shipTypeId = Number(input?.shipTypeId ?? 0);
  if (!Number.isSafeInteger(shipTypeId) || shipTypeId <= 0) throw new Error("A valid current ship type is required for rolling mass.");
  const index = (await preparedRuntime()).rollingByTypeId;
  const hull = index.get(shipTypeId);
  const baseMassKg = Number(hull?.massKg ?? 0);
  if (!(baseMassKg > 0)) throw new Error("CCP SDE does not contain a positive hull mass for the current ship.");
  const fitted = (Array.isArray(input?.fittedItems) ? input.fittedItems : []).flatMap((row:any) => {
    const typeId = Number(row?.type_id ?? row?.typeId ?? 0);
    const locationFlag = String(row?.location_flag ?? row?.locationFlag ?? "");
    if (!Number.isSafeInteger(typeId) || typeId <= 0 || !FITTED_FLAG.test(locationFlag)) return [];
    return [{ typeId, locationFlag, name: String(row?.item ?? index.get(typeId)?.name ?? `Type ${typeId}`) }];
  });

  const changes:Array<{typeId:number;name:string;locationFlag:string;effectName:string;operation:number;value:number}> = [];
  const propulsion:WormholeRollingPropulsion[] = [];
  for (const item of fitted) {
    const prepared = index.get(item.typeId);
    if (!prepared) continue;
    for (const change of prepared.changes) changes.push({typeId:item.typeId,name:item.name,locationFlag:item.locationFlag,...change});
    if (prepared.propulsion) propulsion.push({typeId:item.typeId,name:item.name,locationFlag:item.locationFlag,kind:prepared.propulsion.kind,massAdditionKg:prepared.propulsion.massAdditionKg,propOnMassKg:0});
  }

  let coldMassKg = baseMassKg;
  const passiveModifiers:WormholeRollingMassModifier[] = [];
  for (const operation of ROLLING_OPERATION_ORDER) {
    const phase = changes.filter((change) => change.operation === operation).sort((a,b) => Math.abs(b.value)-Math.abs(a.value));
    for (const change of phase) {
      const beforeKg = coldMassKg;
      coldMassKg = applyRollingMassOperation(coldMassKg, change.value, change.operation);
      passiveModifiers.push({ ...change, beforeKg, afterKg:coldMassKg });
    }
  }
  const resolvedPropulsion = propulsion.map((prop) => ({ ...prop, propOnMassKg:coldMassKg + prop.massAdditionKg }));
  return {
    shipTypeId, shipName:hull?.name ?? String(input?.shipName ?? `Type ${shipTypeId}`), baseMassKg, coldMassKg, fittedItemCount:fitted.length, passiveModifiers, propulsion:resolvedPropulsion,
    source:"CCP SDE + ESI current ship assets",
    assumptions:["Fitted slot items returned by ESI are treated as online for passive/online mass effects.","ESI does not expose live module activation; prop-on values are scenarios for each fitted AB/MWD.","Active siege, triage, industrial-core and other non-propulsion transformations are not inferred without activation telemetry."],
  };
}
