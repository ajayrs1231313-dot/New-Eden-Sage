import AdmZip from "adm-zip";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { gzip, gunzip } from "node:zlib";
import { STATIC_DATA_ROOT } from "./data-paths";
import { ensureStaticDataArchive } from "./type-volumes";

const SDE_ARCHIVE = path.join(STATIC_DATA_ROOT, "eve-static-data-jsonl.zip");
const NAVIGATION_GRAPH_CACHE = path.join(STATIC_DATA_ROOT, "navigation-universe-graph-v1.json.gz");
const NAVIGATION_GRAPH_SCHEMA = 2;
const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

export type NavigationRouteMode = "shortest" | "safer" | "less-secure" | "high-sec";

export type NavigationSystemNode = {
  systemId: number;
  name: string;
  securityStatus: number;
  constellationId: number;
  constellationName: string;
  regionId: number;
  regionName: string;
  position: { x: number; y: number; z: number };
  position2D?: { x: number; y: number };
};

export type NavigationEdgeType = "gate" | "ansiblex" | "wormhole" | "thera" | "turnur" | "zarzakh" | "jump-drive" | "manual";

export type NavigationRouteEdge = {
  from: number;
  to: number;
  type: NavigationEdgeType;
  gateId?: number;
  destinationGateId?: number;
  gatePosition?: { x: number; y: number; z: number };
  metadata?: Record<string, string | number | boolean | null>;
};

export type NavigationRouteInput = {
  from: number;
  to: number;
  mode?: NavigationRouteMode;
  minSecurity?: number | null;
  avoidSystemIds?: number[];
  avoidConstellationIds?: number[];
  avoidRegionIds?: number[];
  excludedSystemIds?: number[];
  extraEdges?: NavigationRouteEdge[];
};

export type NavigationRouteResult = {
  found: boolean;
  reason?: string;
  mode: NavigationRouteMode;
  minSecurity: number | null;
  totalWeight: number;
  jumps: number;
  minimumSecurityStatus: number;
  minimumDisplayedSecurityStatus: number;
  securityTransitions: number;
  regionCount: number;
  systems: NavigationSystemNode[];
  legs: NavigationRouteEdge[];
};

type RouteValue = {
  jumps: number;
  minimumSecurityStatus: number;
};

type PersistedNavigationGraph = {
  schema: number;
  archive: { size: number; mtimeMs: number };
  preparedAt: string;
  nodes: NavigationSystemNode[];
  edges: NavigationRouteEdge[];
};

type UniverseGraph = {
  nodes: Map<number, NavigationSystemNode>;
  neighbours: Map<number, NavigationRouteEdge[]>;
  simpleNeighbours: Map<number, number[]>;
  routes: Map<number, Map<number, RouteValue>>;
  edgeCount: number;
  preparedAt: string;
  source: "cache" | "sde";
};

let graphPromise: Promise<UniverseGraph> | undefined;

export async function universeRoute(from: number, to: number): Promise<RouteValue> {
  if (from === to) {
    const graph = await loadGraph();
    return { jumps: 0, minimumSecurityStatus: graph.nodes.get(from)?.securityStatus ?? 1 };
  }
  const graph = await loadGraph();
  if (!graph.simpleNeighbours.has(from) || !graph.simpleNeighbours.has(to))
    return { jumps: 999, minimumSecurityStatus: -1 };
  let routes = graph.routes.get(from);
  if (!routes) {
    routes = breadthFirstRoutes(from, graph.simpleNeighbours, graph.nodes);
    graph.routes.set(from, routes);
  }
  return routes.get(to) ?? { jumps: 999, minimumSecurityStatus: -1 };
}

export async function prepareUniverseRouteGraph() {
  const graph = await loadGraph();
  return { systems: graph.nodes.size };
}

export async function prepareNavigationUniverseGraph() {
  const graph = await loadGraph();
  return {
    systems: graph.nodes.size,
    edges: graph.edgeCount,
    preparedAt: graph.preparedAt,
    source: graph.source,
    cachePath: NAVIGATION_GRAPH_CACHE,
  };
}

export async function searchNavigationSystems(query: string, limit = 20) {
  const graph = await loadGraph();
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const max = Math.max(1, Math.min(100, Math.floor(Number(limit) || 20)));
  return [...graph.nodes.values()]
    .map((system) => {
      const name = system.name.toLowerCase();
      const rank = name === needle ? 0 : name.startsWith(needle) ? 1 : name.includes(needle) ? 2 : 99;
      return { system, rank };
    })
    .filter((item) => item.rank < 99)
    .sort((a, b) => a.rank - b.rank || a.system.name.localeCompare(b.system.name))
    .slice(0, max)
    .map((item) => item.system);
}

