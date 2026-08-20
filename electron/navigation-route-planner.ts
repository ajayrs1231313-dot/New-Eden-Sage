import { randomUUID } from "node:crypto";
import {
  calculateNavigationRoute,
  getNavigationSystem,
  validateNavigationExactPath,
  type NavigationEdgeType,
  type NavigationRouteEdge,
  type NavigationRouteMode,
  type NavigationSystemNode,
} from "./universe-route-graph";

export const NAVIGATION_ROUTE_SCHEMA_VERSION = 4;

export type NavigationRouteProfile = {
  mode: NavigationRouteMode;
  minSecurity: number | null;
  avoids: { systemIds: number[]; constellationIds: number[]; regionIds: number[] };
  dynamicHazards: { providerIds: string[]; excludedSystemIds: number[]; snapshotAt?: string };
  specialConnections: { enabledTypes: NavigationEdgeType[]; disabledNetworkIds: string[] };
};

export type NavigationLockedSegment = {
  lockId: string;
  fromSystemId: number;
  toSystemId: number;
  systemIds: number[];
  createdAt?: string;
};

export type NavigationCustomConnection = {
  connectionId: string;
  fromSystemId: number;
  toSystemId: number;
  type: NavigationEdgeType;
  enabled: boolean;
  bidirectional: boolean;
  label?: string;
  networkId?: string;
  networkName?: string;
  ownerId?: number;
  ownerName?: string;
  access?: string;
  discoveredAt?: string;
  expiresAt?: string;
  connectionClass?: string;
  status?: "active" | "expiring" | "expired" | "unknown";
  maxJumpMassKg?: number;
  remainingMassKg?: number;
  shipRestriction?: string;
  metadata?: Record<string, string | number | boolean | null>;
};

export type NavigationRouteSegment = {
  segmentId: string;
  fromWaypointIndex: number;
  toWaypointIndex: number;
  fromSystemId: number;
  toSystemId: number;
  locked: boolean;
  lockId?: string;
  manual: boolean;
  found: boolean;
  reason?: string;
  jumps: number;
  totalWeight: number;
  systems: NavigationSystemNode[];
  legs: NavigationRouteEdge[];
};

export type NavigationWaypointAnnotation = { label?: string; note?: string };

export type NavigationRoutePlan = {
  schemaVersion: number;
  routeId: string;
  name: string;
  notes: string;
  waypointAnnotations: Record<string, NavigationWaypointAnnotation>;
  found: boolean;
  reason?: string;
  origin: NavigationSystemNode | null;
  destination: NavigationSystemNode | null;
  waypoints: NavigationSystemNode[];
  systems: NavigationSystemNode[];
  legs: NavigationRouteEdge[];
  segments: NavigationRouteSegment[];
  lockedSegments: NavigationLockedSegment[];
  customConnections: NavigationCustomConnection[];
  routingProfile: NavigationRouteProfile;
  totals: {
    jumps: number;
    totalWeight: number;
    minimumSecurityStatus: number;
    minimumDisplayedSecurityStatus: number;
    securityTransitions: number;
    regionCount: number;
    edgeTypes: Record<NavigationEdgeType, number>;
  };
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type NavigationPlanInput = {
  routeId?: string;
  name?: string;
  createdAt?: string;
  version?: number;
  notes?: string;
  waypointAnnotations?: Record<string, NavigationWaypointAnnotation>;
  waypointSystemIds: number[];
  lockedSegments?: NavigationLockedSegment[];
  customConnections?: NavigationCustomConnection[];
  profile?: Partial<NavigationRouteProfile> & {
    avoids?: Partial<NavigationRouteProfile["avoids"]>;
    dynamicHazards?: Partial<NavigationRouteProfile["dynamicHazards"]>;
    specialConnections?: Partial<NavigationRouteProfile["specialConnections"]>;
  };
};

const edgeTypes: NavigationEdgeType[] = ["gate", "ansiblex", "wormhole", "thera", "turnur", "zarzakh", "jump-drive", "manual"];
const routeSpecialEdgeTypes: NavigationEdgeType[] = ["ansiblex", "wormhole", "thera", "turnur", "zarzakh", "manual"];

function numericIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))];
}

