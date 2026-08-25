import AdmZip from "adm-zip";
import { promises as fs } from "node:fs";
import path from "node:path";
import { STATIC_DATA_ROOT, USER_DATA_ROOT } from "./data-paths";
import { getMarketTypeIndex } from "./market-static-index";
import { ensureStaticDataArchive } from "./type-volumes";
import { displayedSecurityStatus, getNavigationMapData, type NavigationRouteEdge, type NavigationSystemNode } from "./universe-route-graph";
import { refreshSystemIntelligence } from "./system-intelligence";

const SDE_ARCHIVE = path.join(STATIC_DATA_ROOT, "eve-static-data-jsonl.zip");
const KILLMAIL_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const ACTIVITY_CACHE_MS = 2 * 60 * 1000;

// High-sec ice anomaly systems. Source: EVE University Clear Icicle, White Glaze,
// Blue Ice and Glacial Mass belt pages; list reviewed 2026-08-23. The SDE remains
// authoritative for whether a named system currently exists and its security.
const HIGH_SEC_ICE_SYSTEM_NAMES = new Set([
  // Clear Icicle / Amarr quarter
  "Avada","Gamis","Gelhan","Ihal","Moh","Orva","Serad","Arveyil","Dihra","Esescama","Riavayed",
  "Afivad","Arera","Arshat","Azizora","Bashakru","Clarelam","Esteban","Fabum","Gosalav","Isamm","Jerma","Knophtikoo","Luromooh","Martha","Nalu","Pedel","Raren","Warouh",
  "Agal","Avyuh","Hadji","Iderion","Manatirid","Sigga","Ervekam","Geztic","Gidali","Keberz","Molea","Moniyyuku","Moro","Saloti","Talidal",
  "Chanoun","Dantan","Jakri","Kamda","Koona","Kothe","Miah","Munory","Neburab","Rayeret","Turba","Choga","Ordion",
  "Anjedin","Goram","Ivih","Jarzalad","Kari","Moutid","Seil","Erkinen",
  // White Glaze / Caldari quarter
  "Uchomida","Halaima","Kamio","Uotila","Ahtulaima","Gekutami","Hentogaira","Hurtoken","Mitsolen","Osmon","Outuni","Silen","Sirseshin","Vattuolen","Wuos",
  "Aakari","Elonaya","Jotenen","Kiskoken","Oishami","Piekura","Yoma",
  // Blue Ice / Gallente quarter
  "Actee","Deninard","Antollare","Ardallabier","Aydoteaux","Carirgnottin","Jaschercis","Tolle","Vaurent","Brapelille","Chelien","Misneden","Stegette","Niballe",
  // Glacial Mass / Minmatar quarter
  "Abudban","Emolgranlan","Endrulf","Aderkan","Asgeir","Barkrik","Dantbeinn","Eygfe","Finanar","Gedugaud","Hodrold","Nakugard","Nein","Oppold","Teonusude","Varigne",
]);

const ESI_HEADERS = {
  "X-Compatibility-Date": "2026-08-02",
  "X-User-Agent": "NewEdenSage/1.1.12",
};

export type CorporationHomeFinderInput = {
  originSystemId?: number | null;
  minSecurity?: number;
  maxSecurity?: number;
  minMoons?: number;
  minStations?: number;
  maxIceJumps?: number;
  maxRelocationJumps?: number;
  highSecRouteOnly?: boolean;
  limit?: number;
};

export type CorporationHomeRisk = {
  coverage: "complete" | "partial" | "none";
  cachedKills30d: number;
  miningLosses30d: number;
  topMiningGankCorporationId: number | null;
  topMiningGankKillmails: number;
  topMiningGankShare: number;
  repeatedMiningGankPattern: boolean;
};

export type CorporationHomeCandidate = {
  score: number;
  confidence: "high" | "partial" | "structural";
  risk: "low" | "moderate" | "high" | "unknown";
  system: {
    systemId: number;
    name: string;
    regionName: string;
    constellationName: string;
    securityStatus: number;
    displayedSecurityStatus: number;
    stationCount: number;
    moonCount: number;
  };
  ice: {
    systemId: number;
    name: string;
    jumps: number;
    securityStatus: number;
    displayedSecurityStatus: number;
    stationCount: number;
    moonCount: number;
  };
  pairMoonCount: number;
  relocation: { jumps: number | null; highSecOnly: boolean; routeFound: boolean };
  current: {
    home: ActivityRow;
    ice: ActivityRow;
  };
  intel: {
    home: CorporationHomeRisk;
    ice: CorporationHomeRisk;
  };
  reasons: string[];
};

