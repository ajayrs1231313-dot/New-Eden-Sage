import { USER_DATA_ROOT } from "./data-paths";
﻿import { promises as fs } from "node:fs";
import path from "node:path";
import { app, BrowserWindow } from "electron";
import { getPveStaticIndex } from "./pve-static-index";
import { decrypt, encrypt, readConfig, writeConfig } from "./config";
import { refreshEveToken } from "./eve";
import { loadSharedPublicSource } from "./shared-market-data";
import {
  SYSTEM_NEWS_ZKILL_BACKFILL_DAYS,
  SYSTEM_NEWS_ZKILL_COOLDOWN_MS,
  SYSTEM_NEWS_ZKILL_CACHE_TTL_MS,
  SYSTEM_NEWS_ZKILL_LOOKBACK_SECONDS,
  killmailBackfillCutoffTime,
  killmailBackfillMonths,
  killmailRefreshCycleAllowed,
  killmailCacheNeedsQueue,
  deepKillmailBackfillForCaller,
  killmailCallerPriority,
  nextKillmailRequestTime,
  parseIsoTime,
  zkillBackfillNeedsNextPage,
} from "./system-intelligence-policy";

const ESI_HEADERS = {
  "X-Compatibility-Date": "2026-08-02",
  "X-User-Agent": "NewEdenSage/1.1.7",
};
const ZKILL_HEADERS = {
  "Accept-Encoding": "gzip",
  "User-Agent": "NewEdenSage/1.1.7 https://github.com/ajayrs1231313-dot/New-Eden-Sage",
};

// Shared zKillboard scheduler. Requests are spaced conservatively, while each
// system's recent result remains cached for five minutes. System News/single
// system work outranks Navigation background enrichment so route planning cannot
// starve a watched system. ESI activity refreshes are independent of this gate.
const ZKILL_COOLDOWN_MS = SYSTEM_NEWS_ZKILL_COOLDOWN_MS;
const ZKILL_LOOKBACK_SECONDS = SYSTEM_NEWS_ZKILL_LOOKBACK_SECONDS;
const ZKILL_BACKFILL_DAYS = SYSTEM_NEWS_ZKILL_BACKFILL_DAYS;
const KILLMAIL_BACKFILL_SCHEMA_VERSION = 2;

type ActivitySample = {
  capturedAt: string;
  shipKills: number;
  podKills: number;
  npcKills: number;
  jumps: number;
};
type HistoryFile = Record<string, ActivitySample[]>;

type SharedActivityFeed = {
  fetchedAt: string;
  kills: Array<{ system_id: number; ship_kills: number; pod_kills: number; npc_kills: number }>;
  jumps: Array<{ system_id: number; ship_jumps: number }>;
};
const ACTIVITY_FEED_CACHE_MS = 2 * 60 * 1000;
let sharedActivityFeed: SharedActivityFeed | null = null;
let sharedActivityFeedPromise: Promise<SharedActivityFeed> | null = null;

export type KillmailIntel = {
  killmailId: number;
  killmailTime?: string;
  solarSystemId: number;
  victim?: any;
  attackers?: any[];
  source: "zKillboard" | "connected character";
  sourceCharacter?: string;
  totalValue?: number;
  points?: number;
  labels?: string[];
  solo?: boolean;
  npc?: boolean;
  awox?: boolean;
  locationId?: number;
};

type ZkillRow = {
  killmail_id?: number;
  killID?: number;
  killmail_time?: string;
  solar_system_id?: number;
  victim?: any;
  attackers?: any[];
  zkb?: {
    hash?: string;
    totalValue?: number;
    points?: number;
    labels?: string[];
    solo?: boolean;
    npc?: boolean;
    awox?: boolean;
    locationID?: number;
  };
};

type EsiKillmail = {
  killmail_id: number;
  killmail_time: string;
  solar_system_id: number;
  victim: any;
  attackers: any[];
};

type KillmailCacheEntry = {
  updatedAt?: string;
  backfillCompletedAt?: string;
  backfillCutoffAt?: string;
  backfillSchemaVersion?: number;
  killmails: KillmailIntel[];
};

type KillmailQueueCaller = "watch" | "route" | "single";
type QueuedRegion = {
  regionId: number;
  systemIds: number[];
  priority?: number;
  requestedAt?: string;
  caller?: KillmailQueueCaller;
};

type QueuedBackfill = {
  systemId: number;
  year: number;
  month: number;
  page: number;
  attempts?: number;
};

type KillmailState = {
  lastRequestAt?: string;
  lastCycleRequestedAt?: string;
  lastRegionId?: number;
  lastError?: string;
  pendingBackfills: QueuedBackfill[];
  pendingRegions: QueuedRegion[];
  systems: Record<string, KillmailCacheEntry>;
};


type DiscoveredStructure = {
  structureId: number;
  name: string;
  typeId?: number;
  ownerId?: number;
  solarSystemId: number;
  source: string;
  discoveredAt: string;
};

type StructureDiscoveryState = {
  publicListFetchedAt?: string;
  publicIds: number[];
  cursor: number;
  details: Record<string, DiscoveredStructure>;
};

export type KillmailRefreshStatus = {
  cooldownMs: number;
  cacheTtlMs: number;
  lookbackSeconds: number;
  backfillDays: number;
  lastRequestAt: string | null;
  lastCycleRequestedAt: string | null;
  nextRequestAt: string | null;
  remainingMs: number;
  queuedBackfills: number;
  backfillSystems: number;
  queuedRegions: number;
  queuedSystems: number;
  inFlight: boolean;
  lastRegionId: number | null;
  lastError: string | null;
  cycleAccepted?: boolean;
};

export type SystemIntelligence = {
  system: {
    systemId: number;
    name: string;
    regionId: number;
    regionName: string;
    constellationName: string;
    securityStatus: number;
    securityBand: string;
  };
  current: ActivitySample;
  history: ActivitySample[];
  windows: Record<
    "1h" | "24h" | "7d" | "30d",
    {
      samples: number;
      first: ActivitySample | null;
      last: ActivitySample | null;
      delta: { shipKills: number; podKills: number; npcKills: number; jumps: number } | null;
    }
  >;
  knownStructures: Array<{
    structureId?: number;
    name: string;
    typeId?: number;
    ownerId?: number;
    ownerName?: string;
    source: string;
  }>;
  localCorporations: Array<{
    corporationId: number;
    name: string;
    ticker?: string;
    allianceId?: number;
    ceoId?: number;
    homeStationId?: number;
    memberCount?: number;
    iskTaxRate?: number;
    lpTaxRate?: number;
    warEligible?: boolean;
    friendlyFire?: string;
    state?: string;
    type?: string;
    dateFounded?: string;
    palette?: { main_color?: string; secondary_color?: string };
    structureCount: number;
    connectedPilots: number;
    attackerKillmails: number;
    victimLosses: number;
    firstSeenAt?: string;
    lastSeenAt?: string;
    uniquePilots: number;
    confidencePercent: number;
    confidenceLabel: string;
    evidence: string;
  }>;
  killmails: KillmailIntel[];
  killmailRefresh: {
    lastUpdatedAt: string | null;
    queued: boolean;
    global: KillmailRefreshStatus;
  };
  limitations: string[];
};

let killmailStatePromise: Promise<KillmailState> | null = null;
let killmailQueueTimer: NodeJS.Timeout | null = null;
let killmailQueueRunning = false;

function historyPath() {
  return path.join(USER_DATA_ROOT, "system-intelligence-history.json");
}

function killmailStatePath() {
  return path.join(USER_DATA_ROOT, "system-intelligence-killmails.json");
}

function structureDiscoveryStatePath() {
  return path.join(USER_DATA_ROOT, "system-intelligence-structures.json");
}

