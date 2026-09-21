import { parseFits, type Fit, type FitItem } from "./fitting-engine";
import { canonicalizeFittingPlacement } from "./fitting-rack-normalization";
import type { WargameDamageSource } from "./wargame-command-model";
import type { WargameSupportSystem } from "./wargame-types";
export type { WargameSupportSystem } from "./wargame-types";

type ResolvedFitItem = FitItem & { activeQuantity?: number };
type ResolvedFit = Omit<Fit, "hull" | "low" | "mid" | "high" | "rig" | "subsystem" | "drones" | "fighters" | "cargo" | "implants" | "boosters"> & {
  hull: ResolvedFitItem;
  low: ResolvedFitItem[];
  mid: ResolvedFitItem[];
  high: ResolvedFitItem[];
  rig: ResolvedFitItem[];
  subsystem: ResolvedFitItem[];
  drones: ResolvedFitItem[];
  fighters: ResolvedFitItem[];
  cargo: ResolvedFitItem[];
  implants: ResolvedFitItem[];
  boosters: ResolvedFitItem[];
};

type DamageProfile = { em: number; thermal: number; kinetic: number; explosive: number };
type ResistVector = [number, number, number, number];

export type WargameFitResult = {
  fitName: string;
  hullName: string;
  hullTypeId: number;
  characterName: string;
  perShipDps: number;
  perShipVolley: number;
  weaponCycle: number;
  weaponModel: "turret" | "missile" | "drone" | "support";
  rangeKm: number;
  optimalKm?: number;
  falloffKm?: number;
  tracking?: number;
  signatureResolutionM?: number;
  explosionRadiusM?: number;
  explosionVelocityMps?: number;
  damageReductionFactor?: number;
  damageProfile: DamageProfile;
  speedMps: number;
  signatureRadiusM: number;
  perShipEhp: number;
  shieldHp: number;
  armorHp: number;
  structureHp: number;
  shieldResists: ResistVector;
  armorResists: ResistVector;
  hullResists: ResistVector;
  repPerSecond: number;
  repRangeKm: number;
  repCycle: number;
  webStrength: number;
  webRangeKm: number;
  tackleRangeKm: number;
  supportSystems: WargameSupportSystem[];
  damageSources: WargameDamageSource[];
  environmentSources: Array<{ typeId: number; name: string }>;
  capacitorCapacityGj: number;
  capacitorRechargeSeconds: number;
  capacitorDemandGjPerSecond: number;
  capacitorInjectedGjPerSecond: number;
  baseSpeedMps: number;
  alignTimeSeconds: number;
  warpSpeedAuPerSecond: number;
  propulsionKind?: "ab" | "mwd";
  targetingRangeKm: number;
  scanResolution: number;
  sensorStrength: number;
  missingRequirements: number;
  fittingBlockers: number;
  sourceSummary: string;
};

function fitItems(fit: ResolvedFit) {
  return [fit.hull, ...fit.low, ...fit.mid, ...fit.high, ...fit.rig, ...fit.subsystem, ...fit.drones, ...fit.fighters, ...fit.cargo, ...fit.implants, ...fit.boosters];
}

function resolveItem(item: ResolvedFitItem, names: Map<string, number>): ResolvedFitItem {
  const typeId = item.typeId && item.typeId > 0 ? item.typeId : names.get(item.name.trim().toLowerCase());
  const chargeTypeId = item.charge
    ? (item.chargeTypeId && item.chargeTypeId > 0 ? item.chargeTypeId : names.get(item.charge.trim().toLowerCase()))
    : item.chargeTypeId;
  return { ...item, typeId, chargeTypeId };
}

