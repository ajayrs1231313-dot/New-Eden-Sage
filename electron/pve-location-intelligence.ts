import { promises as fs } from "node:fs";
import path from "node:path";
import { DATA_ROOT } from "./data-paths";
import { analyzeCapabilities, type CapabilityAnalysis, type CapabilityResult } from "./capability-engine";
import { getPveStaticIndex, type PveSystemStatic } from "./pve-static-index";
import { universeRoute } from "./universe-route-graph";
import type { CloneState } from "./skill-training";

export type PveLocationKind = "incursion" | "mission-staging" | "ded-search" | "lowsec-ratting" | "nullsec-ratting";
export type PveAvailability = "live" | "search-area" | "static-candidate";
export type PveConfidence = "low" | "medium" | "high";
export type PveRisk = "Low" | "Medium" | "High";

export type LivePveData = {
  fetchedAt: string;
  incursions: Array<{
    constellation_id: number;
    faction_id: number;
    has_boss: boolean;
    influence: number;
    infested_solar_systems: number[];
    staging_solar_system_id: number;
    state: string;
    type: string;
  }>;
  kills: Array<{ system_id: number; npc_kills: number; pod_kills: number; ship_kills: number }>;
  jumps: Array<{ system_id: number; ship_jumps: number }>;
  errors?: string[];
  stale?: boolean;
};

export type PveLocationQuery = {
  characterId: string;
  maxJumps?: number | null;
  maxMinutes?: number | null;
  limitPerKind?: number;
  forceLive?: boolean;
};

export type PveLocationOpportunity = {
  id: string;
  kind: PveLocationKind;
  label: string;
  systemId: number;
  systemName: string;
  regionId: number;
  regionName: string;
  constellationId: number;
  constellationName: string;
  securityStatus: number;
  securityBand: "high" | "low" | "null";
  jumps: number;
  estimatedMinutes: number;
  availability: PveAvailability;
  score: number;
  risk: PveRisk;
  confidence: PveConfidence;
  confidenceScore: number;
  earnings?: { lowPerHour: number; highPerHour: number; basis: string };
  readiness: null | { capabilityId: string; label: string; percent: number; tier: string; bestRoute: string };
  standing: null | { entityType: "npc_corp" | "faction"; entityId: number; name: string; value: number };
  corporationName?: string;
  factionName?: string | null;
  stationCount?: number;
  npcKills: number;
  shipKills: number;
  podKills: number;
  shipJumps: number;
  incursion?: { state: string; influence: number; hasBoss: boolean; type: string };
  reasons: string[];
  action: string;
  caveat: string;
};

export type PvePersonalOpportunity = {
  id: string;
  kind: "pve";
  title: string;
  subtitle: string;
  category: string;
  score: number;
  risk: PveRisk;
  jumps: number;
  estimatedMinutes: number;
  fillScore: number;
  capitalRequired: number;
  profit: null;
  marginPercent: null;
  cashRelease: null;
  primaryValue: number;
  primaryLabel: string;
  primaryText: string;
  confidenceLabel: string;
  reasons: string[];
  action: string;
};

export type PveLocationAnalysis = {
  generatedAt: string;
  character: { characterId: string; name: string; systemId: number; systemName: string; shipName: string | null };
  constraints: { maxJumps: number | null; maxMinutes: number | null };
  locations: PveLocationOpportunity[];
  ranked: PvePersonalOpportunity[];
  counts: Record<PveLocationKind, number>;
  dataStatus: {
    source: string;
    fetchedAt: string;
    ageMinutes: number;
    stale: boolean;
    errors: string[];
  };
  notes: string[];
};

export type PveAnalysisRuntime = {
  snapshot: any;
  cloneState?: CloneState;
  liveData?: LivePveData;
  capabilities?: CapabilityAnalysis;
  progress?: (progress: { stage: string; message: string; completed?: number; total?: number; percent?: number }) => void;
};