function normalizeStructureDiscoveryState(value: any): StructureDiscoveryState {
  const publicIds: number[] = Array.isArray(value?.publicIds)
    ? [...new Set<number>(value.publicIds.map((id: any) => Number(id)).filter((id: number) => Number.isSafeInteger(id) && id > 0))]
    : [];
  const details: Record<string, DiscoveredStructure> = {};
  if (value?.details && typeof value.details === "object") {
    for (const [key, raw] of Object.entries(value.details as Record<string, any>)) {
      const structureId = Number(raw?.structureId ?? key);
      const solarSystemId = Number(raw?.solarSystemId ?? 0);
      if (!Number.isSafeInteger(structureId) || structureId <= 0 || !Number.isInteger(solarSystemId) || solarSystemId <= 0) continue;
      details[String(structureId)] = {
        structureId,
        name: String(raw?.name ?? ("Structure " + structureId)),
        typeId: Number(raw?.typeId ?? 0) || undefined,
        ownerId: Number(raw?.ownerId ?? 0) || undefined,
        solarSystemId,
        source: String(raw?.source ?? "Public structure index"),
        discoveredAt: String(raw?.discoveredAt ?? new Date(0).toISOString()),
      };
    }
  }
  return {
    publicListFetchedAt: typeof value?.publicListFetchedAt === "string" ? value.publicListFetchedAt : undefined,
    publicIds,
    cursor: publicIds.length ? Math.max(0, Number(value?.cursor ?? 0)) % publicIds.length : 0,
    details,
  };
}

async function getStructureDiscoveryState() {
  if (!structureDiscoveryStatePromise) {
    structureDiscoveryStatePromise = fs.readFile(structureDiscoveryStatePath(), "utf8")
      .then((content) => normalizeStructureDiscoveryState(JSON.parse(content)))
      .catch(() => normalizeStructureDiscoveryState({}));
  }
  return structureDiscoveryStatePromise;
}

async function saveStructureDiscoveryState(state: StructureDiscoveryState) {
  const target = structureDiscoveryStatePath();
  const temp = target + "." + process.pid + "." + Date.now() + ".tmp";
  await fs.writeFile(temp, JSON.stringify(state), "utf8");
  await fs.rename(temp, target).catch(async () => {
    await fs.rm(temp, { force: true }).catch(() => undefined);
    await fs.writeFile(target, JSON.stringify(state), "utf8");
  });
}

async function loadHistory(): Promise<HistoryFile> {
  try {
    return JSON.parse(await fs.readFile(historyPath(), "utf8"));
  } catch {
    return {};
  }
}

async function saveHistory(value: HistoryFile) {
  await fs.writeFile(historyPath(), JSON.stringify(value), "utf8");
}

function normalizeQueuedRegions(value: any): QueuedRegion[] {
  const bySystem = new Map<number, QueuedRegion>();
  for (const raw of Array.isArray(value) ? value : []) {
    const regionId = Number(raw?.regionId);
    if (!Number.isInteger(regionId) || regionId <= 0) continue;
    const priority = Math.max(0, Math.min(3, Number(raw?.priority ?? 0) || 0));
    const caller: KillmailQueueCaller | undefined = raw?.caller === "watch" || raw?.caller === "single" || raw?.caller === "route" ? raw.caller : undefined;
    const requestedAt = typeof raw?.requestedAt === "string" ? raw.requestedAt : undefined;
    const ids = Array.isArray(raw?.systemIds) ? [...new Set<number>(raw.systemIds.map(Number).filter((id: number) => Number.isInteger(id) && id > 0))] : [];
    for (const systemId of ids) {
      const next: QueuedRegion = { regionId, systemIds: [systemId], priority, requestedAt, caller };
      const current = bySystem.get(systemId);
      if (!current || priority > Number(current.priority ?? 0) || (priority === Number(current.priority ?? 0) && parseIsoTime(requestedAt) > parseIsoTime(current.requestedAt))) bySystem.set(systemId, next);
    }
  }
  return [...bySystem.values()].sort((a, b) => Number(b.priority ?? 0) - Number(a.priority ?? 0) || parseIsoTime(a.requestedAt) - parseIsoTime(b.requestedAt));
}

function upsertRecentKillmailJob(state: KillmailState, job: QueuedRegion) {
  const systemId = job.systemIds[0];
  const index = state.pendingRegions.findIndex((item) => item.systemIds.includes(systemId));
  if (index >= 0) {
    const existing = state.pendingRegions[index];
    if (Number(existing.priority ?? 0) >= Number(job.priority ?? 0)) return false;
    state.pendingRegions.splice(index, 1);
  }
  state.pendingRegions.push(job);
  state.pendingRegions.sort((a, b) => Number(b.priority ?? 0) - Number(a.priority ?? 0) || parseIsoTime(a.requestedAt) - parseIsoTime(b.requestedAt));
  return true;
}

function normalizeKillmailState(value: any): KillmailState {
  return {
    lastRequestAt: typeof value?.lastRequestAt === "string" ? value.lastRequestAt : undefined,
    lastCycleRequestedAt: typeof value?.lastCycleRequestedAt === "string" ? value.lastCycleRequestedAt : undefined,
    lastRegionId: Number.isInteger(value?.lastRegionId) ? Number(value.lastRegionId) : undefined,
    lastError: typeof value?.lastError === "string" ? value.lastError : undefined,
    pendingBackfills: Array.isArray(value?.pendingBackfills)
      ? value.pendingBackfills
          .map((item: any) => ({
            systemId: Number(item?.systemId),
            year: Number(item?.year),
            month: Number(item?.month),
            page: Math.max(1, Number(item?.page ?? 1)),
            attempts: Math.max(0, Number(item?.attempts ?? 0)) || undefined,
          }))
          .filter((item: QueuedBackfill) => Number.isInteger(item.systemId) && item.systemId > 0 && Number.isInteger(item.year) && item.year >= 2003 && Number.isInteger(item.month) && item.month >= 1 && item.month <= 12 && Number.isInteger(item.page) && item.page >= 1)
      : [],
    pendingRegions: normalizeQueuedRegions(value?.pendingRegions),
    systems: value?.systems && typeof value.systems === "object" ? value.systems : {},
  };
}

async function getKillmailState(): Promise<KillmailState> {
  if (!killmailStatePromise) {
    killmailStatePromise = fs
      .readFile(killmailStatePath(), "utf8")
      .then((content) => normalizeKillmailState(JSON.parse(content)))
      .catch(() => normalizeKillmailState({}));
  }
  return killmailStatePromise;
}

async function saveKillmailState(state: KillmailState) {
  const target = killmailStatePath();
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temp, JSON.stringify(state), "utf8");
  await fs.rename(temp, target).catch(async () => {
    await fs.rm(temp, { force: true }).catch(() => undefined);
    await fs.writeFile(target, JSON.stringify(state), "utf8");
  });
}

async function esi<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: ESI_HEADERS });
  if (!response.ok) throw new Error(`EVE system intelligence failed (${response.status}).`);
  return response.json() as Promise<T>;
}

function parseTime(value?: string) {
  return parseIsoTime(value);
}

async function getSharedActivityFeed(force = false): Promise<SharedActivityFeed> {
  if (!force && sharedActivityFeed && parseTime(sharedActivityFeed.fetchedAt) >= Date.now() - ACTIVITY_FEED_CACHE_MS) return sharedActivityFeed;
  if (!force && sharedActivityFeedPromise) return sharedActivityFeedPromise;
  const work = Promise.all([
    loadSharedPublicSource<Array<{ system_id: number; ship_kills: number; pod_kills: number; npc_kills: number }>>("system-kills"),
    loadSharedPublicSource<Array<{ system_id: number; ship_jumps: number }>>("system-jumps"),
  ]).then(([killsSource, jumpsSource]) => {
    if (!killsSource || !jumpsSource) throw new Error("Shared system activity is not installed yet.");
    const fetchedAt = new Date(Math.min(Date.parse(killsSource.fetchedAt), Date.parse(jumpsSource.fetchedAt))).toISOString();
    const value: SharedActivityFeed = { fetchedAt, kills: killsSource.data, jumps: jumpsSource.data };
    sharedActivityFeed = value;
    return value;
  }).finally(() => { sharedActivityFeedPromise = null; });
  sharedActivityFeedPromise = work;
  return work;
}

