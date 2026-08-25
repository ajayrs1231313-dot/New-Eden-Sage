import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type {
  CharacterSnapshot,
  NavigationOnlineWorkspace,
  WormholeOnlineChainSummary,
  WormholeOnlineAuditEntry,
  WormholeCommandStore,
  WormholeConnectionRecord,
  WormholeConnectionStatus,
  WormholeCleanupPreview,
  WormholeMapLayout,
  WormholeReconciledSignature,
  WormholeReferenceEntry,
  WormholePveReferenceSnapshot,
  WormholePveSite,
  WormholeRollingShipMass,
  WormholeScanSnapshot,
  WormholeSystemIntelligence,
  WormholeKillmailIntel,
  WormholeSignatureKind,
  WormholeSignatureObservation,
  WormholeSignatureRecord,
  WormholeSiteState,
  WormholeSystemRecord,
  WormholeSystemReferenceEntry,
  WormholeSystemStatus,
  WormholeWatchKind,
} from "./types";
import { parseProbeScanner } from "./wormhole-scanner";
import { calculateRollingState, directionalRollingRisk, parsePositiveMass, rollingPassWindow, rollingRiskForMass } from "./wormhole-rolling-math";
import { reconstructWormholeHistory } from "./wormhole-history";
import "./wormhole-command.css";

type WormholeSection = "map" | "scanner" | "intel" | "sites" | "rolling" | "corp";
type SignatureState = WormholeReconciledSignature["state"];
type LegacyScanStore = Record<string, Omit<WormholeScanSnapshot, "scanId">>;
type RollingPass = { id: string; direction: "OUT" | "IN"; mode: "cold" | "prop"; massKg: number; createdAt: string; pilotCharacterId?:string; pilotName?:string; shipTypeId?:number; shipName?:string };
type PendingWormholeJump = { fromSystemId:number; fromSystemName:string; toSystemId:number; toSystemName:string; observedAt:string };

const SCAN_STORE_KEY = "new-eden-sage-wormhole-scans-v1";
const WORMHOLE_ALERT_PREFS_KEY = "new-eden-sage-wormhole-alert-prefs-v1";
function loadAlertPrefs(){ try { const value=JSON.parse(localStorage.getItem(WORMHOLE_ALERT_PREFS_KEY)??"{}"); return { desktop:Boolean(value.desktop), audio:Boolean(value.audio) }; } catch { return {desktop:false,audio:false}; } }

const sections: Array<{ id: WormholeSection; label: string; eyebrow: string }> = [
  { id: "map", label: "Map", eyebrow: "CHAIN" },
  { id: "scanner", label: "Scanner", eyebrow: "PROBES" },
  { id: "intel", label: "Intel", eyebrow: "SYSTEM" },
  { id: "sites", label: "Sites", eyebrow: "PVE" },
  { id: "rolling", label: "Rolling", eyebrow: "MASS" },
  { id: "corp", label: "Corporation", eyebrow: "ONLINE" },
];

const kindLabels: Record<WormholeSignatureKind, string> = {
  wormhole: "Wormhole",
  gas: "Gas",
  relic: "Relic",
  data: "Data",
  combat: "Combat",
  ore: "Ore",
  unknown: "Unknown",
};

const systemStatusLabels: Record<WormholeSystemStatus, string> = {
  unknown: "Unknown",
  friendly: "Friendly",
  occupied: "Occupied",
  hostile: "Hostile",
  empty: "Empty",
  unscanned: "Unscanned",
};

const connectionStatusLabels: Record<WormholeConnectionStatus, string> = {
  unknown: "Unknown",
  active: "Active",
  eol: "EOL",
  critical: "Critical mass",
  quarantined: "Quarantined",
  expired: "Expired",
};

function loadLegacyScanStore(): LegacyScanStore {
  try {
    const parsed = JSON.parse(localStorage.getItem(SCAN_STORE_KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as LegacyScanStore;
  } catch {
    return {};
  }
}

function latestScanForSystem(store: WormholeCommandStore | null, systemId: number) {
  if (!store) return undefined;
  for (let index = store.scanHistory.length - 1; index >= 0; index -= 1) {
    const scan = store.scanHistory[index];
    if (scan.systemId === systemId) return scan;
  }
  return undefined;
}

function signaturesForSystem(store: WormholeCommandStore | null, systemId: number) {
  if (!store) return [];
  return Object.values(store.signatures)
    .filter((row) => row.systemId === systemId)
    .sort((a, b) => a.id.localeCompare(b.id));
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 }).format(value);
}

function formatMassKg(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(value % 1_000_000_000 ? 1 : 0)}b kg`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value % 1_000_000 ? 1 : 0)}m kg`;
  return `${formatNumber(value)} kg`;
}

function formatExpiry(expiresAt?: string) {
  if (!expiresAt) return "Expiry unknown";
  const remaining = Date.parse(expiresAt) - Date.now();
  if (!Number.isFinite(remaining)) return "Expiry unknown";
  if (remaining <= 0) return "Expired";
  const minutes = Math.ceil(remaining / 60_000);
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return hours ? `${hours}h ${mins}m left` : `${mins}m left`;
}

function systemLabel(system?: WormholeSystemRecord) {
  if (!system) return "Unknown system";
  return system.alias ? `${system.alias} · ${system.systemName}` : system.systemName;
}

type WormholeThreatLevel = "quiet" | "watch" | "danger" | "hot";
type WormholeThreatAssessment = { level: WormholeThreatLevel; label: string; score: number; reasons: string[]; pvp1h: number; pvp24h: number; repeatedCharacters: number; repeatedCorporations: number; homeDistance: number | null };

function wormholeChainDistance(store: WormholeCommandStore | null, fromSystemId: number | undefined, toSystemId: number) {
  if (!store || !fromSystemId) return null;
  if (fromSystemId === toSystemId) return 0;
  const adjacency = new Map<number, Set<number>>();
  for (const connection of Object.values(store.connections)) {
    if (!connection.toSystemId || connection.status === "quarantined" || connection.status === "expired") continue;
    const from = store.systems[String(connection.fromSystemId)];
    const to = store.systems[String(connection.toSystemId)];
    if (!from || !to || from.archivedAt || to.archivedAt) continue;
    if (!adjacency.has(connection.fromSystemId)) adjacency.set(connection.fromSystemId, new Set());
    if (!adjacency.has(connection.toSystemId)) adjacency.set(connection.toSystemId, new Set());
    adjacency.get(connection.fromSystemId)!.add(connection.toSystemId);
    adjacency.get(connection.toSystemId)!.add(connection.fromSystemId);
  }
  const seen = new Set<number>([fromSystemId]);
  const queue: Array<{ id:number; distance:number }> = [{ id:fromSystemId, distance:0 }];
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    for (const next of adjacency.get(current.id) ?? []) {
      if (seen.has(next)) continue;
      if (next === toSystemId) return current.distance + 1;
      seen.add(next);
      queue.push({ id:next, distance:current.distance + 1 });
    }
  }
  return null;
}

function assessWormholeThreat(store: WormholeCommandStore | null, system: WormholeSystemRecord | undefined, intel: WormholeSystemIntelligence | undefined): WormholeThreatAssessment {
  if (!system) return { level:"quiet", label:"NO SYSTEM", score:0, reasons:[], pvp1h:0, pvp24h:0, repeatedCharacters:0, repeatedCorporations:0, homeDistance:null };
  const now = Date.now();
  const pvp = (intel?.killmails ?? []).filter((kill) => kill.npc !== true);
  const within = (kill:WormholeKillmailIntel, milliseconds:number) => {
    const time = Date.parse(kill.killmailTime ?? "");
    return Number.isFinite(time) && time >= now - milliseconds;
  };
  const pvp1h = pvp.filter((kill) => within(kill, 60 * 60 * 1000)).length;
  const recent24h = pvp.filter((kill) => within(kill, 24 * 60 * 60 * 1000));
  const pvp24h = recent24h.length;
  const characterCounts = new Map<number, number>();
  const corporationCounts = new Map<number, number>();
  for (const kill of recent24h) {
    const seenCharacters = new Set<number>();
    const seenCorporations = new Set<number>();
    for (const attacker of kill.attackers ?? []) {
      const characterId = Number(attacker?.character_id ?? 0);
      const corporationId = Number(attacker?.corporation_id ?? 0);
      if (characterId) seenCharacters.add(characterId);
      if (corporationId) seenCorporations.add(corporationId);
    }
    for (const id of seenCharacters) characterCounts.set(id, (characterCounts.get(id) ?? 0) + 1);
    for (const id of seenCorporations) corporationCounts.set(id, (corporationCounts.get(id) ?? 0) + 1);
  }
  const repeatedCharacters = [...characterCounts.values()].filter((count) => count >= 2).length;
  const repeatedCorporations = [...corporationCounts.values()].filter((count) => count >= 2).length;
  const homeDistance = wormholeChainDistance(store, store?.homeSystemId, system.systemId);
  const reasons:string[] = [];
  let score = 0;
  if (pvp1h) { score += Math.min(45, pvp1h * 18); reasons.push(`${pvp1h} cached PvP kill${pvp1h === 1 ? "" : "s"} in the last hour`); }
  if (pvp24h) { score += Math.min(25, pvp24h * 4); reasons.push(`${pvp24h} cached PvP kill${pvp24h === 1 ? "" : "s"} in the last 24 hours`); }
  if (repeatedCharacters) { score += Math.min(15, repeatedCharacters * 4); reasons.push(`${repeatedCharacters} attacker character${repeatedCharacters === 1 ? "" : "s"} repeated across 24h killmails`); }
  if (repeatedCorporations) { score += Math.min(15, repeatedCorporations * 3); reasons.push(`${repeatedCorporations} attacker corporation${repeatedCorporations === 1 ? "" : "s"} repeated across 24h killmails`); }
  if (system.status === "hostile") { score += 30; reasons.push("System is manually marked Hostile in Wormhole Command"); }
  if ((pvp1h || pvp24h || system.status === "hostile") && homeDistance != null) {
    if (homeDistance === 0) { score += 12; reasons.push("Threat evidence is in the Home system"); }
    else if (homeDistance === 1) { score += 9; reasons.push("Threat evidence is one current chain jump from Home"); }
    else if (homeDistance === 2) { score += 4; reasons.push("Threat evidence is two current chain jumps from Home"); }
  }
  score = Math.min(100, score);
  if (!reasons.length) return { level:"quiet", label:"QUIET / NO CACHED PVP EVIDENCE", score:0, reasons:["No recent PvP or manual hostile flag is present in the currently loaded evidence."], pvp1h, pvp24h, repeatedCharacters, repeatedCorporations, homeDistance };
  if (score >= 70) return { level:"hot", label:"HOT", score, reasons, pvp1h, pvp24h, repeatedCharacters, repeatedCorporations, homeDistance };
  if (score >= 40) return { level:"danger", label:"DANGER", score, reasons, pvp1h, pvp24h, repeatedCharacters, repeatedCorporations, homeDistance };
  return { level:"watch", label:"WATCH", score, reasons, pvp1h, pvp24h, repeatedCharacters, repeatedCorporations, homeDistance };
}