type ActivityRow = { shipKills: number; podKills: number; npcKills: number; jumps: number };
type SdeCounts = { stationCounts: Map<number, number>; moonCounts: Map<number, number> };
type KillmailIntel = { killmailId?: number; killmailTime?: string; victim?: any; attackers?: any[] };
type KillmailState = { systems?: Record<string, { backfillCompletedAt?: string; backfillSchemaVersion?: number; killmails?: KillmailIntel[] }> };

type SharedActivity = {
  fetchedAt: number;
  bySystem: Map<number, ActivityRow>;
};

let sdeCountsPromise: Promise<SdeCounts> | null = null;
let activityCache: SharedActivity | null = null;
let miningHullTypeIdsPromise: Promise<Set<number>> | null = null;

function normalizeInput(input: CorporationHomeFinderInput = {}) {
  const minSecurity = Number.isFinite(Number(input.minSecurity)) ? Number(input.minSecurity) : 0.45;
  const maxSecurity = Number.isFinite(Number(input.maxSecurity)) ? Number(input.maxSecurity) : 0.55;
  return {
    originSystemId: Number(input.originSystemId ?? 0) || null,
    minSecurity: Math.max(-1, Math.min(1, Math.min(minSecurity, maxSecurity))),
    maxSecurity: Math.max(-1, Math.min(1, Math.max(minSecurity, maxSecurity))),
    minMoons: Math.max(0, Math.floor(Number(input.minMoons ?? 20))),
    minStations: Math.max(0, Math.floor(Number(input.minStations ?? 1))),
    maxIceJumps: Math.max(0, Math.min(5, Math.floor(Number(input.maxIceJumps ?? 1)))),
    maxRelocationJumps: Math.max(0, Math.min(200, Math.floor(Number(input.maxRelocationJumps ?? 50)))),
    highSecRouteOnly: input.highSecRouteOnly !== false,
    limit: Math.max(1, Math.min(100, Math.floor(Number(input.limit ?? 30)))),
  };
}

function lineObjects<T>(text: string): T[] {
  const rows: T[] = [];
  for (const line of text.split(/\r?\n/)) if (line) rows.push(JSON.parse(line) as T);
  return rows;
}

async function getSdeCounts(): Promise<SdeCounts> {
  if (sdeCountsPromise) return sdeCountsPromise;
  sdeCountsPromise = (async () => {
    await ensureStaticDataArchive();
    const zip = new AdmZip(SDE_ARCHIVE);
    const stationsEntry = zip.getEntry("npcStations.jsonl");
    const moonsEntry = zip.getEntry("mapMoons.jsonl");
    if (!stationsEntry || !moonsEntry) throw new Error("Official EVE static data is missing station or moon records.");
    const stationCounts = new Map<number, number>();
    for (const row of lineObjects<{ solarSystemID: number }>(stationsEntry.getData().toString("utf8"))) {
      const id = Number(row.solarSystemID);
      stationCounts.set(id, (stationCounts.get(id) ?? 0) + 1);
    }
    const moonCounts = new Map<number, number>();
    for (const row of lineObjects<{ solarSystemID: number }>(moonsEntry.getData().toString("utf8"))) {
      const id = Number(row.solarSystemID);
      moonCounts.set(id, (moonCounts.get(id) ?? 0) + 1);
    }
    return { stationCounts, moonCounts };
  })();
  return sdeCountsPromise;
}

function gateAdjacency(systems: NavigationSystemNode[], edges: NavigationRouteEdge[]) {
  const valid = new Set(systems.map((system) => system.systemId));
  const result = new Map<number, number[]>();
  for (const system of systems) result.set(system.systemId, []);
  for (const edge of edges) {
    if (edge.type !== "gate" || !valid.has(edge.from) || !valid.has(edge.to)) continue;
    result.get(edge.from)!.push(edge.to);
    result.get(edge.to)!.push(edge.from);
  }
  return result;
}