function normalizeProfile(profile?: NavigationPlanInput["profile"]): NavigationRouteProfile {
  const mode = profile?.mode === "safer" || profile?.mode === "less-secure" || profile?.mode === "high-sec" ? profile.mode : "shortest";
  const floor = profile?.minSecurity == null ? null : Number(profile.minSecurity);
  const minSecurity = floor == null || !Number.isFinite(floor) ? null : Math.max(-1, Math.min(1, Math.round(floor * 10) / 10));
  return {
    mode,
    minSecurity,
    avoids: {
      systemIds: numericIds(profile?.avoids?.systemIds),
      constellationIds: numericIds(profile?.avoids?.constellationIds),
      regionIds: numericIds(profile?.avoids?.regionIds),
    },
    dynamicHazards: {
      providerIds: Array.isArray(profile?.dynamicHazards?.providerIds) ? [...new Set(profile.dynamicHazards.providerIds.map(String).filter(Boolean))] : [],
      excludedSystemIds: numericIds(profile?.dynamicHazards?.excludedSystemIds),
      snapshotAt: profile?.dynamicHazards?.snapshotAt ? String(profile.dynamicHazards.snapshotAt) : undefined,
    },
    specialConnections: {
      enabledTypes: Array.isArray(profile?.specialConnections?.enabledTypes)
        ? [...new Set(profile.specialConnections.enabledTypes.filter((type): type is NavigationEdgeType => routeSpecialEdgeTypes.includes(type as NavigationEdgeType)))]
        : [...routeSpecialEdgeTypes],
      disabledNetworkIds: Array.isArray(profile?.specialConnections?.disabledNetworkIds)
        ? [...new Set(profile.specialConnections.disabledNetworkIds.map(String).filter(Boolean))]
        : [],
    },
  };
}

function normalizeLockedSegments(value: unknown): NavigationLockedSegment[] {
  if (!Array.isArray(value)) return [];
  const rows: NavigationLockedSegment[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Partial<NavigationLockedSegment>;
    const systemIds = numericIds(row.systemIds);
    const fromSystemId = Number(row.fromSystemId ?? systemIds[0]);
    const toSystemId = Number(row.toSystemId ?? systemIds.at(-1));
    if (systemIds.length < 2 || systemIds[0] !== fromSystemId || systemIds.at(-1) !== toSystemId) continue;
    rows.push({ lockId: String(row.lockId || `lock-${randomUUID()}`), fromSystemId, toSystemId, systemIds, createdAt: row.createdAt ? String(row.createdAt) : undefined });
  }
  return rows;
}

function normalizeCustomConnections(value: unknown): NavigationCustomConnection[] {
  if (!Array.isArray(value)) return [];
  const allowed = new Set<NavigationEdgeType>(edgeTypes);
  const rows: NavigationCustomConnection[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Partial<NavigationCustomConnection>;
    const fromSystemId = Number(row.fromSystemId); const toSystemId = Number(row.toSystemId);
    if (!Number.isSafeInteger(fromSystemId) || !Number.isSafeInteger(toSystemId) || fromSystemId <= 0 || toSystemId <= 0 || fromSystemId === toSystemId) continue;
    rows.push({
      connectionId: String(row.connectionId || `connection-${randomUUID()}`),
      fromSystemId,
      toSystemId,
      type: allowed.has(row.type as NavigationEdgeType) ? row.type as NavigationEdgeType : "manual",
      enabled: row.enabled !== false,
      bidirectional: row.bidirectional !== false,
      label: row.label ? String(row.label) : undefined,
      networkId: row.networkId ? String(row.networkId) : undefined,
      networkName: row.networkName ? String(row.networkName) : undefined,
      ownerId: Number(row.ownerId ?? 0) > 0 ? Number(row.ownerId) : undefined,
      ownerName: row.ownerName ? String(row.ownerName) : undefined,
      access: row.access ? String(row.access) : undefined,
      discoveredAt: row.discoveredAt ? String(row.discoveredAt) : undefined,
      expiresAt: row.expiresAt ? String(row.expiresAt) : undefined,
      connectionClass: row.connectionClass ? String(row.connectionClass) : undefined,
      status: ["active", "expiring", "expired", "unknown"].includes(String(row.status)) ? row.status as NavigationCustomConnection["status"] : undefined,
      maxJumpMassKg: Number(row.maxJumpMassKg ?? 0) > 0 ? Number(row.maxJumpMassKg) : undefined,
      remainingMassKg: Number(row.remainingMassKg ?? 0) >= 0 && row.remainingMassKg != null ? Number(row.remainingMassKg) : undefined,
      shipRestriction: row.shipRestriction ? String(row.shipRestriction) : undefined,
      metadata: row.metadata && typeof row.metadata === "object" ? { ...row.metadata } : undefined,
    });
  }
  return rows;
}

