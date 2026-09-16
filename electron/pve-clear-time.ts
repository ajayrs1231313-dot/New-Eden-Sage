export type PvePoint = { xM: number; yM: number; zM?: number };

export type PveClearTarget = {
  id: string;
  label?: string;
  priority: number;
  ttkSeconds: number;
  position: PvePoint;
  requiredForClear?: boolean;
  requiresDroneTravel?: boolean;
};

export type PveDroneTravelModel = {
  mode: "none" | "sentry" | "mobile";
  effectiveVelocityMps: number;
  engagementRangeM?: number;
};

export type PveShipTravelModel = {
  mode: "none" | "average-reposition";
  effectiveVelocityMps: number;
  /** Ignore tiny local shuffles that do not normally force the hull to reposition. */
  minimumLegDistanceM?: number;
  /** Cap estimated per-target repositioning so synthetic room geometry cannot invent extreme burns. */
  maximumLegDistanceM?: number;
  /** Ships do not spend every reposition at their theoretical maximum velocity. */
  velocityUtilization?: number;
};

export type PveRouteLeg = {
  targetId: string;
  targetLabel?: string;
  priority: number;
  distanceM: number;
  travelSeconds: number;
};

export type PveRoomClearTiming = {
  geometry: "exact" | "estimated";
  combatSeconds: number;
  droneNavigationSeconds: number;
  shipNavigationSeconds: number;
  estimatedClearSeconds: number;
  droneNavigationDistanceM: number;
  shipNavigationDistanceM: number;
  effectiveDroneVelocityMps: number;
  effectiveShipVelocityMps: number;
  shipNavigationLegCount: number;
  averageShipNavigationSecondsPerLeg: number;
  route: PveRouteLeg[];
  shipRoute: PveRouteLeg[];
};

export const PVE_CLEAR_TIME_CAVEAT = "Estimated clear time includes combat, drone navigation and reasonable target-to-target ship repositioning. These times are estimates, not a guarantee.";

const distance = (left: PvePoint, right: PvePoint) => Math.hypot(
  right.xM - left.xM,
  right.yM - left.yM,
  (right.zM ?? 0) - (left.zM ?? 0),
);

function buildPriorityRoute(targets: PveClearTarget[], start: PvePoint, velocityMps: number) {
  const route: PveRouteLeg[] = [];
  let current = start;
  let remaining = [...targets];
  while (remaining.length) {
    const priority = Math.min(...remaining.map((target) => target.priority));
    const candidates = remaining.filter((target) => target.priority === priority);
    candidates.sort((left, right) => {
      const distanceDelta = distance(current, left.position) - distance(current, right.position);
      return distanceDelta || left.id.localeCompare(right.id);
    });
    const next = candidates[0];
    const legDistanceM = distance(current, next.position);
    route.push({
      targetId: next.id,
      targetLabel: next.label,
      priority: next.priority,
      distanceM: legDistanceM,
      travelSeconds: velocityMps > 0 ? legDistanceM / velocityMps : 0,
    });
    current = next.position;
    remaining = remaining.filter((target) => target !== next);
  }
  return route;
}