function distancesFrom(originSystemId: number, adjacency: Map<number, number[]>, nodes: Map<number, NavigationSystemNode>, highSecOnly: boolean) {
  const distance = new Map<number, number>();
  const origin = nodes.get(originSystemId);
  if (!origin) return distance;
  if (highSecOnly && displayedSecurityStatus(origin.securityStatus) < 0.5) return distance;
  distance.set(originSystemId, 0);
  const queue = [originSystemId];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor];
    const nextDistance = distance.get(current)! + 1;
    for (const next of adjacency.get(current) ?? []) {
      if (distance.has(next)) continue;
      const node = nodes.get(next);
      if (!node || (highSecOnly && displayedSecurityStatus(node.securityStatus) < 0.5)) continue;
      distance.set(next, nextDistance);
      queue.push(next);
    }
  }
  return distance;
}

function nearestIceSystem(
  startSystemId: number,
  maxJumps: number,
  adjacency: Map<number, number[]>,
  nodes: Map<number, NavigationSystemNode>,
  iceSystemIds: Set<number>,
) {
  if (iceSystemIds.has(startSystemId)) return { systemId: startSystemId, jumps: 0 };
  const visited = new Set([startSystemId]);
  let frontier = [startSystemId];
  for (let jump = 1; jump <= maxJumps; jump += 1) {
    const nextFrontier: number[] = [];
    const matches: number[] = [];
    for (const current of frontier) {
      for (const next of adjacency.get(current) ?? []) {
        if (visited.has(next)) continue;
        visited.add(next);
        const node = nodes.get(next);
        if (!node || displayedSecurityStatus(node.securityStatus) < 0.5) continue;
        if (iceSystemIds.has(next)) matches.push(next);
        nextFrontier.push(next);
      }
    }
    if (matches.length) {
      matches.sort((a, b) => Math.abs(nodes.get(a)!.securityStatus - 0.5) - Math.abs(nodes.get(b)!.securityStatus - 0.5) || nodes.get(a)!.name.localeCompare(nodes.get(b)!.name));
      return { systemId: matches[0], jumps: jump };
    }
    frontier = nextFrontier;
  }
  return null;
}

async function getMiningHullTypeIds() {
  if (miningHullTypeIdsPromise) return miningHullTypeIdsPromise;
  miningHullTypeIdsPromise = (async () => {
    const types = await getMarketTypeIndex();
    const ids = new Set<number>();
    const groups = new Set([463, 543, 941, 1283, 4902]);
    for (const item of types.values()) {
      if (groups.has(item.groupId) || /^(Venture|Pioneer)$/i.test(item.name)) ids.add(item.typeId);
    }
    return ids;
  })();
  return miningHullTypeIdsPromise;
}

async function readKillmailState(): Promise<KillmailState> {
  try {
    const target = path.join(USER_DATA_ROOT, "system-intelligence-killmails.json");
    return JSON.parse(await fs.readFile(target, "utf8")) as KillmailState;
  } catch {
    return {};
  }
}

export function summarizeHomeRisk(
  entry: { backfillCompletedAt?: string; backfillSchemaVersion?: number; killmails?: KillmailIntel[] } | undefined,
  miningHullTypeIds: Set<number>,
  now = Date.now(),
): CorporationHomeRisk {
  const cutoff = now - KILLMAIL_WINDOW_MS;
  const killmails = (entry?.killmails ?? []).filter((item) => {
    const when = item.killmailTime ? Date.parse(item.killmailTime) : Number.NaN;
    return Number.isFinite(when) && when >= cutoff;
  });
  const miningLosses = killmails.filter((item) => miningHullTypeIds.has(Number(item.victim?.ship_type_id ?? 0)));
  const attackerCorpKills = new Map<number, number>();
  for (const killmail of miningLosses) {
    const corporations = new Set<number>();
    for (const attacker of Array.isArray(killmail.attackers) ? killmail.attackers : []) {
      const corporationId = Number(attacker?.corporation_id ?? 0);
      if (corporationId > 0) corporations.add(corporationId);
    }
    for (const corporationId of corporations) attackerCorpKills.set(corporationId, (attackerCorpKills.get(corporationId) ?? 0) + 1);
  }
  const top = [...attackerCorpKills.entries()].sort((a, b) => b[1] - a[1])[0] ?? [0, 0];
  const topShare = miningLosses.length ? top[1] / miningLosses.length : 0;
  const complete = Boolean(entry?.backfillCompletedAt) && Number(entry?.backfillSchemaVersion ?? 0) >= 2;
  const coverage: CorporationHomeRisk["coverage"] = complete ? "complete" : killmails.length ? "partial" : "none";
  return {
    coverage,
    cachedKills30d: killmails.length,
    miningLosses30d: miningLosses.length,
    topMiningGankCorporationId: top[0] || null,
    topMiningGankKillmails: top[1],
    topMiningGankShare: topShare,
    repeatedMiningGankPattern: top[1] >= 5 || (top[1] >= 3 && topShare >= 0.4),
  };
}