function customConnectionUsable(connection: NavigationCustomConnection, profile: NavigationRouteProfile, now = Date.now()) {
  if (!connection.enabled || !profile.specialConnections.enabledTypes.includes(connection.type)) return false;
  if (connection.networkId && profile.specialConnections.disabledNetworkIds.includes(connection.networkId)) return false;
  const expiresAt = connection.expiresAt ? Date.parse(connection.expiresAt) : Number.NaN;
  if (connection.status === "expired" || (Number.isFinite(expiresAt) && expiresAt <= now)) return false;
  if ((connection.type === "thera" || connection.type === "wormhole") && !Number.isFinite(expiresAt)) return false;
  const access = String(connection.access ?? "").trim().toLowerCase();
  if (["blocked", "denied", "no access", "inaccessible"].includes(access)) return false;
  if (connection.metadata?.blocked === true || connection.metadata?.accessible === false) return false;
  return true;
}

export function activeNavigationCustomConnections(connections: NavigationCustomConnection[], profile: NavigationRouteProfile, now = Date.now()) {
  return connections.filter((connection) => customConnectionUsable(connection, profile, now));
}

function customEdges(connections: NavigationCustomConnection[], profile: NavigationRouteProfile) {
  const edges: NavigationRouteEdge[] = [];
  for (const connection of activeNavigationCustomConnections(connections, profile)) {
    const metadata = {
      connectionId: connection.connectionId, label: connection.label ?? null, networkId: connection.networkId ?? null, networkName: connection.networkName ?? null,
      ownerId: connection.ownerId ?? null, ownerName: connection.ownerName ?? null, access: connection.access ?? null, discoveredAt: connection.discoveredAt ?? null, expiresAt: connection.expiresAt ?? null,
      connectionClass: connection.connectionClass ?? null, status: connection.status ?? null, maxJumpMassKg: connection.maxJumpMassKg ?? null, remainingMassKg: connection.remainingMassKg ?? null,
      shipRestriction: connection.shipRestriction ?? null, ...(connection.metadata ?? {}),
    };
    edges.push({ from: connection.fromSystemId, to: connection.toSystemId, type: connection.type, metadata });
    if (connection.bidirectional) edges.push({ from: connection.toSystemId, to: connection.fromSystemId, type: connection.type, metadata });
  }
  return edges;
}

function emptyEdgeCounts() { return Object.fromEntries(edgeTypes.map((type) => [type, 0])) as Record<NavigationEdgeType, number>; }
function displaySecurity(value: number) { return Math.max(-1, Math.min(1, Math.round(Number(value) * 10) / 10)); }
function securityBand(value: number) { const security = displaySecurity(value); return security >= 0.5 ? "high" : security > 0 ? "low" : "null"; }

function planTotals(systems: NavigationSystemNode[], legs: NavigationRouteEdge[], totalWeight: number) {
  const edgeCounts = emptyEdgeCounts();
  for (const leg of legs) edgeCounts[leg.type] = (edgeCounts[leg.type] ?? 0) + 1;
  const minimumSecurityStatus = systems.length ? systems.reduce((value, system) => Math.min(value, system.securityStatus), 1) : -1;
  const minimumDisplayedSecurityStatus = systems.length ? systems.reduce((value, system) => Math.min(value, displaySecurity(system.securityStatus)), 1) : -1;
  let securityTransitions = 0;
  for (let index = 1; index < systems.length; index += 1) if (securityBand(systems[index - 1].securityStatus) !== securityBand(systems[index].securityStatus)) securityTransitions += 1;
  return { jumps: legs.length, totalWeight, minimumSecurityStatus, minimumDisplayedSecurityStatus, securityTransitions, regionCount: new Set(systems.map((system) => system.regionId)).size, edgeTypes: edgeCounts };
}

function routeArgs(profile: NavigationRouteProfile, edges: NavigationRouteEdge[]) {
  return {
    mode: profile.mode,
    minSecurity: profile.minSecurity,
    avoidSystemIds: profile.avoids.systemIds,
    avoidConstellationIds: profile.avoids.constellationIds,
    avoidRegionIds: profile.avoids.regionIds,
    excludedSystemIds: profile.dynamicHazards.excludedSystemIds,
    extraEdges: edges,
  };
}

function normalizeWaypointAnnotations(value: unknown): Record<string, NavigationWaypointAnnotation> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, NavigationWaypointAnnotation> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const systemId = Number(key);
    if (!Number.isSafeInteger(systemId) || systemId <= 0 || !raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const row = raw as Record<string, unknown>;
    const label = String(row.label ?? "").trim().slice(0, 80);
    const note = String(row.note ?? "").trim().slice(0, 1200);
    if (label || note) out[String(systemId)] = { label: label || undefined, note: note || undefined };
  }
  return out;
}