export async function getNavigationSystem(systemId: number) {
  const graph = await loadGraph();
  return graph.nodes.get(Number(systemId)) ?? null;
}

export async function getNavigationNeighbours(systemId: number) {
  const graph = await loadGraph();
  return (graph.neighbours.get(Number(systemId)) ?? []).map((edge) => ({ edge, system: graph.nodes.get(edge.to) })).filter((item): item is { edge: NavigationRouteEdge; system: NavigationSystemNode } => Boolean(item.system));
}

export async function getNavigationStargates(systemId: number) {
  const graph = await loadGraph();
  const id = Number(systemId);
  return (graph.neighbours.get(id) ?? [])
    .filter((edge) => edge.type === "gate" && edge.gateId && edge.gatePosition)
    .map((edge) => ({
      gateId: Number(edge.gateId),
      destinationGateId: edge.destinationGateId == null ? undefined : Number(edge.destinationGateId),
      systemId: id,
      destinationSystemId: edge.to,
      destinationSystemName: graph.nodes.get(edge.to)?.name ?? `System ${edge.to}`,
      position: edge.gatePosition!,
    }));
}

export async function getNavigationMapData(input?: { scope?: "universe" | "region"; regionId?: number | null }) {
  const graph = await loadGraph();
  const scope = input?.scope === "region" ? "region" : "universe";
  const requestedRegionId = Number(input?.regionId ?? 0);
  const regionId = scope === "region" && Number.isSafeInteger(requestedRegionId) && requestedRegionId > 0 ? requestedRegionId : null;
  const systems = [...graph.nodes.values()].filter((system) => regionId == null || system.regionId === regionId);
  const allowed = new Set(systems.map((system) => system.systemId));
  const edges: NavigationRouteEdge[] = [];
  const seen = new Set<string>();
  for (const system of systems) {
    for (const edge of graph.neighbours.get(system.systemId) ?? []) {
      if (edge.type !== "gate" || !allowed.has(edge.to)) continue;
      const low = Math.min(edge.from, edge.to);
      const high = Math.max(edge.from, edge.to);
      const key = low + "-" + high;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push(edge);
    }
  }
  const regionMap = new Map<number, string>();
  for (const system of graph.nodes.values()) regionMap.set(system.regionId, system.regionName);
  const regions = [...regionMap.entries()]
    .map(([id, name]) => ({ regionId: id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { scope, regionId, systems, edges, regions };
}

export async function calculateNavigationRoute(input: NavigationRouteInput): Promise<NavigationRouteResult> {
  const graph = await loadGraph();
  const from = Number(input?.from ?? 0);
  const to = Number(input?.to ?? 0);
  const mode = normalizeRouteMode(input?.mode);
  const requestedFloor = normalizeSecurityFloor(input?.minSecurity);
  const minSecurity = mode === "high-sec" ? Math.max(0.5, requestedFloor ?? 0.5) : requestedFloor;
  const origin = graph.nodes.get(from);
  const destination = graph.nodes.get(to);
  const exclusions = normalizeExclusions(input);
  const extraNeighbours = normalizeExtraEdges(input?.extraEdges, graph.nodes);

  if (!origin || !destination)
    return emptyNavigationRoute(mode, minSecurity, "Choose two solar systems that exist in the local CCP universe graph.");
  if (!securityAllowed(origin.securityStatus, minSecurity))
    return emptyNavigationRoute(mode, minSecurity, `${origin.name} is below the selected minimum security floor.`);
  if (!securityAllowed(destination.securityStatus, minSecurity))
    return emptyNavigationRoute(mode, minSecurity, `${destination.name} is below the selected minimum security floor.`);
  const originExcluded = exclusionReason(origin, exclusions);
  if (originExcluded) return emptyNavigationRoute(mode, minSecurity, `${origin.name} is excluded by ${originExcluded}.`);
  const destinationExcluded = exclusionReason(destination, exclusions);
  if (destinationExcluded) return emptyNavigationRoute(mode, minSecurity, `${destination.name} is excluded by ${destinationExcluded}.`);
  if (from === to) return finishNavigationRoute([origin], [], mode, minSecurity, 0);

  const distance = new Map([[from, 0]]);
  const previous = new Map();
  const heap = new MinHeap();
  heap.push({ id: from, cost: 0 });

  while (heap.size) {
    const current = heap.pop();
    if (!current || current.cost !== distance.get(current.id)) continue;
    if (current.id === to) break;
    for (const edge of [...(graph.neighbours.get(current.id) ?? []), ...(extraNeighbours.get(current.id) ?? [])]) {
      const nextNode = graph.nodes.get(edge.to);
      if (!nextNode || !securityAllowed(nextNode.securityStatus, minSecurity) || exclusionReason(nextNode, exclusions)) continue;
      const nextCost = current.cost + routeEdgeWeight(nextNode.securityStatus, mode);
      if (nextCost + 1e-9 >= (distance.get(edge.to) ?? Number.POSITIVE_INFINITY)) continue;
      distance.set(edge.to, nextCost);
      previous.set(edge.to, { systemId: current.id, edge });
      heap.push({ id: edge.to, cost: nextCost });
    }
  }

  if (!distance.has(to)) {
    const constrained = exclusions.systemIds.size || exclusions.constellationIds.size || exclusions.regionIds.size || exclusions.dynamicSystemIds.size;
    const reason = constrained
      ? `No route satisfies the selected security and avoid/exclusion constraints between ${origin.name} and ${destination.name}.`
      : minSecurity == null
        ? `No stargate route was found between ${origin.name} and ${destination.name}.`
        : `No route satisfies the selected ${minSecurity.toFixed(1)}+ security floor.`;
    return emptyNavigationRoute(mode, minSecurity, reason);
  }

  const systemIds = [to];
  const legs = [];
  let cursor = to;
  while (cursor !== from) {
    const step = previous.get(cursor);
    if (!step) return emptyNavigationRoute(mode, minSecurity, "The route solver could not reconstruct the selected path.");
    legs.unshift(step.edge);
    cursor = step.systemId;
    systemIds.unshift(cursor);
  }
  const systems = systemIds.map((id) => graph.nodes.get(id)).filter((item): item is NavigationSystemNode => Boolean(item));
  return finishNavigationRoute(systems, legs, mode, minSecurity, distance.get(to) ?? legs.length);
}


export async function validateNavigationExactPath(input: NavigationRouteInput & { systemIds: number[] }): Promise<NavigationRouteResult> {
  const graph = await loadGraph();
  const ids = Array.isArray(input?.systemIds) ? input.systemIds.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0) : [];
  const mode = normalizeRouteMode(input?.mode);
  const requestedFloor = normalizeSecurityFloor(input?.minSecurity);
  const minSecurity = mode === "high-sec" ? Math.max(0.5, requestedFloor ?? 0.5) : requestedFloor;
  if (ids.length < 1) return emptyNavigationRoute(mode, minSecurity, "A locked path must contain at least one solar system.");
  const systems = ids.map((id) => graph.nodes.get(id));
  if (systems.some((system) => !system)) return emptyNavigationRoute(mode, minSecurity, "A locked path contains a solar system that is not present in the local CCP graph.");
  const resolved = systems as NavigationSystemNode[];
  const exclusions = normalizeExclusions(input);
  for (const system of resolved) {
    if (!securityAllowed(system.securityStatus, minSecurity)) return emptyNavigationRoute(mode, minSecurity, `${system.name} is below the selected minimum security floor, so the locked segment is invalid.`);
    const excluded = exclusionReason(system, exclusions);
    if (excluded) return emptyNavigationRoute(mode, minSecurity, `${system.name} is excluded by ${excluded}, so the locked segment is invalid.`);
  }
  const extraNeighbours = normalizeExtraEdges(input?.extraEdges, graph.nodes);
  const legs: NavigationRouteEdge[] = [];
  let totalWeight = 0;
  for (let index = 0; index < resolved.length - 1; index += 1) {
    const from = resolved[index];
    const to = resolved[index + 1];
    const candidates = [...(graph.neighbours.get(from.systemId) ?? []), ...(extraNeighbours.get(from.systemId) ?? [])];
    const edge = candidates.find((candidate) => candidate.to === to.systemId);
    if (!edge) return emptyNavigationRoute(mode, minSecurity, `Locked segment is invalid: ${from.name} has no enabled connection to ${to.name}.`);
    legs.push(edge);
    totalWeight += routeEdgeWeight(to.securityStatus, mode);
  }
  return finishNavigationRoute(resolved, legs, mode, minSecurity, totalWeight);
}

function normalizeExtraEdges(value: unknown, nodes: Map<number, NavigationSystemNode>) {
  const neighbours = new Map<number, NavigationRouteEdge[]>();
  if (!Array.isArray(value)) return neighbours;
  const allowedTypes = new Set<NavigationEdgeType>(["gate", "ansiblex", "wormhole", "thera", "turnur", "zarzakh", "jump-drive", "manual"]);
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as NavigationRouteEdge;
    const from = Number(row.from); const to = Number(row.to);
    if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from <= 0 || to <= 0 || from === to || !nodes.has(from) || !nodes.has(to)) continue;
    const type: NavigationEdgeType = allowedTypes.has(row.type) ? row.type : "manual";
    const edge: NavigationRouteEdge = { from, to, type, metadata: row.metadata && typeof row.metadata === "object" ? { ...row.metadata } : undefined };
    const list = neighbours.get(from) ?? [];
    if (!list.some((existing) => existing.to === to && existing.type === type)) list.push(edge);
    neighbours.set(from, list);
  }
  return neighbours;
}

