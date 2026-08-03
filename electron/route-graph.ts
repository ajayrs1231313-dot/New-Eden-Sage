import AdmZip from "adm-zip";
import path from "node:path";
import { STATIC_DATA_ROOT } from "./data-paths";

const SDE_ARCHIVE = path.join(STATIC_DATA_ROOT, "eve-static-data-jsonl.zip");

type RouteGraph = {
  neighbours: Map<number, number[]>;
  distances: Map<number, Map<number, number>>;
};

let graphPromise: Promise<RouteGraph> | undefined;

export async function highSecJumps(from: number, to: number) {
  if (from === to) return 0;
  const graph = await loadGraph();
  if (!graph.neighbours.has(from) || !graph.neighbours.has(to)) return 999;
  let distances = graph.distances.get(from);
  if (!distances) {
    distances = breadthFirstDistances(from, graph.neighbours);
    graph.distances.set(from, distances);
  }
  return distances.get(to) ?? 999;
}

async function loadGraph() {
  if (!graphPromise) graphPromise = buildGraph();
  return graphPromise;
}

async function buildGraph(): Promise<RouteGraph> {
  const zip = new AdmZip(SDE_ARCHIVE);
  const systemsEntry = zip.getEntry("mapSolarSystems.jsonl");
  const gatesEntry = zip.getEntry("mapStargates.jsonl");
  if (!systemsEntry || !gatesEntry)
    throw new Error("Official EVE static data is missing its route map.");
  const highSec = new Set<number>();
  for (const line of systemsEntry.getData().toString("utf8").split(/\r?\n/)) {
    if (!line) continue;
    const system = JSON.parse(line) as {
      _key: number;
      securityStatus: number;
    };
    // EVE displays security rounded to one decimal; 0.45 and above is 0.5.
    if (system.securityStatus >= 0.45) highSec.add(system._key);
  }
  const neighbours = new Map<number, number[]>();
  for (const systemId of highSec) neighbours.set(systemId, []);
  for (const line of gatesEntry.getData().toString("utf8").split(/\r?\n/)) {
    if (!line) continue;
    const gate = JSON.parse(line) as {
      solarSystemID: number;
      destination: { solarSystemID: number };
    };
    const destination = gate.destination.solarSystemID;
    if (highSec.has(gate.solarSystemID) && highSec.has(destination))
      neighbours.get(gate.solarSystemID)!.push(destination);
  }
  return { neighbours, distances: new Map() };
}

function breadthFirstDistances(
  origin: number,
  neighbours: Map<number, number[]>,
) {
  const distances = new Map<number, number>([[origin, 0]]);
  const queue = [origin];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor];
    const nextDistance = distances.get(current)! + 1;
    for (const destination of neighbours.get(current) ?? []) {
      if (distances.has(destination)) continue;
      distances.set(destination, nextDistance);
      queue.push(destination);
    }
  }
  return distances;
}
