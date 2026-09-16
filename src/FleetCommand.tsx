import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent, type WheelEvent } from "react";
import { OnTheFlyJumpMap } from "./OnTheFlyJumpMap";
import type { NavigationCharacterLocation, NavigationSystem } from "./types";
import "./navigation-command.css";
import { CorporationDoctrines, PENDING_DOCTRINE_FIT_KEY } from "./CorporationDoctrines";
import { analyzeWargameFit, type WargameFitResult } from "./wargame-fit-bridge";
import { COMMON_WARGAME_SYSTEM_EFFECTS, cloneDamageSources, cloneOrderChain, type WargameDamageSource, type WargameMovementOrder, type WargameOrderCondition, type WargameOrderStep, type WargamePropulsionOrder, type WargameSystemEffect } from "./wargame-command-model";
import { clampPercent, damageSourceApplication, defaultTargetSwitchDelay, defaultWeaponCycle, healthPercent, liveShipCount, perShipEhp, prepareWargameUnit, primaryEhp, rangeRateMps, sourcePaperDps, sourcePaperVolley, velocityMps, weaponApplication, wargameConditionUsesSeconds, wargameConditionUsesTarget, wargameConditionUsesThreshold, wargameDistanceKm, wargameSupportSystemKey, wargameSupportTargetSide } from "./wargame-engine";
import type { WargameSide, WargameStance, WargameSupportSystem, WargameUnit, WargameWeaponModel } from "./wargame-types";
import { applyWargameCommand, createWargameSession, WARGAME_DEFAULT_RNG_SEED, type WargameCommand, type WargameCommandRecord } from "./wargame-session";

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
type WargameAssetTab = "ships" | "terrain" | "fleets";
type WargameOrderMode = "move" | "engage" | "logistics" | "tackle" | "ewar" | "align" | "warp" | null;

const WARGAME_CONDITION_OPTIONS: Array<{ value: WargameOrderCondition["kind"]; label: string }> = [
  { value: "always", label: "Immediately / always" },
  { value: "target-destroyed", label: "Target destroyed" },
  { value: "target-health-below", label: "Target HP below %" },
  { value: "target-ships-below", label: "Target ships at/below N" },
  { value: "range-below", label: "Range below km" },
  { value: "range-above", label: "Range above km" },
  { value: "target-scrammed", label: "Target scrammed" },
  { value: "target-warp-disrupted", label: "Target warp disrupted" },
  { value: "target-warping", label: "Target entering warp" },
  { value: "target-jammed", label: "Target jammed" },
  { value: "self-health-below", label: "Own fleet HP below %" },
  { value: "self-cap-below", label: "Own capacitor below %" },
  { value: "after-seconds", label: "After N seconds" },
  { value: "arrived", label: "Movement arrived" },
  { value: "self-aligned", label: "Own fleet aligned" },
  { value: "self-warped", label: "Own fleet landed from warp" },
  { value: "manual", label: "Manual only" },
];

type ShipChoice = {
  typeId: number;
  name: string;
  groupId: number;
  groupName: string;
  factionId?: number;
  factionName?: string;
};

type WargameTerrain = {
  id: string;
  kind: string;
  label: string;
  glyph: string;
  x: number;
  y: number;
  side?: WargameSide;
  radiusKm?: number;
};

type WargameMovePreview = { unitId: string; x: number; y: number } | null;
type WargameSavedFit = { id: string; name: string; hullName: string; hullTypeId?: number; source: "SAGE" | "EVE ESI"; payload: unknown };

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
  { kind: "bubble", label: "Warp Disruption Bubble", glyph: "◎" },
  { kind: "beacon", label: "Beacon / Objective", glyph: "✦" },
] as const;

const INITIAL_UNITS: WargameUnit[] = [];

// The board starts clean. Every formation, gate, structure, celestial and zone
// must be deliberately placed by the FC (or loaded from a saved scenario).
const INITIAL_TERRAIN: WargameTerrain[] = [];

function imageUrl(typeId: number) {
  return `https://images.evetech.net/types/${typeId}/render?size=128`;
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
  if (system.kind === "commandBurst") { const buffs=(system.buffs ?? []).map((buff) => `${buff.description.replace(/^.*?:\s*/, "")} ${buff.value >= 0 ? "+" : ""}${buff.value.toFixed(1)}%`).join(" · "); return `${buffs || "command burst"} · ${envelope}`; }
  return envelope;
}

function displayedSourceTarget(unit: WargameUnit, source: WargameDamageSource) {
  return source.targetId ?? unit.targetId;
}

function unconfiguredScenarioStats(): Pick<WargameUnit, "dps" | "ehp" | "maxEhp" | "speed" | "range" | "weaponModel" | "signature" | "tracking" | "stance" | "simulationReady"> {
  // A hull dragged from the catalogue is only a board marker until a real fit is linked.
  // Do not invent DPS, tank, speed, range or application for an unknown fitting.
  return { dps: 0, ehp: 1, maxEhp: 1, speed: 0, range: 0, weaponModel: "support", signature: 1, tracking: 0, stance: "hold", simulationReady: false };
}

function wargameUnitFromFit(unit: WargameUnit, result: WargameFitResult, fitText: string): WargameUnit {
  const count = Math.max(1, unit.count);
  const totalEhp = result.perShipEhp * count;
  const dominantLayer = [
    { hp: result.shieldHp, resists: result.shieldResists },
    { hp: result.armorHp, resists: result.armorResists },
    { hp: result.structureHp, resists: result.hullResists },
  ].sort((a, b) => b.hp - a.hp)[0];
  const previousTargets = new Map((unit.damageSources ?? []).map((source) => [source.id, source.targetId]));
  const damageSources = result.damageSources.map((source) => ({
    ...source,
    targetId: previousTargets.get(source.id) ?? unit.targetId,
    fireCooldown: 0,
    lockRemaining: 0,
    lastTargetId: undefined,
    droneOnTargetId: undefined,
    droneArrivalRemaining: 0,
    lastVolleyDamage: 0,
  }));
  return prepareWargameUnit({
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
    supportTargetIds: { ...(unit.supportTargetIds ?? {}) },
    damageSources,
    capacitorCapacity: result.capacitorCapacityGj,
    capacitorCurrent: result.capacitorCapacityGj,
    capacitorRechargeSeconds: result.capacitorRechargeSeconds,
    capacitorDemandGjPerSecond: result.capacitorDemandGjPerSecond,
    capacitorInjectedGjPerSecond: result.capacitorInjectedGjPerSecond,
    baseSpeed: result.baseSpeedMps,
    alignTimeSeconds: result.alignTimeSeconds,
    warpSpeedAuPerSecond: result.warpSpeedAuPerSecond,
    propulsionKind: result.propulsionKind,
    targetingRange: result.targetingRangeKm,
    scanResolution: result.scanResolution,
    sensorStrength: result.sensorStrength,
    supportCooldowns: {},
    fitName: result.fitName,
    fitCharacter: result.characterName,
    fitSourceSummary: result.sourceSummary,
    simulationReady: true,
    fitText,
    fireCooldown: 0,
    lockRemaining: 0,
    lastVolleyDamage: 0,
  });
}

