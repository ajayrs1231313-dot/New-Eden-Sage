import type { Fit } from "./fitting-engine";

export type FitLibrarySort = "recent" | "name" | "hull" | "readiness";

export type FitLibraryMeta = {
  createdAt: string;
  updatedAt: string;
  lastAnalyzedAt?: string;
  readiness?: "ready" | "missing" | "unknown";
  missingRequirements?: number;
};

export type FitLibraryMetaMap = Record<string, FitLibraryMeta>;

export type FitSummary = {
  moduleCount: number;
  droneCount: number;
  cargoQuantity: number;
  resolvedItems: number;
  unresolvedItems: number;
};

export function summarizeFit(fit: Fit): FitSummary {
  const items = [fit.hull, ...fit.low, ...fit.mid, ...fit.high, ...fit.rig, ...fit.subsystem, ...fit.drones, ...fit.cargo];
  return {
    moduleCount: fit.low.length + fit.mid.length + fit.high.length + fit.rig.length + fit.subsystem.length,
    droneCount: fit.drones.reduce((total, item) => total + item.quantity, 0),
    cargoQuantity: fit.cargo.reduce((total, item) => total + item.quantity, 0),
    resolvedItems: items.filter((item) => Boolean(item.typeId)).length,
    unresolvedItems: items.filter((item) => !item.typeId).length,
  };
}

export function ensureFitMeta(fits: Fit[], current: FitLibraryMetaMap): FitLibraryMetaMap {
  const now = new Date().toISOString();
  const next: FitLibraryMetaMap = {};
  for (const fit of fits) {
    next[fit.id] = current[fit.id] ?? { createdAt: now, updatedAt: now, readiness: "unknown" };
  }
  return next;
}

export function filterAndSortFits(
  fits: Fit[],
  meta: FitLibraryMetaMap,
  query: string,
  sort: FitLibrarySort,
): Fit[] {
  const needle = query.trim().toLowerCase();
  const filtered = needle
    ? fits.filter((fit) =>
        [fit.name, fit.hull.name, ...fit.high.map((item) => item.name), ...fit.mid.map((item) => item.name), ...fit.low.map((item) => item.name), ...fit.drones.map((item) => item.name)]
          .some((value) => value.toLowerCase().includes(needle)),
      )
    : [...fits];

  return filtered.sort((a, b) => {
    if (sort === "name") return a.name.localeCompare(b.name);
    if (sort === "hull") return a.hull.name.localeCompare(b.hull.name) || a.name.localeCompare(b.name);
    if (sort === "readiness") {
      const rank = { missing: 0, unknown: 1, ready: 2 } as const;
      return rank[meta[a.id]?.readiness ?? "unknown"] - rank[meta[b.id]?.readiness ?? "unknown"] || a.name.localeCompare(b.name);
    }
    return (meta[b.id]?.updatedAt ?? "").localeCompare(meta[a.id]?.updatedAt ?? "");
  });
}

export function duplicateFit(fit: Fit): Fit {
  const id = globalThis.crypto?.randomUUID?.() ?? `fit-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return JSON.parse(JSON.stringify({ ...fit, id, name: `${fit.name} copy` })) as Fit;
}

export function renameFit(fit: Fit, name: string): Fit {
  const clean = name.trim();
  if (!clean) throw new Error("Fit name cannot be empty.");
  return { ...fit, name: clean };
}

export function exportFitJson(fit: Fit) {
  const payload = {
    name: fit.name,
    ship: { name: fit.hull.name, ...(fit.hull.typeId ? { typeId: fit.hull.typeId } : {}), quantity: 1 },
    modules: {
      high: fit.high,
      mid: fit.mid,
      low: fit.low,
      rig: fit.rig,
      subsystem: fit.subsystem,
    },
    drones: fit.drones,
    cargo: fit.cargo,
    instructions: fit.instructions,
  };
  return JSON.stringify(payload, null, 2);
}
