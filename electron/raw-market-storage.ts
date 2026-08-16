import { promises as fs } from "node:fs";
import path from "node:path";
import { gzip, gunzip } from "node:zlib";
import { promisify } from "node:util";
import { MARKET_DATA_ROOT } from "./data-paths";
import type { MarketOrder, RegionInfo } from "./market";

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

export const RAW_MARKET_ROOT = process.env.NEW_EDEN_SAGE_RAW_MARKET_ROOT || path.join(MARKET_DATA_ROOT, "Raw Orders");
const CURRENT_MANIFEST = path.join(RAW_MARKET_ROOT, "current.json");

export type RawMarketMode = "single" | "all" | "radius";

export type RawRegionEntry = {
  regionId: number;
  regionName: string;
  orderCount: number;
  file: string;
  savedAt: string;
};

export type RawMarketSnapshot = {
  schemaVersion: 1;
  id: string;
  mode: RawMarketMode;
  createdAt: string;
  completedAt?: string;
  complete: boolean;
  regionCount: number;
  orderCount: number;
  regions: RawRegionEntry[];
};

function safeTimestamp(value: string) {
  return value.replace(/[:.]/g, "-");
}

function safeName(value: string) {
  return value.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "region";
}

function snapshotRoot(snapshot: Pick<RawMarketSnapshot, "id">) {
  return path.join(RAW_MARKET_ROOT, snapshot.id);
}

function manifestPath(snapshot: Pick<RawMarketSnapshot, "id">) {
  return path.join(snapshotRoot(snapshot), "manifest.json");
}

function currentManifestPath(mode?: RawMarketMode) {
  return mode ? path.join(RAW_MARKET_ROOT, `current-${mode}.json`) : CURRENT_MANIFEST;
}

async function atomicJson(filePath: string, value: unknown) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const partial = `${filePath}.${process.pid}.${Date.now()}.partial`;
  await fs.writeFile(partial, JSON.stringify(value), "utf8");
  await fs.rename(partial, filePath);
}

export async function beginRawMarketSnapshot(mode: RawMarketMode): Promise<RawMarketSnapshot> {
  const createdAt = new Date().toISOString();
  const snapshot: RawMarketSnapshot = {
    schemaVersion: 1,
    id: `${safeTimestamp(createdAt)}-${mode}`,
    mode,
    createdAt,
    complete: false,
    regionCount: 0,
    orderCount: 0,
    regions: [],
  };
  await fs.mkdir(path.join(snapshotRoot(snapshot), "regions"), { recursive: true });
  await atomicJson(manifestPath(snapshot), snapshot);
  return snapshot;
}

export async function saveRawMarketRegionDetached(
  snapshot: RawMarketSnapshot,
  region: RegionInfo,
  orders: MarketOrder[],
): Promise<RawRegionEntry> {
  const fileName = `${region.regionId}-${safeName(region.name)}.json.gz`;
  const relativeFile = path.join(snapshot.id, "regions", fileName);
  const finalPath = path.join(RAW_MARKET_ROOT, relativeFile);
  const partialPath = `${finalPath}.${process.pid}.${Date.now()}.partial`;
  const payload = {
    schemaVersion: 1,
    snapshotId: snapshot.id,
    snapshotCreatedAt: snapshot.createdAt,
    regionId: region.regionId,
    regionName: region.name,
    orderCount: orders.length,
    orders,
  };
  const compressed = await gzipAsync(Buffer.from(JSON.stringify(payload), "utf8"), { level: 6 });
  await fs.writeFile(partialPath, compressed);
  await fs.rename(partialPath, finalPath);
  return {
    regionId: region.regionId,
    regionName: region.name,
    orderCount: orders.length,
    file: relativeFile,
    savedAt: new Date().toISOString(),
  };
}

export async function saveRawMarketRegion(
  snapshot: RawMarketSnapshot,
  region: RegionInfo,
  orders: MarketOrder[],
) {
  const entry = await saveRawMarketRegionDetached(snapshot, region, orders);
  const existingIndex = snapshot.regions.findIndex((item) => item.regionId === region.regionId);
  if (existingIndex >= 0) snapshot.regions[existingIndex] = entry;
  else snapshot.regions.push(entry);
  snapshot.regionCount = snapshot.regions.length;
  snapshot.orderCount = snapshot.regions.reduce((sum, item) => sum + item.orderCount, 0);
  await atomicJson(manifestPath(snapshot), snapshot);
  return entry;
}

export async function completeRawMarketSnapshot(snapshot: RawMarketSnapshot) {
  snapshot.complete = true;
  snapshot.completedAt = new Date().toISOString();
  snapshot.regionCount = snapshot.regions.length;
  snapshot.orderCount = snapshot.regions.reduce((sum, item) => sum + item.orderCount, 0);
  snapshot.regions.sort((a, b) => a.regionName.localeCompare(b.regionName));
  await atomicJson(manifestPath(snapshot), snapshot);
  await atomicJson(CURRENT_MANIFEST, snapshot);
  await atomicJson(currentManifestPath(snapshot.mode), snapshot);
  return snapshot;
}

export async function loadCurrentRawMarketManifest(mode?: RawMarketMode): Promise<RawMarketSnapshot | null> {
  const candidates = mode ? [currentManifestPath(mode), CURRENT_MANIFEST] : [CURRENT_MANIFEST];
  for (const filePath of candidates) {
    try {
      const value = JSON.parse(await fs.readFile(filePath, "utf8")) as RawMarketSnapshot;
      if (!mode || value.mode === mode) return value;
    } catch {
      // Try the next compatible manifest.
    }
  }
  return null;
}

export async function loadRawMarketRegion(regionId: number, snapshot?: RawMarketSnapshot) {
  const manifest = snapshot ?? (await loadCurrentRawMarketManifest());
  if (!manifest) return null;
  const entry = manifest.regions.find((item) => item.regionId === regionId);
  if (!entry) return null;
  const compressed = await fs.readFile(path.join(RAW_MARKET_ROOT, entry.file));
  return JSON.parse((await gunzipAsync(compressed)).toString("utf8")) as {
    schemaVersion: 1;
    snapshotId: string;
    snapshotCreatedAt: string;
    regionId: number;
    regionName: string;
    orderCount: number;
    orders: MarketOrder[];
  };
}

export async function loadRecentRawMarketManifests(
  mode: RawMarketMode,
  limit = 2,
): Promise<RawMarketSnapshot[]> {
  await fs.mkdir(RAW_MARKET_ROOT, { recursive: true });
  const entries = await fs.readdir(RAW_MARKET_ROOT, { withFileTypes: true });
  const manifests: RawMarketSnapshot[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const value = JSON.parse(
        await fs.readFile(path.join(RAW_MARKET_ROOT, entry.name, "manifest.json"), "utf8"),
      ) as RawMarketSnapshot;
      if (value.mode === mode && value.complete) manifests.push(value);
    } catch {
      // Ignore incomplete or unrelated directories.
    }
  }
  return manifests
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, Math.max(1, limit));
}
