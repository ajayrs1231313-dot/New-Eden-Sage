import { cloneDamageSources, cloneOrderChain, type WargameDamageSource, type WargameOrderCondition, type WargameOrderStep } from "./wargame-command-model";
import type { WargameAdvanceOptions, WargameAdvanceResult, WargameEngineEvent, WargameEngineEventKind, WargameInterdictionZone, WargameSide, WargameSupportSystem, WargameUnit } from "./wargame-types";
import { planReactiveRedTeam } from "./wargame-red-team";
import { getWargameObservation } from "./wargame-observation";

export type WargameEngineSide = "blue" | "red";

export type WargameEngineUnit = {
  id: string;
  side: WargameEngineSide;
  x: number;
  y: number;
  ehp: number;
  maxEhp?: number;
  count: number;
  shipsAlive?: number;
  capacitorCapacity?: number;
  capacitorCurrent?: number;
  scrammed?: boolean;
  warpDisruptionStrength?: number;
  warpCoreStrength?: number;
  movementState?: string;
  jamRemaining?: number;
  destinationX?: number;
  destinationY?: number;
};

export type WargameSupportLike = {
  typeId: number;
  name: string;
  kind: string;
  quantity?: number;
  optimalM?: number;
  falloffM?: number;
  buffs?: Array<{ buffId: number; description: string; value: number }>;
};

export type WargameBurstCarrier = WargameEngineUnit & {
  name?: string;
  supportSystems?: WargameSupportLike[];
};

export type WargameBurstEffect = {
  buffId: number;
  description: string;
  value: number;
  sourceId: string;
  sourceName: string;
  rangeKm: number;
};

export type WargameBurstModifiers = {
  effects: WargameBurstEffect[];
  sourceNames: string[];
  signatureMultiplier: number;
  targetingRangeMultiplier: number;
  scanResolutionMultiplier: number;
  sensorStrengthMultiplier: number;
  propulsionSpeedIncreaseMultiplier: number;
  tackleRangeMultiplier: number;
  ewarRangeMultiplier: number;
  ewarStrengthMultiplier: number;
  shieldDamageMultiplier: number;
  armorDamageMultiplier: number;
  shieldHpMultiplier: number;
  armorHpMultiplier: number;
  shieldRepairCycleMultiplier: number;
  armorRepairCycleMultiplier: number;
};

export const EMPTY_BURST_MODIFIERS: WargameBurstModifiers = {
  effects: [],
  sourceNames: [],
  signatureMultiplier: 1,
  targetingRangeMultiplier: 1,
  scanResolutionMultiplier: 1,
  sensorStrengthMultiplier: 1,
  propulsionSpeedIncreaseMultiplier: 1,
  tackleRangeMultiplier: 1,
  ewarRangeMultiplier: 1,
  ewarStrengthMultiplier: 1,
  shieldDamageMultiplier: 1,
  armorDamageMultiplier: 1,
  shieldHpMultiplier: 1,
  armorHpMultiplier: 1,
  shieldRepairCycleMultiplier: 1,
  armorRepairCycleMultiplier: 1,
};

export function wargameEngineDistanceKm(a: Pick<WargameEngineUnit, "x" | "y">, b: Pick<WargameEngineUnit, "x" | "y">) {
  return Math.hypot(a.x - b.x, a.y - b.y) * 2.5;
}

export function wargameSupportSystemKey(system: WargameSupportLike, index: number) {
  return `${system.kind}:${system.typeId}:${index}`;
}

const FRIENDLY_SUPPORT = new Set(["remoteShieldRep", "remoteArmorRep", "remoteCapacitor", "remoteSensorBooster", "remoteTrackingComputer"]);
const NO_TARGET_SUPPORT = new Set(["commandBurst"]);

export function wargameSupportTargetSide(kind: string): "friendly" | "hostile" | "none" {
  if (NO_TARGET_SUPPORT.has(kind)) return "none";
  return FRIENDLY_SUPPORT.has(kind) ? "friendly" : "hostile";
}

export function wargameSupportTargetAllowed(controller: Pick<WargameEngineUnit, "side">, target: Pick<WargameEngineUnit, "side">, kind: string) {
  const side = wargameSupportTargetSide(kind);
  if (side === "none") return false;
  return side === "friendly" ? target.side === controller.side : target.side !== controller.side;
}

export function wargameConditionUsesTarget(kind: WargameOrderCondition["kind"]) {
  return ["target-destroyed", "target-health-below", "target-ships-below", "range-below", "range-above", "target-scrammed", "target-warp-disrupted", "target-warping", "target-jammed"].includes(kind);
}

export function wargameConditionUsesThreshold(kind: WargameOrderCondition["kind"]) {
  return ["target-health-below", "target-ships-below", "range-below", "range-above", "self-health-below", "self-cap-below"].includes(kind);
}

export function wargameConditionUsesSeconds(kind: WargameOrderCondition["kind"]) {
  return kind === "after-seconds";
}

function liveShips(unit: WargameEngineUnit | undefined) {
  if (!unit || unit.ehp <= 0) return 0;
  return Math.max(0, Math.min(unit.count, Math.round(unit.shipsAlive ?? unit.count)));
}

function conditionHealthPercent(unit: WargameEngineUnit | undefined) {
  if (!unit) return 0;
  const maximum = Math.max(1, unit.maxEhp ?? unit.ehp);
  return Math.max(0, Math.min(100, (unit.ehp / maximum) * 100));
}

function capPercent(unit: WargameEngineUnit | undefined) {
  if (!unit?.capacitorCapacity) return 100;
  return Math.max(0, Math.min(100, ((unit.capacitorCurrent ?? unit.capacitorCapacity) / unit.capacitorCapacity) * 100));
}

export function evaluateWargameCondition(
  condition: WargameOrderCondition | undefined,
  self: WargameEngineUnit,
  units: WargameEngineUnit[],
  elapsedSeconds: number,
) {
  if (!condition || condition.kind === "always") return true;
  const target = condition.targetId ? units.find((unit) => unit.id === condition.targetId) : undefined;
  const threshold = Number.isFinite(condition.threshold) ? Number(condition.threshold) : 0;
  switch (condition.kind) {
    case "target-destroyed": return !target || target.ehp <= 0 || liveShips(target) <= 0;
    case "target-health-below": return Boolean(target) && conditionHealthPercent(target) <= threshold;
    case "target-ships-below": return Boolean(target) && liveShips(target) <= threshold;
    case "range-below": return Boolean(target) && wargameEngineDistanceKm(self, target!) <= threshold;
    case "range-above": return Boolean(target) && wargameEngineDistanceKm(self, target!) >= threshold;
    case "target-scrammed": return Boolean(target?.scrammed);
    case "target-warp-disrupted": return Boolean(target && (target.warpDisruptionStrength ?? 0) > (target.warpCoreStrength ?? 0));
    case "target-warping": return Boolean(target?.movementState === "warping");
    case "target-jammed": return Boolean(target && (target.jamRemaining ?? 0) > 0);
    case "self-health-below": return conditionHealthPercent(self) <= threshold;
    case "self-cap-below": return capPercent(self) <= threshold;
    case "after-seconds": return elapsedSeconds >= Math.max(0, condition.seconds ?? threshold);
    case "self-aligned": return self.movementState === "aligned";
    case "self-warped": return self.movementState === "landed";
    case "arrived": {
      if (target) return wargameEngineDistanceKm(self, target) <= Math.max(0.1, threshold || 2);
      return self.destinationX == null && self.destinationY == null;
    }
    case "manual": return false;
    default: return false;
  }
}

export function legacyStartCondition(step: WargameOrderStep): WargameOrderCondition {
  if (step.startWhen) return step.startWhen;
  if (step.trigger === "target-destroyed") return { kind: "target-destroyed", targetId: step.triggerTargetId };
  if (step.trigger === "after-seconds") return { kind: "after-seconds", seconds: Math.max(0, step.triggerSeconds ?? 0) };
  return { kind: "always" };
}

export function legacyCompletionCondition(step: WargameOrderStep): WargameOrderCondition {
  if (step.completeWhen) return step.completeWhen;
  if (step.completion === "target-destroyed") return { kind: "target-destroyed", targetId: step.completionTargetId };
  if (step.completion === "arrived") {
    if (step.movement === "warp") return { kind: "self-warped" };
    if (step.movement === "align") return { kind: "self-aligned" };
    return { kind: "arrived", targetId: step.moveTargetId, threshold: 2 };
  }
  if (step.completion === "after-seconds") return { kind: "after-seconds", seconds: Math.max(1, step.completionSeconds ?? 1) };
  return { kind: "manual" };
}

export function canStartWargameOrder(step: WargameOrderStep, self: WargameEngineUnit, units: WargameEngineUnit[], waitSeconds: number) {
  return evaluateWargameCondition(legacyStartCondition(step), self, units, waitSeconds);
}

export function isWargameOrderComplete(step: WargameOrderStep, self: WargameEngineUnit, units: WargameEngineUnit[], activeSeconds: number) {
  return evaluateWargameCondition(legacyCompletionCondition(step), self, units, activeSeconds);
}

function indexForStepId(chain: WargameOrderStep[], id: string | undefined) {
  if (!id) return -1;
  if (id === "__end__") return chain.length;
  return chain.findIndex((step) => step.id === id);
}

export function nextWargameOrderIndex(chain: WargameOrderStep[], currentIndex: number, self: WargameEngineUnit, units: WargameEngineUnit[], activeSeconds = 0) {
  const step = chain[currentIndex];
  if (!step) return chain.length;
  if (step.branchWhen) {
    const matched = evaluateWargameCondition(step.branchWhen, self, units, Math.max(0, activeSeconds));
    const branchId = matched ? step.nextStepId : step.elseStepId;
    const branchIndex = indexForStepId(chain, branchId);
    return branchIndex >= 0 ? branchIndex : currentIndex + 1;
  }
  const explicit = indexForStepId(chain, step.nextStepId);
  return explicit >= 0 ? explicit : currentIndex + 1;
}

function strongestByBuffId(effects: WargameBurstEffect[]) {
  const selected = new Map<number, WargameBurstEffect>();
  for (const effect of effects) {
    const current = selected.get(effect.buffId);
    if (!current || Math.abs(effect.value) > Math.abs(current.value)) selected.set(effect.buffId, effect);
  }
  return [...selected.values()];
}

function pct(value: number) {
  return Math.max(0.01, 1 + value / 100);
}