function WargameMap({ corporation, onNavigate, active }: { corporation: FleetCorporation; onNavigate(tab: FleetCommandTab): void; active: boolean }) {
  const [phase, setPhase] = useState<WargamePhase>(0);
  const [assetTab, setAssetTab] = useState<WargameAssetTab>("ships");
  const [deploymentSide, setDeploymentSide] = useState<WargameSide>("blue");
  const [shipFilter, setShipFilter] = useState("");
  const [ships, setShips] = useState<ShipChoice[]>([]);
  const [units, setUnits] = useState<WargameUnit[]>(() => INITIAL_UNITS.map(prepareWargameUnit));
  const unitsRef = useRef<WargameUnit[]>(units);
  const [terrain, setTerrain] = useState<WargameTerrain[]>(INITIAL_TERRAIN);
  const [selectedUnitId, setSelectedUnitId] = useState<string>("");
  const [orderMode, setOrderMode] = useState<WargameOrderMode>(null);
  const [movePreview, setMovePreview] = useState<WargameMovePreview>(null);
  const [aiResponseVisible, setAiResponseVisible] = useState(true);
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const sessionRef = useRef(createWargameSession(units));
  const commandHistoryRef = useRef<WargameCommandRecord[]>([]);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [fitImportOpen, setFitImportOpen] = useState(false);
  const [fitImportText, setFitImportText] = useState("");
  const [fitImportBusy, setFitImportBusy] = useState(false);
  const [fitImportStatus, setFitImportStatus] = useState("");
  const [savedFits, setSavedFits] = useState<WargameSavedFit[]>([]);
  const [savedFitsStatus, setSavedFitsStatus] = useState("");
  const [systemEffects, setSystemEffects] = useState<WargameSystemEffect[]>([]);
  const [systemEffectDraft, setSystemEffectDraft] = useState("");
  const [systemEffectBusy, setSystemEffectBusy] = useState(false);
  const [orderDraftTarget, setOrderDraftTarget] = useState("");
  const [orderDraftCompletionTarget, setOrderDraftCompletionTarget] = useState("");
  const [orderDraftPropulsion, setOrderDraftPropulsion] = useState<WargamePropulsionOrder>("cruise");
  const [orderDraftSeconds, setOrderDraftSeconds] = useState(20);
  const [mapCamera, setMapCamera] = useState({ zoom: 1, panX: 0, panY: 0 });
  const [warpRangeDraft, setWarpRangeDraft] = useState(0);
  const [combatEvents, setCombatEvents] = useState<string[]>(["Scenario ready."]);
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

  useEffect(() => {
    unitsRef.current = units;
    sessionRef.current = { ...sessionRef.current, units };
  }, [units]);

  useEffect(() => {
    let cancelled = false;
    const loadSavedFits = async () => {
      try {
        let legacyFits: unknown[] = [];
        let legacyMeta: Record<string, unknown> = {};
        try { const parsed=JSON.parse(localStorage.getItem("new-eden-sage-fits") ?? "[]"); if (Array.isArray(parsed)) legacyFits=parsed; } catch {}
        try { const parsed=JSON.parse(localStorage.getItem("new-eden-sage-fit-library-meta") ?? "{}"); if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) legacyMeta=parsed as Record<string, unknown>; } catch {}
        const persisted = await window.sage.loadFittingPersistence({ savedFits: legacyFits, fitLibraryMeta: legacyMeta });
        const localRows: WargameSavedFit[] = (Array.isArray(persisted.savedFits) ? persisted.savedFits : []).flatMap((fit: any, index: number) => {
          if (!fit || typeof fit !== "object") return [];
          const hullName=String(fit?.hull?.name ?? fit?.ship?.name ?? "Unknown hull");
          const hullTypeId=Number(fit?.hull?.typeId ?? fit?.ship?.typeId ?? 0) || undefined;
          return [{ id:String(fit.id ?? "sage-"+index), name:String(fit.name ?? hullName+" fit"), hullName, hullTypeId, source:"SAGE" as const, payload:fit }];
        });
        const esiRaw=Array.isArray(corporation.snapshot?.extended?.fittings) ? corporation.snapshot.extended.fittings : [];
        const esiIds=[...new Set<number>(esiRaw.map((fit:any)=>Number(fit?.ship_type_id ?? 0)).filter((id:number)=>id>0))];
        const esiNames=esiIds.length ? await window.sage.resolveFittingTypeIdsLocal(esiIds) : [];
        const hullNames=new Map(esiNames.map((row:any)=>[Number(row.id),String(row.name)]));
        const esiRows: WargameSavedFit[] = esiRaw.flatMap((fit:any,index:number)=>{
          const hullTypeId=Number(fit?.ship_type_id ?? 0)||undefined;
          if(!hullTypeId)return [];
          return [{ id:"esi-"+String(fit?.fitting_id ?? index), name:String(fit?.name ?? "EVE saved fit"), hullName:hullNames.get(hullTypeId) ?? "Type "+hullTypeId, hullTypeId, source:"EVE ESI" as const, payload:fit }];
        });
        if(cancelled)return;
        const rows=[...localRows,...esiRows];
        setSavedFits(rows);
        setSavedFitsStatus(rows.length ? rows.length+" saved fits available" : "No saved fits found");
      } catch(error) {
        if(!cancelled)setSavedFitsStatus(error instanceof Error ? error.message : "Saved fits could not be loaded.");
      }
    };
    void loadSavedFits();
    const unsubscribe=typeof window.sage.onMcpFitDataUpdated === "function" ? window.sage.onMcpFitDataUpdated(()=>void loadSavedFits()) : undefined;
    return()=>{ cancelled=true; unsubscribe?.(); };
  }, [corporation.characterId, corporation.snapshot]);

  useEffect(() => {
    if (!active || !running) return;
    const timer = window.setInterval(() => runSimulationTick(1), 1000);
    return () => window.clearInterval(timer);
  }, [active, running, aiResponseVisible]);

  useEffect(() => {
    if (!active) return;
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
  }, [active]);

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
    const screenX = event.clientX - rect.left;
    const screenY = event.clientY - rect.top;
    const worldX = rect.width / 2 + (screenX - rect.width / 2 - mapCamera.panX) / mapCamera.zoom;
    const worldY = rect.height / 2 + (screenY - rect.height / 2 - mapCamera.panY) / mapCamera.zoom;
    return {
      x: clampPercent((worldX / rect.width) * 100),
      y: clampPercent((worldY / rect.height) * 100),
    };
  }

  function handleMapWheel(event: WheelEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement | null)?.closest('.wargame-map-toolbar, .wargame-order-commit')) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const cursorX = event.clientX - rect.left;
    const cursorY = event.clientY - rect.top;
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const nextZoom = Math.max(1, Math.min(6, mapCamera.zoom * (event.deltaY < 0 ? 1.14 : 1 / 1.14)));
    if (Math.abs(nextZoom - mapCamera.zoom) < .001) return;
    const worldOffsetX = (cursorX - centerX - mapCamera.panX) / mapCamera.zoom;
    const worldOffsetY = (cursorY - centerY - mapCamera.panY) / mapCamera.zoom;
    setMapCamera({
      zoom: nextZoom,
      panX: cursorX - centerX - worldOffsetX * nextZoom,
      panY: cursorY - centerY - worldOffsetY * nextZoom,
    });
  }

  function resetMapCamera() {
    setMapCamera({ zoom: 1, panX: 0, panY: 0 });
  }

  function nudgeMapZoom(multiplier: number) {
    setMapCamera((current) => ({ ...current, zoom: Math.max(1, Math.min(6, current.zoom * multiplier)) }));
  }

  function executeWargameCommand(command: WargameCommand) {
    const transition = applyWargameCommand(sessionRef.current, command);
    sessionRef.current = transition.state;
    commandHistoryRef.current.push(transition.command);
    unitsRef.current = transition.state.units;
    setUnits(transition.state.units);
    return transition;
  }

  function updateUnit(id: string, patch: Partial<WargameUnit>) {
    executeWargameCommand({ id: `patch-${sessionRef.current.revision + 1}`, kind: "patch-unit", source: "human", unitId: id, patch });
  }

  function pushCombatEvents(...messages: string[]) {
    const clean = messages.filter(Boolean);
    if (!clean.length) return;
    setCombatEvents((current) => [...clean, ...current].slice(0, 14));
  }

  async function applyFitPayloadToSelected(payload: string) {
    const unit = unitsRef.current.find((candidate) => candidate.id === selectedUnitId);
    if (!unit || !payload.trim() || fitImportBusy) return;
    setFitImportBusy(true);
    setFitImportStatus("Loading fit and calculating combat stats...");
    try {
      const result = await analyzeWargameFit(payload, corporation.characterId, systemEffects.map((effect) => effect.typeId));
      if (unit.typeId && unit.typeId !== result.hullTypeId) {
        throw new Error(`That is a ${result.hullName} fit, but the selected formation is ${unit.name}. Select the matching formation first.`);
      }
      updateUnit(unit.id, wargameUnitFromFit(unit, result, payload));
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

  async function applyFitToSelected() {
    await applyFitPayloadToSelected(fitImportText);
  }

  async function applySavedFitToSelected(fitId: string) {
    const saved=savedFits.find((fit)=>fit.id===fitId);
    if(!saved)return;
    const payload=JSON.stringify(saved.payload);
    setFitImportText(payload);
    await applyFitPayloadToSelected(payload);
  }

  async function setScenarioSystemEffects(nextEffects: WargameSystemEffect[]) {
    if (systemEffectBusy) return;
    setSystemEffectBusy(true);
    const resumeAfterRecalculation=running;
    if(resumeAfterRecalculation) setRunning(false);
    try {
      const ids = nextEffects.map((effect) => effect.typeId);
      const current = unitsRef.current;
      const recalculated = await Promise.all(current.map(async (unit) => {
        if (!unit.fitText) return unit;
        const result = await analyzeWargameFit(unit.fitText, corporation.characterId, ids);
        return wargameUnitFromFit(unit, result, unit.fitText);
      }));
      executeWargameCommand({ id: `replace-${sessionRef.current.revision + 1}`, kind: "replace-units", source: "system", units: recalculated });
      setSystemEffects(nextEffects);
      pushCombatEvents(nextEffects.length
        ? `SYSTEM EFFECTS: ${nextEffects.map((effect) => effect.name).join(" + ")} applied. Linked fit stats updated.`
        : "SYSTEM EFFECTS: cleared. Linked fit stats restored to normal space.");
    } catch (error) {
      setFitImportStatus(error instanceof Error ? error.message : "System effect recalculation failed.");
    } finally {
      setSystemEffectBusy(false);
      if(resumeAfterRecalculation) setRunning(true);
    }
  }

  async function addScenarioSystemEffect(name = systemEffectDraft) {
    const requested = name.trim();
    if (!requested || systemEffectBusy) return;
    const preset = COMMON_WARGAME_SYSTEM_EFFECTS.find((effect) => effect.name.toLowerCase() === requested.toLowerCase());
    let effect = preset;
    if (!effect) {
      const resolved = await window.sage.resolveFittingTypeNamesLocal([requested]);
      const exact = resolved.find((entry) => String(entry.name).toLowerCase() === requested.toLowerCase());
      if (!exact) {
        setFitImportStatus(`No exact CCP type named '${requested}' was found.`);
        return;
      }
      effect = { typeId: Number(exact.id), name: String(exact.name) };
    }
    if (systemEffects.some((active) => active.typeId === effect!.typeId)) return;
    setSystemEffectDraft("");
    await setScenarioSystemEffects([...systemEffects, effect]);
  }

  async function removeScenarioSystemEffect(typeId: number) {
    await setScenarioSystemEffects(systemEffects.filter((effect) => effect.typeId !== typeId));
  }

  function updateDamageSourceTarget(unitId: string, sourceId: string, targetId?: string) {
    const unit = unitsRef.current.find((candidate) => candidate.id === unitId);
    if (!unit) return;
    updateUnit(unitId, { damageSources: cloneDamageSources(unit.damageSources).map((source) => source.id === sourceId ? { ...source, targetId: targetId || undefined, lastTargetId: undefined, lockRemaining: 0, droneOnTargetId: source.kind === "drone" ? undefined : source.droneOnTargetId, droneArrivalRemaining: source.kind === "drone" ? 0 : source.droneArrivalRemaining } : source) });
  }

  function assignAllOffence(unitId: string, targetId?: string) {
    const unit = unitsRef.current.find((candidate) => candidate.id === unitId);
    if (!unit) return;
    updateUnit(unitId, {
      targetId: targetId || undefined,
      supportTargetIds: Object.fromEntries((unit.supportSystems ?? []).map((system, index) => { const key=wargameSupportSystemKey(system,index); return [key, wargameSupportTargetSide(system.kind) === "hostile" ? (targetId || undefined) : unit.supportTargetIds?.[key]]; })),
      damageSources: cloneDamageSources(unit.damageSources).map((source) => ({ ...source, targetId: targetId || undefined, lastTargetId: undefined, lockRemaining: 0, droneOnTargetId: source.kind === "drone" ? undefined : source.droneOnTargetId, droneArrivalRemaining: source.kind === "drone" ? 0 : source.droneArrivalRemaining })),
    });
  }

  function assignSupportGroup(unitId: string, targetId: string | undefined, kinds: Set<string>, legacy: "rep" | "tackle" | "none" = "none") {
    const unit = unitsRef.current.find((candidate) => candidate.id === unitId);
    if (!unit) return;
    const supportTargetIds = { ...(unit.supportTargetIds ?? {}) };
    for (let index = 0; index < (unit.supportSystems?.length ?? 0); index += 1) {
      const system = unit.supportSystems![index];
      if (kinds.has(system.kind)) supportTargetIds[wargameSupportSystemKey(system, index)] = targetId;
    }
    const patch: Partial<WargameUnit> = { supportTargetIds };
    if (legacy === "rep") patch.repTargetId = targetId;
    if (legacy === "tackle" && ((unit.tackleRange ?? 0) > 0 || (unit.webRange ?? 0) > 0)) patch.targetId = targetId;
    updateUnit(unitId, patch);
  }

  function issueWarpDestination(value: string) {
    const actor = unitsRef.current.find((candidate) => candidate.id === selectedUnitId);
    if (!actor || !value) return;
    if (value.startsWith("unit:")) {
      const target = unitsRef.current.find((candidate) => candidate.id === value.slice(5));
      if (!target) return;
      executeWargameCommand({ id: `nav-${sessionRef.current.revision + 1}`, kind: "movement-order", source: "human", unitId: actor.id, mode: "warp", targetId: target.id, warpRangeKm: warpRangeDraft });
      pushCombatEvents(`${actor.name}: warp to ${target.name} at ${warpRangeDraft} km.`);
    } else if (value.startsWith("terrain:")) {
      const target = terrain.find((candidate) => candidate.id === value.slice(8));
      if (!target) return;
      executeWargameCommand({ id: `nav-${sessionRef.current.revision + 1}`, kind: "movement-order", source: "human", unitId: actor.id, mode: "warp", x: target.x, y: target.y, warpRangeKm: warpRangeDraft });
      pushCombatEvents(`${actor.name}: warp to ${target.label} at ${warpRangeDraft} km.`);
    }
    setPhase((current) => current < 1 ? 1 : current);
    setOrderMode(null);
    setMovePreview(null);
  }

  function updateSupportSystemTarget(unitId: string, supportKey: string, targetId?: string) {
    const unit = unitsRef.current.find((candidate) => candidate.id === unitId);
    if (!unit) return;
    updateUnit(unitId, { supportTargetIds: { ...(unit.supportTargetIds ?? {}), [supportKey]: targetId || undefined } });
  }

  function addOrderStep(unit: WargameUnit) {
    const hostile = unitsRef.current.find((candidate) => candidate.side !== unit.side && candidate.ehp > 0);
    const defaultTarget = orderDraftTarget || hostile?.id || "";
    const completionTarget = orderDraftCompletionTarget || defaultTarget;
    const step: WargameOrderStep = {
      id: "order-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7),
      label: "Order " + ((unit.orderChain?.length ?? 0) + 1),
      trigger: "immediate",
      sourceTargets: Object.fromEntries((unit.damageSources ?? []).map((source) => [source.id, defaultTarget || undefined])),
      supportTargets: Object.fromEntries((unit.supportSystems ?? []).map((system,index) => [wargameSupportSystemKey(system,index), wargameSupportTargetSide(system.kind) === "hostile" ? (defaultTarget || undefined) : undefined])),
      tackleTargetId: defaultTarget || undefined,
      movement: "legacy",
      movementRangeKm: Math.max(0, unit.range * .7),
      warpRangeKm: 0,
      propulsion: orderDraftPropulsion,
      stance: unit.stance,
      completion: completionTarget ? "target-destroyed" : "manual",
      completionTargetId: completionTarget || undefined,
      completionSeconds: Math.max(1, orderDraftSeconds),
    };
    updateUnit(unit.id, {
      orderChain: [...cloneOrderChain(unit.orderChain), step],
      activeOrderIndex: unit.orderChain?.length ? (unit.activeOrderIndex ?? 0) : 0,
      activeOrderElapsed: unit.orderChain?.length ? (unit.activeOrderElapsed ?? 0) : 0,
      activeOrderWaitElapsed: unit.orderChain?.length ? (unit.activeOrderWaitElapsed ?? 0) : 0,
      activeOrderStarted: unit.orderChain?.length ? Boolean(unit.activeOrderStarted) : false,
    });
    pushCombatEvents(unit.name + ": queued " + step.label + ".");
  }

  function updateOrderStep(unit: WargameUnit, stepId: string, patch: Partial<WargameOrderStep>) {
    updateUnit(unit.id, { orderChain: cloneOrderChain(unit.orderChain).map((step) => step.id === stepId ? { ...step, ...patch, sourceTargets: patch.sourceTargets ? { ...patch.sourceTargets } : step.sourceTargets } : step) });
  }

  function updateOrderSourceTarget(unit: WargameUnit, stepId: string, sourceId: string, targetId?: string) {
    const chain = cloneOrderChain(unit.orderChain);
    const step = chain.find((candidate) => candidate.id === stepId);
    if (!step) return;
    step.sourceTargets = { ...step.sourceTargets, [sourceId]: targetId || undefined };
    updateUnit(unit.id, { orderChain: chain });
  }

  function updateOrderSupportTarget(unit: WargameUnit, stepId: string, supportKey: string, targetId?: string) {
    const chain=cloneOrderChain(unit.orderChain); const step=chain.find((candidate)=>candidate.id===stepId); if(!step)return;
    step.supportTargets={...(step.supportTargets??{}),[supportKey]:targetId||undefined}; updateUnit(unit.id,{orderChain:chain});
  }

  function updateOrderCondition(unit: WargameUnit, stepId: string, field: "startWhen"|"completeWhen"|"branchWhen", patch?: Partial<WargameOrderCondition>) {
    const chain=cloneOrderChain(unit.orderChain); const step=chain.find((candidate)=>candidate.id===stepId); if(!step)return;
    if(!patch){step[field]=undefined;} else { const current=step[field]??{kind:"always" as const}; step[field]={...current,...patch} as WargameOrderCondition; }
    updateUnit(unit.id,{orderChain:chain,activeOrderStarted:false,activeOrderElapsed:0,activeOrderWaitElapsed:0});
  }

  function removeOrderStep(unit: WargameUnit, stepId: string) {
    const chain = cloneOrderChain(unit.orderChain).filter((step) => step.id !== stepId);
    updateUnit(unit.id, { orderChain: chain, activeOrderIndex: Math.min(unit.activeOrderIndex ?? 0, Math.max(0, chain.length - 1)), activeOrderElapsed: 0, activeOrderWaitElapsed: 0, activeOrderStarted: false });
  }

  function moveOrderStep(unit: WargameUnit, stepId: string, delta: -1 | 1) {
    const chain = cloneOrderChain(unit.orderChain);
    const index = chain.findIndex((step) => step.id === stepId);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= chain.length) return;
    [chain[index], chain[target]] = [chain[target], chain[index]];
    updateUnit(unit.id, { orderChain: chain, activeOrderIndex: 0, activeOrderElapsed: 0, activeOrderWaitElapsed: 0, activeOrderStarted: false });
  }

  function clearOrderChain(unit: WargameUnit) {
    updateUnit(unit.id, { orderChain: [], activeOrderIndex: 0, activeOrderElapsed: 0, activeOrderWaitElapsed: 0, activeOrderStarted: false });
    pushCombatEvents(unit.name + ": order chain cleared.");
  }

  function advanceOrderChain(unit: WargameUnit) {
    const chain = unit.orderChain ?? [];
    const nextIndex = Math.min(chain.length, (unit.activeOrderIndex ?? 0) + 1);
    updateUnit(unit.id, { activeOrderIndex: nextIndex, activeOrderElapsed: 0, activeOrderWaitElapsed: 0, activeOrderStarted: false, movementPropulsion: undefined });
    pushCombatEvents(unit.name + ": FC advanced to " + (nextIndex < chain.length ? chain[nextIndex].label : "end of order chain") + ".");
  }

  function runSimulationTick(seconds: number) {
    const transition = executeWargameCommand({
      id: `advance-${sessionRef.current.revision + 1}`,
      kind: "advance",
      source: "human",
      seconds,
      redAiEnabled: aiResponseVisible,
      interdictionZones: terrain.filter((object) => object.kind === "bubble").map((object) => ({ id: object.id, label: object.label, x: object.x, y: object.y, radiusKm: Math.max(1, object.radiusKm ?? 20) })),
    });
    setElapsed(transition.state.elapsedSeconds);
    if (transition.damageOccurred && !engagementStartedRef.current) {
      engagementStartedRef.current = true;
      setPhase((current) => current < 2 ? 2 : current);
      pushCombatEvents("Weapons in range - volley combat has begun.");
    }
    if (transition.combatResolved) {
      setPhase(3);
      setRunning(false);
    }
    pushCombatEvents(...transition.events.map((event) => event.message));
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
    const actor = selectedUnitId ? unitsRef.current.find((candidate) => candidate.id === selectedUnitId) : undefined;
    if (actor && actor.id !== unit.id && (orderMode === "align" || orderMode === "warp")) {
      executeWargameCommand({ id: `nav-${sessionRef.current.revision + 1}`, kind: "movement-order", source: "human", unitId: actor.id, mode: orderMode, targetId: unit.id, rangeKm: actor.range * .7, warpRangeKm: orderMode === "warp" ? warpRangeDraft : 0 });
      pushCombatEvents(`${actor.name}: ${orderMode} order to ${unit.name}${orderMode === "warp" ? ` at ${warpRangeDraft} km` : ""}.`);
      setOrderMode(null); setMovePreview(null); setPhase((current) => current < 1 ? 1 : current); return;
    }
    if (actor && actor.id !== unit.id && orderMode === "engage" && actor.side !== unit.side) {
      assignAllOffence(actor.id, unit.id);
      updateUnit(actor.id, { destinationX: undefined, destinationY: undefined });
      pushCombatEvents(`${actor.name}: full engage ${unit.name} - all damage channels plus tackle/EWAR.`);
      setPhase((current) => current < 1 ? 1 : current); setOrderMode(null); return;
    }
    if (actor && actor.id !== unit.id && orderMode === "logistics" && actor.side === unit.side) {
      assignSupportGroup(actor.id, unit.id, new Set(["remoteShieldRep", "remoteArmorRep"]), "rep");
      pushCombatEvents(`${actor.name}: logistics/reps assigned to ${unit.name}.`);
      setOrderMode(null); return;
    }
    if (actor && actor.id !== unit.id && orderMode === "tackle" && actor.side !== unit.side) {
      assignSupportGroup(actor.id, unit.id, new Set(["tackle", "web"]), "tackle");
      pushCombatEvents(`${actor.name}: tackle/web assigned to ${unit.name}.`);
      setOrderMode(null); return;
    }
    if (actor && actor.id !== unit.id && orderMode === "ewar" && actor.side !== unit.side) {
      assignSupportGroup(actor.id, unit.id, new Set(["targetPainter", "sensorDamp", "trackingDisruptor", "ecm", "energyNeutralizer", "energyNosferatu"]));
      pushCombatEvents(`${actor.name}: EWAR assigned to ${unit.name}.`);
      setOrderMode(null); return;
    }
    setSelectedUnitId(unit.id);
    setMovePreview(null);
  }

  async function hydrateUnfittedHullNavigation(unitId: string, hullName: string) {
    try {
      const bareHull = `[${hullName}, Wargame bare hull]`;
      const result = await analyzeWargameFit(bareHull, corporation.characterId, systemEffects.map((effect) => effect.typeId));
      const current = unitsRef.current.find((candidate) => candidate.id === unitId);
      if (!current || current.fitName || current.simulationReady !== false) return;
      const count = Math.max(1, current.count);
      const bareEhp = Math.max(1, result.perShipEhp * count);
      updateUnit(unitId, {
        speed: Math.max(0, result.speedMps),
        baseSpeed: Math.max(0, result.baseSpeedMps),
        alignTimeSeconds: Math.max(.1, result.alignTimeSeconds),
        warpSpeedAuPerSecond: Math.max(.1, result.warpSpeedAuPerSecond),
        signature: Math.max(1, result.signatureRadiusM),
        targetingRange: Math.max(0, result.targetingRangeKm),
        scanResolution: Math.max(0, result.scanResolution),
        sensorStrength: Math.max(0, result.sensorStrength),
        ehp: bareEhp,
        maxEhp: bareEhp,
        shipsAlive: count,
        primaryEhp: Math.max(1, result.perShipEhp),
        shieldHp: result.shieldHp,
        armorHp: result.armorHp,
        structureHp: result.structureHp,
        shieldResists: result.shieldResists,
        armorResists: result.armorResists,
        hullResists: result.hullResists,
        simulationReady: false,
      });
      pushCombatEvents(`${current.name}: movement profile loaded. Link a fit to enable combat.`);
    } catch (error) {
      pushCombatEvents(`${hullName}: movement profile unavailable.`);
    }
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
        const baseline = unconfiguredScenarioStats();
        executeWargameCommand({ id: `add-${sessionRef.current.revision + 1}`, kind: "add-unit", source: "human", unit: prepareWargameUnit({
          id,
          name: asset.name!,
          typeId: asset.typeId,
          side: deploymentSide,
          count: 1,
          ...point,
          em: 60,
          therm: 60,
          kin: 60,
          exp: 60,
          role: `${asset.groupName || "Unassigned"} / FIT REQUIRED`,
          ...baseline,
        }) });
        setSelectedUnitId(id);
        void hydrateUnfittedHullNavigation(id, asset.name!);
      } else if (asset.kind === "terrain" && asset.terrainKind && asset.name && asset.glyph) {
        setTerrain((current) => [...current, { id: `terrain-${Date.now()}`, kind: asset.terrainKind!, label: asset.name!, glyph: asset.glyph!, ...point, side: deploymentSide, radiusKm: asset.terrainKind === "bubble" ? 20 : undefined }]);
      }
    } catch {
      // Ignore malformed drag payloads from outside the wargame workspace.
    }
  }

  function commitMove() {
    if (!movePreview) return;
    const unit = units.find((candidate) => candidate.id === movePreview.unitId);
    executeWargameCommand({ id: `nav-${sessionRef.current.revision + 1}`, kind: "movement-order", source: "human", unitId: movePreview.unitId, mode: "approach", x: movePreview.x, y: movePreview.y, rangeKm: 0 });
    if (unit) pushCombatEvents(`${unit.name}: movement order committed.`);
    setPhase((current) => current < 1 ? 1 : current);
    setMovePreview(null);
    setOrderMode(null);
  }

  function startRetreat() {
    if (!selectedUnit) return;
    setPhase(3);
    executeWargameCommand({ id: `nav-${sessionRef.current.revision + 1}`, kind: "movement-order", source: "human", unitId: selectedUnit.id, mode: "disengage", targetId: selectedTarget?.id, rangeKm: 100 });
    pushCombatEvents(`${selectedUnit.name}: disengage order issued. Burn clear, then align/warp when able.`);
    setOrderMode(null);
    setMovePreview(null);
  }

  function resetScenario() {
    const initial = INITIAL_UNITS.map(prepareWargameUnit);
    unitsRef.current = initial;
    setUnits(initial);
    setTerrain(INITIAL_TERRAIN.map((object) => ({ ...object })));
    setSelectedUnitId("");
    setMovePreview(null);
    setOrderMode(null);
    setPhase(0);
    sessionRef.current = createWargameSession(initial ?? [], WARGAME_DEFAULT_RNG_SEED);
    commandHistoryRef.current = [];
    setElapsed(0);
    setRunning(false);
    setAiResponseVisible(true);
    setFitImportText("");
    setFitImportStatus("");
    setFitImportOpen(false);
    setSystemEffects([]);
    setSystemEffectDraft("");
    setOrderDraftTarget("");
    setOrderDraftCompletionTarget("");
    resetMapCamera();
    engagementStartedRef.current = false;
    setCombatEvents(["Scenario reset - empty board ready for FC deployment."]);
  }

  function clearScenario() {
    unitsRef.current = [];
    setUnits([]);
    setTerrain([]);
    setSelectedUnitId("");
    setMovePreview(null);
    setOrderMode(null);
    setPhase(0);
    sessionRef.current = createWargameSession([], WARGAME_DEFAULT_RNG_SEED);
    commandHistoryRef.current = [];
    setElapsed(0);
    setRunning(false);
    setAiResponseVisible(false);
    setSystemEffects([]);
    setSystemEffectDraft("");
    setOrderDraftTarget("");
    setOrderDraftCompletionTarget("");
    setFitImportText("");
    setFitImportStatus("");
    setFitImportOpen(false);
    resetMapCamera();
    engagementStartedRef.current = false;
    setCombatEvents(["Empty scenario ready — deploy forces from the asset library."]);
  }

  const redMain = units.find((unit) => unit.side === "red" && unit.role.toLowerCase().includes("mainline")) ?? units.find((unit) => unit.side === "red");
  const blueLogi = units.find((unit) => unit.side === "blue" && unit.role.toLowerCase().includes("logistics"));
  const redTacticalSummary = !aiResponseVisible ? "Red Team AI disabled" : blueLogi ? `Pressure ${blueLogi.name}` : redMain ? "Maintain pressure / seek vulnerable support" : "Awaiting hostile deployment";
  const selectedTarget = selectedUnit?.targetId ? units.find((unit) => unit.id === selectedUnit.targetId && unit.ehp > 0) : undefined;
  const selectedTargetRange = selectedUnit && selectedTarget ? wargameDistanceKm(selectedUnit, selectedTarget) : null;
  const selectedSourceStats = selectedUnit?.damageSources?.map((source) => { const target = source.targetId ? units.find((candidate) => candidate.id === source.targetId && candidate.ehp > 0) : undefined; const range = target ? wargameDistanceKm(selectedUnit, target) : 0; const application = target ? damageSourceApplication(selectedUnit, source, target, range) : 0; return { source, target, range, application }; }) ?? [];
  const selectedSourceWeight = selectedSourceStats.reduce((sum, row) => sum + Math.max(0, row.source.dpsPerShip), 0);
  const selectedApplication = selectedSourceStats.length ? selectedSourceStats.reduce((sum, row) => sum + row.application * Math.max(0, row.source.dpsPerShip), 0) / Math.max(1e-12, selectedSourceWeight) : selectedUnit && selectedTarget ? weaponApplication(selectedUnit, selectedTarget, selectedTargetRange ?? undefined) : (selectedUnit?.application ?? 0);
  const selectedRangeRate = selectedUnit && selectedTarget ? rangeRateMps(selectedUnit, selectedTarget) : null;
  const selectedRepTarget = selectedUnit?.repTargetId ? units.find((unit) => unit.id === selectedUnit.repTargetId) : undefined;
  const selectedWebbers = selectedUnit ? units.filter((unit) => unit.side !== selectedUnit.side && unit.ehp > 0 && unit.webStrength && unit.webRange && unit.targetId === selectedUnit.id && wargameDistanceKm(unit, selectedUnit) <= unit.webRange) : [];
  const selectedHostiles = selectedUnit ? units.filter((unit) => unit.side !== selectedUnit.side) : [];
  const selectedFriendlies = selectedUnit ? units.filter((unit) => unit.side === selectedUnit.side && unit.id !== selectedUnit.id) : [];
  const selectedVolley = selectedUnit ? (selectedSourceStats.length ? selectedSourceStats.reduce((sum, row) => sum + sourcePaperVolley(selectedUnit, row.source) * row.application, 0) : selectedTarget ? ((selectedUnit.volleyPerShip && selectedUnit.volleyPerShip > 0 ? selectedUnit.volleyPerShip * liveShipCount(selectedUnit) : selectedUnit.dps * Math.max(1, selectedUnit.weaponCycle ?? defaultWeaponCycle(selectedUnit)) * (liveShipCount(selectedUnit) / Math.max(1, selectedUnit.count))) * selectedApplication) : 0) : 0;
  const selectedReadySources = selectedSourceStats.filter((row) => row.target && (row.source.fireCooldown ?? 0) <= 0 && (row.source.lockRemaining ?? 0) <= 0 && (row.source.droneArrivalRemaining ?? 0) <= 0).length;

  const combatEffectLinks = useMemo(() => {
    type EffectKind = "dps" | "logistics" | "ewar";
    type EffectLink = { key: string; kind: EffectKind; from: WargameUnit; to: WargameUnit; channels: number };
    const merged = new Map<string, EffectLink>();
    const add = (kind: EffectKind, from: WargameUnit, to: WargameUnit) => {
      if (from.id === to.id || from.ehp <= 0 || to.ehp <= 0 || from.movementState === "warping" || to.movementState === "warping") return;
      const key = kind + ":" + from.id + ":" + to.id;
      const current = merged.get(key);
      if (current) current.channels += 1;
      else merged.set(key, { key, kind, from, to, channels: 1 });
    };
    const friendlySupport = new Set(["remoteShieldRep", "remoteArmorRep", "remoteCapacitor", "remoteSensorBooster", "remoteTrackingComputer"]);

    for (const unit of units) {
      if (unit.ehp <= 0 || liveShipCount(unit) <= 0 || unit.movementState === "warping") continue;

      if (unit.damageSources?.length) {
        for (const source of unit.damageSources) {
          const target = source.targetId ? units.find((candidate) => candidate.id === source.targetId && candidate.side !== unit.side && candidate.ehp > 0) : undefined;
          if (!target) continue;
          if (source.kind === "drone" && (source.droneArrivalRemaining ?? 0) > 0) continue;
          const range = wargameDistanceKm(unit, target);
          if (damageSourceApplication(unit, source, target, range) > .005) add("dps", unit, target);
        }
      } else if (unit.dps > 0 && unit.targetId) {
        const target = units.find((candidate) => candidate.id === unit.targetId && candidate.side !== unit.side && candidate.ehp > 0);
        if (target && weaponApplication(unit, target, wargameDistanceKm(unit, target)) > .005) add("dps", unit, target);
      }

      for (let index = 0; index < (unit.supportSystems?.length ?? 0); index += 1) {
        const system = unit.supportSystems![index];
        const side = wargameSupportTargetSide(system.kind);
        if (side === "none") continue;
        const supportKey = wargameSupportSystemKey(system, index);
        const assigned = Object.prototype.hasOwnProperty.call(unit.supportTargetIds ?? {}, supportKey);
        const targetId = assigned ? unit.supportTargetIds?.[supportKey] : side === "friendly" ? unit.repTargetId : unit.targetId;
        const target = targetId ? units.find((candidate) => candidate.id === targetId && candidate.ehp > 0) : undefined;
        if (!target || (side === "friendly" ? target.side !== unit.side : target.side === unit.side)) continue;
        const range = wargameDistanceKm(unit, target);
        const optimal = Math.max(0, Number(system.optimalM) || 0) / 1000;
        const falloff = Math.max(0, Number(system.falloffM) || 0) / 1000;
        if (range > Math.max(.1, optimal + falloff * 2)) continue;
        add(friendlySupport.has(system.kind) ? "logistics" : "ewar", unit, target);
      }

      if (!(unit.supportSystems?.some((system) => system.kind === "remoteShieldRep" || system.kind === "remoteArmorRep")) && (unit.repPerSecond ?? 0) > 0 && unit.repTargetId) {
        const target = units.find((candidate) => candidate.id === unit.repTargetId && candidate.side === unit.side && candidate.ehp > 0);
        if (target && wargameDistanceKm(unit, target) <= Math.max(.1, unit.repRange ?? 0)) add("logistics", unit, target);
      }
      if (!(unit.supportSystems?.some((system) => ["web", "tackle", "targetPainter", "sensorDamp", "trackingDisruptor", "ecm", "energyNeutralizer", "energyNosferatu"].includes(system.kind))) && unit.targetId) {
        const target = units.find((candidate) => candidate.id === unit.targetId && candidate.side !== unit.side && candidate.ehp > 0);
        if (target) {
          const range = wargameDistanceKm(unit, target);
          const manualRange = Math.max(unit.webRange ?? 0, unit.tackleRange ?? 0);
          if (manualRange > 0 && range <= manualRange) add("ewar", unit, target);
        }
      }
    }
    return [...merged.values()];
  }, [units]);

  return <div className={`fleet-wargame-view ${leftCollapsed ? "assets-collapsed" : ""} ${rightCollapsed ? "inspector-collapsed" : ""}`}>
    <header className="wargame-command-strip">
      <div className="wargame-strip-identity">
        <button type="button" className="wargame-back" onClick={() => onNavigate("doctrines")} title="Return to Fleet Command">‹</button>
        <div><span>TACTICAL WARGAME</span><strong>{corporation.name}</strong></div>
      </div>
      <div className="wargame-scenario-name"><span>SCENARIO</span><strong>New Tactical Scenario</strong><small>{PHASES[phase].short} · T+ {formatTime}</small></div>
      <div className={`wargame-red-intel-strip ${aiResponseVisible ? "active" : "disabled"}`}><span>RED TEAM TACTICS</span><strong>{redTacticalSummary}</strong><small>{aiResponseVisible && redMain ? "Red response projected" : "No tactical projection on map"}</small></div>
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

        <section className="wargame-system-effects">
          <div className="wargame-section-title"><span>SYSTEM EFFECTS</span><small>environment modifiers</small></div>
          <div className="wargame-system-effect-add">
            <input list="wargame-system-effect-presets" value={systemEffectDraft} onChange={(event) => setSystemEffectDraft(event.target.value)} placeholder="Class 5 Magnetar Effects..." />
            <datalist id="wargame-system-effect-presets">{COMMON_WARGAME_SYSTEM_EFFECTS.map((effect) => <option key={effect.typeId} value={effect.name} />)}</datalist>
            <button type="button" disabled={!systemEffectDraft.trim() || systemEffectBusy} onClick={() => void addScenarioSystemEffect()}>{systemEffectBusy ? "Applying..." : "Apply"}</button>
          </div>
          <div className="wargame-system-effect-list">
            {systemEffects.length ? systemEffects.map((effect) => <button type="button" key={effect.typeId} onClick={() => void removeScenarioSystemEffect(effect.typeId)} title="Remove system effect"><span>{effect.name}</span><b>×</b></button>) : <small>Normal-space baseline. Add wormhole, incursion or another CCP environment effect.</small>}
          </div>
          <small className="wargame-system-note">Linked fit stats update automatically.</small>
        </section>

        {assetTab === "ships" && <>
          <label className="wargame-search"><span>⌕</span><input value={shipFilter} onChange={(event) => setShipFilter(event.target.value)} placeholder="Search every EVE hull..." /></label>
          <div className="wargame-library-meta"><span>{ships.length ? `${ships.length.toLocaleString()} hulls` : "Loading hull catalogue..."}</span><small>Drag a hull onto the tactical board</small></div>
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
        onWheel={handleMapWheel}
      >

        <div className="wargame-map-toolbar" onClick={(event) => event.stopPropagation()}>
          <button type="button" className={orderMode === "move" ? "active" : ""} disabled={!selectedUnit} onClick={() => { setOrderMode(orderMode === "move" ? null : "move"); setMovePreview(null); }}>↗ Plot move</button>
          <button type="button" className={orderMode === "engage" ? "active danger" : ""} disabled={!selectedUnit} onClick={() => { setOrderMode(orderMode === "engage" ? null : "engage"); setMovePreview(null); }}>◎ Set target</button>
          <button type="button" onClick={() => { setMovePreview(null); setOrderMode(null); if (selectedUnit) { assignAllOffence(selectedUnit.id, undefined); updateUnit(selectedUnit.id, { targetId: undefined, destinationX: undefined, destinationY: undefined, movementPropulsion: undefined }); } }}>■ Hold</button>
          <span>{orderMode === "move" ? "CLICK MAP TO PLOT DESTINATION" : orderMode === "engage" ? "CLICK A HOSTILE TO FULL ENGAGE" : orderMode === "logistics" ? "CLICK A FRIENDLY TO ASSIGN REPS" : orderMode === "tackle" ? "CLICK A HOSTILE TO ASSIGN TACKLE / WEBS" : orderMode === "ewar" ? "CLICK A HOSTILE TO ASSIGN EWAR" : orderMode === "align" ? "CLICK A FLEET OR FC-PLACED OBJECT TO ALIGN" : orderMode === "warp" ? "CHOOSE BELOW OR CLICK AN FC-PLACED WARP TARGET" : "DRAG ASSETS - CLICK UNIT TO COMMAND"}</span>
        </div>

        <div className="wargame-map-scale"><span>TACTICAL GRID</span><strong>250 km × 250 km</strong><small>ZOOM {Math.round(mapCamera.zoom * 100)}% · mouse wheel</small><button type="button" onClick={(event) => { event.stopPropagation(); nudgeMapZoom(1 / 1.35); }}>−</button><button type="button" onClick={(event) => { event.stopPropagation(); nudgeMapZoom(1.35); }}>+</button><button type="button" onClick={(event) => { event.stopPropagation(); resetMapCamera(); }}>RESET</button></div>
        <div className="wargame-combat-fx-legend" aria-hidden="true"><span className="dps"><i />DPS</span><span className="logistics"><i />LOGISTICS</span><span className="ewar"><i />EWAR</span></div>

        <div className="wargame-map-camera" style={{ transform: `translate3d(${mapCamera.panX}px, ${mapCamera.panY}px, 0) scale(${mapCamera.zoom})` }}>        <div className="wargame-grid-glow" />
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
          {units.flatMap((unit) => {
            const sourceLines = (unit.damageSources ?? []).flatMap((source) => {
              const target = source.targetId ? units.find((candidate) => candidate.id === source.targetId) : null;
              return target ? [<line key={unit.id + "-source-" + source.id} className={"attack-vector " + unit.side + " source-" + source.kind} x1={unit.x} y1={unit.y} x2={target.x} y2={target.y} markerEnd={"url(#" + unit.side + "-arrow)"} />] : [];
            });
            const supportLines=(unit.supportSystems ?? []).flatMap((system,supportIndex)=>{
              const side=wargameSupportTargetSide(system.kind); if(side === "none")return [];
              const key=wargameSupportSystemKey(system,supportIndex); const hasAssigned=Object.prototype.hasOwnProperty.call(unit.supportTargetIds??{},key);
              const targetId=hasAssigned ? unit.supportTargetIds?.[key] : side === "friendly" ? unit.repTargetId : unit.targetId;
              const target=targetId ? units.find((candidate)=>candidate.id===targetId) : null;
              return target ? [<line key={unit.id+"-support-"+key} className={"attack-vector "+unit.side+" source-support source-"+system.kind} x1={unit.x} y1={unit.y} x2={target.x} y2={target.y} markerEnd={"url(#"+unit.side+"-arrow)"}/>] : [];
            });
            if(sourceLines.length || supportLines.length)return [...sourceLines,...supportLines];
            const target = unit.targetId ? units.find((candidate) => candidate.id === unit.targetId) : null;
            return target ? [<line key={unit.id + "-target"} className={"attack-vector " + unit.side} x1={unit.x} y1={unit.y} x2={target.x} y2={target.y} markerEnd={"url(#" + unit.side + "-arrow)"} />] : [];
          })}
          {movePreview && (() => {
            const unit = units.find((candidate) => candidate.id === movePreview.unitId);
            return unit ? <line className={`move-vector ${unit.side}`} x1={unit.x} y1={unit.y} x2={movePreview.x} y2={movePreview.y} markerEnd={`url(#${unit.side}-arrow)`} /> : null;
          })()}
          {running && combatEffectLinks.flatMap((link) => {
            const dx = link.to.x - link.from.x;
            const dy = link.to.y - link.from.y;
            const length = Math.max(.001, Math.hypot(dx, dy));
            const nx = -dy / length;
            const ny = dx / length;
            const streaks = Math.max(2, Math.min(5, 2 + Math.floor(Math.log2(Math.max(1, link.channels)))));
            return Array.from({ length: streaks }, (_, streakIndex) => {
              const lane = (streakIndex - (streaks - 1) / 2) * .18;
              const duration = link.kind === "dps" ? .68 : link.kind === "logistics" ? 1.08 : .86;
              return <line
                key={link.key + "-fx-" + streakIndex}
                className={"combat-effect-streak " + link.kind}
                pathLength={100}
                x1={link.from.x + nx * lane}
                y1={link.from.y + ny * lane}
                x2={link.to.x + nx * lane}
                y2={link.to.y + ny * lane}
                style={{ animationDelay: (-streakIndex * duration / streaks) + "s", animationDuration: duration + "s" }}
              />;
            });
          })}
        </svg>

        {terrain.map((object) => <div className={`wargame-terrain-object terrain-${object.kind} ${(orderMode === "align" || orderMode === "warp") ? "targetable" : ""}`} key={object.id} style={{ left: `${object.x}%`, top: `${object.y}%` }} title={object.label} role={(orderMode === "align" || orderMode === "warp") ? "button" : undefined} onClick={(event) => { event.stopPropagation(); if ((orderMode === "align" || orderMode === "warp") && selectedUnit) { executeWargameCommand({ id: `nav-${sessionRef.current.revision + 1}`, kind: "movement-order", source: "human", unitId: selectedUnit.id, mode: orderMode, x: object.x, y: object.y, rangeKm: 0, warpRangeKm: orderMode === "warp" ? warpRangeDraft : 0 }); pushCombatEvents(`${selectedUnit.name}: ${orderMode} order to ${object.label}${orderMode === "warp" ? ` at ${warpRangeDraft} km` : ""}.`); setOrderMode(null); setPhase((current) => current < 1 ? 1 : current); } }}>
          <b>{object.glyph}</b><span>{object.label}</span>
        </div>)}

        {units.map((unit) => <button
          type="button"
          draggable
          key={unit.id}
          className={`wargame-map-unit ${unit.side} ${selectedUnitId === unit.id ? "selected" : ""} ${unit.ehp <= 0 ? "destroyed" : ""} ${unit.movementState === "warping" ? "warping" : unit.movementState === "aligning" ? "aligning" : ""} ${selectedUnitId !== unit.id && ((orderMode === "engage" && selectedUnit?.side !== unit.side) || (orderMode === "logistics" && selectedUnit?.side === unit.side) || ((orderMode === "tackle" || orderMode === "ewar") && selectedUnit?.side !== unit.side) || orderMode === "align" || orderMode === "warp") ? "targetable" : ""}`}
          style={{ left: `${unit.x}%`, top: `${unit.y}%` }}
          onClick={(event) => handleUnitClick(event, unit)}
          onDragStart={(event) => { event.stopPropagation(); event.dataTransfer.setData("application/x-wargame-unit", unit.id); }}
        >
          <span className="wargame-unit-glyph"><i /><b>{liveShipCount(unit) > 1 ? liveShipCount(unit) : ""}</b></span>
          <span className="wargame-unit-copy"><strong>{unit.name}</strong><small>{unit.ehp <= 0 ? "DESTROYED" : `${liveShipCount(unit)} / ${unit.count} ships · ${unit.movementState && unit.movementState !== "idle" ? unit.movementState.toUpperCase() + " · " : ""}${unit.role}`}</small></span>
          <span className="wargame-unit-health"><i style={{ width: `${healthPercent(unit)}%` }} /></span>
        </button>)}

        {movePreview && (() => {
          const unit = units.find((candidate) => candidate.id === movePreview.unitId);
          return unit ? <button type="button" className={`wargame-map-unit ghost ${unit.side}`} style={{ left: `${movePreview.x}%`, top: `${movePreview.y}%` }} onClick={(event) => event.stopPropagation()}>
            <span className="wargame-unit-glyph"><i /><b>{unit.count > 1 ? unit.count : ""}</b></span>
            <span className="wargame-unit-copy"><strong>PLANNED POSITION</strong><small>{unit.name}</small></span>
          </button> : null;
        })()}


        </div>

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
            <button type="button" className={orderMode === "engage" ? "active danger" : ""} onClick={() => setOrderMode("engage")}><span>◆</span>Engage</button>
            <button type="button" className={orderMode === "align" ? "active" : ""} onClick={() => { setOrderMode("align"); setMovePreview(null); }}><span>→</span>Align</button>
            <button type="button" className={orderMode === "warp" ? "active warp" : ""} onClick={() => { setOrderMode("warp"); setMovePreview(null); }}><span>✦</span>Warp</button>
            <button type="button" className={orderMode === "logistics" ? "active logistics" : ""} onClick={() => setOrderMode("logistics")}><span>＋</span>Logi</button>
            <button type="button" className={orderMode === "tackle" ? "active tackle" : ""} onClick={() => setOrderMode("tackle")}><span>◎</span>Tackle</button>
            <button type="button" className={orderMode === "ewar" ? "active ewar" : ""} onClick={() => setOrderMode("ewar")}><span>⌁</span>EWAR</button>
            <button type="button" onClick={() => { assignAllOffence(selectedUnit.id, undefined); executeWargameCommand({ id: `nav-${sessionRef.current.revision + 1}`, kind: "movement-order", source: "human", unitId: selectedUnit.id, mode: "hold" }); setOrderMode(null); setMovePreview(null); }}><span>■</span>Hold</button>
            <button type="button" onClick={startRetreat}><span>⇥</span>Retreat</button>
          </div>
          {orderMode === "warp" && <div className="wargame-warp-picker">
            <div><span>WARP DESTINATION</span><small>only FC-placed objects are available</small></div>
            <label><span>Land at</span><select value={warpRangeDraft} onChange={(event) => setWarpRangeDraft(Math.max(0, Math.min(100, Number(event.target.value) || 0)))}>{[0,10,20,30,50,70,100].map((range) => <option key={range} value={range}>{range} km</option>)}</select></label>
            <label><span>Warp where</span><select defaultValue="" onChange={(event) => issueWarpDestination(event.target.value)}>
              <option value="">Choose destination...</option>
              {units.filter((target) => target.id !== selectedUnit.id && target.ehp > 0).length > 0 && <optgroup label="FLEETS">{units.filter((target) => target.id !== selectedUnit.id && target.ehp > 0).map((target) => <option key={target.id} value={`unit:${target.id}`}>{target.side === selectedUnit.side ? "ALLY" : "HOSTILE"} - {target.name}</option>)}</optgroup>}
              {terrain.some((item) => item.kind === "stargate") && <optgroup label="GATES">{terrain.filter((item) => item.kind === "stargate").map((item) => <option key={item.id} value={`terrain:${item.id}`}>{item.label}</option>)}</optgroup>}
              {terrain.some((item) => item.kind === "station" || item.kind === "upwell") && <optgroup label="STRUCTURES">{terrain.filter((item) => item.kind === "station" || item.kind === "upwell").map((item) => <option key={item.id} value={`terrain:${item.id}`}>{item.label}</option>)}</optgroup>}
              {terrain.some((item) => !["stargate","station","upwell","bubble"].includes(item.kind)) && <optgroup label="CELESTIALS / TACTICAL">{terrain.filter((item) => !["stargate","station","upwell","bubble"].includes(item.kind)).map((item) => <option key={item.id} value={`terrain:${item.id}`}>{item.label}</option>)}</optgroup>}
            </select></label>
          </div>}

          <section className="wargame-order-chain">
            <div className="wargame-section-title"><span>FC ORDER CHAIN</span><small>sequential tactical instructions</small></div>
            <div className="wargame-order-draft">
              <label><span>Default hostile</span><select value={orderDraftTarget} onChange={(event) => setOrderDraftTarget(event.target.value)}><option value="">Choose target...</option>{selectedHostiles.map((target) => <option key={target.id} value={target.id}>{target.name} ×{liveShipCount(target)}</option>)}</select></label>
              <label><span>Advance when</span><select value={orderDraftCompletionTarget} onChange={(event) => setOrderDraftCompletionTarget(event.target.value)}><option value="">Same target destroyed</option>{selectedHostiles.map((target) => <option key={target.id} value={target.id}>{target.name} destroyed</option>)}</select></label>
              <label><span>Movement</span><select value={orderDraftPropulsion} onChange={(event) => setOrderDraftPropulsion(event.target.value as WargamePropulsionOrder)}><option value="cruise">Cruise / prop conservative</option><option value="prop-on">Prop ON / MWD-AB full</option></select></label>
              <button type="button" className="primary" onClick={() => addOrderStep(selectedUnit)}>+ Add order step</button>
              {(selectedUnit.orderChain?.length ?? 0) > 0 && (selectedUnit.activeOrderIndex ?? 0) < (selectedUnit.orderChain?.length ?? 0) && <button type="button" onClick={() => advanceOrderChain(selectedUnit)}>Advance now</button>}
              {(selectedUnit.orderChain?.length ?? 0) > 0 && <button type="button" onClick={() => clearOrderChain(selectedUnit)}>Clear chain</button>}
            </div>
            <div className="wargame-order-chain-list">
              {(selectedUnit.orderChain ?? []).map((step, stepIndex) => {
                const active = stepIndex === (selectedUnit.activeOrderIndex ?? 0);
                return <article key={step.id} className={active ? "active" : ""}>
                  <header><b>{stepIndex + 1}</b><input value={step.label} onChange={(event) => updateOrderStep(selectedUnit, step.id, { label: event.target.value })} /><span>{active ? "EXECUTING" : stepIndex < (selectedUnit.activeOrderIndex ?? 0) ? "COMPLETE" : "QUEUED"}</span><button type="button" disabled={stepIndex === 0} onClick={() => moveOrderStep(selectedUnit, step.id, -1)}>↑</button><button type="button" disabled={stepIndex === (selectedUnit.orderChain?.length ?? 1) - 1} onClick={() => moveOrderStep(selectedUnit, step.id, 1)}>↓</button><button type="button" onClick={() => removeOrderStep(selectedUnit, step.id)}>×</button></header>
                  <div className="wargame-order-fire-grid">
                    {(selectedUnit.damageSources ?? []).map((source) => <label key={source.id}><span>{source.kind.toUpperCase()} · {source.name}</span><select value={step.sourceTargets[source.id] ?? ""} onChange={(event) => updateOrderSourceTarget(selectedUnit, step.id, source.id, event.target.value || undefined)}><option value="">Hold fire</option>{selectedHostiles.map((target) => <option key={target.id} value={target.id}>{target.name}</option>)}</select></label>)}
                    {!(selectedUnit.damageSources?.length) && <label><span>PRIMARY / LEGACY DAMAGE</span><select value={step.tackleTargetId ?? ""} onChange={(event) => updateOrderStep(selectedUnit, step.id, { tackleTargetId: event.target.value || undefined })}><option value="">No target</option>{selectedHostiles.map((target) => <option key={target.id} value={target.id}>{target.name}</option>)}</select></label>}
                    {(selectedUnit.supportSystems ?? []).map((system, supportIndex) => {
                      const supportKey=wargameSupportSystemKey(system,supportIndex); const side=wargameSupportTargetSide(system.kind);
                      if(side === "none") return <label key={supportKey} className="wargame-command-burst-channel"><span>{system.name}</span><small>Fleet aura · no direct target</small></label>;
                      const choices=side === "friendly" ? selectedFriendlies : selectedHostiles;
                      return <label key={supportKey}><span>{system.kind.replace(/([A-Z])/g," $1").toUpperCase()} · {system.name}</span><select value={step.supportTargets?.[supportKey] ?? ""} onChange={(event) => updateOrderSupportTarget(selectedUnit, step.id, supportKey, event.target.value || undefined)}><option value="">{side === "friendly" ? "Auto / unassigned" : "No target"}</option>{choices.map((target) => <option key={target.id} value={target.id}>{target.name}</option>)}</select></label>;
                    })}
                    {!(selectedUnit.supportSystems?.length) && <><label><span>TACKLE / OFFENSIVE EWAR</span><select value={step.tackleTargetId ?? ""} onChange={(event) => updateOrderStep(selectedUnit, step.id, { tackleTargetId: event.target.value || undefined })}><option value="">None</option>{selectedHostiles.map((target) => <option key={target.id} value={target.id}>{target.name}</option>)}</select></label><label><span>REMOTE REPS</span><select value={step.repTargetId ?? ""} onChange={(event) => updateOrderStep(selectedUnit, step.id, { repTargetId: event.target.value || undefined })}><option value="">Auto logistics</option>{selectedFriendlies.map((target) => <option key={target.id} value={target.id}>{target.name}</option>)}</select></label></>}
                    <label><span>MOVEMENT ORDER</span><select value={step.movement ?? "legacy"} onChange={(event) => updateOrderStep(selectedUnit, step.id, { movement: event.target.value as WargameMovementOrder })}><option value="legacy">Legacy stance movement</option><option value="approach">Approach</option><option value="orbit">Orbit</option><option value="keep-range">Keep at range</option><option value="anchor">Anchor on</option><option value="align">Align to</option><option value="warp">Warp to</option><option value="disengage">Disengage / burn away</option><option value="hold">Hold position</option></select></label>
                    <label><span>NAV TARGET</span><select value={step.moveTargetId ? `unit:${step.moveTargetId}` : step.moveTerrainId ? `terrain:${step.moveTerrainId}` : ""} onChange={(event) => { const value = event.target.value; if (value.startsWith("unit:")) updateOrderStep(selectedUnit, step.id, { moveTargetId: value.slice(5), moveTerrainId: undefined, moveX: undefined, moveY: undefined }); else if (value.startsWith("terrain:")) { const object = terrain.find((item) => item.id === value.slice(8)); if (object) updateOrderStep(selectedUnit, step.id, { moveTargetId: undefined, moveTerrainId: object.id, moveX: object.x, moveY: object.y }); } else updateOrderStep(selectedUnit, step.id, { moveTargetId: undefined, moveTerrainId: undefined, moveX: undefined, moveY: undefined }); }}><option value="">No navigation target</option>{units.filter((target) => target.id !== selectedUnit.id).map((target) => <option key={target.id} value={`unit:${target.id}`}>{target.side === selectedUnit.side ? "ALLY" : "HOSTILE"} · {target.name}</option>)}{terrain.map((object) => <option key={object.id} value={`terrain:${object.id}`}>TERRAIN · {object.label}</option>)}</select></label>
                    {step.movement && !["legacy", "hold", "align"].includes(step.movement) && <label><span>{step.movement === "warp" ? "WARP IN RANGE" : "NAV RANGE"}</span><input type="number" min="0" max={step.movement === "warp" ? 100 : undefined} value={step.movement === "warp" ? (step.warpRangeKm ?? 0) : (step.movementRangeKm ?? 0)} onChange={(event) => step.movement === "warp" ? updateOrderStep(selectedUnit, step.id, { warpRangeKm: Math.max(0, Math.min(100, Number(event.target.value) || 0)) }) : updateOrderStep(selectedUnit, step.id, { movementRangeKm: Math.max(0, Number(event.target.value) || 0) })}/><small>km</small></label>}
                    <label><span>PROPULSION</span><select value={step.propulsion ?? "cruise"} onChange={(event) => updateOrderStep(selectedUnit, step.id, { propulsion: event.target.value as WargamePropulsionOrder })}><option value="cruise">Cruise</option><option value="prop-on">Prop ON {selectedUnit.propulsionKind ? "(" + selectedUnit.propulsionKind.toUpperCase() + ")" : "(MWD/AB)"}</option></select></label>
                    <label><span>STANCE</span><select value={step.stance ?? selectedUnit.stance ?? "kite"} onChange={(event) => updateOrderStep(selectedUnit, step.id, { stance: event.target.value as WargameStance })}><option value="pursue">Pursue</option><option value="kite">Kite</option><option value="brawl">Brawl</option><option value="screen">Screen</option><option value="support">Support</option><option value="hold">Hold</option></select></label>
                    <label><span>STEP COMPLETE</span><select value={step.completion} onChange={(event) => updateOrderStep(selectedUnit, step.id, { completion: event.target.value as WargameOrderStep["completion"] })}><option value="target-destroyed">When target destroyed</option><option value="arrived">When movement arrives</option><option value="after-seconds">After N seconds</option><option value="manual">Manual</option></select></label>
                    {step.completion === "target-destroyed" && <label><span>COMPLETION TARGET</span><select value={step.completionTargetId ?? ""} onChange={(event) => updateOrderStep(selectedUnit, step.id, { completionTargetId: event.target.value || undefined })}><option value="">Choose...</option>{selectedHostiles.map((target) => <option key={target.id} value={target.id}>{target.name}</option>)}</select></label>}
                    {step.completion === "after-seconds" && <label><span>DURATION</span><input type="number" min="1" value={step.completionSeconds ?? orderDraftSeconds} onChange={(event) => updateOrderStep(selectedUnit, step.id, { completionSeconds: Math.max(1, Number(event.target.value) || 1) })} /><small>s</small></label>}
                    <div className="wargame-order-condition-grid">
                      <label><span>START WHEN</span><select value={step.startWhen?.kind ?? "always"} onChange={(event) => { const kind=event.target.value as WargameOrderCondition["kind"]; updateOrderCondition(selectedUnit,step.id,"startWhen",kind === "always" ? undefined : {kind}); }}><option value="always">Immediately</option>{WARGAME_CONDITION_OPTIONS.filter((item)=>item.value!=="always"&&item.value!=="manual"&&item.value!=="arrived").map((item)=><option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
                      {step.startWhen && wargameConditionUsesTarget(step.startWhen.kind) && <label><span>START TARGET</span><select value={step.startWhen.targetId ?? ""} onChange={(event)=>updateOrderCondition(selectedUnit,step.id,"startWhen",{targetId:event.target.value||undefined})}><option value="">Choose target...</option>{units.filter((candidate)=>candidate.id!==selectedUnit.id).map((target)=><option key={target.id} value={target.id}>{target.name}</option>)}</select></label>}
                      {step.startWhen && wargameConditionUsesThreshold(step.startWhen.kind) && <label><span>START VALUE</span><input type="number" value={step.startWhen.threshold ?? (step.startWhen.kind.includes("health")||step.startWhen.kind.includes("cap")?50:20)} onChange={(event)=>updateOrderCondition(selectedUnit,step.id,"startWhen",{threshold:Number(event.target.value)||0})}/></label>}
                      {step.startWhen && wargameConditionUsesSeconds(step.startWhen.kind) && <label><span>START DELAY</span><input type="number" min="0" value={step.startWhen.seconds ?? 10} onChange={(event)=>updateOrderCondition(selectedUnit,step.id,"startWhen",{seconds:Math.max(0,Number(event.target.value)||0)})}/><small>s</small></label>}
                      <label><span>ADVANCED COMPLETE</span><select value={step.completeWhen?.kind ?? ""} onChange={(event)=>{const value=event.target.value;updateOrderCondition(selectedUnit,step.id,"completeWhen",value?{kind:value as WargameOrderCondition["kind"]}:undefined);}}><option value="">Use Step Complete above</option>{WARGAME_CONDITION_OPTIONS.filter((item)=>item.value!=="always").map((item)=><option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
                      {step.completeWhen && wargameConditionUsesTarget(step.completeWhen.kind) && <label><span>COMPLETE TARGET</span><select value={step.completeWhen.targetId ?? ""} onChange={(event)=>updateOrderCondition(selectedUnit,step.id,"completeWhen",{targetId:event.target.value||undefined})}><option value="">Choose target...</option>{units.filter((candidate)=>candidate.id!==selectedUnit.id).map((target)=><option key={target.id} value={target.id}>{target.name}</option>)}</select></label>}
                      {step.completeWhen && wargameConditionUsesThreshold(step.completeWhen.kind) && <label><span>COMPLETE VALUE</span><input type="number" value={step.completeWhen.threshold ?? (step.completeWhen.kind.includes("health")||step.completeWhen.kind.includes("cap")?50:20)} onChange={(event)=>updateOrderCondition(selectedUnit,step.id,"completeWhen",{threshold:Number(event.target.value)||0})}/></label>}
                      {step.completeWhen && wargameConditionUsesSeconds(step.completeWhen.kind) && <label><span>COMPLETE DELAY</span><input type="number" min="0" value={step.completeWhen.seconds ?? 10} onChange={(event)=>updateOrderCondition(selectedUnit,step.id,"completeWhen",{seconds:Math.max(0,Number(event.target.value)||0)})}/><small>s</small></label>}
                      <label><span>BRANCH IF</span><select value={step.branchWhen?.kind ?? ""} onChange={(event)=>{const value=event.target.value;updateOrderCondition(selectedUnit,step.id,"branchWhen",value?{kind:value as WargameOrderCondition["kind"]}:undefined);}}><option value="">No conditional branch</option>{WARGAME_CONDITION_OPTIONS.filter((item)=>!["always","manual","arrived"].includes(item.value)).map((item)=><option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
                      {step.branchWhen && wargameConditionUsesTarget(step.branchWhen.kind) && <label><span>BRANCH TARGET</span><select value={step.branchWhen.targetId ?? ""} onChange={(event)=>updateOrderCondition(selectedUnit,step.id,"branchWhen",{targetId:event.target.value||undefined})}><option value="">Choose target...</option>{units.filter((candidate)=>candidate.id!==selectedUnit.id).map((target)=><option key={target.id} value={target.id}>{target.name}</option>)}</select></label>}
                      {step.branchWhen && wargameConditionUsesThreshold(step.branchWhen.kind) && <label><span>BRANCH VALUE</span><input type="number" value={step.branchWhen.threshold ?? (step.branchWhen.kind.includes("health")||step.branchWhen.kind.includes("cap")?50:20)} onChange={(event)=>updateOrderCondition(selectedUnit,step.id,"branchWhen",{threshold:Number(event.target.value)||0})}/></label>}
                      {step.branchWhen && wargameConditionUsesSeconds(step.branchWhen.kind) && <label><span>BRANCH TIME</span><input type="number" min="0" value={step.branchWhen.seconds ?? 10} onChange={(event)=>updateOrderCondition(selectedUnit,step.id,"branchWhen",{seconds:Math.max(0,Number(event.target.value)||0)})}/><small>s</small></label>}
                      {step.branchWhen && <><label><span>IF TRUE →</span><select value={step.nextStepId ?? ""} onChange={(event)=>updateOrderStep(selectedUnit,step.id,{nextStepId:event.target.value||undefined})}><option value="">Next step</option>{(selectedUnit.orderChain??[]).filter((candidate)=>candidate.id!==step.id).map((candidate)=><option key={candidate.id} value={candidate.id}>{candidate.label}</option>)}<option value="__end__">End chain</option></select></label><label><span>IF FALSE →</span><select value={step.elseStepId ?? ""} onChange={(event)=>updateOrderStep(selectedUnit,step.id,{elseStepId:event.target.value||undefined})}><option value="">Next step</option>{(selectedUnit.orderChain??[]).filter((candidate)=>candidate.id!==step.id).map((candidate)=><option key={candidate.id} value={candidate.id}>{candidate.label}</option>)}<option value="__end__">End chain</option></select></label></>}
                    </div>
                  </div>
                </article>;
              })}
              {!(selectedUnit.orderChain?.length) && <small className="wargame-order-empty">No chain queued. A direct Engage order still works; add steps when you want FC-style sequencing.</small>}
            </div>
          </section>

          <section className="wargame-stat-editor">
            <div className="wargame-section-title"><span>SIMULATION VALUES</span><small>{selectedUnit.simulationReady === false ? "No fit - combat disabled" : "Overrides are scenario-local"}</small></div>
            {selectedUnit.simulationReady === false ? <div className="wargame-unconfigured-state"><strong>FIT REQUIRED FOR COMBAT</strong><span>Weapons, drones, reps, tackle and EWAR are disabled until a fit is linked. Movement, align and warp remain available from the hull profile.</span></div> : <div className="wargame-stat-grid">
              <label><span>Ships</span><input type="number" min="1" value={selectedUnit.count} onChange={(event) => { const count = Math.max(1, Number(event.target.value) || 1); const total = selectedUnit.maxEhp ?? selectedUnit.ehp; updateUnit(selectedUnit.id, { count, shipsAlive: count, primaryEhp: total / count, ehp: total }); }} /></label>
              <label><span>DPS</span><input type="number" value={selectedUnit.dps} onChange={(event) => updateUnit(selectedUnit.id, { dps: Number(event.target.value) || 0 })} /></label>
              <label><span>EHP</span><input type="number" value={selectedUnit.maxEhp ?? selectedUnit.ehp} onChange={(event) => { const value = Math.max(0, Number(event.target.value) || 0); updateUnit(selectedUnit.id, { ehp: value, maxEhp: value, shipsAlive: selectedUnit.count, primaryEhp: value / Math.max(1, selectedUnit.count) }); }} /><small>{Math.round(selectedUnit.ehp).toLocaleString()} remaining</small></label>
              <label><span>Top speed</span><input type="number" value={selectedUnit.speed} onChange={(event) => updateUnit(selectedUnit.id, { speed: Number(event.target.value) || 0 })} /><small>m/s</small></label>
              <label><span>Combat range</span><input type="number" value={selectedUnit.range} onChange={(event) => updateUnit(selectedUnit.id, { range: Number(event.target.value) || 0 })} /><small>km</small></label>
              <label><span>Role</span><input value={selectedUnit.role} onChange={(event) => updateUnit(selectedUnit.id, { role: event.target.value })} /></label>
            </div>}
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
              <label><span>Align time</span><input type="number" min="0.1" step="0.1" value={selectedUnit.alignTimeSeconds ?? 6} onChange={(event) => updateUnit(selectedUnit.id, { alignTimeSeconds: Math.max(.1, Number(event.target.value) || .1) })}/><small>s</small></label>
              <label><span>Warp speed</span><input type="number" min="0.1" step="0.1" value={selectedUnit.warpSpeedAuPerSecond ?? 3} onChange={(event) => updateUnit(selectedUnit.id, { warpSpeedAuPerSecond: Math.max(.1, Number(event.target.value) || .1) })}/><small>AU/s</small></label>
              <label><span>Warp core</span><input type="number" min="0" step="1" value={selectedUnit.warpCoreStrength ?? 0} onChange={(event) => updateUnit(selectedUnit.id, { warpCoreStrength: Math.max(0, Number(event.target.value) || 0) })}/><small>strength</small></label>
              <label><span>Interdiction field</span><input type="number" min="0" value={selectedUnit.interdictionRadiusKm ?? 0} onChange={(event) => updateUnit(selectedUnit.id, { interdictionRadiusKm: Math.max(0, Number(event.target.value) || 0) })}/><small>km</small></label>
            </div>
            <div className="wargame-fire-control">
              <div className="wargame-support-stack-head"><span>FIRE CONTROL</span><small>independent damage channels</small></div>
              {(selectedUnit.damageSources ?? []).length ? (selectedUnit.damageSources ?? []).map((source) => {
                const target = source.targetId ? units.find((candidate) => candidate.id === source.targetId) : undefined;
                const range = target ? wargameDistanceKm(selectedUnit, target) : null;
                const application = target ? damageSourceApplication(selectedUnit, source, target, range ?? undefined) : 0;
                return <div className={"wargame-damage-source " + source.kind} key={source.id}>
                  <div><strong>{source.name}</strong><small>{source.kind.toUpperCase()} · {Math.round(source.dpsPerShip).toLocaleString()} DPS/ship · {Math.round(source.volleyPerShip).toLocaleString()} volley</small></div>
                  <select value={source.targetId ?? ""} onChange={(event) => updateDamageSourceTarget(selectedUnit.id, source.id, event.target.value || undefined)}><option value="">HOLD FIRE</option>{selectedHostiles.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select>
                  <span>{target ? (range?.toFixed(1) + " km · " + Math.round(application * 100) + "% app") : "No target"}{source.kind === "drone" && source.droneArrivalRemaining ? " · drones " + Math.ceil(source.droneArrivalRemaining) + "s out" : ""}</span>
                </div>;
              }) : <small className="wargame-order-empty">Scenario-only formation: one legacy damage channel. Link an EVE fit to split guns, missiles and drones.</small>}
              {(selectedUnit.damageSources?.length ?? 0) > 1 && <small className="wargame-fire-control-note">Damage sources may be assigned to different primaries. Engage on the map assigns every channel together; use these controls or the order chain to split them.</small>}
            </div>
            <div className="wargame-tactical-telemetry">
              <div><span>TARGET</span><strong>{selectedTarget ? selectedTarget.name : "None"}</strong><small>{selectedTargetRange == null ? "No firing solution" : `${selectedTargetRange.toFixed(1)} km`}</small></div>
              <div><span>APPLICATION</span><strong>{selectedTarget ? `${Math.round(selectedApplication * 100)}%` : "-"}</strong><small>{selectedUnit.weaponModel ?? "turret"} model</small></div>
              <div><span>FORMATION VOLLEY</span><strong>{selectedUnit.volleyPerShip ? Math.round(selectedUnit.volleyPerShip * liveShipCount(selectedUnit)).toLocaleString() : Math.round((selectedUnit.dps || 0) * (selectedUnit.weaponCycle ?? defaultWeaponCycle(selectedUnit)) * (liveShipCount(selectedUnit) / Math.max(1, selectedUnit.count))).toLocaleString()}</strong><small>{selectedUnit.fitName ? "fit-derived paper volley" : "scenario estimate"}</small></div>
              <div><span>WEAPON ENVELOPE</span><strong>{selectedUnit.optimalRange != null ? `${selectedUnit.optimalRange.toFixed(1)} + ${(selectedUnit.falloffRange ?? 0).toFixed(1)} km` : `${Math.round(selectedUnit.range)} km`}</strong><small>{selectedUnit.fitName ? "fit + loaded ammo" : "scenario range"}</small></div>
              <div><span>CURRENT PRIMARY</span><strong>{liveShipCount(selectedUnit) ? `${Math.round(primaryEhp(selectedUnit)).toLocaleString()} / ${Math.round(perShipEhp(selectedUnit)).toLocaleString()} EHP` : "DESTROYED"}</strong><small>{liveShipCount(selectedUnit)} of {selectedUnit.count} ships active</small></div>
              <div><span>NEXT VOLLEY</span><strong>{selectedUnit.dps > 0 ? `${Math.round(selectedVolley).toLocaleString()} raw` : "-"}</strong><small>{selectedSourceStats.length ? `${selectedReadySources}/${selectedSourceStats.length} damage channels ready` : selectedUnit.lockRemaining && selectedUnit.lockRemaining > 0 ? `LOCKING ${selectedUnit.lockRemaining.toFixed(1)}s` : selectedUnit.fireCooldown && selectedUnit.fireCooldown > 0 ? `CYCLE ${selectedUnit.fireCooldown.toFixed(1)}s` : "READY"}</small></div>
              <div><span>MOTION</span><strong>{Math.round(selectedUnit.effectiveSpeed ?? velocityMps(selectedUnit)).toLocaleString()} m/s</strong><small>{selectedWebbers.length ? `WEBBED by ${selectedWebbers.map((unit) => unit.name).join(", ")}` : "No hostile web"}</small></div>
              <div><span>RANGE CONTROL</span><strong>{selectedRangeRate == null ? "-" : `${Math.abs(Math.round(selectedRangeRate)).toLocaleString()} m/s`}</strong><small>{selectedRangeRate == null ? "No target" : selectedRangeRate > 60 ? "OPENING" : selectedRangeRate < -60 ? "CLOSING" : "STABLE"}{selectedTarget && (selectedUnit.stance ?? "kite") === "kite" && (selectedUnit.effectiveSpeed ?? selectedUnit.speed) < (selectedTarget.effectiveSpeed ?? selectedTarget.speed) ? " · PURSUER FASTER" : ""}</small></div>
              <div><span>REMOTE REPS</span><strong>{selectedRepTarget ? selectedRepTarget.name : (selectedUnit.repPerSecond ? "Idle" : "None")}</strong><small>{selectedUnit.repPerSecond ? `${Math.round(selectedUnit.repPerSecond).toLocaleString()} HP/s · ${(selectedUnit.repRange ?? 0).toFixed(1)} km` : "No logistics output"}</small></div>
              <div><span>CAPACITOR</span><strong>{selectedUnit.capacitorCapacity ? `${Math.round(((selectedUnit.capacitorCurrent ?? selectedUnit.capacitorCapacity) / selectedUnit.capacitorCapacity) * 100)}%` : "-"}</strong><small>{selectedUnit.capacitorCapacity ? `${Math.round(selectedUnit.capacitorCurrent ?? selectedUnit.capacitorCapacity).toLocaleString()} / ${Math.round(selectedUnit.capacitorCapacity).toLocaleString()} GJ${selectedUnit.neutPressureGjPerSecond ? ` · -${selectedUnit.neutPressureGjPerSecond.toFixed(1)} GJ/s hostile` : ""}` : "No fit capacitor data"}</small></div>
              <div><span>EWAR STATE</span><strong>{selectedUnit.jamRemaining ? "JAMMED" : selectedUnit.scrammed ? "SCRAMMED" : selectedWebbers.length ? "WEBBED" : "CLEAR"}</strong><small>{selectedUnit.jamRemaining ? `${selectedUnit.jamRemaining.toFixed(0)}s remaining` : `${Math.round((selectedUnit.ewarSignatureMultiplier ?? 1) * 100)}% sig · ${Math.round((selectedUnit.ewarTrackingMultiplier ?? 1) * 100)}% tracking · ${Math.round((selectedUnit.ewarTargetingRangeMultiplier ?? 1) * 100)}% lock range`}</small></div>
              <div><span>NAVIGATION</span><strong>{(selectedUnit.movementState ?? "idle").toUpperCase()}</strong><small>{selectedUnit.movementState === "aligning" ? `${Math.max(0, (selectedUnit.alignTimeSeconds ?? 6) - (selectedUnit.alignElapsedSeconds ?? 0)).toFixed(1)}s to align` : selectedUnit.movementState === "warping" ? `${(selectedUnit.warpRemainingSeconds ?? 0).toFixed(1)}s in warp` : selectedUnit.warpBlockedReason ? selectedUnit.warpBlockedReason : `${(selectedUnit.alignTimeSeconds ?? 6).toFixed(1)}s align · ${(selectedUnit.warpSpeedAuPerSecond ?? 3).toFixed(1)} AU/s`}</small></div>
              <div><span>WARP CONTROL</span><strong>{(selectedUnit.warpDisruptionStrength ?? 0) > (selectedUnit.warpCoreStrength ?? 0) ? "TACKLED" : selectedUnit.interdictionNullified ? "NULLIFIED" : "CLEAR"}</strong><small>{`${Math.round(selectedUnit.warpDisruptionStrength ?? 0)} point strength · ${Math.round(selectedUnit.warpCoreStrength ?? 0)} core${selectedUnit.tackleSourceIds?.length ? ` · ${selectedUnit.tackleSourceIds.length} source(s)` : ""}`}</small></div>
              <div><span>COMMAND BURSTS</span><strong>{selectedUnit.burstSourceNames?.length ? selectedUnit.burstSourceNames.join(", ") : "NONE"}</strong><small>{selectedUnit.burstSourceNames?.length ? `in-range fleet boosts · ${Math.round((selectedUnit.burstPropulsionSpeedMultiplier ?? 1)*100)}% prop · ${Math.round((selectedUnit.burstSensorStrengthMultiplier ?? 1)*100)}% sensor` : "No friendly burst source in range"}</small></div>
            </div>
          </section>

            {selectedUnit.supportSystems?.length ? <div className="wargame-support-stack">
              <div className="wargame-support-stack-head"><span>FIT SUPPORT / EWAR</span><small>skill + hull + script adjusted</small></div>
              {selectedUnit.supportSystems.map((system, index) => <div className={`wargame-support-system ${system.kind}`} key={`${system.kind}-${system.typeId}-${index}`}>
                <div><strong>{system.name}{system.quantity > 1 ? ` ×${system.quantity}` : ""}</strong><small>{system.kind.replace(/([A-Z])/g, " $1")}</small></div>
                <span>{supportSystemDetail(system)}</span>
                {wargameSupportTargetSide(system.kind) !== "none" && (()=>{ const supportKey=wargameSupportSystemKey(system,index); const side=wargameSupportTargetSide(system.kind); const choices=side === "friendly" ? selectedFriendlies : selectedHostiles; return <select value={selectedUnit.supportTargetIds?.[supportKey] ?? ""} onChange={(event)=>updateSupportSystemTarget(selectedUnit.id,supportKey,event.target.value||undefined)}><option value="">{side === "friendly" ? "AUTO / UNASSIGNED" : "NO TARGET"}</option>{choices.map((target)=><option key={target.id} value={target.id}>{target.name}</option>)}</select>; })()}
              </div>)}
            </div> : null}

          <section className="wargame-resist-editor">
            <div className="wargame-section-title"><span>RESIST PROFILE</span><small>%</small></div>
            {(["em", "therm", "kin", "exp"] as const).map((key) => <label key={key}><span>{key.toUpperCase()}</span><div><i style={{ width: `${selectedUnit[key]}%` }} /></div><input type="number" min="0" max="100" value={selectedUnit[key]} onChange={(event) => updateUnit(selectedUnit.id, { [key]: Math.max(0, Math.min(100, Number(event.target.value) || 0)) })} /></label>)}
          </section>

          <section className="wargame-fit-bridge">
            <div className="wargame-section-title"><span>FIT</span><small>{selectedUnit.simulationReady === false ? "FIT REQUIRED FOR COMBAT" : selectedUnit.fitName ? "Fit linked" : "Manual values"}</small></div>
            <div className="wargame-fit-actions"><button type="button" onClick={() => setFitImportOpen((value) => !value)}>Import EVE fit</button><button type="button" disabled={!selectedUnit.fitName}>{selectedUnit.fitName ? "Fit linked" : "No fit linked"}</button></div>
            <div className="wargame-saved-fit-import"><select defaultValue="" disabled={fitImportBusy || !savedFits.some((fit) => fit.hullTypeId === selectedUnit.typeId || (!fit.hullTypeId && fit.hullName.toLowerCase() === selectedUnit.name.toLowerCase()))} onChange={(event) => { const value=event.target.value; if(value) void applySavedFitToSelected(value); event.currentTarget.value=""; }}><option value="">Saved fit for this hull...</option>{savedFits.filter((fit) => fit.hullTypeId === selectedUnit.typeId || (!fit.hullTypeId && fit.hullName.toLowerCase() === selectedUnit.name.toLowerCase())).map((fit) => <option key={fit.id} value={fit.id}>{fit.name} [{fit.source}]</option>)}</select><small>{savedFitsStatus}</small></div>
            {selectedUnit.fitName && <div className="wargame-fit-source"><span>FIT-LINKED</span><strong>{selectedUnit.fitName}</strong><small>{selectedUnit.fitSourceSummary ?? selectedUnit.fitCharacter}</small></div>}
            {fitImportStatus && <small className="wargame-fit-status">{fitImportStatus}</small>}
            {fitImportOpen && <div className="wargame-fit-import"><textarea value={fitImportText} onChange={(event) => setFitImportText(event.target.value)} placeholder="Paste EFT / PYFA or Sage JSON fit here..." /><button type="button" disabled={!fitImportText.trim() || fitImportBusy} onClick={() => void applyFitToSelected()}>{fitImportBusy ? "Calculating fit..." : "Apply fit"}</button><small>Uses {corporation.characterName}'s current synced skills.</small></div>}
          </section>
        </> : <div className="wargame-inspector-empty"><span>＋</span><strong>Select a fleet or drag a hull onto the board</strong><small>Stats, orders, fits and scenario overrides appear here.</small></div>}

        <section className={`wargame-ai-panel ${aiResponseVisible ? "active" : ""}`}>
          <div className="wargame-ai-head"><div><span>RED TEAM AI</span><strong>{aiResponseVisible ? "Active" : "Off"}</strong></div></div>
          
          {aiResponseVisible ? <div className="wargame-ai-assessment"><span>RED TEAM ACTIVE</span><strong>Red forces are reacting to the current battlefield.</strong></div> : <button type="button" onClick={() => setAiResponseVisible(true)}>Enable Red Team AI</button>}
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

export function FleetCommand({ onWargameActiveChange, active = true }: { onWargameActiveChange?: (active: boolean) => void; active?: boolean }) {
  const [snapshots, setSnapshots] = useState<any[]>([]);
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null);
  const [tab, setTab] = useState<FleetCommandTab>("doctrines");
  const [jumpLocation, setJumpLocation] = useState<NavigationCharacterLocation | null>(null);
  const [jumpLocationBusy, setJumpLocationBusy] = useState(false);
  const [jumpLocationError, setJumpLocationError] = useState("");
  const [followCharacter, setFollowCharacter] = useState(false);
  const [jumpSelectedSystem, setJumpSelectedSystem] = useState<NavigationSystem | null>(null);
  const mountedTabs = useRef(new Set<FleetCommandTab>(["doctrines"]));
  mountedTabs.current.add(tab);

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
    onWargameActiveChange?.(active && tab === "wargame");
    return () => onWargameActiveChange?.(false);
  }, [active, tab, onWargameActiveChange]);

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

    {corporation ? <>
      {mountedTabs.current.has("doctrines") && <div className="fleet-command-cached-tab" hidden={tab !== "doctrines"}><CorporationDoctrines corporation={corporation} snapshots={snapshots} /></div>}
      {mountedTabs.current.has("jump-map") && <div className="fleet-command-cached-tab" hidden={tab !== "jump-map"}><div className="fleet-jump-map-view">
        <div className="fleet-jump-map-location"><div><span>CURRENT CHARACTER</span><strong>{corporation.characterName}</strong><small>{jumpLocation ? `${jumpLocation.systemName} / ${jumpLocation.source === "live-esi" ? "LIVE ESI" : "SYNCED SNAPSHOT"}` : "Location not loaded"}</small></div><button type="button" disabled={jumpLocationBusy} onClick={() => void refreshJumpLocation(true)}>{jumpLocationBusy ? "Checking..." : "Refresh location"}</button></div>
        {jumpLocationError && <div className="on-the-fly-warning">{jumpLocationError}</div>}
        <OnTheFlyJumpMap route={null} routeIntelligence={null} characterLocation={jumpLocation} followCharacter={followCharacter} setFollowCharacter={setFollowCharacter} hasSelectedCharacter={Boolean(corporation.characterId)} selectedSystem={jumpSelectedSystem} onSelectSystem={setJumpSelectedSystem} specialConnections={[]} />
      </div></div>}
      {mountedTabs.current.has("wargame") && <div className="fleet-command-cached-tab fleet-command-cached-wargame" hidden={tab !== "wargame"}><WargameMap corporation={corporation} onNavigate={setTab} active={active && tab === "wargame"} /></div>}
    </> : <div className="corp-data-view"><p className="eyebrow">FLEET COMMAND</p><h3>Connect a corporation character</h3><p>Sync a connected EVE character to load corporation doctrine and tactical data.</p></div>}
  </section>;
}
