import {
  refreshSystemIntelligence,
  type KillmailIntel,
  type SystemIntelligence,
} from "./system-intelligence";
import { loadSharedPublicSource } from "./shared-market-data";
import { getNavigationHazardSnapshot } from "./navigation-hazards";
import { getNavigationStaticMetadata } from "./navigation-static-metadata";
import {
  getNavigationStargates,
  type NavigationRouteEdge,
} from "./universe-route-graph";

export const ROUTE_GATE_KILL_THRESHOLD_METERS = 250_000;
const SOVEREIGNTY_CACHE_MS = 10 * 60 * 1000;

export type GateKillConfidence = "high" | "medium" | "low";
export type GateKillClassification = {
  killmailId: number;
  killmailTime?: string;
  gateId: number;
  destinationSystemId: number;
  destinationSystemName: string;
  distanceMeters: number;
  confidence: GateKillConfidence;
  thresholdMeters: number;
};

export type RouteKillWindow = {
  kills: number;
  totalValue: number;
  gateKills: number;
};

export type GateDangerState = "clear" | "activity" | "dangerous" | "camp-likely" | "active-camp";
export type GateDangerAssessment = {
  state: GateDangerState;
  label: "Clear" | "Activity" | "Dangerous" | "Camp likely" | "Active camp";
  score: number;
  reasons: string[];
  metrics: {
    gateKills1h: number;
    gateKills2h: number;
    gateKills6h: number;
    gateKills24h: number;
    systemKills1h: number;
    shipLosses2h: number;
    podLosses2h: number;
    recurringAttackers: number;
    repeatedAttackerAppearances: number;
    uniqueAttackers2h: number;
    jumps: number;
  };
};

type SovereigntySystemRow = {
  solar_system_id: number;
  claim?: {
    alliance?: {
      alliance_id?: number;
      corporation_id?: number;
      claimed_since?: string;
      sovereignty_hub?: unknown;
      is_capital_system?: boolean;
      development?: unknown;
    };
    faction?: { faction_id?: number };
    unclaimed?: boolean;
  };
};

type SovereigntySystemsPayload = {
  solar_systems?: SovereigntySystemRow[];
};

export type NavigationRouteSystemIntelligence = {
  system: SystemIntelligence;
  activity: {
    shipKills: number;
    podKills: number;
    npcKills: number;
    jumps: number;
  };
  killWindows: Record<"1h" | "2h" | "6h" | "24h" | "7d" | "30d", RouteKillWindow>;
  gateClassifications: GateKillClassification[];
  routeGate: null | {
    gateId: number;
    destinationSystemId: number;
    destinationSystemName: string;
    windows: Record<"1h" | "2h" | "6h" | "24h", { kills: number }>;
    classifiedKills: GateKillClassification[];
    danger: GateDangerAssessment;
  };
  ownership: {
    allianceId: number | null;
    corporationId: number | null;
    factionId: number | null;
    source: "ESI sovereignty" | "unavailable";
  };
  hazards: {
    incursion: boolean;
    triglavian: boolean | null;
    edencom: boolean | null;
  };
  infrastructure: {
    npcStations: number;
    knownStructures: number;
    structures: SystemIntelligence["knownStructures"];
  };
};

export type NavigationRouteIntelligence = {
  generatedAt: string;
  activityFetchedAt: string | null;
  systems: NavigationRouteSystemIntelligence[];
  killmailRefresh: Awaited<ReturnType<typeof refreshSystemIntelligence>>["killmailRefresh"];
  sources: {
    activity: "ESI system activity";
    kills: "shared zKillboard/ESI killmail cache";
    gateGeometry: "CCP SDE";
    ownership: "ESI sovereignty" | "unavailable";
    hazards: "Navigation hazard providers";
    infrastructure: "CCP SDE + shared System Intelligence evidence";
  };
};

type Stargate = Awaited<ReturnType<typeof getNavigationStargates>>[number];

let sovereigntyCache: { expiresAt: number; rows: Map<number, SovereigntySystemRow> } | null = null;
let sovereigntyPromise: Promise<Map<number, SovereigntySystemRow>> | null = null;