export function computeWargameCommandBurstModifiers(target: WargameBurstCarrier, units: WargameBurstCarrier[]): WargameBurstModifiers {
  const inRange: WargameBurstEffect[] = [];
  for (const source of units) {
    if (source.side !== target.side || source.ehp <= 0 || liveShips(source) <= 0) continue;
    for (const system of source.supportSystems ?? []) {
      if (system.kind !== "commandBurst" || !system.buffs?.length) continue;
      const rangeKm = Math.max(0, Number(system.optimalM) || 0) / 1000;
      if (rangeKm <= 0 || wargameEngineDistanceKm(source, target) > rangeKm) continue;
      for (const buff of system.buffs) inRange.push({ ...buff, sourceId: source.id, sourceName: source.name ?? source.id, rangeKm });
    }
  }
  const effects = strongestByBuffId(inRange);
  const modifiers: WargameBurstModifiers = { ...EMPTY_BURST_MODIFIERS, effects, sourceNames: [...new Set(effects.map((effect) => effect.sourceName))] };
  for (const effect of effects) {
    const value = effect.value;
    switch (effect.buffId) {
      case 10: modifiers.shieldDamageMultiplier *= pct(value); break;
      case 11: modifiers.shieldRepairCycleMultiplier *= pct(value); break;
      case 12: modifiers.shieldHpMultiplier *= pct(value); break;
      case 13: modifiers.armorDamageMultiplier *= pct(value); break;
      case 14: modifiers.armorRepairCycleMultiplier *= pct(value); break;
      case 15: modifiers.armorHpMultiplier *= pct(value); break;
      case 16: modifiers.scanResolutionMultiplier *= pct(value); break;
      case 17: modifiers.ewarRangeMultiplier *= pct(value); modifiers.ewarStrengthMultiplier *= pct(value); break;
      case 18: modifiers.sensorStrengthMultiplier *= pct(value); break;
      case 20: modifiers.signatureMultiplier *= pct(value); break;
      case 21: modifiers.tackleRangeMultiplier *= pct(value); break;
      case 22: modifiers.propulsionSpeedIncreaseMultiplier *= pct(value); break;
      case 26: modifiers.targetingRangeMultiplier *= pct(value); break;
      default: break;
    }
  }
  return modifiers;
}

// ---- authoritative wargame simulation core ----

export function clampPercent(value: number) {
  return Math.max(2, Math.min(98, value));
}

export function wargameDistanceKm(a: Pick<WargameUnit, "x" | "y">, b: Pick<WargameUnit, "x" | "y">) {
  return Math.hypot(a.x - b.x, a.y - b.y) * 2.5;
}

export function healthPercent(unit: WargameUnit) {
  const maximum = Math.max(1, unit.maxEhp ?? unit.ehp);
  return Math.max(0, Math.min(100, (unit.ehp / maximum) * 100));
}

export function liveShipCount(unit: WargameUnit) {
  if (unit.ehp <= 0) return 0;
  if (unit.shipsAlive != null) return Math.max(0, Math.min(unit.count, Math.floor(unit.shipsAlive)));
  return Math.max(1, Math.ceil(unit.count * (healthPercent(unit) / 100)));
}

export function perShipEhp(unit: WargameUnit) {
  return Math.max(1, (unit.maxEhp ?? unit.ehp) / Math.max(1, unit.count));
}

export function primaryEhp(unit: WargameUnit) {
  if (liveShipCount(unit) <= 0) return 0;
  return Math.max(0, Math.min(perShipEhp(unit), unit.primaryEhp ?? perShipEhp(unit)));
}

export function primaryHealthPercent(unit: WargameUnit) {
  return liveShipCount(unit) > 0 ? (primaryEhp(unit) / perShipEhp(unit)) * 100 : 0;
}

export function defaultWeaponCycle(unit: WargameUnit) {
  const name = unit.name.toLowerCase();
  const role = unit.role.toLowerCase();
  if ((unit.weaponModel ?? "turret") === "support") return 0;
  if (name.includes("hurricane") && role.includes("artillery")) return 8.5;
  if (name.includes("ferox")) return 5.2;
  if ((unit.weaponModel ?? "turret") === "missile") return 6;
  if (role.includes("tackle") || role.includes("interceptor")) return 3;
  return 5;
}

export function defaultTargetSwitchDelay(unit: WargameUnit) {
  const role = unit.role.toLowerCase();
  if (role.includes("tackle") || role.includes("interceptor")) return 1.2;
  if (unit.name.toLowerCase().includes("hurricane")) return 2.8;
  return 2.2;
}

export function prepareWargameUnit(unit: WargameUnit): WargameUnit {
  const count = Math.max(1, unit.count);
  const total = Math.max(0, unit.maxEhp ?? unit.ehp);
  const alive = unit.ehp > 0 ? Math.max(1, Math.min(count, unit.shipsAlive ?? count)) : 0;
  const shipEhp = Math.max(1, total / count);
  return {
    ...unit,
    shipsAlive: alive,
    primaryEhp: alive > 0 ? Math.min(shipEhp, unit.primaryEhp ?? shipEhp) : 0,
    primaryShieldHp: alive > 0 && unit.shieldHp != null ? Math.max(0, Math.min(unit.shieldHp, unit.primaryShieldHp ?? unit.shieldHp)) : unit.primaryShieldHp,
    primaryArmorHp: alive > 0 && unit.armorHp != null ? Math.max(0, Math.min(unit.armorHp, unit.primaryArmorHp ?? unit.armorHp)) : unit.primaryArmorHp,
    primaryStructureHp: alive > 0 && unit.structureHp != null ? Math.max(0, Math.min(unit.structureHp, unit.primaryStructureHp ?? unit.structureHp)) : unit.primaryStructureHp,
    weaponCycle: unit.weaponCycle ?? defaultWeaponCycle(unit),
    fireCooldown: unit.fireCooldown ?? 0,
    targetSwitchDelay: unit.targetSwitchDelay ?? defaultTargetSwitchDelay(unit),
    lockRemaining: unit.lockRemaining ?? 0,
    repCycle: unit.repCycle ?? ((unit.repPerSecond ?? 0) > 0 ? 4 : 0),
    repCooldown: unit.repCooldown ?? 0,
    repLockTime: unit.repLockTime ?? 2.5,
    repLockRemaining: unit.repLockRemaining ?? 0,
    capacitorCurrent: unit.capacitorCurrent ?? unit.capacitorCapacity ?? 0,
    ewarSignatureMultiplier: 1,
    ewarTrackingMultiplier: 1,
    ewarOptimalMultiplier: 1,
    ewarFalloffMultiplier: 1,
    ewarTargetingRangeMultiplier: 1,
    ewarScanResolutionMultiplier: 1,
    jamRemaining: unit.jamRemaining ?? 0,
    scrammed: Boolean(unit.scrammed),
    neutPressureGjPerSecond: 0,
    supportCooldowns: { ...(unit.supportCooldowns ?? {}) },
    supportTargetIds: { ...(unit.supportTargetIds ?? {}) },
    supportLastTargetIds: { ...(unit.supportLastTargetIds ?? {}) },
    supportLockRemaining: { ...(unit.supportLockRemaining ?? {}) },
    damageSources: cloneDamageSources(unit.damageSources),
    orderChain: cloneOrderChain(unit.orderChain),
    activeOrderIndex: Math.max(0, unit.activeOrderIndex ?? 0),
    activeOrderElapsed: Math.max(0, unit.activeOrderElapsed ?? 0),
    activeOrderWaitElapsed: Math.max(0, unit.activeOrderWaitElapsed ?? 0),
    activeOrderStarted: Boolean(unit.activeOrderStarted),
    movementOrder: unit.movementOrder ?? "legacy",
    movementState: unit.movementState ?? "idle",
    alignTimeSeconds: Math.max(.1, unit.alignTimeSeconds ?? (unit.role.toLowerCase().includes("frigate") || unit.role.toLowerCase().includes("interceptor") ? 3 : unit.role.toLowerCase().includes("battlecruiser") || unit.name.toLowerCase().includes("ferox") || unit.name.toLowerCase().includes("hurricane") ? 8 : 6)),
    alignElapsedSeconds: Math.max(0, unit.alignElapsedSeconds ?? 0),
    warpSpeedAuPerSecond: Math.max(.1, unit.warpSpeedAuPerSecond ?? 3),
    warpRangeKm: Math.max(0, Math.min(100, unit.warpRangeKm ?? 0)),
    warpRemainingSeconds: Math.max(0, unit.warpRemainingSeconds ?? 0),
    warpDisruptionStrength: Math.max(0, unit.warpDisruptionStrength ?? 0),
    warpCoreStrength: Math.max(0, unit.warpCoreStrength ?? 0),
    tackleSourceIds: [...(unit.tackleSourceIds ?? [])],
  };
}

export function velocityMps(unit: WargameUnit) {
  return Math.hypot(unit.velocityX ?? 0, unit.velocityY ?? 0) * 2500;
}

export function relativeVelocityMps(a: WargameUnit, b: WargameUnit) {
  return Math.hypot((a.velocityX ?? 0) - (b.velocityX ?? 0), (a.velocityY ?? 0) - (b.velocityY ?? 0)) * 2500;
}

export function rangeRateMps(a: WargameUnit, b: WargameUnit) {
  const dx = (b.x - a.x) * 2500;
  const dy = (b.y - a.y) * 2500;
  const distance = Math.max(1, Math.hypot(dx, dy));
  const rvx = ((b.velocityX ?? 0) - (a.velocityX ?? 0)) * 2500;
  const rvy = ((b.velocityY ?? 0) - (a.velocityY ?? 0)) * 2500;
  return (dx * rvx + dy * rvy) / distance;
}

export function preferredCombatRange(unit: WargameUnit) {
  const stance = unit.stance ?? "kite";
  if (stance === "brawl") return Math.max(5, unit.range * .35);
  if (stance === "pursue") return Math.max(5, unit.range * .55);
  if (stance === "screen") return Math.max(8, unit.range * .58);
  if (stance === "hold") return Math.max(5, unit.range * .72);
  return Math.max(8, unit.range * .82);
}

