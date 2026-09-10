import { advanceWargameSimulation } from "./wargame-engine";
import type { WargameEngineEvent, WargameInterdictionZone, WargameUnit } from "./wargame-types";
import type { WargameMovementOrder } from "./wargame-command-model";

export const WARGAME_DEFAULT_RNG_SEED = 0x6d2b79f5;

export type WargameCommandSource = "human" | "red-ai" | "mcp" | "system";

export type WargameAdvanceCommand = {
  id: string;
  kind: "advance";
  source: WargameCommandSource;
  seconds: number;
  redAiEnabled: boolean;
  interdictionZones?: WargameInterdictionZone[];
};

export type WargamePatchUnitCommand = { id: string; kind: "patch-unit"; source: WargameCommandSource; unitId: string; patch: Partial<WargameUnit> };
export type WargameReplaceUnitsCommand = { id: string; kind: "replace-units"; source: WargameCommandSource; units: WargameUnit[] };
export type WargameAddUnitCommand = { id: string; kind: "add-unit"; source: WargameCommandSource; unit: WargameUnit };
export type WargameRemoveUnitCommand = { id: string; kind: "remove-unit"; source: WargameCommandSource; unitId: string };
export type WargameMovementCommand = {
  id: string;
  kind: "movement-order";
  source: WargameCommandSource;
  unitId: string;
  mode: WargameMovementOrder;
  targetId?: string;
  x?: number;
  y?: number;
  rangeKm?: number;
  warpRangeKm?: number;
};

export type WargameCommand = WargameAdvanceCommand | WargamePatchUnitCommand | WargameReplaceUnitsCommand | WargameAddUnitCommand | WargameRemoveUnitCommand | WargameMovementCommand;

export type WargameCommandRecord = WargameCommand & {
  sequence: number;
  elapsedBefore: number;
  elapsedAfter: number;
  rngSeedBefore: number;
  rngSeedAfter: number;
};

export type WargameSessionState = {
  units: WargameUnit[];
  elapsedSeconds: number;
  rngSeed: number;
  revision: number;
};

export type WargameTransition = {
  state: WargameSessionState;
  command: WargameCommandRecord;
  events: WargameEngineEvent[];
  damageOccurred: boolean;
  combatResolved: boolean;
  outcome: "blue" | "red" | "draw" | null;
};

function cloneUnit(unit: WargameUnit): WargameUnit {
  return {
    ...unit,
    damageSources: unit.damageSources?.map((source) => ({ ...source, damageProfile: { ...source.damageProfile } })),
    supportSystems: unit.supportSystems?.map((system) => ({ ...system, buffs: system.buffs?.map((buff) => ({ ...buff })) })),
    supportCooldowns: { ...(unit.supportCooldowns ?? {}) },
    supportTargetIds: { ...(unit.supportTargetIds ?? {}) },
    supportLastTargetIds: { ...(unit.supportLastTargetIds ?? {}) },
    supportLockRemaining: { ...(unit.supportLockRemaining ?? {}) },
    orderChain: unit.orderChain?.map((step) => ({
      ...step,
      sourceTargets: { ...step.sourceTargets },
      supportTargets: { ...(step.supportTargets ?? {}) },
      startWhen: step.startWhen ? { ...step.startWhen } : undefined,
      completeWhen: step.completeWhen ? { ...step.completeWhen } : undefined,
      branchWhen: step.branchWhen ? { ...step.branchWhen } : undefined,
    })),
  };
}

export function createWargameSession(units: WargameUnit[], rngSeed = WARGAME_DEFAULT_RNG_SEED): WargameSessionState {
  return {
    units: units.map(cloneUnit),
    elapsedSeconds: 0,
    rngSeed: rngSeed >>> 0,
    revision: 0,
  };
}

export function replaceWargameSessionUnits(state: WargameSessionState, units: WargameUnit[]): WargameSessionState {
  return { ...state, units: units.map(cloneUnit), revision: state.revision + 1 };
}