async function getSovereigntySystemsMap(): Promise<Map<number, SovereigntySystemRow>> {
  if (sovereigntyCache && sovereigntyCache.expiresAt > Date.now()) return sovereigntyCache.rows;
  if (sovereigntyPromise) return sovereigntyPromise;
  sovereigntyPromise = loadSharedPublicSource<SovereigntySystemsPayload>("sovereignty-systems")
    .then((source) => {
      if (!source) throw new Error("Shared sovereignty data is not installed yet.");
      const rows = new Map<number, SovereigntySystemRow>();
      for (const row of Array.isArray(source.data?.solar_systems) ? source.data.solar_systems : []) {
        const systemId = Number(row?.solar_system_id ?? 0);
        if (Number.isSafeInteger(systemId) && systemId > 0) rows.set(systemId, row);
      }
      sovereigntyCache = { expiresAt: Date.now() + SOVEREIGNTY_CACHE_MS, rows };
      return rows;
    })
    .catch(() => new Map<number, SovereigntySystemRow>())
    .finally(() => { sovereigntyPromise = null; });
  return sovereigntyPromise;
}

function killPosition(killmail: KillmailIntel) {
  const position = killmail?.victim?.position;
  if (!position) return null;
  const x = Number(position.x);
  const y = Number(position.y);
  const z = Number(position.z);
  return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z) ? { x, y, z } : null;
}

function distanceMeters(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

export function classifyKillmailNearGate(killmail: KillmailIntel, gates: Stargate[], thresholdMeters = ROUTE_GATE_KILL_THRESHOLD_METERS): GateKillClassification | null {
  const position = killPosition(killmail);
  if (!position || !gates.length) return null;
  let nearest: Stargate | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const gate of gates) {
    const distance = distanceMeters(position, gate.position);
    if (distance < nearestDistance) {
      nearest = gate;
      nearestDistance = distance;
    }
  }
  if (!nearest || nearestDistance > thresholdMeters) return null;
  const confidence: GateKillConfidence = nearestDistance <= 50_000 ? "high" : nearestDistance <= 100_000 ? "medium" : "low";
  return {
    killmailId: killmail.killmailId,
    killmailTime: killmail.killmailTime,
    gateId: nearest.gateId,
    destinationSystemId: nearest.destinationSystemId,
    destinationSystemName: nearest.destinationSystemName,
    distanceMeters: Math.round(nearestDistance),
    confidence,
    thresholdMeters,
  };
}

function windowStats(killmails: KillmailIntel[], classifications: GateKillClassification[], milliseconds: number, now: number, gateId?: number): RouteKillWindow {
  const cutoff = now - milliseconds;
  const scoped = killmails.filter((item) => Date.parse(String(item.killmailTime ?? "")) >= cutoff);
  const gateKills = classifications.filter((item) => Date.parse(String(item.killmailTime ?? "")) >= cutoff && (gateId == null || item.gateId === gateId)).length;
  return {
    kills: scoped.length,
    totalValue: scoped.reduce((sum, item) => sum + Number(item.totalValue ?? 0), 0),
    gateKills,
  };
}

export function buildKillWindows(killmails: KillmailIntel[], classifications: GateKillClassification[], now = Date.now()) {
  return {
    "1h": windowStats(killmails, classifications, 60 * 60 * 1000, now),
    "2h": windowStats(killmails, classifications, 2 * 60 * 60 * 1000, now),
    "6h": windowStats(killmails, classifications, 6 * 60 * 60 * 1000, now),
    "24h": windowStats(killmails, classifications, 24 * 60 * 60 * 1000, now),
    "7d": windowStats(killmails, classifications, 7 * 24 * 60 * 60 * 1000, now),
    "30d": windowStats(killmails, classifications, 30 * 24 * 60 * 60 * 1000, now),
  };
}

function attackerKey(attacker: any) {
  const characterId = Number(attacker?.character_id ?? 0);
  if (characterId > 0) return `character:${characterId}`;
  const corporationId = Number(attacker?.corporation_id ?? 0);
  if (corporationId > 0) return `corporation:${corporationId}`;
  const factionId = Number(attacker?.faction_id ?? 0);
  if (factionId > 0) return `faction:${factionId}`;
  return "";
}

function gateKillmails(killmails: KillmailIntel[], classifications: GateKillClassification[], gateId: number, milliseconds: number, now: number) {
  const cutoff = now - milliseconds;
  const ids = new Set(classifications.filter((item) => item.gateId === gateId && Date.parse(String(item.killmailTime ?? "")) >= cutoff).map((item) => item.killmailId));
  return killmails.filter((item) => ids.has(item.killmailId));
}