export function weaponApplication(attacker: WargameUnit, target: WargameUnit, rangeKm = wargameDistanceKm(attacker, target)) {
  const baseOptimal = Math.max(0, attacker.optimalRange ?? attacker.range * .62);
  const baseFalloff = Math.max(.001, attacker.falloffRange ?? Math.max(4, attacker.range - baseOptimal));
  const optimal = baseOptimal * Math.max(.05, attacker.ewarOptimalMultiplier ?? 1);
  const falloff = baseFalloff * Math.max(.05, attacker.ewarFalloffMultiplier ?? 1);
  const maxRange = (attacker.weaponModel ?? "turret") === "turret" ? Math.max(1, optimal + falloff * 2) : Math.max(1, attacker.range);
  if (rangeKm > maxRange || attacker.ehp <= 0 || target.ehp <= 0) return 0;
  const model = attacker.weaponModel ?? "turret";
  if (model === "support") return 0;
  if (model === "missile") {
    const explosionRadius = Math.max(1, attacker.explosionRadius ?? 180);
    const explosionVelocity = Math.max(1, attacker.explosionVelocity ?? 1450);
    const drf = Math.max(.05, attacker.damageReductionFactor ?? .62);
    const signatureRatio = Math.max(0, (target.signature ?? 160) * (target.ewarSignatureMultiplier ?? 1)) / explosionRadius;
    const speed = Math.max(0, target.effectiveSpeed ?? velocityMps(target));
    const velocityTerm = speed <= 0 ? 1 : Math.pow(Math.max(0, signatureRatio * explosionVelocity / speed), drf);
    return Math.max(0, Math.min(1, signatureRatio, velocityTerm));
  }
  if (model === "drone") {
    const relativeSpeed = relativeVelocityMps(attacker, target);
    const controlFactor = rangeKm <= maxRange ? 1 : 0;
    const speedFactor = Math.max(.2, Math.min(1, 1.12 - relativeSpeed / 5200));
    return controlFactor * speedFactor;
  }
  const dxM = (target.x - attacker.x) * 2500;
  const dyM = (target.y - attacker.y) * 2500;
  const distanceM = Math.max(1000, Math.hypot(dxM, dyM));
  const rvx = ((target.velocityX ?? 0) - (attacker.velocityX ?? 0)) * 2500;
  const rvy = ((target.velocityY ?? 0) - (attacker.velocityY ?? 0)) * 2500;
  const transverse = Math.abs(dxM * rvy - dyM * rvx) / distanceM;
  const angular = transverse / distanceM;
  const tracking = Math.max(1e-12, (attacker.tracking ?? .04) * Math.max(.05, attacker.ewarTrackingMultiplier ?? 1));
  const signatureResolution = Math.max(1, attacker.signatureResolution ?? 125);
  const trackingTerm = angular * signatureResolution / (tracking * Math.max(1, (target.signature ?? 160) * (target.ewarSignatureMultiplier ?? 1)));
  const rangeTerm = Math.max(0, rangeKm - optimal) / falloff;
  const hitChance = Math.pow(.5, trackingTerm * trackingTerm + rangeTerm * rangeTerm);
  const expectedDamageFactor = hitChance <= .01 ? 3 * hitChance : .5 * hitChance * hitChance + .49 * hitChance + .02505;
  return Math.max(0, Math.min(1, expectedDamageFactor));
}

export function unitDamageProfile(unit: WargameUnit) {
  const values = [unit.damageEm ?? .25, unit.damageTherm ?? .25, unit.damageKin ?? .25, unit.damageExp ?? .25];
  const total = Math.max(1e-12, values.reduce((sum, value) => sum + Math.max(0, value), 0));
  return values.map((value) => Math.max(0, value) / total) as [number, number, number, number];
}

export function profileEhpPerShip(unit: WargameUnit, profile: [number, number, number, number]) {
  if (unit.shieldHp == null || unit.armorHp == null || unit.structureHp == null || !unit.shieldResists || !unit.armorResists || !unit.hullResists) return perShipEhp(unit);
  const layer = (hp: number, resists: [number, number, number, number]) => {
    const fraction = profile.reduce((sum, weight, index) => sum + weight * (1 - (resists[index] ?? 0)), 0);
    return Math.max(0, hp) / Math.max(1e-12, fraction);
  };
  return layer(unit.shieldHp, unit.shieldResists) + layer(unit.armorHp, unit.armorResists) + layer(unit.structureHp, unit.hullResists);
}

export function resistanceScale(attacker: WargameUnit, target: WargameUnit) {
  if (!target.shieldResists || !target.armorResists || !target.hullResists) return 1;
  const omni = profileEhpPerShip(target, [.25, .25, .25, .25]);
  const against = profileEhpPerShip(target, unitDamageProfile(attacker));
  return against > 0 ? Math.max(.1, Math.min(3, omni / against)) : 1;
}

export function damageSourceAsAttacker(unit: WargameUnit, source: WargameDamageSource): WargameUnit {
  return {
    ...unit,
    weaponModel: source.kind,
    range: source.maxRangeKm,
    optimalRange: source.optimalKm,
    falloffRange: source.falloffKm,
    tracking: source.tracking,
    signatureResolution: source.signatureResolutionM,
    explosionRadius: source.explosionRadiusM,
    explosionVelocity: source.explosionVelocityMps,
    damageReductionFactor: source.damageReductionFactor,
    damageEm: source.damageProfile.em,
    damageTherm: source.damageProfile.thermal,
    damageKin: source.damageProfile.kinetic,
    damageExp: source.damageProfile.explosive,
  };
}

export function damageSourceApplication(unit: WargameUnit, source: WargameDamageSource, target: WargameUnit, rangeKm = wargameDistanceKm(unit, target)) {
  if (source.kind !== "drone") return weaponApplication(damageSourceAsAttacker(unit, source), target, rangeKm);
  const signature = Math.max(1, (target.signature ?? 160) * (target.ewarSignatureMultiplier ?? 1));
  const sentry = Boolean(source.sentry);
  const dxM = (target.x - unit.x) * 2500;
  const dyM = (target.y - unit.y) * 2500;
  const ownerDistanceM = Math.max(1000, Math.hypot(dxM, dyM));
  const rvx = ((target.velocityX ?? 0) - (unit.velocityX ?? 0)) * 2500;
  const rvy = ((target.velocityY ?? 0) - (unit.velocityY ?? 0)) * 2500;
  const transverseMps = Math.abs(dxM * rvy - dyM * rvx) / ownerDistanceM;
  const targetAngular = transverseMps / ownerDistanceM;
  const orbitRangeM = Math.max(1, (source.droneOrbitRangeKm ?? source.optimalKm ?? 1) * 1000);
  const engagementDistanceM = sentry ? ownerDistanceM : orbitRangeM;
  const orbitAngular = sentry ? 0 : Math.max(0, source.droneOrbitVelocityMps ?? 0) / engagementDistanceM;
  const angular = sentry ? targetAngular : Math.hypot(targetAngular, orbitAngular);
  const tracking = Math.max(1e-12, source.tracking ?? .5);
  const signatureResolution = Math.max(1e-12, source.signatureResolutionM ?? 25);
  const trackingTerm = angular * signatureResolution / (tracking * signature);
  const falloff = Math.max(1, (source.falloffKm ?? .001) * 1000);
  const optimal = Math.max(0, (source.optimalKm ?? 0) * 1000);
  const rangeTerm = Math.max(0, engagementDistanceM - optimal) / falloff;
  const hitChance = Math.pow(.5, trackingTerm * trackingTerm + rangeTerm * rangeTerm);
  const weaponFactor = hitChance <= .01 ? 3 * hitChance : .5 * hitChance * hitChance + .49 * hitChance + .02505;
  const targetSpeed = Math.max(0, target.effectiveSpeed ?? velocityMps(target));
  const droneSpeed = Math.max(0, source.droneMaximumVelocityMps ?? 0);
  const pursuitFactor = sentry || targetSpeed <= droneSpeed || targetSpeed <= 0 ? 1 : Math.max(0, Math.min(1, droneSpeed / targetSpeed));
  const committed = source.droneOnTargetId === target.id;
  const controlRange = Math.max(.1, source.droneControlRangeKm ?? source.maxRangeKm);
  const controlFactor = committed || rangeKm <= controlRange ? 1 : 0;
  return Math.max(0, Math.min(1, weaponFactor * pursuitFactor * controlFactor));
}

export function sourcePaperDps(unit: WargameUnit, source: WargameDamageSource) {
  return Math.max(0, source.dpsPerShip) * liveShipCount(unit);
}

export function sourcePaperVolley(unit: WargameUnit, source: WargameDamageSource) {
  return Math.max(0, source.volleyPerShip) * liveShipCount(unit);
}