async function loadGraph() {
  if (!graphPromise) graphPromise = buildGraph().catch((error) => {
    graphPromise = undefined;
    throw error;
  });
  return graphPromise;
}

async function buildGraph(): Promise<UniverseGraph> {
  await ensureStaticDataArchive();
  const archiveStat = await fs.stat(SDE_ARCHIVE);
  const archive = { size: archiveStat.size, mtimeMs: Math.round(archiveStat.mtimeMs) };
  const cached = await readPreparedGraph(archive);
  if (cached) return hydrateGraph(cached, "cache");

  const zip = new AdmZip(SDE_ARCHIVE);
  const systemsEntry = zip.getEntry("mapSolarSystems.jsonl");
  const constellationsEntry = zip.getEntry("mapConstellations.jsonl");
  const regionsEntry = zip.getEntry("mapRegions.jsonl");
  const gatesEntry = zip.getEntry("mapStargates.jsonl");
  if (!systemsEntry || !constellationsEntry || !regionsEntry || !gatesEntry)
    throw new Error("Official EVE static data is missing the universe records required by Navigation Command.");

  const regions = new Map<number, string>();
  for (const row of lineObjects<{ _key: number; name?: { en?: string } }>(regionsEntry.getData().toString("utf8")))
    regions.set(Number(row._key), String(row.name?.en ?? `Region ${row._key}`));

  const constellations = new Map<number, { name: string; regionId: number }>();
  for (const row of lineObjects<{ _key: number; name?: { en?: string }; regionID: number }>(constellationsEntry.getData().toString("utf8")))
    constellations.set(Number(row._key), { name: String(row.name?.en ?? `Constellation ${row._key}`), regionId: Number(row.regionID) });

  const nodes: NavigationSystemNode[] = [];
  for (const row of lineObjects<{
    _key: number;
    name?: { en?: string };
    securityStatus: number;
    constellationID: number;
    regionID: number;
    position?: { x?: number; y?: number; z?: number };
    position2D?: { x?: number; y?: number };
  }>(systemsEntry.getData().toString("utf8"))) {
    const constellation = constellations.get(Number(row.constellationID));
    const regionId = Number(row.regionID ?? constellation?.regionId ?? 0);
    nodes.push({
      systemId: Number(row._key),
      name: String(row.name?.en ?? `System ${row._key}`),
      securityStatus: Number(row.securityStatus ?? -1),
      constellationId: Number(row.constellationID ?? 0),
      constellationName: constellation?.name ?? `Constellation ${row.constellationID}`,
      regionId,
      regionName: regions.get(regionId) ?? `Region ${regionId}`,
      position: {
        x: Number(row.position?.x ?? 0),
        y: Number(row.position?.y ?? 0),
        z: Number(row.position?.z ?? 0),
      },
      position2D: row.position2D ? { x: Number(row.position2D.x ?? 0), y: Number(row.position2D.y ?? 0) } : undefined,
    });
  }
  const validSystems = new Set(nodes.map((item) => item.systemId));
  const edges: NavigationRouteEdge[] = [];
  for (const row of lineObjects<{
    _key: number;
    solarSystemID: number;
    destination?: { solarSystemID?: number; stargateID?: number };
    position?: { x?: number; y?: number; z?: number };
  }>(gatesEntry.getData().toString("utf8"))) {
    const from = Number(row.solarSystemID ?? 0);
    const to = Number(row.destination?.solarSystemID ?? 0);
    if (!validSystems.has(from) || !validSystems.has(to)) continue;
    edges.push({
      from,
      to,
      type: "gate",
      gateId: Number(row._key),
      destinationGateId: row.destination?.stargateID == null ? undefined : Number(row.destination.stargateID),
      gatePosition: row.position ? { x: Number(row.position.x ?? 0), y: Number(row.position.y ?? 0), z: Number(row.position.z ?? 0) } : undefined,
    });
  }

  const persisted: PersistedNavigationGraph = {
    schema: NAVIGATION_GRAPH_SCHEMA,
    archive,
    preparedAt: new Date().toISOString(),
    nodes,
    edges,
  };
  await writePreparedGraph(persisted).catch(() => undefined);
  return hydrateGraph(persisted, "sde");
}