export function calculatePveRoomClearTime(input: {
  targets: PveClearTarget[];
  droneTravel: PveDroneTravelModel;
  shipTravel?: PveShipTravelModel;
  launchPosition?: PvePoint;
  geometry: "exact" | "estimated";
}): PveRoomClearTiming {
  const required = input.targets.filter((target) => target.requiredForClear !== false);
  const combatSeconds = required.reduce((sum, target) => sum + Math.max(0, target.ttkSeconds), 0);
  const launchPosition = input.launchPosition ?? { xM: 0, yM: 0, zM: 0 };

  const mobile = input.droneTravel.mode === "mobile" && input.droneTravel.effectiveVelocityMps > 0;
  const routeCandidates = mobile
    ? required.filter((target) => target.requiresDroneTravel !== false)
    : [];
  const route = mobile
    ? buildPriorityRoute(routeCandidates, launchPosition, input.droneTravel.effectiveVelocityMps)
    : [];
  const droneNavigationDistanceM = route.reduce((sum, leg) => sum + leg.distanceM, 0);
  const droneNavigationSeconds = mobile ? droneNavigationDistanceM / input.droneTravel.effectiveVelocityMps : 0;

  // Abyss and other PvE catalogues rarely provide exact NPC coordinates. For ship
  // movement we therefore model only meaningful target-to-target repositioning: the
  // first target is excluded, tiny local shuffles are ignored, and a single synthetic
  // geometry leg is capped. This makes movement affect clear time without pretending
  // that generated coordinates are authoritative telemetry.
  const shipTravelEnabled = input.shipTravel?.mode === "average-reposition" && Number(input.shipTravel.effectiveVelocityMps) > 0;
  const theoreticalShipVelocityMps = shipTravelEnabled ? Math.max(0, Number(input.shipTravel!.effectiveVelocityMps)) : 0;
  const velocityUtilization = shipTravelEnabled ? Math.min(1, Math.max(0.25, Number(input.shipTravel?.velocityUtilization ?? 0.8))) : 0;
  const effectiveShipVelocityMps = theoreticalShipVelocityMps * velocityUtilization;
  const minimumLegDistanceM = Math.max(0, Number(input.shipTravel?.minimumLegDistanceM ?? 4_000));
  const maximumLegDistanceM = Math.max(minimumLegDistanceM, Number(input.shipTravel?.maximumLegDistanceM ?? 8_000));
  const rawShipRoute = shipTravelEnabled ? buildPriorityRoute(required, launchPosition, effectiveShipVelocityMps) : [];
  const shipRoute = rawShipRoute.slice(1).flatMap((leg) => {
    if (leg.distanceM < minimumLegDistanceM) return [];
    const modeledDistanceM = Math.min(leg.distanceM, maximumLegDistanceM);
    return [{ ...leg, distanceM: modeledDistanceM, travelSeconds: modeledDistanceM / Math.max(1e-9, effectiveShipVelocityMps) }];
  });
  const shipNavigationDistanceM = shipRoute.reduce((sum, leg) => sum + leg.distanceM, 0);
  const shipNavigationSeconds = shipRoute.reduce((sum, leg) => sum + leg.travelSeconds, 0);
  const shipNavigationLegCount = shipRoute.length;
  const averageShipNavigationSecondsPerLeg = shipNavigationLegCount ? shipNavigationSeconds / shipNavigationLegCount : 0;

  return {
    geometry: input.geometry,
    combatSeconds,
    droneNavigationSeconds,
    shipNavigationSeconds,
    estimatedClearSeconds: combatSeconds + droneNavigationSeconds + shipNavigationSeconds,
    droneNavigationDistanceM,
    shipNavigationDistanceM,
    effectiveDroneVelocityMps: mobile ? input.droneTravel.effectiveVelocityMps : 0,
    effectiveShipVelocityMps,
    shipNavigationLegCount,
    averageShipNavigationSecondsPerLeg,
    route,
    shipRoute,
  };
}

export type PveEstimatedTargetGroup = {
  id: string;
  label?: string;
  count: number;
  priority: number;
  ttkSeconds: number;
  requiredForClear?: boolean;
  requiresDroneTravel?: boolean;
};

export function estimateClusteredPveGeometry(
  groups: PveEstimatedTargetGroup[],
  options: {
    initialTargetRangeM: number;
    engagementRangeM?: number;
    clusterSpacingM?: number;
    intraClusterSpacingM?: number;
  },
): PveClearTarget[] {
  const initialTravelM = Math.max(0, options.initialTargetRangeM - Math.max(0, options.engagementRangeM ?? 0));
  const clusterSpacingM = Math.max(1000, options.clusterSpacingM ?? 6000);
  const intraClusterSpacingM = Math.max(500, options.intraClusterSpacingM ?? 2200);
  const ordered = [...groups].sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id));
  const groupOffset = (index: number) => index === 0 ? 0 : (index % 2 ? 1 : -1) * Math.ceil(index / 2) * clusterSpacingM;
  return ordered.flatMap((group, groupIndex) => {
    const centerY = groupOffset(groupIndex);
    return Array.from({ length: Math.max(0, Math.floor(group.count)) }, (_, index) => {
      if (index === 0) {
        return {
          id: group.id + ":0",
          label: group.label,
          priority: group.priority,
          ttkSeconds: group.ttkSeconds,
          position: { xM: initialTravelM, yM: centerY, zM: 0 },
          requiredForClear: group.requiredForClear,
          requiresDroneTravel: group.requiresDroneTravel,
        };
      }
      const ring = Math.ceil(index / 6);
      const angle = ((index - 1) % 6) * Math.PI / 3;
      return {
        id: group.id + ":" + index,
        label: group.label,
        priority: group.priority,
        ttkSeconds: group.ttkSeconds,
        position: {
          xM: initialTravelM + Math.cos(angle) * intraClusterSpacingM * ring,
          yM: centerY + Math.sin(angle) * intraClusterSpacingM * ring,
          zM: 0,
        },
        requiredForClear: group.requiredForClear,
        requiresDroneTravel: group.requiresDroneTravel,
      };
    });
  });
}

export function aggregatePveSiteClearTime(rooms: Array<Pick<PveRoomClearTiming, "combatSeconds" | "droneNavigationSeconds" | "shipNavigationSeconds" | "estimatedClearSeconds">>) {
  return rooms.reduce((total, room) => ({
    combatSeconds: total.combatSeconds + room.combatSeconds,
    droneNavigationSeconds: total.droneNavigationSeconds + room.droneNavigationSeconds,
    shipNavigationSeconds: total.shipNavigationSeconds + room.shipNavigationSeconds,
    estimatedClearSeconds: total.estimatedClearSeconds + room.estimatedClearSeconds,
  }), { combatSeconds: 0, droneNavigationSeconds: 0, shipNavigationSeconds: 0, estimatedClearSeconds: 0 });
}
