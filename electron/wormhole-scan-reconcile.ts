export type ReconcileObservation = {
  id: string;
  group: string;
  type: string;
  name: string;
  strength: string;
  distance: string;
  kind: string;
  raw: string;
};

export type ReconciledObservation<T extends ReconcileObservation = ReconcileObservation> = T & { state: "new" | "existing" | "changed" | "missing" };

export function wormholeObservationChanged(a: ReconcileObservation, b: ReconcileObservation) {
  return a.group !== b.group || a.type !== b.type || a.name !== b.name || a.kind !== b.kind || a.strength !== b.strength || a.distance !== b.distance;
}

export function reconcileWormholeScan<T extends ReconcileObservation>(previous: T[], current: T[]): ReconciledObservation<T>[] {
  const previousById = new Map(previous.map((row) => [row.id, row]));
  const currentById = new Map(current.map((row) => [row.id, row]));
  const result: ReconciledObservation<T>[] = [];
  for (const observation of current) {
    const prior = previousById.get(observation.id);
    result.push({ ...observation, state: !prior ? "new" : wormholeObservationChanged(observation, prior) ? "changed" : "existing" });
  }
  for (const prior of previous) if (!currentById.has(prior.id)) result.push({ ...prior, state: "missing" });
  return result.sort((a, b) => a.id.localeCompare(b.id));
}