async function resolveFit(text: string): Promise<ResolvedFit> {
  const parsed = parseFits(text) as ResolvedFit[];
  if (!parsed.length) throw new Error("No fitting was found in the pasted text.");
  if (parsed.length > 1) throw new Error("Paste one fitting at a time when applying a fit to a wargame formation.");
  const source = parsed[0];
  const all = fitItems(source);
  const namesToResolve = [...new Set(all.flatMap((item) => [item.name, item.charge].filter((value): value is string => Boolean(value?.trim()))))];
  const idsToResolve = [...new Set(all.flatMap((item) => item.typeId && item.typeId > 0 ? [item.typeId] : []))];
  const [byName, byId] = await Promise.all([
    namesToResolve.length ? window.sage.resolveFittingTypeNamesLocal(namesToResolve) : Promise.resolve([]),
    idsToResolve.length ? window.sage.resolveFittingTypeIdsLocal(idsToResolve) : Promise.resolve([]),
  ]);
  const metadataById = new Map<number, (typeof byName)[number]>();
  for (const entry of [...byName, ...byId]) metadataById.set(Number(entry.id), entry);
  const metadata = [...metadataById.values()];
  const names = new Map<string, number>();
  for (const entry of metadata) names.set(String(entry.name).trim().toLowerCase(), Number(entry.id));
  const resolved: ResolvedFit = {
    ...source,
    hull: resolveItem(source.hull, names),
    low: source.low.map((item) => resolveItem(item, names)),
    mid: source.mid.map((item) => resolveItem(item, names)),
    high: source.high.map((item) => resolveItem(item, names)),
    rig: source.rig.map((item) => resolveItem(item, names)),
    subsystem: source.subsystem.map((item) => resolveItem(item, names)),
    drones: source.drones.map((item) => resolveItem(item, names)),
    fighters: source.fighters.map((item) => resolveItem(item, names)),
    cargo: source.cargo.map((item) => resolveItem(item, names)),
    implants: source.implants.map((item) => resolveItem(item, names)),
    boosters: source.boosters.map((item) => resolveItem(item, names)),
  };
  const canonical = canonicalizeFittingPlacement(resolved, metadata);
  if (canonical.unresolvedFitted.length) {
    const detail = canonical.unresolvedFitted.slice(0, 5).map(({ item, sourceRack }) => `${item.name} (${sourceRack})`).join(", ");
    throw new Error(`Fit import blocked: Sage could not prove the CCP fitting rack for ${detail}.`);
  }
  if (!canonical.fit.hull.typeId) throw new Error(`Sage could not resolve the hull '${canonical.fit.hull.name}' to a current EVE type.`);
  return canonical.fit;
}

function normalizedDamageVector(vectors: unknown[]): DamageProfile {
  const total = [0, 0, 0, 0];
  for (const vector of vectors) {
    if (!Array.isArray(vector)) continue;
    for (let index = 0; index < 4; index += 1) total[index] += Math.max(0, Number(vector[index]) || 0);
  }
  const sum = total.reduce((value, amount) => value + amount, 0);
  if (sum <= 0) return { em: .25, thermal: .25, kinetic: .25, explosive: .25 };
  return { em: total[0] / sum, thermal: total[1] / sum, kinetic: total[2] / sum, explosive: total[3] / sum };
}

function resistVector(value: unknown): ResistVector {
  const array = Array.isArray(value) ? value : [];
  return [0, 1, 2, 3].map((index) => Math.max(0, Math.min(1, Number(array[index]) || 0))) as ResistVector;
}

function attrValue(info: Awaited<ReturnType<typeof window.sage.getFittingTypeInfoLocal>>, id: number, patterns: RegExp[]) {
  const exact = info.attributes.find((attribute) => Number(attribute.attributeId) === id);
  if (exact && Number.isFinite(Number(exact.value))) return Number(exact.value);
  const match = info.attributes.find((attribute) => {
    const text = `${attribute.name ?? ""} ${attribute.internalName ?? ""} ${attribute.description ?? ""} ${attribute.category ?? ""}`.toLowerCase();
    return patterns.some((pattern) => pattern.test(text));
  });
  return match && Number.isFinite(Number(match.value)) ? Number(match.value) : 0;
}

