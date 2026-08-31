export type IskModuleWakeDecision = {
  active: boolean;
  visible: boolean;
  prepared: unknown;
  busy: boolean;
  buildKey: string;
  lastBuildKey: string | null;
};

export function iskModuleBuildKey(kind: string, characterId: string, ...revisions: unknown[]) {
  return [kind, characterId, ...revisions.map((value) => String(value ?? ""))].join("|");
}

export function shouldWakeIskModule(input: IskModuleWakeDecision) {
  return input.active
    && input.visible
    && !input.prepared
    && !input.busy
    && input.buildKey !== input.lastBuildKey;
}
