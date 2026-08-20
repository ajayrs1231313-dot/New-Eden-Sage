export type NavigationWaypointExportInput = {
  characterId: string;
  systemIds: number[];
  clearOtherWaypoints?: boolean;
};

export type NavigationWaypointExportDeps = {
  getAccessToken(characterId: string): Promise<string>;
  request(characterId: string, url: string, accessToken: string): Promise<unknown>;
};

export function normalizeNavigationWaypointIds(value: unknown): number[] {
  return Array.isArray(value)
    ? value.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0)
    : [];
}

export function navigationRouteEveWaypointChain(route: {
  systems?: Array<{ systemId: number }>;
  legs?: Array<{ from: number; to: number; type: string }>;
}) {
  const systems = Array.isArray(route?.systems) ? route.systems : [];
  const legs = Array.isArray(route?.legs) ? route.legs : [];
  const systemIds: number[] = [];
  let stoppedAtSpecialEdge: string | null = null;
  for (let index = 0; index < legs.length; index += 1) {
    const leg = legs[index];
    if (leg.type !== "gate") {
      stoppedAtSpecialEdge = String(leg.type || "special");
      break;
    }
    const fallback = Number(systems[index + 1]?.systemId ?? 0);
    const destination = Number(leg.to || fallback);
    if (Number.isSafeInteger(destination) && destination > 0) systemIds.push(destination);
  }
  return {
    systemIds,
    complete: stoppedAtSpecialEdge == null,
    stoppedAtSpecialEdge,
    exportedGateLegs: systemIds.length,
    totalLegs: legs.length,
  };
}

export function buildNavigationWaypointUrl(destinationId: number, clearOtherWaypoints: boolean) {
  const url = new URL("https://esi.evetech.net/v2/ui/autopilot/waypoint");
  url.searchParams.set("add_to_beginning", "false");
  url.searchParams.set("clear_other_waypoints", clearOtherWaypoints ? "true" : "false");
  url.searchParams.set("destination_id", String(destinationId));
  return url.toString();
}

export async function exportNavigationWaypoints(
  input: NavigationWaypointExportInput,
  deps: NavigationWaypointExportDeps,
) {
  const characterId = String(input?.characterId ?? "");
  const systemIds = normalizeNavigationWaypointIds(input?.systemIds);
  if (!characterId) throw new Error("Choose a connected character before exporting the route to EVE.");
  if (!systemIds.length) throw new Error("Calculate an EVE-compatible gate route before exporting it to EVE.");
  const clearOtherWaypoints = input?.clearOtherWaypoints !== false;
  const accessToken = await deps.getAccessToken(characterId);
  let exported = 0;
  for (let index = 0; index < systemIds.length; index += 1) {
    const url = buildNavigationWaypointUrl(systemIds[index], index === 0 && clearOtherWaypoints);
    try {
      await deps.request(characterId, url, accessToken);
    } catch (error) {
      if ((error as Error & { status?: number }).status === 403) {
        throw new Error("EVE denied waypoint access. Reconnect this character in Sage once to grant route-export permission.");
      }
      throw error;
    }
    exported += 1;
  }
  return { success: true, waypoints: exported };
}