async function supportProfile(fit: ResolvedFit) {
  const fitted = [...fit.low, ...fit.mid, ...fit.high, ...fit.rig, ...fit.subsystem].filter((item) => item.typeId);
  const ids = [...new Set(fitted.map((item) => item.typeId!))];
  const infos = await Promise.all(ids.map((typeId) => window.sage.getFittingTypeInfoLocal(typeId).catch(() => null)));
  const byId = new Map(infos.filter((info): info is NonNullable<typeof info> => Boolean(info)).map((info) => [info.typeId, info]));
  let repPerSecond = 0;
  let repRangeKm = 0;
  let repCycle = 0;
  let webStrength = 0;
  let webRangeKm = 0;
  let tackleRangeKm = 0;

  for (const item of fitted) {
    const info = byId.get(item.typeId!);
    if (!info) continue;
    const name = info.name.toLowerCase();
    const quantity = Math.max(1, Number(item.quantity) || 1);
    const optimalM = attrValue(info, 54, [/optimal.*range/, /maximum.*range/]);
    if (name.includes("stasis webifier") || name.includes("stasis grappler")) {
      const speedFactor = attrValue(info, 20, [/speed.*factor/, /velocity.*factor/]);
      webStrength = Math.max(webStrength, Math.min(.95, Math.abs(speedFactor) / 100));
      webRangeKm = Math.max(webRangeKm, optimalM / 1000);
    }
    if (name.includes("warp disruptor") || name.includes("warp scrambler")) {
      const scrambleRangeM = attrValue(info, 103, [/warp.*scram.*range/, /warp.*disrupt.*range/, /optimal.*range/]);
      tackleRangeKm = Math.max(tackleRangeKm, scrambleRangeM / 1000, optimalM / 1000);
    }
    const remoteRepair = /remote.*(shield|armor|armour|hull).*repair|remote.*shield.*boost|shield transporter|remote armor repair/.test(name);
    if (remoteRepair) {
      const amount = Math.max(
        attrValue(info, 68, [/shield.*bonus/, /shield.*transfer/, /shield.*repair.*amount/]),
        attrValue(info, 84, [/armor.*damage.*amount/, /armour.*repair.*amount/, /armor.*repair.*amount/]),
        attrValue(info, 83, [/structure.*damage.*amount/, /hull.*repair.*amount/]),
      );
      const durationMs = Math.max(attrValue(info, 73, [/duration/, /activation.*time/]), attrValue(info, 51, [/duration/, /rate.*of.*fire/]));
      const cycle = durationMs > 0 ? durationMs / 1000 : 0;
      if (amount > 0 && cycle > 0) {
        repPerSecond += (amount / cycle) * quantity;
        repCycle = repCycle ? Math.min(repCycle, cycle) : cycle;
      }
      repRangeKm = Math.max(repRangeKm, optimalM / 1000);
    }
  }
  return { repPerSecond, repRangeKm, repCycle, webStrength, webRangeKm, tackleRangeKm };
}

