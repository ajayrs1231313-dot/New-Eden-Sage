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
  estimatedClearSeconds: number;
  droneNavigationDistanceM: number;
  effectiveDroneVelocityMps: number;
  route: PveRouteLeg[];
};

export const PVE_CLEAR_TIME_CAVEAT = "Estimated clear time includes combat and drone navigation. Ship travel time is not included.";

const distance = (left: PvePoint, right: PvePoint) => Math.hypot(
  right.xM - left.xM,
  right.yM - left.yM,
  (right.zM ?? 0) - (left.zM ?? 0),
);

export function calculatePveRoomClearTime(input: {
  targets: PveClearTarget[];
  droneTravel: PveDroneTravelModel;
  launchPosition?: PvePoint;
  geometry: "exact" | "estimated";
}): PveRoomClearTiming {
  const required = input.targets.filter((target) => target.requiredForClear !== false);
  const combatSeconds = required.reduce((sum, target) => sum + Math.max(0, target.ttkSeconds), 0);
  const mobile = input.droneTravel.mode === "mobile" && input.droneTravel.effectiveVelocityMps > 0;
  const routeCandidates = mobile
    ? required.filter((target) => target.requiresDroneTravel !== false)
    : [];
  const route: PveRouteLeg[] = [];
  let current = input.launchPosition ?? { xM: 0, yM: 0, zM: 0 };
  let remaining = [...routeCandidates];
  let navigationDistanceM = 0;
  while (remaining.length) {
    const priority = Math.min(...remaining.map((target) => target.priority));
    const candidates = remaining.filter((target) => target.priority === priority);
    candidates.sort((left, right) => {
      const distanceDelta = distance(current, left.position) - distance(current, right.position);
      return distanceDelta || left.id.localeCompare(right.id);
    });
    const next = candidates[0];
    const legDistanceM = distance(current, next.position);
    const travelSeconds = legDistanceM / input.droneTravel.effectiveVelocityMps;
    navigationDistanceM += legDistanceM;
    route.push({
      targetId: next.id,
      targetLabel: next.label,
      priority: next.priority,
      distanceM: legDistanceM,
      travelSeconds,
    });
    current = next.position;
    remaining = remaining.filter((target) => target !== next);
  }
  const droneNavigationSeconds = mobile ? navigationDistanceM / input.droneTravel.effectiveVelocityMps : 0;
  return {
    geometry: input.geometry,
    combatSeconds,
    droneNavigationSeconds,
    estimatedClearSeconds: combatSeconds + droneNavigationSeconds,
    droneNavigationDistanceM: navigationDistanceM,
    effectiveDroneVelocityMps: mobile ? input.droneTravel.effectiveVelocityMps : 0,
    route,
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

export function aggregatePveSiteClearTime(rooms: Array<Pick<PveRoomClearTiming, "combatSeconds" | "droneNavigationSeconds" | "estimatedClearSeconds">>) {
  return rooms.reduce((total, room) => ({
    combatSeconds: total.combatSeconds + room.combatSeconds,
    droneNavigationSeconds: total.droneNavigationSeconds + room.droneNavigationSeconds,
    estimatedClearSeconds: total.estimatedClearSeconds + room.estimatedClearSeconds,
  }), { combatSeconds: 0, droneNavigationSeconds: 0, estimatedClearSeconds: 0 });
}
