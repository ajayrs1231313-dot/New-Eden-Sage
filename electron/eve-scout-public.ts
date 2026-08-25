import { getWormholeReference } from "./wormhole-reference";

const API_URL = "https://api.eve-scout.com/v2/public/signatures";
const CACHE_TTL_MS = 2 * 60_000;
const STALE_FALLBACK_MS = 30 * 60_000;

type EveScoutRow = {
  id?: number | string;
  signature_type?: string;
  out_system_id?: number;
  out_system_name?: string;
  out_signature?: string;
  in_system_id?: number;
  in_system_name?: string;
  in_region_name?: string;
  in_signature?: string;
  wh_type?: string;
  max_ship_size?: string;
  wh_exits_outward?: boolean;
  created_at?: string;
  updated_at?: string;
  expires_at?: string;
  remaining_hours?: number;
};

export type NavigationPublicWormholeConnection = {
  connectionId: string;
  fromSystemId: number;
  toSystemId: number;
  type: "thera" | "turnur";
  enabled: true;
  bidirectional: true;
  label: string;
  networkId: string;
  networkName: string;
  access: "public";
  discoveredAt?: string;
  expiresAt: string;
  connectionClass?: string;
  status: "active";
  maxJumpMassKg?: number;
  shipRestriction?: string;
  metadata: Record<string, string | number | boolean | null>;
};

export type NavigationPublicWormholeSnapshot = {
  source: "EVE-Scout v2 public signatures";
  sourceUrl: string;
  fetchedAt: string;
  stale: boolean;
  connections: NavigationPublicWormholeConnection[];
  rawCount: number;
  rejectedCount: number;
  error?: string;
};

let cache: { fetchedAtMs: number; snapshot: NavigationPublicWormholeSnapshot } | undefined;

function rowsFromPayload(payload: unknown): EveScoutRow[] {
  if (Array.isArray(payload)) return payload as EveScoutRow[];
  if (!payload || typeof payload !== "object") return [];
  const row = payload as Record<string, unknown>;
  for (const key of ["data", "signatures", "results", "items"]) {
    if (Array.isArray(row[key])) return row[key] as EveScoutRow[];
  }
  return [];
}

function isoOrUndefined(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return undefined;
  const ms = Date.parse(text);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
}

function hubType(row: EveScoutRow): "thera" | "turnur" | null {
  const names = `${row.out_system_name ?? ""} ${row.in_system_name ?? ""}`.toLowerCase();
  if (names.includes("thera")) return "thera";
  if (names.includes("turnur")) return "turnur";
  const signatureType = String(row.signature_type ?? "").toLowerCase();
  if (signatureType.includes("thera")) return "thera";
  if (signatureType.includes("turnur")) return "turnur";
  return null;
}

function normalizeWhCode(value: unknown) {
  const code = String(value ?? "").trim().toUpperCase();
  return /^[A-Z]\d{3}$/.test(code) || code === "K162" ? code : undefined;
}

async function mapRows(rows: EveScoutRow[]) {
  const reference = new Map((await getWormholeReference()).map((entry) => [entry.code, entry]));
  const now = Date.now();
  const connections: NavigationPublicWormholeConnection[] = [];
  let rejectedCount = 0;
  for (const row of rows) {
    const fromSystemId = Number(row.out_system_id ?? 0);
    const toSystemId = Number(row.in_system_id ?? 0);
    const type = hubType(row);
    const expiresAt = isoOrUndefined(row.expires_at);
    if (!type || !Number.isSafeInteger(fromSystemId) || fromSystemId <= 0 || !Number.isSafeInteger(toSystemId) || toSystemId <= 0 || fromSystemId === toSystemId || !expiresAt || Date.parse(expiresAt) <= now) {
      rejectedCount += 1;
      continue;
    }
    const whType = normalizeWhCode(row.wh_type);
    const wh = whType ? reference.get(whType) : undefined;
    const rowId = String(row.id ?? `${fromSystemId}-${toSystemId}-${row.out_signature ?? ""}-${row.in_signature ?? ""}`);
    const networkName = type === "thera" ? "EVE-Scout Thera" : "EVE-Scout Turnur";
    connections.push({
      connectionId: `eve-scout:${type}:${rowId}`,
      fromSystemId,
      toSystemId,
      type,
      enabled: true,
      bidirectional: true,
      label: `${networkName}: ${row.out_system_name ?? fromSystemId} ↔ ${row.in_system_name ?? toSystemId}`,
      networkId: `eve-scout-${type}`,
      networkName,
      access: "public",
      discoveredAt: isoOrUndefined(row.created_at) ?? isoOrUndefined(row.updated_at),
      expiresAt,
      connectionClass: whType,
      status: "active",
      maxJumpMassKg: wh?.maxJumpMassKg ?? undefined,
      shipRestriction: row.max_ship_size ? String(row.max_ship_size) : undefined,
      metadata: {
        source: "eve-scout-v2",
        public: true,
        wormholeTransit: true,
        hub: type,
        outSystemName: row.out_system_name ?? null,
        inSystemName: row.in_system_name ?? null,
        inRegionName: row.in_region_name ?? null,
        outSignature: row.out_signature ?? null,
        inSignature: row.in_signature ?? null,
        wormholeType: whType ?? null,
        maxShipSize: row.max_ship_size ?? null,
        exitsOutward: row.wh_exits_outward == null ? null : Boolean(row.wh_exits_outward),
        remainingHours: Number.isFinite(Number(row.remaining_hours)) ? Number(row.remaining_hours) : null,
        updatedAt: isoOrUndefined(row.updated_at) ?? null,
      },
    });
  }
  return { connections, rejectedCount };
}

export async function getNavigationPublicWormholes(force = false): Promise<NavigationPublicWormholeSnapshot> {
  const now = Date.now();
  if (!force && cache && now - cache.fetchedAtMs < CACHE_TTL_MS) return cache.snapshot;
  try {
    const response = await fetch(API_URL, { headers: { Accept: "application/json", "User-Agent": "New-Eden-Sage/1.1 public-wormhole-routing" }, signal: AbortSignal.timeout(12_000) });
    if (!response.ok) throw new Error(`EVE-Scout HTTP ${response.status}`);
    const rows = rowsFromPayload(await response.json());
    if (!rows.length) throw new Error("EVE-Scout returned no public signature rows.");
    const mapped = await mapRows(rows);
    const snapshot: NavigationPublicWormholeSnapshot = { source: "EVE-Scout v2 public signatures", sourceUrl: API_URL, fetchedAt: new Date().toISOString(), stale: false, connections: mapped.connections, rawCount: rows.length, rejectedCount: mapped.rejectedCount };
    cache = { fetchedAtMs: now, snapshot };
    return snapshot;
  } catch (error) {
    if (cache && now - cache.fetchedAtMs <= STALE_FALLBACK_MS) return { ...cache.snapshot, stale: true, error: error instanceof Error ? error.message : String(error) };
    return { source: "EVE-Scout v2 public signatures", sourceUrl: API_URL, fetchedAt: new Date().toISOString(), stale: true, connections: [], rawCount: 0, rejectedCount: 0, error: error instanceof Error ? error.message : String(error) };
  }
}
