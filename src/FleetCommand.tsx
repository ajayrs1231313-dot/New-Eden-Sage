import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent } from "react";
import { OnTheFlyJumpMap } from "./OnTheFlyJumpMap";
import type { NavigationCharacterLocation, NavigationSystem } from "./types";
import "./navigation-command.css";
import { CorporationDoctrines, PENDING_DOCTRINE_FIT_KEY } from "./CorporationDoctrines";
import { analyzeWargameFit, type WargameSupportSystem } from "./wargame-fit-bridge";

type FleetCorporation = {
  characterId: string;
  characterName: string;
  corporationId: number;
  name: string;
  snapshot: any;
  data: any;
};

type FleetCommandTab = "doctrines" | "jump-map" | "wargame";
type WargamePhase = 0 | 1 | 2 | 3;
type WargameSide = "blue" | "red";
type WargameAssetTab = "ships" | "terrain" | "fleets";
type WargameOrderMode = "move" | "engage" | null;
type WargameWeaponModel = "turret" | "missile" | "drone" | "support";
type WargameStance = "brawl" | "pursue" | "kite" | "screen" | "support" | "hold";

type ShipChoice = {
  typeId: number;
  name: string;
  groupId: number;
  groupName: string;
  factionId?: number;
  factionName?: string;
};

type WargameUnit = {
  id: string;
  name: string;
  typeId?: number;
  side: WargameSide;
  count: number;
  x: number;
  y: number;
  dps: number;
  ehp: number;
  speed: number;
  range: number;
  em: number;
  therm: number;
  kin: number;
  exp: number;
  role: string;
  targetId?: string;
  maxEhp?: number;
  destinationX?: number;
  destinationY?: number;
  weaponModel?: WargameWeaponModel;
  signature?: number;
  tracking?: number;
  repPerSecond?: number;
  repRange?: number;
  webStrength?: number;
  webRange?: number;
  tackleRange?: number;
  stance?: WargameStance;
  velocityX?: number;
  velocityY?: number;
  effectiveSpeed?: number;
  application?: number;
  repTargetId?: string;
  shipsAlive?: number;
  primaryEhp?: number;
  primaryShieldHp?: number;
  primaryArmorHp?: number;
  primaryStructureHp?: number;
  weaponCycle?: number;
  fireCooldown?: number;
  targetSwitchDelay?: number;
  lockRemaining?: number;
  lastTargetId?: string;
  repCycle?: number;
  repCooldown?: number;
  repLockTime?: number;
  repLockRemaining?: number;
  repLastTargetId?: string;
  lastVolleyDamage?: number;
  volleyPerShip?: number;
  optimalRange?: number;
  falloffRange?: number;
  signatureResolution?: number;
  explosionRadius?: number;
  explosionVelocity?: number;
  damageReductionFactor?: number;
  damageEm?: number;
  damageTherm?: number;
  damageKin?: number;
  damageExp?: number;
  shieldHp?: number;
  armorHp?: number;
  structureHp?: number;
  shieldResists?: [number, number, number, number];
  armorResists?: [number, number, number, number];
  hullResists?: [number, number, number, number];
  fitName?: string;
  fitCharacter?: string;
  fitSourceSummary?: string;
  supportSystems?: WargameSupportSystem[];
  capacitorCapacity?: number;
  capacitorCurrent?: number;
  capacitorRechargeSeconds?: number;
  capacitorDemandGjPerSecond?: number;
  capacitorInjectedGjPerSecond?: number;
  baseSpeed?: number;
  propulsionKind?: "ab" | "mwd";
  targetingRange?: number;
  scanResolution?: number;
  sensorStrength?: number;
  ewarSignatureMultiplier?: number;
  ewarTrackingMultiplier?: number;
  ewarOptimalMultiplier?: number;
  ewarFalloffMultiplier?: number;
  ewarTargetingRangeMultiplier?: number;
  ewarScanResolutionMultiplier?: number;
  jamRemaining?: number;
  jammedBy?: string;
  scrammed?: boolean;
  neutPressureGjPerSecond?: number;
  supportCooldowns?: Record<string, number>;
};

type WargameTerrain = {
  id: string;
  kind: string;
  label: string;
  glyph: string;
  x: number;
  y: number;
};

type WargameMovePreview = { unitId: string; x: number; y: number } | null;

const PHASES = [
  { short: "DEPLOYMENT", title: "Deployment / Initial Situation", detail: "Place forces, terrain, objectives and known intelligence." },
  { short: "FIRST CONTACT", title: "First Contact", detail: "Initial detection, positioning, tackle, attack and defence orders." },
  { short: "ENGAGEMENT", title: "Main Engagement", detail: "Advance time, resolve manoeuvre, application, EWAR, logistics and losses." },
  { short: "RESOLUTION", title: "Resolution / Withdrawal", detail: "Retreat, pursuit, extraction, objectives, victory state and after-action review." },
] as const;

const TERRAIN_ASSETS = [
  { kind: "stargate", label: "Stargate", glyph: "◇" },
  { kind: "station", label: "NPC Station", glyph: "▰" },
  { kind: "upwell", label: "Upwell Structure", glyph: "⬡" },
  { kind: "planet", label: "Planet", glyph: "●" },
  { kind: "moon", label: "Moon", glyph: "○" },
  { kind: "belt", label: "Asteroid Belt", glyph: "⋯" },
  { kind: "anomaly", label: "Anomaly", glyph: "⌁" },
  { kind: "hideout", label: "Hideout / Safe", glyph: "△" },
  { kind: "wormhole", label: "Wormhole", glyph: "◉" },
  { kind: "beacon", label: "Beacon / Objective", glyph: "✦" },
] as const;

const INITIAL_UNITS: WargameUnit[] = [
  { id: "blue-hurricanes", name: "Hurricane Fleet Issue", typeId: 33151, side: "blue", count: 30, x: 31, y: 61, dps: 22500, ehp: 1950000, maxEhp: 1950000, speed: 1680, range: 62, em: 69, therm: 65, kin: 72, exp: 78, role: "Mainline / artillery", targetId: "red-ferox", weaponModel: "turret", signature: 250, tracking: .035, stance: "pursue" },
  { id: "blue-logi", name: "Scimitar", typeId: 11978, side: "blue", count: 6, x: 23, y: 72, dps: 0, ehp: 330000, maxEhp: 330000, speed: 2200, range: 70, em: 72, therm: 79, kin: 86, exp: 75, role: "Logistics wing", weaponModel: "support", signature: 95, repPerSecond: 4800, repRange: 68, stance: "support" },
  { id: "blue-tackle", name: "Stiletto", typeId: 11198, side: "blue", count: 4, x: 39, y: 47, dps: 420, ehp: 56000, maxEhp: 56000, speed: 5100, range: 28, em: 55, therm: 60, kin: 68, exp: 72, role: "Tackle / screen", targetId: "red-control", weaponModel: "turret", signature: 42, tracking: .12, tackleRange: 28, stance: "screen" },
  { id: "red-ferox", name: "Ferox Navy Issue", typeId: 72811, side: "red", count: 30, x: 70, y: 39, dps: 22500, ehp: 2040000, maxEhp: 2040000, speed: 1420, range: 76, em: 72, therm: 68, kin: 75, exp: 81, role: "Hostile mainline", targetId: "blue-hurricanes", weaponModel: "turret", signature: 300, tracking: .032, stance: "kite" },
  { id: "red-logi", name: "Scimitar", typeId: 11978, side: "red", count: 6, x: 78, y: 30, dps: 0, ehp: 330000, maxEhp: 330000, speed: 2150, range: 70, em: 72, therm: 79, kin: 86, exp: 75, role: "Hostile logistics", weaponModel: "support", signature: 95, repPerSecond: 4800, repRange: 68, stance: "support" },
  { id: "red-control", name: "Huginn", typeId: 11961, side: "red", count: 2, x: 64, y: 54, dps: 650, ehp: 118000, maxEhp: 118000, speed: 1850, range: 58, em: 66, therm: 72, kin: 79, exp: 73, role: "Web / control", targetId: "blue-logi", weaponModel: "missile", signature: 180, webStrength: .6, webRange: 42, stance: "screen" },
];

const INITIAL_TERRAIN: WargameTerrain[] = [
  { id: "terrain-gate", kind: "stargate", label: "Outbound Gate", glyph: "◇", x: 50, y: 50 },
  { id: "terrain-moon", kind: "moon", label: "Moon 7", glyph: "○", x: 83, y: 79 },
  { id: "terrain-belt", kind: "belt", label: "Asteroid Belt", glyph: "⋯", x: 17, y: 24 },
  { id: "terrain-upwell", kind: "upwell", label: "Friendly Fortizar", glyph: "⬡", x: 15, y: 83 },
];

function clampPercent(value: number) {
  return Math.max(2, Math.min(98, value));
}

function imageUrl(typeId: number) {
  return `https://images.evetech.net/types/${typeId}/render?size=128`;
}

function wargameDistanceKm(a: Pick<WargameUnit, "x" | "y">, b: Pick<WargameUnit, "x" | "y">) {
  return Math.hypot(a.x - b.x, a.y - b.y) * 2.5;
}

function healthPercent(unit: WargameUnit) {
  const maximum = Math.max(1, unit.maxEhp ?? unit.ehp);
  return Math.max(0, Math.min(100, (unit.ehp / maximum) * 100));
}

function liveShipCount(unit: WargameUnit) {
  if (unit.ehp <= 0) return 0;
  if (unit.shipsAlive != null) return Math.max(0, Math.min(unit.count, Math.floor(unit.shipsAlive)));
  return Math.max(1, Math.ceil(unit.count * (healthPercent(unit) / 100)));
}

function perShipEhp(unit: WargameUnit) {
  return Math.max(1, (unit.maxEhp ?? unit.ehp) / Math.max(1, unit.count));
}

function primaryEhp(unit: WargameUnit) {
  if (liveShipCount(unit) <= 0) return 0;
  return Math.max(0, Math.min(perShipEhp(unit), unit.primaryEhp ?? perShipEhp(unit)));
}

function primaryHealthPercent(unit: WargameUnit) {
  return liveShipCount(unit) > 0 ? (primaryEhp(unit) / perShipEhp(unit)) * 100 : 0;
}

function defaultWeaponCycle(unit: WargameUnit) {
  const name = unit.name.toLowerCase();
  const role = unit.role.toLowerCase();
  if ((unit.weaponModel ?? "turret") === "support") return 0;
  if (name.includes("hurricane") && role.includes("artillery")) return 8.5;
  if (name.includes("ferox")) return 5.2;
  if ((unit.weaponModel ?? "turret") === "missile") return 6;
  if (role.includes("tackle") || role.includes("interceptor")) return 3;
  return 5;
}

function defaultTargetSwitchDelay(unit: WargameUnit) {
  const role = unit.role.toLowerCase();
  if (role.includes("tackle") || role.includes("interceptor")) return 1.2;
  if (unit.name.toLowerCase().includes("hurricane")) return 2.8;
  return 2.2;
}

function prepareWargameUnit(unit: WargameUnit): WargameUnit {
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
    scrammed: false,
    neutPressureGjPerSecond: 0,
    supportCooldowns: { ...(unit.supportCooldowns ?? {}) },
  };
}

function velocityMps(unit: WargameUnit) {
  return Math.hypot(unit.velocityX ?? 0, unit.velocityY ?? 0) * 2500;
}