function makePlanBase(input: NavigationPlanInput, profile: NavigationRouteProfile, lockedSegments: NavigationLockedSegment[], customConnections: NavigationCustomConnection[], resolved: NavigationSystemNode[], now: string, routeId: string, createdAt: string, name: string, version: number) {
  return { schemaVersion: NAVIGATION_ROUTE_SCHEMA_VERSION, routeId, name, notes: String(input?.notes ?? "").slice(0, 6000), waypointAnnotations: normalizeWaypointAnnotations(input?.waypointAnnotations), origin: resolved[0] ?? null, destination: resolved.at(-1) ?? null, waypoints: resolved, lockedSegments, customConnections, routingProfile: profile, createdAt, updatedAt: now, version };
}

export async function calculateNavigationPlan(input: NavigationPlanInput): Promise<NavigationRoutePlan> {
  const profile = normalizeProfile(input?.profile);
  const waypointSystemIds = Array.isArray(input?.waypointSystemIds) ? input.waypointSystemIds.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0) : [];
  const lockedSegments = normalizeLockedSegments(input?.lockedSegments);
  const customConnections = normalizeCustomConnections(input?.customConnections);
  const extraEdges = customEdges(customConnections, profile);
  const now = new Date().toISOString();
  const routeId = String(input?.routeId || `nav-${randomUUID()}`);
  const createdAt = input?.createdAt ? String(input.createdAt) : now;
  const version = Math.max(1, Math.floor(Number(input?.version ?? 0)) + 1);

  const resolved: NavigationSystemNode[] = [];
  for (const systemId of waypointSystemIds) {
    const system = await getNavigationSystem(systemId);
    if (!system) {
      const name = String(input?.name || "Unresolved route");
      return { ...makePlanBase(input, profile, lockedSegments, customConnections, resolved, now, routeId, createdAt, name, version), found: false, reason: `System ${systemId} is not present in the local CCP universe graph.`, systems: [], legs: [], segments: [], totals: planTotals([], [], 0) };
    }
    resolved.push(system);
  }

  const origin = resolved[0] ?? null; const destination = resolved.at(-1) ?? null;
  const name = String(input?.name || (origin && destination ? `${origin.name} → ${destination.name}` : "New route"));
  const base = makePlanBase(input, profile, lockedSegments, customConnections, resolved, now, routeId, createdAt, name, version);
  if (resolved.length < 2) return { ...base, found: false, reason: "Add at least an origin and destination before calculating the route.", systems: resolved, legs: [], segments: [], totals: planTotals(resolved, [], 0) };

  const segments: NavigationRouteSegment[] = []; const systems: NavigationSystemNode[] = []; const legs: NavigationRouteEdge[] = []; let totalWeight = 0;
  for (let index = 0; index < resolved.length - 1; index += 1) {
    const from = resolved[index]; const to = resolved[index + 1];
    const lock = lockedSegments.find((row) => row.fromSystemId === from.systemId && row.toSystemId === to.systemId);
    const segment = lock
      ? await validateNavigationExactPath({ from: from.systemId, to: to.systemId, systemIds: lock.systemIds, ...routeArgs(profile, extraEdges) })
      : await calculateNavigationRoute({ from: from.systemId, to: to.systemId, ...routeArgs(profile, extraEdges) });
    const row: NavigationRouteSegment = {
      segmentId: `${routeId}:segment:${index}`,
      fromWaypointIndex: index,
      toWaypointIndex: index + 1,
      fromSystemId: from.systemId,
      toSystemId: to.systemId,
      locked: Boolean(lock),
      lockId: lock?.lockId,
      manual: segment.legs.some((leg) => leg.type !== "gate"),
      found: segment.found,
      reason: segment.reason,
      jumps: segment.jumps,
      totalWeight: segment.totalWeight,
      systems: segment.systems,
      legs: segment.legs,
    };
    segments.push(row);
    if (!segment.found) {
      const prefix = lock ? "Locked segment" : `Segment ${index + 1}`;
      return { ...base, found: false, reason: `${prefix} (${from.name} → ${to.name}) failed: ${segment.reason ?? "No valid route."}`, systems, legs, segments, totals: planTotals(systems, legs, totalWeight) };
    }
    totalWeight += segment.totalWeight;
    if (!systems.length) systems.push(...segment.systems); else systems.push(...segment.systems.slice(1));
    legs.push(...segment.legs);
  }

  return { ...base, found: true, systems, legs, segments, totals: planTotals(systems, legs, totalWeight) };
}