export function deriveGateDanger(
  killmails: KillmailIntel[],
  classifications: GateKillClassification[],
  gateId: number,
  activity: { jumps?: number; shipKills?: number; podKills?: number } = {},
  now = Date.now(),
): GateDangerAssessment {
  const gate1h = gateKillmails(killmails, classifications, gateId, 60 * 60 * 1000, now);
  const gate2h = gateKillmails(killmails, classifications, gateId, 2 * 60 * 60 * 1000, now);
  const gate6h = gateKillmails(killmails, classifications, gateId, 6 * 60 * 60 * 1000, now);
  const gate24h = gateKillmails(killmails, classifications, gateId, 24 * 60 * 60 * 1000, now);
  const system1h = killmails.filter((item) => Date.parse(String(item.killmailTime ?? "")) >= now - 60 * 60 * 1000);
  const attackerCounts = new Map<string, number>();
  for (const killmail of gate2h) {
    const seenThisKill = new Set<string>();
    for (const attacker of Array.isArray(killmail.attackers) ? killmail.attackers : []) {
      const key = attackerKey(attacker);
      if (key) seenThisKill.add(key);
    }
    for (const key of seenThisKill) attackerCounts.set(key, (attackerCounts.get(key) ?? 0) + 1);
  }
  const recurring = [...attackerCounts.values()].filter((count) => count >= 2);
  const recurringAttackers = recurring.length;
  const repeatedAttackerAppearances = recurring.reduce((sum, count) => sum + (count - 1), 0);
  const podLosses2h = gate2h.filter((killmail) => Number(killmail.victim?.ship_type_id ?? 0) === 670).length;
  const shipLosses2h = Math.max(0, gate2h.length - podLosses2h);
  const reasons: string[] = [];
  let state: GateDangerState = "clear";
  let label: GateDangerAssessment["label"] = "Clear";
  let score = 0;

  if (gate1h.length >= 3 || (gate1h.length >= 2 && recurringAttackers >= 1)) {
    state = "active-camp"; label = "Active camp"; score = 10;
  } else if (gate2h.length >= 3 || gate1h.length >= 2 || (gate2h.length >= 2 && recurringAttackers >= 1)) {
    state = "camp-likely"; label = "Camp likely"; score = 8;
  } else if (gate2h.length >= 1 || gate6h.length >= 2) {
    state = "dangerous"; label = "Dangerous"; score = 5;
  } else if (gate6h.length >= 1 || system1h.length >= 1) {
    state = "activity"; label = "Activity"; score = 2;
  }

  if (gate1h.length) reasons.push(`${gate1h.length} kill${gate1h.length === 1 ? "" : "s"} classified at this gate in the last hour.`);
  else if (gate2h.length) reasons.push(`${gate2h.length} kill${gate2h.length === 1 ? "" : "s"} classified at this gate in the last 2 hours.`);
  else if (gate6h.length) reasons.push(`${gate6h.length} kill${gate6h.length === 1 ? "" : "s"} classified at this gate in the last 6 hours.`);
  if (recurringAttackers) reasons.push(`${recurringAttackers} attacker identity${recurringAttackers === 1 ? " appears" : " identities appear"} on multiple gate kills.`);
  if (podLosses2h) reasons.push(`${podLosses2h} pod loss${podLosses2h === 1 ? "" : "es"} classified at this gate in the last 2 hours.`);
  if (!gate6h.length && system1h.length) reasons.push(`${system1h.length} system-wide kill${system1h.length === 1 ? "" : "s"} in the last hour, but none classified at this gate.`);
  if (!reasons.length) reasons.push("No recent kill evidence is classified at this gate in the retained cache.");

  return {
    state,
    label,
    score,
    reasons,
    metrics: {
      gateKills1h: gate1h.length,
      gateKills2h: gate2h.length,
      gateKills6h: gate6h.length,
      gateKills24h: gate24h.length,
      systemKills1h: system1h.length,
      shipLosses2h,
      podLosses2h,
      recurringAttackers,
      repeatedAttackerAppearances,
      uniqueAttackers2h: attackerCounts.size,
      jumps: Number(activity.jumps ?? 0),
    },
  };
}

