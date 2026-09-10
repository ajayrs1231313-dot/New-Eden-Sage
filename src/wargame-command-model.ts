export type WargameDamageKind = "turret" | "missile" | "drone";

export type WargameDamageProfile = {
  em: number;
  thermal: number;
  kinetic: number;
  explosive: number;
};

export type WargameDamageSource = {
  id: string;
  name: string;
  kind: WargameDamageKind;
  dpsPerShip: number;
  volleyPerShip: number;
  cycleSeconds: number;
  maxRangeKm: number;
  optimalKm?: number;
  falloffKm?: number;
  tracking?: number;
  signatureResolutionM?: number;
  explosionRadiusM?: number;
  explosionVelocityMps?: number;
  damageReductionFactor?: number;
  droneMaximumVelocityMps?: number;
  droneControlRangeKm?: number;
  droneOrbitVelocityMps?: number;
  droneOrbitRangeKm?: number;
  sentry?: boolean;
  damageProfile: WargameDamageProfile;
  targetId?: string;
  fireCooldown?: number;
  lockRemaining?: number;
  lastTargetId?: string;
  droneOnTargetId?: string;
  droneArrivalRemaining?: number;
  lastVolleyDamage?: number;
};

export type WargameOrderTrigger = "immediate" | "target-destroyed" | "after-seconds";
export type WargameOrderCompletion = "target-destroyed" | "arrived" | "after-seconds" | "manual";
export type WargamePropulsionOrder = "cruise" | "prop-on";
export type WargameMovementOrder = "legacy" | "approach" | "orbit" | "keep-range" | "anchor" | "align" | "warp" | "disengage" | "hold";
export type WargameOrderConditionKind = "always" | "target-destroyed" | "target-health-below" | "target-ships-below" | "range-below" | "range-above" | "target-scrammed" | "target-warp-disrupted" | "target-warping" | "target-jammed" | "self-health-below" | "self-cap-below" | "after-seconds" | "arrived" | "self-aligned" | "self-warped" | "manual";
export type WargameOrderCondition = {
  kind: WargameOrderConditionKind;
  targetId?: string;
  threshold?: number;
  seconds?: number;
};

export type WargameOrderStep = {
  id: string;
  label: string;
  trigger: WargameOrderTrigger;
  triggerTargetId?: string;
  triggerSeconds?: number;
  sourceTargets: Record<string, string | undefined>;
  supportTargets?: Record<string, string | undefined>;
  tackleTargetId?: string;
  repTargetId?: string;
  moveTargetId?: string;
  moveTerrainId?: string;
  moveX?: number;
  moveY?: number;
  movement?: WargameMovementOrder;
  movementRangeKm?: number;
  warpRangeKm?: number;
  propulsion?: WargamePropulsionOrder;
  stance?: "brawl" | "pursue" | "kite" | "screen" | "support" | "hold";
  completion: WargameOrderCompletion;
  completionTargetId?: string;
  completionSeconds?: number;
  startWhen?: WargameOrderCondition;
  completeWhen?: WargameOrderCondition;
  branchWhen?: WargameOrderCondition;
  nextStepId?: string;
  elseStepId?: string;
  startedAt?: number;
};

export type WargameSystemEffect = {
  typeId: number;
  name: string;
};

export const COMMON_WARGAME_SYSTEM_EFFECTS: WargameSystemEffect[] = [
  { typeId: 30844, name: "Class 1 Pulsar Effects" },
  { typeId: 30865, name: "Class 2 Pulsar Effects" },
  { typeId: 30866, name: "Class 3 Pulsar Effects" },
  { typeId: 30867, name: "Class 4 Pulsar Effects" },
  { typeId: 30868, name: "Class 5 Pulsar Effects" },
  { typeId: 30869, name: "Class 6 Pulsar Effects" },
  { typeId: 30847, name: "Class 1 Magnetar Effects" },
  { typeId: 30860, name: "Class 2 Magnetar Effects" },
  { typeId: 30861, name: "Class 3 Magnetar Effects" },
  { typeId: 30862, name: "Class 4 Magnetar Effects" },
  { typeId: 30863, name: "Class 5 Magnetar Effects" },
  { typeId: 30864, name: "Class 6 Magnetar Effects" },
  { typeId: 30845, name: "Class 1 Black Hole Effects" },
  { typeId: 30850, name: "Class 2 Black Hole Effects" },
  { typeId: 30851, name: "Class 3 Black Hole Effects" },
  { typeId: 30852, name: "Class 4 Black Hole Effects" },
  { typeId: 30853, name: "Class 5 Black Hole Effects" },
  { typeId: 30854, name: "Class 6 Black Hole Effects" },
  { typeId: 30846, name: "Class 1 Cataclysmic Variable Effects" },
  { typeId: 30880, name: "Class 2 Cataclysmic Variable Effects" },
  { typeId: 30881, name: "Class 3 Cataclysmic Variable Effects" },
  { typeId: 30884, name: "Class 4 Cataclysmic Variable Effects" },
  { typeId: 30883, name: "Class 5 Cataclysmic Variable Effects" },
  { typeId: 30882, name: "Class 6 Cataclysmic Variable Effects" },
  { typeId: 30848, name: "Class 1 Red Giant Effects" },
  { typeId: 30870, name: "Class 2 Red Giant Effects" },
  { typeId: 30871, name: "Class 3 Red Giant Effects" },
  { typeId: 30872, name: "Class 4 Red Giant Effects" },
  { typeId: 30873, name: "Class 5 Red Giant Effects" },
  { typeId: 30874, name: "Class 6 Red Giant Effects" },
  { typeId: 30849, name: "Class 1 Wolf Rayet Effects" },
  { typeId: 30875, name: "Class 2 Wolf Rayet Effects" },
  { typeId: 30876, name: "Class 3 Wolf Rayet Effects" },
  { typeId: 30877, name: "Class 4 Wolf Rayet Effects" },
  { typeId: 30878, name: "Class 5 Wolf Rayet Effects" },
  { typeId: 30879, name: "Class 6 Wolf Rayet Effects" },
  { typeId: 3069, name: "Sansha Incursion Vanguard System Effects" },
  { typeId: 3493, name: "Sansha Incursion Assault System Effects" },
  { typeId: 3494, name: "Sansha Incursion HQ System Effects" },
];

export function cloneDamageSources(sources: WargameDamageSource[] | undefined) {
  return (sources ?? []).map((source) => ({ ...source, damageProfile: { ...source.damageProfile } }));
}

export function cloneOrderChain(chain: WargameOrderStep[] | undefined) {
  return (chain ?? []).map((step) => ({
    ...step,
    sourceTargets: { ...step.sourceTargets },
    supportTargets: { ...(step.supportTargets ?? {}) },
    startWhen: step.startWhen ? { ...step.startWhen } : undefined,
    completeWhen: step.completeWhen ? { ...step.completeWhen } : undefined,
    branchWhen: step.branchWhen ? { ...step.branchWhen } : undefined,
  }));
}