async function getActivity(systemIds: number[]) {
  const wanted = new Set(systemIds);
  if (!activityCache || Date.now() - activityCache.fetchedAt > ACTIVITY_CACHE_MS) {
    const [killsResponse, jumpsResponse] = await Promise.all([
      fetch("https://esi.evetech.net/universe/system_kills/", { headers: ESI_HEADERS }),
      fetch("https://esi.evetech.net/universe/system_jumps/", { headers: ESI_HEADERS }),
    ]);
    if (!killsResponse.ok || !jumpsResponse.ok) throw new Error("EVE public activity feed is temporarily unavailable.");
    const kills = await killsResponse.json() as Array<{ system_id: number; ship_kills: number; pod_kills: number; npc_kills: number }>;
    const jumps = await jumpsResponse.json() as Array<{ system_id: number; ship_jumps: number }>;
    const bySystem = new Map<number, ActivityRow>();
    for (const row of kills) bySystem.set(Number(row.system_id), { shipKills: Number(row.ship_kills ?? 0), podKills: Number(row.pod_kills ?? 0), npcKills: Number(row.npc_kills ?? 0), jumps: 0 });
    for (const row of jumps) {
      const id = Number(row.system_id);
      const current = bySystem.get(id) ?? { shipKills: 0, podKills: 0, npcKills: 0, jumps: 0 };
      current.jumps = Number(row.ship_jumps ?? 0);
      bySystem.set(id, current);
    }
    activityCache = { fetchedAt: Date.now(), bySystem };
  }
  const result = new Map<number, ActivityRow>();
  for (const id of wanted) result.set(id, activityCache.bySystem.get(id) ?? { shipKills: 0, podKills: 0, npcKills: 0, jumps: 0 });
  return result;
}

function riskPenalty(home: CorporationHomeRisk, ice: CorporationHomeRisk, currentHome: ActivityRow, currentIce: ActivityRow) {
  const miningLosses = home.miningLosses30d + (ice === home ? 0 : ice.miningLosses30d);
  const kills = home.cachedKills30d + (ice === home ? 0 : ice.cachedKills30d);
  const currentKills = currentHome.shipKills + (currentIce === currentHome ? 0 : currentIce.shipKills);
  let penalty = Math.min(24, miningLosses * 3.5) + Math.min(12, kills * 0.22) + Math.min(12, currentKills * 4);
  if (home.repeatedMiningGankPattern) penalty += 14;
  if (ice.repeatedMiningGankPattern && ice !== home) penalty += 14;
  return Math.min(55, penalty);
}

function confidenceFor(home: CorporationHomeRisk, ice: CorporationHomeRisk) {
  if (home.coverage === "complete" && ice.coverage === "complete") return "high" as const;
  if (home.coverage !== "none" || ice.coverage !== "none") return "partial" as const;
  return "structural" as const;
}

function riskFor(home: CorporationHomeRisk, ice: CorporationHomeRisk, currentHome: ActivityRow, currentIce: ActivityRow): CorporationHomeCandidate["risk"] {
  const confidence = confidenceFor(home, ice);
  if (confidence === "structural") return "unknown";
  const miningLosses = home.miningLosses30d + (ice === home ? 0 : ice.miningLosses30d);
  const currentKills = currentHome.shipKills + (currentIce === currentHome ? 0 : currentIce.shipKills);
  if (home.repeatedMiningGankPattern || ice.repeatedMiningGankPattern || miningLosses >= 5 || currentKills >= 3) return "high";
  if (miningLosses > 0 || home.cachedKills30d + ice.cachedKills30d >= 20 || currentKills > 0) return "moderate";
  return "low";
}