export async function getNavigationRouteIntelligence(
  input: { systemIds: number[]; legs?: NavigationRouteEdge[] },
  snapshots: any[],
): Promise<NavigationRouteIntelligence> {
  const systemIds = [...new Set((Array.isArray(input?.systemIds) ? input.systemIds : []).map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))];
  const legs = Array.isArray(input?.legs) ? input.legs : [];
  const [refreshed, sovereignty, hazards, staticMetadata] = await Promise.all([
    refreshSystemIntelligence(systemIds, snapshots, {
      caller: "route",
      discoverStructures: false,
      deepKillmailBackfill: false,
    }),
    getSovereigntySystemsMap(),
    getNavigationHazardSnapshot(false),
    getNavigationStaticMetadata(),
  ]);
  const now = Date.now();
  const rows: NavigationRouteSystemIntelligence[] = [];
  const incursion = new Set(hazards.providers.find((provider) => provider.id === "incursion" && provider.available)?.systemIds ?? []);
  const trig = hazards.providers.find((provider) => provider.id === "triglavian");
  const edencom = hazards.providers.find((provider) => provider.id === "edencom");

  for (const system of refreshed.systems) {
    const systemId = system.system.systemId;
    const gates = await getNavigationStargates(systemId);
    const classifications = system.killmails
      .map((killmail) => classifyKillmailNearGate(killmail, gates))
      .filter((item): item is GateKillClassification => Boolean(item));
    const outgoing = legs.find((leg) => leg.type === "gate" && leg.from === systemId && Number(leg.gateId ?? 0) > 0);
    const routeGateId = Number(outgoing?.gateId ?? 0);
    const routeGate = routeGateId > 0 ? gates.find((gate) => gate.gateId === routeGateId) : undefined;
    const gateClassified = routeGate ? classifications.filter((item) => item.gateId === routeGate.gateId) : [];
    const killWindows = buildKillWindows(system.killmails, classifications, now);
    const sov = sovereignty.get(systemId);
    const activity = {
      shipKills: Number(system.current.shipKills ?? 0),
      podKills: Number(system.current.podKills ?? 0),
      npcKills: Number(system.current.npcKills ?? 0),
      jumps: Number(system.current.jumps ?? 0),
    };
    rows.push({
      system,
      activity,
      killWindows,
      gateClassifications: classifications,
      routeGate: routeGate ? {
        gateId: routeGate.gateId,
        destinationSystemId: routeGate.destinationSystemId,
        destinationSystemName: routeGate.destinationSystemName,
        windows: {
          "1h": { kills: windowStats(system.killmails, classifications, 60 * 60 * 1000, now, routeGate.gateId).gateKills },
          "2h": { kills: windowStats(system.killmails, classifications, 2 * 60 * 60 * 1000, now, routeGate.gateId).gateKills },
          "6h": { kills: windowStats(system.killmails, classifications, 6 * 60 * 60 * 1000, now, routeGate.gateId).gateKills },
          "24h": { kills: windowStats(system.killmails, classifications, 24 * 60 * 60 * 1000, now, routeGate.gateId).gateKills },
        },
        classifiedKills: gateClassified,
        danger: deriveGateDanger(system.killmails, classifications, routeGate.gateId, activity, now),
      } : null,
      ownership: {
        allianceId: Number(sov?.claim?.alliance?.alliance_id ?? 0) || null,
        corporationId: Number(sov?.claim?.alliance?.corporation_id ?? 0) || null,
        factionId: Number(sov?.claim?.faction?.faction_id ?? 0) || null,
        source: sov ? "ESI sovereignty" : "unavailable",
      },
      hazards: {
        incursion: incursion.has(systemId),
        triglavian: trig?.available ? trig.systemIds.includes(systemId) : null,
        edencom: edencom?.available ? edencom.systemIds.includes(systemId) : null,
      },
      infrastructure: {
        npcStations: staticMetadata.npcStationCountBySystem.get(systemId) ?? 0,
        knownStructures: system.knownStructures.length,
        structures: system.knownStructures,
      },
    });
  }

  return {
    generatedAt: new Date(now).toISOString(),
    activityFetchedAt: refreshed.activityFetchedAt,
    systems: rows,
    killmailRefresh: refreshed.killmailRefresh,
    sources: {
      activity: "ESI system activity",
      kills: "shared zKillboard/ESI killmail cache",
      gateGeometry: "CCP SDE",
      ownership: sovereignty.size ? "ESI sovereignty" : "unavailable",
      hazards: "Navigation hazard providers",
      infrastructure: "CCP SDE + shared System Intelligence evidence",
    },
  };
}