export function applyWargameCommand(state: WargameSessionState, command: WargameCommand): WargameTransition {
  switch (command.kind) {
    case "patch-unit": {
      const units = state.units.map((unit) => unit.id === command.unitId ? cloneUnit({ ...unit, ...command.patch }) : cloneUnit(unit));
      const nextState = { ...state, units, revision: state.revision + 1 };
      return { state: nextState, command: { ...command, sequence: nextState.revision, elapsedBefore: state.elapsedSeconds, elapsedAfter: state.elapsedSeconds, rngSeedBefore: state.rngSeed, rngSeedAfter: state.rngSeed }, events: [], damageOccurred: false, combatResolved: false, outcome: null };
    }
    case "replace-units": {
      const nextState = { ...state, units: command.units.map(cloneUnit), revision: state.revision + 1 };
      return { state: nextState, command: { ...command, sequence: nextState.revision, elapsedBefore: state.elapsedSeconds, elapsedAfter: state.elapsedSeconds, rngSeedBefore: state.rngSeed, rngSeedAfter: state.rngSeed }, events: [], damageOccurred: false, combatResolved: false, outcome: null };
    }
    case "add-unit": {
      const nextState = { ...state, units: [...state.units.map(cloneUnit), cloneUnit(command.unit)], revision: state.revision + 1 };
      return { state: nextState, command: { ...command, sequence: nextState.revision, elapsedBefore: state.elapsedSeconds, elapsedAfter: state.elapsedSeconds, rngSeedBefore: state.rngSeed, rngSeedAfter: state.rngSeed }, events: [], damageOccurred: false, combatResolved: false, outcome: null };
    }
    case "remove-unit": {
      const nextState = { ...state, units: state.units.filter((unit) => unit.id !== command.unitId).map(cloneUnit), revision: state.revision + 1 };
      return { state: nextState, command: { ...command, sequence: nextState.revision, elapsedBefore: state.elapsedSeconds, elapsedAfter: state.elapsedSeconds, rngSeedBefore: state.rngSeed, rngSeedAfter: state.rngSeed }, events: [], damageOccurred: false, combatResolved: false, outcome: null };
    }
    case "movement-order": {
      const units = state.units.map((unit) => {
        if (unit.id !== command.unitId) return cloneUnit(unit);
        const sameIntent = unit.movementOrder === command.mode && unit.movementTargetId === command.targetId && unit.destinationX === command.x && unit.destinationY === command.y;
        return cloneUnit({
          ...unit,
          movementOrder: command.mode,
          movementTargetId: command.targetId,
          movementRangeKm: Math.max(0, command.rangeKm ?? unit.movementRangeKm ?? 0),
          warpRangeKm: Math.max(0, Math.min(100, command.warpRangeKm ?? unit.warpRangeKm ?? 0)),
          destinationX: command.x,
          destinationY: command.y,
          movementState: command.mode === "hold" ? "idle" : sameIntent ? unit.movementState : undefined,
          activeMovementStepId: undefined,
          alignElapsedSeconds: sameIntent ? unit.alignElapsedSeconds : 0,
          alignedToTargetId: sameIntent ? unit.alignedToTargetId : undefined,
          alignedX: sameIntent ? unit.alignedX : undefined,
          alignedY: sameIntent ? unit.alignedY : undefined,
          warpRemainingSeconds: sameIntent ? unit.warpRemainingSeconds : 0,
          warpDestinationX: sameIntent ? unit.warpDestinationX : undefined,
          warpDestinationY: sameIntent ? unit.warpDestinationY : undefined,
          warpBlockedReason: undefined,
          velocityX: command.mode === "hold" ? 0 : unit.velocityX,
          velocityY: command.mode === "hold" ? 0 : unit.velocityY,
        });
      });
      const nextState = { ...state, units, revision: state.revision + 1 };
      return { state: nextState, command: { ...command, sequence: nextState.revision, elapsedBefore: state.elapsedSeconds, elapsedAfter: state.elapsedSeconds, rngSeedBefore: state.rngSeed, rngSeedAfter: state.rngSeed }, events: [], damageOccurred: false, combatResolved: false, outcome: null };
    }
    case "advance": {
      const result = advanceWargameSimulation(state.units, {
        elapsedSeconds: state.elapsedSeconds,
        seconds: command.seconds,
        redAiEnabled: command.redAiEnabled,
        rngSeed: state.rngSeed,
        interdictionZones: command.interdictionZones,
      });
      const nextState: WargameSessionState = {
        units: result.units,
        elapsedSeconds: result.elapsedSeconds,
        rngSeed: result.rngSeed,
        revision: state.revision + 1,
      };
      return {
        state: nextState,
        command: {
          ...command,
          sequence: nextState.revision,
          elapsedBefore: state.elapsedSeconds,
          elapsedAfter: result.elapsedSeconds,
          rngSeedBefore: state.rngSeed,
          rngSeedAfter: result.rngSeed,
        },
        events: result.events,
        damageOccurred: result.damageOccurred,
        combatResolved: result.combatResolved,
        outcome: result.outcome,
      };
    }
  }
}

export function replayWargameCommands(initial: WargameSessionState, commands: WargameCommand[]): WargameTransition[] {
  const transitions: WargameTransition[] = [];
  let state: WargameSessionState = {
    ...initial,
    units: initial.units.map(cloneUnit),
  };
  for (const command of commands) {
    const transition = applyWargameCommand(state, command);
    transitions.push(transition);
    state = transition.state;
  }
  return transitions;
}
