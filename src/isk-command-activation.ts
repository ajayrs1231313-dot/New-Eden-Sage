export type IskModuleWakeDecision = {
  active: boolean;
  visible: boolean;
  prepared: unknown;
  preparedSource?: "exact" | "last-known-good" | null;
  busy: boolean;
  buildKey: string;
  lastBuildKey: string | null;
};

export function iskModuleBuildKey(kind: string, characterId: string, ...revisions: unknown[]) {
  return [kind, characterId, ...revisions.map((value) => String(value ?? ""))].join("|");
}

export function shouldWakeIskModule(input: IskModuleWakeDecision) {
  const needsCurrentResult = !input.prepared || input.preparedSource === "last-known-good";
  return input.active
    && input.visible
    && needsCurrentResult
    && !input.busy
    && input.buildKey !== input.lastBuildKey;
}