type StructureAccessToken = { characterId: string; accessToken: string };

async function connectedStructureTokens(): Promise<StructureAccessToken[]> {
  const config = await readConfig();
  const result: StructureAccessToken[] = [];
  let configChanged = false;
  for (const characterId of Object.keys(config.encryptedRefreshTokens ?? {})) {
    const cached = structureAccessTokenCache.get(characterId);
    if (cached && cached.expiresAt > Date.now()) {
      result.push({ characterId, accessToken: cached.accessToken });
      continue;
    }
    const stored = config.encryptedRefreshTokens[characterId];
    if (!stored) continue;
    try {
      const tokens = await refreshEveToken(config.eveClientId, decrypt(stored));
      if (tokens.refresh_token) {
        config.encryptedRefreshTokens[characterId] = encrypt(tokens.refresh_token);
        configChanged = true;
      }
      structureAccessTokenCache.set(characterId, { accessToken: tokens.access_token, expiresAt: Date.now() + STRUCTURE_ACCESS_TOKEN_CACHE_MS });
      result.push({ characterId, accessToken: tokens.access_token });
    } catch {
      // A stale/revoked character must not break System News for everyone else.
    }
  }
  if (configChanged) await writeConfig(config);
  return result;
}

async function authenticatedEsi<T>(url: string, accessToken: string): Promise<T> {
  const response = await fetch(url, { headers: { ...ESI_HEADERS, Authorization: "Bearer " + accessToken } });
  if (!response.ok) throw new Error("Authenticated EVE structure request failed (" + response.status + ").");
  return response.json() as Promise<T>;
}

type EsiStructureDetail = { name: string; owner_id: number; solar_system_id: number; type_id: number };

async function resolveStructureWithTokens(structureId: number, tokens: StructureAccessToken[]) {
  for (const token of tokens) {
    try {
      const detail = await authenticatedEsi<EsiStructureDetail>(
        "https://esi.evetech.net/universe/structures/" + structureId + "/",
        token.accessToken,
      );
      return { token, detail };
    } catch {
      // Structure visibility is character-specific; another connected character may see it.
    }
  }
  return null;
}

async function refreshPublicStructureIndex(tokens: StructureAccessToken[]) {
  const state = await getStructureDiscoveryState();
  const stale = !state.publicListFetchedAt || parseTime(state.publicListFetchedAt) < Date.now() - PUBLIC_STRUCTURE_LIST_CACHE_MS;
  if (stale) {
    try {
      const ids = await esi<number[]>("https://esi.evetech.net/universe/structures/");
      const unique = [...new Set((Array.isArray(ids) ? ids : []).map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))];
      const live = new Set(unique);
      state.publicIds = unique;
      state.publicListFetchedAt = new Date().toISOString();
      state.cursor = unique.length ? state.cursor % unique.length : 0;
      for (const key of Object.keys(state.details)) if (!live.has(Number(key))) delete state.details[key];
    } catch {
      // Keep the previous public list if CCP is temporarily unavailable.
    }
  }

  if (tokens.length && state.publicIds.length) {
    const count = Math.min(PUBLIC_STRUCTURE_SCAN_BATCH, state.publicIds.length);
    const batch = Array.from({ length: count }, (_, offset) => state.publicIds[(state.cursor + offset) % state.publicIds.length]);
    for (let index = 0; index < batch.length; index += 10) {
      const chunk = batch.slice(index, index + 10);
      const resolved = await Promise.all(chunk.map(async (structureId) => {
        const value = await resolveStructureWithTokens(structureId, tokens);
        return value ? { structureId, detail: value.detail } : null;
      }));
      for (const value of resolved) {
        if (!value) continue;
        state.details[String(value.structureId)] = {
          structureId: value.structureId,
          name: String(value.detail.name ?? ("Structure " + value.structureId)),
          typeId: Number(value.detail.type_id ?? 0) || undefined,
          ownerId: Number(value.detail.owner_id ?? 0) || undefined,
          solarSystemId: Number(value.detail.solar_system_id),
          source: "Public structure index",
          discoveredAt: new Date().toISOString(),
        };
      }
    }
    state.cursor = (state.cursor + count) % state.publicIds.length;
  }
  await saveStructureDiscoveryState(state);
  return state;
}

async function discoverStructuresForSystems(systemIds: number[], snapshots: any[]) {
  const index = await getPveStaticIndex();
  const wanted = new Set(systemIds);
  const result = new Map<number, SystemIntelligence["knownStructures"]>();
  const tokens = await connectedStructureTokens();
  const publicState = await refreshPublicStructureIndex(tokens);
  const publicIds = new Set(publicState.publicIds);
  const push = (systemId: number, item: SystemIntelligence["knownStructures"][number]) => {
    if (!wanted.has(systemId)) return;
    const rows = result.get(systemId) ?? [];
    const existing = rows.find((row) => row.structureId && item.structureId && row.structureId === item.structureId);
    if (existing) {
      if (!existing.ownerId && item.ownerId) existing.ownerId = item.ownerId;
      if (!existing.ownerName && item.ownerName) existing.ownerName = item.ownerName;
      if (!existing.typeId && item.typeId) existing.typeId = item.typeId;
      if (!existing.source.includes(item.source)) existing.source += " · " + item.source;
      return;
    }
    rows.push(item);
    result.set(systemId, rows);
  };

  for (const detail of Object.values(publicState.details)) {
    if (!wanted.has(detail.solarSystemId)) continue;
    push(detail.solarSystemId, { structureId: detail.structureId, name: detail.name, typeId: detail.typeId, ownerId: detail.ownerId, source: detail.source });
  }

  // Authenticated ESI search adds structures each connected character can see.
  // Searching by the system name is deliberately treated as partial evidence: it
  // catches the common system-prefixed naming convention but is not an enumeration.
  for (const systemId of systemIds) {
    const system = index.systems.get(systemId);
    if (!system || !tokens.length) continue;
    const candidateToCharacter = new Map<number, string>();
    for (const token of tokens) {
      try {
        const search = await authenticatedEsi<{ structure?: number[] }>(
          "https://esi.evetech.net/characters/" + token.characterId + "/search/?categories=structure&search=" + encodeURIComponent(system.name) + "&strict=false",
          token.accessToken,
        );
        for (const structureId of (Array.isArray(search.structure) ? search.structure : []).slice(0, 250)) {
          const id = Number(structureId);
          if (Number.isSafeInteger(id) && id > 0 && !candidateToCharacter.has(id)) candidateToCharacter.set(id, token.characterId);
        }
      } catch {
        // Existing tokens may predate the structure-search scope; reconnecting adds it.
      }
    }
    const candidates = [...candidateToCharacter.keys()];
    for (let offset = 0; offset < candidates.length; offset += 10) {
      const chunk = candidates.slice(offset, offset + 10);
      const resolved = await Promise.all(chunk.map(async (structureId) => {
        const value = await resolveStructureWithTokens(structureId, tokens);
        return value ? { structureId, token: value.token, detail: value.detail } : null;
      }));
      for (const value of resolved) {
        if (!value || Number(value.detail.solar_system_id) !== systemId) continue;
        const characterName = snapshots.find((snapshot) => String(snapshot?.characterId ?? "") === value.token.characterId)?.character?.name ?? ("character " + value.token.characterId);
        const publicSuffix = publicIds.has(value.structureId) ? " · public structure index" : "";
        push(systemId, {
          structureId: value.structureId,
          name: String(value.detail.name ?? ("Structure " + value.structureId)),
          typeId: Number(value.detail.type_id ?? 0) || undefined,
          ownerId: Number(value.detail.owner_id ?? 0) || undefined,
          source: "Accessible structure search via " + characterName + publicSuffix,
        });
        if (publicIds.has(value.structureId)) {
          publicState.details[String(value.structureId)] = {
            structureId: value.structureId,
            name: String(value.detail.name ?? ("Structure " + value.structureId)),
            typeId: Number(value.detail.type_id ?? 0) || undefined,
            ownerId: Number(value.detail.owner_id ?? 0) || undefined,
            solarSystemId: systemId,
            source: "Public structure index",
            discoveredAt: new Date().toISOString(),
          };
        }
      }
    }
  }
  await saveStructureDiscoveryState(publicState);
  return result;
}

