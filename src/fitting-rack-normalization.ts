export type CanonicalFittingRack = "low" | "mid" | "high" | "rig" | "subsystem";

export type FittingPlacementMetadata = {
  id: number;
  name: string;
  categoryName?: string;
  rack?: CanonicalFittingRack | string;
};

export type RackNormalizableItem = {
  name: string;
  typeId?: number;
  quantity: number;
};

export type RackNormalizableFit<T extends RackNormalizableItem = RackNormalizableItem> = {
  low: T[];
  mid: T[];
  high: T[];
  rig: T[];
  subsystem: T[];
  drones: T[];
  fighters: T[];
  cargo: T[];
  implants: T[];
  boosters: T[];
};

const RACKS: CanonicalFittingRack[] = ["low", "mid", "high", "rig", "subsystem"];
const isRack = (value: unknown): value is CanonicalFittingRack => RACKS.includes(String(value) as CanonicalFittingRack);

export function canonicalizeFittingPlacement<T extends RackNormalizableItem, F extends RackNormalizableFit<T>>(
  fit: F,
  metadata: FittingPlacementMetadata[],
): { fit: F; moved: number; unresolvedFitted: Array<{ item: T; sourceRack: CanonicalFittingRack }> } {
  const byId = new Map(metadata.filter((item) => Number.isInteger(item.id) && item.id > 0).map((item) => [item.id, item]));
  const byName = new Map(metadata.map((item) => [item.name.trim().toLowerCase(), item]));
  const racks: Record<CanonicalFittingRack, T[]> = { low: [], mid: [], high: [], rig: [], subsystem: [] };
  const drones: T[] = [];
  const fighters: T[] = [];
  const cargo: T[] = [];
  const implants: T[] = [];
  const boosters: T[] = [];
  const unresolvedFitted: Array<{ item: T; sourceRack: CanonicalFittingRack }> = [];
  let moved = 0;

  const infoFor = (item: T) => (item.typeId ? byId.get(item.typeId) : undefined) ?? byName.get(item.name.trim().toLowerCase());
  const route = (item: T, source: CanonicalFittingRack | "drones" | "fighters" | "cargo" | "implants" | "boosters") => {
    const info = infoFor(item);
    const category = String(info?.categoryName ?? "").toLowerCase();
    const destinationRack = isRack(info?.rack) ? info!.rack as CanonicalFittingRack : undefined;
    let destination: typeof source = source;

    if (destinationRack) {
      racks[destinationRack].push(item);
      destination = destinationRack;
    } else if (category === "drone") {
      drones.push(item);
      destination = "drones";
    } else if (category === "fighter") {
      fighters.push(item);
      destination = "fighters";
    } else if (source === "drones") {
      drones.push(item);
      destination = "drones";
    } else if (source === "fighters") {
      fighters.push(item);
      destination = "fighters";
    } else if (source === "boosters") {
      boosters.push(item);
      destination = "boosters";
    } else if (source === "implants") {
      implants.push(item);
      destination = "implants";
    } else if (isRack(source)) {
      // A fitted item whose rack cannot be proven from CCP metadata is not trusted.
      // Keep it in place only so callers can report the exact offending entry; imports
      // must reject unresolvedFitted rather than persisting an unverifiable rack.
      cargo.push(item);
      destination = "cargo";
      unresolvedFitted.push({ item, sourceRack: source });
    } else {
      cargo.push(item);
      destination = "cargo";
    }

    if (destination !== source) moved += 1;
  };

  for (const rack of RACKS) for (const item of fit[rack]) route(item, rack);
  for (const item of fit.drones) route(item, "drones");
  for (const item of fit.fighters) route(item, "fighters");
  for (const item of fit.cargo) route(item, "cargo");
  for (const item of fit.implants) route(item, "implants");
  for (const item of fit.boosters) route(item, "boosters");

  return {
    fit: {
      ...fit,
      low: racks.low,
      mid: racks.mid,
      high: racks.high,
      rig: racks.rig,
      subsystem: racks.subsystem,
      drones,
      fighters,
      cargo,
      implants,
      boosters,
    } as F,
    moved,
    unresolvedFitted,
  };
}