const CACHE_DIR = path.join(DATA_ROOT, "PvE Intel");
const CACHE_FILE = path.join(CACHE_DIR, "live-public-intel.json");
let memoryLive: LivePveData | null = null;
const LIVE_TTL_MS = 5 * 60_000;
const FALLBACK_MAX_AGE_MS = 24 * 60 * 60_000;

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function estimatedMinutes(jumps: number) {
  return Math.max(8, Math.round(8 + Math.max(0, jumps) * 2));
}

function freshnessMinutes(iso: string) {
  const time = Date.parse(iso);
  return Number.isFinite(time) ? Math.max(0, Math.round((Date.now() - time) / 60_000)) : 999999;
}

function safetyScore(metrics: { shipKills: number; podKills: number }) {
  return clamp(100 - Math.min(70, metrics.shipKills * 8) - Math.min(45, metrics.podKills * 14));
}

function quietScore(shipJumps: number) {
  if (shipJumps <= 0) return 94;
  return clamp(100 - Math.log10(shipJumps + 1) * 24);
}

function npcActivityScore(npcKills: number) {
  if (npcKills <= 0) return 8;
  return clamp(Math.log10(npcKills + 1) * 30);
}

function routeScore(jumps: number) {
  return clamp(100 - jumps * 3.5);
}

function confidenceScore(value: PveConfidence) {
  return value === "high" ? 92 : value === "medium" ? 70 : 48;
}

function riskFor(system: PveSystemStatic, metrics: { shipKills: number; podKills: number }, routeMinimumSecurity: number): PveRisk {
  if (system.securityBand === "null" || routeMinimumSecurity <= 0 || metrics.podKills >= 2 || metrics.shipKills >= 8) return "High";
  if (system.securityBand === "low" || routeMinimumSecurity < 0.45 || metrics.podKills > 0 || metrics.shipKills >= 3) return "Medium";
  return "Low";
}

async function readLiveCache() {
  try {
    const parsed = JSON.parse(await fs.readFile(CACHE_FILE, "utf8")) as LivePveData;
    return parsed?.fetchedAt ? parsed : null;
  } catch {
    return null;
  }
}

async function writeLiveCache(data: LivePveData) {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  const partial = `${CACHE_FILE}.${process.pid}.partial`;
  await fs.writeFile(partial, JSON.stringify(data), "utf8");
  await fs.rename(partial, CACHE_FILE).catch(async () => {
    await fs.copyFile(partial, CACHE_FILE);
    await fs.rm(partial, { force: true });
  });
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      "X-Compatibility-Date": "2026-08-02",
      "X-User-Agent": "NewEdenSage/0.1.4",
    },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`${new URL(url).pathname} returned ${response.status}`);
  return response.json() as Promise<T>;
}