async function readPreparedGraph(archive: { size: number; mtimeMs: number }) {
  try {
    const compressed = await fs.readFile(NAVIGATION_GRAPH_CACHE);
    const parsed = JSON.parse((await gunzipAsync(compressed)).toString("utf8")) as PersistedNavigationGraph;
    if (parsed.schema !== NAVIGATION_GRAPH_SCHEMA) return null;
    if (parsed.archive.size !== archive.size || Math.round(parsed.archive.mtimeMs) !== archive.mtimeMs) return null;
    if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges) || !parsed.nodes.length) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function writePreparedGraph(graph: PersistedNavigationGraph) {
  const temporary = `${NAVIGATION_GRAPH_CACHE}.${process.pid}.${Date.now()}.tmp`;
  const payload = await gzipAsync(Buffer.from(JSON.stringify(graph), "utf8"), { level: 6 });
  await fs.writeFile(temporary, payload);
  await fs.rm(NAVIGATION_GRAPH_CACHE, { force: true });
  await fs.rename(temporary, NAVIGATION_GRAPH_CACHE);
}

function hydrateGraph(persisted: PersistedNavigationGraph, source: "cache" | "sde"): UniverseGraph {
  const nodes = new Map(persisted.nodes.map((node) => [node.systemId, node]));
  const neighbours = new Map<number, NavigationRouteEdge[]>();
  const simpleNeighbours = new Map<number, number[]>();
  for (const id of nodes.keys()) {
    neighbours.set(id, []);
    simpleNeighbours.set(id, []);
  }
  for (const edge of persisted.edges) {
    if (!nodes.has(edge.from) || !nodes.has(edge.to)) continue;
    neighbours.get(edge.from)!.push(edge);
    simpleNeighbours.get(edge.from)!.push(edge.to);
  }
  return {
    nodes,
    neighbours,
    simpleNeighbours,
    routes: new Map(),
    edgeCount: persisted.edges.length,
    preparedAt: persisted.preparedAt,
    source,
  };
}