export function advanceWargameSimulation(units: WargameUnit[], options: WargameAdvanceOptions): WargameAdvanceResult {
  const stepSeconds = Math.max(1, Math.min(60, Math.round(options.seconds)));
  let next = units.map((unit) => prepareWargameUnit({ ...unit }));
  const events: string[] = [];
  let damageOccurred = false;
  const elapsed = Math.max(0, options.elapsedSeconds);
  const aiResponseVisible = options.redAiEnabled;
  const scenarioInterdictionZones: WargameInterdictionZone[] = (options.interdictionZones ?? []).map((zone) => ({ ...zone, radiusKm: Math.max(0, zone.radiusKm) }));
  let rngSeed = (options.rngSeed ?? 0x6d2b79f5) >>> 0;
  const random = () => { rngSeed = (Math.imul(rngSeed, 1664525) + 1013904223) >>> 0; return rngSeed / 0x100000000; };

    const findById = (id?: string) => id ? next.find((unit) => unit.id === id && unit.ehp > 0 && unit.movementState !== "warping") : undefined;
    const living = (side: WargameSide) => next.filter((unit) => unit.side === side && unit.simulationReady !== false && unit.ehp > 0 && liveShipCount(unit) > 0);

    const layerFraction = (profile: [number,number,number,number], resists: [number,number,number,number]) => Math.max(1e-12, profile.reduce((sum,weight,index)=>sum+weight*(1-(resists[index]??0)),0));
    const remainingPrimaryEhp = (unit: WargameUnit) => {
      if (unit.primaryShieldHp == null || unit.primaryArmorHp == null || unit.primaryStructureHp == null || !unit.shieldResists || !unit.armorResists || !unit.hullResists) return primaryEhp(unit);
      const omni:[number,number,number,number]=[.25,.25,.25,.25];
      return unit.primaryShieldHp/layerFraction(omni,unit.shieldResists)+unit.primaryArmorHp/layerFraction(omni,unit.armorResists)+unit.primaryStructureHp/layerFraction(omni,unit.hullResists);
    };
    const recalcFormationEhp = (unit: WargameUnit) => {
      const alive = liveShipCount(unit);
      if (alive <= 0) { unit.ehp = 0; unit.primaryEhp = 0; unit.primaryShieldHp=0; unit.primaryArmorHp=0; unit.primaryStructureHp=0; return; }
      unit.primaryEhp = Math.max(0,Math.min(perShipEhp(unit),remainingPrimaryEhp(unit)));
      unit.ehp = Math.max(0, (alive - 1) * perShipEhp(unit) + (unit.primaryEhp ?? 0));
    };

    const applyVolleyToPrimary = (target: WargameUnit, damage: number, attacker: WargameUnit) => {
      const aliveBefore = liveShipCount(target);
      if (aliveBefore <= 0 || damage <= 0) return false;
      if (target.primaryShieldHp != null && target.primaryArmorHp != null && target.primaryStructureHp != null && target.shieldResists && target.armorResists && target.hullResists) {
        const profile=unitDamageProfile(attacker);
        let incoming=damage;
        const hitLayer=(key: "primaryShieldHp"|"primaryArmorHp"|"primaryStructureHp",resists:[number,number,number,number])=>{
          const hp=Math.max(0,target[key]??0); if(hp<=0||incoming<=0)return;
          let fraction=layerFraction(profile,resists);
          if(key==="primaryShieldHp")fraction*= (target.burstShieldDamageMultiplier??1)/Math.max(.01,target.burstShieldHpMultiplier??1);
          if(key==="primaryArmorHp")fraction*= (target.burstArmorDamageMultiplier??1)/Math.max(.01,target.burstArmorHpMultiplier??1);
          const required=hp/fraction;
          if(incoming>=required){target[key]=0;incoming-=required;}else{target[key]=Math.max(0,hp-incoming*fraction);incoming=0;}
        };
        hitLayer("primaryShieldHp",target.shieldResists); hitLayer("primaryArmorHp",target.armorResists); hitLayer("primaryStructureHp",target.hullResists);
        if ((target.primaryStructureHp??0)<=.0001) {
          const remaining=Math.max(0,aliveBefore-1); target.shipsAlive=remaining;
          target.primaryShieldHp=remaining>0?(target.shieldHp??0):0; target.primaryArmorHp=remaining>0?(target.armorHp??0):0; target.primaryStructureHp=remaining>0?(target.structureHp??0):0;
          target.primaryEhp=remaining>0?perShipEhp(target):0; recalcFormationEhp(target);
          events.push(`${attacker.name} volley destroys a ${target.name} primary - ${remaining} remain.`);
          for(const shooter of next){if(shooter.targetId===target.id&&shooter.ehp>0)shooter.lockRemaining=Math.max(shooter.lockRemaining??0,shooter.targetSwitchDelay??defaultTargetSwitchDelay(shooter));for(const source of shooter.damageSources??[]){if(source.targetId===target.id)source.lockRemaining=Math.max(source.lockRemaining??0,shooter.targetSwitchDelay??defaultTargetSwitchDelay(shooter));}}
          return true;
        }
        recalcFormationEhp(target); return false;
      }
      const primaryBefore=primaryEhp(target); const actual=Math.min(primaryBefore,damage);
      if(damage+.01>=primaryBefore){const remaining=Math.max(0,aliveBefore-1);target.shipsAlive=remaining;target.primaryEhp=remaining>0?perShipEhp(target):0;recalcFormationEhp(target);events.push(`${attacker.name} volley destroys a ${target.name} primary - ${remaining} remain.`);for(const shooter of next){if(shooter.targetId===target.id&&shooter.ehp>0)shooter.lockRemaining=Math.max(shooter.lockRemaining??0,shooter.targetSwitchDelay??defaultTargetSwitchDelay(shooter));for(const source of shooter.damageSources??[]){if(source.targetId===target.id)source.lockRemaining=Math.max(source.lockRemaining??0,shooter.targetSwitchDelay??defaultTargetSwitchDelay(shooter));}}return true;}
      target.primaryEhp=Math.max(0,primaryBefore-actual);recalcFormationEhp(target);return false;
    };

    const applyRepToPrimary = (target: WargameUnit, amount: number, kind: "shield"|"armor"|"generic" = "generic") => {
      if (target.ehp <= 0 || liveShipCount(target) <= 0 || amount <= 0) return 0;
      if(kind!=="generic" && target.primaryShieldHp!=null && target.primaryArmorHp!=null){
        const key=kind==="shield"?"primaryShieldHp":"primaryArmorHp"; const maximum=kind==="shield"?(target.shieldHp??0):(target.armorHp??0); const before=Math.max(0,target[key]??0); const after=Math.min(maximum,before+amount); target[key]=after; recalcFormationEhp(target); return after-before;
      }
      const before = primaryEhp(target);
      const after = Math.min(perShipEhp(target), before + amount);
      target.primaryEhp = after; recalcFormationEhp(target); return after-before;
    };

    for (let second = 0; second < stepSeconds; second += 1) {
      // The React surface delegates order state/branch decisions to the pure wargame engine.
      // Each step may wait on a condition, execute split fire/support assignments, then branch on battlefield state.
      for (const unit of next) {
        const chain = unit.orderChain ?? [];
        let index = Math.max(0, unit.activeOrderIndex ?? 0);
        if (!chain.length || index >= chain.length || unit.ehp <= 0) continue;
        let step = chain[index];

        if (!unit.activeOrderStarted) {
          const waiting = Math.max(0, unit.activeOrderWaitElapsed ?? 0);
          if (!canStartWargameOrder(step, unit, next, waiting)) {
            unit.activeOrderWaitElapsed = waiting + 1;
            continue;
          }
          unit.activeOrderStarted = true;
          unit.activeOrderStartedAt = elapsed + second;
          unit.activeOrderElapsed = 0;
          unit.activeOrderWaitElapsed = 0;
          events.push(unit.name + ": executing " + step.label + ".");
        } else if (isWargameOrderComplete(step, unit, next, Math.max(0, unit.activeOrderElapsed ?? 0))) {
          const oldIndex = index;
          const activeSeconds = Math.max(0, unit.activeOrderElapsed ?? 0);
          index = nextWargameOrderIndex(chain, oldIndex, unit, next, activeSeconds);
          const branched = index !== oldIndex + 1;
          events.push(unit.name + ": " + step.label + " complete" + (branched ? "; conditional branch selected." : "; advancing FC order chain."));
          unit.activeOrderIndex = index;
          unit.activeOrderStarted = false;
          unit.activeOrderStartedAt = undefined;
          unit.activeOrderElapsed = 0;
          unit.activeOrderWaitElapsed = 0;
          unit.movementPropulsion = undefined;
          if (index >= chain.length || index < 0) continue;
          step = chain[index];
          if (!canStartWargameOrder(step, unit, next, 0)) {
            unit.activeOrderWaitElapsed = 1;
            continue;
          }
          unit.activeOrderStarted = true;
          unit.activeOrderStartedAt = elapsed + second;
          events.push(unit.name + ": executing " + step.label + ".");
        }

        unit.activeOrderElapsed = Math.max(0, unit.activeOrderElapsed ?? 0) + 1;
        if (step.stance) unit.stance = step.stance;
        if (step.movement && unit.activeMovementStepId !== step.id) {
          unit.activeMovementStepId = step.id;
          unit.movementOrder = step.movement;
          unit.movementTargetId = step.moveTargetId;
          unit.movementRangeKm = Math.max(0, step.movementRangeKm ?? unit.movementRangeKm ?? 0);
          unit.warpRangeKm = Math.max(0, Math.min(100, step.warpRangeKm ?? unit.warpRangeKm ?? 0));
          unit.destinationX = step.moveX;
          unit.destinationY = step.moveY;
          unit.movementState = step.movement === "hold" ? "idle" : undefined;
          unit.alignElapsedSeconds = 0;
          unit.alignedToTargetId = undefined;
          unit.alignedX = undefined;
          unit.alignedY = undefined;
          unit.warpRemainingSeconds = 0;
          unit.warpDestinationX = undefined;
          unit.warpDestinationY = undefined;
          unit.warpBlockedReason = undefined;
        }
        unit.movementPropulsion = step.propulsion;
        if (unit.damageSources?.length) {
          unit.damageSources = unit.damageSources.map((source) => {
            const orderedTarget = step.sourceTargets[source.id];
            if (source.targetId === orderedTarget) return source;
            return {
              ...source, targetId: orderedTarget, lastTargetId: undefined, lockRemaining: 0,
              droneOnTargetId: source.kind === "drone" ? undefined : source.droneOnTargetId,
              droneArrivalRemaining: source.kind === "drone" ? 0 : source.droneArrivalRemaining,
            };
          });
        }
        const supportTargets = { ...(unit.supportTargetIds ?? {}) };
        for (let supportIndex = 0; supportIndex < (unit.supportSystems?.length ?? 0); supportIndex += 1) {
          const system = unit.supportSystems![supportIndex];
          const key = wargameSupportSystemKey(system, supportIndex);
          if (Object.prototype.hasOwnProperty.call(step.supportTargets ?? {}, key)) supportTargets[key] = step.supportTargets?.[key];
          else if (wargameSupportTargetSide(system.kind) === "hostile" && step.tackleTargetId) supportTargets[key] = step.tackleTargetId;
          else if (wargameSupportTargetSide(system.kind) === "friendly" && step.repTargetId) supportTargets[key] = step.repTargetId;
        }
        unit.supportTargetIds = supportTargets;
        const firstDamageTarget = unit.damageSources?.map((source) => source.targetId).find(Boolean);
        unit.targetId = step.tackleTargetId || firstDamageTarget || unit.targetId;
        if (step.repTargetId) unit.repTargetId = step.repTargetId;
        if (!step.movement || step.movement === "legacy") {
          const moveTarget = step.moveTargetId ? next.find((candidate) => candidate.id === step.moveTargetId) : undefined;
          if (moveTarget) { unit.destinationX = moveTarget.x; unit.destinationY = moveTarget.y; }
          else if (step.moveX != null && step.moveY != null) { unit.destinationX = step.moveX; unit.destinationY = step.moveY; }
        }
      }

      if (aiResponseVisible) {
        const decisions = planReactiveRedTeam(getWargameObservation("red", next), {
          distanceKm: wargameDistanceKm,
          weaponApplication,
          healthPercent,
          primaryHealthPercent,
        });
        for (const decision of decisions) {
          const red = next.find((unit) => unit.id === decision.unitId && unit.ehp > 0);
          const target = next.find((unit) => unit.id === decision.targetId && unit.ehp > 0);
          if (!red || !target) continue;
          red.targetId = target.id;
          if (red.damageSources?.length) red.damageSources = red.damageSources.map((source) => ({ ...source, targetId: target.id, lastTargetId: undefined, lockRemaining: 0, droneOnTargetId: source.kind === "drone" ? undefined : source.droneOnTargetId, droneArrivalRemaining: source.kind === "drone" ? 0 : source.droneArrivalRemaining }));
          red.destinationX = undefined;
          red.destinationY = undefined;
          red.lastTargetId = undefined;
          events.push(`RED AI: ${red.name} calls ${target.name}${decision.reason === "support-pressure" ? " for support/EWAR pressure" : " based on range/application"}.`);
        }
      }
      // Resolve command bursts first. These are same-side range auras sourced from the loaded
      // command-burst charge and its skill/hull-adjusted DOGMA buff values.
      const burstByUnit = new Map(next.map((unit) => [unit.id, computeWargameCommandBurstModifiers(unit, next)]));
      for (const unit of next) {
        const burst=burstByUnit.get(unit.id)!;
        unit.burstSourceNames=burst.sourceNames;
        unit.burstPropulsionSpeedMultiplier=burst.propulsionSpeedIncreaseMultiplier;
        unit.burstTackleRangeMultiplier=burst.tackleRangeMultiplier;
        unit.burstEwarRangeMultiplier=burst.ewarRangeMultiplier;
        unit.burstEwarStrengthMultiplier=burst.ewarStrengthMultiplier;
        unit.burstSensorStrengthMultiplier=burst.sensorStrengthMultiplier;
        unit.burstShieldDamageMultiplier=burst.shieldDamageMultiplier;
        unit.burstArmorDamageMultiplier=burst.armorDamageMultiplier;
        unit.burstShieldHpMultiplier=burst.shieldHpMultiplier;
        unit.burstArmorHpMultiplier=burst.armorHpMultiplier;
        unit.burstShieldRepairCycleMultiplier=burst.shieldRepairCycleMultiplier;
        unit.burstArmorRepairCycleMultiplier=burst.armorRepairCycleMultiplier;
      }

      // Resolve fitted support systems against their assigned targets. Values come from skill/hull/script adjusted DOGMA.
      const webMultiplier = new Map<string, number>();
      const supportEffectiveness = (system: WargameSupportSystem, rangeKm: number, controller?: WargameUnit) => {
        const rangeBoost = !controller ? 1 : system.kind === "tackle" || system.kind === "web" ? (controller.burstTackleRangeMultiplier ?? 1) : ["targetPainter","sensorDamp","trackingDisruptor","ecm"].includes(system.kind) ? (controller.burstEwarRangeMultiplier ?? 1) : 1;
        const optimalKm = Math.max(0, Number(system.optimalM) || 0) / 1000 * rangeBoost;
        const falloffKm = Math.max(0, Number(system.falloffM) || 0) / 1000 * rangeBoost;
        if (rangeKm <= optimalKm) return 1;
        if (falloffKm <= 0) return 0;
        const x = (rangeKm - optimalKm) / falloffKm;
        return Math.pow(.5, x * x);
      };
      const STACKING = [1,.86911998,.57058314,.28295515,.10599265,.029994,.006403];
      const stackedMultiplier = (bonus: number, copies: number, effectiveness: number) => { let value=1; for(let i=0;i<Math.min(copies,STACKING.length);i+=1)value*=Math.max(.02,1+bonus*effectiveness*STACKING[i]); return value; };
      const capRecharge = (unit: WargameUnit) => {
        const capacity = Math.max(0, unit.capacitorCapacity ?? 0);
        const recharge = Math.max(0, unit.capacitorRechargeSeconds ?? 0);
        if (!capacity || !recharge) return;
        const current = Math.max(0, Math.min(capacity, unit.capacitorCurrent ?? capacity));
        const fraction = Math.max(0, Math.min(1, current / capacity));
        const natural = (10 * capacity / recharge) * (Math.sqrt(fraction) - fraction);
        const injected = Math.max(0, unit.capacitorInjectedGjPerSecond ?? 0);
        const demand = Math.max(0, unit.capacitorDemandGjPerSecond ?? 0);
        unit.capacitorCurrent = Math.max(0, Math.min(capacity, current + natural + injected - demand));
      };
      for (const unit of next) {
        const burst=burstByUnit.get(unit.id);
        unit.ewarSignatureMultiplier = burst?.signatureMultiplier ?? 1; unit.ewarTrackingMultiplier = 1; unit.ewarOptimalMultiplier = 1; unit.ewarFalloffMultiplier = 1;
        unit.ewarTargetingRangeMultiplier = burst?.targetingRangeMultiplier ?? 1; unit.ewarScanResolutionMultiplier = burst?.scanResolutionMultiplier ?? 1; unit.scrammed = false; unit.warpDisruptionStrength = 0; unit.tackleSourceIds = []; unit.neutPressureGjPerSecond = 0;
        unit.jamRemaining = Math.max(0, (unit.jamRemaining ?? 0) - 1);
        if ((unit.jamRemaining ?? 0) <= 0) unit.jammedBy = undefined;
        capRecharge(unit);
        const cooldowns = unit.supportCooldowns ?? {};
        for (const key of Object.keys(cooldowns)) cooldowns[key] = Math.max(0, cooldowns[key] - 1);
        unit.supportCooldowns = cooldowns;
      }
      for (const controller of next) {
        if (controller.simulationReady === false || controller.ehp <= 0 || controller.movementState === "warping" || !controller.supportSystems?.length) continue;
        const hostileTarget = findById(controller.targetId);
        for (let index = 0; index < controller.supportSystems.length; index += 1) {
          const system: WargameSupportSystem = controller.supportSystems[index]!;
          const key = wargameSupportSystemKey(system,index);
          if (system.kind === "commandBurst" || system.kind === "remoteShieldRep" || system.kind === "remoteArmorRep") continue;
          const targetSide=wargameSupportTargetSide(system.kind);
          const hasAssigned=Object.prototype.hasOwnProperty.call(controller.supportTargetIds ?? {},key);
          const fallbackId=targetSide === "friendly" ? controller.repTargetId : controller.targetId;
          const target=findById(hasAssigned ? controller.supportTargetIds?.[key] : fallbackId);
          if (!target || target.simulationReady === false || (targetSide === "friendly" ? target.side !== controller.side : target.side === controller.side)) continue;
          const rangeKm = wargameDistanceKm(controller, target);
          const effectiveness = supportEffectiveness(system, rangeKm, controller);
          if (effectiveness <= .01) continue;
          const copies = Math.max(1, Number(system.quantity) || 1) * Math.max(1, liveShipCount(controller));
          const ewarStrength=controller.burstEwarStrengthMultiplier ?? 1;
          if (system.kind === "web") { const current=webMultiplier.get(target.id) ?? 1; const one=Math.max(.05,1-Math.max(0,Math.min(.95,Number(system.strength)||0))*effectiveness); webMultiplier.set(target.id, Math.max(.05,current*Math.pow(one,copies))); }
          else if (system.kind === "targetPainter") target.ewarSignatureMultiplier! *= stackedMultiplier(Math.max(0,Number(system.signatureBonus)||0)*ewarStrength,copies,effectiveness);
          else if (system.kind === "sensorDamp") { target.ewarTargetingRangeMultiplier! *= stackedMultiplier((Number(system.maxTargetRangeBonus)||0)*ewarStrength,copies,effectiveness); target.ewarScanResolutionMultiplier! *= stackedMultiplier((Number(system.scanResolutionBonus)||0)*ewarStrength,copies,effectiveness); }
          else if (system.kind === "trackingDisruptor") { target.ewarOptimalMultiplier! *= stackedMultiplier((Number(system.optimalBonus)||0)*ewarStrength,copies,effectiveness); target.ewarFalloffMultiplier! *= stackedMultiplier((Number(system.falloffBonus)||0)*ewarStrength,copies,effectiveness); target.ewarTrackingMultiplier! *= stackedMultiplier((Number(system.trackingBonus)||0)*ewarStrength,copies,effectiveness); }
          else if (system.kind === "remoteSensorBooster") { target.ewarTargetingRangeMultiplier! *= stackedMultiplier(Math.max(0,Number(system.maxTargetRangeBonus)||0),copies,effectiveness); target.ewarScanResolutionMultiplier! *= stackedMultiplier(Math.max(0,Number(system.scanResolutionBonus)||0),copies,effectiveness); }
          else if (system.kind === "remoteTrackingComputer") { target.ewarOptimalMultiplier! *= stackedMultiplier(Math.max(0,Number(system.optimalBonus)||0),copies,effectiveness); target.ewarFalloffMultiplier! *= stackedMultiplier(Math.max(0,Number(system.falloffBonus)||0),copies,effectiveness); target.ewarTrackingMultiplier! *= stackedMultiplier(Math.max(0,Number(system.trackingBonus)||0),copies,effectiveness); }
          else if (system.kind === "tackle" && effectiveness > .5) {
            const pointStrength=Math.max(1,Math.abs(Number(system.warpStrength)||1))*copies;
            target.warpDisruptionStrength=(target.warpDisruptionStrength??0)+pointStrength;
            target.tackleSourceIds=[...new Set([...(target.tackleSourceIds??[]),controller.id])];
            if (system.mwdShutdown) target.scrammed = true;
          }
          else if (system.kind === "energyNeutralizer" && (controller.supportCooldowns?.[key] ?? 0) <= 0) {
            const amount=Math.max(0,Number(system.amountPerCycle)||0)*effectiveness*Math.max(1,liveShipCount(controller));
            if ((target.capacitorCapacity ?? 0) > 0) { target.capacitorCurrent=Math.max(0,(target.capacitorCurrent ?? target.capacitorCapacity ?? 0)-amount); target.neutPressureGjPerSecond=(target.neutPressureGjPerSecond ?? 0)+(Number(system.perSecond)||0)*effectiveness; }
            controller.supportCooldowns![key]=Math.max(1,Number(system.cycleSeconds)||1);
          } else if (system.kind === "energyNosferatu" && (controller.supportCooldowns?.[key] ?? 0) <= 0) {
            const aCap=Math.max(0,controller.capacitorCapacity??0), tCap=Math.max(0,target.capacitorCapacity??0); const aPct=aCap?((controller.capacitorCurrent??aCap)/aCap):1, tPct=tCap?((target.capacitorCurrent??tCap)/tCap):0;
            if (aPct < tPct && aCap && tCap) { const amount=Math.min(Math.max(0,Number(system.amountPerCycle)||0)*effectiveness,target.capacitorCurrent??0); target.capacitorCurrent=Math.max(0,(target.capacitorCurrent??0)-amount); controller.capacitorCurrent=Math.min(aCap,(controller.capacitorCurrent??0)+amount); }
            controller.supportCooldowns![key]=Math.max(1,Number(system.cycleSeconds)||1);
          } else if (system.kind === "remoteCapacitor" && (controller.supportCooldowns?.[key] ?? 0) <= 0 && (target.capacitorCapacity ?? 0) > 0) {
            const amount=Math.max(0,Number(system.amountPerCycle)||0)*effectiveness; target.capacitorCurrent=Math.min(target.capacitorCapacity!, (target.capacitorCurrent??0)+amount); controller.supportCooldowns![key]=Math.max(1,Number(system.cycleSeconds)||1);
          } else if (system.kind === "ecm" && (controller.supportCooldowns?.[key] ?? 0) <= 0) {
            const sensor=Math.max(.1,(target.sensorStrength??1)*(target.burstSensorStrengthMultiplier??1)); const single=Math.max(0,Math.min(1,(Number(system.strength)||0)*ewarStrength*effectiveness/sensor)); const chance=1-Math.pow(1-single,copies);
            const seed=Math.abs(Math.sin((elapsed+second+1)*12.9898 + controller.id.length*78.233 + target.id.length*37.719))*43758.5453;
            if ((seed-Math.floor(seed)) < chance) { target.jamRemaining=Math.max(1,Number(system.cycleSeconds)||20); target.jammedBy=controller.id; events.push(`${controller.name}: ECM jams ${target.name} (${Math.round(chance*100)}% cycle chance).`); }
            controller.supportCooldowns![key]=Math.max(1,Number(system.cycleSeconds)||20);
          }
        }
      }

      // Scenario-local manual web values remain as a fallback for formations without a fit-linked web.
      for (const controller of next) {
        if (controller.simulationReady === false || controller.ehp <= 0 || controller.movementState === "warping" || controller.supportSystems?.some((system) => system.kind === "web") || !(controller.webStrength && controller.webRange)) continue;
        const target = findById(controller.targetId);
        if (!target || target.simulationReady === false || target.side === controller.side || wargameDistanceKm(controller, target) > controller.webRange) continue;
        const current = webMultiplier.get(target.id) ?? 1;
        webMultiplier.set(target.id, Math.max(.1, current * (1 - Math.max(0, Math.min(.9, controller.webStrength)))));
      }
      for (const controller of next) {
        if (controller.simulationReady === false || controller.ehp <= 0 || controller.movementState === "warping" || controller.supportSystems?.some((system) => system.kind === "tackle") || !(controller.tackleRange && controller.tackleRange > 0)) continue;
        const target=findById(controller.targetId);
        if(!target || target.simulationReady === false || target.side===controller.side || wargameDistanceKm(controller,target)>controller.tackleRange*(controller.burstTackleRangeMultiplier??1)) continue;
        const strength=Math.max(1,liveShipCount(controller));
        target.warpDisruptionStrength=(target.warpDisruptionStrength??0)+strength;
        target.tackleSourceIds=[...new Set([...(target.tackleSourceIds??[]),controller.id])];
      }

      const dynamicInterdictionZones = () => [
        ...scenarioInterdictionZones,
        ...next.filter((source) => source.ehp > 0 && source.movementState !== "warping" && (source.interdictionRadiusKm ?? 0) > 0).map((source) => ({ id: `hic-${source.id}`, label: `${source.name} interdiction field`, x: source.x, y: source.y, radiusKm: Math.max(0, source.interdictionRadiusKm ?? 0), sourceUnitId: source.id })),
      ];
      const zoneAt = (unit: WargameUnit, x: number, y: number) => unit.interdictionNullified ? undefined : dynamicInterdictionZones().find((zone) => Math.hypot(zone.x - x, zone.y - y) * 2.5 <= zone.radiusKm);
      const movementPoint = (unit: WargameUnit) => {
        const target = unit.movementTargetId ? next.find((candidate) => candidate.id === unit.movementTargetId && candidate.ehp > 0 && candidate.movementState !== "warping") : undefined;
        if (target) return { x: target.x, y: target.y, target };
        if (unit.destinationX != null && unit.destinationY != null) return { x: unit.destinationX, y: unit.destinationY, target: undefined };
        return undefined;
      };
      const clearWarpBlock = (unit: WargameUnit) => { unit.warpBlockedReason = undefined; };
      const setWarpBlock = (unit: WargameUnit, reason: string) => { if (unit.warpBlockedReason !== reason) events.push(`${unit.name}: warp blocked - ${reason}.`); unit.warpBlockedReason = reason; };

      next = next.map((unit) => {
        // A fit is required for combat systems, not for navigation. Unfitted hull markers may still
        // execute FC movement/align/warp orders using their real bare-hull navigation profile.
        if (unit.ehp <= 0 || liveShipCount(unit) <= 0) return { ...unit, velocityX: 0, velocityY: 0, effectiveSpeed: 0 };
        if (unit.movementState === "warping") {
          unit.warpRemainingSeconds = Math.max(0, (unit.warpRemainingSeconds ?? 0) - 1);
          unit.velocityX = 0; unit.velocityY = 0; unit.effectiveSpeed = 0;
          if ((unit.warpRemainingSeconds ?? 0) <= 0 && unit.warpDestinationX != null && unit.warpDestinationY != null) {
            unit.x = clampPercent(unit.warpDestinationX); unit.y = clampPercent(unit.warpDestinationY);
            unit.destinationX = undefined; unit.destinationY = undefined;
            unit.movementState = "landed"; unit.movementOrder = "hold";
            unit.alignElapsedSeconds = 0; unit.alignedToTargetId = undefined;
            events.push(`${unit.name}: lands from warp.`);
          }
          return unit;
        }

        const explicit = unit.movementOrder ?? "legacy";
        const point = movementPoint(unit);
        if (explicit === "hold") return { ...unit, movementState: "idle", velocityX: 0, velocityY: 0, effectiveSpeed: 0, destinationX: undefined, destinationY: undefined };

        if (explicit === "align" || explicit === "warp") {
          if (!point) { unit.movementState = "idle"; setWarpBlock(unit, "no navigation target"); return unit; }
          const targetToken = unit.movementTargetId ?? `point:${point.x.toFixed(3)},${point.y.toFixed(3)}`;
          if (unit.alignedToTargetId !== targetToken) {
            unit.alignedToTargetId = targetToken; unit.alignElapsedSeconds = 0; unit.movementState = "aligning"; clearWarpBlock(unit);
            events.push(`${unit.name}: aligning to ${point.target?.name ?? "navigation point"}.`);
          }
          unit.alignElapsedSeconds = Math.min(unit.alignTimeSeconds ?? 6, (unit.alignElapsedSeconds ?? 0) + 1);
          if ((unit.alignElapsedSeconds ?? 0) + 1e-9 >= (unit.alignTimeSeconds ?? 6)) {
            if (unit.movementState !== "aligned") events.push(`${unit.name}: aligned and warp-ready.`);
            unit.movementState = "aligned"; unit.alignedX = point.x; unit.alignedY = point.y;
          }
          unit.velocityX = 0; unit.velocityY = 0; unit.effectiveSpeed = 0;
          if (explicit === "align" || unit.movementState !== "aligned") return unit;

          const distanceKm = Math.hypot(point.x - unit.x, point.y - unit.y) * 2.5;
          const pointStrength = Math.max(0, unit.warpDisruptionStrength ?? 0);
          const coreStrength = Math.max(0, unit.warpCoreStrength ?? 0);
          const startBubble = zoneAt(unit, unit.x, unit.y);
          if (startBubble) { setWarpBlock(unit, `inside ${startBubble.label}`); return unit; }
          if (pointStrength > coreStrength) { setWarpBlock(unit, `warp disruption ${pointStrength.toFixed(0)} > core strength ${coreStrength.toFixed(0)}`); return unit; }
          if (distanceKm < 150) { setWarpBlock(unit, `destination only ${distanceKm.toFixed(0)} km away (150 km minimum)`); return unit; }

          const dx=point.x-unit.x, dy=point.y-unit.y, len=Math.max(.001,Math.hypot(dx,dy));
          const landingRangePct=Math.max(0,Math.min(100,unit.warpRangeKm??0))/2.5;
          let landingX=point.x-(dx/len)*landingRangePct, landingY=point.y-(dy/len)*landingRangePct;
          const destinationBubble=zoneAt(unit, landingX, landingY);
          if(destinationBubble){
            const bubbleDx=destinationBubble.x-unit.x,bubbleDy=destinationBubble.y-unit.y,bubbleLen=Math.max(.001,Math.hypot(bubbleDx,bubbleDy));
            landingX=destinationBubble.x-(bubbleDx/bubbleLen)*(destinationBubble.radiusKm/2.5);
            landingY=destinationBubble.y-(bubbleDy/bubbleLen)*(destinationBubble.radiusKm/2.5);
            events.push(`${unit.name}: warp path caught by ${destinationBubble.label}; landing at interdiction edge.`);
          }
          clearWarpBlock(unit);
          unit.warpDestinationX=clampPercent(landingX); unit.warpDestinationY=clampPercent(landingY);
          unit.warpRemainingSeconds=Math.max(3,Math.min(12,3+distanceKm/Math.max(1,(unit.warpSpeedAuPerSecond??3)*100000)));
          unit.movementState="warping";
          unit.targetId=undefined; unit.repTargetId=undefined;
          unit.lockRemaining=0; unit.lastTargetId=undefined;
          events.push(`${unit.name}: enters warp to ${point.target?.name ?? "navigation point"} at ${Math.round(unit.warpRangeKm??0)} km.`);
          return unit;
        }

        let targetX = unit.destinationX;
        let targetY = unit.destinationY;
        const movementTarget = point?.target;
        const combatTarget = findById(unit.targetId);
        const stance = unit.stance ?? "kite";
        if (explicit !== "legacy") {
          const navTarget = movementTarget ?? combatTarget;
          if (explicit === "disengage") {
            const threat = navTarget ?? next.filter((candidate)=>candidate.side!==unit.side&&candidate.ehp>0&&candidate.movementState!=="warping").sort((a,b)=>wargameDistanceKm(unit,a)-wargameDistanceKm(unit,b))[0];
            if (threat) { const dx=unit.x-threat.x,dy=unit.y-threat.y,len=Math.max(.001,Math.hypot(dx,dy)); targetX=clampPercent(unit.x+(dx/len)*24); targetY=clampPercent(unit.y+(dy/len)*24); }
            unit.movementState="disengaging";
          } else if (movementTarget) {
            const dx=movementTarget.x-unit.x,dy=movementTarget.y-unit.y,len=Math.max(.001,Math.hypot(dx,dy));
            const desired=Math.max(0,unit.movementRangeKm??0)/2.5;
            if (explicit === "approach") { targetX=movementTarget.x; targetY=movementTarget.y; unit.movementState="approaching"; }
            else if (explicit === "anchor") { const r=desired||.8; targetX=movementTarget.x-(dx/len)*r; targetY=movementTarget.y-(dy/len)*r; unit.movementState="anchoring"; }
            else if (explicit === "keep-range") { const r=desired||Math.max(2,unit.range*.8/2.5); targetX=movementTarget.x-(dx/len)*r; targetY=movementTarget.y-(dy/len)*r; unit.movementState="keeping-range"; }
            else if (explicit === "orbit") {
              const r=desired||Math.max(2,unit.range*.55/2.5); const tx=-dy/len,ty=dx/len; const radialError=len-r; targetX=unit.x+(dx/len)*Math.max(-3,Math.min(3,radialError))+tx*Math.min(4,r*.35); targetY=unit.y+(dy/len)*Math.max(-3,Math.min(3,radialError))+ty*Math.min(4,r*.35); unit.movementState="orbiting";
            }
          } else if (point) {
            // A direct map-point order outranks the combat primary. This is the FC's explicit navigation command, not an implicit chase instruction.
            targetX=point.x; targetY=point.y; unit.movementState="approaching";
          } else if (combatTarget && explicit === "approach") { targetX=combatTarget.x; targetY=combatTarget.y; unit.movementState="approaching"; }
        } else if (targetX == null || targetY == null) {
          if (stance === "support" || (unit.repPerSecond ?? 0) > 0) {
            const anchor = next.find((candidate) => candidate.side === unit.side && candidate.ehp > 0 && candidate.id !== unit.id && candidate.movementState !== "warping" && candidate.role.toLowerCase().includes("mainline"));
            if (anchor) {
              const enemies = next.filter((candidate) => candidate.side !== unit.side && candidate.ehp > 0 && candidate.movementState !== "warping");
              const threat = enemies.sort((a, b) => wargameDistanceKm(anchor, a) - wargameDistanceKm(anchor, b))[0];
              if (threat) { const dx=anchor.x-threat.x,dy=anchor.y-threat.y,length=Math.max(.001,Math.hypot(dx,dy)); const trail=Math.min(9,Math.max(5,((unit.repRange??60)*.28)/2.5)); targetX=clampPercent(anchor.x+(dx/length)*trail); targetY=clampPercent(anchor.y+(dy/length)*trail); }
            }
          } else if (combatTarget && combatTarget.side !== unit.side && stance !== "hold") {
            const currentRange=wargameDistanceKm(unit,combatTarget),preferredRange=preferredCombatRange(unit),dx=combatTarget.x-unit.x,dy=combatTarget.y-unit.y,pctDistance=Math.max(.001,Math.hypot(dx,dy));
            if(currentRange>preferredRange+2){const standOffPct=preferredRange/2.5,travelPct=Math.max(0,pctDistance-standOffPct),ratio=travelPct/pctDistance;targetX=unit.x+dx*ratio;targetY=unit.y+dy*ratio;}
            else if(stance==="kite"&&currentRange<preferredRange-5){const escapePct=Math.min(12,(preferredRange-currentRange)/2.5);targetX=clampPercent(unit.x-(dx/pctDistance)*escapePct);targetY=clampPercent(unit.y-(dy/pctDistance)*escapePct);}
          }
        }

        if (targetX == null || targetY == null) return { ...unit, movementState: explicit === "legacy" ? (unit.movementState ?? "idle") : unit.movementState, velocityX: 0, velocityY: 0, effectiveSpeed: 0 };
        const dx=targetX-unit.x,dy=targetY-unit.y,distance=Math.hypot(dx,dy);
        if(distance<.05)return{...unit,x:targetX,y:targetY,destinationX:explicit==="legacy"?undefined:unit.destinationX,destinationY:explicit==="legacy"?undefined:unit.destinationY,velocityX:0,velocityY:0,effectiveSpeed:0};
        const capOperational=!(unit.capacitorCapacity&&(unit.capacitorCurrent??unit.capacitorCapacity)<=Math.max(1,unit.capacitorCapacity*.01));
        const orderedCruise=unit.movementPropulsion==="cruise"; const baseSpeed=Math.max(0,unit.baseSpeed??unit.speed*.35); const rawRequestedSpeed=orderedCruise?baseSpeed:Math.max(0,unit.speed);
        const requestedSpeed=rawRequestedSpeed<=baseSpeed?rawRequestedSpeed:baseSpeed+(rawRequestedSpeed-baseSpeed)*(unit.burstPropulsionSpeedMultiplier??1);
        const propSpeed=unit.scrammed&&unit.propulsionKind==="mwd"?baseSpeed:capOperational?requestedSpeed:baseSpeed; const effectiveSpeed=propSpeed*(webMultiplier.get(unit.id)??1);
        const maxStep=effectiveSpeed/2500,step=Math.min(distance,maxStep),newX=clampPercent(unit.x+(dx/distance)*step),newY=clampPercent(unit.y+(dy/distance)*step);
        const moved={...unit,x:newX,y:newY,velocityX:newX-unit.x,velocityY:newY-unit.y,effectiveSpeed};
        if(explicit==="legacy"&&step>=distance-.001){moved.destinationX=undefined;moved.destinationY=undefined;}
        return moved;
      });

      // Remote-repair modules are independent support channels. An FC can split individual
      // rep systems across different friendly formations; unassigned channels keep auto-logi behaviour.
      const repIntents: Array<{ logi: WargameUnit; targetId: string; targetAlive: number; amount: number; kind: "shield"|"armor"|"generic" }> = [];
      for (const logi of next) {
        if (logi.simulationReady === false || logi.ehp <= 0 || logi.movementState === "warping") continue;
        if (logi.capacitorCapacity && (logi.capacitorCurrent ?? logi.capacitorCapacity) <= Math.max(1, logi.capacitorCapacity * .01)) continue;
        logi.repCooldown = Math.max(0, (logi.repCooldown ?? 0) - 1);
        logi.supportLastTargetIds ??= {};
        logi.supportLockRemaining ??= {};
        const linkedReps=(logi.supportSystems??[]).map((system,index)=>({system,index})).filter(({system})=>system.kind==="remoteShieldRep"||system.kind==="remoteArmorRep");
        if (linkedReps.length) {
          let firstRepTarget: string | undefined;
          for (const {system,index:repIndex} of linkedReps) {
            const key=wargameSupportSystemKey(system,repIndex);
            const hasAssigned=Object.prototype.hasOwnProperty.call(logi.supportTargetIds??{},key);
            let repairTarget=findById(hasAssigned?logi.supportTargetIds?.[key]:undefined);
            const inRange=(candidate:WargameUnit)=>supportEffectiveness(system,wargameDistanceKm(logi,candidate),logi)>.01;
            if (repairTarget && (repairTarget.side!==logi.side || !inRange(repairTarget))) repairTarget=undefined;
            if (!hasAssigned && (!repairTarget || primaryHealthPercent(repairTarget)>=99.9)) {
              const allies=next.filter((candidate)=>candidate.side===logi.side&&candidate.ehp>0&&candidate.id!==logi.id&&primaryHealthPercent(candidate)<99.9&&inRange(candidate));
              allies.sort((a,b)=>primaryHealthPercent(a)-primaryHealthPercent(b)); repairTarget=allies[0];
            }
            if (!repairTarget) continue;
            firstRepTarget ??= repairTarget.id;
            const previous=logi.supportLastTargetIds[key];
            if(previous!==repairTarget.id){
              logi.supportLastTargetIds[key]=repairTarget.id;
              logi.supportLockRemaining[key]=Math.max(0,logi.repLockTime??2.5);
              events.push(logi.name+": "+system.name+" locking "+repairTarget.name+" for reps.");
            } else logi.supportLockRemaining[key]=Math.max(0,(logi.supportLockRemaining[key]??0)-1);
            if((logi.supportLockRemaining[key]??0)>0 || (logi.supportCooldowns?.[key]??0)>0)continue;
            const effectiveness=supportEffectiveness(system,wargameDistanceKm(logi,repairTarget),logi);
            if(effectiveness<=.01)continue;
            const amount=Math.max(0,Number(system.amountPerCycle)||0)*Math.max(1,liveShipCount(logi))*effectiveness;
            repIntents.push({logi,targetId:repairTarget.id,targetAlive:liveShipCount(repairTarget),amount,kind:system.kind==="remoteShieldRep"?"shield":"armor"});
            logi.supportCooldowns??={}; logi.supportCooldowns[key]=Math.max(1,Number(system.cycleSeconds)||1);
          }
          logi.repTargetId=firstRepTarget;
          continue;
        }
        if (!(logi.repPerSecond && logi.repPerSecond > 0)) continue;
        const currentRepTarget=findById(logi.repTargetId);
        const currentValid=currentRepTarget&&currentRepTarget.side===logi.side&&primaryHealthPercent(currentRepTarget)<99.9&&wargameDistanceKm(logi,currentRepTarget)<=(logi.repRange??0);
        if(!currentValid){
          const allies=next.filter((candidate)=>candidate.side===logi.side&&candidate.ehp>0&&candidate.id!==logi.id&&primaryHealthPercent(candidate)<99.9&&wargameDistanceKm(logi,candidate)<=(logi.repRange??0));
          allies.sort((a,b)=>primaryHealthPercent(a)-primaryHealthPercent(b)); const choice=allies[0];
          if(choice?.id!==logi.repTargetId){logi.repTargetId=choice?.id;logi.repLastTargetId=undefined;if(choice)events.push(logi.name+": starts locking "+choice.name+" primary for reps.");}
        }
        const repairTarget=findById(logi.repTargetId); if(!repairTarget){logi.repTargetId=undefined;continue;}
        if(logi.repLastTargetId!==repairTarget.id){logi.repLastTargetId=repairTarget.id;logi.repLockRemaining=logi.repLockTime??2.5;}else logi.repLockRemaining=Math.max(0,(logi.repLockRemaining??0)-1);
        if((logi.repLockRemaining??0)>0||(logi.repCooldown??0)>0)continue;
        const cycle=Math.max(1,logi.repCycle??4),outputScale=liveShipCount(logi)/Math.max(1,logi.count);
        repIntents.push({logi,targetId:repairTarget.id,targetAlive:liveShipCount(repairTarget),amount:logi.repPerSecond*cycle*outputScale,kind:"generic"});logi.repCooldown=cycle;
      }

      // Every fitted damage source owns its own target, cycle and lock state. Guns, missiles and drones may attack different formations simultaneously.
      const volleys: Array<{ attacker: WargameUnit; owner: WargameUnit; sourceId?: string; targetId: string; damage: number }> = [];
      for (const attacker of next) {
        attacker.application = 0;
        attacker.lastVolleyDamage = 0;
        if (attacker.simulationReady === false || attacker.ehp <= 0 || attacker.movementState === "warping" || liveShipCount(attacker) <= 0) continue;
        const sources = attacker.damageSources ?? [];
        if (sources.length) {
          let applicationTotal = 0;
          let applicationWeight = 0;
          for (const source of sources) {
            source.fireCooldown = Math.max(0, (source.fireCooldown ?? 0) - 1);
            const target = findById(source.targetId);
            if (!target || target.simulationReady === false || target.side === attacker.side) {
              source.lastTargetId = undefined;
              source.droneOnTargetId = source.kind === "drone" ? undefined : source.droneOnTargetId;
              continue;
            }
            const rangeKm = wargameDistanceKm(attacker, target);
            const effectiveTargetingRange = (attacker.targetingRange ?? Infinity) * Math.max(.05, attacker.ewarTargetingRangeMultiplier ?? 1);
            const droneAlreadyCommitted = source.kind === "drone" && source.droneOnTargetId === target.id;
            if (source.lastTargetId !== target.id) {
              source.lastTargetId = target.id;
              const scanMultiplier = Math.max(.05, attacker.ewarScanResolutionMultiplier ?? 1);
              source.lockRemaining = (attacker.targetSwitchDelay ?? defaultTargetSwitchDelay(attacker)) / scanMultiplier;
              if (source.kind === "drone") {
                source.droneOnTargetId = undefined;
                source.droneArrivalRemaining = 0;
              }
            } else {
              source.lockRemaining = Math.max(0, (source.lockRemaining ?? 0) - 1);
            }
            const jammedAway = (attacker.jamRemaining ?? 0) > 0 && attacker.jammedBy !== target.id;
            if (jammedAway) continue;
            if (!droneAlreadyCommitted && rangeKm > effectiveTargetingRange) continue;
            if (source.kind === "drone" && !droneAlreadyCommitted && rangeKm > Math.max(.1, source.droneControlRangeKm ?? source.maxRangeKm)) continue;
            if ((source.lockRemaining ?? 0) > 0) continue;

            if (source.kind === "drone") {
              if (source.droneOnTargetId !== target.id) {
                source.droneOnTargetId = target.id;
                const travelDistanceM = Math.max(0, rangeKm * 1000 - Math.max(0, source.droneOrbitRangeKm ?? 0) * 1000);
                source.droneArrivalRemaining = source.sentry ? 0 : travelDistanceM / Math.max(1, source.droneMaximumVelocityMps ?? 1200);
                if ((source.droneArrivalRemaining ?? 0) > 1) events.push(attacker.name + ": " + source.name + " launched toward " + target.name + " (" + Math.ceil(source.droneArrivalRemaining ?? 0) + "s travel).");
              }
              source.droneArrivalRemaining = Math.max(0, (source.droneArrivalRemaining ?? 0) - 1);
              if ((source.droneArrivalRemaining ?? 0) > 0) continue;
            }

            const application = damageSourceApplication(attacker, source, target, rangeKm);
            applicationTotal += application * Math.max(0, source.dpsPerShip);
            applicationWeight += Math.max(0, source.dpsPerShip);
            if ((source.fireCooldown ?? 0) > 0 || application <= 0) continue;
            const cycle = Math.max(.1, source.cycleSeconds || 1);
            const paperVolley = sourcePaperVolley(attacker, source) || sourcePaperDps(attacker, source) * cycle;
            const volley = paperVolley * application;
            if (volley <= 0) continue;
            const syntheticAttacker = damageSourceAsAttacker(attacker, source);
            syntheticAttacker.name = attacker.name + " / " + source.name;
            source.lastVolleyDamage = volley;
            source.fireCooldown = cycle;
            attacker.lastVolleyDamage = (attacker.lastVolleyDamage ?? 0) + volley;
            volleys.push({ attacker: syntheticAttacker, owner: attacker, sourceId: source.id, targetId: target.id, damage: volley });
          }
          attacker.application = applicationWeight > 0 ? applicationTotal / applicationWeight : 0;
          continue;
        }

        // Scenario-only formations without a linked fit keep the legacy single damage channel.
        attacker.fireCooldown = Math.max(0, (attacker.fireCooldown ?? 0) - 1);
        if (attacker.dps <= 0) continue;
        const target = findById(attacker.targetId);
        if (!target || target.simulationReady === false || target.side === attacker.side) { attacker.lastTargetId = undefined; continue; }
        if (attacker.lastTargetId !== target.id) {
          attacker.lastTargetId = target.id;
          const scanMultiplier = Math.max(.05, attacker.ewarScanResolutionMultiplier ?? 1);
          attacker.lockRemaining = (attacker.targetSwitchDelay ?? defaultTargetSwitchDelay(attacker)) / scanMultiplier;
        } else {
          attacker.lockRemaining = Math.max(0, (attacker.lockRemaining ?? 0) - 1);
        }
        const rangeKm = wargameDistanceKm(attacker, target);
        const effectiveTargetingRange = (attacker.targetingRange ?? Infinity) * Math.max(.05, attacker.ewarTargetingRangeMultiplier ?? 1);
        const jammedAway = (attacker.jamRemaining ?? 0) > 0 && attacker.jammedBy !== target.id;
        const capStarved = Boolean(attacker.capacitorCapacity && (attacker.capacitorCurrent ?? attacker.capacitorCapacity) <= Math.max(1, attacker.capacitorCapacity * .01));
        const application = rangeKm <= effectiveTargetingRange && !jammedAway && !capStarved ? weaponApplication(attacker, target, rangeKm) : 0;
        attacker.application = application;
        const effectiveWeaponRange = (attacker.weaponModel ?? "turret") === "turret" ? Math.max(1,(attacker.optimalRange ?? attacker.range*.62)*(attacker.ewarOptimalMultiplier??1)+(attacker.falloffRange ?? Math.max(4,attacker.range-(attacker.optimalRange??attacker.range*.62)))*(attacker.ewarFalloffMultiplier??1)*2) : attacker.range;
        if ((attacker.lockRemaining ?? 0) > 0 || (attacker.fireCooldown ?? 0) > 0 || application <= 0 || rangeKm > effectiveWeaponRange) continue;
        const cycle = Math.max(1, attacker.weaponCycle ?? defaultWeaponCycle(attacker));
        const strength = liveShipCount(attacker) / Math.max(1, attacker.count);
        const paperVolley = attacker.volleyPerShip && attacker.volleyPerShip > 0 ? attacker.volleyPerShip * liveShipCount(attacker) : attacker.dps * cycle * strength;
        const volley = paperVolley * application;
        if (volley <= 0) continue;
        attacker.lastVolleyDamage = volley;
        attacker.fireCooldown = cycle;
        volleys.push({ attacker, owner: attacker, targetId: target.id, damage: volley });
      }

      // Sources landing in the same second all hit the same current primary. Once that primary dies, later same-tick damage is overkill and cannot spill to the replacement ship.
      const volleyGroups = new Map<string, typeof volleys>();
      for (const volley of volleys) {
        const group = volleyGroups.get(volley.targetId) ?? [];
        group.push(volley);
        volleyGroups.set(volley.targetId, group);
      }
      for (const [targetId, group] of volleyGroups) {
        const target = findById(targetId);
        if (!target) continue;
        const primaryGeneration = liveShipCount(target);
        for (const volley of group) {
          if (liveShipCount(target) !== primaryGeneration || target.ehp <= 0) break;
          damageOccurred = true;
          applyVolleyToPrimary(target, volley.damage, volley.attacker);
        }
      }

      // A rep cycle that was aimed at a primary destroyed by the volley lands too late; it never resurrects or spills.
      for (const intent of repIntents) {
        const target = findById(intent.targetId);
        if (!target) continue;
        if (liveShipCount(target) !== intent.targetAlive) {
          events.push(`${intent.logi.name}: reps land too late - ${target.name} primary was already destroyed.`);
          continue;
        }
        applyRepToPrimary(target, intent.amount, intent.kind);
      }
    }

  const hasOffensiveCapability = (side: WargameSide) => next.some((unit) => {
    if (unit.side !== side || unit.simulationReady === false || unit.ehp <= 0 || liveShipCount(unit) <= 0) return false;
    if ((unit.damageSources ?? []).some((source) => source.dpsPerShip > 0)) return true;
    return unit.dps > 0;
  });
  const blueEffective = hasOffensiveCapability("blue");
  const redEffective = hasOffensiveCapability("red");
  const blueConfigured = next.some((unit) => unit.side === "blue" && unit.simulationReady !== false && unit.ehp > 0 && liveShipCount(unit) > 0);
  const redConfigured = next.some((unit) => unit.side === "red" && unit.simulationReady !== false && unit.ehp > 0 && liveShipCount(unit) > 0);
  const combatResolved = blueConfigured && redConfigured && (!blueEffective || !redEffective);
  const outcome = !combatResolved ? null : !blueEffective && !redEffective ? "draw" : blueEffective ? "blue" : "red";
  if (combatResolved) events.push(outcome === "draw" ? "Both forces combat-ineffective - resolution." : outcome === "blue" ? "Red force combat-ineffective - Blue holds the field." : "Blue force combat-ineffective - Red holds the field.");

  const classifyEvent = (message: string): WargameEngineEventKind => {
    if (message.startsWith("RED AI:")) return "ai";
    if (/enters warp|lands from warp|warp blocked|aligning|aligned|interdiction/i.test(message)) return "warp";
    if (/ECM|scram|web|neut|damp|paint|tracking|warp disruption/i.test(message)) return "ewar";
    if (/rep|repair/i.test(message)) return "repair";
    if (/volley|destroy|Weapons in range/i.test(message)) return "damage";
    if (/order|executing|chain|branch/i.test(message)) return "order";
    if (/combat-ineffective|holds the field|resolution/i.test(message)) return "resolution";
    return "combat";
  };
  const structuredEvents: WargameEngineEvent[] = events.map((message, index) => ({ id: `evt-${elapsed + stepSeconds}-${index}-${rngSeed.toString(16)}`, at: elapsed + stepSeconds, kind: classifyEvent(message), message }));
  return { units: next, elapsedSeconds: elapsed + stepSeconds, events: structuredEvents, damageOccurred, combatResolved, outcome, rngSeed };
}