async function loadLivePveData(force = false): Promise<LivePveData> {
  if (!force && memoryLive && Date.now() - Date.parse(memoryLive.fetchedAt) <= LIVE_TTL_MS) return memoryLive;
  const disk = await readLiveCache();
  if (!force && disk && Date.now() - Date.parse(disk.fetchedAt) <= LIVE_TTL_MS) {
    memoryLive = disk;
    return disk;
  }

  const [incursionsResult, killsResult, jumpsResult] = await Promise.allSettled([
    fetchJson<LivePveData["incursions"]>("https://esi.evetech.net/incursions/"),
    fetchJson<LivePveData["kills"]>("https://esi.evetech.net/universe/system_kills/"),
    fetchJson<LivePveData["jumps"]>("https://esi.evetech.net/universe/system_jumps/"),
  ]);
  const errors: string[] = [];
  const fallbackUsable = disk && Date.now() - Date.parse(disk.fetchedAt) <= FALLBACK_MAX_AGE_MS;
  const pick = <T>(result: PromiseSettledResult<T>, fallback: T, label: string) => {
    if (result.status === "fulfilled") return result.value;
    errors.push(`${label}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
    return fallback;
  };
  const data: LivePveData = {
    fetchedAt: new Date().toISOString(),
    incursions: pick(incursionsResult, fallbackUsable ? disk!.incursions : [], "Incursions"),
    kills: pick(killsResult, fallbackUsable ? disk!.kills : [], "System kills"),
    jumps: pick(jumpsResult, fallbackUsable ? disk!.jumps : [], "System traffic"),
    errors,
    stale: errors.length > 0,
  };
  memoryLive = data;
  if (!errors.length || data.incursions.length || data.kills.length || data.jumps.length) await writeLiveCache(data).catch(() => undefined);
  return data;
}

function directStanding(snapshot: any, corporationId: number, corporationName: string, factionId: number | null, factionName: string | null) {
  const standings = Array.isArray(snapshot?.extended?.standings) ? snapshot.extended.standings : [];
  const corp = standings.find((row: any) => row.from_type === "npc_corp" && Number(row.from_id) === corporationId);
  const faction = factionId == null ? null : standings.find((row: any) => row.from_type === "faction" && Number(row.from_id) === factionId);
  if (corp) return { entityType: "npc_corp" as const, entityId: corporationId, name: corporationName, value: Number(corp.standing ?? 0) };
  if (faction) return { entityType: "faction" as const, entityId: factionId!, name: factionName ?? `Faction ${factionId}`, value: Number(faction.standing ?? 0) };
  return null;
}

function capability(capabilities: CapabilityAnalysis | null, id: string) {
  const value = capabilities?.capabilities.find((item) => item.id === id) ?? null;
  return value ? {
    capabilityId: value.id,
    label: value.label,
    percent: value.overallPercent,
    tier: value.tier,
    bestRoute: value.bestRoute,
  } : null;
}

function metricMaps(live: LivePveData) {
  const kills = new Map(live.kills.map((row) => [row.system_id, row]));
  const jumps = new Map(live.jumps.map((row) => [row.system_id, row.ship_jumps]));
  return { kills, jumps };
}

function metricsFor(systemId: number, maps: ReturnType<typeof metricMaps>) {
  const kills = maps.kills.get(systemId);
  return {
    npcKills: Number(kills?.npc_kills ?? 0),
    shipKills: Number(kills?.ship_kills ?? 0),
    podKills: Number(kills?.pod_kills ?? 0),
    shipJumps: Number(maps.jumps.get(systemId) ?? 0),
  };
}

function prelimSearchScore(system: PveSystemStatic, metrics: ReturnType<typeof metricsFor>, kind: "ded" | "ratting") {
  const safety = safetyScore(metrics);
  const quiet = quietScore(metrics.shipJumps);
  const activity = npcActivityScore(metrics.npcKills);
  if (kind === "ded") return safety * 0.42 + quiet * 0.38 + activity * 0.2 + (system.securityBand === "low" ? 4 : 0);
  return activity * 0.55 + safety * 0.3 + quiet * 0.15;
}

async function routeAndFilter(origin: number, system: PveSystemStatic, maxJumps: number | null, maxMinutes: number | null) {
  const route = await universeRoute(origin, system.systemId);
  if (route.jumps >= 999) return null;
  const minutes = estimatedMinutes(route.jumps);
  if (maxJumps != null && route.jumps > maxJumps) return null;
  if (maxMinutes != null && minutes > maxMinutes) return null;
  return { jumps: route.jumps, estimatedMinutes: minutes, minimumSecurityStatus: route.minimumSecurityStatus };
}

function toRanked(row: PveLocationOpportunity): PvePersonalOpportunity {
  const earnings = row.earnings ?? earningsFor(row);
  const kindLabel: Record<PveLocationKind, string> = {
    incursion: "Live incursion",
    "mission-staging": "Mission staging",
    "ded-search": "DED / combat search",
    "lowsec-ratting": "Low-sec ratting",
    "nullsec-ratting": "Null-sec ratting",
  };
  return {
    id: `pve:${row.id}`,
    kind: "pve",
    title: row.label,
    subtitle: `${row.systemName} · ${row.regionName}`,
    category: kindLabel[row.kind],
    score: row.score,
    risk: row.risk,
    jumps: row.jumps,
    estimatedMinutes: row.estimatedMinutes,
    fillScore: row.confidenceScore,
    capitalRequired: 0,
    profit: null,
    marginPercent: null,
    cashRelease: null,
    primaryValue: earnings.highPerHour,
    primaryLabel: "Estimated gross ISK/hour",
    primaryText: `${Math.round(earnings.lowPerHour).toLocaleString("en-GB")}–${Math.round(earnings.highPerHour).toLocaleString("en-GB")} ISK/hr`,
    confidenceLabel: `${row.confidence} confidence · ${row.availability.replace("-", " ")}`,
    reasons: [...row.reasons, row.caveat],
    action: row.action,
  };
}

function earningsFor(row: Pick<PveLocationOpportunity, "kind" | "readiness">) {
  const hourlyRanges: Record<PveLocationKind, [number, number]> = {
    incursion: [70_000_000, 180_000_000],
    "mission-staging": [20_000_000, 45_000_000],
    "ded-search": [10_000_000, 70_000_000],
    "lowsec-ratting": [20_000_000, 60_000_000],
    "nullsec-ratting": [30_000_000, 100_000_000],
  };
  const [low, high] = hourlyRanges[row.kind];
  const readinessFactor = 0.55 + (row.readiness?.percent ?? 50) / 200;
  return {
    lowPerHour: Math.round(low * readinessFactor),
    highPerHour: Math.round(high * readinessFactor),
    basis: "Planning range based on activity type and your readiness; excludes loot variance, losses, fleet availability, taxes and travel time.",
  };
}

export async function analyzePveLocations(input: PveLocationQuery, runtime: PveAnalysisRuntime): Promise<PveLocationAnalysis> {
  const snapshot = runtime.snapshot;
  if (!snapshot?.location?.solar_system_id) throw new Error("Sync the selected character before analyzing PvE locations.");
  const origin = Number(snapshot.location.solar_system_id);
  const maxJumps = input.maxJumps == null ? null : Math.max(0, Number(input.maxJumps));
  const maxMinutes = input.maxMinutes == null ? null : Math.max(0, Number(input.maxMinutes));
  const limitPerKind = Math.max(5, Math.min(50, Number(input.limitPerKind ?? 20)));

  runtime.progress?.({ stage: "pve-live", message: "Loading current public PvE and system activity signals…", percent: 5 });
  const live = runtime.liveData ?? await loadLivePveData(Boolean(input.forceLive));
  const staticIndex = await getPveStaticIndex();
  const maps = metricMaps(live);

  runtime.progress?.({ stage: "pve-readiness", message: "Matching your current ship and skill capability…", percent: 15 });
  let capabilities = runtime.capabilities ?? null;
  if (!capabilities) {
    try {
      capabilities = await analyzeCapabilities(snapshot, runtime.cloneState ?? "omega");
    } catch {
      capabilities = null;
    }
  }
  const readiness = {
    incursion: capability(capabilities, "incursions"),
    mission: capability(capabilities, "missions"),
    ded: capability(capabilities, "combat-exploration") ?? capability(capabilities, "exploration"),
    ratting: capability(capabilities, "ratting") ?? capability(capabilities, "missions"),
  };
  const readinessScore = (value: ReturnType<typeof capability>) => value?.percent ?? 50;
  const rows: PveLocationOpportunity[] = [];

  runtime.progress?.({ stage: "pve-incursions", message: "Ranking live incursions…", percent: 25 });
  for (const incursion of live.incursions) {
    const system = staticIndex.systems.get(incursion.staging_solar_system_id);
    if (!system) continue;
    const route = await routeAndFilter(origin, system, maxJumps, maxMinutes);
    if (!route) continue;
    const metrics = metricsFor(system.systemId, maps);
    const safety = safetyScore(metrics);
    const score = clamp(readinessScore(readiness.incursion) * 0.35 + routeScore(route.jumps) * 0.25 + safety * 0.2 + (1 - Math.min(1, incursion.influence)) * 12 + (incursion.has_boss ? 8 : 4));
    const confidence: PveConfidence = live.stale ? "medium" : "high";
    rows.push({
      id: `incursion:${incursion.constellation_id}`,
      kind: "incursion",
      label: `${incursion.type || "Sansha"} incursion · ${incursion.state}`,
      ...system,
      jumps: route.jumps,
      estimatedMinutes: route.estimatedMinutes,
      availability: "live",
      score,
      risk: riskFor(system, metrics, route.minimumSecurityStatus),
      confidence,
      confidenceScore: confidenceScore(confidence),
      readiness: readiness.incursion,
      standing: null,
      ...metrics,
      incursion: { state: incursion.state, influence: incursion.influence, hasBoss: incursion.has_boss, type: incursion.type },
      reasons: [
        `CCP public data currently lists this incursion with ${Math.round(incursion.influence * 100)}% influence.`,
        `${route.jumps} jumps from ${snapshot.location.solar_system_name}; ${metrics.shipKills} ship and ${metrics.podKills} pod kills are in the current public system-kill window.`,
        readiness.incursion ? `${readiness.incursion.percent}% personal Incursion capability · ${readiness.incursion.bestRoute}.` : "Personal Incursion readiness could not be resolved on this pass.",
      ],
      action: `Travel to ${system.name} as the staging system after confirming the fleet community and doctrine you intend to join.`,
      caveat: "Incursion presence is live public data; fleet availability, doctrine acceptance and payout rate depend on the fleet you join.",
    });
  }

  runtime.progress?.({ stage: "pve-missions", message: "Ranking mission staging candidates against standings and travel…", percent: 40 });
  const missionRows: PveLocationOpportunity[] = [];
  for (const candidate of staticIndex.missionStaging) {
    const system = staticIndex.systems.get(candidate.systemId);
    if (!system) continue;
    const route = await routeAndFilter(origin, system, maxJumps, maxMinutes);
    if (!route) continue;
    const metrics = metricsFor(system.systemId, maps);
    const standing = directStanding(snapshot, candidate.corporationId, candidate.corporationName, candidate.factionId, candidate.factionName);
    const standingScore = standing ? clamp(50 + standing.value * 8) : 45;
    const score = clamp(readinessScore(readiness.mission) * 0.25 + routeScore(route.jumps) * 0.3 + safetyScore(metrics) * 0.15 + standingScore * 0.2 + Math.min(100, candidate.stationCount * 25) * 0.1);
    const confidence: PveConfidence = standing ? "medium" : "low";
    missionRows.push({
      id: `mission:${candidate.systemId}:${candidate.corporationId}`,
      kind: "mission-staging",
      label: `${candidate.corporationName} mission staging candidate`,
      ...system,
      jumps: route.jumps,
      estimatedMinutes: route.estimatedMinutes,
      availability: "static-candidate",
      score,
      risk: riskFor(system, metrics, route.minimumSecurityStatus),
      confidence,
      confidenceScore: confidenceScore(confidence),
      readiness: readiness.mission,
      standing,
      corporationName: candidate.corporationName,
      factionName: candidate.factionName,
      stationCount: candidate.stationCount,
      ...metrics,
      reasons: [
        `CCP static data shows ${candidate.stationCount} ${candidate.corporationName} station${candidate.stationCount === 1 ? "" : "s"} in this high-sec system and classifies the corporation's main activity as military.`,
        standing ? `Your synced ${standing.entityType === "npc_corp" ? "corporation" : "faction"} standing is ${standing.value.toFixed(2)} with ${standing.name}.` : "No direct synced standing with this corporation/faction was found.",
        `${route.jumps} jumps from ${snapshot.location.solar_system_name}.`,
      ],
      action: `Check ${candidate.corporationName} Security agents in ${system.name} before relocating, then compare LP-store value and mission routing.`,
      caveat: "Public CCP data does not provide an enumerable current list of normal mission agents by level/division. This is a staging candidate, not a claim that a Level 4 Security agent is present.",
    });
  }
  rows.push(...missionRows.sort((a, b) => b.score - a.score).slice(0, limitPerKind));

  runtime.progress?.({ stage: "pve-search", message: "Scoring combat-exploration and DED search areas…", percent: 55 });
  const dedCandidates = [...staticIndex.systems.values()]
    .filter((system) => system.securityBand !== "null")
    .map((system) => ({ system, metrics: metricsFor(system.systemId, maps) }))
    .sort((a, b) => prelimSearchScore(b.system, b.metrics, "ded") - prelimSearchScore(a.system, a.metrics, "ded"))
    .slice(0, 240);
  const dedRows: PveLocationOpportunity[] = [];
  for (const { system, metrics } of dedCandidates) {
    const route = await routeAndFilter(origin, system, maxJumps, maxMinutes);
    if (!route) continue;
    const safety = safetyScore(metrics);
    const quiet = quietScore(metrics.shipJumps);
    const activity = npcActivityScore(metrics.npcKills);
    const score = clamp(readinessScore(readiness.ded) * 0.25 + routeScore(route.jumps) * 0.2 + safety * 0.22 + quiet * 0.2 + activity * 0.13);
    const confidence: PveConfidence = live.stale ? "low" : "medium";
    dedRows.push({
      id: `ded:${system.systemId}`,
      kind: "ded-search",
      label: "Combat exploration / DED search area",
      ...system,
      jumps: route.jumps,
      estimatedMinutes: route.estimatedMinutes,
      availability: "search-area",
      score,
      risk: riskFor(system, metrics, route.minimumSecurityStatus),
      confidence,
      confidenceScore: confidenceScore(confidence),
      readiness: readiness.ded,
      standing: null,
      ...metrics,
      reasons: [
        `${metrics.shipJumps.toLocaleString("en-GB")} ship jumps, ${metrics.npcKills.toLocaleString("en-GB")} NPC kills and ${metrics.shipKills} player ship kills are in the current public system activity data.`,
        `${system.securityBand === "low" ? "Low-sec offers higher travel risk but can broaden combat-exploration options." : "High-sec lowers travel risk but can be more competitive."}`,
        readiness.ded ? `${readiness.ded.percent}% personal combat-exploration capability · ${readiness.ded.bestRoute}.` : "Personal combat-exploration readiness could not be resolved on this pass.",
      ],
      action: `Use ${system.name} and its surrounding constellation as a scanning/search area; check signatures and local conditions when you arrive.`,
      caveat: "No public API exposes currently spawned DED sites or escalations. Sage is ranking where to search, not claiming an active site exists here.",
    });
  }
  rows.push(...dedRows.sort((a, b) => b.score - a.score).slice(0, limitPerKind));

  for (const band of ["low", "null"] as const) {
    runtime.progress?.({ stage: `pve-${band}-ratting`, message: `Ranking ${band === "low" ? "low-sec" : "null-sec"} ratting areas…`, percent: band === "low" ? 70 : 82 });
    const candidates = [...staticIndex.systems.values()]
      .filter((system) => system.securityBand === band)
      .map((system) => ({ system, metrics: metricsFor(system.systemId, maps) }))
      .filter(({ metrics }) => metrics.npcKills > 0)
      .sort((a, b) => prelimSearchScore(b.system, b.metrics, "ratting") - prelimSearchScore(a.system, a.metrics, "ratting"))
      .slice(0, 220);
    const ratRows: PveLocationOpportunity[] = [];
    for (const { system, metrics } of candidates) {
      const route = await routeAndFilter(origin, system, maxJumps, maxMinutes);
      if (!route) continue;
      const safety = safetyScore(metrics);
      const activity = npcActivityScore(metrics.npcKills);
      const quiet = quietScore(metrics.shipJumps);
      const score = clamp(readinessScore(readiness.ratting) * 0.25 + routeScore(route.jumps) * 0.15 + safety * 0.2 + quiet * 0.1 + activity * 0.3);
      const confidence: PveConfidence = live.stale ? "low" : "medium";
      ratRows.push({
        id: `${band}rat:${system.systemId}`,
        kind: band === "low" ? "lowsec-ratting" : "nullsec-ratting",
        label: `${band === "low" ? "Low-sec" : "Null-sec"} ratting area`,
        ...system,
        jumps: route.jumps,
        estimatedMinutes: route.estimatedMinutes,
        availability: "search-area",
        score,
        risk: band === "null" ? "High" : riskFor(system, metrics, route.minimumSecurityStatus),
        confidence,
        confidenceScore: confidenceScore(confidence),
        readiness: readiness.ratting,
        standing: null,
        ...metrics,
        reasons: [
          `${metrics.npcKills.toLocaleString("en-GB")} NPC kills indicate recent PvE activity; ${metrics.shipKills} ship and ${metrics.podKills} pod kills provide the current public danger signal.`,
          `${metrics.shipJumps.toLocaleString("en-GB")} ship jumps provide a traffic/competition signal.`,
          readiness.ratting ? `${readiness.ratting.percent}% personal ratting capability · ${readiness.ratting.bestRoute}.` : "Personal ratting readiness could not be resolved on this pass.",
        ],
        action: band === "null"
          ? `Treat ${system.name} as an activity lead only; confirm sovereignty/access, local intel and a safe route before considering ratting there.`
          : `Check local/d-scan and nearby systems around ${system.name} before committing a PvE ship.`,
        caveat: band === "null"
          ? "Public activity data cannot tell Sage whether you have sovereignty, docking, tether or friendly intel access here. Null-sec suggestions are leads, not safe-space recommendations."
          : "Public activity data does not expose which anomalies are currently spawned. This ranks recent activity and danger, not guaranteed site availability.",
      });
    }
    rows.push(...ratRows.sort((a, b) => b.score - a.score).slice(0, limitPerKind));
  }

  rows.sort((a, b) => b.score - a.score || a.jumps - b.jumps);
  const enrichedRows = rows.map((row) => ({ ...row, earnings: earningsFor(row) }));
  const ranked = enrichedRows.map(toRanked).sort((a, b) => b.score - a.score).slice(0, 80);
  const counts: Record<PveLocationKind, number> = {
    incursion: enrichedRows.filter((row) => row.kind === "incursion").length,
    "mission-staging": enrichedRows.filter((row) => row.kind === "mission-staging").length,
    "ded-search": enrichedRows.filter((row) => row.kind === "ded-search").length,
    "lowsec-ratting": enrichedRows.filter((row) => row.kind === "lowsec-ratting").length,
    "nullsec-ratting": enrichedRows.filter((row) => row.kind === "nullsec-ratting").length,
  };
  const ageMinutes = freshnessMinutes(live.fetchedAt);
  runtime.progress?.({ stage: "pve-complete", message: `${rows.length} PvE/location leads satisfy the current travel limits.`, percent: 100 });
  return {
    generatedAt: new Date().toISOString(),
    character: {
      characterId: String(snapshot.characterId),
      name: String(snapshot.character?.name ?? "Character"),
      systemId: origin,
      systemName: String(snapshot.location.solar_system_name ?? `System ${origin}`),
      shipName: snapshot.ship?.ship_type_name ?? snapshot.ship?.ship_name ?? null,
    },
    constraints: { maxJumps, maxMinutes },
    locations: enrichedRows,
    ranked,
    counts,
    dataStatus: {
      source: "CCP ESI public activity + CCP static data",
      fetchedAt: live.fetchedAt,
      ageMinutes,
      stale: Boolean(live.stale) || ageMinutes > 15,
      errors: live.errors ?? [],
    },
    notes: [
      "Live incursions are current public availability signals.",
      "DED/combat and ratting results are search/activity areas because public ESI does not expose current anomaly or DED spawns.",
      "Mission results are NPC military-corporation staging candidates; verify the exact Security agent level before moving.",
    ],
  };
}