function relativeVelocityMps(a: WargameUnit, b: WargameUnit) {
  return Math.hypot((a.velocityX ?? 0) - (b.velocityX ?? 0), (a.velocityY ?? 0) - (b.velocityY ?? 0)) * 2500;
}

function rangeRateMps(a: WargameUnit, b: WargameUnit) {
  const dx = (b.x - a.x) * 2500;
  const dy = (b.y - a.y) * 2500;
  const distance = Math.max(1, Math.hypot(dx, dy));
  const rvx = ((b.velocityX ?? 0) - (a.velocityX ?? 0)) * 2500;
  const rvy = ((b.velocityY ?? 0) - (a.velocityY ?? 0)) * 2500;
  return (dx * rvx + dy * rvy) / distance;
}

function preferredCombatRange(unit: WargameUnit) {
  const stance = unit.stance ?? "kite";
  if (stance === "brawl") return Math.max(5, unit.range * .35);
  if (stance === "pursue") return Math.max(5, unit.range * .55);
  if (stance === "screen") return Math.max(8, unit.range * .58);
  if (stance === "hold") return Math.max(5, unit.range * .72);
  return Math.max(8, unit.range * .82);
}

function weaponApplication(attacker: WargameUnit, target: WargameUnit, rangeKm = wargameDistanceKm(attacker, target)) {
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

function unitDamageProfile(unit: WargameUnit) {
  const values = [unit.damageEm ?? .25, unit.damageTherm ?? .25, unit.damageKin ?? .25, unit.damageExp ?? .25];
  const total = Math.max(1e-12, values.reduce((sum, value) => sum + Math.max(0, value), 0));
  return values.map((value) => Math.max(0, value) / total) as [number, number, number, number];
}

function profileEhpPerShip(unit: WargameUnit, profile: [number, number, number, number]) {
  if (unit.shieldHp == null || unit.armorHp == null || unit.structureHp == null || !unit.shieldResists || !unit.armorResists || !unit.hullResists) return perShipEhp(unit);
  const layer = (hp: number, resists: [number, number, number, number]) => {
    const fraction = profile.reduce((sum, weight, index) => sum + weight * (1 - (resists[index] ?? 0)), 0);
    return Math.max(0, hp) / Math.max(1e-12, fraction);
  };
  return layer(unit.shieldHp, unit.shieldResists) + layer(unit.armorHp, unit.armorResists) + layer(unit.structureHp, unit.hullResists);
}

function resistanceScale(attacker: WargameUnit, target: WargameUnit) {
  if (!target.shieldResists || !target.armorResists || !target.hullResists) return 1;
  const omni = profileEhpPerShip(target, [.25, .25, .25, .25]);
  const against = profileEhpPerShip(target, unitDamageProfile(attacker));
  return against > 0 ? Math.max(.1, Math.min(3, omni / against)) : 1;
}

function supportSystemDetail(system: WargameSupportSystem) {
  const range = Math.max(0, Number(system.optimalM) || 0) / 1000;
  const falloff = Math.max(0, Number(system.falloffM) || 0) / 1000;
  const envelope = falloff > 0 ? `${range.toFixed(1)} + ${falloff.toFixed(1)} km` : `${range.toFixed(1)} km`;
  if (system.kind === "remoteShieldRep" || system.kind === "remoteArmorRep") return `${Math.round(Number(system.perSecond) || 0).toLocaleString()} HP/s · ${Number(system.cycleSeconds || 0).toFixed(1)}s · ${envelope}`;
  if (system.kind === "web") return `${Math.round((Number(system.strength) || 0) * 100)}% web · ${envelope}`;
  if (system.kind === "tackle") return `${system.mwdShutdown ? "scram / MWD shutdown" : "warp disrupt"} · strength ${Number(system.warpStrength) || 0} · ${envelope}`;
  if (system.kind === "targetPainter") return `+${Math.round((Number(system.signatureBonus) || 0) * 100)}% signature · ${envelope}`;
  if (system.kind === "sensorDamp") return `${Math.round((Number(system.maxTargetRangeBonus) || 0) * 100)}% target range · ${Math.round((Number(system.scanResolutionBonus) || 0) * 100)}% scan res · ${envelope}`;
  if (system.kind === "trackingDisruptor") return `${Math.round((Number(system.trackingBonus) || 0) * 100)}% tracking · ${Math.round((Number(system.optimalBonus) || 0) * 100)}% optimal · ${Math.round((Number(system.falloffBonus) || 0) * 100)}% falloff · ${envelope}`;
  if (system.kind === "ecm") return `${(Number(system.strength) || 0).toFixed(2)} jam strength · ${Number(system.cycleSeconds || 0).toFixed(1)}s · ${envelope}`;
  if (system.kind === "energyNeutralizer") return `${Math.round(Number(system.amountPerCycle) || 0)} GJ/cycle · ${(Number(system.perSecond) || 0).toFixed(1)} GJ/s · ${envelope}`;
  if (system.kind === "energyNosferatu") return `${Math.round(Number(system.amountPerCycle) || 0)} GJ/cycle NOS · ${envelope}`;
  if (system.kind === "remoteCapacitor") return `${Math.round(Number(system.amountPerCycle) || 0)} GJ/cycle transfer · ${envelope}`;
  if (system.kind === "remoteSensorBooster") return `+${Math.round((Number(system.maxTargetRangeBonus) || 0) * 100)}% range · +${Math.round((Number(system.scanResolutionBonus) || 0) * 100)}% scan res · ${envelope}`;
  if (system.kind === "remoteTrackingComputer") return `+${Math.round((Number(system.trackingBonus) || 0) * 100)}% tracking · +${Math.round((Number(system.optimalBonus) || 0) * 100)}% optimal · ${envelope}`;
  if (system.kind === "commandBurst") return `command burst · ${envelope}`;
  return envelope;
}

function tacticalProfileForGroup(groupName: string): Pick<WargameUnit, "weaponModel" | "signature" | "tracking" | "stance"> {
  const value = groupName.toLowerCase();
  if (value.includes("logistics")) return { weaponModel: "support", signature: 95, tracking: 0, stance: "support" };
  if (value.includes("interceptor") || value.includes("frigate")) return { weaponModel: "turret", signature: 45, tracking: .11, stance: "screen" };
  if (value.includes("missile")) return { weaponModel: "missile", signature: 150, tracking: 0, stance: "kite" };
  return { weaponModel: "turret", signature: 180, tracking: .045, stance: "kite" };
}

function WargameMap({ corporation, onNavigate }: { corporation: FleetCorporation; onNavigate(tab: FleetCommandTab): void }) {
  const [phase, setPhase] = useState<WargamePhase>(0);
  const [assetTab, setAssetTab] = useState<WargameAssetTab>("ships");
  const [deploymentSide, setDeploymentSide] = useState<WargameSide>("blue");
  const [shipFilter, setShipFilter] = useState("");
  const [ships, setShips] = useState<ShipChoice[]>([]);
  const [units, setUnits] = useState<WargameUnit[]>(() => INITIAL_UNITS.map(prepareWargameUnit));
  const unitsRef = useRef<WargameUnit[]>(units);
  const [terrain, setTerrain] = useState<WargameTerrain[]>(INITIAL_TERRAIN);
  const [selectedUnitId, setSelectedUnitId] = useState<string>("blue-hurricanes");
  const [orderMode, setOrderMode] = useState<WargameOrderMode>(null);
  const [movePreview, setMovePreview] = useState<WargameMovePreview>(null);
  const [aiResponseVisible, setAiResponseVisible] = useState(true);
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [fitImportOpen, setFitImportOpen] = useState(false);
  const [fitImportText, setFitImportText] = useState("");
  const [fitImportBusy, setFitImportBusy] = useState(false);
  const [fitImportStatus, setFitImportStatus] = useState("");
  const [combatEvents, setCombatEvents] = useState<string[]>(["Scenario ready — press Play or +10s to execute plotted orders."]);
  const engagementStartedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void window.sage.listShips().then((items) => {
      if (!cancelled) setShips(Array.isArray(items) ? items : []);
    }).catch(() => {
      if (!cancelled) setShips([]);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => { unitsRef.current = units; }, [units]);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => runSimulationTick(1), 1000);
    return () => window.clearInterval(timer);
  }, [running, aiResponseVisible]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (event.code === "Space") {
        event.preventDefault();
        setPhase((current) => current < 1 ? 1 : current);
        setRunning((value) => !value);
      }
      if (event.key === "Escape") {
        setOrderMode(null);
        setMovePreview(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const selectedUnit = units.find((unit) => unit.id === selectedUnitId) ?? null;
  const shipResults = useMemo(() => {
    const query = shipFilter.trim().toLowerCase();
    const filtered = query
      ? ships.filter((ship) => `${ship.name} ${ship.groupName} ${ship.factionName ?? ""}`.toLowerCase().includes(query))
      : ships;
    return filtered.slice(0, 60);
  }, [ships, shipFilter]);

  const blueCount = units.filter((unit) => unit.side === "blue").reduce((sum, unit) => sum + liveShipCount(unit), 0);
  const redCount = units.filter((unit) => unit.side === "red").reduce((sum, unit) => sum + liveShipCount(unit), 0);
  const formatTime = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;

  function pointFromEvent(event: MouseEvent<HTMLDivElement> | DragEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: clampPercent(((event.clientX - rect.left) / rect.width) * 100),
      y: clampPercent(((event.clientY - rect.top) / rect.height) * 100),
    };
  }

  function updateUnit(id: string, patch: Partial<WargameUnit>) {
    setUnits((current) => {
      const next = current.map((unit) => unit.id === id ? { ...unit, ...patch } : unit);
      unitsRef.current = next;
      return next;
    });
  }

  function pushCombatEvents(...messages: string[]) {
    const clean = messages.filter(Boolean);
    if (!clean.length) return;
    setCombatEvents((current) => [...clean, ...current].slice(0, 14));
  }

  async function applyFitToSelected() {
    const unit = unitsRef.current.find((candidate) => candidate.id === selectedUnitId);
    if (!unit || !fitImportText.trim() || fitImportBusy) return;
    setFitImportBusy(true);
    setFitImportStatus("Resolving CCP types and calculating the fit through Sage DOGMA...");
    try {
      const result = await analyzeWargameFit(fitImportText, corporation.characterId);
      if (unit.typeId && unit.typeId !== result.hullTypeId) {
        throw new Error(`That is a ${result.hullName} fit, but the selected formation is ${unit.name}. Select the matching formation first.`);
      }
      const count = Math.max(1, unit.count);
      const totalEhp = result.perShipEhp * count;
      const dominantLayer = [
        { hp: result.shieldHp, resists: result.shieldResists },
        { hp: result.armorHp, resists: result.armorResists },
        { hp: result.structureHp, resists: result.hullResists },
      ].sort((a, b) => b.hp - a.hp)[0];
      updateUnit(unit.id, prepareWargameUnit({
        ...unit,
        name: result.hullName,
        typeId: result.hullTypeId,
        dps: result.perShipDps * count,
        ehp: totalEhp,
        maxEhp: totalEhp,
        shipsAlive: count,
        primaryEhp: result.perShipEhp,
        primaryShieldHp: result.shieldHp,
        primaryArmorHp: result.armorHp,
        primaryStructureHp: result.structureHp,
        speed: result.speedMps,
        range: result.rangeKm,
        optimalRange: result.optimalKm,
        falloffRange: result.falloffKm,
        tracking: result.tracking,
        signatureResolution: result.signatureResolutionM,
        explosionRadius: result.explosionRadiusM,
        explosionVelocity: result.explosionVelocityMps,
        damageReductionFactor: result.damageReductionFactor,
        signature: result.signatureRadiusM,
        weaponModel: result.weaponModel,
        weaponCycle: result.weaponCycle || defaultWeaponCycle(unit),
        volleyPerShip: result.perShipVolley,
        damageEm: result.damageProfile.em,
        damageTherm: result.damageProfile.thermal,
        damageKin: result.damageProfile.kinetic,
        damageExp: result.damageProfile.explosive,
        shieldHp: result.shieldHp,
        armorHp: result.armorHp,
        structureHp: result.structureHp,
        shieldResists: result.shieldResists,
        armorResists: result.armorResists,
        hullResists: result.hullResists,
        em: dominantLayer.resists[0] * 100,
        therm: dominantLayer.resists[1] * 100,
        kin: dominantLayer.resists[2] * 100,
        exp: dominantLayer.resists[3] * 100,
        repPerSecond: result.repPerSecond > 0 ? result.repPerSecond * count : unit.repPerSecond,
        repRange: result.repRangeKm > 0 ? result.repRangeKm : unit.repRange,
        repCycle: result.repCycle > 0 ? result.repCycle : unit.repCycle,
        webStrength: result.webStrength > 0 ? result.webStrength : unit.webStrength,
        webRange: result.webRangeKm > 0 ? result.webRangeKm : unit.webRange,
        tackleRange: result.tackleRangeKm > 0 ? result.tackleRangeKm : unit.tackleRange,
        supportSystems: result.supportSystems,
        capacitorCapacity: result.capacitorCapacityGj,
        capacitorCurrent: result.capacitorCapacityGj,
        capacitorRechargeSeconds: result.capacitorRechargeSeconds,
        capacitorDemandGjPerSecond: result.capacitorDemandGjPerSecond,
        capacitorInjectedGjPerSecond: result.capacitorInjectedGjPerSecond,
        baseSpeed: result.baseSpeedMps,
        propulsionKind: result.propulsionKind,
        targetingRange: result.targetingRangeKm,
        scanResolution: result.scanResolution,
        sensorStrength: result.sensorStrength,
        supportCooldowns: {},
        fitName: result.fitName,
        fitCharacter: result.characterName,
        fitSourceSummary: result.sourceSummary,
        fireCooldown: 0,
        lockRemaining: 0,
        lastVolleyDamage: 0,
      }));
      const warning = result.missingRequirements || result.fittingBlockers ? ` WARNING: ${result.sourceSummary}.` : "";
      setFitImportStatus(`FIT-LINKED: ${result.fitName} · ${Math.round(result.perShipDps).toLocaleString()} DPS/ship · ${Math.round(result.perShipVolley).toLocaleString()} volley/ship.${warning}`);
      setFitImportOpen(false);
      pushCombatEvents(`FIT DATA: ${unit.name} now uses '${result.fitName}' calculated from ${result.characterName}'s current skills.`);
    } catch (error) {
      setFitImportStatus(error instanceof Error ? error.message : "The fit could not be linked to this formation.");
    } finally {
      setFitImportBusy(false);
    }
  }

  function runSimulationTick(seconds: number) {
    const stepSeconds = Math.max(1, Math.min(60, Math.round(seconds)));
    let next = unitsRef.current.map((unit) => prepareWargameUnit({ ...unit }));
    const events: string[] = [];
    let damageOccurred = false;

    const findById = (id?: string) => id ? next.find((unit) => unit.id === id && unit.ehp > 0) : undefined;
    const living = (side: WargameSide) => next.filter((unit) => unit.side === side && unit.ehp > 0 && liveShipCount(unit) > 0);

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
          const fraction=layerFraction(profile,resists); const required=hp/fraction;
          if(incoming>=required){target[key]=0;incoming-=required;}else{target[key]=Math.max(0,hp-incoming*fraction);incoming=0;}
        };
        hitLayer("primaryShieldHp",target.shieldResists); hitLayer("primaryArmorHp",target.armorResists); hitLayer("primaryStructureHp",target.hullResists);
        if ((target.primaryStructureHp??0)<=.0001) {
          const remaining=Math.max(0,aliveBefore-1); target.shipsAlive=remaining;
          target.primaryShieldHp=remaining>0?(target.shieldHp??0):0; target.primaryArmorHp=remaining>0?(target.armorHp??0):0; target.primaryStructureHp=remaining>0?(target.structureHp??0):0;
          target.primaryEhp=remaining>0?perShipEhp(target):0; recalcFormationEhp(target);
          events.push(`${attacker.name} volley destroys a ${target.name} primary - ${remaining} remain.`);
          for(const shooter of next){if(shooter.targetId===target.id&&shooter.ehp>0)shooter.lockRemaining=Math.max(shooter.lockRemaining??0,shooter.targetSwitchDelay??defaultTargetSwitchDelay(shooter));}
          return true;
        }
        recalcFormationEhp(target); return false;
      }
      const primaryBefore=primaryEhp(target); const actual=Math.min(primaryBefore,damage);
      if(damage+.01>=primaryBefore){const remaining=Math.max(0,aliveBefore-1);target.shipsAlive=remaining;target.primaryEhp=remaining>0?perShipEhp(target):0;recalcFormationEhp(target);events.push(`${attacker.name} volley destroys a ${target.name} primary - ${remaining} remain.`);for(const shooter of next){if(shooter.targetId===target.id&&shooter.ehp>0)shooter.lockRemaining=Math.max(shooter.lockRemaining??0,shooter.targetSwitchDelay??defaultTargetSwitchDelay(shooter));}return true;}
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
      if (aiResponseVisible) {
        const blueLiving = living("blue");
        for (const red of living("red")) {
          if ((red.stance ?? "kite") === "support" || (red.repPerSecond ?? 0) > 0) continue;
          let best: WargameUnit | undefined;
          let bestScore = -Infinity;
          const supportKinds = new Set((red.supportSystems ?? []).map((system) => system.kind));
          const hasOffensiveSupport = [...supportKinds].some((kind) => ["web","tackle","targetPainter","sensorDamp","trackingDisruptor","ecm","energyNeutralizer","energyNosferatu"].includes(kind));
          const redMainTarget = next.find((unit) => unit.side === "red" && unit.role.toLowerCase().includes("mainline"))?.targetId;
          for (const candidate of blueLiving) {
            const rangeKm = wargameDistanceKm(red, candidate);
            const app = weaponApplication(red, candidate, Math.min(rangeKm, red.range));
            const role = candidate.role.toLowerCase();
            let score = (hasOffensiveSupport ? app * 15 : app * 55) - rangeKm * .18 + (100 - healthPercent(candidate)) * .22 + (100 - primaryHealthPercent(candidate)) * .18;
            if (supportKinds.has("web") || supportKinds.has("tackle")) { score += Math.min(70,(candidate.speed/100)); if(role.includes("tackle")||role.includes("interceptor")) score+=35; if((candidate.stance??"")==="pursue")score+=22; }
            if (supportKinds.has("targetPainter")) { if(candidate.id===redMainTarget)score+=75; score += Math.max(0,220-(candidate.signature??160))*.08; }
            if (supportKinds.has("sensorDamp")) { if(role.includes("logistics"))score+=70; if((candidate.range??0)>55)score+=35; }
            if (supportKinds.has("trackingDisruptor")) { if((candidate.weaponModel??"turret")==="turret")score+=65; score+=Math.min(40,(candidate.dps/Math.max(1,candidate.count))/20); }
            if (supportKinds.has("ecm")) { if(role.includes("logistics"))score+=75; else score+=Math.min(55,(candidate.dps/Math.max(1,candidate.count))/15); }
            if (supportKinds.has("energyNeutralizer") || supportKinds.has("energyNosferatu")) { if(role.includes("logistics"))score+=65; if((candidate.capacitorCapacity??0)>0)score+=25; }
            if (!hasOffensiveSupport && role.includes("logistics")) score += red.webStrength ? 70 : 18;
            if (!hasOffensiveSupport && role.includes("tackle")) score += 8;
            if (rangeKm <= red.range) score += 18;
            if (score > bestScore) { bestScore = score; best = candidate; }
          }
          if (best && red.targetId !== best.id) {
            red.targetId = best.id;
            red.destinationX = undefined;
            red.destinationY = undefined;
            red.lastTargetId = undefined;
            events.push(`RED AI: ${red.name} calls ${best.name}${hasOffensiveSupport ? " for support/EWAR pressure" : " based on range/application"}.`);
          }
        }
      }

      // Resolve fitted support systems against their assigned targets. Values come from skill/hull/script adjusted DOGMA.
      const webMultiplier = new Map<string, number>();
      const supportEffectiveness = (system: WargameSupportSystem, rangeKm: number) => {
        const optimalKm = Math.max(0, Number(system.optimalM) || 0) / 1000;
        const falloffKm = Math.max(0, Number(system.falloffM) || 0) / 1000;
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
        unit.ewarSignatureMultiplier = 1; unit.ewarTrackingMultiplier = 1; unit.ewarOptimalMultiplier = 1; unit.ewarFalloffMultiplier = 1;
        unit.ewarTargetingRangeMultiplier = 1; unit.ewarScanResolutionMultiplier = 1; unit.scrammed = false; unit.neutPressureGjPerSecond = 0;
        unit.jamRemaining = Math.max(0, (unit.jamRemaining ?? 0) - 1);
        if ((unit.jamRemaining ?? 0) <= 0) unit.jammedBy = undefined;
        capRecharge(unit);
        const cooldowns = unit.supportCooldowns ?? {};
        for (const key of Object.keys(cooldowns)) cooldowns[key] = Math.max(0, cooldowns[key] - 1);
        unit.supportCooldowns = cooldowns;
      }
      for (const controller of next) {
        if (controller.ehp <= 0 || !controller.supportSystems?.length) continue;
        const hostileTarget = findById(controller.targetId);
        for (let index = 0; index < controller.supportSystems.length; index += 1) {
          const system: WargameSupportSystem = controller.supportSystems[index]!;
          const key = `${system.kind}:${system.typeId}:${index}`;
          const target = (system.kind === "remoteSensorBooster" || system.kind === "remoteTrackingComputer" || system.kind === "remoteCapacitor") ? findById(controller.repTargetId) : hostileTarget;
          if (!target || (system.kind.startsWith("remote") ? target.side !== controller.side : target.side === controller.side)) continue;
          const rangeKm = wargameDistanceKm(controller, target);
          const effectiveness = supportEffectiveness(system, rangeKm);
          if (effectiveness <= .01) continue;
          const copies = Math.max(1, Number(system.quantity) || 1) * Math.max(1, liveShipCount(controller));
          if (system.kind === "web") { const current=webMultiplier.get(target.id) ?? 1; const one=Math.max(.05,1-Math.max(0,Math.min(.95,Number(system.strength)||0))*effectiveness); webMultiplier.set(target.id, Math.max(.05,current*Math.pow(one,copies))); }
          else if (system.kind === "targetPainter") target.ewarSignatureMultiplier! *= stackedMultiplier(Math.max(0,Number(system.signatureBonus)||0),copies,effectiveness);
          else if (system.kind === "sensorDamp") { target.ewarTargetingRangeMultiplier! *= stackedMultiplier(Number(system.maxTargetRangeBonus)||0,copies,effectiveness); target.ewarScanResolutionMultiplier! *= stackedMultiplier(Number(system.scanResolutionBonus)||0,copies,effectiveness); }
          else if (system.kind === "trackingDisruptor") { target.ewarOptimalMultiplier! *= stackedMultiplier(Number(system.optimalBonus)||0,copies,effectiveness); target.ewarFalloffMultiplier! *= stackedMultiplier(Number(system.falloffBonus)||0,copies,effectiveness); target.ewarTrackingMultiplier! *= stackedMultiplier(Number(system.trackingBonus)||0,copies,effectiveness); }
          else if (system.kind === "remoteSensorBooster") { target.ewarTargetingRangeMultiplier! *= stackedMultiplier(Math.max(0,Number(system.maxTargetRangeBonus)||0),copies,effectiveness); target.ewarScanResolutionMultiplier! *= stackedMultiplier(Math.max(0,Number(system.scanResolutionBonus)||0),copies,effectiveness); }
          else if (system.kind === "remoteTrackingComputer") { target.ewarOptimalMultiplier! *= stackedMultiplier(Math.max(0,Number(system.optimalBonus)||0),copies,effectiveness); target.ewarFalloffMultiplier! *= stackedMultiplier(Math.max(0,Number(system.falloffBonus)||0),copies,effectiveness); target.ewarTrackingMultiplier! *= stackedMultiplier(Math.max(0,Number(system.trackingBonus)||0),copies,effectiveness); }
          else if (system.kind === "tackle" && effectiveness > .5) { if (system.mwdShutdown) target.scrammed = true; }
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
            const sensor=Math.max(.1,target.sensorStrength??1); const single=Math.max(0,Math.min(1,(Number(system.strength)||0)*effectiveness/sensor)); const chance=1-Math.pow(1-single,copies);
            const seed=Math.abs(Math.sin((elapsed+second+1)*12.9898 + controller.id.length*78.233 + target.id.length*37.719))*43758.5453;
            if ((seed-Math.floor(seed)) < chance) { target.jamRemaining=Math.max(1,Number(system.cycleSeconds)||20); target.jammedBy=controller.id; events.push(`${controller.name}: ECM jams ${target.name} (${Math.round(chance*100)}% cycle chance).`); }
            controller.supportCooldowns![key]=Math.max(1,Number(system.cycleSeconds)||20);
          }
        }
      }

      // Scenario-local manual web values remain as a fallback for formations without a fit-linked web.
      for (const controller of next) {
        if (controller.ehp <= 0 || controller.supportSystems?.some((system) => system.kind === "web") || !(controller.webStrength && controller.webRange)) continue;
        const target = findById(controller.targetId);
        if (!target || target.side === controller.side || wargameDistanceKm(controller, target) > controller.webRange) continue;
        const current = webMultiplier.get(target.id) ?? 1;
        webMultiplier.set(target.id, Math.max(.1, current * (1 - Math.max(0, Math.min(.9, controller.webStrength)))));
      }

      next = next.map((unit) => {
        if (unit.ehp <= 0 || liveShipCount(unit) <= 0) return unit;
        let targetX = unit.destinationX;
        let targetY = unit.destinationY;
        const combatTarget = findById(unit.targetId);
        const stance = unit.stance ?? "kite";

        if (targetX == null || targetY == null) {
          if (stance === "support" || (unit.repPerSecond ?? 0) > 0) {
            const anchor = next.find((candidate) => candidate.side === unit.side && candidate.ehp > 0 && candidate.id !== unit.id && candidate.role.toLowerCase().includes("mainline"));
            if (anchor) {
              const enemies = next.filter((candidate) => candidate.side !== unit.side && candidate.ehp > 0);
              const threat = enemies.sort((a, b) => wargameDistanceKm(anchor, a) - wargameDistanceKm(anchor, b))[0];
              if (threat) {
                const dx = anchor.x - threat.x;
                const dy = anchor.y - threat.y;
                const length = Math.max(.001, Math.hypot(dx, dy));
                const trail = Math.min(9, Math.max(5, ((unit.repRange ?? 60) * .28) / 2.5));
                targetX = clampPercent(anchor.x + (dx / length) * trail);
                targetY = clampPercent(anchor.y + (dy / length) * trail);
              }
            }
          } else if (combatTarget && combatTarget.side !== unit.side && stance !== "hold") {
            const currentRange = wargameDistanceKm(unit, combatTarget);
            const preferredRange = preferredCombatRange(unit);
            const dx = combatTarget.x - unit.x;
            const dy = combatTarget.y - unit.y;
            const pctDistance = Math.max(.001, Math.hypot(dx, dy));
            if (currentRange > preferredRange + 2) {
              const standOffPct = preferredRange / 2.5;
              const travelPct = Math.max(0, pctDistance - standOffPct);
              const ratio = travelPct / pctDistance;
              targetX = unit.x + dx * ratio;
              targetY = unit.y + dy * ratio;
            } else if (stance === "kite" && currentRange < preferredRange - 5) {
              const escapePct = Math.min(12, (preferredRange - currentRange) / 2.5);
              targetX = clampPercent(unit.x - (dx / pctDistance) * escapePct);
              targetY = clampPercent(unit.y - (dy / pctDistance) * escapePct);
            }
          }
        }

        if (targetX == null || targetY == null) return { ...unit, velocityX: 0, velocityY: 0, effectiveSpeed: 0 };
        const dx = targetX - unit.x;
        const dy = targetY - unit.y;
        const distance = Math.hypot(dx, dy);
        if (distance < .05) return { ...unit, x: targetX, y: targetY, destinationX: undefined, destinationY: undefined, velocityX: 0, velocityY: 0, effectiveSpeed: 0 };
        const capOperational = !(unit.capacitorCapacity && (unit.capacitorCurrent ?? unit.capacitorCapacity) <= Math.max(1, unit.capacitorCapacity * .01));
        const propSpeed = unit.scrammed && unit.propulsionKind === "mwd" ? Math.max(0, unit.baseSpeed ?? unit.speed) : capOperational ? Math.max(0, unit.speed) : Math.max(0, unit.baseSpeed ?? unit.speed);
        const effectiveSpeed = propSpeed * (webMultiplier.get(unit.id) ?? 1);
        const maxStep = effectiveSpeed / 2500;
        const step = Math.min(distance, maxStep);
        const newX = clampPercent(unit.x + (dx / distance) * step);
        const newY = clampPercent(unit.y + (dy / distance) * step);
        const moved = { ...unit, x: newX, y: newY, velocityX: newX - unit.x, velocityY: newY - unit.y, effectiveSpeed };
        if (step >= distance - .001) { moved.destinationX = undefined; moved.destinationY = undefined; }
        return moved;
      });

      // Logistics choose one damaged primary and must lock/cycle reps; reps cannot spill onto a replacement primary.
      const repIntents: Array<{ logi: WargameUnit; targetId: string; targetAlive: number; amount: number; kind: "shield"|"armor"|"generic" }> = [];
      for (const logi of next) {
        if (logi.ehp <= 0 || !(logi.repPerSecond && logi.repPerSecond > 0)) continue;
        if (logi.capacitorCapacity && (logi.capacitorCurrent ?? logi.capacitorCapacity) <= Math.max(1, logi.capacitorCapacity * .01)) continue;
        logi.repCooldown = Math.max(0, (logi.repCooldown ?? 0) - 1);
        const currentRepTarget = findById(logi.repTargetId);
        const currentValid = currentRepTarget && currentRepTarget.side === logi.side && primaryHealthPercent(currentRepTarget) < 99.9 && wargameDistanceKm(logi, currentRepTarget) <= (logi.repRange ?? 0);
        if (!currentValid) {
          const allies = next.filter((candidate) => candidate.side === logi.side && candidate.ehp > 0 && candidate.id !== logi.id && primaryHealthPercent(candidate) < 99.9 && wargameDistanceKm(logi, candidate) <= (logi.repRange ?? 0));
          allies.sort((a, b) => primaryHealthPercent(a) - primaryHealthPercent(b));
          const choice = allies[0];
          if (choice?.id !== logi.repTargetId) {
            logi.repTargetId = choice?.id;
            logi.repLastTargetId = undefined;
            if (choice) events.push(`${logi.name}: starts locking ${choice.name} primary for reps.`);
          }
        }
        const repairTarget = findById(logi.repTargetId);
        if (!repairTarget) { logi.repTargetId = undefined; continue; }
        if (logi.repLastTargetId !== repairTarget.id) {
          logi.repLastTargetId = repairTarget.id;
          logi.repLockRemaining = logi.repLockTime ?? 2.5;
        } else {
          logi.repLockRemaining = Math.max(0, (logi.repLockRemaining ?? 0) - 1);
        }
        if ((logi.repLockRemaining ?? 0) > 0 || (logi.repCooldown ?? 0) > 0) continue;
        const linkedReps=(logi.supportSystems??[]).filter((system)=>system.kind==="remoteShieldRep"||system.kind==="remoteArmorRep");
        if(linkedReps.length){
          for(let repIndex=0;repIndex<linkedReps.length;repIndex+=1){const system=linkedReps[repIndex];const key=`rep:${system.typeId}:${repIndex}`;if((logi.supportCooldowns?.[key]??0)>0)continue;const effectiveness=supportEffectiveness(system,wargameDistanceKm(logi,repairTarget));if(effectiveness<=.01)continue;const amount=Math.max(0,Number(system.amountPerCycle)||0)*Math.max(1,liveShipCount(logi))*effectiveness;repIntents.push({logi,targetId:repairTarget.id,targetAlive:liveShipCount(repairTarget),amount,kind:system.kind==="remoteShieldRep"?"shield":"armor"});logi.supportCooldowns??={};logi.supportCooldowns[key]=Math.max(1,Number(system.cycleSeconds)||1);}
        }else{
          const cycle=Math.max(1,logi.repCycle??4);const outputScale=liveShipCount(logi)/Math.max(1,logi.count);repIntents.push({logi,targetId:repairTarget.id,targetAlive:liveShipCount(repairTarget),amount:logi.repPerSecond*cycle*outputScale,kind:"generic"});logi.repCooldown=cycle;
        }
      }

      // Weapons fire in discrete synchronized volleys. Damage is focused on one primary and overkill is discarded.
      const volleys: Array<{ attacker: WargameUnit; targetId: string; damage: number }> = [];
      for (const attacker of next) {
        attacker.application = 0;
        attacker.fireCooldown = Math.max(0, (attacker.fireCooldown ?? 0) - 1);
        if (attacker.ehp <= 0 || attacker.dps <= 0 || liveShipCount(attacker) <= 0) continue;
        const target = findById(attacker.targetId);
        if (!target || target.side === attacker.side) { attacker.lastTargetId = undefined; continue; }
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
        volleys.push({ attacker, targetId: target.id, damage: volley });
      }

      // Volleys landing on the same called primary in the same second are combined. Overkill is discarded rather than spilling into the next ship.
      const volleyGroups = new Map<string, { damage: number; attacker: WargameUnit }>();
      for (const volley of volleys) {
        const group = volleyGroups.get(volley.targetId);
        if (group) group.damage += volley.damage;
        else volleyGroups.set(volley.targetId, { damage: volley.damage, attacker: volley.attacker });
      }
      for (const [targetId, group] of volleyGroups) {
        const target = findById(targetId);
        if (!target) continue;
        damageOccurred = true;
        applyVolleyToPrimary(target, group.damage, group.attacker);
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

    if (damageOccurred && !engagementStartedRef.current) {
      engagementStartedRef.current = true;
      events.push("Weapons in range - volley combat has begun.");
      setPhase((current) => current < 2 ? 2 : current);
    }

    const combatPower = (side: WargameSide) => next.filter((unit) => unit.side === side && unit.ehp > 0).reduce((sum, unit) => sum + unit.dps * (liveShipCount(unit) / Math.max(1, unit.count)), 0);
    const blueEffective = combatPower("blue") > 1000;
    const redEffective = combatPower("red") > 1000;
    if (!blueEffective || !redEffective) {
      events.push(!blueEffective && !redEffective ? "Both forces combat-ineffective - resolution." : blueEffective ? "Red force combat-ineffective - Blue holds the field." : "Blue force combat-ineffective - Red holds the field.");
      setPhase(3);
      setRunning(false);
    }

    unitsRef.current = next;
    setUnits(next);
    setElapsed((value) => value + stepSeconds);
    pushCombatEvents(...events);
  }
  function handleCanvasClick(event: MouseEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget && (event.target as HTMLElement).closest(".wargame-map-unit, .wargame-terrain-object, button")) return;
    if (orderMode === "move" && selectedUnitId) {
      const point = pointFromEvent(event);
      setMovePreview({ unitId: selectedUnitId, ...point });
    }
  }

  function handleUnitClick(event: MouseEvent<HTMLButtonElement>, unit: WargameUnit) {
    event.stopPropagation();
    if (orderMode === "engage" && selectedUnitId && selectedUnitId !== unit.id) {
      const attacker = units.find((candidate) => candidate.id === selectedUnitId);
      if (attacker && attacker.side !== unit.side) {
        updateUnit(selectedUnitId, { targetId: unit.id, destinationX: undefined, destinationY: undefined });
        pushCombatEvents(`${attacker.name}: engage ${unit.name}.`);
        setPhase((current) => current < 1 ? 1 : current);
        setOrderMode(null);
        return;
      }
    }
    setSelectedUnitId(unit.id);
    setMovePreview(null);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const point = pointFromEvent(event);
    const existingUnitId = event.dataTransfer.getData("application/x-wargame-unit");
    if (existingUnitId) {
      updateUnit(existingUnitId, point);
      setSelectedUnitId(existingUnitId);
      return;
    }
    const raw = event.dataTransfer.getData("application/x-wargame-asset");
    if (!raw) return;
    try {
      const asset = JSON.parse(raw) as { kind: "ship" | "terrain"; typeId?: number; name?: string; groupName?: string; terrainKind?: string; glyph?: string };
      if (asset.kind === "ship" && asset.typeId && asset.name) {
        const id = `unit-${Date.now()}-${asset.typeId}`;
        setUnits((current) => [...current, prepareWargameUnit({
          id,
          name: asset.name!,
          typeId: asset.typeId,
          side: deploymentSide,
          count: 1,
          ...point,
          dps: 500,
          ehp: 50000,
          maxEhp: 50000,
          speed: 1500,
          range: 40,
          em: 60,
          therm: 60,
          kin: 60,
          exp: 60,
          role: asset.groupName || "Unassigned",
          ...tacticalProfileForGroup(asset.groupName || ""),
        })]);
        setSelectedUnitId(id);
      } else if (asset.kind === "terrain" && asset.terrainKind && asset.name && asset.glyph) {
        setTerrain((current) => [...current, { id: `terrain-${Date.now()}`, kind: asset.terrainKind!, label: asset.name!, glyph: asset.glyph!, ...point }]);
      }
    } catch {
      // Ignore malformed drag payloads from outside the wargame workspace.
    }
  }

  function commitMove() {
    if (!movePreview) return;
    const unit = units.find((candidate) => candidate.id === movePreview.unitId);
    updateUnit(movePreview.unitId, { destinationX: movePreview.x, destinationY: movePreview.y });
    if (unit) pushCombatEvents(`${unit.name}: movement order committed.`);
    setPhase((current) => current < 1 ? 1 : current);
    setMovePreview(null);
    setOrderMode(null);
  }

  function startRetreat() {
    if (!selectedUnit) return;
    setPhase(3);
    setOrderMode("move");
    setMovePreview({ unitId: selectedUnit.id, x: selectedUnit.side === "blue" ? 5 : 95, y: selectedUnit.y });
  }

  function resetScenario() {
    const initial = INITIAL_UNITS.map(prepareWargameUnit);
    unitsRef.current = initial;
    setUnits(initial);
    setTerrain(INITIAL_TERRAIN.map((object) => ({ ...object })));
    setSelectedUnitId("blue-hurricanes");
    setMovePreview(null);
    setOrderMode(null);
    setPhase(0);
    setElapsed(0);
    setRunning(false);
    setAiResponseVisible(true);
    setFitImportText("");
    setFitImportStatus("");
    setFitImportOpen(false);
    engagementStartedRef.current = false;
    setCombatEvents(["Scenario reset — press Play or +10s to execute plotted orders."]);
  }

  function clearScenario() {
    unitsRef.current = [];
    setUnits([]);
    setTerrain([]);
    setSelectedUnitId("");
    setMovePreview(null);
    setOrderMode(null);
    setPhase(0);
    setElapsed(0);
    setRunning(false);
    setAiResponseVisible(false);
    setFitImportText("");
    setFitImportStatus("");
    setFitImportOpen(false);
    engagementStartedRef.current = false;
    setCombatEvents(["Empty scenario ready — deploy forces from the asset library."]);
  }

  const redMain = units.find((unit) => unit.side === "red" && unit.role.toLowerCase().includes("mainline")) ?? units.find((unit) => unit.side === "red");
  const blueLogi = units.find((unit) => unit.side === "blue" && unit.role.toLowerCase().includes("logistics"));
  const aiGhost = redMain && blueLogi ? { x: Math.max(blueLogi.x + 10, 37), y: Math.max(blueLogi.y - 7, 20) } : null;
  const selectedTarget = selectedUnit?.targetId ? units.find((unit) => unit.id === selectedUnit.targetId && unit.ehp > 0) : undefined;
  const selectedTargetRange = selectedUnit && selectedTarget ? wargameDistanceKm(selectedUnit, selectedTarget) : null;
  const selectedApplication = selectedUnit && selectedTarget ? weaponApplication(selectedUnit, selectedTarget, selectedTargetRange ?? undefined) : (selectedUnit?.application ?? 0);
  const selectedRangeRate = selectedUnit && selectedTarget ? rangeRateMps(selectedUnit, selectedTarget) : null;
  const selectedRepTarget = selectedUnit?.repTargetId ? units.find((unit) => unit.id === selectedUnit.repTargetId) : undefined;
  const selectedWebbers = selectedUnit ? units.filter((unit) => unit.side !== selectedUnit.side && unit.ehp > 0 && unit.webStrength && unit.webRange && unit.targetId === selectedUnit.id && wargameDistanceKm(unit, selectedUnit) <= unit.webRange) : [];
  const selectedVolley = selectedUnit && selectedTarget ? ((selectedUnit.volleyPerShip && selectedUnit.volleyPerShip > 0 ? selectedUnit.volleyPerShip * liveShipCount(selectedUnit) : selectedUnit.dps * Math.max(1, selectedUnit.weaponCycle ?? defaultWeaponCycle(selectedUnit)) * (liveShipCount(selectedUnit) / Math.max(1, selectedUnit.count))) * selectedApplication) : 0;

  return <div className={`fleet-wargame-view ${leftCollapsed ? "assets-collapsed" : ""} ${rightCollapsed ? "inspector-collapsed" : ""}`}>
    <header className="wargame-command-strip">
      <div className="wargame-strip-identity">
        <button type="button" className="wargame-back" onClick={() => onNavigate("doctrines")} title="Return to Fleet Command">‹</button>
        <div><span>TACTICAL WARGAME</span><strong>{corporation.name}</strong></div>
      </div>
      <div className="wargame-scenario-name"><span>SCENARIO</span><strong>Gate Hold / Volley & Logistics Test</strong><small>{PHASES[phase].short} · T+ {formatTime}</small></div>
      <div className="wargame-strip-status"><span className={`wargame-live-dot ${running ? "running" : ""}`} />{running ? "SIM RUNNING" : "SIM PAUSED"}</div>
      <div className="wargame-strip-actions">
        <button type="button" onClick={() => onNavigate("jump-map")}>Jump Map</button>
        <button type="button" onClick={clearScenario}>New</button>
        <button type="button" className={`wargame-ai-button ${aiResponseVisible ? "active" : ""}`} onClick={() => setAiResponseVisible((value) => !value)}>RED TEAM AI</button>
      </div>
    </header>

    <div className="wargame-workspace">
      <aside className="wargame-asset-drawer">
        <div className="wargame-panel-head">
          <div><span>ASSET LIBRARY</span><strong>Deploy to board</strong></div>
          <button type="button" onClick={() => setLeftCollapsed(true)} title="Collapse asset library">‹</button>
        </div>
        <div className="wargame-asset-tabs">
          {(["ships", "terrain", "fleets"] as WargameAssetTab[]).map((tab) => <button type="button" key={tab} className={assetTab === tab ? "active" : ""} onClick={() => setAssetTab(tab)}>{tab}</button>)}
        </div>
        <div className="wargame-side-selector" aria-label="Deployment side">
          <button type="button" className={deploymentSide === "blue" ? "active blue" : ""} onClick={() => setDeploymentSide("blue")}><i />BLUE</button>
          <button type="button" className={deploymentSide === "red" ? "active red" : ""} onClick={() => setDeploymentSide("red")}><i />RED</button>
        </div>

        {assetTab === "ships" && <>
          <label className="wargame-search"><span>⌕</span><input value={shipFilter} onChange={(event) => setShipFilter(event.target.value)} placeholder="Search every EVE hull..." /></label>
          <div className="wargame-library-meta"><span>{ships.length ? `${ships.length.toLocaleString()} published hulls` : "Loading hull catalogue..."}</span><small>Drag a hull onto the tactical board</small></div>
          <div className="wargame-ship-library">
            {shipResults.map((ship) => <button
              type="button"
              draggable
              className="wargame-ship-asset"
              key={ship.typeId}
              title={`Drag ${ship.name} onto the board`}
              onDragStart={(event) => event.dataTransfer.setData("application/x-wargame-asset", JSON.stringify({ kind: "ship", typeId: ship.typeId, name: ship.name, groupName: ship.groupName }))}
            >
              <img src={imageUrl(ship.typeId)} alt="" loading="lazy" />
              <span><strong>{ship.name}</strong><small>{ship.groupName}{ship.factionName ? ` · ${ship.factionName}` : ""}</small></span>
              <b>⋮⋮</b>
            </button>)}
            {ships.length > shipResults.length && <small className="wargame-library-limit">Search to narrow the full hull catalogue · showing {shipResults.length}</small>}
          </div>
        </>}

        {assetTab === "terrain" && <div className="wargame-terrain-library">
          <small>TACTICAL OBJECTS</small>
          {TERRAIN_ASSETS.map((asset) => <button
            type="button"
            draggable
            key={asset.kind}
            onDragStart={(event) => event.dataTransfer.setData("application/x-wargame-asset", JSON.stringify({ kind: "terrain", terrainKind: asset.kind, name: asset.label, glyph: asset.glyph }))}
          ><b>{asset.glyph}</b><span><strong>{asset.label}</strong><small>Drag to place</small></span></button>)}
        </div>}

        {assetTab === "fleets" && <div className="wargame-fleet-library">
          <small>SAVED / STOCK FORMATIONS</small>
          <button type="button"><b>30</b><span><strong>Hurricane artillery core</strong><small>30 HFI · formation template</small></span></button>
          <button type="button"><b>6</b><span><strong>Scimitar logistics wing</strong><small>6 Scimitar · 20 km trail</small></span></button>
          <button type="button"><b>+</b><span><strong>Import doctrine</strong><small>Bring a Fleet Command doctrine onto the board</small></span></button>
        </div>}
      </aside>

      {leftCollapsed && <button type="button" className="wargame-panel-reveal left" onClick={() => setLeftCollapsed(false)} title="Open asset library">ASSETS ›</button>}

      <div
        className={`wargame-tactical-map ${orderMode ? `order-${orderMode}` : ""}`}
        aria-label="Tactical wargame plotting board"
        onDragOver={(event) => event.preventDefault()}
        onDrop={handleDrop}
        onClick={handleCanvasClick}
      >
        <div className="wargame-grid-glow" />
        <div className="wargame-range-ring ring-a"><span>50 KM</span></div>
        <div className="wargame-range-ring ring-b"><span>100 KM</span></div>
        <div className="wargame-range-ring ring-c"><span>150 KM</span></div>
        <div className="wargame-axis horizontal" />
        <div className="wargame-axis vertical" />
        <div className="wargame-bearing bearing-a" />
        <div className="wargame-bearing bearing-b" />
        <span className="wargame-quadrant q1">VECTOR 030</span>
        <span className="wargame-quadrant q2">VECTOR 330</span>
        <span className="wargame-quadrant q3">VECTOR 210</span>
        <span className="wargame-quadrant q4">VECTOR 150</span>

        <div className="wargame-map-toolbar" onClick={(event) => event.stopPropagation()}>
          <button type="button" className={orderMode === "move" ? "active" : ""} disabled={!selectedUnit} onClick={() => { setOrderMode(orderMode === "move" ? null : "move"); setMovePreview(null); }}>↗ Plot move</button>
          <button type="button" className={orderMode === "engage" ? "active danger" : ""} disabled={!selectedUnit} onClick={() => { setOrderMode(orderMode === "engage" ? null : "engage"); setMovePreview(null); }}>◎ Set target</button>
          <button type="button" onClick={() => { setMovePreview(null); setOrderMode(null); if (selectedUnit) updateUnit(selectedUnit.id, { targetId: undefined, destinationX: undefined, destinationY: undefined }); }}>■ Hold</button>
          <span>{orderMode === "move" ? "CLICK MAP TO PLOT DESTINATION" : orderMode === "engage" ? "CLICK A HOSTILE TO ASSIGN TARGET" : "DRAG ASSETS · CLICK UNIT TO COMMAND"}</span>
        </div>

        <div className="wargame-map-scale"><span>TACTICAL GRID</span><strong>250 km × 250 km</strong><small>Planar command projection · relative positions</small></div>

        {selectedUnit && selectedUnit.ehp > 0 && <>
          <div className={`wargame-selected-range-ring weapon ${selectedUnit.side}`} style={{ left: `${selectedUnit.x}%`, top: `${selectedUnit.y}%`, width: `${Math.min(95, selectedUnit.range * .8)}%`, aspectRatio: "1" }}><span>{Math.round(selectedUnit.range)} km WEAPONS</span></div>
          {Math.max(selectedUnit.webRange ?? 0, selectedUnit.repRange ?? 0, selectedUnit.tackleRange ?? 0) > 0 && <div className={`wargame-selected-range-ring systems ${selectedUnit.side}`} style={{ left: `${selectedUnit.x}%`, top: `${selectedUnit.y}%`, width: `${Math.min(95, Math.max(selectedUnit.webRange ?? 0, selectedUnit.repRange ?? 0, selectedUnit.tackleRange ?? 0) * .8)}%`, aspectRatio: "1" }}><span>SYSTEMS</span></div>}
        </>}

        <svg className="wargame-vector-layer" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <marker id="blue-arrow" markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto"><path d="M0,0 L5,2.5 L0,5 Z" /></marker>
            <marker id="red-arrow" markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto"><path d="M0,0 L5,2.5 L0,5 Z" /></marker>
          </defs>
          {units.map((unit) => unit.destinationX != null && unit.destinationY != null && unit.ehp > 0 ? <line key={`${unit.id}-move`} className={`move-vector active ${unit.side}`} x1={unit.x} y1={unit.y} x2={unit.destinationX} y2={unit.destinationY} markerEnd={`url(#${unit.side}-arrow)`} /> : null)}
          {units.map((unit) => {
            const target = unit.targetId ? units.find((candidate) => candidate.id === unit.targetId) : null;
            return target ? <line key={`${unit.id}-target`} className={`attack-vector ${unit.side}`} x1={unit.x} y1={unit.y} x2={target.x} y2={target.y} markerEnd={`url(#${unit.side}-arrow)`} /> : null;
          })}
          {movePreview && (() => {
            const unit = units.find((candidate) => candidate.id === movePreview.unitId);
            return unit ? <line className={`move-vector ${unit.side}`} x1={unit.x} y1={unit.y} x2={movePreview.x} y2={movePreview.y} markerEnd={`url(#${unit.side}-arrow)`} /> : null;
          })()}
          {aiResponseVisible && redMain && aiGhost && <line className="ai-response-vector" x1={redMain.x} y1={redMain.y} x2={aiGhost.x} y2={aiGhost.y} markerEnd="url(#red-arrow)" />}
        </svg>

        {terrain.map((object) => <div className={`wargame-terrain-object terrain-${object.kind}`} key={object.id} style={{ left: `${object.x}%`, top: `${object.y}%` }} title={object.label}>
          <b>{object.glyph}</b><span>{object.label}</span>
        </div>)}

        {units.map((unit) => <button
          type="button"
          draggable
          key={unit.id}
          className={`wargame-map-unit ${unit.side} ${selectedUnitId === unit.id ? "selected" : ""} ${unit.ehp <= 0 ? "destroyed" : ""} ${orderMode === "engage" && selectedUnitId !== unit.id ? "targetable" : ""}`}
          style={{ left: `${unit.x}%`, top: `${unit.y}%` }}
          onClick={(event) => handleUnitClick(event, unit)}
          onDragStart={(event) => { event.stopPropagation(); event.dataTransfer.setData("application/x-wargame-unit", unit.id); }}
        >
          <span className="wargame-unit-glyph"><i /><b>{liveShipCount(unit) > 1 ? liveShipCount(unit) : ""}</b></span>
          <span className="wargame-unit-copy"><strong>{unit.name}</strong><small>{unit.ehp <= 0 ? "DESTROYED" : `${liveShipCount(unit)} / ${unit.count} ships · ${unit.role}`}</small></span>
          <span className="wargame-unit-health"><i style={{ width: `${healthPercent(unit)}%` }} /></span>
        </button>)}

        {movePreview && (() => {
          const unit = units.find((candidate) => candidate.id === movePreview.unitId);
          return unit ? <button type="button" className={`wargame-map-unit ghost ${unit.side}`} style={{ left: `${movePreview.x}%`, top: `${movePreview.y}%` }} onClick={(event) => event.stopPropagation()}>
            <span className="wargame-unit-glyph"><i /><b>{unit.count > 1 ? unit.count : ""}</b></span>
            <span className="wargame-unit-copy"><strong>PLANNED POSITION</strong><small>{unit.name}</small></span>
          </button> : null;
        })()}

        {aiResponseVisible && redMain && aiGhost && <div className="wargame-ai-ghost" style={{ left: `${aiGhost.x}%`, top: `${aiGhost.y}%` }}>
          <span className="wargame-ai-ghost-glyph" />
          <strong>RED RESPONSE A</strong>
          <small>Pressure Blue logistics · 43%</small>
        </div>}

        {movePreview && <div className="wargame-order-commit" onClick={(event) => event.stopPropagation()}>
          <div><span>ORDER PREVIEW</span><strong>Move {units.find((unit) => unit.id === movePreview.unitId)?.name}</strong><small>Ghost position is not committed to simulation state.</small></div>
          <button type="button" onClick={() => setMovePreview(null)}>Cancel</button>
          <button type="button" className="primary" onClick={commitMove}>Commit order</button>
        </div>}
      </div>

      {rightCollapsed && <button type="button" className="wargame-panel-reveal right" onClick={() => setRightCollapsed(false)} title="Open inspector">‹ INSPECTOR</button>}

      <aside className="wargame-inspector">
        <div className="wargame-panel-head">
          <div><span>COMMAND INSPECTOR</span><strong>{selectedUnit ? "Selected formation" : "Nothing selected"}</strong></div>
          <button type="button" onClick={() => setRightCollapsed(true)} title="Collapse inspector">›</button>
        </div>
        {selectedUnit ? <>
          <div className={`wargame-selected-unit ${selectedUnit.side}`}>
            <div className="wargame-selected-ship">{selectedUnit.typeId ? <img src={imageUrl(selectedUnit.typeId)} alt="" /> : <span>◇</span>}</div>
            <div><span>{selectedUnit.side === "blue" ? "BLUE FORCE" : "RED FORCE"}</span><strong>{selectedUnit.name}</strong><small>{selectedUnit.ehp <= 0 ? "DESTROYED" : selectedUnit.role}</small></div>
            <b>×{liveShipCount(selectedUnit)} / {selectedUnit.count}</b>
          </div>

          <div className="wargame-quick-orders">
            <button type="button" className={orderMode === "move" ? "active" : ""} onClick={() => { setOrderMode("move"); setMovePreview(null); }}><span>↗</span>Move</button>
            <button type="button" className={orderMode === "engage" ? "active danger" : ""} onClick={() => setOrderMode("engage")}><span>◎</span>Engage</button>
            <button type="button" onClick={() => { updateUnit(selectedUnit.id, { targetId: undefined, destinationX: undefined, destinationY: undefined }); setOrderMode(null); setMovePreview(null); }}><span>■</span>Hold</button>
            <button type="button" onClick={startRetreat}><span>⇥</span>Retreat</button>
          </div>

          <section className="wargame-stat-editor">
            <div className="wargame-section-title"><span>SIMULATION VALUES</span><small>Overrides are scenario-local</small></div>
            <div className="wargame-stat-grid">
              <label><span>Ships</span><input type="number" min="1" value={selectedUnit.count} onChange={(event) => { const count = Math.max(1, Number(event.target.value) || 1); const total = selectedUnit.maxEhp ?? selectedUnit.ehp; updateUnit(selectedUnit.id, { count, shipsAlive: count, primaryEhp: total / count, ehp: total }); }} /></label>
              <label><span>DPS</span><input type="number" value={selectedUnit.dps} onChange={(event) => updateUnit(selectedUnit.id, { dps: Number(event.target.value) || 0 })} /></label>
              <label><span>EHP</span><input type="number" value={selectedUnit.maxEhp ?? selectedUnit.ehp} onChange={(event) => { const value = Math.max(0, Number(event.target.value) || 0); updateUnit(selectedUnit.id, { ehp: value, maxEhp: value, shipsAlive: selectedUnit.count, primaryEhp: value / Math.max(1, selectedUnit.count) }); }} /><small>{Math.round(selectedUnit.ehp).toLocaleString()} remaining</small></label>
              <label><span>Top speed</span><input type="number" value={selectedUnit.speed} onChange={(event) => updateUnit(selectedUnit.id, { speed: Number(event.target.value) || 0 })} /><small>m/s</small></label>
              <label><span>Combat range</span><input type="number" value={selectedUnit.range} onChange={(event) => updateUnit(selectedUnit.id, { range: Number(event.target.value) || 0 })} /><small>km</small></label>
              <label><span>Role</span><input value={selectedUnit.role} onChange={(event) => updateUnit(selectedUnit.id, { role: event.target.value })} /></label>
            </div>
          </section>

          <section className="wargame-tactical-systems">
            <div className="wargame-section-title"><span>TACTICAL SYSTEMS</span><small>Application / support / control</small></div>
            <div className="wargame-tactical-grid">
              <label><span>Weapon model</span><select value={selectedUnit.weaponModel ?? "turret"} onChange={(event) => updateUnit(selectedUnit.id, { weaponModel: event.target.value as WargameWeaponModel })}><option value="turret">Turret</option><option value="missile">Missile</option><option value="drone">Drone</option><option value="support">Support only</option></select></label>
              <label><span>Stance</span><select value={selectedUnit.stance ?? "kite"} onChange={(event) => updateUnit(selectedUnit.id, { stance: event.target.value as WargameStance })}><option value="pursue">Pursue / close gap</option><option value="kite">Kite / range control</option><option value="brawl">Brawl / close</option><option value="screen">Screen / control</option><option value="support">Support / trail anchor</option><option value="hold">Hold position</option></select></label>
              <label><span>Signature</span><input type="number" min="20" value={selectedUnit.signature ?? 160} onChange={(event) => updateUnit(selectedUnit.id, { signature: Math.max(20, Number(event.target.value) || 20) })}/><small>m</small></label>
              <label><span>Tracking</span><input type="number" step="0.005" min="0" value={selectedUnit.tracking ?? 0} onChange={(event) => updateUnit(selectedUnit.id, { tracking: Math.max(0, Number(event.target.value) || 0) })}/><small>rad/s</small></label>
              <label><span>Weapon cycle</span><input type="number" step="0.1" min="1" value={selectedUnit.weaponCycle ?? defaultWeaponCycle(selectedUnit)} onChange={(event) => updateUnit(selectedUnit.id, { weaponCycle: Math.max(1, Number(event.target.value) || 1) })}/><small>s</small></label>
              <label><span>Target switch</span><input type="number" step="0.1" min="0" value={selectedUnit.targetSwitchDelay ?? defaultTargetSwitchDelay(selectedUnit)} onChange={(event) => updateUnit(selectedUnit.id, { targetSwitchDelay: Math.max(0, Number(event.target.value) || 0) })}/><small>s</small></label>
              <label><span>Remote reps</span><input type="number" min="0" value={selectedUnit.repPerSecond ?? 0} onChange={(event) => updateUnit(selectedUnit.id, { repPerSecond: Math.max(0, Number(event.target.value) || 0) })}/><small>EHP/s</small></label>
              <label><span>Rep range</span><input type="number" min="0" value={selectedUnit.repRange ?? 0} onChange={(event) => updateUnit(selectedUnit.id, { repRange: Math.max(0, Number(event.target.value) || 0) })}/><small>km</small></label>
              <label><span>Rep cycle</span><input type="number" step="0.1" min="1" value={selectedUnit.repCycle ?? 4} onChange={(event) => updateUnit(selectedUnit.id, { repCycle: Math.max(1, Number(event.target.value) || 1) })}/><small>s</small></label>
              <label><span>Rep lock</span><input type="number" step="0.1" min="0" value={selectedUnit.repLockTime ?? 2.5} onChange={(event) => updateUnit(selectedUnit.id, { repLockTime: Math.max(0, Number(event.target.value) || 0) })}/><small>s</small></label>
              <label><span>Web strength</span><input type="number" min="0" max="90" value={Math.round((selectedUnit.webStrength ?? 0) * 100)} onChange={(event) => updateUnit(selectedUnit.id, { webStrength: Math.max(0, Math.min(.9, (Number(event.target.value) || 0) / 100)) })}/><small>%</small></label>
              <label><span>Web range</span><input type="number" min="0" value={selectedUnit.webRange ?? 0} onChange={(event) => updateUnit(selectedUnit.id, { webRange: Math.max(0, Number(event.target.value) || 0) })}/><small>km</small></label>
              <label><span>Tackle range</span><input type="number" min="0" value={selectedUnit.tackleRange ?? 0} onChange={(event) => updateUnit(selectedUnit.id, { tackleRange: Math.max(0, Number(event.target.value) || 0) })}/><small>km</small></label>
            </div>
            <div className="wargame-tactical-telemetry">
              <div><span>TARGET</span><strong>{selectedTarget ? selectedTarget.name : "None"}</strong><small>{selectedTargetRange == null ? "No firing solution" : `${selectedTargetRange.toFixed(1)} km`}</small></div>
              <div><span>APPLICATION</span><strong>{selectedTarget ? `${Math.round(selectedApplication * 100)}%` : "-"}</strong><small>{selectedUnit.weaponModel ?? "turret"} model</small></div>
              <div><span>FORMATION VOLLEY</span><strong>{selectedUnit.volleyPerShip ? Math.round(selectedUnit.volleyPerShip * liveShipCount(selectedUnit)).toLocaleString() : Math.round((selectedUnit.dps || 0) * (selectedUnit.weaponCycle ?? defaultWeaponCycle(selectedUnit)) * (liveShipCount(selectedUnit) / Math.max(1, selectedUnit.count))).toLocaleString()}</strong><small>{selectedUnit.fitName ? "fit-derived paper volley" : "scenario estimate"}</small></div>
              <div><span>WEAPON ENVELOPE</span><strong>{selectedUnit.optimalRange != null ? `${selectedUnit.optimalRange.toFixed(1)} + ${(selectedUnit.falloffRange ?? 0).toFixed(1)} km` : `${Math.round(selectedUnit.range)} km`}</strong><small>{selectedUnit.fitName ? "CCP DOGMA / loaded ammo" : "scenario range"}</small></div>
              <div><span>CURRENT PRIMARY</span><strong>{liveShipCount(selectedUnit) ? `${Math.round(primaryEhp(selectedUnit)).toLocaleString()} / ${Math.round(perShipEhp(selectedUnit)).toLocaleString()} EHP` : "DESTROYED"}</strong><small>{liveShipCount(selectedUnit)} of {selectedUnit.count} ships active</small></div>
              <div><span>NEXT VOLLEY</span><strong>{selectedUnit.dps > 0 ? `${Math.round(selectedVolley).toLocaleString()} EHP` : "-"}</strong><small>{selectedUnit.lockRemaining && selectedUnit.lockRemaining > 0 ? `LOCKING ${selectedUnit.lockRemaining.toFixed(1)}s` : selectedUnit.fireCooldown && selectedUnit.fireCooldown > 0 ? `CYCLE ${selectedUnit.fireCooldown.toFixed(1)}s` : "READY"}</small></div>
              <div><span>MOTION</span><strong>{Math.round(selectedUnit.effectiveSpeed ?? velocityMps(selectedUnit)).toLocaleString()} m/s</strong><small>{selectedWebbers.length ? `WEBBED by ${selectedWebbers.map((unit) => unit.name).join(", ")}` : "No hostile web"}</small></div>
              <div><span>RANGE CONTROL</span><strong>{selectedRangeRate == null ? "-" : `${Math.abs(Math.round(selectedRangeRate)).toLocaleString()} m/s`}</strong><small>{selectedRangeRate == null ? "No target" : selectedRangeRate > 60 ? "OPENING" : selectedRangeRate < -60 ? "CLOSING" : "STABLE"}{selectedTarget && (selectedUnit.stance ?? "kite") === "kite" && (selectedUnit.effectiveSpeed ?? selectedUnit.speed) < (selectedTarget.effectiveSpeed ?? selectedTarget.speed) ? " · PURSUER FASTER" : ""}</small></div>
              <div><span>REMOTE REPS</span><strong>{selectedRepTarget ? selectedRepTarget.name : (selectedUnit.repPerSecond ? "Idle" : "None")}</strong><small>{selectedUnit.repPerSecond ? `${Math.round(selectedUnit.repPerSecond).toLocaleString()} HP/s · ${(selectedUnit.repRange ?? 0).toFixed(1)} km` : "No logistics output"}</small></div>
              <div><span>CAPACITOR</span><strong>{selectedUnit.capacitorCapacity ? `${Math.round(((selectedUnit.capacitorCurrent ?? selectedUnit.capacitorCapacity) / selectedUnit.capacitorCapacity) * 100)}%` : "-"}</strong><small>{selectedUnit.capacitorCapacity ? `${Math.round(selectedUnit.capacitorCurrent ?? selectedUnit.capacitorCapacity).toLocaleString()} / ${Math.round(selectedUnit.capacitorCapacity).toLocaleString()} GJ${selectedUnit.neutPressureGjPerSecond ? ` · -${selectedUnit.neutPressureGjPerSecond.toFixed(1)} GJ/s hostile` : ""}` : "No fit capacitor data"}</small></div>
              <div><span>EWAR STATE</span><strong>{selectedUnit.jamRemaining ? "JAMMED" : selectedUnit.scrammed ? "SCRAMMED" : selectedWebbers.length ? "WEBBED" : "CLEAR"}</strong><small>{selectedUnit.jamRemaining ? `${selectedUnit.jamRemaining.toFixed(0)}s remaining` : `${Math.round((selectedUnit.ewarSignatureMultiplier ?? 1) * 100)}% sig · ${Math.round((selectedUnit.ewarTrackingMultiplier ?? 1) * 100)}% tracking · ${Math.round((selectedUnit.ewarTargetingRangeMultiplier ?? 1) * 100)}% lock range`}</small></div>
            </div>
          </section>

            {selectedUnit.supportSystems?.length ? <div className="wargame-support-stack">
              <div className="wargame-support-stack-head"><span>FIT SUPPORT / EWAR</span><small>skill + hull + script adjusted DOGMA</small></div>
              {selectedUnit.supportSystems.map((system, index) => <div className={`wargame-support-system ${system.kind}`} key={`${system.kind}-${system.typeId}-${index}`}>
                <div><strong>{system.name}{system.quantity > 1 ? ` ×${system.quantity}` : ""}</strong><small>{system.kind.replace(/([A-Z])/g, " $1")}</small></div>
                <span>{supportSystemDetail(system)}</span>
              </div>)}
            </div> : null}

          <section className="wargame-resist-editor">
            <div className="wargame-section-title"><span>RESIST PROFILE</span><small>%</small></div>
            {(["em", "therm", "kin", "exp"] as const).map((key) => <label key={key}><span>{key.toUpperCase()}</span><div><i style={{ width: `${selectedUnit[key]}%` }} /></div><input type="number" min="0" max="100" value={selectedUnit[key]} onChange={(event) => updateUnit(selectedUnit.id, { [key]: Math.max(0, Math.min(100, Number(event.target.value) || 0)) })} /></label>)}
          </section>

          <section className="wargame-fit-bridge">
            <div className="wargame-section-title"><span>FIT / DATA SOURCE</span><small>{selectedUnit.fitName ? "Sage DOGMA linked" : "Scenario values"}</small></div>
            <div className="wargame-fit-actions"><button type="button" onClick={() => setFitImportOpen((value) => !value)}>Import EVE fit</button><button type="button" disabled={!selectedUnit.fitName}>{selectedUnit.fitName ? "Fit linked" : "No fit linked"}</button></div>
            {selectedUnit.fitName && <div className="wargame-fit-source"><span>FIT-LINKED</span><strong>{selectedUnit.fitName}</strong><small>{selectedUnit.fitSourceSummary ?? selectedUnit.fitCharacter}</small></div>}
            {fitImportStatus && <small className="wargame-fit-status">{fitImportStatus}</small>}
            {fitImportOpen && <div className="wargame-fit-import"><textarea value={fitImportText} onChange={(event) => setFitImportText(event.target.value)} placeholder="Paste EFT / PYFA or Sage JSON fit here..." /><button type="button" disabled={!fitImportText.trim() || fitImportBusy} onClick={() => void applyFitToSelected()}>{fitImportBusy ? "Calculating through Sage..." : "Apply real fit stats"}</button><small>Uses {corporation.characterName}'s current synced skills and Sage's existing fitting/DOGMA engine.</small></div>}
          </section>
        </> : <div className="wargame-inspector-empty"><span>＋</span><strong>Select a fleet or drag a hull onto the board</strong><small>Stats, orders, fits and scenario overrides appear here.</small></div>}

        <section className={`wargame-ai-panel ${aiResponseVisible ? "active" : ""}`}>
          <div className="wargame-ai-head"><div><span>RED TEAM AI</span><strong>Reactive opponent</strong></div><b>MCP</b></div>
          <p>Red receives only hostile-observable state. Blue's uncommitted plan stays hidden from the opposing AI.</p>
          {aiResponseVisible ? <div className="wargame-ai-assessment"><span>RED TEAM ACTIVE · REACTIVE</span><strong>Red now fights through discrete weapon volleys and individual primaries, weighs target value against application, and can win or lose depending on whether logistics catch the called target.</strong><small>The dashed vector is prediction; when the clock runs the Red formations now execute their own orders.</small></div> : <button type="button" onClick={() => setAiResponseVisible(true)}>Enable Red response</button>}
          <div className="wargame-event-feed"><span>SIMULATION FEED</span>{combatEvents.map((entry, index) => <small key={`${entry}-${index}`}>{entry}</small>)}</div>
        </section>
      </aside>
    </div>

    <footer className="wargame-timeline">
      <div className="wargame-playback">
        <button type="button" title="Reset scenario" onClick={resetScenario}>↺</button>
        <button type="button" className="wargame-play" title="Space: play / pause" onClick={() => { if (!running) setPhase((current) => current < 1 ? 1 : current); setRunning((value) => !value); }}>{running ? "Ⅱ" : "▶"}</button>
        <button type="button" title="Advance simulation 10 seconds" onClick={() => { setPhase((current) => current < 1 ? 1 : current); runSimulationTick(10); }}>+10s</button>
        <strong>T+ {formatTime}</strong>
      </div>
      <div className="wargame-phase-track">
        {PHASES.map((item, index) => <button type="button" key={item.short} className={`${phase === index ? "active" : ""} ${phase > index ? "complete" : ""}`} onClick={() => setPhase(index as WargamePhase)}>
          <b>{index + 1}</b><span><strong>{item.short}</strong><small>{item.title}</small></span>
        </button>)}
        <i className="wargame-phase-progress" style={{ width: `${(phase / 3) * 75 + 12.5}%` }} />
      </div>
      <div className="wargame-force-summary"><span className="blue">BLUE <b>{blueCount}</b></span><span className="red">RED <b>{redCount}</b></span><small>{PHASES[phase].detail}</small></div>
    </footer>
  </div>;
}