function* lineObjects<T>(text: string): Generator<T> {
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    yield JSON.parse(line) as T;
  }
}

type NormalizedRouteExclusions = {
  systemIds: Set<number>;
  constellationIds: Set<number>;
  regionIds: Set<number>;
  dynamicSystemIds: Set<number>;
};

function idSet(value: unknown) {
  return new Set(Array.isArray(value) ? value.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0) : []);
}

function normalizeExclusions(input: NavigationRouteInput): NormalizedRouteExclusions {
  return {
    systemIds: idSet(input?.avoidSystemIds),
    constellationIds: idSet(input?.avoidConstellationIds),
    regionIds: idSet(input?.avoidRegionIds),
    dynamicSystemIds: idSet(input?.excludedSystemIds),
  };
}

function exclusionReason(system: NavigationSystemNode, exclusions: NormalizedRouteExclusions) {
  if (exclusions.systemIds.has(system.systemId)) return "the system avoid list";
  if (exclusions.constellationIds.has(system.constellationId)) return `the avoided constellation ${system.constellationName}`;
  if (exclusions.regionIds.has(system.regionId)) return `the avoided region ${system.regionName}`;
  if (exclusions.dynamicSystemIds.has(system.systemId)) return "an enabled dynamic hazard exclusion";
  return "";
}

function normalizeRouteMode(value: unknown): NavigationRouteMode {
  return value === "safer" || value === "less-secure" || value === "high-sec" ? value : "shortest";
}

