import type { WargameSide, WargameUnit } from "./wargame-types";

export type WargameObservationOptions = {
  visibleEnemyIds?: ReadonlySet<string>;
};

function cloneOwnUnit(unit: WargameUnit): WargameUnit {
  return {
    ...unit,
    damageSources: unit.damageSources?.map((source) => ({ ...source, damageProfile: { ...source.damageProfile } })),
    supportSystems: unit.supportSystems?.map((system) => ({ ...system, buffs: system.buffs?.map((buff) => ({ ...buff })) })),
    supportCooldowns: { ...(unit.supportCooldowns ?? {}) },
    supportTargetIds: { ...(unit.supportTargetIds ?? {}) },
    supportLastTargetIds: { ...(unit.supportLastTargetIds ?? {}) },
    supportLockRemaining: { ...(unit.supportLockRemaining ?? {}) },
    orderChain: unit.orderChain?.map((step) => ({
      ...step,
      sourceTargets: { ...step.sourceTargets },
      supportTargets: { ...(step.supportTargets ?? {}) },
      startWhen: step.startWhen ? { ...step.startWhen } : undefined,
      completeWhen: step.completeWhen ? { ...step.completeWhen } : undefined,
      branchWhen: step.branchWhen ? { ...step.branchWhen } : undefined,
    })),
  };
}

function observedEnemy(unit: WargameUnit): WargameUnit {
  // This is deliberately a lossy projection. Even while every formation is currently
  // considered visible, controllers never receive Blue/Red hidden orders or exact private state.
  return {
    id: unit.id,
    name: unit.name,
    typeId: unit.typeId,
    side: unit.side,
    count: unit.count,
    shipsAlive: unit.shipsAlive,
    x: unit.x,
    y: unit.y,
    dps: unit.dps,
    ehp: unit.ehp,
    maxEhp: unit.maxEhp,
    speed: unit.speed,
    effectiveSpeed: unit.effectiveSpeed,
    range: unit.range,
    em: unit.em,
    therm: unit.therm,
    kin: unit.kin,
    exp: unit.exp,
    role: unit.role,
    weaponModel: unit.weaponModel,
    signature: unit.signature,
    tracking: unit.tracking,
    repPerSecond: unit.repPerSecond,
    repRange: unit.repRange,
    webStrength: unit.webStrength,
    webRange: unit.webRange,
    tackleRange: unit.tackleRange,
    stance: unit.stance,
    velocityX: unit.velocityX,
    velocityY: unit.velocityY,
    application: unit.application,
    primaryEhp: unit.primaryEhp,
    primaryShieldHp: unit.primaryShieldHp,
    primaryArmorHp: unit.primaryArmorHp,
    primaryStructureHp: unit.primaryStructureHp,
    shieldHp: unit.shieldHp,
    armorHp: unit.armorHp,
    structureHp: unit.structureHp,
    shieldResists: unit.shieldResists ? [...unit.shieldResists] as [number,number,number,number] : undefined,
    armorResists: unit.armorResists ? [...unit.armorResists] as [number,number,number,number] : undefined,
    hullResists: unit.hullResists ? [...unit.hullResists] as [number,number,number,number] : undefined,
    targetingRange: unit.targetingRange,
    scanResolution: unit.scanResolution,
    sensorStrength: unit.sensorStrength,
    ewarSignatureMultiplier: unit.ewarSignatureMultiplier,
    ewarTrackingMultiplier: unit.ewarTrackingMultiplier,
    ewarOptimalMultiplier: unit.ewarOptimalMultiplier,
    ewarFalloffMultiplier: unit.ewarFalloffMultiplier,
    ewarTargetingRangeMultiplier: unit.ewarTargetingRangeMultiplier,
    ewarScanResolutionMultiplier: unit.ewarScanResolutionMultiplier,
    jamRemaining: unit.jamRemaining,
    jammedBy: unit.jammedBy,
    scrammed: unit.scrammed,
    neutPressureGjPerSecond: unit.neutPressureGjPerSecond,
    movementState: unit.movementState,
    warpDisruptionStrength: unit.warpDisruptionStrength,
    warpCoreStrength: unit.warpCoreStrength,
    tackleSourceIds: unit.tackleSourceIds ? [...unit.tackleSourceIds] : undefined,
  };
}

export function getWargameObservation(side: WargameSide, units: WargameUnit[], options: WargameObservationOptions = {}): WargameUnit[] {
  const visibleEnemyIds = options.visibleEnemyIds;
  return units.flatMap((unit) => {
    if (unit.side === side) return [cloneOwnUnit(unit)];
    if (visibleEnemyIds && !visibleEnemyIds.has(unit.id)) return [];
    return [observedEnemy(unit)];
  });
}