export function scoreHomeCandidate(input: {
  securityStatus: number;
  stationCount: number;
  moonCount: number;
  pairMoonCount: number;
  iceJumps: number;
  relocationJumps: number | null;
  homeRisk: CorporationHomeRisk;
  iceRisk: CorporationHomeRisk;
  currentHome: ActivityRow;
  currentIce: ActivityRow;
}) {
  const secFit = Math.max(0, 1 - Math.abs(input.securityStatus - 0.5) / 0.12);
  let score = 34 + secFit * 14;
  score += Math.min(18, input.moonCount / 3.5);
  score += Math.min(8, Math.max(0, input.pairMoonCount - input.moonCount) / 8);
  score += Math.min(9, input.stationCount * 2.25);
  score += input.iceJumps === 0 ? 13 : Math.max(3, 11 - input.iceJumps * 3);
  if (input.relocationJumps != null) score += Math.max(0, 8 - input.relocationJumps * 0.14);
  const confidence = confidenceFor(input.homeRisk, input.iceRisk);
  if (confidence === "structural") score -= 9;
  else if (confidence === "partial") score -= 4;
  score -= riskPenalty(input.homeRisk, input.iceRisk, input.currentHome, input.currentIce);
  return Math.max(0, Math.min(100, Math.round(score)));
}

