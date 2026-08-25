import type { WormholeCommandStore, WormholeConnectionRecord, WormholeScanSnapshot, WormholeSystemRecord } from "./types";

export type WormholeHistoricalSnapshot = {
  systems: WormholeSystemRecord[];
  connections: WormholeConnectionRecord[];
  scans: WormholeScanSnapshot[];
};

export function reconstructWormholeHistory(store: WormholeCommandStore | null, at: string | number | Date): WormholeHistoricalSnapshot {
  const target = at instanceof Date ? at.getTime() : typeof at === "number" ? at : Date.parse(at);
  if (!store || !Number.isFinite(target)) return { systems: [], connections: [], scans: [] };
  const systems = Object.values(store.systems).filter((row) => Date.parse(row.discoveredAt) <= target && (!row.archivedAt || Date.parse(row.archivedAt) > target));
  const systemIds = new Set(systems.map((row) => row.systemId));
  const connections = Object.values(store.connections).filter((row) => {
    if (Date.parse(row.discoveredAt) > target) return false;
    if (row.removedAt && Date.parse(row.removedAt) <= target) return false;
    if (row.expiresAt && Date.parse(row.expiresAt) <= target) return false;
    return systemIds.has(row.fromSystemId) && (!row.toSystemId || systemIds.has(row.toSystemId));
  });
  const latestBySystem = new Map<number, WormholeScanSnapshot>();
  for (const scan of store.scanHistory) if (Date.parse(scan.scannedAt) <= target) latestBySystem.set(scan.systemId, scan);
  return { systems, connections, scans: [...latestBySystem.values()] };
}