export async function analyzeWargameFit(text: string, characterId: string, environmentTypeIds: number[] = []): Promise<WargameFitResult> {
  const fit = await resolveFit(text);
  const rackItems = (["low", "mid", "high", "rig", "subsystem"] as const).flatMap((rack) =>
    fit[rack].flatMap((item) => item.typeId ? [{
      typeId: item.typeId,
      quantity: Math.max(1, Number(item.quantity) || 1),
      rack,
      chargeTypeId: item.chargeTypeId,
      chargeQuantity: item.chargeQuantity,
      attributeOverrides: item.attributeOverrides,
      state: item.state ?? (rack === "rig" || rack === "subsystem" ? "online" as const : "active" as const),
    }] : []),
  );
  const droneItems = fit.drones.flatMap((item) => item.typeId ? [{ typeId: item.typeId, quantity: Math.max(1, Number(item.quantity) || 1), rack: "drone" as const }] : []);
  const cargoItems = fit.cargo.flatMap((item) => item.typeId ? [{ typeId: item.typeId, quantity: Math.max(1, Number(item.quantity) || 1), rack: "cargo" as const }] : []);
  const fighterItems = fit.fighters.flatMap((item) => item.typeId ? [{ typeId: item.typeId, quantity: Math.max(1, Number(item.quantity) || 1), rack: "fighter-active" as const }] : []);
  const items = [...rackItems, ...droneItems, ...fighterItems, ...cargoItems];
  const itemTypeIds = [...new Set(items.map((item) => item.typeId))];
  const analysis = await window.sage.analyzeFitting({
    characterId,
    hullTypeId: fit.hull.typeId!,
    itemTypeIds,
    items,
    targetProfile: { rangeM: 10_000, signatureRadiusM: 125, transverseVelocityMps: 0, velocityMps: 0 },
    damageProfile: { em: .25, thermal: .25, kinetic: .25, explosive: .25 },
    implantTypeIds: fit.implants.flatMap((item) => item.typeId ? [item.typeId] : []),
    boosterTypeIds: fit.boosters.flatMap((item) => item.typeId ? [item.typeId] : []),
    environmentTypeIds,
  });
  const weaponProfiles = Array.isArray(analysis?.damage?.weaponProfiles) ? analysis.damage.weaponProfiles : [];
  const dominantWeapon = [...weaponProfiles].sort((a, b) => Number(b.paperDps ?? 0) - Number(a.paperDps ?? 0))[0];
  const activeDrones = Array.isArray(analysis?.damage?.activeDrones) ? analysis.damage.activeDrones : [];
  const profileFromVector = (vector: unknown) => normalizedDamageVector([vector]);
  const weaponDamageSources: WargameDamageSource[] = weaponProfiles.map((profile: any, index: number) => {
    const kind = profile?.kind === "missile" ? "missile" : "turret";
    const optimalKm = kind === "turret" ? Math.max(0, Number(profile.optimalM) || 0) / 1000 : undefined;
    const falloffKm = kind === "turret" ? Math.max(0, Number(profile.falloffM) || 0) / 1000 : undefined;
    const maxRangeKm = kind === "turret"
      ? Math.max(0.1, (Number(profile.optimalM) || 0) / 1000 + ((Number(profile.falloffM) || 0) / 1000) * 2)
      : Math.max(0.1, (Number(profile.maximumRangeM) || 0) / 1000);
    return {
      id: `weapon-${Number(profile.typeId) || 0}-${Number(profile.chargeTypeId) || String(profile.charge ?? "loaded").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${index}`,
      name: `${String(profile.name ?? "Weapon")}${profile.charge ? ` / ${profile.charge}` : ""}`,
      kind,
      dpsPerShip: Math.max(0, Number(profile.burstDps ?? profile.paperDps) || 0),
      burstDpsPerShip: Math.max(0, Number(profile.burstDps ?? profile.paperDps) || 0),
      sustainedDpsPerShip: Math.max(0, Number(profile.sustainedDps ?? profile.paperDps) || 0),
      loadedCyclesRemaining: Math.max(0, Number(profile.loadedCycles) || 0),
      magazineCycles: Math.max(0, Number(profile.magazineCycles) || 0),
      reloadSeconds: Math.max(0, Number(profile.reloadSeconds) || 0),
      reloadRemaining: profile?.magazine?.explicitLoadedState && Number(profile.loadedCycles) <= 0 ? Math.max(0, Number(profile.reloadSeconds) || 0) : 0,
      rampPerCycle: Math.max(0, Number(profile.rampPerCycle) || 0),
      maxRampMultiplier: Math.max(1, Number(profile.maxRampMultiplier) || 1),
      spoolCycles: 0,
      volleyPerShip: Math.max(0, Number(profile.volley) || 0),
      cycleSeconds: Math.max(0.1, Number(profile.cycleSeconds) || 1),
      maxRangeKm,
      optimalKm,
      falloffKm,
      tracking: kind === "turret" ? Math.max(0, Number(profile.tracking) || 0) : undefined,
      signatureResolutionM: kind === "turret" ? Math.max(0, Number(profile.signatureResolutionM) || 0) : undefined,
      explosionRadiusM: kind === "missile" ? Math.max(0, Number(profile.explosionRadiusM) || 0) : undefined,
      explosionVelocityMps: kind === "missile" ? Math.max(0, Number(profile.explosionVelocity) || 0) : undefined,
      damageReductionFactor: kind === "missile" ? Math.max(0, Number(profile.damageReductionFactor) || 0) : undefined,
      damageProfile: profileFromVector(profile.damageVector),
    };
  });
  const droneGroups = new Map<string, WargameDamageSource & { activeCount: number }>();
  for (const drone of activeDrones) {
    const key = String(Number(drone.typeId) || drone.name || "drone");
    const existing = droneGroups.get(key);
    if (existing) {
      existing.activeCount += 1;
      existing.dpsPerShip += Math.max(0, Number(drone.dps) || 0);
      existing.volleyPerShip += Math.max(0, Number(drone.volley) || 0);
      continue;
    }
    const optimalKm = Math.max(0, Number(drone.optimalM) || 0) / 1000;
    const falloffKm = Math.max(0, Number(drone.falloffM) || 0) / 1000;
    const droneControlKm = Math.max(0, Number(analysis?.damage?.droneControlDistanceM) || 0) / 1000;
    droneGroups.set(key, {
      id: `drone-${key}`,
      name: String(drone.name ?? "Drone flight"),
      kind: "drone",
      dpsPerShip: Math.max(0, Number(drone.dps) || 0),
      volleyPerShip: Math.max(0, Number(drone.volley) || 0),
      cycleSeconds: Math.max(0.1, Number(drone.volley) > 0 && Number(drone.dps) > 0 ? Number(drone.volley) / Number(drone.dps) : 2),
      maxRangeKm: Math.max(0.1, droneControlKm, optimalKm + falloffKm * 2),
      optimalKm,
      falloffKm,
      tracking: Math.max(0, Number(drone.tracking) || 0),
      signatureResolutionM: Math.max(0, Number(drone.signatureResolutionM) || 0),
      droneMaximumVelocityMps: Math.max(0, Number(drone.maximumVelocityMps) || 0),
      droneControlRangeKm: droneControlKm,
      droneOrbitVelocityMps: Math.max(0, Number(drone.orbitVelocityMps) || 0),
      droneOrbitRangeKm: Math.max(0, Number(drone.orbitRangeM) || 0) / 1000,
      sentry: Boolean(drone.sentry),
      damageProfile: profileFromVector(drone.damageVector),
      activeCount: 1,
    });
  }
  const droneDamageSources: WargameDamageSource[] = [...droneGroups.values()].map(({ activeCount, ...source }) => ({ ...source, name: activeCount > 1 ? `${source.name} x${activeCount}` : source.name }));
  const fighterDamageSources: WargameDamageSource[] = (Array.isArray(analysis?.damage?.fighterDamageSources) ? analysis.damage.fighterDamageSources : []).map((profile: any, index: number) => {
    const optimalKm=Math.max(0,Number(profile.optimalM)||0)/1000, falloffKm=Math.max(0,Number(profile.falloffM)||0)/1000;
    return { id:`fighter-${Number(profile.typeId)||0}-${index}`, name:String(profile.name ?? "Fighter squadron"), typeId:Number(profile.typeId)||undefined, kind:"fighter", fighterAbility:String(profile.ability ?? "weapon"), applicationKind:"missile", dpsPerShip:Math.max(0,Number(profile.dps)||0), burstDpsPerShip:Math.max(0,Number(profile.dps)||0), sustainedDpsPerShip:Math.max(0,Number(profile.dps)||0), volleyPerShip:Math.max(0,Number(profile.volley)||0), cycleSeconds:Math.max(.1,Number(profile.cycleSeconds)||1), maxRangeKm:Math.max(.1,optimalKm+falloffKm*2), optimalKm, falloffKm, explosionRadiusM:Math.max(0,Number(profile.explosionRadiusM)||0), explosionVelocityMps:Math.max(0,Number(profile.explosionVelocity)||0), damageReductionFactor:.5, damageProfile:profileFromVector(profile.damageVector), fighterCountInitial:Math.max(0,Number(profile.fighterCountInitial ?? profile.fighterCount)||0), fighterCountRemaining:Math.max(0,Number(profile.fighterCountRemaining ?? profile.fighterCount)||0), fighterMaximumVelocityMps:Math.max(0,Number(profile.fighterMaximumVelocityMps)||0), fighterOrbitRangeKm:Math.max(0,Number(profile.fighterOrbitRangeM)||0)/1000 };
  });
  const aoeDamageSources: WargameDamageSource[] = (Array.isArray(analysis?.damage?.aoeDamageSources) ? analysis.damage.aoeDamageSources : []).map((profile: any,index:number) => {
    const cycleSeconds=Math.max(.1,Number(profile.cycleSeconds)||1), radiusKm=Math.max(0,Number(profile.radiusM)||0)/1000, pulse=Math.max(0,Number(profile.damagePerPulse)||0);
    return { id:`aoe-${Number(profile.typeId)||0}-${index}`, name:String(profile.name ?? "Area weapon"), kind:"aoe", dpsPerShip:pulse/cycleSeconds, burstDpsPerShip:pulse/cycleSeconds, sustainedDpsPerShip:pulse/cycleSeconds, volleyPerShip:pulse, cycleSeconds, maxRangeKm:radiusKm, radiusKm, friendlyFireEligible:Boolean(profile.friendlyFireEligible), damageProfile:profileFromVector(profile.damageVector) };
  });
  const damageSources: WargameDamageSource[] = [...weaponDamageSources, ...droneDamageSources, ...fighterDamageSources, ...aoeDamageSources];
  const weaponDps = Math.max(0, Number(analysis?.damage?.weaponDps) || 0);
  const droneDps = Math.max(0, Number(analysis?.damage?.droneDps) || 0);
  const perShipDps = Math.max(0, Number(analysis?.damage?.totalDps) || 0);
  const perShipVolley = Math.max(0, Number(analysis?.damage?.totalVolley) || 0);
  const weaponCycle = perShipDps > 0 && perShipVolley > 0 ? Math.max(.5, perShipVolley / perShipDps) : 0;
  const weaponModel: WargameFitResult["weaponModel"] = dominantWeapon?.kind === "missile" ? "missile" : dominantWeapon?.kind === "turret" ? "turret" : droneDps > weaponDps ? "drone" : perShipDps > 0 ? "turret" : "support";
  const optimalKm = dominantWeapon?.kind === "turret" ? Math.max(0, Number(dominantWeapon.optimalM) || 0) / 1000 : undefined;
  const falloffKm = dominantWeapon?.kind === "turret" ? Math.max(0, Number(dominantWeapon.falloffM) || 0) / 1000 : undefined;
  const weaponRanges = weaponProfiles.map((profile: any) => profile.kind === "turret"
    ? (Math.max(0, Number(profile.optimalM) || 0) + Math.max(0, Number(profile.falloffM) || 0) * 2) / 1000
    : Math.max(0, Number(profile.maximumRangeM) || 0) / 1000);
  const droneRangeKm = Math.max(0, Number(analysis?.damage?.droneControlDistanceM) || 0) / 1000;
  const rangeKm = Math.max(1, ...weaponRanges, droneDps > 0 ? droneRangeKm : 0);
  const damageProfile = normalizedDamageVector([
    ...weaponProfiles.map((profile: any) => profile.damageVector),
    ...activeDrones.map((drone: any) => drone.damageVector),
  ]);
  const supportSystems = (Array.isArray(analysis?.supportSystems) ? analysis.supportSystems : []).map((raw: any) => ({
    ...raw,
    loadedCyclesRemaining: Math.max(0, Number(raw?.magazine?.cyclesLoaded ?? raw?.chargedCycles ?? 0) || 0),
    magazineCycles: Math.max(0, Number(raw?.magazine?.cyclesPerMagazine ?? 0) || 0),
    reloadSeconds: Math.max(0, Number(raw?.magazine?.reloadSeconds ?? 0) || 0),
    reloadRemaining: 0,
    spoolCycles: 0,
    fighterCountInitial: raw?.sourceKind === "fighter" ? Math.max(0, Number(raw?.fighterCountInitial ?? raw?.fighterCount) || 0) : raw?.fighterCountInitial,
    fighterCountRemaining: raw?.sourceKind === "fighter" ? Math.max(0, Number(raw?.fighterCountRemaining ?? raw?.fighterCount) || 0) : raw?.fighterCountRemaining,
    activeRemaining: 0,
    activeTargetId: undefined,
  })) as WargameSupportSystem[];
  const supportOf = (kind: string) => supportSystems.filter((system) => system.kind === kind);
  const repSystems = supportSystems.filter((system) => system.kind === "remoteShieldRep" || system.kind === "remoteArmorRep");
  const repPerSecond = repSystems.reduce((sum, system) => sum + Math.max(0, Number(system.perSecond) || 0), 0);
  const repRangeKm = Math.max(0, ...repSystems.map((system) => Math.max(0, Number(system.optimalM) || 0) / 1000));
  const repCycles = repSystems.map((system) => Math.max(0, Number(system.cycleSeconds) || 0)).filter((value) => value > 0);
  const repCycle = repCycles.length ? Math.min(...repCycles) : 0;
  const webs = supportOf("web");
  const tackles = supportOf("tackle");
  const webStrength = Math.max(0, ...webs.map((system) => Math.max(0, Number(system.strength) || 0)));
  const webRangeKm = Math.max(0, ...webs.map((system) => Math.max(0, Number(system.optimalM) || 0) / 1000));
  const tackleRangeKm = Math.max(0, ...tackles.map((system) => Math.max(0, Number(system.optimalM) || 0) / 1000));
  const missingRequirements = Array.isArray(analysis?.missingRequirements) ? analysis.missingRequirements.length : 0;
  const fittingBlockers = Array.isArray(analysis?.issues) ? analysis.issues.filter((issue: any) => issue?.level === "error").length : 0;
  const sourceSummary = `${analysis?.character ?? characterId} skills · ${missingRequirements} missing skill requirement${missingRequirements === 1 ? "" : "s"} · ${fittingBlockers} fitting blocker${fittingBlockers === 1 ? "" : "s"}`;
  return {
    fitName: fit.name,
    hullName: String(analysis?.hull ?? fit.hull.name),
    hullTypeId: fit.hull.typeId!,
    characterName: String(analysis?.character ?? characterId),
    perShipDps,
    perShipVolley,
    weaponCycle,
    weaponModel,
    rangeKm,
    optimalKm,
    falloffKm,
    tracking: dominantWeapon?.kind === "turret" ? Math.max(0, Number(dominantWeapon.tracking) || 0) : undefined,
    signatureResolutionM: dominantWeapon?.kind === "turret" ? Math.max(0, Number(dominantWeapon.signatureResolutionM) || 0) : undefined,
    explosionRadiusM: dominantWeapon?.kind === "missile" ? Math.max(0, Number(dominantWeapon.explosionRadiusM) || 0) : undefined,
    explosionVelocityMps: dominantWeapon?.kind === "missile" ? Math.max(0, Number(dominantWeapon.explosionVelocity) || 0) : undefined,
    damageReductionFactor: dominantWeapon?.kind === "missile" ? Math.max(0, Number(dominantWeapon.damageReductionFactor) || 0) : undefined,
    damageProfile,
    speedMps: Math.max(0, Number(analysis?.navigation?.maximumVelocity) || 0),
    signatureRadiusM: Math.max(1, Number(analysis?.targeting?.signatureRadiusM) || 1),
    perShipEhp: Math.max(1, Number(analysis?.defence?.totalEhp) || 1),
    shieldHp: Math.max(0, Number(analysis?.defence?.shieldHp) || 0),
    armorHp: Math.max(0, Number(analysis?.defence?.armorHp) || 0),
    structureHp: Math.max(0, Number(analysis?.defence?.structureHp) || 0),
    shieldResists: resistVector(analysis?.defence?.shieldResists),
    armorResists: resistVector(analysis?.defence?.armorResists),
    hullResists: resistVector(analysis?.defence?.hullResists),
    repPerSecond,
    repRangeKm,
    repCycle,
    webStrength,
    webRangeKm,
    tackleRangeKm,
    supportSystems,
    damageSources,
    environmentSources: Array.isArray(analysis?.environmentSources) ? analysis.environmentSources.map((source: any) => ({ typeId: Number(source.typeId), name: String(source.name ?? source.typeId) })) : [],
    capacitorCapacityGj: Math.max(0, Number(analysis?.capacitor?.capacityGj) || 0),
    capacitorRechargeSeconds: Math.max(0, Number(analysis?.capacitor?.rechargeSeconds) || 0),
    capacitorDemandGjPerSecond: Math.max(0, Number(analysis?.capacitor?.demandGjPerSecond) || 0),
    capacitorInjectedGjPerSecond: Math.max(0, Number(analysis?.capacitor?.injectedGjPerSecond) || 0),
    baseSpeedMps: Math.max(0, Number(analysis?.navigation?.baseMaximumVelocity) || 0),
    alignTimeSeconds: Math.max(0.1, Number(analysis?.navigation?.alignSeconds) || 6),
    warpSpeedAuPerSecond: Math.max(0.1, Number(analysis?.navigation?.warpSpeedAuPerSecond) || 3),
    propulsionKind: Array.isArray(analysis?.navigation?.activePropulsion) && analysis.navigation.activePropulsion.length ? analysis.navigation.activePropulsion[0].kind : undefined,
    targetingRangeKm: Math.max(0, Number(analysis?.targeting?.maximumRangeM) || 0) / 1000,
    scanResolution: Math.max(0, Number(analysis?.targeting?.scanResolution) || 0),
    sensorStrength: Math.max(0, Number(analysis?.targeting?.sensorStrength) || 0),
    missingRequirements,
    fittingBlockers,
    sourceSummary,
  };
}