function formatIskCompact(value:number | undefined) {
  if (!value || !Number.isFinite(value)) return "—";
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}b ISK`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m ISK`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)}k ISK`;
  return `${Math.round(value)} ISK`;
}

function killmailAge(kill:WormholeKillmailIntel) {
  const time = Date.parse(kill.killmailTime ?? "");
  if (!Number.isFinite(time)) return "Unknown time";
  const minutes = Math.max(0, Math.floor((Date.now() - time) / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatEffectModifier(modifier: WormholeSystemReferenceEntry["effectModifiers"][number]) {
  const value = modifier.value;
  if (modifier.unitId === 109) { const percent=(value-1)*100; return `${percent >= 0 ? "+" : ""}${Number(percent.toFixed(1))}%`; }
  if (modifier.unitId === 104) { const percent=(value-1)*100; return `x${Number(value.toFixed(3))} (${percent >= 0 ? "+" : ""}${Number(percent.toFixed(1))}%)`; }
  if (modifier.unitId === 121 || modifier.unitId === 124) return `${value >= 0 ? "+" : ""}${Number(value.toFixed(1))}%`;
  return `${Number(value.toFixed(3))}${modifier.unitName ? ` ${modifier.unitName}` : ""}`;
}

type WormholeWatchTrigger = { watchId:string; fingerprint:string; message:string; systemId?:number; connectionId?:string };

function evaluateWormholeWatches(store:WormholeCommandStore | null, systems:WormholeSystemRecord[], systemReference:Record<string,WormholeSystemReferenceEntry>, intelBySystem:Record<string,WormholeSystemIntelligence>, reference:WormholeReferenceEntry[]) {
  if (!store?.watches.length) return [] as WormholeWatchTrigger[];
  const already = new Set(store.alerts.map((alert) => `${alert.watchId}:${alert.fingerprint}`));
  const referenceByCode = new Map(reference.map((entry) => [entry.code.toUpperCase(), entry]));
  const activeConnections = Object.values(store.connections).filter((connection) => connection.status !== "quarantined" && connection.status !== "expired");
  const result:WormholeWatchTrigger[] = [];
  const add = (watchId:string, trigger:Omit<WormholeWatchTrigger,"watchId">) => {
    if (!already.has(`${watchId}:${trigger.fingerprint}`)) result.push({ watchId, ...trigger });
  };
  for (const watch of store.watches.filter((row) => row.enabled)) {
    const value = (watch.value ?? "").trim().toUpperCase();
    if (watch.kind === "system") {
      for (const system of systems.filter((row) => row.systemName.toUpperCase() === value)) add(watch.watchId,{fingerprint:`system:${system.systemId}`,message:`Watched system ${systemLabel(system)} has entered the current chain.`,systemId:system.systemId});
      continue;
    }
    if (watch.kind === "class") {
      for (const system of systems) {
        const info=systemReference[String(system.systemId)];
        if (info?.classLabel.toUpperCase() === value) add(watch.watchId,{fingerprint:`class:${value}:${system.systemId}`,message:`${systemLabel(system)} matches watched class ${info.classLabel}.`,systemId:system.systemId});
      }
      continue;
    }
    if (watch.kind === "effect") {
      for (const system of systems) {
        const effect=systemReference[String(system.systemId)]?.effectName;
        if (effect && effect.toUpperCase().includes(value)) add(watch.watchId,{fingerprint:`effect:${value}:${system.systemId}`,message:`${systemLabel(system)} matches watched effect ${effect}.`,systemId:system.systemId});
      }
      continue;
    }
    if (watch.kind === "wormhole-type") {
      for (const connection of activeConnections.filter((row) => row.wormholeType?.toUpperCase() === value)) add(watch.watchId,{fingerprint:`connection:${connection.connectionId}`,message:`Watched wormhole type ${connection.wormholeType} is present on ${connection.label || connection.fromSignatureId || connection.connectionId}.`,systemId:connection.fromSystemId,connectionId:connection.connectionId});
      continue;
    }
    if (watch.kind === "frigate-hole") {
      for (const connection of activeConnections) {
        const wh=connection.wormholeType ? referenceByCode.get(connection.wormholeType.toUpperCase()) : undefined;
        if (wh?.maxJumpMassKg != null && wh.maxJumpMassKg <= 5_000_000) add(watch.watchId,{fingerprint:`frigate:${connection.connectionId}`,message:`Frigate-limited connection ${connection.wormholeType || connection.fromSignatureId || connection.connectionId} detected by CCP max-jump mass ${formatMassKg(wh.maxJumpMassKg)}.`,systemId:connection.fromSystemId,connectionId:connection.connectionId});
      }
      continue;
    }
    if (watch.kind === "new-k162") {
      for (const connection of activeConnections.filter((row) => row.wormholeType?.toUpperCase() === "K162")) add(watch.watchId,{fingerprint:`k162:${connection.connectionId}`,message:`K162 connection detected: ${connection.label || connection.fromSignatureId || connection.connectionId}.`,systemId:connection.fromSystemId,connectionId:connection.connectionId});
      continue;
    }
    if (watch.kind === "eol-connection" || watch.kind === "critical-connection") {
      const wanted = watch.kind === "eol-connection" ? "eol" : "critical";
      for (const connection of Object.values(store.connections).filter((row) => row.status === wanted)) add(watch.watchId,{ fingerprint:`${wanted}:${connection.connectionId}:${connection.updatedAt}`, message:`Connection ${connection.label || connection.wormholeType || connection.fromSignatureId || connection.connectionId} is now ${wanted.toUpperCase()} — ${wanted === "eol" ? "lifetime" : "mass"} risk.`, systemId:connection.fromSystemId, connectionId:connection.connectionId });
      continue;
    }
    if (watch.kind === "hostile-activity") {
      for (const system of systems) {
        const assessment=assessWormholeThreat(store,system,intelBySystem[String(system.systemId)]);
        if (assessment.score < 40) continue;
        const latest=(intelBySystem[String(system.systemId)]?.killmails ?? []).filter((kill) => kill.npc !== true).sort((a,b) => Date.parse(b.killmailTime ?? "")-Date.parse(a.killmailTime ?? ""))[0];
        const evidenceKey=latest?.killmailId ?? (system.status === "hostile" ? "manual" : assessment.label);
        add(watch.watchId,{fingerprint:`hostile:${system.systemId}:${evidenceKey}:${assessment.level}`,message:`${systemLabel(system)} reached ${assessment.label} threat (${assessment.score}/100): ${assessment.reasons.slice(0,2).join("; ")}.`,systemId:system.systemId});
      }
      continue;
    }
    if (watch.kind === "near-home" && store.homeSystemId) {
      for (const connection of activeConnections) {
        const endpoints=[connection.fromSystemId,connection.toSystemId].filter((id):id is number => Boolean(id));
        const distances=endpoints.map((id) => wormholeChainDistance(store,store.homeSystemId,id)).filter((distance):distance is number => distance != null);
        const nearest=distances.length ? Math.min(...distances) : null;
        if (nearest != null && nearest <= 1) add(watch.watchId,{fingerprint:`near-home:${connection.connectionId}`,message:`Connection ${connection.wormholeType || connection.fromSignatureId || connection.connectionId} is ${nearest === 0 ? "in Home" : "one chain jump from Home"}.`,systemId:connection.fromSystemId,connectionId:connection.connectionId});
      }
    }
  }
  return result;
}

export function WormholeCommand({
  snapshots,
  activeCharacterId,
  onSelectCharacter,
}: {
  snapshots: CharacterSnapshot[];
  activeCharacterId?: string;
  onSelectCharacter?(characterId: string): void;
}) {
  const [section, setSection] = useState<WormholeSection>("map");
  const [store, setStore] = useState<WormholeCommandStore | null>(null);
  const [loading, setLoading] = useState(true);
  const [storeError, setStoreError] = useState("");
  const [reference, setReference] = useState<WormholeReferenceEntry[]>([]);
  const [systemReference, setSystemReference] = useState<Record<string, WormholeSystemReferenceEntry>>({});
  const [intelBySystem, setIntelBySystem] = useState<Record<string, WormholeSystemIntelligence>>({});
  const [intelLoadingSystemId, setIntelLoadingSystemId] = useState(0);
  const [intelMessage, setIntelMessage] = useState("System News intelligence has not been refreshed yet.");
  const [scannerInput, setScannerInput] = useState("");
  const [scanRows, setScanRows] = useState<WormholeReconciledSignature[]>([]);
  const [scannerMessage, setScannerMessage] = useState("Paste EVE probe scanner output to begin.");
  const [selectedSystemKey, setSelectedSystemKey] = useState("");
  const [followCharacter, setFollowCharacter] = useState(false);
  const [locationMessage, setLocationMessage] = useState("Live location follow is off.");
  const [pendingJump, setPendingJump] = useState<PendingWormholeJump | null>(null);
  const [mapSignatureRequest, setMapSignatureRequest] = useState<{systemId:number; signatureId:string; nonce:number} | null>(null);
  const lastLocationRef = useRef<{ systemId:number; systemName:string } | null>(null);
  const watchEvaluationBusyRef = useRef(false);
  const [onlineWorkspace, setOnlineWorkspace] = useState<NavigationOnlineWorkspace | null>(null);
  const [onlineChains, setOnlineChains] = useState<WormholeOnlineChainSummary[]>([]);
  const [onlineAudit, setOnlineAudit] = useState<WormholeOnlineAuditEntry[]>([]);
  const [onlineBusy, setOnlineBusy] = useState(false);
  const [onlineMessage, setOnlineMessage] = useState("Sage Online is optional. Local Wormhole Command remains fully functional without it.");
  const [onlineVisibility, setOnlineVisibility] = useState<"workspace" | "restricted">("workspace");
  const [onlineRecipients, setOnlineRecipients] = useState("");
  const [loadedOnlineChain, setLoadedOnlineChain] = useState<{id:string;version:number;visibility:"workspace"|"restricted"}|null>(null);
  const [lastOnlineEventSequence, setLastOnlineEventSequence] = useState(0);
  const [serverUpdatePending, setServerUpdatePending] = useState(false);
  const [alertPrefs, setAlertPrefs] = useState(loadAlertPrefs);

  useEffect(() => { try { localStorage.setItem(WORMHOLE_ALERT_PREFS_KEY, JSON.stringify(alertPrefs)); } catch {} }, [alertPrefs]);

  async function setDesktopAlerts(enabled:boolean) {
    if(enabled && "Notification" in window && Notification.permission !== "granted") {
      const permission=await Notification.requestPermission();
      if(permission!=="granted") { setAlertPrefs((current)=>({...current,desktop:false})); return; }
    }
    setAlertPrefs((current)=>({...current,desktop:enabled}));
  }

  function deliverLocalWatchAlert(message:string) {
    if(alertPrefs.desktop && "Notification" in window && Notification.permission === "granted") { try { new Notification("New Eden Sage — Wormhole Command", { body:message, tag:"new-eden-sage-wormhole-alert" }); } catch {} }
    if(alertPrefs.audio) { try { const AudioCtor=window.AudioContext || (window as any).webkitAudioContext; if(AudioCtor){ const context=new AudioCtor(); const oscillator=context.createOscillator(); const gain=context.createGain(); oscillator.frequency.setValueAtTime(740,context.currentTime); oscillator.frequency.exponentialRampToValueAtTime(420,context.currentTime+0.22); gain.gain.setValueAtTime(0.0001,context.currentTime); gain.gain.exponentialRampToValueAtTime(0.12,context.currentTime+0.02); gain.gain.exponentialRampToValueAtTime(0.0001,context.currentTime+0.28); oscillator.connect(gain); gain.connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime+0.3); oscillator.onended=()=>void context.close(); } } catch {} }
  }

  const active = snapshots.find((row) => row.characterId === activeCharacterId) ?? snapshots[0];
  const currentSystemId = active?.location?.solar_system_id ?? 0;
  const currentSavedScan = currentSystemId ? latestScanForSystem(store, currentSystemId) : undefined;

  useEffect(() => {
    lastLocationRef.current = currentSystemId ? { systemId: currentSystemId, systemName: active?.location?.solar_system_name || `System ${currentSystemId}` } : null;
  }, [active?.characterId, currentSystemId]);

  useEffect(() => {
    if (!followCharacter || !active?.characterId) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const location = await window.sage.getNavigationCharacterLocation(active.characterId, true);
        if (cancelled) return;
        const previous = lastLocationRef.current;
        const nextLocation = { systemId: location.systemId, systemName: location.systemName || `System ${location.systemId}` };
        lastLocationRef.current = nextLocation;
        setLocationMessage(`Following ${active.character.name} · ${nextLocation.systemName}`);
        if (!previous || previous.systemId === nextLocation.systemId) return;
        await window.sage.observeWormholeSystem({ systemId: previous.systemId, systemName: previous.systemName, observedAt: location.observedAt, characterId: active.characterId, characterName: active.character.name });
        const nextStore = await window.sage.observeWormholeSystem({ systemId: nextLocation.systemId, systemName: nextLocation.systemName, observedAt: location.observedAt, characterId: active.characterId, characterName: active.character.name });
        if (cancelled) return;
        setStore(nextStore);
        setSelectedSystemKey(String(nextLocation.systemId));
        setPendingJump({ fromSystemId: previous.systemId, fromSystemName: previous.systemName, toSystemId: nextLocation.systemId, toSystemName: nextLocation.systemName, observedAt: location.observedAt });
        setLocationMessage(`Jump detected · ${previous.systemName} → ${nextLocation.systemName}`);
      } catch (error) {
        if (!cancelled) setLocationMessage(error instanceof Error ? error.message : "Live ESI location unavailable.");
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 15_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [followCharacter, active?.characterId, active?.character.name]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setStoreError("");
      try {
        const legacy = loadLegacyScanStore();
        const next = Object.keys(legacy).length
          ? await window.sage.importLegacyWormholeScans(legacy)
          : await window.sage.getWormholeCommandStore();
        if (cancelled) return;
        setStore(next);
        if (Object.keys(legacy).length) {
          try { localStorage.removeItem(SCAN_STORE_KEY); } catch { /* renderer storage may be disabled */ }
        }
      } catch (error) {
        if (!cancelled) setStoreError(error instanceof Error ? error.message : String(error));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void window.sage.getWormholeReference().then((rows) => { if (!cancelled) setReference(rows); }).catch((error) => { if (!cancelled) setStoreError((current) => current || (error instanceof Error ? error.message : String(error))); });
    return () => { cancelled = true; };
  }, []);

  const systems = useMemo(
    () => Object.values(store?.systems ?? {}).filter((row) => !row.archivedAt).sort((a, b) => (b.lastScannedAt ?? b.updatedAt).localeCompare(a.lastScannedAt ?? a.updatedAt)),
    [store],
  );

  useEffect(() => {
    let cancelled = false;
    const ids = systems.map((row) => row.systemId);
    if (!ids.length) { setSystemReference({}); return; }
    void window.sage.getWormholeSystemReferences(ids).then((rows) => {
      if (!cancelled) setSystemReference(Object.fromEntries(rows.map((row) => [String(row.systemId), row])));
    }).catch((error) => { if (!cancelled) setStoreError((current) => current || (error instanceof Error ? error.message : String(error))); });
    return () => { cancelled = true; };
  }, [systems]);
  const systemIdsKey = systems.map((row) => row.systemId).sort((a, b) => a - b).join(",");

  useEffect(() => {
    let cancelled = false;
    const ids = systems.map((row) => row.systemId);
    if (!ids.length) {
      setIntelBySystem({});
      return;
    }
    void window.sage.refreshSystemIntelligence({
      systemIds: ids,
      caller: "route",
      discoverStructures: false,
      deepKillmailBackfill: false,
    }).then((result) => {
      if (cancelled) return;
      setIntelBySystem((current) => ({
        ...current,
        ...Object.fromEntries(result.systems.map((row) => [String(row.system.systemId), row])),
      }));
      const queued = Number(result.killmailRefresh?.queuedSystems ?? 0);
      setIntelMessage(queued
        ? `Chain activity loaded · ${queued} killmail refresh job${queued === 1 ? "" : "s"} queued.`
        : "Chain activity and cached killmail intelligence loaded.");
    }).catch((error) => {
      if (!cancelled) setIntelMessage(error instanceof Error ? error.message : String(error));
    });
    return () => { cancelled = true; };
  }, [systemIdsKey]);

  useEffect(() => window.sage.onSystemKillmailsUpdated((payload) => {
    const incoming = payload.killmailsBySystem ?? {};
    setIntelBySystem((current) => {
      let changed = false;
      const next = { ...current };
      for (const [key, killmails] of Object.entries(incoming)) {
        const existing = current[key];
        if (!existing) continue;
        next[key] = {
          ...existing,
          killmails,
          killmailRefresh: {
            ...existing.killmailRefresh,
            lastUpdatedAt: payload.updatedAtBySystem?.[key] ?? existing.killmailRefresh.lastUpdatedAt,
            queued: Boolean(payload.queuedBySystem?.[key]),
            global: payload.status ?? existing.killmailRefresh.global,
          },
        };
        changed = true;
      }
      return changed ? next : current;
    });
  }), []);


  useEffect(() => {
    if (currentSystemId && store?.systems[String(currentSystemId)] && !selectedSystemKey) setSelectedSystemKey(String(currentSystemId));
    else if (!selectedSystemKey && systems[0]) setSelectedSystemKey(String(systems[0].systemId));
  }, [currentSystemId, selectedSystemKey, store, systems]);

  useEffect(() => {
    if (!currentSystemId) {
      setScanRows([]);
      return;
    }
    setScanRows(signaturesForSystem(store, currentSystemId).map((row) => ({ ...row, state: row.status === "missing" ? "missing" : "existing" })));
  }, [currentSystemId, store]);

  const selectedSystem = selectedSystemKey ? store?.systems[selectedSystemKey] : undefined;
  const selectedScan = selectedSystem ? latestScanForSystem(store, selectedSystem.systemId) : undefined;
  const selectedIntel = selectedSystem ? intelBySystem[String(selectedSystem.systemId)] : undefined;
  const chainKillFeed = useMemo(() => {
    const byId = new Map<number, WormholeKillmailIntel>();
    for (const system of systems) {
      for (const kill of intelBySystem[String(system.systemId)]?.killmails ?? []) {
        if (!byId.has(kill.killmailId)) byId.set(kill.killmailId, kill);
      }
    }
    return [...byId.values()].sort((a, b) => Date.parse(b.killmailTime ?? "") - Date.parse(a.killmailTime ?? ""));
  }, [intelBySystem, systems]);

  useEffect(() => {
    if (section !== "intel" || !selectedSystem?.systemId) return;
    let cancelled = false;
    setIntelLoadingSystemId(selectedSystem.systemId);
    setIntelMessage(`Refreshing deep intelligence for ${systemLabel(selectedSystem)}…`);
    void window.sage.refreshSystemIntelligence({
      systemIds: [selectedSystem.systemId],
      caller: "single",
      discoverStructures: true,
      deepKillmailBackfill: true,
    }).then((result) => {
      if (cancelled) return;
      const row = result.systems[0];
      if (row) setIntelBySystem((current) => ({ ...current, [String(row.system.systemId)]: row }));
      setIntelMessage(row?.killmailRefresh.queued
        ? "Current cache loaded; deeper killmail history is queued under Sage’s shared courtesy scheduler."
        : "Deep system intelligence refreshed from Sage’s existing System News cache and ESI evidence.");
    }).catch((error) => {
      if (!cancelled) setIntelMessage(error instanceof Error ? error.message : String(error));
    }).finally(() => {
      if (!cancelled) setIntelLoadingSystemId(0);
    });
    return () => { cancelled = true; };
  }, [section, selectedSystem?.systemId]);

  const watchConfigKey = JSON.stringify((store?.watches ?? []).map((row) => [row.watchId,row.kind,row.value,row.enabled]));
  const watchTopologyKey = JSON.stringify([store?.homeSystemId,Object.values(store?.connections ?? {}).map((row) => [row.connectionId,row.fromSystemId,row.toSystemId,row.wormholeType,row.status])]);
  const watchEvidenceKey = JSON.stringify(systems.map((system) => { const info=systemReference[String(system.systemId)]; const intel=intelBySystem[String(system.systemId)]; const latest=(intel?.killmails ?? [])[0]; return [system.systemId,system.systemName,system.status,info?.classLabel,info?.effectName,latest?.killmailId,latest?.killmailTime,(intel?.killmails ?? []).length]; }));

  useEffect(() => {
    if (!store || watchEvaluationBusyRef.current) return;
    const triggers = evaluateWormholeWatches(store, systems, systemReference, intelBySystem, reference).slice(0, 24);
    if (!triggers.length) return;
    watchEvaluationBusyRef.current = true;
    void (async () => {
      let latest = store;
      try {
        for (const trigger of triggers) {
          const result = await window.sage.recordWormholeWatchAlert(trigger);
          latest = result.store;
          if (result.created) deliverLocalWatchAlert(result.alert?.message ?? trigger.message);
        }
        setStore(latest);
      } finally {
        watchEvaluationBusyRef.current = false;
      }
    })();
  }, [watchConfigKey, watchTopologyKey, watchEvidenceKey]);

  useEffect(() => {
    if (!onlineWorkspace || !active?.characterId) return;
    let cancelled = false;
    const pollOnlineEvents = async () => {
      try {
        const events = await window.sage.getWormholeOnlineEvents({ characterId: active.characterId, workspaceId: onlineWorkspace.workspace_id, after: lastOnlineEventSequence });
        if (cancelled || !events.length) return;
        setLastOnlineEventSequence(Math.max(...events.map((row) => row.sequence)));
        const wormholeEvents = events.filter((row) => row.event_type === "wormhole_chain.updated" || row.event_type === "wormhole_chain.published");
        if (!wormholeEvents.length) return;
        const rows = await window.sage.listWormholeOnlineChains({ characterId: active.characterId, workspaceId: onlineWorkspace.workspace_id });
        if (cancelled) return;
        setOnlineChains(rows);
        const relevant = loadedOnlineChain ? wormholeEvents.filter((row) => row.object_id === loadedOnlineChain.id && Number(row.object_version ?? 0) > loadedOnlineChain.version) : [];
        if (relevant.length) { setServerUpdatePending(true); setOnlineMessage("A newer corporation chain version is available. Pull latest before updating."); }
      } catch { /* transient online polling never breaks local Wormhole Command */ }
    };
    const timer = window.setInterval(() => void pollOnlineEvents(), 10_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [onlineWorkspace?.workspace_id, active?.characterId, lastOnlineEventSequence, loadedOnlineChain?.id, loadedOnlineChain?.version]);

  const activeSignatures = Object.values(store?.signatures ?? {}).filter((row) => row.status === "active");
  const totalWormholes = activeSignatures.filter((row) => row.kind === "wormhole").length;
  const liveConnections = Object.values(store?.connections ?? {}).filter((row) => row.status !== "expired");

  async function refreshOnlineWorkspaceData(workspace: NavigationOnlineWorkspace = onlineWorkspace as NavigationOnlineWorkspace) {
    if (!workspace || !active?.characterId) return;
    const [chains, audit] = await Promise.all([
      window.sage.listWormholeOnlineChains({ characterId: active.characterId, workspaceId: workspace.workspace_id }),
      window.sage.getWormholeOnlineAudit({ characterId: active.characterId, workspaceId: workspace.workspace_id }),
    ]);
    setOnlineChains(chains);
    setOnlineAudit(audit);
  }

  async function initialiseOnlineEventCursor(workspace: NavigationOnlineWorkspace) {
    if (!active?.characterId) return;
    let cursor = 0;
    for (let page = 0; page < 8; page += 1) {
      const events = await window.sage.getWormholeOnlineEvents({ characterId: active.characterId, workspaceId: workspace.workspace_id, after: cursor });
      if (!events.length) break;
      const next = Math.max(...events.map((row) => row.sequence));
      if (next <= cursor) break;
      cursor = next;
      if (events.length < 250) break;
    }
    setLastOnlineEventSequence(cursor);
  }

  async function connectOnlineWorkspace() {
    if (!active?.characterId) {
      setOnlineMessage("Choose a connected EVE character first.");
      return;
    }
    setOnlineBusy(true);
    try {
      const workspace = await window.sage.getWormholeOnlineWorkspace(active.characterId);
      setOnlineWorkspace(workspace);
      await Promise.all([refreshOnlineWorkspaceData(workspace), initialiseOnlineEventCursor(workspace)]);
      setOnlineMessage(`${workspace.corporation_name} verified — ${workspace.can_manage_wormholes ? "wormhole manager" : "read-only viewer"}.`);
    } catch (error) {
      setOnlineWorkspace(null);
      setOnlineChains([]);
      setOnlineAudit([]);
      setOnlineMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setOnlineBusy(false);
    }
  }

  function onlineRecipientIds() {
    return [...new Set(onlineRecipients.split(/[\s,;]+/).map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))];
  }

  async function publishOnlineChain() {
    if (!onlineWorkspace || !active?.characterId) return;
    if (!onlineWorkspace.can_manage_wormholes) {
      setOnlineMessage("This verified character is a viewer; wormholes.manage is required to publish.");
      return;
    }
    const recipients = onlineVisibility === "restricted" ? onlineRecipientIds() : [];
    if (onlineVisibility === "restricted" && !recipients.length) {
      setOnlineMessage("Restricted sharing needs at least one active Sage-linked EVE character ID.");
      return;
    }
    setOnlineBusy(true);
    try {
      const chain = await window.sage.exportWormholeSharedChain();
      const result = await window.sage.publishWormholeOnlineChain({ characterId: active.characterId, workspaceId: onlineWorkspace.workspace_id, chain, visibility: onlineVisibility, recipientCharacterIds: recipients });
      setLoadedOnlineChain({ id: result.id, version: result.version, visibility: onlineVisibility });
      setServerUpdatePending(false);
      await refreshOnlineWorkspaceData(onlineWorkspace);
      setOnlineMessage(`Published corporation chain v${result.version}. Personal watches and alerts were not uploaded.`);
    } catch (error) {
      setOnlineMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setOnlineBusy(false);
    }
  }

  async function pullOnlineChain(summary: WormholeOnlineChainSummary) {
    if (!onlineWorkspace || !active?.characterId) return;
    setOnlineBusy(true);
    try {
      const object = await window.sage.getWormholeOnlineChain({ characterId: active.characterId, workspaceId: onlineWorkspace.workspace_id, objectId: summary.id });
      const next = await window.sage.importWormholeSharedChain(object.payload);
      setStore(next);
      setLoadedOnlineChain({ id: object.id, version: object.current_version, visibility: object.visibility });
      setOnlineVisibility(object.visibility);
      setServerUpdatePending(false);
      await refreshOnlineWorkspaceData(onlineWorkspace);
      setOnlineMessage(`Pulled server-authoritative chain v${object.current_version}. Local personal watches/alerts were preserved.`);
    } catch (error) {
      setOnlineMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setOnlineBusy(false);
    }
  }

  async function updateOnlineChain() {
    if (!onlineWorkspace || !active?.characterId || !loadedOnlineChain) return;
    if (serverUpdatePending) {
      setOnlineMessage("Server chain is newer. Pull the latest version before publishing local edits.");
      return;
    }
    if (!onlineWorkspace.can_manage_wormholes) {
      setOnlineMessage("wormholes.manage is required to update the corporation chain.");
      return;
    }
    setOnlineBusy(true);
    try {
      const chain = await window.sage.exportWormholeSharedChain();
      const result = await window.sage.updateWormholeOnlineChain({ characterId: active.characterId, workspaceId: onlineWorkspace.workspace_id, objectId: loadedOnlineChain.id, chain, expectedVersion: loadedOnlineChain.version });
      setLoadedOnlineChain((current) => current ? { ...current, version: result.version } : current);
      await refreshOnlineWorkspaceData(onlineWorkspace);
      setOnlineMessage(`Updated corporation chain to v${result.version}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/version_conflict/i.test(message)) {
        setServerUpdatePending(true);
        await refreshOnlineWorkspaceData(onlineWorkspace).catch(() => undefined);
        setOnlineMessage("VERSION CONFLICT — another pilot updated this chain. Pull latest before updating.");
      } else {
        setOnlineMessage(message);
      }
    } finally {
      setOnlineBusy(false);
    }
  }

  async function processScan() {
    if (!active?.location?.solar_system_id) {
      setScannerMessage("Connect and sync a character so Sage knows which solar system this scan belongs to.");
      return;
    }
    const parsed = parseProbeScanner(scannerInput);
    if (!parsed.length) {
      setScannerMessage("No EVE signature IDs were found. Paste the rows copied from the Probe Scanner window.");
      return;
    }
    try {
      const result = await window.sage.recordWormholeScan({
        systemId: active.location.solar_system_id,
        systemName: active.location.solar_system_name || `System ${active.location.solar_system_id}`,
        characterId: active.characterId,
        characterName: active.character.name,
        scannedAt: new Date().toISOString(),
        signatures: parsed,
      });
      setStore(result.store);
      setScanRows(result.reconciliation);
      setSelectedSystemKey(String(active.location.solar_system_id));
      const counts = result.reconciliation.reduce((acc, row) => ({ ...acc, [row.state]: (acc[row.state] ?? 0) + 1 }), {} as Record<SignatureState, number>);
      const quarantined = Object.values(result.store.connections).filter((row) => row.status === "quarantined" && row.quarantinedAt === result.store.updatedAt).length;
      setScannerMessage(`${parsed.length} current signatures · ${counts.new ?? 0} new · ${counts.changed ?? 0} changed · ${counts.missing ?? 0} missing${quarantined ? ` · ${quarantined} link(s) quarantined` : ""}`);
    } catch (error) {
      setScannerMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function refreshSelectedIntel() {
    if (!selectedSystem) return;
    setIntelLoadingSystemId(selectedSystem.systemId);
    try {
      const result = await window.sage.refreshSystemIntelligence({ systemIds:[selectedSystem.systemId], caller:"single", discoverStructures:true, deepKillmailBackfill:true, forceActivity:true });
      const row = result.systems[0];
      if (row) setIntelBySystem((current) => ({ ...current, [String(row.system.systemId)]:row }));
      setIntelMessage(row?.killmailRefresh.queued ? "Refreshed public activity; killmail work queued under the shared zKill courtesy scheduler." : "Selected-system intelligence refreshed.");
    } catch (error) { setIntelMessage(error instanceof Error ? error.message : String(error)); }
    finally { setIntelLoadingSystemId(0); }
  }

  function selectKillSystem(systemId:number) {
    setSelectedSystemKey(String(systemId));
    setSection("intel");
  }

  async function archiveSelectedSystem() {
    if (!selectedSystem || !active) return;
    const next = await window.sage.archiveWormholeSystem({
      systemId: selectedSystem.systemId,
      editorCharacterId: active.characterId,
      editorCharacterName: active.character.name,
    });
    setStore(next);
    const remaining = Object.values(next.systems).find((row) => !row.archivedAt);
    setSelectedSystemKey(remaining ? String(remaining.systemId) : "");
  }

  async function upsertWatch(input:{watchId?:string;kind:WormholeWatchKind;value?:string;enabled?:boolean}) { setStore(await window.sage.upsertWormholeWatch(input)); }
  async function removeWatch(watchId:string) { setStore(await window.sage.removeWormholeWatch(watchId)); }
  async function dismissWatchAlert(alertId:string) { setStore(await window.sage.dismissWormholeWatchAlert(alertId)); }

  async function updateSignature(input: { systemId:number; signatureId:string; siteState?:WormholeSiteState; bookmarkName?:string }) {
    const next = await window.sage.updateWormholeSignature({ ...input, editorCharacterId: active?.characterId, editorCharacterName: active?.character.name });
    setStore(next);
  }

  function mapSignatureFromScanner(systemId:number, signatureId:string) {
    setSelectedSystemKey(String(systemId));
    setMapSignatureRequest({ systemId, signatureId, nonce: Date.now() });
    setSection("map");
  }

  async function updateSystem(input: { systemId: number; alias?: string; notes?: string; status?: WormholeSystemStatus; pinned?: boolean }) {
    const next = await window.sage.updateWormholeSystem({
      ...input,
      editorCharacterId: active?.characterId,
      editorCharacterName: active?.character.name,
    });
    setStore(next);
  }

  async function previewCleanup(minInactiveHours: number) {
    return window.sage.previewWormholeCleanup({ minInactiveHours });
  }

  async function applyCleanup(minInactiveHours: number, systemIds: number[]) {
    const result = await window.sage.applyWormholeCleanup({ minInactiveHours, systemIds, editorCharacterId: active?.characterId, editorCharacterName: active?.character.name });
    setStore(result.store);
    if (selectedSystemKey && result.archivedSystemIds.includes(Number(selectedSystemKey))) {
      const remaining = Object.values(result.store.systems).find((row) => !row.archivedAt);
      setSelectedSystemKey(remaining ? String(remaining.systemId) : "");
    }
    return result;
  }

  async function updateMapMarkers(input: { homeSystemId?: number | null; rallySystemId?: number | null }) {
    const next = await window.sage.updateWormholeMapMarkers(input);
    setStore(next);
    return next;
  }

  async function updateMapLayout(input: Partial<WormholeMapLayout>) {
    const next = await window.sage.updateWormholeMapLayout(input);
    setStore(next);
    return next.mapLayout;
  }

  async function upsertConnection(input: Partial<WormholeConnectionRecord> & { fromSystemId: number }) {
    const result = await window.sage.upsertWormholeConnection({
      ...input,
      editorCharacterId: active?.characterId,
      editorCharacterName: active?.character.name,
    });
    setStore(result.store);
    return result.connection;
  }

  async function removeConnection(connectionId: string) {
    setStore(await window.sage.removeWormholeConnection(connectionId));
  }

  async function replaceSharedChainJson(payload: any) {
    const next = await window.sage.importWormholeSharedChain(payload);
    setStore(next);
  }

  async function mergeSharedChainJson(payload: any) {
    const next = await window.sage.mergeWormholeSharedChain(payload);
    setStore(next);
  }

  if (loading) return <section className="wormhole-command"><div className="wormhole-empty"><strong>Loading Wormhole Command</strong><span>Opening the durable local chain store…</span></div></section>;

  return (
    <section className="wormhole-command">
      <div className="wormhole-command-hero">
        <div>
          <p className="eyebrow">J-SPACE OPERATIONS</p>
          <h2>Wormhole Command</h2>
          <p>Scan, map, assess and operate a wormhole chain from one shared Sage workspace.</p>
        </div>
        <div className="wormhole-command-live">
          <span>{active ? "ACTIVE CAPSULEER" : "NO CAPSULEER"}</span>
          <strong>{active ? active.character.name : "Connect an EVE character"}</strong>
          <small>{active ? `${active.location.solar_system_name || "Unknown system"} · ${active.ship.ship_type_name || "Unknown ship"}` : "Scanner context requires a known current system."}</small>
          {snapshots.length > 1 && <select value={active?.characterId ?? ""} onChange={(event) => onSelectCharacter?.(event.target.value)}>
            {snapshots.map((snapshot) => <option key={snapshot.characterId} value={snapshot.characterId}>{snapshot.character.name}</option>)}
          </select>}
        </div>
      </div>

      {storeError && <div className="wormhole-store-error"><strong>Wormhole store error</strong><span>{storeError}</span></div>}

      <div className="wormhole-command-tabs" role="tablist" aria-label="Wormhole Command sections">
        {sections.map((item) => <button key={item.id} role="tab" aria-selected={section === item.id} className={section === item.id ? "active" : ""} onClick={() => setSection(item.id)}>
          <span>{item.eyebrow}</span><strong>{item.label}</strong>
        </button>)}
      </div>

      <div className="wormhole-command-stage">
        {section === "map" && <ChainWorkspace
          store={store}
          systems={systems}
          active={active}
          currentSystemId={currentSystemId}
          activeSignatureCount={activeSignatures.length}
          totalWormholes={totalWormholes}
          liveConnections={liveConnections}
          reference={reference}
          systemReference={systemReference}
          intelBySystem={intelBySystem}
          followCharacter={followCharacter}
          locationMessage={locationMessage}
          pendingJump={pendingJump}
          signatureRequest={mapSignatureRequest}
          onToggleFollow={() => setFollowCharacter((current) => !current)}
          onClearPendingJump={() => setPendingJump(null)}
          selectedSystemKey={selectedSystemKey}
          onSelect={setSelectedSystemKey}
          onUpdateMapLayout={updateMapLayout}
          onUpdateMapMarkers={updateMapMarkers}
          onPreviewCleanup={previewCleanup}
          onApplyCleanup={applyCleanup}
          onUpsertConnection={upsertConnection}
          onRemoveConnection={removeConnection}
          onReplaceShared={replaceSharedChainJson}
          onMergeShared={mergeSharedChainJson}
        />}
        {section === "scanner" && <ScannerWorkspace active={active} store={store} input={scannerInput} setInput={setScannerInput} rows={scanRows} message={scannerMessage} previousScan={currentSavedScan} onProcess={processScan} onMapSignature={mapSignatureFromScanner} />}
        {section === "intel" && <IntelWorkspace store={store} systems={systems} systemReference={systemReference} selected={selectedSystem} selectedScan={selectedScan} selectedKey={selectedSystemKey} intel={selectedIntel} chainKillFeed={chainKillFeed} intelBySystem={intelBySystem} reference={reference} loading={intelLoadingSystemId === selectedSystem?.systemId} message={intelMessage} onRefresh={refreshSelectedIntel} onUpsertWatch={upsertWatch} onRemoveWatch={removeWatch} onDismissAlert={dismissWatchAlert} onSelect={setSelectedSystemKey} onSelectKill={selectKillSystem} onArchive={archiveSelectedSystem} onUpdate={updateSystem} desktopAlerts={alertPrefs.desktop} audioAlerts={alertPrefs.audio} onDesktopAlerts={setDesktopAlerts} onAudioAlerts={(enabled)=>setAlertPrefs((current)=>({...current,audio:enabled}))} onUpdateMarkers={updateMapMarkers} />}
        {section === "sites" && <SitesWorkspace active={active} store={store} systems={systems} systemReference={systemReference} selected={selectedSystem} selectedKey={selectedSystemKey} onSelect={setSelectedSystemKey} onUpdateSignature={updateSignature} />}
        {section === "rolling" && <RollingWorkspace active={active} reference={reference} />}
        {section === "corp" && <CorporationWorkspace active={active} workspace={onlineWorkspace} chains={onlineChains} audit={onlineAudit} busy={onlineBusy} message={onlineMessage} visibility={onlineVisibility} recipients={onlineRecipients} loaded={loadedOnlineChain} serverUpdatePending={serverUpdatePending} onVisibility={setOnlineVisibility} onRecipients={setOnlineRecipients} onConnect={connectOnlineWorkspace} onRefresh={async () => { if (onlineWorkspace) { setOnlineBusy(true); try { await refreshOnlineWorkspaceData(onlineWorkspace); setOnlineMessage("Corporation chain list and audit refreshed."); } finally { setOnlineBusy(false); } } }} onPublish={publishOnlineChain} onPull={pullOnlineChain} onUpdate={updateOnlineChain} />}
      </div>
    </section>
  );
}

function ChainDataTools({ store, onReplace, onMerge }: { store: WormholeCommandStore | null; onReplace(payload: any): Promise<void>; onMerge(payload: any): Promise<void> }) {
  const [importText, setImportText] = useState("");
  const [message, setMessage] = useState("");
  const scanTimes = useMemo(() => [...new Set((store?.scanHistory ?? []).map((row) => row.scannedAt))].sort((a, b) => Date.parse(b) - Date.parse(a)).slice(0, 100), [store?.scanHistory]);
  const [historyAt, setHistoryAt] = useState("");

  useEffect(() => {
    if (!historyAt && scanTimes[0]) setHistoryAt(scanTimes[0]);
    else if (historyAt && scanTimes.length && !scanTimes.includes(historyAt)) setHistoryAt(scanTimes[0]);
  }, [scanTimes, historyAt]);

  const historical = useMemo(() => reconstructWormholeHistory(store, historyAt), [store, historyAt]);

  async function payload() { return window.sage.exportWormholeSharedChain(); }
  async function copyJson() { try { await window.sage.copyText(JSON.stringify(await payload(), null, 2)); setMessage("Versioned wormhole-chain JSON copied."); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } }
  async function downloadJson() {
    try {
      const value = await payload();
      const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = `new-eden-sage-wormhole-chain-${new Date().toISOString().slice(0, 10)}.json`; document.body.appendChild(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage("Versioned wormhole-chain JSON exported.");
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  }
  async function copySummary() {
    if (!store) return;
    const currentSystems = Object.values(store.systems).filter((row) => !row.archivedAt);
    const activeConnections = Object.values(store.connections).filter((row) => row.status !== "expired" && row.status !== "quarantined");
    const home = store.homeSystemId ? store.systems[String(store.homeSystemId)] : undefined;
    const lines = [
      `New Eden Sage Wormhole Chain${home ? ` — Home ${systemLabel(home)}` : ""}`,
      `${currentSystems.length} systems · ${activeConnections.length} active links · ${Object.values(store.signatures).filter((row) => row.status === "active").length} current signatures`,
      ...activeConnections.slice(0, 40).map((row) => `${systemLabel(store.systems[String(row.fromSystemId)])} -> ${row.toSystemId ? systemLabel(store.systems[String(row.toSystemId)]) : "Unknown"} | ${row.wormholeType || "type ?"} | ${row.status}${row.fromSignatureId ? ` | ${row.fromSignatureId}` : ""}`),
    ];
    await window.sage.copyText(lines.join("\n")); setMessage("Compact chain summary copied.");
  }
  async function importMode(mode: "replace" | "merge") {
    try {
      const parsed = JSON.parse(importText);
      if (mode === "replace") await onReplace(parsed); else await onMerge(parsed);
      setMessage(mode === "replace" ? "Shared chain layer replaced. Personal watches/alerts preserved." : "Chain merged by evidence timestamps. Personal watches/alerts preserved.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Invalid wormhole chain JSON."); }
  }

  return <div className="wormhole-data-history-grid">
    <article className="wormhole-chain-data-tools">
      <div className="wormhole-panel-title"><div><span>Chain data</span><small>Portable Sage JSON contains only operational chain state — never your personal watch rules or alerts.</small></div><b>V1</b></div>
      <div className="wormhole-chain-data-actions"><button type="button" onClick={() => void copySummary()}>Copy summary</button><button type="button" onClick={() => void copyJson()}>Copy JSON</button><button type="button" onClick={() => void downloadJson()}>Download JSON</button></div>
      <label className="wormhole-chain-import"><span>Paste new-eden-sage.wormhole-chain.v1 JSON</span><textarea value={importText} onChange={(event) => setImportText(event.target.value)} placeholder='{"schema":"new-eden-sage.wormhole-chain.v1", ...}' /></label>
      <div className="wormhole-chain-data-actions"><button type="button" disabled={!importText.trim()} onClick={() => void importMode("merge")}>Merge evidence</button><button type="button" disabled={!importText.trim()} onClick={() => void importMode("replace")}>Replace shared layer</button></div>
      {message && <small className="wormhole-chain-data-message">{message}</small>}
    </article>

    <article className="wormhole-history-panel">
      <div className="wormhole-panel-title"><div><span>Historical reconstruction</span><small>Rebuilds a prior chain only from stored timestamps, scan snapshots and retained links. No inferred missing edges.</small></div><b>{historical.connections.length} LINKS</b></div>
      <label><span>Evidence time</span><select value={historyAt} onChange={(event) => setHistoryAt(event.target.value)}><option value="">No scan history</option>{scanTimes.map((time) => <option key={time} value={time}>{new Date(time).toLocaleString()}</option>)}</select></label>
      {historyAt ? <><div className="wormhole-history-metrics"><span><b>{historical.systems.length}</b> systems</span><span><b>{historical.connections.length}</b> surviving links</span><span><b>{historical.scans.length}</b> latest scans</span></div><div className="wormhole-history-list">{historical.connections.slice(0, 30).map((row) => <div key={row.connectionId}><strong>{systemLabel(store?.systems[String(row.fromSystemId)])} → {row.toSystemId ? systemLabel(store?.systems[String(row.toSystemId)]) : "Unknown"}</strong><small>{row.fromSignatureId || "No sig"} · {row.wormholeType || "Type unresolved"} · first seen {new Date(row.discoveredAt).toLocaleString()}</small></div>)}{!historical.connections.length && <div className="wormhole-empty compact">No stored connection evidence survives at this timestamp.</div>}</div></> : <div className="wormhole-empty compact">Scan history will appear here after the first saved scan.</div>}
    </article>
  </div>;
}

function CorporationWorkspace({
  active, workspace, chains, audit, busy, message, visibility, recipients, loaded, serverUpdatePending,
  onVisibility, onRecipients, onConnect, onRefresh, onPublish, onPull, onUpdate,
}: {
  active?: CharacterSnapshot;
  workspace: NavigationOnlineWorkspace | null;
  chains: WormholeOnlineChainSummary[];
  audit: WormholeOnlineAuditEntry[];
  busy: boolean;
  message: string;
  visibility: "workspace" | "restricted";
  recipients: string;
  loaded: { id: string; version: number; visibility: "workspace" | "restricted" } | null;
  serverUpdatePending: boolean;
  onVisibility(value: "workspace" | "restricted"): void;
  onRecipients(value: string): void;
  onConnect(): Promise<void>;
  onRefresh(): Promise<void>;
  onPublish(): Promise<void>;
  onPull(summary: WormholeOnlineChainSummary): Promise<void>;
  onUpdate(): Promise<void>;
}) {
  const access = workspace?.can_manage_wormholes ? "MANAGER" : "VIEWER";
  const changeText = (entry: WormholeOnlineAuditEntry) => {
    const changes = (entry.detail as any)?.changes;
    if (!changes) return (entry.detail as any)?.version ? `v${(entry.detail as any).version}` : "Published";
    const pieces: string[] = [];
    for (const key of ["systems", "signatures", "connections"]) {
      const row = changes[key];
      if (row?.added?.length) pieces.push(`${row.added.length} ${key} added`);
      if (row?.removed?.length) pieces.push(`${row.removed.length} ${key} removed`);
      if (row?.edited?.length) pieces.push(`${row.edited.length} ${key} edited`);
    }
    if (changes.scanHistory?.added) pieces.push(`${changes.scanHistory.added} scans added`);
    if (changes.homeChanged) pieces.push("Home changed");
    if (changes.rallyChanged) pieces.push("Rally changed");
    if (changes.layoutChanged) pieces.push("layout changed");
    return pieces.join(" · ") || `v${(entry.detail as any)?.version ?? "?"}`;
  };

  return <div className="wormhole-corp-workspace">
    <div className="wormhole-section-heading">
      <div>
        <p className="eyebrow">SAGE ONLINE</p>
        <h3>Corporation chain</h3>
        <p>Publish the operational chain to the verified corporation workspace. Topology, scan evidence, notes, status and map state are shared; personal watches and alert history stay on this PC.</p>
      </div>
      <span className={`wormhole-status-chip ${workspace?.can_manage_wormholes ? "manager" : ""}`}>{workspace ? access : "LOCAL ONLY"}</span>
    </div>

    <article className="wormhole-corp-connect">
      <div><span>ACTIVE IDENTITY</span><strong>{active?.character.name ?? "No connected character"}</strong><small>{workspace ? `${workspace.corporation_name} · ${workspace.roles.length ? workspace.roles.join(", ") : "member"}` : "Verify EVE corporation membership to connect this chain."}</small></div>
      <div><button type="button" disabled={!active || busy} onClick={() => void onConnect()}>{workspace ? "Reverify workspace" : "Connect corporation workspace"}</button><button type="button" disabled={!workspace || busy} onClick={() => void onRefresh()}>Refresh</button></div>
    </article>

    {message && <div className={`wormhole-corp-message ${serverUpdatePending ? "conflict" : ""}`}>{message}</div>}

    {workspace && <>
      <div className="wormhole-corp-grid">
        <article>
          <div className="wormhole-panel-title"><div><span>Publish policy</span><small>{workspace.can_manage_wormholes ? "Director/bootstrap/authorised wormholes.manage authority" : "Read-only members can pull visible chains but cannot overwrite them."}</small></div><b>{access}</b></div>
          <label><span>Audience</span><select value={visibility} onChange={(event) => onVisibility(event.target.value as "workspace" | "restricted")}><option value="workspace">Entire verified corporation</option><option value="restricted">Selected Sage-linked members</option></select></label>
          {visibility === "restricted" && <label><span>Recipient EVE character IDs</span><input value={recipients} onChange={(event) => onRecipients(event.target.value)} placeholder="12345678, 87654321"/><small>Recipients must already be active members of this Sage corporation workspace.</small></label>}
          <div className="wormhole-corp-actions"><button type="button" className="primary" disabled={!workspace.can_manage_wormholes || busy} onClick={() => void onPublish()}>Publish new chain</button><button type="button" disabled={!workspace.can_manage_wormholes || !loaded || busy || serverUpdatePending} onClick={() => void onUpdate()}>Update loaded chain {loaded ? `v${loaded.version}` : ""}</button></div>
          {serverUpdatePending && <small className="wormhole-corp-conflict-note">Update locked until you pull the newer server version.</small>}
        </article>
        <article>
          <div className="wormhole-panel-title"><div><span>Access model</span><small>Server-enforced, not renderer trust.</small></div></div>
          <dl className="wormhole-corp-access"><div><dt>Corporation</dt><dd>Verified ESI membership</dd></div><div><dt>Viewer</dt><dd>Read visible chains</dd></div><div><dt>Manager</dt><dd>wormholes.manage</dd></div><div><dt>Restricted</dt><dd>Explicit active Sage-linked recipients</dd></div><div><dt>Conflicts</dt><dd>Expected-version lock</dd></div><div><dt>Personal data</dt><dd>Never uploaded</dd></div></dl>
        </article>
      </div>

      <div className="wormhole-corp-lists">
        <article>
          <div className="wormhole-panel-title"><div><span>Server-authoritative chains</span><small>Pull replaces the shared chain layer locally while preserving private watch/alert state.</small></div><b>{chains.length}</b></div>
          <div className="wormhole-corp-chain-list">{chains.map((chain) => <div key={chain.id} className={loaded?.id === chain.id ? "loaded" : ""}><span><strong>{chain.id}</strong><small>{chain.visibility === "restricted" ? "Restricted ACL" : "Corporation"} · v{chain.current_version} · {new Date(chain.updated_at).toLocaleString()}</small></span><button type="button" disabled={busy} onClick={() => void onPull(chain)}>{loaded?.id === chain.id && loaded.version === chain.current_version ? "Reload" : "Pull"}</button></div>)}{!chains.length && <div className="wormhole-empty compact">No shared chain exists yet.</div>}</div>
        </article>
        <article>
          <div className="wormhole-panel-title"><div><span>Audit trail</span><small>Server account, version and record-level delta from immutable shared-object versions.</small></div><b>{audit.length}</b></div>
          <div className="wormhole-corp-audit">{audit.slice(0, 30).map((entry) => <div key={entry.id}><span><strong>{entry.action.replace("shared_object.", "")}</strong><small>{new Date(entry.created_at).toLocaleString()} · actor {entry.actor_account_id ?? "unknown"}</small></span><p>{changeText(entry)}</p></div>)}{!audit.length && <div className="wormhole-empty compact">No corporation-chain audit entries yet.</div>}</div>
        </article>
      </div>

      <div className="wormhole-corp-event-note"><strong>EVENT STREAM</strong><span>Sage Online publishes wormhole_chain.published / wormhole_chain.updated events through the existing durable-object event infrastructure. Desktop checks the durable event log every 10 seconds and blocks stale updates.</span></div>
    </>}
  </div>;
}

function ChainWorkspace({
  store,
  systems,
  active,
  currentSystemId,
  activeSignatureCount,
  totalWormholes,
  liveConnections,
  reference,
  systemReference,
  intelBySystem,
  followCharacter,
  locationMessage,
  pendingJump,
  signatureRequest,
  onToggleFollow,
  onClearPendingJump,
  selectedSystemKey,
  onSelect,
  onUpdateMapLayout,
  onUpdateMapMarkers,
  onPreviewCleanup,
  onApplyCleanup,
  onUpsertConnection,
  onRemoveConnection,
  onReplaceShared,
  onMergeShared,
}: {
  store: WormholeCommandStore | null;
  systems: WormholeSystemRecord[];
  active?: CharacterSnapshot;
  currentSystemId: number;
  activeSignatureCount: number;
  totalWormholes: number;
  liveConnections: WormholeConnectionRecord[];
  reference: WormholeReferenceEntry[];
  systemReference: Record<string, WormholeSystemReferenceEntry>;
  intelBySystem: Record<string, WormholeSystemIntelligence>;
  followCharacter: boolean;
  locationMessage: string;
  pendingJump: PendingWormholeJump | null;
  signatureRequest: {systemId:number; signatureId:string; nonce:number} | null;
  onToggleFollow(): void;
  onClearPendingJump(): void;
  selectedSystemKey: string;
  onSelect(key: string): void;
  onUpdateMapLayout(input: Partial<WormholeMapLayout>): Promise<WormholeMapLayout>;
  onUpdateMapMarkers(input: { homeSystemId?: number | null; rallySystemId?: number | null }): Promise<WormholeCommandStore>;
  onPreviewCleanup(minInactiveHours:number): Promise<WormholeCleanupPreview>;
  onApplyCleanup(minInactiveHours:number, systemIds:number[]): Promise<{store:WormholeCommandStore; archivedSystemIds:number[]; preview:WormholeCleanupPreview}>;
  onUpsertConnection(input: Partial<WormholeConnectionRecord> & { fromSystemId: number }): Promise<WormholeConnectionRecord>;
  onRemoveConnection(connectionId: string): Promise<void>;
  onReplaceShared(payload:any): Promise<void>;
  onMergeShared(payload:any): Promise<void>;
}) {
  const [fromSystemId, setFromSystemId] = useState(0);
  const [toSystemId, setToSystemId] = useState(0);
  const [fromSignatureId, setFromSignatureId] = useState("");
  const [wormholeType, setWormholeType] = useState("");
  const [label, setLabel] = useState("");
  const [connectionMessage, setConnectionMessage] = useState("");
  const [cleanupHours, setCleanupHours] = useState(24);
  const [cleanupPreview, setCleanupPreview] = useState<WormholeCleanupPreview | null>(null);
  const [cleanupBusy, setCleanupBusy] = useState(false);
  const selectedReference = reference.find((entry) => entry.code === wormholeType);

  useEffect(() => {
    if (!fromSystemId && systems.length) setFromSystemId(systems.some((row) => row.systemId === currentSystemId) ? currentSystemId : systems[0].systemId);
  }, [currentSystemId, fromSystemId, systems]);

  useEffect(() => {
    if (!signatureRequest) return;
    setFromSystemId(signatureRequest.systemId);
    setFromSignatureId(signatureRequest.signatureId);
    setConnectionMessage(`Scanner signature ${signatureRequest.signatureId} selected. Choose/confirm its destination and wormhole type, then save the link.`);
  }, [signatureRequest]);

  useEffect(() => {
    if (!pendingJump) return;
    setFromSystemId(pendingJump.fromSystemId);
    setToSystemId(pendingJump.toSystemId);
    setFromSignatureId("");
    setWormholeType("");
    setLabel(`${pendingJump.fromSystemName} → ${pendingJump.toSystemName}`);
    setConnectionMessage("Jump detected. Choose the source signature used, identify the hole type if known, then confirm the edge.");
  }, [pendingJump]);

  useEffect(() => {
    if (!toSystemId || toSystemId === fromSystemId) setToSystemId(systems.find((row) => row.systemId !== fromSystemId)?.systemId ?? 0);
  }, [fromSystemId, systems, toSystemId]);

  const sourceWormholes = signaturesForSystem(store, fromSystemId).filter((row) => row.status === "active" && row.kind === "wormhole");

  async function createConnection() {
    if (!fromSystemId || !toSystemId || fromSystemId === toSystemId) return;
    try {
      const discoveredAt = new Date().toISOString();
      const expiresAt = selectedReference?.lifetimeMinutes != null ? new Date(Date.parse(discoveredAt) + selectedReference.lifetimeMinutes * 60_000).toISOString() : undefined;
      const connection = await onUpsertConnection({
        fromSystemId,
        toSystemId,
        fromSignatureId: fromSignatureId || undefined,
        wormholeType: wormholeType || undefined,
        label: label || undefined,
        status: "active",
        discoveredAt,
        expiresAt,
      });
      setConnectionMessage(`Connection ${connection.label || connection.connectionId} saved.`);
      if (pendingJump && pendingJump.fromSystemId === fromSystemId && pendingJump.toSystemId === toSystemId) onClearPendingJump();
      setLabel("");
      setWormholeType("");
      setFromSignatureId("");
    } catch (error) {
      setConnectionMessage(error instanceof Error ? error.message : String(error));
    }
  }

  return <div className="wormhole-map-foundation">
    <div className="wormhole-section-heading"><div><p className="eyebrow">CHAIN CONTROL</p><h3>Persistent wormhole chain</h3><p>Systems, signatures and links now live in Sage's durable Electron store. Missing linked signatures quarantine edges instead of erasing history.</p></div><div className="wormhole-heading-actions"><span className="wormhole-status-chip">DURABLE STORE</span><button type="button" className={followCharacter ? "active" : ""} onClick={onToggleFollow}>{followCharacter ? "Stop live follow" : "Follow active character"}</button></div></div>
    <div className={`wormhole-location-follow ${followCharacter ? "active" : ""}`}><span>LIVE ESI LOCATION</span><strong>{locationMessage}</strong><small>{followCharacter ? "Checks every 15 seconds. A detected system transition is never linked to a signature until you confirm it." : "Turn this on while scanning to create unscanned destination nodes as you jump."}</small></div>
    <div className="wormhole-metrics">
      <article><span>Observed systems</span><strong>{systems.length}</strong><small>Active chain records</small></article>
      <article><span>Current signatures</span><strong>{activeSignatureCount}</strong><small>Latest evidence state</small></article>
      <article><span>Wormhole signatures</span><strong>{totalWormholes}</strong><small>Explicitly identified only</small></article>
      <article><span>Known connections</span><strong>{liveConnections.length}</strong><small>{liveConnections.filter((row) => row.status === "quarantined").length} quarantined</small></article>
    </div>

    <WormholeGraph store={store} systems={systems} systemReference={systemReference} intelBySystem={intelBySystem} reference={reference} connections={liveConnections} currentSystemId={currentSystemId} selectedSystemKey={selectedSystemKey} onSelect={onSelect} onUpdateMapLayout={onUpdateMapLayout} />

    <WormholeExitFinder store={store} systems={systems} systemReference={systemReference} currentSystemId={currentSystemId} characterId={active?.characterId} />

    <ChainDataTools store={store} onReplace={onReplaceShared} onMerge={onMergeShared} />

    {pendingJump && <div className="wormhole-pending-jump"><div><span>JUMP DETECTED</span><strong>{pendingJump.fromSystemName} → {pendingJump.toSystemName}</strong><small>{new Date(pendingJump.observedAt).toLocaleTimeString()} · destination node added as unscanned</small></div><div><b>Signature/type still needs confirmation</b><button type="button" onClick={onClearPendingJump}>Dismiss</button></div></div>}

    <div className="wormhole-connection-grid">
      <article className="wormhole-connection-builder">
        <div className="wormhole-panel-title"><div><span>Create manual connection</span><small>No destination/type is inferred. Use only what you've actually observed.</small></div><b>MANUAL EDGE</b></div>
        <div className="wormhole-form-grid">
          <label><span>From system</span><select value={fromSystemId || ""} onChange={(event) => setFromSystemId(Number(event.target.value))}>{systems.map((system) => <option key={system.systemId} value={system.systemId}>{systemLabel(system)}</option>)}</select></label>
          <label><span>To system</span><select value={toSystemId || ""} onChange={(event) => setToSystemId(Number(event.target.value))}><option value="">Choose destination</option>{systems.filter((system) => system.systemId !== fromSystemId).map((system) => <option key={system.systemId} value={system.systemId}>{systemLabel(system)}</option>)}</select></label>
          <label><span>Source signature</span><select value={fromSignatureId} onChange={(event) => setFromSignatureId(event.target.value)}><option value="">Unlinked / unknown</option>{sourceWormholes.map((sig) => <option key={sig.signatureKey} value={sig.id}>{sig.id} · {sig.type || sig.name || "Wormhole"}</option>)}</select></label>
          <label><span>Wormhole code/type</span><select value={wormholeType} onChange={(event) => setWormholeType(event.target.value)}><option value="">Unresolved / not identified</option>{reference.map((entry) => <option key={entry.code} value={entry.code}>{entry.code} · {entry.destinationLabel}</option>)}</select></label>
          <label><span>Label</span><input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="e.g. HOME → C3" /></label>
        </div>
        {selectedReference && <div className="wormhole-reference-strip"><span><b>{selectedReference.code}</b> → {selectedReference.destinationLabel}</span><span>Life {selectedReference.lifetimeMinutes != null ? `${selectedReference.lifetimeMinutes / 60}h` : "unknown"}</span><span>Total {selectedReference.maxStableMassKg != null ? `${formatNumber(selectedReference.maxStableMassKg)} kg` : "unknown"}</span><span>Per jump {selectedReference.maxJumpMassKg != null ? `${formatNumber(selectedReference.maxJumpMassKg)} kg` : "unknown"}</span><em>CCP SDE</em></div>}
        <div className="wormhole-connection-actions"><small>{connectionMessage || "Connection is bidirectional for map purposes; source signature stays attached to the observed side."}</small><button className="wormhole-primary" type="button" disabled={!fromSystemId || !toSystemId || fromSystemId === toSystemId} onClick={createConnection}>Add connection</button></div>
      </article>

      <article className="wormhole-connection-list">
        <div className="wormhole-panel-title"><div><span>Known connections</span><small>Quarantined/expired links are retained but must not be used for active routing.</small></div><b>{liveConnections.length}</b></div>
        {liveConnections.map((connection) => {
          const from = store?.systems[String(connection.fromSystemId)];
          const to = connection.toSystemId ? store?.systems[String(connection.toSystemId)] : undefined;
          const whRef = connection.wormholeType ? reference.find((entry) => entry.code === connection.wormholeType) : undefined;
          return <div className={`wormhole-connection-row status-${connection.status}`} key={connection.connectionId}>
            <div className="wormhole-connection-copy"><strong>{connection.label || `${systemLabel(from)} → ${systemLabel(to)}`}</strong><span>{connection.fromSignatureId || "No sig"} · {connection.wormholeType || "Type unresolved"}{whRef ? ` · ${whRef.destinationLabel}` : ""}</span><small>{formatExpiry(connection.expiresAt)}{whRef?.maxJumpMassKg != null ? ` · max jump ${formatMassKg(whRef.maxJumpMassKg)}` : ""}{connection.quarantineReason ? ` · ${connection.quarantineReason}` : ""}</small></div>
            <select value={connection.status} onChange={(event) => void onUpsertConnection({ ...connection, status: event.target.value as WormholeConnectionStatus })}>{(Object.keys(connectionStatusLabels) as WormholeConnectionStatus[]).map((status) => <option value={status} key={status}>{connectionStatusLabels[status]}</option>)}</select>
            <button type="button" onClick={() => void onRemoveConnection(connection.connectionId)}>Remove</button>
          </div>;
        })}
        {!liveConnections.length && <div className="wormhole-empty compact">No chain connections recorded yet.</div>}
      </article>
    </div>

        <article className="wormhole-cleanup-panel">
      <div className="wormhole-panel-title"><div><span>Chain cleanup</span><small>Preview only archives stale systems disconnected from Home. Home, Rally and Pins are always protected; signatures, links and scan history are retained.</small></div><b>SAFE ARCHIVE</b></div>
      <div className="wormhole-cleanup-controls">
        <label><span>Inactive threshold</span><select value={cleanupHours} onChange={(event) => { setCleanupHours(Number(event.target.value)); setCleanupPreview(null); }}><option value={6}>6 hours</option><option value={12}>12 hours</option><option value={24}>24 hours</option><option value={72}>3 days</option><option value={168}>7 days</option></select></label>
        <button type="button" disabled={cleanupBusy || !store?.homeSystemId} onClick={() => { setCleanupBusy(true); void onPreviewCleanup(cleanupHours).then(setCleanupPreview).finally(() => setCleanupBusy(false)); }}>{cleanupBusy ? "Checking…" : "Preview cleanup"}</button>
        {cleanupPreview?.candidates.length ? <button type="button" className="wormhole-primary" disabled={cleanupBusy} onClick={() => { setCleanupBusy(true); void onApplyCleanup(cleanupHours, cleanupPreview.candidates.map((row) => row.systemId)).then((result) => { setCleanupPreview({ ...result.preview, candidates: result.preview.candidates.filter((row) => !result.archivedSystemIds.includes(row.systemId)), message: result.archivedSystemIds.length ? `Archived ${result.archivedSystemIds.length} stale system${result.archivedSystemIds.length === 1 ? "" : "s"}. History retained.` : result.preview.message }); }).finally(() => setCleanupBusy(false)); }}>Archive {cleanupPreview.candidates.length}</button> : null}
      </div>
      <p className="wormhole-cleanup-message">{cleanupPreview?.message ?? (store?.homeSystemId ? "Nothing changes until you preview and explicitly archive the resulting candidates." : "Set a Home system first so Sage has an authoritative live-chain root.")}</p>
      {cleanupPreview?.candidates.length ? <div className="wormhole-cleanup-list">{cleanupPreview.candidates.map((candidate) => <div key={candidate.systemId}><span><strong>{candidate.alias || candidate.systemName}</strong><small>{candidate.reason}</small></span><b>{candidate.inactiveHours.toFixed(1)}h stale</b></div>)}</div> : null}
    </article>

<div className="wormhole-route-bridge"><div><span>EXISTING SAGE INFRASTRUCTURE</span><strong>Navigation Command already understands wormhole edges</strong><small>Active Wormhole Command links will be published into that existing mixed gate/WH route solver; quarantined and expired links are already modelled separately.</small></div><b>NO SECOND PATHFINDER</b></div>
  </div>;
}



type WormholeExitTarget = { systemId:number; name:string };
type WormholeExitResult = { system:WormholeSystemRecord; band:"high"|"low"|"null"; chainJumps:number; gateJumps:number|null; gateRouteSystemIds:number[]; found:boolean };

function navigationFavouritesForExitFinder(): WormholeExitTarget[] {
  try {
    const parsed=JSON.parse(localStorage.getItem("new-eden-sage-navigation-favourites-v1") ?? "[]");
    if(!Array.isArray(parsed)) return [];
    return parsed.flatMap((row:any)=>Number(row?.systemId)>0 && row?.name ? [{systemId:Number(row.systemId),name:String(row.name)}] : []).slice(0,8);
  } catch { return []; }
}

function chainDistances(store:WormholeCommandStore|null, rootSystemId:number) {
  const distances=new Map<number,number>();
  if(!store?.systems[String(rootSystemId)] || store.systems[String(rootSystemId)].archivedAt) return distances;
  const adjacency=new Map<number,Set<number>>();
  for(const system of Object.values(store.systems)) if(!system.archivedAt) adjacency.set(system.systemId,new Set());
  for(const connection of Object.values(store.connections)) {
    if(!connection.toSystemId || !["active","eol","critical"].includes(connection.status)) continue;
    if(!adjacency.has(connection.fromSystemId) || !adjacency.has(connection.toSystemId)) continue;
    const expiry=connection.expiresAt ? Date.parse(connection.expiresAt) : Number.NaN;
    if(Number.isFinite(expiry) && expiry<=Date.now()) continue;
    adjacency.get(connection.fromSystemId)?.add(connection.toSystemId);
    adjacency.get(connection.toSystemId)?.add(connection.fromSystemId);
  }
  distances.set(rootSystemId,0);
  const queue=[rootSystemId];
  for(let index=0;index<queue.length;index+=1){const current=queue[index];const distance=distances.get(current)??0;for(const next of adjacency.get(current)??[]){if(distances.has(next))continue;distances.set(next,distance+1);queue.push(next);}}
  return distances;
}

function WormholeExitFinder({ store, systems, systemReference, currentSystemId, characterId }: { store:WormholeCommandStore|null; systems:WormholeSystemRecord[]; systemReference:Record<string,WormholeSystemReferenceEntry>; currentSystemId:number; characterId?:string }) {
  const favourites=useMemo(()=>navigationFavouritesForExitFinder(),[]);
  const targets=useMemo<WormholeExitTarget[]>(()=>[{systemId:30000142,name:"Jita"},...favourites.filter((row)=>row.systemId!==30000142)],[favourites]);
  const [targetId,setTargetId]=useState(30000142);
  const [results,setResults]=useState<WormholeExitResult[]>([]);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("Refresh to rank the currently mapped K-space exits.");
  const rootSystemId=store?.homeSystemId ?? currentSystemId ?? systems[0]?.systemId ?? 0;
  const target=targets.find((row)=>row.systemId===targetId) ?? targets[0];

  async function refresh(){
    if(!rootSystemId || !target){setResults([]);setMessage("Set Home/current system and choose a destination first.");return;}
    const distances=chainDistances(store,rootSystemId);
    const candidates=systems.flatMap((system)=>{
      const info=systemReference[String(system.systemId)];
      const band:WormholeExitResult["band"]|null=info?.classLabel==="High-sec"?"high":info?.classLabel==="Low-sec"?"low":info?.classLabel==="Null-sec"?"null":null;
      const chainJumps=distances.get(system.systemId);
      return band && chainJumps!=null ? [{system,band,chainJumps}] : [];
    }).slice(0,40);
    setBusy(true); setMessage(`Calculating gate distance from ${candidates.length} mapped exit${candidates.length===1?"":"s"} to ${target.name}…`);
    try {
      const rows=await Promise.all(candidates.map(async(candidate)=>{
        try {
          if(candidate.system.systemId===target.systemId) return {...candidate,gateJumps:0,gateRouteSystemIds:[target.systemId],found:true};
          const route=await window.sage.calculateNavigationRoute({from:candidate.system.systemId,to:target.systemId,mode:"shortest",minSecurity:null});
          return {...candidate,gateJumps:route.found?route.jumps:null,gateRouteSystemIds:route.found?route.systems.map((row)=>row.systemId):[],found:route.found};
        } catch { return {...candidate,gateJumps:null,gateRouteSystemIds:[],found:false}; }
      }));
      rows.sort((a,b)=>a.chainJumps-b.chainJumps+(a.gateJumps??9999)-(b.gateJumps??9999));
      setResults(rows); setMessage(rows.length?`${rows.length} reachable mapped K-space exit${rows.length===1?"":"s"} ranked from ${store?.systems[String(rootSystemId)] ? systemLabel(store.systems[String(rootSystemId)]) : `System ${rootSystemId}`}.` : "No mapped K-space exit is currently reachable from the chain root.");
    } finally { setBusy(false); }
  }

  useEffect(()=>{setResults([]);setMessage("Chain/target changed — refresh exit intelligence.");},[targetId,rootSystemId,store?.updatedAt]);

  const bestHigh=results.find((row)=>row.band==="high");
  const bestLow=results.find((row)=>row.band==="low");
  const bestNull=results.find((row)=>row.band==="null");
  const fastest=results[0];
  const safest=results.filter((row)=>row.band==="high").sort((a,b)=>a.chainJumps-b.chainJumps+(a.gateJumps??9999)-(b.gateJumps??9999))[0] ?? fastest;

  async function exportExit(row:WormholeExitResult){
    if(!characterId || !row.found || row.gateRouteSystemIds.length<1){setMessage("Choose/connect a character and refresh a valid gate route first.");return;}
    const ids=row.gateRouteSystemIds.slice(1);
    if(!ids.length){setMessage(`${row.system.systemName} is already ${target?.name}.`);return;}
    try { const result=await window.sage.exportNavigationRouteToEve({characterId,systemIds:ids,clearOtherWaypoints:true}); setMessage(`Loaded ${result.waypoints} post-wormhole gate waypoint${result.waypoints===1?"":"s"} into EVE. Traverse the chain to ${systemLabel(row.system)} first.`); }
    catch(error){setMessage(error instanceof Error?error.message:String(error));}
  }

  function card(label:string,row:WormholeExitResult|undefined){return <div className="wormhole-exit-card"><span>{label}</span>{row?<><strong>{systemLabel(row.system)}</strong><small>{row.chainJumps} chain jump{row.chainJumps===1?"":"s"} · {row.band.toUpperCase()} · {row.gateJumps==null?"gate route unavailable":`${row.gateJumps} gates to ${target?.name}`}</small><button type="button" disabled={!characterId||!row.found} onClick={()=>void exportExit(row)}>Load post-WH route to EVE</button></>:<><strong>—</strong><small>No reachable exit in this band.</small></>}</div>}

  return <article className="wormhole-exit-finder">
    <div className="wormhole-panel-title"><div><span>Exit finder</span><small>Ranks only exits actually present in your mapped chain. Gate distances use Sage's existing CCP universe graph.</small></div><b>CHAIN → K-SPACE</b></div>
    <div className="wormhole-exit-controls"><label><span>Gate destination</span><select value={targetId} onChange={(event)=>setTargetId(Number(event.target.value))}>{targets.map((row)=><option key={row.systemId} value={row.systemId}>{row.name}</option>)}</select></label><button type="button" disabled={busy||!rootSystemId} onClick={()=>void refresh()}>{busy?"Calculating…":"Refresh exits"}</button><small>{message}</small></div>
    <div className="wormhole-exit-grid">{card("NEAREST HIGH-SEC",bestHigh)}{card("NEAREST LOW-SEC",bestLow)}{card("NEAREST NULL-SEC",bestNull)}{card("FASTEST EXIT",fastest)}{card("SAFEST EXIT",safest)}</div>
    {results.length>0&&<details className="wormhole-exit-details"><summary>All ranked exits · {results.length}</summary>{results.map((row)=><div key={row.system.systemId}><span><strong>{systemLabel(row.system)}</strong><small>{row.band.toUpperCase()} · {row.chainJumps} chain jumps</small></span><b>{row.gateJumps==null?"—":`${row.gateJumps} gates → ${target?.name}`}</b></div>)}</details>}
  </article>;
}

type GraphPosition = { system: WormholeSystemRecord; x: number; y: number; level: number };

function buildGraphLayout(systems: WormholeSystemRecord[], connections: WormholeConnectionRecord[], rootSystemId: number) {
  const byId = new Map(systems.map((system) => [system.systemId, system]));
  const graph = new Map<number, Set<number>>();
  for (const system of systems) graph.set(system.systemId, new Set());
  for (const connection of connections) {
    if (!connection.toSystemId || !byId.has(connection.fromSystemId) || !byId.has(connection.toSystemId)) continue;
    graph.get(connection.fromSystemId)?.add(connection.toSystemId);
    graph.get(connection.toSystemId)?.add(connection.fromSystemId);
  }
  const root = byId.has(rootSystemId) ? rootSystemId : systems[0]?.systemId;
  const levels = new Map<number, number>();
  if (root != null) {
    const queue = [root];
    levels.set(root, 0);
    for (let index = 0; index < queue.length; index += 1) {
      const current = queue[index];
      const level = levels.get(current) ?? 0;
      for (const next of graph.get(current) ?? []) {
        if (levels.has(next)) continue;
        levels.set(next, level + 1);
        queue.push(next);
      }
    }
  }
  let maxLevel = Math.max(0, ...levels.values());
  for (const system of systems) {
    if (!levels.has(system.systemId)) levels.set(system.systemId, ++maxLevel);
  }
  const grouped = new Map<number, WormholeSystemRecord[]>();
  for (const system of systems) {
    const level = levels.get(system.systemId) ?? 0;
    const bucket = grouped.get(level) ?? [];
    bucket.push(system);
    grouped.set(level, bucket);
  }
  for (const bucket of grouped.values()) bucket.sort((a, b) => systemLabel(a).localeCompare(systemLabel(b)));
  const maxRows = Math.max(1, ...[...grouped.values()].map((bucket) => bucket.length));
  const width = Math.max(680, (Math.max(0, ...grouped.keys()) + 1) * 235 + 60);
  const height = Math.max(270, maxRows * 112 + 70);
  const positions = new Map<number, GraphPosition>();
  for (const [level, bucket] of grouped) {
    const columnHeight = bucket.length * 112;
    const startY = Math.max(34, (height - columnHeight) / 2 + 12);
    bucket.forEach((system, index) => positions.set(system.systemId, { system, level, x: 32 + level * 235, y: startY + index * 112 }));
  }
  return { positions, width, height };
}

function WormholeGraph({ store, systems, systemReference, intelBySystem, reference, connections, currentSystemId, selectedSystemKey, onSelect, onUpdateMapLayout }: { store: WormholeCommandStore | null; systems: WormholeSystemRecord[]; systemReference: Record<string, WormholeSystemReferenceEntry>; intelBySystem: Record<string, WormholeSystemIntelligence>; reference: WormholeReferenceEntry[]; connections: WormholeConnectionRecord[]; currentSystemId: number; selectedSystemKey: string; onSelect(key: string): void; onUpdateMapLayout(input: Partial<WormholeMapLayout>): Promise<WormholeMapLayout> }) {
  const layoutRootSystemId = store?.homeSystemId ?? currentSystemId;
  const automatic = useMemo(() => buildGraphLayout(systems, connections, layoutRootSystemId), [systems, connections, layoutRootSystemId]);
  const saved = store?.mapLayout ?? { positions: {}, zoom: 1, panX: 0, panY: 0, snapToGrid: true };
  const referenceByCode = useMemo(() => new Map(reference.map((entry) => [entry.code, entry])), [reference]);
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>(saved.positions);
  const [zoom, setZoom] = useState(saved.zoom);
  const [snapToGrid, setSnapToGrid] = useState(saved.snapToGrid);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ systemId: number; startX: number; startY: number; originX: number; originY: number; currentX: number; currentY: number; moved: boolean } | null>(null);
  const suppressClickRef = useRef(false);
  const panSaveRef = useRef<number | null>(null);
  const persistQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const zoomValueRef = useRef(saved.zoom);
  const snapValueRef = useRef(saved.snapToGrid);

  useEffect(() => {
    setPositions(saved.positions);
    setZoom(saved.zoom);
    zoomValueRef.current = saved.zoom;
    setSnapToGrid(saved.snapToGrid);
    snapValueRef.current = saved.snapToGrid;
  }, [saved.positions, saved.zoom, saved.snapToGrid]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    element.scrollLeft = saved.panX;
    element.scrollTop = saved.panY;
  }, []);

  const resolvedPositions = useMemo(() => {
    const map = new Map<number, GraphPosition>();
    for (const [systemId, auto] of automatic.positions) {
      const manual = positions[String(systemId)];
      map.set(systemId, manual ? { ...auto, x: manual.x, y: manual.y } : auto);
    }
    return map;
  }, [automatic.positions, positions]);

  const extents = useMemo(() => {
    let maxX = automatic.width;
    let maxY = automatic.height;
    for (const row of resolvedPositions.values()) {
      maxX = Math.max(maxX, row.x + 230);
      maxY = Math.max(maxY, row.y + 130);
    }
    return { width: maxX, height: maxY };
  }, [automatic.width, automatic.height, resolvedPositions]);

  function persist(partial: Partial<WormholeMapLayout>) {
    persistQueueRef.current = persistQueueRef.current
      .then(() => onUpdateMapLayout(partial))
      .catch(() => undefined);
    return persistQueueRef.current;
  }

  function changeZoom(delta: number) {
    const value = Math.max(0.45, Math.min(2.25, Math.round((zoomValueRef.current + delta) * 20) / 20));
    zoomValueRef.current = value;
    setZoom(value);
    void persist({ zoom: value });
  }

  function pointerDown(event: ReactPointerEvent<HTMLButtonElement>, systemId: number, x: number, y: number) {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { systemId, startX: event.clientX, startY: event.clientY, originX: x, originY: y, currentX: x, currentY: y, moved: false };
  }

  function pointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = (event.clientX - drag.startX) / zoom;
    const dy = (event.clientY - drag.startY) / zoom;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    let x = Math.max(0, drag.originX + dx);
    let y = Math.max(0, drag.originY + dy);
    if (snapToGrid) {
      x = Math.round(x / 26) * 26;
      y = Math.round(y / 26) * 26;
    }
    drag.currentX = x;
    drag.currentY = y;
    setPositions((current) => ({ ...current, [String(drag.systemId)]: { x, y } }));
  }

  function pointerUp(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* pointer capture can already be released */ }
    dragRef.current = null;
    if (!drag.moved) return;
    suppressClickRef.current = true;
    window.setTimeout(() => { suppressClickRef.current = false; }, 0);
    const current = { x: drag.currentX, y: drag.currentY };
    setPositions((value) => { const next = { ...value, [String(drag.systemId)]: current }; void persist({ positions: next }); return next; });
  }

  function handleNodeClick(key: string) {
    if (suppressClickRef.current) return;
    onSelect(key);
  }

  function handleScroll() {
    const element = scrollRef.current;
    if (!element) return;
    if (panSaveRef.current) window.clearTimeout(panSaveRef.current);
    panSaveRef.current = window.setTimeout(() => void persist({ panX: element.scrollLeft, panY: element.scrollTop }), 250);
  }

  function autoLayout() {
    setPositions({});
    void persist({ positions: {} });
  }

  function resetView() {
    const element = scrollRef.current;
    setZoom(1);
    if (element) {
      element.scrollLeft = 0;
      element.scrollTop = 0;
    }
    void persist({ zoom: 1, panX: 0, panY: 0 });
  }

  function toggleSnap() {
    const next = !snapValueRef.current;
    snapValueRef.current = next;
    setSnapToGrid(next);
    void persist({ snapToGrid: next });
  }

  const miniScale = Math.min(1, 170 / Math.max(extents.width, extents.height));

  return <article className="wormhole-chain-board">
    <div className="wormhole-panel-title"><div><span>Live chain graph</span><small>Drag systems to organise the chain. Positions, zoom and view are retained across restarts.</small></div><b>{systems.length} NODES · {connections.length} EDGES</b></div>
    <div className="wormhole-graph-toolbar">
      <div><button type="button" onClick={() => changeZoom(-0.15)}>−</button><strong>{Math.round(zoom * 100)}%</strong><button type="button" onClick={() => changeZoom(0.15)}>+</button></div>
      <button type="button" className={snapToGrid ? "active" : ""} onClick={toggleSnap}>Snap {snapToGrid ? "on" : "off"}</button>
      <button type="button" onClick={autoLayout}>Auto layout</button>
      <button type="button" onClick={resetView}>Reset view</button>
    </div>
    {systems.length ? <div className="wormhole-graph-shell">
      <div ref={scrollRef} className="wormhole-graph-scroll" onScroll={handleScroll}>
        <div className="wormhole-graph-zoom-space" style={{ width: extents.width * zoom, height: extents.height * zoom }}>
          <div className="wormhole-graph-canvas" style={{ width: extents.width, height: extents.height, transform: `scale(${zoom})` }}>
            <svg className="wormhole-graph-lines" width={extents.width} height={extents.height} aria-hidden="true">
              {connections.map((connection) => {
                const from = resolvedPositions.get(connection.fromSystemId);
                const to = connection.toSystemId ? resolvedPositions.get(connection.toSystemId) : undefined;
                if (!from || !to) return null;
                const x1 = from.x + 176;
                const y1 = from.y + 38;
                const x2 = to.x;
                const y2 = to.y + 38;
                const mx = (x1 + x2) / 2;
                const my = (y1 + y2) / 2;
                const whRef = connection.wormholeType ? referenceByCode.get(connection.wormholeType) : undefined;
                const title = connection.wormholeType || connection.fromSignatureId || "WH";
                const detail = whRef?.destinationLabel ? `${whRef.destinationLabel.replace(" wormhole space", "")} · ${formatExpiry(connection.expiresAt)}` : `${connectionStatusLabels[connection.status]} · ${formatExpiry(connection.expiresAt)}`;
                return <g key={connection.connectionId} className={"wormhole-graph-edge status-" + connection.status}>
                  <path d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`} />
                  <rect x={mx - 68} y={my - 19} width="136" height="38" rx="9" />
                  <text className="edge-title" x={mx} y={my - 3} textAnchor="middle">{title} · {connectionStatusLabels[connection.status]}</text>
                  <text className="edge-detail" x={mx} y={my + 11} textAnchor="middle">{detail}</text>
                </g>;
              })}
            </svg>
            {[...resolvedPositions.values()].map(({ system, x, y }) => {
              const signatures = signaturesForSystem(store, system.systemId).filter((row) => row.status === "active");
              const wh = signatures.filter((row) => row.kind === "wormhole").length;
              const resolved = signatures.filter((row) => row.kind !== "unknown").length;
              const staticInfo = systemReference[String(system.systemId)];
              const key = String(system.systemId);
              const nodeThreat = assessWormholeThreat(store, system, intelBySystem[key]);
              const hasThreatIntel = Boolean(intelBySystem[key]) || system.status === "hostile";
              return <button type="button" key={system.systemId} title={nodeThreat.reasons.join(" · ")} style={{ left: x, top: y }} className={`wormhole-graph-node status-${system.status} threat-${nodeThreat.level} ${selectedSystemKey === key ? "selected" : ""} ${currentSystemId === system.systemId ? "current" : ""}`} onPointerDown={(event) => pointerDown(event, system.systemId, x, y)} onPointerMove={pointerMove} onPointerUp={pointerUp} onClick={() => handleNodeClick(key)}>
                <span className="wormhole-graph-node-top"><strong>{systemLabel(system)}</strong>{currentSystemId === system.systemId && <b>YOU</b>}</span><span className="wormhole-graph-node-badges">{store?.homeSystemId === system.systemId && <b>HOME</b>}{store?.rallySystemId === system.systemId && <b>RALLY</b>}{system.pinned && <b>PIN</b>}{hasThreatIntel && <b className={`node-threat threat-${nodeThreat.level}`}>{nodeThreat.label}</b>}</span>
                <span className="wormhole-graph-node-meta"><b>{staticInfo?.classLabel ?? "—"}</b><small>{staticInfo?.effectName ?? (staticInfo?.securityLabel || systemStatusLabels[system.status])}</small></span>
                <em>{wh} WH · {Math.max(0, signatures.length - wh)} sites · {resolved}/{signatures.length || 0} resolved</em>
              </button>;
            })}
          </div>
        </div>
      </div>
      <div className="wormhole-graph-minimap" aria-label="Wormhole chain minimap"><span>MINIMAP</span><svg width="180" height="118" viewBox={`0 0 ${Math.max(1, extents.width * miniScale)} ${Math.max(1, extents.height * miniScale)}`} preserveAspectRatio="xMidYMid meet">
        {connections.map((connection) => {
          const from = resolvedPositions.get(connection.fromSystemId);
          const to = connection.toSystemId ? resolvedPositions.get(connection.toSystemId) : undefined;
          if (!from || !to) return null;
          return <line key={connection.connectionId} x1={(from.x + 88) * miniScale} y1={(from.y + 38) * miniScale} x2={(to.x + 88) * miniScale} y2={(to.y + 38) * miniScale} />;
        })}
        {[...resolvedPositions.values()].map((row) => <rect key={row.system.systemId} x={row.x * miniScale} y={row.y * miniScale} width={176 * miniScale} height={76 * miniScale} className={currentSystemId === row.system.systemId ? "current" : ""} />)}
      </svg></div>
    </div> : <div className="wormhole-empty"><strong>No systems scanned yet</strong><span>Open Scanner, paste the Probe Scanner rows and process the scan.</span></div>}
  </article>;
}

function defaultBookmarkName(systemName: string, signature: Pick<WormholeSignatureRecord, "id" | "kind" | "type" | "name"> | WormholeReconciledSignature) {
  const detail = signature.type || signature.name || kindLabels[signature.kind];
  return `${systemName} ${signature.id} ${detail}`.replace(/\s+/g, " ").trim().slice(0, 180);
}

function ScannerWorkspace({ active, store, input, setInput, rows, message, previousScan, onProcess, onMapSignature }: { active?: CharacterSnapshot; store: WormholeCommandStore | null; input: string; setInput(value: string): void; rows: WormholeReconciledSignature[]; message: string; previousScan?: WormholeScanSnapshot; onProcess(): void; onMapSignature(systemId:number, signatureId:string): void }) {
  const counts = rows.reduce((acc, row) => ({ ...acc, [row.state]: (acc[row.state] ?? 0) + 1 }), {} as Record<SignatureState, number>);
  const systemId = active?.location.solar_system_id ?? 0;
  const systemName = active?.location.solar_system_name ?? "Unknown system";
  const recordsById = useMemo(() => new Map(signaturesForSystem(store, systemId).map((row) => [row.id, row])), [store, systemId]);
  const linksById = useMemo(() => {
    const map = new Map<string, WormholeConnectionRecord>();
    for (const connection of Object.values(store?.connections ?? {})) {
      if (connection.fromSystemId === systemId && connection.fromSignatureId) map.set(connection.fromSignatureId, connection);
      if (connection.toSystemId === systemId && connection.toSignatureId) map.set(connection.toSignatureId, connection);
    }
    return map;
  }, [store, systemId]);

  return <div className="wormhole-scanner-workspace">
    <div className="wormhole-section-heading"><div><p className="eyebrow">PROBE SCANNER</p><h3>Paste and reconcile signatures</h3><p>Sage compares the paste against the durable previous scan for this system and preserves the full scan history.</p></div><span className="wormhole-status-chip">{active?.location.solar_system_name ?? "NO SYSTEM"}</span></div>
    <div className="wormhole-scanner-grid">
      <article className="wormhole-scanner-input-card">
        <div className="wormhole-panel-title"><div><span>Scanner clipboard</span><small>Copy rows in EVE's Probe Scanner and paste them below. Unknown rows stay unknown.</small></div>{previousScan && <b>LAST {new Date(previousScan.scannedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</b>}</div>
        <textarea value={input} onChange={(event) => setInput(event.target.value)} placeholder={"ABC-123\tCosmic Signature\tWormhole\tUnstable Wormhole\t100.0%\t4.2 AU\n..."} spellCheck={false} />
        <div className="wormhole-scanner-actions"><div><strong>{message}</strong><small>{active ? `Scan will be stored against ${active.location.solar_system_name}.` : "Connect a character before storing a scan."}</small></div><button className="wormhole-primary" type="button" disabled={!input.trim() || !active} onClick={onProcess}>Process scan</button></div>
      </article>
      <aside className="wormhole-reconcile-summary">
        <div><span>NEW</span><strong>{counts.new ?? 0}</strong><small>Not present last scan</small></div>
        <div><span>CHANGED</span><strong>{counts.changed ?? 0}</strong><small>Known ID, changed evidence</small></div>
        <div><span>MISSING</span><strong>{counts.missing ?? 0}</strong><small>Linked edges quarantine</small></div>
        <div><span>CURRENT</span><strong>{rows.filter((row) => row.state !== "missing").length}</strong><small>Rows in this scan</small></div>
      </aside>
    </div>
    <SignatureTable rows={rows} recordsById={recordsById} linksById={linksById} systemId={systemId} systemName={systemName} onMapSignature={onMapSignature} emptyText="Process a scanner paste to see reconciled signatures." />
  </div>;
}

function SignatureTable({ rows, recordsById, linksById, systemId, systemName, onMapSignature, emptyText }: { rows: WormholeReconciledSignature[]; recordsById: Map<string,WormholeSignatureRecord>; linksById: Map<string,WormholeConnectionRecord>; systemId:number; systemName:string; onMapSignature(systemId:number, signatureId:string):void; emptyText: string }) {
  const [copiedId, setCopiedId] = useState("");
  function copyBookmark(row: WormholeReconciledSignature) {
    const record = recordsById.get(row.id);
    const text = record?.bookmarkName || defaultBookmarkName(systemName, record ?? row);
    void window.sage.copyText(text).then(() => { setCopiedId(row.id); window.setTimeout(() => setCopiedId((current) => current === row.id ? "" : current), 1300); });
  }
  return <div className="wormhole-signature-table">
    <div className="wormhole-signature-row heading operational"><span>Status</span><span>ID</span><span>Kind</span><span>Group / type</span><span>Name</span><span>Strength</span><span>Distance</span><span>Operations</span></div>
    {rows.map((row) => {
      const linked = linksById.get(row.id);
      return <div key={`${row.id}:${row.state}`} className={`wormhole-signature-row operational ${row.state} ${linked ? "linked" : ""}`}>
        <b>{row.state.toUpperCase()}</b><strong>{row.id}</strong><span className={`kind ${row.kind}`}>{kindLabels[row.kind]}</span><span>{[row.group, row.type].filter(Boolean).join(" · ") || "—"}</span><span>{row.name || "—"}</span><span>{row.strength || "—"}</span><span>{row.distance || "—"}</span>
        <div className="wormhole-signature-ops"><button type="button" onClick={() => copyBookmark(row)}>{copiedId === row.id ? "Copied" : "Copy BM"}</button>{row.kind === "wormhole" && row.state !== "missing" && <button type="button" className={linked ? "linked" : ""} onClick={() => onMapSignature(systemId, row.id)}>{linked ? `Linked ${linked.wormholeType || "WH"}` : "Map link"}</button>}</div>
      </div>;
    })}
    {!rows.length && <div className="wormhole-empty compact">{emptyText}</div>}
  </div>;
}

function SystemSelect({ systems, selectedKey, onSelect }: { systems: WormholeSystemRecord[]; selectedKey: string; onSelect(key: string): void }) {
  return <select value={selectedKey || String(systems[0]?.systemId ?? "")} onChange={(event) => onSelect(event.target.value)}>
    {!systems.length && <option value="">No scanned systems</option>}
    {systems.map((system) => <option key={system.systemId} value={String(system.systemId)}>{systemLabel(system)}</option>)}
  </select>;
}

function IntelWorkspace({ store, systems, systemReference, selected, selectedScan, selectedKey, intel, chainKillFeed, intelBySystem, reference, loading, message, desktopAlerts, audioAlerts, onDesktopAlerts, onAudioAlerts, onRefresh, onUpsertWatch, onRemoveWatch, onDismissAlert, onSelect, onSelectKill, onArchive, onUpdate, onUpdateMarkers }: { store: WormholeCommandStore | null; systems: WormholeSystemRecord[]; systemReference: Record<string, WormholeSystemReferenceEntry>; selected?: WormholeSystemRecord; selectedScan?: WormholeScanSnapshot; selectedKey: string; intel?:WormholeSystemIntelligence; chainKillFeed:WormholeKillmailIntel[]; intelBySystem:Record<string,WormholeSystemIntelligence>; reference:WormholeReferenceEntry[]; loading:boolean; message:string; onRefresh():Promise<void>; onUpsertWatch(input:{watchId?:string;kind:WormholeWatchKind;value?:string;enabled?:boolean}):Promise<void>; onRemoveWatch(watchId:string):Promise<void>; onDismissAlert(alertId:string):Promise<void>; onSelect(key: string): void; onSelectKill(systemId:number):void; onArchive(): Promise<void>; onUpdate(input: { systemId: number; alias?: string; notes?: string; status?: WormholeSystemStatus; pinned?: boolean }): Promise<void>; desktopAlerts:boolean; audioAlerts:boolean; onDesktopAlerts(enabled:boolean):Promise<void>; onAudioAlerts(enabled:boolean):void; onUpdateMarkers(input: { homeSystemId?: number | null; rallySystemId?: number | null }): Promise<WormholeCommandStore> }) {
  const [alias, setAlias] = useState("");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<WormholeSystemStatus>("unknown");
  const [pinned, setPinned] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");

  useEffect(() => {
    setAlias(selected?.alias ?? "");
    setNotes(selected?.notes ?? "");
    setStatus(selected?.status ?? "unknown");
    setPinned(Boolean(selected?.pinned));
    setSaveMessage("");
  }, [selected?.systemId, selected?.alias, selected?.notes, selected?.status, selected?.pinned]);

  const signatures = selected ? signaturesForSystem(store, selected.systemId) : [];
  const staticInfo = selected ? systemReference[String(selected.systemId)] : undefined;
  const active = signatures.filter((row) => row.status === "active");
  const wormholes = active.filter((row) => row.kind === "wormhole");
  const threat = assessWormholeThreat(store, selected, intel);
  const byKind = useMemo(() => {
    const counts = {} as Record<WormholeSignatureKind, number>;
    for (const row of active) counts[row.kind] = (counts[row.kind] ?? 0) + 1;
    return counts;
  }, [active]);
  const chainThreats = useMemo(() => systems.map((system) => ({ system, assessment:assessWormholeThreat(store, system, intelBySystem[String(system.systemId)]) })).sort((a,b) => b.assessment.score - a.assessment.score || a.system.systemName.localeCompare(b.system.systemName)), [systems, store, intelBySystem]);
  const selectedKills = (intel?.killmails ?? []).slice(0, 12);

  async function save() {
    if (!selected) return;
    try {
      await onUpdate({ systemId: selected.systemId, alias, notes, status, pinned });
      setSaveMessage("System metadata saved.");
    } catch (error) {
      setSaveMessage(error instanceof Error ? error.message : String(error));
    }
  }

  return <div className="wormhole-intel-workspace">
    <div className="wormhole-section-heading"><div><p className="eyebrow">SYSTEM INTELLIGENCE</p><h3>{selected ? systemLabel(selected) : "No scanned system selected"}</h3><p>Scanner evidence, CCP static data and Sage's existing System News/zKill cache are combined here. Threat labels always expose the evidence behind them.</p></div><div className="wormhole-heading-actions"><SystemSelect systems={systems} selectedKey={selectedKey} onSelect={onSelect} /><button type="button" disabled={!selected || loading} onClick={() => void onRefresh()}>{loading ? "Refreshing…" : "Refresh intel"}</button><button type="button" disabled={!selected} onClick={() => void onArchive()}>Archive system</button></div></div>
    <div className="wormhole-intel-refresh-state"><span>{loading ? "REFRESHING" : intel?.killmailRefresh.queued ? "KILLMAIL QUEUED" : "INTEL"}</span><strong>{message}</strong></div>
    {selected ? <>
      <div className={`wormhole-threat-banner threat-${threat.level}`}><div><span>EVIDENCE-BACKED PVP THREAT</span><strong>{threat.label} · {threat.score}/100</strong><small>{threat.homeDistance == null ? "No current route to Home resolved" : threat.homeDistance === 0 ? "Home system" : `${threat.homeDistance} current chain jump${threat.homeDistance === 1 ? "" : "s"} from Home`}</small></div><ul>{threat.reasons.slice(0,5).map((reason) => <li key={reason}>{reason}</li>)}</ul></div>
      <div className="wormhole-metrics intel-six">
        <article><span>Active signatures</span><strong>{active.length}</strong><small>{signatures.filter((row) => row.status === "missing").length} historical missing</small></article>
        <article><span>Class / effect</span><strong>{staticInfo?.classLabel ?? "—"}</strong><small>{staticInfo?.effectName ?? staticInfo?.securityLabel ?? "CCP data unavailable"}</small></article>
        <article><span>PvP · 1h</span><strong>{threat.pvp1h}</strong><small>Cached non-NPC killmails</small></article>
        <article><span>PvP · 24h</span><strong>{threat.pvp24h}</strong><small>{threat.repeatedCharacters} repeated attacker chars</small></article>
        <article><span>Structures seen</span><strong>{intel?.knownStructures.length ?? 0}</strong><small>Evidence visible to Sage</small></article>
        <article><span>Corp evidence</span><strong>{intel?.localCorporations.length ?? 0}</strong><small>Presence, not assumed residency</small></article>
      </div>
      <div className="wormhole-intel-grid">
        <article><div className="wormhole-panel-title"><div><span>System metadata</span><small>Local operational labels, independent from scan snapshots.</small></div></div>
          <div className="wormhole-system-editor">
            <label><span>Alias</span><input value={alias} onChange={(event) => setAlias(event.target.value)} placeholder="HOME, FARM, C3-A…" /></label>
            <label><span>Status</span><select value={status} onChange={(event) => setStatus(event.target.value as WormholeSystemStatus)}>{(Object.keys(systemStatusLabels) as WormholeSystemStatus[]).map((value) => <option value={value} key={value}>{systemStatusLabels[value]}</option>)}</select></label>
            <label className="wormhole-inline-check"><input type="checkbox" checked={pinned} onChange={(event) => setPinned(event.target.checked)} /><span>Pin / protect from cleanup</span></label><label className="wide"><span>Notes</span><textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Structures, residents, bookmarks, tactical notes…" /></label>
          </div>
          <div className="wormhole-marker-actions"><button type="button" className={store?.homeSystemId === selected.systemId ? "active" : ""} onClick={() => void onUpdateMarkers({ homeSystemId: store?.homeSystemId === selected.systemId ? null : selected.systemId })}>{store?.homeSystemId === selected.systemId ? "Clear home" : "Set home"}</button><button type="button" className={store?.rallySystemId === selected.systemId ? "active" : ""} onClick={() => void onUpdateMarkers({ rallySystemId: store?.rallySystemId === selected.systemId ? null : selected.systemId })}>{store?.rallySystemId === selected.systemId ? "Clear rally" : "Set rally"}</button></div><div className="wormhole-connection-actions"><small>{saveMessage || `Discovered ${new Date(selected.discoveredAt).toLocaleString()}`}</small><button className="wormhole-primary" type="button" onClick={() => void save()}>Save metadata</button></div>
        </article>
        <article><div className="wormhole-panel-title"><div><span>CCP system facts</span><small>Static classification from the local CCP SDE.</small></div></div>{staticInfo ? <><div className="wormhole-intel-line"><span>Class / security</span><strong>{staticInfo.classLabel} · {staticInfo.securityLabel}</strong></div><div className="wormhole-intel-line"><span>System effect</span><strong>{staticInfo.effectName ?? "None recorded"}</strong></div><div className="wormhole-intel-line"><span>Celestials</span><strong>{staticInfo.planetCount} planets · {staticInfo.moonCount} moons · {staticInfo.asteroidBeltCount} belts</strong></div>{staticInfo.effectModifiers.length ? <div className="wormhole-effect-modifiers"><span>EFFECT MODIFIERS</span>{staticInfo.effectModifiers.map((modifier) => <div key={modifier.attributeId}><small>{modifier.name}</small><strong className={modifier.highIsGood === false ? "inverse" : ""}>{formatEffectModifier(modifier)}</strong></div>)}</div> : null}<div className="wormhole-intel-line"><span>Static wormholes</span><small>Not exposed by CCP SDE — intentionally unresolved</small></div></> : <div className="wormhole-empty compact">No CCP system row resolved.</div>}</article>
        <article><div className="wormhole-panel-title"><div><span>Public activity</span><small>Existing System News activity history; deltas need multiple retained samples.</small></div></div>{intel ? (Object.keys(intel.windows) as Array<keyof typeof intel.windows>).map((windowKey) => { const row=intel.windows[windowKey]; return <div className="wormhole-intel-line" key={windowKey}><span>{windowKey.toUpperCase()}</span><strong>{row.delta ? `${row.delta.shipKills} ship · ${row.delta.podKills} pod · ${row.delta.jumps} jumps` : `${row.samples} sample${row.samples === 1 ? "" : "s"}`}</strong></div>; }) : <div className="wormhole-empty compact">Activity cache not loaded yet.</div>}</article>
        <article><div className="wormhole-panel-title"><div><span>Known structures</span><small>Only structures Sage can legitimately observe; absence is not proof of none.</small></div><b>{intel?.knownStructures.length ?? 0}</b></div>{intel?.knownStructures.map((structure,index) => <div className="wormhole-structure-intel" key={structure.structureId ?? `${structure.name}:${index}`}><span><strong>{structure.name}</strong><small>{structure.ownerName || (structure.ownerId ? `Owner ${structure.ownerId}` : "Owner unresolved")}</small></span><em>{structure.source}</em></div>)}{!intel?.knownStructures.length && <div className="wormhole-empty compact">No structures are currently evidenced by Sage's available sources.</div>}</article>
        <article className="wide"><div className="wormhole-panel-title"><div><span>Corporation presence evidence</span><small>Confidence describes observed presence, not residency unless infrastructure/current pilots make that explicit.</small></div><b>{intel?.localCorporations.length ?? 0}</b></div><div className="wormhole-corp-intel-list">{intel?.localCorporations.slice(0,12).map((corp) => <div key={corp.corporationId}><span><strong>{corp.name}{corp.ticker ? ` [${corp.ticker}]` : ""}</strong><small>{corp.evidence}</small></span><div><b>{corp.confidencePercent}%</b><small>{corp.confidenceLabel}</small></div></div>)}{!intel?.localCorporations.length && <div className="wormhole-empty compact">No corporation-presence evidence is currently loaded.</div>}</div></article>
        <article className="wide"><div className="wormhole-panel-title"><div><span>Recent combat evidence</span><small>Same persistent zKill/ESI detail cache used by System News.</small></div><b>{selectedKills.length}/{intel?.killmails.length ?? 0}</b></div><div className="wormhole-kill-feed">{selectedKills.map((kill) => <div key={kill.killmailId} className={kill.npc ? "npc" : "pvp"} onClick={() => onSelectKill(kill.solarSystemId)}><span><strong>Kill {kill.killmailId}</strong><small>{killmailAge(kill)} · victim ship type {kill.victim?.ship_type_id ?? "?"} · {(kill.attackers ?? []).length} attacker{(kill.attackers ?? []).length === 1 ? "" : "s"}</small></span><div><b>{formatIskCompact(kill.totalValue)}</b><button type="button" onClick={(event) => { event.stopPropagation(); void window.sage.openZkillboard(kill.killmailId); }}>zKill</button></div></div>)}{!selectedKills.length && <div className="wormhole-empty compact">No cached killmail evidence for this system yet.</div>}</div></article>
        <article><div className="wormhole-panel-title"><div><span>Signature breakdown</span><small>Current durable signature state.</small></div></div>{(Object.keys(kindLabels) as WormholeSignatureKind[]).map((kind) => <div className="wormhole-intel-line" key={kind}><span>{kindLabels[kind]}</span><strong>{byKind[kind] ?? 0}</strong></div>)}</article>
        <article><div className="wormhole-panel-title"><div><span>Known wormhole signatures</span><small>Type remains unresolved until evidence identifies it.</small></div><b>{wormholes.length}</b></div>{wormholes.map((row) => <div className="wormhole-intel-line" key={row.id}><span><strong>{row.id}</strong> {row.type || row.name || "Wormhole"}</span><small>{row.strength || "Unresolved"}</small></div>)}{!wormholes.length && <div className="wormhole-empty compact">No active wormhole signature is explicitly identified.</div>}</article>
        <article><div className="wormhole-panel-title"><div><span>Scan history</span><small>Recent observations retained for this system.</small></div><b>{selectedScan ? new Date(selectedScan.scannedAt).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}) : "—"}</b></div>{(store?.scanHistory ?? []).filter((scan) => scan.systemId === selected.systemId).slice(-8).reverse().map((scan) => <div className="wormhole-intel-line" key={scan.scanId}><span>{new Date(scan.scannedAt).toLocaleString()}</span><small>{scan.characterName} · {scan.signatures.length} sigs</small></div>)}</article>
        <article><div className="wormhole-panel-title"><div><span>Data limitations</span><small>Sage keeps unavailable evidence explicit.</small></div></div><details className="wormhole-intel-limitations"><summary>{intel?.limitations.length ?? 0} source caveat{intel?.limitations.length === 1 ? "" : "s"}</summary>{intel?.limitations.map((item) => <p key={item}>{item}</p>)}</details></article>
      </div>
      <div className="wormhole-chain-intel-grid">
        <article><div className="wormhole-panel-title"><div><span>Chain threat overview</span><small>Ranked only from evidence currently loaded for mapped systems.</small></div></div>{chainThreats.slice(0,10).map(({system,assessment}) => <button type="button" key={system.systemId} className={`threat-${assessment.level}`} onClick={() => onSelect(String(system.systemId))}><span><strong>{systemLabel(system)}</strong><small>{assessment.reasons[0]}</small></span><b>{assessment.label} · {assessment.score}</b></button>)}</article>
        <article><div className="wormhole-panel-title"><div><span>Chain-wide kill feed</span><small>Latest cached combat evidence across the current chain.</small></div><b>{chainKillFeed.length}</b></div><div className="wormhole-kill-feed compact-feed">{chainKillFeed.slice(0,15).map((kill) => <div key={kill.killmailId} onClick={() => onSelectKill(kill.solarSystemId)}><span><strong>{store?.systems[String(kill.solarSystemId)] ? systemLabel(store.systems[String(kill.solarSystemId)]) : `System ${kill.solarSystemId}`}</strong><small>{killmailAge(kill)} · kill {kill.killmailId}</small></span><div><b>{formatIskCompact(kill.totalValue)}</b><button type="button" onClick={(event) => { event.stopPropagation(); void window.sage.openZkillboard(kill.killmailId); }}>zKill</button></div></div>)}{!chainKillFeed.length && <div className="wormhole-empty compact">No cached combat evidence is currently loaded for the chain.</div>}</div></article>
      </div>
      {store && <WormholeWatchPanel store={store} reference={reference} desktopAlerts={desktopAlerts} audioAlerts={audioAlerts} onDesktopAlerts={onDesktopAlerts} onAudioAlerts={onAudioAlerts} onUpsert={onUpsertWatch} onRemove={onRemoveWatch} onDismiss={onDismissAlert} onSelectAlert={onSelectKill} />}
    </> : <div className="wormhole-empty"><strong>No local wormhole intel yet</strong><span>Process a Probe Scanner paste first.</span></div>}
  </div>;
}

function WormholeWatchPanel({ store, reference, desktopAlerts, audioAlerts, onDesktopAlerts, onAudioAlerts, onUpsert, onRemove, onDismiss, onSelectAlert }: { store:WormholeCommandStore; reference:WormholeReferenceEntry[]; desktopAlerts:boolean; audioAlerts:boolean; onDesktopAlerts(enabled:boolean):Promise<void>; onAudioAlerts(enabled:boolean):void; onUpsert(input:{watchId?:string;kind:WormholeWatchKind;value?:string;enabled?:boolean}):Promise<void>; onRemove(watchId:string):Promise<void>; onDismiss(alertId:string):Promise<void>; onSelectAlert(systemId:number):void }) {
  const [kind,setKind]=useState<WormholeWatchKind>("hostile-activity");
  const [value,setValue]=useState("");
  const [message,setMessage]=useState("");
  const needsValue = kind === "system" || kind === "class" || kind === "effect" || kind === "wormhole-type";
  const labels:Record<WormholeWatchKind,string>={system:"Specific system",class:"System class",effect:"System effect","wormhole-type":"Wormhole type","frigate-hole":"Frigate-limited hole","new-k162":"New K162","hostile-activity":"Hostile activity","near-home":"Connection near Home","eol-connection":"EOL connection","critical-connection":"Critical-mass connection"};
  const effectNames=["Pulsar","Black Hole","Cataclysmic Variable","Magnetar","Red Giant","Wolf Rayet"];
  const classNames=["C1","C2","C3","C4","C5","C6","Thera","Shattered","Drifter"];
  async function addWatch(){
    if(needsValue && !value.trim()){setMessage("Choose a value for this watch.");return;}
    await onUpsert({kind,value:needsValue?value.trim():undefined,enabled:true});
    setMessage(`${labels[kind]} watch added.`);
    if(kind === "system") setValue("");
  }
  return <article className="wormhole-watch-panel">
    <div className="wormhole-panel-title"><div><span>Watch list & alerts</span><small>Persistent local conditions. Matching evidence is fingerprinted so the same event only alerts once.</small></div><b>{store.alerts.length} ALERTS</b></div>
    <div className="wormhole-alert-delivery"><span><strong>DELIVERY</strong><small>Local notifications fire only for newly fingerprinted watch events.</small></span><label><input type="checkbox" checked={desktopAlerts} onChange={(event)=>void onDesktopAlerts(event.target.checked)} /> Desktop</label><label><input type="checkbox" checked={audioAlerts} onChange={(event)=>onAudioAlerts(event.target.checked)} /> Audio</label></div>
    <div className="wormhole-watch-builder">
      <label><span>Watch for</span><select value={kind} onChange={(event)=>{setKind(event.target.value as WormholeWatchKind);setValue("");setMessage("");}}>{(Object.keys(labels) as WormholeWatchKind[]).map((key)=><option key={key} value={key}>{labels[key]}</option>)}</select></label>
      {kind === "system" && <label><span>J-system</span><input value={value} onChange={(event)=>setValue(event.target.value.toUpperCase())} placeholder="J123456" /></label>}
      {kind === "class" && <label><span>Class</span><select value={value} onChange={(event)=>setValue(event.target.value)}><option value="">Choose…</option>{classNames.map((item)=><option key={item} value={item}>{item}</option>)}</select></label>}
      {kind === "effect" && <label><span>Effect</span><select value={value} onChange={(event)=>setValue(event.target.value)}><option value="">Choose…</option>{effectNames.map((item)=><option key={item} value={item}>{item}</option>)}</select></label>}
      {kind === "wormhole-type" && <label><span>WH code</span><select value={value} onChange={(event)=>setValue(event.target.value)}><option value="">Choose…</option>{reference.map((item)=><option key={item.code} value={item.code}>{item.code} · {item.destinationLabel}</option>)}</select></label>}
      {!needsValue && <div className="wormhole-watch-auto-note"><span>AUTOMATIC</span><small>{kind === "hostile-activity" ? "Triggers at evidence-backed DANGER/HOT threat." : kind === "near-home" ? "Triggers for a current connection in Home or one chain jump away." : kind === "frigate-hole" ? "Uses CCP max-jump mass ≤ 5m kg; does not infer from a name." : kind === "eol-connection" ? "Triggers when a retained connection is explicitly marked EOL." : kind === "critical-connection" ? "Triggers when a retained connection is explicitly marked critical mass." : "Triggers when a confirmed K162 connection is added."}</small></div>}
      <button type="button" className="wormhole-primary" onClick={()=>void addWatch()}>Add watch</button>
    </div>
    {message && <p className="wormhole-watch-message">{message}</p>}
    <div className="wormhole-watch-grid">
      <div className="wormhole-watch-list"><div className="wormhole-subhead"><span>ACTIVE CONDITIONS</span><b>{store.watches.filter((row)=>row.enabled).length}/{store.watches.length}</b></div>{store.watches.slice().reverse().map((watch)=><div key={watch.watchId}><span><strong>{labels[watch.kind]}</strong><small>{watch.value || (watch.kind === "frigate-hole" ? "CCP ≤5m kg max-jump" : watch.kind === "new-k162" ? "Any confirmed K162" : watch.kind === "hostile-activity" ? "Threat score ≥40" : watch.kind === "eol-connection" ? "Explicit EOL status" : watch.kind === "critical-connection" ? "Explicit critical status" : "Home / +1 chain jump")}</small></span><div><button type="button" className={watch.enabled?"active":""} onClick={()=>void onUpsert({...watch,enabled:!watch.enabled})}>{watch.enabled?"On":"Off"}</button><button type="button" onClick={()=>void onRemove(watch.watchId)}>Remove</button></div></div>)}{!store.watches.length && <div className="wormhole-empty compact">No watches configured.</div>}</div>
      <div className="wormhole-alert-list"><div className="wormhole-subhead"><span>RECENT ALERTS</span><b>{store.alerts.length}</b></div>{store.alerts.slice(-20).reverse().map((alert)=><div key={alert.alertId} className={alert.systemId?"selectable":""} onClick={()=>alert.systemId && onSelectAlert(alert.systemId)}><span><strong>{labels[alert.kind]}</strong><small>{new Date(alert.createdAt).toLocaleString()}</small><p>{alert.message}</p></span><button type="button" onClick={(event)=>{event.stopPropagation();void onDismiss(alert.alertId);}}>Dismiss</button></div>)}{!store.alerts.length && <div className="wormhole-empty compact">No watch conditions have fired.</div>}</div>
    </div>
  </article>;
}

function normalizeSiteName(value:string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
}

function guideForSignature(reference:WormholePveReferenceSnapshot|null, site:WormholeSignatureRecord, classLabel?:string) {
  if(!reference) return undefined;
  const candidates=[site.name,site.type].filter(Boolean).map((value)=>normalizeSiteName(String(value)));
  if(!candidates.length) return undefined;
  return reference.sites.find((row)=>{
    if(classLabel && /^C[1-6]$/.test(classLabel) && row.classLabel!==classLabel && row.classLabel!=="Gas" && row.classLabel!=="Ore") return false;
    const guide=normalizeSiteName(row.name);
    return candidates.some((candidate)=>candidate===guide || (candidate.length>8 && (candidate.includes(guide)||guide.includes(candidate))));
  });
}

function SiteCard({ site, systemName, guide, onUpdate, onOpenGuide }: { site: WormholeSignatureRecord; systemName:string; guide?:WormholePveSite; onUpdate(input:{systemId:number; signatureId:string; siteState?:WormholeSiteState; bookmarkName?:string}):Promise<void>; onOpenGuide(site:WormholePveSite):void }) {
  const [bookmarkName, setBookmarkName] = useState(site.bookmarkName || defaultBookmarkName(systemName, site));
  const [message, setMessage] = useState("");
  const state = site.siteState ?? "active";

  useEffect(() => { setBookmarkName(site.bookmarkName || defaultBookmarkName(systemName, site)); }, [site.signatureKey, site.bookmarkName, systemName, site.type, site.name]);

  async function changeState(next: WormholeSiteState) {
    await onUpdate({ systemId: site.systemId, signatureId: site.id, siteState: next });
    setMessage(`Marked ${next}.`);
  }

  async function saveBookmark() {
    await onUpdate({ systemId: site.systemId, signatureId: site.id, bookmarkName });
    setMessage("Bookmark name saved.");
  }

  function copyBookmark() {
    const value = bookmarkName.trim() || defaultBookmarkName(systemName, site);
    void window.sage.copyText(value).then(() => { setMessage("Bookmark copied."); });
  }

  return <article className={`site-${site.kind} state-${state}`}>
    <div className="wormhole-site-card-head"><div><span>{kindLabels[site.kind].toUpperCase()}</span><strong>{site.id}</strong></div><b>{state.toUpperCase()}</b></div>
    <h4>{site.name || site.type || site.group || "Unresolved signature"}</h4>
    <p>{[site.group, site.type].filter(Boolean).join(" · ") || "The pasted scan does not identify the site type yet."}</p>
    <small>{site.strength || "Signal unresolved"} {site.distance ? `· ${site.distance}` : ""}</small>
    {guide && <button type="button" className="wormhole-site-guide-match" onClick={()=>onOpenGuide(guide)}><strong>GUIDE MATCH</strong><span>{guide.peakDps.toLocaleString()} peak DPS · {guide.waves.length} wave{guide.waves.length===1?"":"s"}{guide.blueLootIsk?` · ${formatIskCompact(guide.blueLootIsk)} blue loot`:""}</span></button>}
    <div className="wormhole-site-state-actions">
      {(["active", "triggered", "cleared"] as WormholeSiteState[]).map((value) => <button type="button" key={value} className={state === value ? "active" : ""} onClick={() => void changeState(value)}>{value}</button>)}
    </div>
    <div className="wormhole-site-bookmark"><label><span>Bookmark name</span><input value={bookmarkName} onChange={(event) => setBookmarkName(event.target.value)} /></label><div><button type="button" onClick={() => void saveBookmark()}>Save</button><button type="button" onClick={copyBookmark}>Copy</button></div></div>
    {site.siteStateHistory?.length ? <details className="wormhole-site-history"><summary>State history · {site.siteStateHistory.length}</summary>{site.siteStateHistory.slice(-6).reverse().map((event, index) => <div key={`${event.changedAt}:${index}`}><span>{event.state.toUpperCase()}</span><small>{new Date(event.changedAt).toLocaleString()}{event.editorCharacterName ? ` · ${event.editorCharacterName}` : ""}</small></div>)}</details> : null}
    {message && <em className="wormhole-site-message">{message}</em>}
  </article>;
}

function currentFitToAnalysisItems(active?: CharacterSnapshot) {
  const rows=active?.extended?.currentShipFit ?? [];
  const rackFor=(flag:string) => {
    const value=String(flag||"");
    if(/^HiSlot/i.test(value)) return "high";
    if(/^MedSlot/i.test(value)) return "mid";
    if(/^LoSlot/i.test(value)) return "low";
    if(/^RigSlot/i.test(value)) return "rig";
    if(/^SubSystemSlot/i.test(value)) return "subsystem";
    if(/DroneBay/i.test(value)) return "drone";
    if(/FighterBay/i.test(value)) return "fighter";
    if(/Cargo/i.test(value)) return "cargo";
    return "";
  };
  return rows.flatMap((row)=>{
    const rack=rackFor(row.location_flag);
    if(!rack)return [];
    const activeRack=rack==="high"||rack==="mid"||rack==="low";
    return [{typeId:Number(row.type_id),quantity:Math.max(1,Number(row.quantity)||1),rack,state:activeRack?"active" as const:"online" as const}];
  }).filter((row)=>Number.isSafeInteger(row.typeId)&&row.typeId>0);
}

type WormholeSiteReadinessResult = {
  status:"margin"|"caution"|"insufficient"|"unavailable";
  label:string;
  reasons:string[];
  model:any;
  effectiveTank:number;
  tankRatio:number;
  capacitorMarginAfterPeakNeut:number;
  totalDps:number;
  ammoTelemetryMissing:boolean;
};

function assessWormholeSiteFit(model:any, site:WormholePveSite):WormholeSiteReadinessResult {
  const defence=model?.defence ?? {};
  const capacitor=model?.capacitor ?? {};
  const damage=model?.damage ?? {};
  const missingRequirements=Array.isArray(model?.missingRequirements)?model.missingRequirements:[];
  const issues=Array.isArray(model?.issues)?model.issues:[];
  const effectiveTank=Math.max(0,Number(defence.effectiveShieldRepairPerSecond)||0)+Math.max(0,Number(defence.effectiveArmorRepairPerSecond)||0)+Math.max(0,Number(defence.effectiveStructureRepairPerSecond)||0)+Math.max(0,Number(defence.effectivePassiveShieldPeak)||0);
  const tankRatio=site.peakDps>0?effectiveTank/site.peakDps:Infinity;
  const capSupply=Math.max(0,Number(capacitor.peakRechargeGjPerSecond)||0)+Math.max(0,Number(capacitor.injectedGjPerSecond)||0);
  const capDemand=Math.max(0,Number(capacitor.demandGjPerSecond)||0)+Math.max(0,site.peakNeutGjPerSec);
  const capacitorMarginAfterPeakNeut=capSupply-capDemand;
  const totalDps=Math.max(0,Number(damage.totalDps)||0);
  const ammoTelemetryMissing=totalDps<=0 && (model?.hull||"")!=="";
  const reasons:string[]=[];
  if(missingRequirements.length) reasons.push(`${missingRequirements.length} fitted skill requirement${missingRequirements.length===1?"":"s"} not met.`);
  const hardIssues=issues.filter((row:any)=>String(row?.level||"").toLowerCase()==="error");
  if(hardIssues.length) reasons.push(`${hardIssues.length} fitting error${hardIssues.length===1?"":"s"} reported by Sage's DOGMA engine.`);
  if(site.peakDps>0) {
    if(effectiveTank>=site.peakDps*1.15) reasons.push(`Modelled effective tank is ${Math.round(effectiveTank).toLocaleString()} EHP/s versus ${site.peakDps.toLocaleString()} peak source DPS.`);
    else if(effectiveTank>=site.peakDps) reasons.push(`Modelled tank only narrowly exceeds the source peak DPS (${Math.round(effectiveTank).toLocaleString()} vs ${site.peakDps.toLocaleString()} EHP/s).`);
    else reasons.push(`Modelled tank is below source peak DPS (${Math.round(effectiveTank).toLocaleString()} vs ${site.peakDps.toLocaleString()} EHP/s).`);
  }
  if(site.peakNeutGjPerSec>0) {
    if(capacitorMarginAfterPeakNeut<0) reasons.push(`Peak source neut pressure would exceed the modelled capacitor margin by about ${Math.abs(capacitorMarginAfterPeakNeut).toFixed(1)} GJ/s.`);
    else reasons.push(`Peak source neut pressure leaves about ${capacitorMarginAfterPeakNeut.toFixed(1)} GJ/s modelled capacitor margin.`);
  }
  if(site.maxScrams||site.maxWebs) reasons.push(`Source records up to ${site.maxScrams} scram and ${site.maxWebs} web effects in peak wave totals.`);
  if(ammoTelemetryMissing) reasons.push("ESI does not expose loaded ammunition/live module state; outgoing weapon DPS may be understated or unavailable.");
  if(totalDps>0 && site.bestPossibleTime) reasons.push(`Modelled paper DPS is ${Math.round(totalDps).toLocaleString()}; the guide's displayed theoretical time is based on its own ~700-DPS reference model.`);

  if(missingRequirements.length||hardIssues.length||(site.peakDps>0&&effectiveTank<site.peakDps)) return {status:"insufficient",label:"MODEL INSUFFICIENT",reasons,model,effectiveTank,tankRatio,capacitorMarginAfterPeakNeut,totalDps,ammoTelemetryMissing};
  if((site.peakDps>0&&effectiveTank<site.peakDps*1.15)||(site.peakNeutGjPerSec>0&&capacitorMarginAfterPeakNeut<0)||ammoTelemetryMissing||site.maxScrams>0) return {status:"caution",label:"MODEL CAUTION",reasons,model,effectiveTank,tankRatio,capacitorMarginAfterPeakNeut,totalDps,ammoTelemetryMissing};
  return {status:"margin",label:"MODELLED MARGIN",reasons,model,effectiveTank,tankRatio,capacitorMarginAfterPeakNeut,totalDps,ammoTelemetryMissing};
}

function WormholeSiteReadiness({ active, site, effectTypeId }: { active?:CharacterSnapshot; site:WormholePveSite; effectTypeId?:number|null }) {
  const [busy,setBusy]=useState(false);
  const [result,setResult]=useState<WormholeSiteReadinessResult|null>(null);
  const [message,setMessage]=useState("");
  useEffect(()=>{setResult(null);setMessage("");},[site.key,active?.characterId,active?.ship.ship_item_id,effectTypeId]);

  async function check(){
    if(!active?.characterId||!active.ship?.ship_type_id){setMessage("Connect/sync a character with a current ship first.");return;}
    const items=currentFitToAnalysisItems(active);
    if(!items.length){setMessage("Sage has no fitted slot items for the current ship snapshot. Sync the character again or use the Fittings tab.");return;}
    setBusy(true);setMessage("Running Sage's offline DOGMA fit model against this site's peak source pressure…");
    try {
      const model=await window.sage.analyzeFitting({
        characterId:active.characterId,
        hullTypeId:active.ship.ship_type_id,
        itemTypeIds:[...new Set(items.map((row)=>row.typeId))],
        items,
        damageProfile:{em:.25,thermal:.25,kinetic:.25,explosive:.25},
        environmentTypeIds:effectTypeId?[effectTypeId]:[],
      });
      const assessment=assessWormholeSiteFit(model,site);
      setResult(assessment);
      setMessage(effectTypeId?"Applied the selected system's CCP wormhole effect to the fit model.":"No CCP wormhole effect is recorded for the selected system.");
    } catch(error){setResult(null);setMessage(error instanceof Error?error.message:String(error));}
    finally{setBusy(false);}
  }

  return <section className="wormhole-site-readiness">
    <div className="wormhole-panel-title"><div><span>Can I run this?</span><small>Current ship + pilot skills through Sage's offline CCP DOGMA fitter. This is a capability model, not a safety guarantee.</small></div>{result&&<b className={`state-${result.status}`}>{result.label}</b>}</div>
    <div className="wormhole-site-readiness-head"><div><strong>{active?.ship.ship_type_name ?? "No current ship"}</strong><small>{active?.character.name ?? "No connected pilot"}{effectTypeId?" · selected-system effect applied":""}</small></div><button type="button" disabled={busy||!active} onClick={()=>void check()}>{busy?"Modelling…":"Check current ship"}</button></div>
    {message&&<p>{message}</p>}
    {result&&<>
      <div className="wormhole-site-readiness-metrics">
        <div><span>Effective tank</span><strong>{Math.round(result.effectiveTank).toLocaleString()} EHP/s</strong><small>{site.peakDps?`${(result.tankRatio*100).toFixed(0)}% of peak source DPS`:"No source DPS"}</small></div>
        <div><span>Site peak DPS</span><strong>{site.peakDps.toLocaleString()}</strong><small>source model</small></div>
        <div><span>Cap after peak neut</span><strong className={result.capacitorMarginAfterPeakNeut<0?"negative":""}>{result.capacitorMarginAfterPeakNeut.toFixed(1)} GJ/s</strong><small>{site.peakNeutGjPerSec} GJ/s source neut</small></div>
        <div><span>Paper DPS</span><strong>{Math.round(result.totalDps).toLocaleString()}</strong><small>{result.ammoTelemetryMissing?"ammo/live state incomplete":"DOGMA scenario"}</small></div>
        <div><span>Total EHP</span><strong>{Math.round(Number(result.model?.defence?.totalEhp)||0).toLocaleString()}</strong><small>{site.peakAlpha.toLocaleString()} source peak alpha</small></div>
        <div><span>Cap state</span><strong>{result.model?.capacitor?.stable?`Stable ${Math.round(Number(result.model.capacitor.stablePercent)||0)}%`:result.model?.capacitor?.depletionSeconds?`${Math.round(result.model.capacitor.depletionSeconds)}s`:"—"}</strong><small>before external neut stress</small></div>
      </div>
      <div className="wormhole-site-readiness-reasons">{result.reasons.map((reason,index)=><div key={`${reason}:${index}`}>{reason}</div>)}</div>
      <p className="wormhole-site-readiness-warning"><b>Important:</b> ESI does not expose loaded ammunition, current module cycling, manual piloting, transversal/aggro state or actual incoming neut timing. Sage models all fitted high/mid/low modules active and compares against the guide's peak totals. Treat this as evidence for fit planning, not permission to warp in.</p>
    </>}
  </section>;
}

function GuideSiteDetail({ active, site, effectTypeId, onClose }: { active?:CharacterSnapshot; site:WormholePveSite; effectTypeId?:number|null; onClose():void }) {
  const triggerCount=site.waves.flatMap((wave)=>wave.sleepers).filter((row)=>row.trigger).length;
  return <article className="wormhole-guide-detail">
    <div className="wormhole-panel-title"><div><span>{site.classLabel} · {site.category}</span><strong>{site.name}</strong><small>{site.source} · {site.sourceUpdatedAt ? `source updated ${new Date(site.sourceUpdatedAt).toLocaleString()}` : "source update time unavailable"}</small></div><button type="button" onClick={onClose}>Close</button></div>
    <div className="wormhole-guide-metrics">
      <div><span>Peak DPS</span><strong>{site.peakDps.toLocaleString()}</strong></div>
      <div><span>Peak alpha</span><strong>{site.peakAlpha.toLocaleString()}</strong></div>
      <div><span>Peak neut</span><strong>{site.peakNeutGjPerSec ? `${site.peakNeutGjPerSec.toLocaleString()} GJ/s` : "None"}</strong></div>
      <div><span>Scram / web</span><strong>{site.maxScrams} / {site.maxWebs}</strong></div>
      <div><span>Blue loot</span><strong>{site.blueLootIsk ? formatIskCompact(site.blueLootIsk) : "—"}</strong></div>
      <div><span>{site.classLabel==="Gas"?"Gas value":site.classLabel==="Ore"?"Ore value":"Triggers"}</span><strong>{site.resourceValueIsk ? formatIskCompact(site.resourceValueIsk) : triggerCount}</strong></div>
    </div>
    {site.bestPossibleTime && <p className="wormhole-guide-note">Guide 700-DPS theoretical site time: <b>{site.bestPossibleTime}</b>{site.miningTime ? <> · resource clear estimate <b>{site.miningTime}</b></> : null}. These are source-model values, not a Sage guarantee.</p>}
    {site.waves.length>0 && <div className="wormhole-guide-waves">{site.waves.map((wave)=><details key={`${site.key}:${wave.number}`} open={site.waves.length<=2}><summary><span><strong>{wave.label}</strong><small>{wave.sleepers.length} NPC row{wave.sleepers.length===1?"":"s"}</small></span><b>{wave.dps.toLocaleString()} DPS · {wave.alpha.toLocaleString()} alpha · {wave.ehp.toLocaleString()} EHP</b></summary><div className="wormhole-guide-wave-summary"><span>Scram <b>{wave.scram}</b></span><span>Web <b>{wave.web}</b></span><span>Neut <b>{wave.neutGjPerSec} GJ/s</b></span><span>RRep <b>{wave.remoteRepHpPerSec} hp/s</b></span><span>Range <b>{wave.range ?? "—"}</b></span></div><div className="wormhole-guide-sleeper-table"><div className="heading"><span>Trigger</span><span>Qty</span><span>Sleeper</span><span>Class</span><span>DPS</span><span>Alpha</span><span>EHP</span><span>EWAR</span></div>{wave.sleepers.map((npc,index)=><div key={`${npc.name}:${index}`} className={npc.trigger?"trigger":""}><b>{npc.trigger?"⚠ YES":"—"}</b><span>{npc.qty}</span><strong>{npc.name}</strong><span>{npc.hullClass}</span><span>{npc.dps.toLocaleString()}</span><span>{npc.alpha.toLocaleString()}</span><span>{npc.ehp.toLocaleString()}</span><small>{[npc.scram?`${npc.scram} scram`:"",npc.web?`${npc.web} web`:"",npc.neutGjPerSec?`${npc.neutGjPerSec} GJ/s neut`:"",npc.remoteRepHpPerSec?`${npc.remoteRepHpPerSec} hp/s RR`:""].filter(Boolean).join(" · ")||"—"}</small></div>)}</div></details>)}</div>}
    {site.resources.length>0 && <div className="wormhole-guide-resources"><div className="heading"><span>Resource</span><span>Quantity</span><span>Volume</span><span>Cycles</span><span>ISK/m³</span><span>Total</span></div>{site.resources.map((row)=><div key={row.name}><strong>{row.name}</strong><span>{row.quantity.toLocaleString()}</span><span>{row.volumeM3?.toLocaleString() ?? "—"} m³</span><span>{row.cycles?.toLocaleString() ?? "—"}</span><span>{row.iskPerM3?.toLocaleString() ?? "—"}</span><b>{row.totalIsk ? formatIskCompact(row.totalIsk) : "—"}</b></div>)}</div>}
    <WormholeSiteReadiness active={active} site={site} effectTypeId={effectTypeId} />
  </article>;
}

function SitesWorkspace({ active, store, systems, systemReference, selected, selectedKey, onSelect, onUpdateSignature }: { active?:CharacterSnapshot; store: WormholeCommandStore | null; systems: WormholeSystemRecord[]; systemReference:Record<string,WormholeSystemReferenceEntry>; selected?: WormholeSystemRecord; selectedKey: string; onSelect(key: string): void; onUpdateSignature(input:{systemId:number; signatureId:string; siteState?:WormholeSiteState; bookmarkName?:string}):Promise<void> }) {
  const sites = selected ? signaturesForSystem(store, selected.systemId).filter((row) => row.status === "active" && row.kind !== "wormhole") : [];
  const counts = sites.reduce((acc, site) => ({ ...acc, [site.siteState ?? "active"]: (acc[site.siteState ?? "active"] ?? 0) + 1 }), {} as Record<WormholeSiteState,number>);
  const [reference,setReference]=useState<WormholePveReferenceSnapshot|null>(null);
  const [referenceBusy,setReferenceBusy]=useState(false);
  const [referenceMessage,setReferenceMessage]=useState("Loading maintained wormhole PvE reference…");
  const [scope,setScope]=useState("system");
  const [query,setQuery]=useState("");
  const [selectedGuideKey,setSelectedGuideKey]=useState("");
  const staticInfo=selected?systemReference[String(selected.systemId)]:undefined;
  const classScope=/^C[1-6]$/.test(staticInfo?.classLabel ?? "") ? staticInfo!.classLabel : "";

  async function loadReference(force=false){
    setReferenceBusy(true);
    try { const next=await window.sage.getWormholeSiteReference(force); setReference(next); setReferenceMessage(`${next.sites.length} guide entries loaded · ${next.stale?"partial/stale":"live published data"}${next.errors.length?` · ${next.errors.length} source error(s)`:""}.`); }
    catch(error){setReferenceMessage(error instanceof Error?error.message:String(error));}
    finally{setReferenceBusy(false);}
  }

  useEffect(()=>{void loadReference(false);},[]);
  useEffect(()=>{setScope("system");setSelectedGuideKey("");},[selected?.systemId]);

  const availableScope=scope==="system" ? classScope : scope;
  const filteredReference=useMemo(()=>{
    if(!reference)return [];
    const needle=normalizeSiteName(query);
    return reference.sites.filter((row)=>{
      if(availableScope && row.classLabel!==availableScope)return false;
      if(!needle)return true;
      return normalizeSiteName(`${row.name} ${row.category}`).includes(needle);
    });
  },[reference,availableScope,query]);
  const selectedGuide=reference?.sites.find((row)=>row.key===selectedGuideKey);
  const matchCount=sites.filter((site)=>guideForSignature(reference,site,classScope)).length;
  const scopeUpdated=reference && availableScope ? reference.sheetUpdatedAt[availableScope] : undefined;

  return <div className="wormhole-sites-workspace">
    <div className="wormhole-section-heading"><div><p className="eyebrow">SITE CONTROL</p><h3>Current sites + maintained PvE intelligence</h3><p>Live scanner state stays separate from guide data. Waves, triggers, DPS and resource values are source-attributed and refreshable.</p></div><SystemSelect systems={systems} selectedKey={selectedKey} onSelect={onSelect} /></div>
    <div className="wormhole-site-source"><div><strong>{reference?.source ?? "Wormhole PvE reference"}</strong><small>{referenceMessage}{scopeUpdated?` · ${availableScope} updated ${new Date(scopeUpdated).toLocaleString()}`:""}</small></div><button type="button" disabled={referenceBusy} onClick={()=>void loadReference(true)}>{referenceBusy?"Refreshing…":"Refresh guide"}</button></div>
    <div className="wormhole-site-summary"><span>ACTIVE <b>{counts.active ?? 0}</b></span><span>TRIGGERED <b>{counts.triggered ?? 0}</b></span><span>CLEARED <b>{counts.cleared ?? 0}</b></span><span>GUIDE MATCHED <b>{matchCount}/{sites.length}</b></span><span>SYSTEM CLASS <b>{classScope||"—"}</b></span></div>
    <div className="wormhole-site-grid">
      {sites.map((site) => <SiteCard key={site.signatureKey} site={site} systemName={selected?.systemName ?? site.systemName} guide={guideForSignature(reference,site,classScope)} onUpdate={onUpdateSignature} onOpenGuide={(guide)=>setSelectedGuideKey(guide.key)} />)}
      {!sites.length && <div className="wormhole-empty"><strong>No active non-wormhole sites in the selected system</strong><span>Unknown signatures remain unknown until EVE identifies them; Sage does not guess.</span></div>}
    </div>

    <article className="wormhole-guide-browser">
      <div className="wormhole-panel-title"><div><span>Wormhole site reference</span><small>Combat sheets C1–C6 plus Gas and Ore from the maintained published guide. Trigger rows are marked from the source's ⚠ flag.</small></div><b>{filteredReference.length}</b></div>
      <div className="wormhole-guide-controls"><label><span>Scope</span><select value={scope} onChange={(event)=>{setScope(event.target.value);setSelectedGuideKey("");}}><option value="system">Current system {classScope?`(${classScope})`:"(all classes unavailable)"}</option>{["C1","C2","C3","C4","C5","C6","Gas","Ore"].map((value)=><option key={value} value={value}>{value}</option>)}<option value="">All</option></select></label><label><span>Search</span><input value={query} onChange={(event)=>setQuery(event.target.value)} placeholder="site name / category" /></label></div>
      {selectedGuide ? <GuideSiteDetail active={active} site={selectedGuide} effectTypeId={staticInfo?.effectTypeId} onClose={()=>setSelectedGuideKey("")} /> : <div className="wormhole-guide-card-grid">{filteredReference.map((guide)=><button type="button" key={guide.key} onClick={()=>setSelectedGuideKey(guide.key)}><span>{guide.classLabel} · {guide.category}</span><strong>{guide.name}</strong><small>{guide.waves.length?`${guide.waves.length} wave${guide.waves.length===1?"":"s"} · ${guide.peakDps.toLocaleString()} peak DPS · ${guide.peakAlpha.toLocaleString()} alpha`:`${guide.resources.length} resource${guide.resources.length===1?"":"s"}`}</small><em>{guide.resourceValueIsk?formatIskCompact(guide.resourceValueIsk):guide.blueLootIsk?`${formatIskCompact(guide.blueLootIsk)} blue loot`:"Open details"}</em></button>)}</div>}
      {!referenceBusy&&!selectedGuide&&!filteredReference.length&&<div className="wormhole-empty compact">No guide entries match this scope/search.</div>}
    </article>
  </div>;
}

function RollingWorkspace({ active, reference }: { active?: CharacterSnapshot; reference: WormholeReferenceEntry[] }) {
  const [wormholeCode, setWormholeCode] = useState("");
  const [nominalMass, setNominalMass] = useState("");
  const [variance, setVariance] = useState("10");
  const [coldMass, setColdMass] = useState("");
  const [propMass, setPropMass] = useState("");
  const [passes, setPasses] = useState<RollingPass[]>([]);
  const [shipMassContext, setShipMassContext] = useState<WormholeRollingShipMass | null>(null);
  const [shipMassMessage, setShipMassMessage] = useState("Resolving current ship mass…");
  const [selectedPropTypeId, setSelectedPropTypeId] = useState(0);

  const nominal = parsePositiveMass(nominalMass);
  const variancePercent = Math.max(0, Math.min(50, Number(variance) || 0));
  const rollingState = calculateRollingState(nominal, variancePercent, passes);
  const { lowerStart, upperStart, consumed, remainingLow, remainingHigh, currentSide, nextExpectedDirection, sequenceContradictions } = rollingState;
  const selectedReference = reference.find((entry) => entry.code === wormholeCode);

  useEffect(() => {
    let cancelled = false;
    if (!active?.ship.ship_type_id) { setShipMassContext(null); setShipMassMessage("No current ship available."); return; }
    setShipMassMessage("Resolving current fit from CCP SDE + ESI assets…");
    void window.sage.getWormholeRollingShipMass({ shipTypeId: active.ship.ship_type_id, shipName: active.ship.ship_type_name, fittedItems: active.extended?.currentShipFit ?? [] }).then((context) => {
      if (cancelled) return;
      setShipMassContext(context);
      setColdMass(String(Math.round(context.coldMassKg)));
      const firstProp = context.propulsion[0];
      setSelectedPropTypeId(firstProp?.typeId ?? 0);
      setPropMass(firstProp ? String(Math.round(firstProp.propOnMassKg)) : "");
      setShipMassMessage(`Resolved ${context.shipName}: ${formatMassKg(context.coldMassKg)} cold${firstProp ? ` · ${formatMassKg(firstProp.propOnMassKg)} with ${firstProp.name} active` : " · no fitted AB/MWD found"}.`);
    }).catch((error) => { if (!cancelled) { setShipMassContext(null); setShipMassMessage(error instanceof Error ? error.message : String(error)); } });
    return () => { cancelled = true; };
  }, [active?.characterId, active?.ship.ship_item_id, active?.ship.ship_type_id, active?.updatedAt]);

  function selectProp(typeId:number) {
    setSelectedPropTypeId(typeId);
    const prop = shipMassContext?.propulsion.find((row) => row.typeId === typeId);
    setPropMass(prop ? String(Math.round(prop.propOnMassKg)) : "");
  }

  function selectWormholeCode(code: string) {
    setWormholeCode(code);
    const entry = reference.find((row) => row.code === code);
    if (entry?.maxStableMassKg != null) setNominalMass(String(entry.maxStableMassKg));
    else if (code) setNominalMass("");
    setPasses([]);
  }

  function addPass(direction: "OUT" | "IN", mode: "cold" | "prop") {
    const massKg = mode === "cold" ? parsePositiveMass(coldMass) : parsePositiveMass(propMass);
    if (!massKg) return;
    setPasses((current) => [...current, { id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, direction, mode, massKg, createdAt: new Date().toISOString(), pilotCharacterId:active?.characterId, pilotName:active?.character.name, shipTypeId:active?.ship.ship_type_id, shipName:active?.ship.ship_type_name }]);
  }

  const coldWindow = rollingPassWindow(remainingLow, remainingHigh, parsePositiveMass(coldMass));
  const propWindow = rollingPassWindow(remainingLow, remainingHigh, parsePositiveMass(propMass));
  const riskFor = (mass:number) => nominal ? rollingRiskForMass(remainingLow, remainingHigh, mass) : "ENTER MASS" as const;
  const directionalRisk = (direction:"OUT"|"IN", mass:number) => directionalRollingRisk(direction, nextExpectedDirection, riskFor(mass));

  return <div className="wormhole-rolling-workspace">
    <div className="wormhole-section-heading"><div><p className="eyebrow">ROLLING CONTROL</p><h3>Mass log and uncertainty range</h3><p>Log traversals against a nominal hole mass. Sage keeps the lower/upper remaining range visible rather than pretending the hidden initial mass is exact.</p></div><span className="wormhole-status-chip">{currentSide}</span></div>
    <div className="wormhole-rolling-grid">
      <article className="wormhole-roll-controls">
        <div className="wormhole-panel-title"><div><span>Hole model</span><small>Enter verified values for the actual wormhole. No type data is guessed in this slice.</small></div></div>
        <div className="wormhole-form-grid">
          <label><span>CCP wormhole type</span><select value={wormholeCode} onChange={(event) => selectWormholeCode(event.target.value)}><option value="">Manual / unresolved</option>{reference.map((entry) => <option key={entry.code} value={entry.code}>{entry.code} · {entry.destinationLabel}</option>)}</select></label>
          <label><span>Nominal total mass · kg</span><input inputMode="numeric" value={nominalMass} onChange={(event) => setNominalMass(event.target.value)} placeholder="e.g. 3,000,000,000" /></label>
          <label><span>Mass uncertainty · %</span><input type="number" min="0" max="50" step="1" value={variance} onChange={(event) => setVariance(event.target.value)} /></label>
          <label><span>Ship cold mass · kg</span><input inputMode="numeric" value={coldMass} onChange={(event) => setColdMass(event.target.value)} placeholder="Enter verified mass" /></label>
          <label><span>Ship prop-active mass · kg</span><input inputMode="numeric" value={propMass} onChange={(event) => setPropMass(event.target.value)} placeholder="Enter verified mass" /></label>
        </div>
{selectedReference?.maxJumpMassKg != null && shipMassContext && <div className={`wormhole-roll-jump-check ${shipMassContext.coldMassKg > selectedReference.maxJumpMassKg || parsePositiveMass(propMass) > selectedReference.maxJumpMassKg ? "danger" : "safe"}`}><strong>{shipMassContext.coldMassKg > selectedReference.maxJumpMassKg || parsePositiveMass(propMass) > selectedReference.maxJumpMassKg ? "SHIP MASS EXCEEDS THIS HOLE’S MAX-JUMP LIMIT" : "CURRENT ROLLER FITS THROUGH THIS HOLE"}</strong><span>Hole max jump {formatMassKg(selectedReference.maxJumpMassKg)} · cold {formatMassKg(shipMassContext.coldMassKg)}{parsePositiveMass(propMass) ? ` · prop ${formatMassKg(parsePositiveMass(propMass))}` : ""}</span></div>}
                {selectedReference && <div className="wormhole-reference-card"><div><span>CCP SDE TYPE</span><strong>{selectedReference.code} → {selectedReference.destinationLabel}</strong></div><dl><div><dt>Lifetime</dt><dd>{selectedReference.lifetimeMinutes != null ? `${selectedReference.lifetimeMinutes / 60} hours` : "Unknown"}</dd></div><div><dt>Total mass</dt><dd>{selectedReference.maxStableMassKg != null ? `${formatNumber(selectedReference.maxStableMassKg)} kg` : "Unknown"}</dd></div><div><dt>Max jump</dt><dd>{selectedReference.maxJumpMassKg != null ? `${formatNumber(selectedReference.maxJumpMassKg)} kg` : "Unknown"}</dd></div><div><dt>Regeneration</dt><dd>{selectedReference.massRegenerationKg != null ? `${formatNumber(selectedReference.massRegenerationKg)} kg/cycle` : "Unknown"}</dd></div></dl></div>}
        <div className="wormhole-roll-active-ship"><span>Selected Sage ship</span><strong>{active?.ship.ship_type_name ?? "—"}</strong><small>{shipMassMessage}</small>{shipMassContext && <><div className="wormhole-roll-mass-breakdown"><span><b>Base hull</b>{formatMassKg(shipMassContext.baseMassKg)}</span><span><b>Fitted cold</b>{formatMassKg(shipMassContext.coldMassKg)}</span><span><b>Mass modifiers</b>{shipMassContext.passiveModifiers.length}</span><span><b>Fitted items read</b>{shipMassContext.fittedItemCount}</span></div>{shipMassContext.propulsion.length > 1 && <label className="wormhole-roll-prop-select"><span>Prop-active scenario</span><select value={selectedPropTypeId} onChange={(event) => selectProp(Number(event.target.value))}>{shipMassContext.propulsion.map((prop) => <option key={`${prop.typeId}:${prop.locationFlag}`} value={prop.typeId}>{prop.name} · {formatMassKg(prop.propOnMassKg)}</option>)}</select></label>}{shipMassContext.passiveModifiers.length > 0 && <details className="wormhole-roll-mass-details"><summary>Mass modifier breakdown</summary>{shipMassContext.passiveModifiers.map((modifier,index) => <div key={`${modifier.typeId}:${modifier.locationFlag}:${index}`}><span><strong>{modifier.name}</strong><small>{modifier.effectName} · op {modifier.operation} · {modifier.value}</small></span><b>{formatMassKg(modifier.beforeKg)} → {formatMassKg(modifier.afterKg)}</b></div>)}</details>}</>}</div>
        <div className="wormhole-roll-buttons">
          <button type="button" className={nextExpectedDirection === "OUT" ? "expected" : ""} disabled={!parsePositiveMass(coldMass)} title={directionalRisk("OUT", parsePositiveMass(coldMass))} onClick={() => addPass("OUT", "cold")}>OUT · cold</button>
          <button type="button" className={nextExpectedDirection === "IN" ? "expected" : ""} disabled={!parsePositiveMass(coldMass)} title={directionalRisk("IN", parsePositiveMass(coldMass))} onClick={() => addPass("IN", "cold")}>IN · cold</button>
          <button type="button" className={nextExpectedDirection === "OUT" ? "expected" : ""} disabled={!parsePositiveMass(propMass)} title={directionalRisk("OUT", parsePositiveMass(propMass))} onClick={() => addPass("OUT", "prop")}>OUT · prop</button>
          <button type="button" className={nextExpectedDirection === "IN" ? "expected" : ""} disabled={!parsePositiveMass(propMass)} title={directionalRisk("IN", parsePositiveMass(propMass))} onClick={() => addPass("IN", "prop")}>IN · prop</button>
        </div>
      </article>
      <aside className="wormhole-roll-summary">
        <div><span>Starting range</span><strong>{nominal ? `${formatNumber(lowerStart)} – ${formatNumber(upperStart)}` : "—"}</strong><small>kg</small></div>
        <div><span>Logged mass</span><strong>{formatNumber(consumed)}</strong><small>kg across {passes.length} passes</small></div>
        <div><span>Remaining range</span><strong>{nominal ? `${formatNumber(remainingLow)} – ${formatNumber(remainingHigh)}` : "—"}</strong><small>kg</small></div>
        <div><span>Next expected pass</span><strong>{nextExpectedDirection}</strong><small>{currentSide === "HOME SIDE" ? "Outbound collapse can strand the roller." : "Inbound collapse returns the roller home if transit completes."}</small></div>
        <div><span>Cold pass window</span><strong>{coldWindow ? `${coldWindow.guaranteedSafePasses} safe · ${coldWindow.firstUncertainPass}–${coldWindow.maximumPasses} collapse window` : "—"}</strong><small>{directionalRisk(nextExpectedDirection, parsePositiveMass(coldMass))}</small></div>
        <div><span>Prop pass window</span><strong>{propWindow ? `${propWindow.guaranteedSafePasses} safe · ${propWindow.firstUncertainPass}–${propWindow.maximumPasses} collapse window` : "—"}</strong><small>{directionalRisk(nextExpectedDirection, parsePositiveMass(propMass))}</small></div>
      </aside>
    </div>
    <article className="wormhole-roll-log">
      <div className="wormhole-panel-title"><div><span>Traversal log</span><small>Direction is explicit; the final OUT/IN pass drives the displayed roller side.</small></div><div className="wormhole-log-actions"><button type="button" disabled={!passes.length} onClick={() => setPasses((current) => current.slice(0, -1))}>Undo last</button><button type="button" disabled={!passes.length} onClick={() => setPasses([])}>Reset</button></div></div>
      {sequenceContradictions.length > 0 && <div className="wormhole-roll-sequence-warning"><strong>TRAVERSAL SEQUENCE CONTRADICTION</strong><span>{sequenceContradictions.length} pass{sequenceContradictions.length === 1 ? "" : "es"} repeat the previous direction. Check the log before relying on side/strand calculations.</span></div>}
      <div className="wormhole-roll-row heading detailed"><span>#</span><span>Direction</span><span>Mode</span><span>Mass</span><span>Pilot / hull</span><span>Time</span></div>
      {passes.map((pass, index) => <div className={`wormhole-roll-row detailed ${index > 0 && passes[index-1].direction === pass.direction ? "contradiction" : ""}`} key={pass.id}><span>{index + 1}</span><strong>{pass.direction}</strong><span>{pass.mode === "prop" ? "Prop active" : "Cold"}</span><b>{formatNumber(pass.massKg)} kg</b><span><strong>{pass.pilotName || "Unknown pilot"}</strong><small>{pass.shipName || "Unknown hull"}</small></span><span>{new Date(pass.createdAt).toLocaleTimeString()}</span></div>)}
      {!passes.length && <div className="wormhole-empty compact">No rolling traversals logged.</div>}
    </article>
  </div>;
}