function normalizeSecurityFloor(value: unknown) {
  if (value == null || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(-1, Math.min(1, Math.round(numeric * 10) / 10)) : null;
}

export function displayedSecurityStatus(value: number) {
  return Math.max(-1, Math.min(1, Math.round(Number(value) * 10) / 10));
}

function securityAllowed(raw: number, floor: number | null) {
  return floor == null || displayedSecurityStatus(raw) >= floor - 1e-9;
}

function routeEdgeWeight(rawSecurity: number, mode: NavigationRouteMode) {
  const security = displayedSecurityStatus(rawSecurity);
  if (mode === "shortest" || mode === "high-sec") return 1;
  if (mode === "safer") {
    // Safer is a preference, not a hard security floor. Make low-sec expensive enough
    // that an all-high-sec route wins when one exists, while still permitting low/null
    // when no safer connected path is available.
    const lowSecurityPenalty = security < 0.5 ? 100 + Math.max(0, 0.5 - security) * 25 : 0;
    const qualityPenalty = Math.max(0, 1 - security) * 0.08;
    return 1 + lowSecurityPenalty + qualityPenalty;
  }
  const normalized = Math.max(0, Math.min(1, (security + 1) / 2));
  return 1 + normalized * 0.35;
}

function finishNavigationRoute(
  systems: NavigationSystemNode[],
  legs: NavigationRouteEdge[],
  mode: NavigationRouteMode,
  minSecurity: number | null,
  totalWeight: number,
): NavigationRouteResult {
  const rawMinimum = systems.reduce((value, system) => Math.min(value, system.securityStatus), 1);
  const displayedMinimum = systems.reduce((value, system) => Math.min(value, displayedSecurityStatus(system.securityStatus)), 1);
  let transitions = 0;
  for (let index = 1; index < systems.length; index += 1)
    if (securityBand(systems[index - 1].securityStatus) !== securityBand(systems[index].securityStatus)) transitions += 1;
  return {
    found: true,
    mode,
    minSecurity,
    totalWeight,
    jumps: legs.length,
    minimumSecurityStatus: rawMinimum,
    minimumDisplayedSecurityStatus: displayedMinimum,
    securityTransitions: transitions,
    regionCount: new Set(systems.map((system) => system.regionId)).size,
    systems,
    legs,
  };
}

function emptyNavigationRoute(mode: NavigationRouteMode, minSecurity: number | null, reason: string): NavigationRouteResult {
  return {
    found: false,
    reason,
    mode,
    minSecurity,
    totalWeight: 0,
    jumps: 0,
    minimumSecurityStatus: -1,
    minimumDisplayedSecurityStatus: -1,
    securityTransitions: 0,
    regionCount: 0,
    systems: [],
    legs: [],
  };
}

function securityBand(raw: number) {
  const value = displayedSecurityStatus(raw);
  return value >= 0.5 ? "high" : value > 0 ? "low" : "null";
}

function breadthFirstRoutes(
  origin: number,
  neighbours: Map<number, number[]>,
  nodes: Map<number, NavigationSystemNode>,
) {
  const routes = new Map<number, RouteValue>();
  const originSecurity = nodes.get(origin)?.securityStatus ?? 1;
  routes.set(origin, { jumps: 0, minimumSecurityStatus: originSecurity });
  const queue = [origin];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor];
    const currentRoute = routes.get(current)!;
    const nextJumps = currentRoute.jumps + 1;
    for (const destination of neighbours.get(current) ?? []) {
      const nextMinimum = Math.min(currentRoute.minimumSecurityStatus, nodes.get(destination)?.securityStatus ?? -1);
      const existing = routes.get(destination);
      if (!existing) {
        routes.set(destination, { jumps: nextJumps, minimumSecurityStatus: nextMinimum });
        queue.push(destination);
        continue;
      }
      if (existing.jumps === nextJumps && nextMinimum > existing.minimumSecurityStatus)
        routes.set(destination, { jumps: nextJumps, minimumSecurityStatus: nextMinimum });
    }
  }
  return routes;
}

type HeapItem = { id: number; cost: number };
class MinHeap {
  private values: HeapItem[] = [];
  get size() { return this.values.length; }
  push(value: HeapItem) {
    this.values.push(value);
    let index = this.values.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.values[parent].cost <= value.cost) break;
      this.values[index] = this.values[parent];
      index = parent;
    }
    this.values[index] = value;
  }
  pop() {
    if (!this.values.length) return undefined;
    const root = this.values[0];
    const tail = this.values.pop()!;
    if (!this.values.length) return root;
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      if (left >= this.values.length) break;
      let child = left;
      if (right < this.values.length && this.values[right].cost < this.values[left].cost) child = right;
      if (this.values[child].cost >= tail.cost) break;
      this.values[index] = this.values[child];
      index = child;
    }
    this.values[index] = tail;
    return root;
  }
}