function killmailDetailScore(item: KillmailIntel) {
  const countItems = (items: any[]): number => (items ?? []).reduce((sum, value) => sum + 1 + countItems(Array.isArray(value?.items) ? value.items : []), 0);
  return countItems(Array.isArray(item.victim?.items) ? item.victim.items : []) * 100
    + (Array.isArray(item.attackers) ? item.attackers.length : 0) * 5
    + (item.victim?.ship_type_id ? 2 : 0)
    + (item.killmailTime ? 1 : 0);
}

function cleanKillmailCache(killmails: KillmailIntel[]) {
  const byId = new Map<number, KillmailIntel>();
  for (const item of killmails) {
    if (!item?.killmailId) continue;
    const current = byId.get(item.killmailId);
    const richer = !current || killmailDetailScore(item) > killmailDetailScore(current);
    const preferredSource = current && item.source === "zKillboard" && current.source !== "zKillboard";
    if (richer || preferredSource) byId.set(item.killmailId, item);
  }
  return [...byId.values()].sort((a, b) => parseTime(b.killmailTime) - parseTime(a.killmailTime));
}

type PublicCorporationProfile = {
  name?: string;
  ticker?: string;
  alliance_id?: number;
  ceo_id?: number;
  home_station_id?: number;
  member_count?: number;
  tax_rate?: number;
  lp_tax_rate?: number;
  tax_rates?: { isk?: number; loyalty_point?: number };
  war_eligible?: boolean;
  friendly_fire?: string;
  state?: string;
  type?: string;
  date_founded?: string;
  palette?: { main_color?: string; secondary_color?: string };
};

const corporationProfileCache = new Map<number, { expiresAt: number; value: PublicCorporationProfile | null }>();
const CORPORATION_PROFILE_CACHE_MS = 6 * 60 * 60 * 1000;
const LOCAL_CORPORATION_KILLMAIL_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const PUBLIC_STRUCTURE_LIST_CACHE_MS = 6 * 60 * 60 * 1000;
const PUBLIC_STRUCTURE_SCAN_BATCH = 40;
const STRUCTURE_ACCESS_TOKEN_CACHE_MS = 10 * 60 * 1000;
const structureAccessTokenCache = new Map<string, { accessToken: string; expiresAt: number }>();
let structureDiscoveryStatePromise: Promise<StructureDiscoveryState> | null = null;