export function FleetCommand({ onWargameActiveChange }: { onWargameActiveChange?: (active: boolean) => void }) {
  const [snapshots, setSnapshots] = useState<any[]>([]);
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null);
  const [tab, setTab] = useState<FleetCommandTab>("doctrines");
  const [jumpLocation, setJumpLocation] = useState<NavigationCharacterLocation | null>(null);
  const [jumpLocationBusy, setJumpLocationBusy] = useState(false);
  const [jumpLocationError, setJumpLocationError] = useState("");
  const [followCharacter, setFollowCharacter] = useState(false);
  const [jumpSelectedSystem, setJumpSelectedSystem] = useState<NavigationSystem | null>(null);

  async function reloadSnapshots() {
    try {
      const values = await (window.sage as any).listSnapshots();
      setSnapshots(Array.isArray(values) ? values : []);
    } catch {
      setSnapshots([]);
    }
  }

  useEffect(() => { void reloadSnapshots(); }, []);
  useEffect(() => {
    onWargameActiveChange?.(tab === "wargame");
    return () => onWargameActiveChange?.(false);
  }, [tab, onWargameActiveChange]);

  const corporations = useMemo<FleetCorporation[]>(() => snapshots.flatMap((snapshot) => {
    const corporationId = Number(snapshot?.character?.corporation_id ?? 0);
    const characterId = String(snapshot?.characterId ?? "");
    if (!corporationId || !characterId) return [];
    const data = snapshot?.extended?.corporation ?? {};
    const publicData = data.publicData ?? snapshot?.character?.corporation_data ?? {};
    return [{
      characterId,
      characterName: String(snapshot?.character?.name ?? `Character ${characterId}`),
      corporationId,
      name: String(publicData?.name ?? snapshot?.character?.corporation_name ?? `Corporation ${corporationId}`),
      snapshot,
      data,
    }];
  }).sort((a, b) => a.characterName.localeCompare(b.characterName)), [snapshots]);

  useEffect(() => {
    if (!corporations.length) { setSelectedCharacterId(null); return; }
    let preferred: FleetCorporation | undefined;
    try {
      const pending = JSON.parse(sessionStorage.getItem(PENDING_DOCTRINE_FIT_KEY) ?? "null");
      const corporationId = Number(pending?.corporationId ?? 0);
      if (corporationId) preferred = corporations.find((corp) => corp.corporationId === corporationId);
    } catch { /* Legacy malformed pending data is ignored. */ }
    if (preferred) setSelectedCharacterId(preferred.characterId);
    else if (!selectedCharacterId || !corporations.some((corp) => corp.characterId === selectedCharacterId)) setSelectedCharacterId(corporations[0].characterId);
  }, [corporations, selectedCharacterId]);

  const corporation = corporations.find((item) => item.characterId === selectedCharacterId) ?? corporations[0] ?? null;

  const refreshJumpLocation = useCallback(async (forceLive = true) => {
    if (!corporation?.characterId) {
      setJumpLocation(null);
      setJumpLocationError("Choose a connected corporation character first.");
      return null;
    }
    setJumpLocationBusy(true);
    try {
      const value = await window.sage.getNavigationCharacterLocation(corporation.characterId, forceLive);
      setJumpLocation(value);
      setJumpLocationError("");
      return value;
    } catch (error) {
      setJumpLocationError(error instanceof Error ? error.message : "Live character location is unavailable.");
      return null;
    } finally {
      setJumpLocationBusy(false);
    }
  }, [corporation?.characterId]);

  useEffect(() => {
    setJumpLocation(null);
    setJumpSelectedSystem(null);
    setJumpLocationError("");
    if (tab === "jump-map" && corporation?.characterId && !followCharacter) void refreshJumpLocation(true);
  }, [corporation?.characterId, tab, followCharacter, refreshJumpLocation]);

  useEffect(() => {
    if (tab !== "jump-map" || !followCharacter || !corporation?.characterId) return;
    void refreshJumpLocation(true);
    const timer = window.setInterval(() => void refreshJumpLocation(true), 15_000);
    return () => window.clearInterval(timer);
  }, [tab, followCharacter, corporation?.characterId, refreshJumpLocation]);

  return <section className={`corp-command fleet-command ${tab === "wargame" ? "fleet-command-wargame-active" : ""}`}>
    {tab !== "wargame" && <>
      <div className="corp-data-head">
        <div>
          <p className="eyebrow">FLEET COMMAND</p>
          <h2>{corporation?.name ?? "Fleet Command"}</h2>
          <p>Doctrine control, live jump intelligence and tactical planning are corporation-scoped here. Wargame Map remains the dedicated deep-combat simulation workspace.</p>
        </div>
        <div className="corp-data-actions">
          {corporations.length > 1 && <select value={selectedCharacterId ?? ""} onChange={(event) => setSelectedCharacterId(event.target.value)}>
            {corporations.map((corp) => <option key={corp.characterId} value={corp.characterId}>{corp.characterName} / {corp.name}</option>)}
          </select>}
          <button onClick={() => void reloadSnapshots()}>Reload local data</button>
        </div>
      </div>

      <div className="corp-subtabs fleet-command-subtabs" role="tablist" aria-label="Fleet Command sections">
        <button type="button" className={tab === "doctrines" ? "active" : ""} onClick={() => setTab("doctrines")}>Doctrine Library</button>
        <button type="button" className={tab === "jump-map" ? "active" : ""} onClick={() => setTab("jump-map")}>On The Fly Jump Map</button>
        <button type="button" onClick={() => setTab("wargame")}>Wargame Map</button>
      </div>
    </>}

    {corporation
      ? tab === "doctrines"
        ? <CorporationDoctrines corporation={corporation} snapshots={snapshots} />
        : tab === "jump-map"
          ? <div className="fleet-jump-map-view">
              <div className="fleet-jump-map-location">
                <div><span>CURRENT CHARACTER</span><strong>{corporation.characterName}</strong><small>{jumpLocation ? `${jumpLocation.systemName} / ${jumpLocation.source === "live-esi" ? "LIVE ESI" : "SYNCED SNAPSHOT"}` : "Location not loaded"}</small></div>
                <button type="button" disabled={jumpLocationBusy} onClick={() => void refreshJumpLocation(true)}>{jumpLocationBusy ? "Checking..." : "Refresh location"}</button>
              </div>
              {jumpLocationError && <div className="on-the-fly-warning">{jumpLocationError}</div>}
              <OnTheFlyJumpMap
                route={null}
                routeIntelligence={null}
                characterLocation={jumpLocation}
                followCharacter={followCharacter}
                setFollowCharacter={setFollowCharacter}
                hasSelectedCharacter={Boolean(corporation.characterId)}
                selectedSystem={jumpSelectedSystem}
                onSelectSystem={setJumpSelectedSystem}
                specialConnections={[]}
              />
            </div>
          : <WargameMap corporation={corporation} onNavigate={setTab} />
      : <div className="corp-data-view"><p className="eyebrow">FLEET COMMAND</p><h3>Connect a corporation character</h3><p>Sync a connected EVE character to load corporation doctrine and tactical data.</p></div>}
  </section>;
}
