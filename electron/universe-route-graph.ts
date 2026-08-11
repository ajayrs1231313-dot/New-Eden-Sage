import AdmZip from "adm-zip";
import path from "node:path";
import { STATIC_DATA_ROOT } from "./data-paths";

const SDE_ARCHIVE = path.join(STATIC_DATA_ROOT, "eve-static-data-jsonl.zip");

type RouteValue = {
  jumps: number;
  minimumSecurityStatus: number;
};

type UniverseGraph = {
  neighbours: Map<number, number[]>;
  security: Map<number, number>;
  routes: Map<number, Map<number, RouteValue>>;
};

let graphPromise: Promise<UniverseGraph> | undefined;

export async function universeRoute(from: number, to: number): Promise<RouteValue> {
  if (from === to) {
    const graph = await loadGraph();
    return { jumps: 0, minimumSecurityStatus: graph.security.get(from) ?? 1 };
  }
  const graph = await loadGraph();
  if (!graph.neighbours.has(from) || !graph.neighbours.has(to))
    return { jumps: 999, minimumSecurityStatus: -1 };
  let routes = graph.routes.get(from);
  if (!routes) {
    routes = breadthFirstRoutes(from, graph.neighbours, graph.security);
    graph.routes.set(from, routes);
  }
  return routes.get(to) ?? { jumps: 999, minimumSecurityStatus: -1 };
}

async function loadGraph() {
  if (!graphPromise) graphPromise = buildGraph();
  return graphPromise;
}

async function buildGraph(): Promise<UniverseGraph> {
  const zip = new AdmZip(SDE_ARCHIVE);
  const systemsEntry = zip.getEntry("mapSolarSystems.jsonl");
  const gatesEntry = zip.getEntry("mapStargates.jsonl");
  if (!systemsEntry || !gatesEntry)
    throw new Error("Official EVE static data is missing its route map.");

  const security = new Map<number, number>();
  const neighbours = new Map<number, number[]>();
  for (const line of systemsEntry.getData().toString("utf8").split(/\r?\n/)) {
    if (!line) continue;
    const system = JSON.parse(line) as { _key: number; securityStatus: number };
    security.set(system._key, system.securityStatus);
    neighbours.set(system._key, []);
  }
  for (const line of gatesEntry.getData().toString("utf8").split(/\r?\n/)) {
    if (!line) continue;
    const gate = JSON.parse(line) as {
      solarSystemID: number;
      destination: { solarSystemID: number };
    };
    if (!neighbours.has(gate.solarSystemID) || !neighbours.has(gate.destination.solarSystemID))
      continue;
    neighbours.get(gate.solarSystemID)!.push(gate.destination.solarSystemID);
  }
  return { neighbours, security, routes: new Map() };
}

function breadthFirstRoutes(
  origin: number,
  neighbours: Map<number, number[]>,
  security: Map<number, number>,
) {
  const routes = new Map<number, RouteValue>();
  const originSecurity = security.get(origin) ?? 1;
  routes.set(origin, { jumps: 0, minimumSecurityStatus: originSecurity });
  const queue = [origin];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor];
    const currentRoute = routes.get(current)!;
    const nextJumps = currentRoute.jumps + 1;
    for (const destination of neighbours.get(current) ?? []) {
      const nextMinimum = Math.min(
        currentRoute.minimumSecurityStatus,
        security.get(destination) ?? -1,
      );
      const existing = routes.get(destination);
      if (!existing) {
        routes.set(destination, { jumps: nextJumps, minimumSecurityStatus: nextMinimum });
        queue.push(destination);
        continue;
      }
      // If another path has the same shortest distance, keep the safer one.
      if (existing.jumps === nextJumps && nextMinimum > existing.minimumSecurityStatus)
        routes.set(destination, { jumps: nextJumps, minimumSecurityStatus: nextMinimum });
    }
  }
  return routes;
}