async function getPublicCorporationProfile(corporationId: number) {
  const cached = corporationProfileCache.get(corporationId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  let value: PublicCorporationProfile | null = null;
  try {
    value = await esi<PublicCorporationProfile>("https://esi.evetech.net/corporations/" + corporationId + "/");
  } catch {
    value = null;
  }
  corporationProfileCache.set(corporationId, { expiresAt: Date.now() + CORPORATION_PROFILE_CACHE_MS, value });
  return value;
}

async function buildLocalCorporations(
  systemId: number,
  snapshots: any[],
  knownStructures: SystemIntelligence["knownStructures"],
  killmails: KillmailIntel[],
): Promise<SystemIntelligence["localCorporations"]> {
  type Evidence = {
    corporationId: number;
    nameHint?: string;
    structureCount: number;
    connectedPilots: number;
    attackerKillmails: number;
    victimLosses: number;
    pilotIds: Set<number>;
    firstSeenAt?: string;
    lastSeenAt?: string;
  };
  const byCorporation = new Map<number, Evidence>();
  const ensure = (corporationId: number, nameHint?: string) => {
    let value = byCorporation.get(corporationId);
    if (!value) {
      value = { corporationId, nameHint, structureCount: 0, connectedPilots: 0, attackerKillmails: 0, victimLosses: 0, pilotIds: new Set<number>() };
      byCorporation.set(corporationId, value);
    } else if (!value.nameHint && nameHint) value.nameHint = nameHint;
    return value;
  };
  const seenAt = (value: Evidence, when?: string) => {
    if (!when) return;
    const time = parseTime(when);
    if (!time) return;
    if (!value.firstSeenAt || time < parseTime(value.firstSeenAt)) value.firstSeenAt = when;
    if (!value.lastSeenAt || time > parseTime(value.lastSeenAt)) value.lastSeenAt = when;
  };
  const confidence = (row: Evidence) => {
    if (row.connectedPilots > 0) return { percent: 100, label: "Confirmed" };
    if (row.structureCount > 0) return { percent: 100, label: "Confirmed infrastructure" };
    const events = row.attackerKillmails + row.victimLosses;
    if (!events) return { percent: 0, label: "Unconfirmed" };
    let score = 20 + 80 * (1 - Math.exp(-events / 4.5));
    score += Math.min(5, Math.max(0, row.pilotIds.size - 1));
    const age = row.lastSeenAt ? Date.now() - parseTime(row.lastSeenAt) : Number.POSITIVE_INFINITY;
    if (age <= 60 * 60 * 1000) score += 6;
    else if (age <= 24 * 60 * 60 * 1000) score += 4;
    else if (age <= 7 * 24 * 60 * 60 * 1000) score += 2;
    const percent = Math.max(1, Math.min(98, Math.round(score)));
    return { percent, label: percent >= 90 ? "Very high" : percent >= 70 ? "High" : percent >= 45 ? "Moderate" : "Low" };
  };

  for (const structure of knownStructures) {
    const corporationId = Number(structure.ownerId ?? 0);
    if (!corporationId) continue;
    ensure(corporationId, structure.ownerName).structureCount += 1;
  }

  for (const snapshot of snapshots) {
    if (Number(snapshot?.location?.solar_system_id ?? 0) !== systemId) continue;
    const corporationId = Number(snapshot?.character?.corporation_id ?? 0);
    if (!corporationId) continue;
    const value = ensure(corporationId, snapshot?.character?.corporation_name);
    value.connectedPilots += 1;
    const characterId = Number(snapshot?.characterId ?? 0);
    if (characterId) value.pilotIds.add(characterId);
    seenAt(value, snapshot?.updatedAt);
  }

  const cutoff = Date.now() - LOCAL_CORPORATION_KILLMAIL_WINDOW_MS;
  for (const killmail of killmails) {
    if (killmail.killmailTime && parseTime(killmail.killmailTime) < cutoff) continue;
    const victimCorporationId = Number(killmail.victim?.corporation_id ?? 0);
    if (victimCorporationId) {
      const value = ensure(victimCorporationId);
      value.victimLosses += 1;
      const pilotId = Number(killmail.victim?.character_id ?? 0);
      if (pilotId) value.pilotIds.add(pilotId);
      seenAt(value, killmail.killmailTime);
    }
    const attackerCorporations = new Map<number, Set<number>>();
    for (const attacker of Array.isArray(killmail.attackers) ? killmail.attackers : []) {
      const corporationId = Number(attacker?.corporation_id ?? 0);
      if (!corporationId) continue;
      const pilots = attackerCorporations.get(corporationId) ?? new Set<number>();
      const pilotId = Number(attacker?.character_id ?? 0);
      if (pilotId) pilots.add(pilotId);
      attackerCorporations.set(corporationId, pilots);
    }
    for (const [corporationId, pilots] of attackerCorporations) {
      const value = ensure(corporationId);
      value.attackerKillmails += 1;
      for (const pilotId of pilots) value.pilotIds.add(pilotId);
      seenAt(value, killmail.killmailTime);
    }
  }

  const evidenceRows = [...byCorporation.values()].sort((a, b) =>
    confidence(b).percent - confidence(a).percent ||
    b.structureCount - a.structureCount ||
    parseTime(b.lastSeenAt) - parseTime(a.lastSeenAt) ||
    a.corporationId - b.corporationId,
  );
  const profiles = new Map<number, PublicCorporationProfile | null>();
  for (let index = 0; index < evidenceRows.length; index += 12) {
    const batch = evidenceRows.slice(index, index + 12);
    const values = await Promise.all(batch.map(async (row) => [row.corporationId, await getPublicCorporationProfile(row.corporationId)] as const));
    for (const [corporationId, profile] of values) profiles.set(corporationId, profile);
  }

  return evidenceRows.map((row) => {
    const profile = profiles.get(row.corporationId) ?? null;
    const presence = confidence(row);
    const signals: string[] = [];
    if (row.structureCount) signals.push(String(row.structureCount) + " known structure" + (row.structureCount === 1 ? "" : "s"));
    if (row.connectedPilots) signals.push(String(row.connectedPilots) + " connected pilot" + (row.connectedPilots === 1 ? "" : "s") + " currently observed");
    if (row.attackerKillmails) signals.push("attacker on " + row.attackerKillmails + " cached killmail" + (row.attackerKillmails === 1 ? "" : "s"));
    if (row.victimLosses) signals.push(String(row.victimLosses) + " cached loss" + (row.victimLosses === 1 ? "" : "es"));
    if (row.pilotIds.size) signals.push(String(row.pilotIds.size) + " unique pilot" + (row.pilotIds.size === 1 ? "" : "s") + " observed");
    return {
      corporationId: row.corporationId,
      name: String(profile?.name ?? row.nameHint ?? ("Corporation " + row.corporationId)),
      ticker: profile?.ticker,
      allianceId: Number(profile?.alliance_id ?? 0) || undefined,
      ceoId: Number(profile?.ceo_id ?? 0) || undefined,
      homeStationId: Number(profile?.home_station_id ?? 0) || undefined,
      memberCount: Number.isFinite(Number(profile?.member_count)) ? Number(profile?.member_count) : undefined,
      iskTaxRate: Number.isFinite(Number(profile?.tax_rates?.isk ?? profile?.tax_rate)) ? Number(profile?.tax_rates?.isk ?? profile?.tax_rate) : undefined,
      lpTaxRate: Number.isFinite(Number(profile?.tax_rates?.loyalty_point ?? profile?.lp_tax_rate)) ? Number(profile?.tax_rates?.loyalty_point ?? profile?.lp_tax_rate) : undefined,
      warEligible: typeof profile?.war_eligible === "boolean" ? profile.war_eligible : undefined,
      friendlyFire: profile?.friendly_fire,
      state: profile?.state,
      type: profile?.type,
      dateFounded: profile?.date_founded,
      palette: profile?.palette,
      structureCount: row.structureCount,
      connectedPilots: row.connectedPilots,
      attackerKillmails: row.attackerKillmails,
      victimLosses: row.victimLosses,
      uniquePilots: row.pilotIds.size,
      firstSeenAt: row.firstSeenAt,
      lastSeenAt: row.lastSeenAt,
      confidencePercent: presence.percent,
      confidenceLabel: presence.label,
      evidence: signals.length ? signals.join(" · ") : "Public corporation profile observed from system evidence",
    };
  });
}

function killmailSystemQueued(state: KillmailState, systemId: number) {
  return state.pendingBackfills.some((item) => item.systemId === systemId)
    || state.pendingRegions.some((item) => item.systemIds.includes(systemId));
}

function makeKillmailStatus(state: KillmailState, cycleAccepted?: boolean): KillmailRefreshStatus {
  const nextRequestMs = nextKillmailRequestTime(state.lastRequestAt);
  const remainingMs = nextRequestMs ? Math.max(0, nextRequestMs - Date.now()) : 0;
  const backfillSystems = new Set(state.pendingBackfills.map((item) => item.systemId));
  const queuedSystems = new Set<number>([
    ...backfillSystems,
    ...state.pendingRegions.flatMap((item) => item.systemIds),
  ]);
  return {
    cooldownMs: ZKILL_COOLDOWN_MS,
    cacheTtlMs: SYSTEM_NEWS_ZKILL_CACHE_TTL_MS,
    lookbackSeconds: ZKILL_LOOKBACK_SECONDS,
    backfillDays: ZKILL_BACKFILL_DAYS,
    lastRequestAt: state.lastRequestAt ?? null,
    lastCycleRequestedAt: state.lastCycleRequestedAt ?? null,
    nextRequestAt: nextRequestMs ? new Date(nextRequestMs).toISOString() : null,
    remainingMs,
    queuedBackfills: state.pendingBackfills.length,
    backfillSystems: backfillSystems.size,
    queuedRegions: state.pendingRegions.length,
    queuedSystems: queuedSystems.size,
    inFlight: killmailQueueRunning,
    lastRegionId: state.lastRegionId ?? null,
    lastError: state.lastError ?? null,
    cycleAccepted,
  };
}

function broadcastKillmailUpdate(systemIds: number[], state: KillmailState) {
  const killmailsBySystem: Record<string, KillmailIntel[]> = {};
  const updatedAtBySystem: Record<string, string | null> = {};
  const queuedBySystem: Record<string, boolean> = {};
  for (const systemId of systemIds) {
    killmailsBySystem[String(systemId)] = state.systems[String(systemId)]?.killmails ?? [];
    updatedAtBySystem[String(systemId)] = state.systems[String(systemId)]?.updatedAt ?? null;
    queuedBySystem[String(systemId)] = killmailSystemQueued(state, systemId);
  }
  const payload = {
    systemIds,
    killmailsBySystem,
    updatedAtBySystem,
    queuedBySystem,
    status: makeKillmailStatus(state),
  };
  for (const target of BrowserWindow.getAllWindows()) {
    if (!target.isDestroyed()) target.webContents.send("system-intelligence:killmails-updated", payload);
  }
}

function scheduleKillmailQueue(delayMs: number) {
  if (killmailQueueTimer) clearTimeout(killmailQueueTimer);
  killmailQueueTimer = setTimeout(() => {
    killmailQueueTimer = null;
    void serviceKillmailQueue();
  }, Math.max(50, delayMs));
}

async function resolveZkillRows(
  rows: ZkillRow[],
  wantedSystemIds: Set<number>,
  existingById = new Map<number, KillmailIntel>(),
): Promise<Map<number, KillmailIntel[]>> {
  const bySystem = new Map<number, KillmailIntel[]>();
  const unresolved: Array<{ row: ZkillRow; killmailId: number; hash: string }> = [];

  const add = (item: KillmailIntel) => {
    if (!wantedSystemIds.has(item.solarSystemId)) return;
    const values = bySystem.get(item.solarSystemId) ?? [];
    values.push(item);
    bySystem.set(item.solarSystemId, values);
  };

  for (const row of rows) {
    const killmailId = Number(row.killmail_id ?? row.killID ?? 0);
    if (!killmailId) continue;
    const cached = existingById.get(killmailId);
    if (cached) {
      add(cached);
      continue;
    }
    // zKillboard is our discovery/index source. When it gives us the CCP hash,
    // always fetch the authoritative ESI killmail so victim.items is complete.
    // This does NOT consume another zKillboard request and is outside the
    // five-minute courtesy gate.
    const hash = String(row.zkb?.hash ?? "");
    if (hash) {
      unresolved.push({ row, killmailId, hash });
      continue;
    }
    // Rare fallback for a payload with no hash but enough embedded detail to
    // remain useful.
    const systemId = Number(row.solar_system_id ?? 0);
    if (systemId && row.victim && Array.isArray(row.attackers)) {
      add({
        killmailId,
        killmailTime: row.killmail_time,
        solarSystemId: systemId,
        victim: row.victim,
        attackers: row.attackers,
        source: "zKillboard",
        totalValue: Number(row.zkb?.totalValue ?? 0) || undefined,
        points: Number(row.zkb?.points ?? 0) || undefined,
        labels: Array.isArray(row.zkb?.labels) ? row.zkb?.labels : undefined,
        solo: Boolean(row.zkb?.solo),
        npc: Boolean(row.zkb?.npc),
        awox: Boolean(row.zkb?.awox),
        locationId: Number(row.zkb?.locationID ?? 0) || undefined,
      });
    }
  }

  // Use CCP ESI for full killmail detail after zKillboard discovery. These calls
  // are intentionally not part of the zKillboard five-minute gate.
  for (let index = 0; index < unresolved.length; index += 12) {
    const batch = unresolved.slice(index, index + 12);
    const resolved = await Promise.all(
      batch.map(async ({ row, killmailId, hash }) => {
        try {
          const detail = await esi<EsiKillmail>(
            `https://esi.evetech.net/killmails/${killmailId}/${encodeURIComponent(hash)}/`,
          );
          return { row, detail };
        } catch {
          return { row, detail: null as EsiKillmail | null };
        }
      }),
    );
    for (const result of resolved) {
      const { row, detail } = result;
      if (!detail) {
        const fallbackSystemId = Number(row.solar_system_id ?? 0);
        if (fallbackSystemId && row.victim && Array.isArray(row.attackers)) {
          add({
            killmailId: Number(row.killmail_id ?? row.killID ?? 0),
            killmailTime: row.killmail_time,
            solarSystemId: fallbackSystemId,
            victim: row.victim,
            attackers: row.attackers,
            source: "zKillboard",
            totalValue: Number(row.zkb?.totalValue ?? 0) || undefined,
            points: Number(row.zkb?.points ?? 0) || undefined,
            labels: Array.isArray(row.zkb?.labels) ? row.zkb?.labels : undefined,
            solo: Boolean(row.zkb?.solo),
            npc: Boolean(row.zkb?.npc),
            awox: Boolean(row.zkb?.awox),
            locationId: Number(row.zkb?.locationID ?? 0) || undefined,
          });
        }
        continue;
      }
      const systemId = Number(detail.solar_system_id);
      if (!wantedSystemIds.has(systemId)) continue;
      add({
        killmailId: Number(detail.killmail_id),
        killmailTime: detail.killmail_time,
        solarSystemId: systemId,
        victim: detail.victim,
        attackers: detail.attackers,
        source: "zKillboard",
        totalValue: Number(row.zkb?.totalValue ?? 0) || undefined,
        points: Number(row.zkb?.points ?? 0) || undefined,
        labels: Array.isArray(row.zkb?.labels) ? row.zkb?.labels : undefined,
        solo: Boolean(row.zkb?.solo),
        npc: Boolean(row.zkb?.npc),
        awox: Boolean(row.zkb?.awox),
        locationId: Number(row.zkb?.locationID ?? 0) || undefined,
      });
    }
  }

  for (const [systemId, values] of bySystem) bySystem.set(systemId, cleanKillmailCache(values));
  return bySystem;
}

async function fetchRegionKillmails(regionId: number, systemIds: number[], existingById: Map<number, KillmailIntel>) {
  // Recent discovery must be scoped to the requested system. A region-wide query
  // can fill zKillboard's result page with unrelated kills and silently omit a
  // quieter requested system, which made the 1h/24h cards appear empty even when
  // that system had a current killmail.
  const singleSystemId = systemIds.length === 1 ? systemIds[0] : undefined;
  const scope = singleSystemId ? `systemID/${singleSystemId}` : `regionID/${regionId}`;
  const response = await fetch(
    `https://zkillboard.com/api/kills/${scope}/pastSeconds/${ZKILL_LOOKBACK_SECONDS}/`,
    { headers: ZKILL_HEADERS },
  );
  if (!response.ok) throw new Error(`zKillboard returned ${response.status}`);
  const rows = (await response.json()) as ZkillRow[];
  return resolveZkillRows(Array.isArray(rows) ? rows : [], new Set(systemIds), existingById);
}

async function fetchSystemBackfill(job: QueuedBackfill, existingById: Map<number, KillmailIntel>) {
  const response = await fetch(
    `https://zkillboard.com/api/kills/systemID/${job.systemId}/year/${job.year}/month/${job.month}/page/${job.page}/`,
    { headers: ZKILL_HEADERS },
  );
  if (!response.ok) throw new Error(`zKillboard returned ${response.status}`);
  const payload = await response.json();
  const rows = Array.isArray(payload) ? payload as ZkillRow[] : [];
  const resolved = await resolveZkillRows(rows, new Set([job.systemId]), existingById);
  return { rowCount: rows.length, killmails: resolved.get(job.systemId) ?? [] };
}

function backfillJobKey(job: QueuedBackfill) {
  return `${job.systemId}:${job.year}:${job.month}:${job.page}`;
}

function ensureKillmailBackfills(state: KillmailState, systemIds: number[], now = Date.now()) {
  const months = killmailBackfillMonths(now);
  const existingJobs = new Set(state.pendingBackfills.map(backfillJobKey));
  let changed = false;
  const systemsNeedingBackfill = systemIds.filter((systemId) => {
    const cache = state.systems[String(systemId)];
    const currentSchema = Number(cache?.backfillSchemaVersion ?? 0);
    return (!cache?.backfillCompletedAt || currentSchema < KILLMAIL_BACKFILL_SCHEMA_VERSION)
      && !state.pendingBackfills.some((item) => item.systemId === systemId);
  });
  for (const systemId of systemsNeedingBackfill) {
    const key = String(systemId);
    if (!state.systems[key]) state.systems[key] = { killmails: [] };
  }
  // Recent month first across every requested system. Recent watched-system pulls
  // are scheduled ahead of backfill work, so deep history cannot hide current kills.
  for (const value of months) {
    for (const systemId of systemsNeedingBackfill) {
      const job: QueuedBackfill = { systemId, year: value.year, month: value.month, page: 1 };
      const jobKey = backfillJobKey(job);
      if (existingJobs.has(jobKey)) continue;
      state.pendingBackfills.push(job);
      existingJobs.add(jobKey);
      changed = true;
    }
  }
  return changed;
}
function finishBackfillIfComplete(state: KillmailState, systemId: number, cutoffTime: number, completedAt: string) {
  if (state.pendingBackfills.some((item) => item.systemId === systemId)) return;
  const key = String(systemId);
  const current = state.systems[key] ?? { killmails: [] };
  state.systems[key] = {
    ...current,
    backfillCompletedAt: completedAt,
    backfillCutoffAt: new Date(cutoffTime).toISOString(),
    backfillSchemaVersion: KILLMAIL_BACKFILL_SCHEMA_VERSION,
    killmails: current.killmails ?? [],
  };
}

async function serviceKillmailQueue(): Promise<void> {
  if (killmailQueueRunning) return;
  const state = await getKillmailState();
  const urgentRecentIndex = state.pendingRegions.findIndex((item) => Number(item.priority ?? 0) >= 3);
  const firstRecent = state.pendingRegions[0];
  const backgroundWaitMs = firstRecent?.requestedAt ? Date.now() - parseIsoTime(firstRecent.requestedAt) : 0;
  const recentIndex = urgentRecentIndex >= 0
    ? urgentRecentIndex
    : (!state.pendingBackfills.length || backgroundWaitMs >= 60_000 ? (firstRecent ? 0 : -1) : -1);
  const regionJob = recentIndex >= 0 ? state.pendingRegions[recentIndex] : undefined;
  const backfillJob = regionJob ? undefined : state.pendingBackfills[0];
  if (!backfillJob && !regionJob) return;

  const dueAt = nextKillmailRequestTime(state.lastRequestAt);
  const now = Date.now();
  if (dueAt > now) {
    scheduleKillmailQueue(dueAt - now);
    return;
  }

  killmailQueueRunning = true;
  if (regionJob) state.pendingRegions.splice(recentIndex, 1);
  else state.pendingBackfills.shift();
  // Count the attempt immediately. Even a failed request observes the courtesy
  // cooldown and cannot trigger an immediate retry against zKillboard.
  state.lastRequestAt = new Date().toISOString();
  if (regionJob) state.lastRegionId = regionJob.regionId;
  state.lastError = undefined;
  await saveKillmailState(state);

  const affectedSystemIds = backfillJob ? [backfillJob.systemId] : regionJob!.systemIds;
  try {
    const updatedAt = new Date().toISOString();
    if (backfillJob) {
      const key = String(backfillJob.systemId);
      const current = state.systems[key] ?? { killmails: [] };
      const existingById = new Map(cleanKillmailCache(current.killmails ?? []).map((item) => [item.killmailId, item]));
      const result = await fetchSystemBackfill(backfillJob, existingById);
      const cutoffTime = killmailBackfillCutoffTime();
      const incoming = result.killmails.filter((item) => parseTime(item.killmailTime) >= cutoffTime);
      state.systems[key] = {
        ...current,
        updatedAt,
        killmails: cleanKillmailCache([...incoming, ...(current.killmails ?? [])]),
      };
      const oldestResolvedTime = result.killmails.reduce((oldest, item) => {
        const value = parseTime(item.killmailTime);
        return value && (!oldest || value < oldest) ? value : oldest;
      }, 0);
      if (zkillBackfillNeedsNextPage(result.rowCount, oldestResolvedTime, cutoffTime)) {
        const nextJob: QueuedBackfill = { ...backfillJob, page: backfillJob.page + 1, attempts: undefined };
        if (!state.pendingBackfills.some((item) => backfillJobKey(item) === backfillJobKey(nextJob))) {
          const recentCoverageCutoff = Date.now() - 24 * 60 * 60 * 1000;
          // If this full page still has not crossed the 24-hour boundary, the
          // next page is required to make the 24h card complete. Prioritise it
          // ahead of deeper 30-day history work; otherwise append normally.
          if (!oldestResolvedTime || oldestResolvedTime > recentCoverageCutoff) state.pendingBackfills.unshift(nextJob);
          else state.pendingBackfills.push(nextJob);
        }
      }
      finishBackfillIfComplete(state, backfillJob.systemId, cutoffTime, updatedAt);
    } else if (regionJob) {
      const existingById = new Map<number, KillmailIntel>();
      for (const systemId of regionJob.systemIds) {
        for (const item of state.systems[String(systemId)]?.killmails ?? []) existingById.set(item.killmailId, item);
      }
      const fetched = await fetchRegionKillmails(regionJob.regionId, regionJob.systemIds, existingById);
      for (const systemId of regionJob.systemIds) {
        const key = String(systemId);
        const current = state.systems[key] ?? { killmails: [] };
        const incoming = fetched.get(systemId) ?? [];
        state.systems[key] = {
          ...current,
          updatedAt,
          killmails: cleanKillmailCache([...incoming, ...(current.killmails ?? [])]),
        };
      }
    }
    state.lastError = undefined;
  } catch (error) {
    state.lastError = error instanceof Error ? error.message : String(error);
    if (backfillJob && Number(backfillJob.attempts ?? 0) < 2) {
      state.pendingBackfills.push({ ...backfillJob, attempts: Number(backfillJob.attempts ?? 0) + 1 });
    }
  } finally {
    killmailQueueRunning = false;
    await saveKillmailState(state);
    broadcastKillmailUpdate(affectedSystemIds, state);
    if (state.pendingBackfills.length || state.pendingRegions.length) scheduleKillmailQueue(ZKILL_COOLDOWN_MS);
  }
}
async function requestKillmailRefreshCycle(systemIds: number[], options: { deepBackfill?: boolean; caller?: KillmailQueueCaller } = {}) {
  const state = await getKillmailState();
  const index = await getPveStaticIndex();
  const now = Date.now();
  const cycleAccepted = killmailRefreshCycleAllowed(state.lastCycleRequestedAt, now);
  let changed = options.deepBackfill === false ? false : ensureKillmailBackfills(state, systemIds, now);
  const priority = killmailCallerPriority(options.caller);

  for (const systemId of systemIds) {
    const system = index.systems.get(systemId);
    if (!system) continue;
    const key = String(systemId);
    if (!state.systems[key]) { state.systems[key] = { killmails: [] }; changed = true; }
    const alreadyQueued = state.pendingRegions.some((item) => item.systemIds.includes(systemId));
    const needsRecent = killmailCacheNeedsQueue(state.systems[key]?.updatedAt, false, now);
    if (needsRecent) {
      changed = upsertRecentKillmailJob(state, { regionId: system.regionId, systemIds: [systemId], priority, caller: options.caller, requestedAt: new Date(now).toISOString() }) || changed;
    } else if (alreadyQueued) {
      state.pendingRegions = state.pendingRegions.filter((item) => !item.systemIds.includes(systemId));
      changed = true;
    }
  }

  if (cycleAccepted) {
    state.lastCycleRequestedAt = new Date(now).toISOString();
    changed = true;
  }
  if (changed) await saveKillmailState(state);
  void serviceKillmailQueue();
  return makeKillmailStatus(state, cycleAccepted);
}
export async function resumeKillmailRefreshQueue() {
  const state = await getKillmailState();
  if (!state.pendingBackfills.length && !state.pendingRegions.length) return makeKillmailStatus(state);
  void serviceKillmailQueue();
  return makeKillmailStatus(state);
}

function windowSummary(samples: ActivitySample[], milliseconds: number, now = Date.now()) {
  const cutoff = now - milliseconds;
  const scoped = samples.filter((item) => Date.parse(item.capturedAt) >= cutoff);
  const first = scoped[0] ?? null;
  const last = scoped.at(-1) ?? null;
  return {
    samples: scoped.length,
    first,
    last,
    delta:
      first && last && first !== last
        ? {
            shipKills: last.shipKills - first.shipKills,
            podKills: last.podKills - first.podKills,
            npcKills: last.npcKills - first.npcKills,
            jumps: last.jumps - first.jumps,
          }
        : null,
  };
}

export function buildSystemActivityWindows(history: ActivitySample[], now = Date.now()) {
  return {
    "1h": windowSummary(history, 60 * 60 * 1000, now),
    "24h": windowSummary(history, 24 * 60 * 60 * 1000, now),
    "7d": windowSummary(history, 7 * 24 * 60 * 60 * 1000, now),
    "30d": windowSummary(history, 30 * 24 * 60 * 60 * 1000, now),
  };
}

export async function searchSolarSystems(query: string, limit = 20) {
  const index = await getPveStaticIndex();
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  return [...index.systems.values()]
    .filter((system) => system.name.toLowerCase().includes(needle))
    .sort((a, b) =>
      a.name.toLowerCase() === needle
        ? -1
        : b.name.toLowerCase() === needle
          ? 1
          : a.name.localeCompare(b.name),
    )
    .slice(0, limit);
}

function collectSnapshotEvidence(systemId: number, snapshots: any[]) {
  const knownStructures = new Map<string, SystemIntelligence["knownStructures"][number]>();
  const localCorporations = new Map<number, { corporationId: number; name: string; evidence: string }>();
  const connectedKillmails: KillmailIntel[] = [];

  for (const snapshot of snapshots) {
    const corp = snapshot?.extended?.corporation ?? {};
    for (const structure of Array.isArray(corp.structures) ? corp.structures : []) {
      if (Number(structure.system_id ?? structure.solar_system_id) !== systemId) continue;
      const ownerId = Number(snapshot?.character?.corporation_id ?? 0) || undefined;
      const ownerName = snapshot?.character?.corporation_name;
      knownStructures.set(String(structure.structure_id ?? structure.name), {
        structureId: Number(structure.structure_id) || undefined,
        name: String(structure.name ?? `Structure ${structure.structure_id ?? "unknown"}`),
        typeId: Number(structure.type_id) || undefined,
        ownerId,
        ownerName,
        source: `Corporation structures via ${snapshot?.character?.name ?? "connected character"}`,
      });
      if (ownerId) {
        localCorporations.set(ownerId, {
          corporationId: ownerId,
          name: String(ownerName ?? `Corporation ${ownerId}`),
          evidence: "Own corporation structure captured by ESI",
        });
      }
    }

    const details = Array.isArray(snapshot?.extended?.killmailDetails)
      ? snapshot.extended.killmailDetails
      : [];
    for (const detail of details) {
      if (Number(detail?.solar_system_id) !== systemId) continue;
      const killmailId = Number(detail.killmail_id);
      if (!killmailId) continue;
      connectedKillmails.push({
        killmailId,
        killmailTime: detail.killmail_time,
        solarSystemId: systemId,
        victim: detail.victim,
        attackers: detail.attackers,
        source: "connected character",
        sourceCharacter: snapshot?.character?.name,
      });
    }
  }

  return {
    knownStructures: [...knownStructures.values()],
    localCorporations: [...localCorporations.values()],
    connectedKillmails,
  };
}

async function composeSystemIntelligence(
  systemId: number,
  snapshots: any[],
  current: ActivitySample,
  history: ActivitySample[],
  state: KillmailState,
  discoveredStructures: SystemIntelligence["knownStructures"] = [],
): Promise<SystemIntelligence> {
  const index = await getPveStaticIndex();
  const system = index.systems.get(systemId);
  if (!system) throw new Error("Unknown solar system.");

  const evidence = collectSnapshotEvidence(systemId, snapshots);
  const knownStructureMap = new Map<string, SystemIntelligence["knownStructures"][number]>();
  const mergeStructure = (item: SystemIntelligence["knownStructures"][number]) => {
    const key = String(item.structureId ?? (item.name + "|" + (item.ownerId ?? "")));
    const existing = knownStructureMap.get(key);
    if (!existing) { knownStructureMap.set(key, { ...item }); return; }
    if (!existing.ownerId && item.ownerId) existing.ownerId = item.ownerId;
    if (!existing.ownerName && item.ownerName) existing.ownerName = item.ownerName;
    if (!existing.typeId && item.typeId) existing.typeId = item.typeId;
    if (!existing.source.includes(item.source)) existing.source += " · " + item.source;
  };
  for (const item of evidence.knownStructures) mergeStructure(item);
  for (const item of discoveredStructures) mergeStructure(item);
  const knownStructures = [...knownStructureMap.values()];
  const cache = state.systems[String(systemId)] ?? { killmails: [] };
  const killmailById = new Map<number, KillmailIntel>();
  for (const item of cleanKillmailCache(cache.killmails ?? [])) killmailById.set(item.killmailId, item);
  for (const item of evidence.connectedKillmails) {
    if (!killmailById.has(item.killmailId)) killmailById.set(item.killmailId, item);
  }
  const killmails = cleanKillmailCache([...killmailById.values()]);
  const queued = killmailSystemQueued(state, systemId);
  const globalStatus = makeKillmailStatus(state);
  const localCorporations = await buildLocalCorporations(systemId, snapshots, knownStructures, killmails);
  const ownerNames = new Map(localCorporations.map((corp) => [corp.corporationId, corp.name]));
  for (const structure of knownStructures) if (!structure.ownerName && structure.ownerId) structure.ownerName = ownerNames.get(structure.ownerId);

  const limitations = [
    "Killmail data is cached locally without age-based pruning. zKillboard requests share one conservative spaced scheduler; recent System News/single-system work is prioritised ahead of Navigation background enrichment, while recent results remain cached for five minutes.",
    "A newly requested system is backfilled from zKillboard system/month pages covering the previous 30 days, then recent one-hour region discovery keeps extending the same persistent archive.",
    "ESI does not provide a public enumeration of all Upwell structures, corporation offices, or player corporations present in a system. Known structures and corporations are evidence-based from data Sage can legitimately see.",
    "Cosmic anomalies and signatures are not exposed by ESI. Sage will not invent them.",
    history.length < 2
      ? "Historical activity comparisons begin accumulating after Sage observes this requested system more than once."
      : "Historical activity is based on Sage's locally retained observations.",
  ];
  if (globalStatus.lastError) limitations.unshift(`Last public killmail refresh warning: ${globalStatus.lastError}.`);

  return {
    system: {
      systemId,
      name: system.name,
      regionId: system.regionId,
      regionName: system.regionName,
      constellationName: system.constellationName,
      securityStatus: system.securityStatus,
      securityBand: system.securityBand,
    },
    current,
    history,
    windows: buildSystemActivityWindows(history),
    knownStructures,
    localCorporations,
    killmails,
    killmailRefresh: {
      lastUpdatedAt: cache.updatedAt ?? null,
      queued,
      global: globalStatus,
    },
    limitations,
  };
}

export type SystemIntelligenceRefreshOptions = {
  caller?: "watch" | "route" | "single";
  discoverStructures?: boolean;
  deepKillmailBackfill?: boolean;
  forceActivity?: boolean;
};

export async function refreshSystemIntelligence(systemIds: number[], snapshots: any[], options: SystemIntelligenceRefreshOptions = {}) {
  const index = await getPveStaticIndex();
  const uniqueSystemIds = [
    ...new Set(systemIds.map(Number).filter((id) => Number.isInteger(id) && index.systems.has(id))),
  ];
  if (!uniqueSystemIds.length) return { systems: [], killmailRefresh: makeKillmailStatus(await getKillmailState()), activityFetchedAt: null };

  const structureDiscoveryPromise = options.discoverStructures === false
    ? Promise.resolve(new Map<number, SystemIntelligence["knownStructures"]>())
    : discoverStructuresForSystems(uniqueSystemIds, snapshots);
  const [activityFeed, allHistory] = await Promise.all([getSharedActivityFeed(Boolean(options.forceActivity)), loadHistory()]);
  const killsBySystem = new Map(activityFeed.kills.map((item) => [item.system_id, item]));
  const jumpsBySystem = new Map(activityFeed.jumps.map((item) => [item.system_id, item]));
  const activityBySystem = new Map<number, { current: ActivitySample; history: ActivitySample[] }>();
  const now = Date.now();

  for (const systemId of uniqueSystemIds) {
    const kill = killsBySystem.get(systemId);
    const jump = jumpsBySystem.get(systemId);
    const current: ActivitySample = {
      capturedAt: activityFeed.fetchedAt,
      shipKills: kill?.ship_kills ?? 0,
      podKills: kill?.pod_kills ?? 0,
      npcKills: kill?.npc_kills ?? 0,
      jumps: jump?.ship_jumps ?? 0,
    };
    const prior = allHistory[String(systemId)] ?? [];
    const history = [...prior, current]
      .filter((item) => parseTime(item.capturedAt) >= now - 31 * 24 * 60 * 60 * 1000)
      .filter((item, itemIndex, array) => itemIndex === array.length - 1 || Math.abs(parseTime(array[itemIndex + 1].capturedAt) - parseTime(item.capturedAt)) >= 5 * 60 * 1000);
    allHistory[String(systemId)] = history;
    activityBySystem.set(systemId, { current, history });
  }
  await saveHistory(allHistory);

  const deepBackfill = deepKillmailBackfillForCaller(options.caller, options.deepKillmailBackfill);
  const killmailRefresh = await requestKillmailRefreshCycle(uniqueSystemIds, { deepBackfill, caller: options.caller });
  const [state, discoveredBySystem] = await Promise.all([getKillmailState(), structureDiscoveryPromise]);
  const systems = await Promise.all(uniqueSystemIds.map((systemId) => {
    const activity = activityBySystem.get(systemId)!;
    return composeSystemIntelligence(systemId, snapshots, activity.current, activity.history, state, discoveredBySystem.get(systemId) ?? []);
  }));
  return { systems, killmailRefresh, activityFetchedAt: activityFeed.fetchedAt };
}

export async function refreshWatchedSystemIntelligence(systemIds: number[], snapshots: any[]) {
  return refreshSystemIntelligence(systemIds, snapshots, { caller: "watch", discoverStructures: true, deepKillmailBackfill: true });
}

export async function getSystemIntelligence(systemId: number, snapshots: any[]) {
  const result = await refreshSystemIntelligence([systemId], snapshots, { caller: "single", discoverStructures: true, deepKillmailBackfill: true });
  const system = result.systems[0];
  if (!system) throw new Error("Unknown solar system.");
  return system;
}
