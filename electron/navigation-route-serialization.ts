import { NAVIGATION_ROUTE_SCHEMA_VERSION, type NavigationRoutePlan } from "./navigation-route-planner";

export const NAVIGATION_ROUTE_PACKET_SCHEMA = "new-eden-sage.route.v1";
export const NAVIGATION_ROUTE_PACKET_VERSION = 1;

export type NavigationRoutePacket = {
  schema: typeof NAVIGATION_ROUTE_PACKET_SCHEMA;
  packetVersion: number;
  application: "New Eden Sage";
  exportedAt: string;
  routeSchemaVersion: number;
  route: NavigationRoutePlan;
};

function plainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertRoute(value: unknown): asserts value is NavigationRoutePlan {
  if (!plainObject(value)) throw new Error("Route packet does not contain a Sage route object.");
  const schemaVersion = Number(value.schemaVersion ?? 0);
  if (!Number.isSafeInteger(schemaVersion) || schemaVersion < 1) throw new Error("Route schema version is missing or invalid.");
  if (schemaVersion > NAVIGATION_ROUTE_SCHEMA_VERSION) throw new Error(`This route uses schema v${schemaVersion}, but this Sage build supports up to v${NAVIGATION_ROUTE_SCHEMA_VERSION}.`);
  if (!String(value.routeId ?? "").trim()) throw new Error("Route ID is missing.");
  if (!Array.isArray(value.waypoints) || !Array.isArray(value.systems) || !Array.isArray(value.legs) || !Array.isArray(value.segments)) throw new Error("Route packet is missing ordered route data.");
  if (!Array.isArray(value.lockedSegments) || !Array.isArray(value.customConnections)) throw new Error("Route packet is missing lock/custom-connection data.");
  if (!plainObject(value.routingProfile) || !plainObject(value.totals)) throw new Error("Route packet is missing its routing profile or totals.");
  if (schemaVersion >= 4 && (!plainObject(value.waypointAnnotations) || typeof value.notes !== "string")) throw new Error("Route packet is missing route notes/waypoint annotations required by schema v4.");
  const waypoints = value.waypoints as unknown[];
  for (const item of waypoints) {
    if (!plainObject(item) || !Number.isSafeInteger(Number(item.systemId ?? 0)) || Number(item.systemId ?? 0) <= 0) throw new Error("Route contains an invalid waypoint.");
  }
}

export function exportNavigationRouteJson(route: unknown): string {
  assertRoute(route);
  const packet: NavigationRoutePacket = {
    schema: NAVIGATION_ROUTE_PACKET_SCHEMA,
    packetVersion: NAVIGATION_ROUTE_PACKET_VERSION,
    application: "New Eden Sage",
    exportedAt: new Date().toISOString(),
    routeSchemaVersion: route.schemaVersion,
    route: JSON.parse(JSON.stringify(route)) as NavigationRoutePlan,
  };
  return JSON.stringify(packet, null, 2);
}

export function importNavigationRouteJson(text: string): NavigationRoutePlan {
  let parsed: unknown;
  try { parsed = JSON.parse(String(text ?? "")); }
  catch { throw new Error("Route JSON is not valid JSON."); }
  if (!plainObject(parsed)) throw new Error("Route JSON must contain a Sage route packet.");
  if (parsed.schema !== NAVIGATION_ROUTE_PACKET_SCHEMA) throw new Error(`Unsupported route packet schema. Expected ${NAVIGATION_ROUTE_PACKET_SCHEMA}.`);
  if (Number(parsed.packetVersion ?? 0) !== NAVIGATION_ROUTE_PACKET_VERSION) throw new Error(`Unsupported route packet version ${String(parsed.packetVersion ?? "?")}.`);
  if (!plainObject(parsed.route)) throw new Error("Route packet does not contain a route.");
  if (Number(parsed.routeSchemaVersion ?? 0) !== Number(parsed.route.schemaVersion ?? 0)) throw new Error("Route packet schema metadata does not match the contained route.");
  assertRoute(parsed.route);
  return JSON.parse(JSON.stringify(parsed.route)) as NavigationRoutePlan;
}