export async function findCorporationHomes(rawInput: CorporationHomeFinderInput = {}) {
  const input = normalizeInput(rawInput);
  const [{ systems, edges }, counts, killmailState, miningHullTypeIds] = await Promise.all([
    getNavigationMapData({ scope: "universe" }),
    getSdeCounts(),
    readKillmailState(),
    getMiningHullTypeIds(),
  ]);
  const nodes = new Map(systems.map((system) => [system.systemId, system]));
  const adjacency = gateAdjacency(systems, edges);
  const iceSystemIds = new Set(systems.filter((system) => HIGH_SEC_ICE_SYSTEM_NAMES.has(system.name) && displayedSecurityStatus(system.securityStatus) >= 0.5).map((system) => system.systemId));
  const routeDistances = input.originSystemId ? distancesFrom(input.originSystemId, adjacency, nodes, input.highSecRouteOnly) : new Map<number, number>();

  const structural: Array<{
    system: NavigationSystemNode;
    stationCount: number;
    moonCount: number;
    ice: { systemId: number; jumps: number };
    relocationJumps: number | null;
  }> = [];

  for (const system of systems) {
    if (displayedSecurityStatus(system.securityStatus) < 0.5) continue;
    if (system.securityStatus < input.minSecurity || system.securityStatus > input.maxSecurity) continue;
    const stationCount = counts.stationCounts.get(system.systemId) ?? 0;
    const moonCount = counts.moonCounts.get(system.systemId) ?? 0;
    if (stationCount < input.minStations || moonCount < input.minMoons) continue;
    const ice = nearestIceSystem(system.systemId, input.maxIceJumps, adjacency, nodes, iceSystemIds);
    if (!ice) continue;
    const relocationJumps = input.originSystemId ? routeDistances.get(system.systemId) ?? null : null;
    if (input.originSystemId && relocationJumps == null) continue;
    if (relocationJumps != null && relocationJumps > input.maxRelocationJumps) continue;
    structural.push({ system, stationCount, moonCount, ice, relocationJumps });
  }

  const activity = await getActivity([...new Set(structural.flatMap((row) => [row.system.systemId, row.ice.systemId]))]);
  const candidates: CorporationHomeCandidate[] = [];
  for (const row of structural) {
    const iceSystem = nodes.get(row.ice.systemId)!;
    const iceStationCount = counts.stationCounts.get(iceSystem.systemId) ?? 0;
    const iceMoonCount = counts.moonCounts.get(iceSystem.systemId) ?? 0;
    const homeRisk = summarizeHomeRisk(killmailState.systems?.[String(row.system.systemId)], miningHullTypeIds);
    const iceRisk = row.ice.systemId === row.system.systemId ? homeRisk : summarizeHomeRisk(killmailState.systems?.[String(row.ice.systemId)], miningHullTypeIds);
    const currentHome = activity.get(row.system.systemId) ?? { shipKills: 0, podKills: 0, npcKills: 0, jumps: 0 };
    const currentIce = row.ice.systemId === row.system.systemId ? currentHome : activity.get(row.ice.systemId) ?? { shipKills: 0, podKills: 0, npcKills: 0, jumps: 0 };
    const pairMoonCount = row.moonCount + (row.ice.systemId === row.system.systemId ? 0 : iceMoonCount);
    const confidence = confidenceFor(homeRisk, iceRisk);
    const risk = riskFor(homeRisk, iceRisk, currentHome, currentIce);
    const score = scoreHomeCandidate({
      securityStatus: row.system.securityStatus,
      stationCount: row.stationCount,
      moonCount: row.moonCount,
      pairMoonCount,
      iceJumps: row.ice.jumps,
      relocationJumps: row.relocationJumps,
      homeRisk,
      iceRisk,
      currentHome,
      currentIce,
    });
    const reasons = [
      `${row.stationCount} NPC station${row.stationCount === 1 ? "" : "s"}`,
      `${row.moonCount} home-system moons`,
      row.ice.jumps === 0 ? "Ice in system" : `Ice ${row.ice.jumps} gate${row.ice.jumps === 1 ? "" : "s"} away in ${iceSystem.name}`,
      pairMoonCount !== row.moonCount ? `${pairMoonCount} moons across the home/ice pair` : `${pairMoonCount} moons in the ice/home system`,
    ];
    if (row.relocationJumps != null) reasons.push(`${row.relocationJumps} ${input.highSecRouteOnly ? "high-sec " : ""}jumps from origin`);
    if (homeRisk.repeatedMiningGankPattern || iceRisk.repeatedMiningGankPattern) reasons.push("Repeated mining-gank corporation pattern detected");
    else if (confidence === "high" && homeRisk.miningLosses30d + iceRisk.miningLosses30d === 0) reasons.push("No mining-hull losses in complete cached 30-day intel");
    else if (confidence === "structural") reasons.push("30-day killmail history not cached yet — deep scan recommended");
    candidates.push({
      score,
      confidence,
      risk,
      system: {
        systemId: row.system.systemId,
        name: row.system.name,
        regionName: row.system.regionName,
        constellationName: row.system.constellationName,
        securityStatus: row.system.securityStatus,
        displayedSecurityStatus: displayedSecurityStatus(row.system.securityStatus),
        stationCount: row.stationCount,
        moonCount: row.moonCount,
      },
      ice: {
        systemId: iceSystem.systemId,
        name: iceSystem.name,
        jumps: row.ice.jumps,
        securityStatus: iceSystem.securityStatus,
        displayedSecurityStatus: displayedSecurityStatus(iceSystem.securityStatus),
        stationCount: iceStationCount,
        moonCount: iceMoonCount,
      },
      pairMoonCount,
      relocation: { jumps: row.relocationJumps, highSecOnly: input.highSecRouteOnly, routeFound: input.originSystemId ? row.relocationJumps != null : false },
      current: { home: currentHome, ice: currentIce },
      intel: { home: homeRisk, ice: iceRisk },
      reasons,
    });
  }

  const confidenceRank = { high: 2, partial: 1, structural: 0 } as const;
  candidates.sort((a, b) => b.score - a.score || confidenceRank[b.confidence] - confidenceRank[a.confidence] || b.pairMoonCount - a.pairMoonCount || a.system.name.localeCompare(b.system.name));
  return {
    generatedAt: new Date().toISOString(),
    filters: input,
    iceReference: { source: "EVE University high-sec ice belt system lists", reviewedAt: "2026-08-23", systemCount: iceSystemIds.size },
    candidateCount: candidates.length,
    candidates: candidates.slice(0, input.limit),
  };
}

export async function scanCorporationHomeCandidate(input: { systemIds?: number[] }, snapshots: any[]) {
  const systemIds = [...new Set((Array.isArray(input?.systemIds) ? input.systemIds : []).map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))].slice(0, 2);
  if (!systemIds.length) throw new Error("Choose a home candidate before requesting a deep scan.");
  return refreshSystemIntelligence(systemIds, snapshots, {
    caller: "single",
    discoverStructures: false,
    deepKillmailBackfill: true,
    forceActivity: true,
  });
}
