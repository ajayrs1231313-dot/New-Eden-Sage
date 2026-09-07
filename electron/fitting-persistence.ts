import { promises as fs } from "node:fs";
import path from "node:path";

import { USER_DATA_ROOT } from "./data-paths";

export const FITTING_STORE_SCHEMA_VERSION = 1;
export const FITTING_STORE_MIGRATION_VERSION = 1;
export const FITTING_STORE_FILE = "mcp-renderer-data.json";

type JsonRecord = Record<string, unknown>;

export type FittingPersistentState = JsonRecord & {
  schemaVersion: number;
  migrationVersion: number;
  savedFits: JsonRecord[];
  fitLibraryMeta: Record<string, unknown>;
  selectedFitId?: string;
  updatedAt?: string;
  migratedAt?: string;
};

export type FittingPersistenceSaveOptions = {
  allowEmptyOverwrite?: boolean;
};

function objectValue(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function fitId(value: JsonRecord) {
  return typeof value.id === "string" ? value.id.trim() : "";
}

function mergeMissingTopLevel(canonical: JsonRecord, legacy: JsonRecord): JsonRecord {
  const merged = { ...canonical };
  for (const [key, value] of Object.entries(legacy)) {
    if (merged[key] === undefined || merged[key] === null) merged[key] = value;
  }
  return merged;
}

function mergeMeta(canonical: unknown, legacy: unknown) {
  const canonicalMap = objectValue(canonical);
  const legacyMap = objectValue(legacy);
  const result: Record<string, unknown> = { ...canonicalMap };
  for (const [id, legacyValue] of Object.entries(legacyMap)) {
    if (!(id in result)) {
      result[id] = legacyValue;
      continue;
    }
    const current = result[id];
    if (current && typeof current === "object" && !Array.isArray(current) && legacyValue && typeof legacyValue === "object" && !Array.isArray(legacyValue)) {
      result[id] = { ...legacyValue as JsonRecord, ...current as JsonRecord };
    }
  }
  return result;
}

export function normalizeFittingPersistentState(value: unknown): FittingPersistentState {
  const record = objectValue(value);
  const savedFits = Array.isArray(record.savedFits)
    ? record.savedFits.filter((item): item is JsonRecord => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
  const selectedFitId = typeof record.selectedFitId === "string" ? record.selectedFitId : undefined;
  return {
    ...record,
    schemaVersion: FITTING_STORE_SCHEMA_VERSION,
    migrationVersion: FITTING_STORE_MIGRATION_VERSION,
    savedFits,
    fitLibraryMeta: objectValue(record.fitLibraryMeta),
    ...(selectedFitId ? { selectedFitId } : {}),
  } as FittingPersistentState;
}

export function mergeFittingPersistentStates(canonicalValue: unknown, legacyValue: unknown): FittingPersistentState {
  const canonical = normalizeFittingPersistentState(canonicalValue);
  const legacy = normalizeFittingPersistentState(legacyValue);
  const mergedById = new Map<string, JsonRecord>();
  const idless: JsonRecord[] = [];

  for (const fit of canonical.savedFits) {
    const id = fitId(fit);
    if (id) mergedById.set(id, fit); else idless.push(fit);
  }
  for (const fit of legacy.savedFits) {
    const id = fitId(fit);
    if (!id) {
      const serialized = JSON.stringify(fit);
      if (!idless.some((current) => JSON.stringify(current) === serialized)) idless.push(fit);
      continue;
    }
    const existing = mergedById.get(id);
    mergedById.set(id, existing ? mergeMissingTopLevel(existing, fit) : fit);
  }

  const savedFits = [...mergedById.values(), ...idless];
  const ids = new Set(savedFits.map(fitId).filter(Boolean));
  const selectedFitId = canonical.selectedFitId && ids.has(canonical.selectedFitId)
    ? canonical.selectedFitId
    : legacy.selectedFitId && ids.has(legacy.selectedFitId)
      ? legacy.selectedFitId
      : undefined;

  return {
    ...legacy,
    ...canonical,
    schemaVersion: FITTING_STORE_SCHEMA_VERSION,
    migrationVersion: FITTING_STORE_MIGRATION_VERSION,
    savedFits,
    fitLibraryMeta: mergeMeta(canonical.fitLibraryMeta, legacy.fitLibraryMeta),
    ...(selectedFitId ? { selectedFitId } : {}),
  };
}

export function fittingStorePath(root = USER_DATA_ROOT) {
  return path.join(root, FITTING_STORE_FILE);
}

async function readRawStore(root = USER_DATA_ROOT): Promise<unknown> {
  try { return JSON.parse(await fs.readFile(fittingStorePath(root), "utf8")); }
  catch { return {}; }
}

export async function readCanonicalFittingStore(root = USER_DATA_ROOT): Promise<FittingPersistentState> {
  return normalizeFittingPersistentState(await readRawStore(root));
}

function hasPersistenceData(value: FittingPersistentState) {
  return value.savedFits.length > 0 || Object.keys(value.fitLibraryMeta).length > 0 || Boolean(value.selectedFitId);
}

async function writeAtomic(root: string, value: FittingPersistentState) {
  await fs.mkdir(root, { recursive: true });
  const target = fittingStorePath(root);
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temp, JSON.stringify(value), { encoding: "utf8", mode: 0o600 });
  try {
    await fs.rename(temp, target);
  } catch {
    await fs.copyFile(temp, target);
    await fs.unlink(temp).catch(() => undefined);
  }
}

async function snapshotMigration(root: string, canonical: FittingPersistentState, legacy: FittingPersistentState) {
  const backupRoot = path.join(root, "Backups", "Fittings");
  await fs.mkdir(backupRoot, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backup = path.join(backupRoot, `pre-migration-${stamp}-${process.pid}.json`);
  await fs.writeFile(backup, JSON.stringify({
    schema: "new-eden-sage.fitting-migration-backup.v1",
    capturedAt: new Date().toISOString(),
    canonical,
    legacy,
  }, null, 2), { encoding: "utf8", mode: 0o600 });
  return backup;
}

export async function hydrateCanonicalFittingStore(legacyValue: unknown, root = USER_DATA_ROOT): Promise<FittingPersistentState> {
  const canonical = await readCanonicalFittingStore(root);
  const legacy = normalizeFittingPersistentState(legacyValue);
  const merged = mergeFittingPersistentStates(canonical, legacy);
  const canonicalCore = JSON.stringify({ savedFits: canonical.savedFits, fitLibraryMeta: canonical.fitLibraryMeta, selectedFitId: canonical.selectedFitId });
  const mergedCore = JSON.stringify({ savedFits: merged.savedFits, fitLibraryMeta: merged.fitLibraryMeta, selectedFitId: merged.selectedFitId });

  if (hasPersistenceData(legacy) && canonicalCore !== mergedCore) {
    await snapshotMigration(root, canonical, legacy);
    const next = { ...merged, migratedAt: canonical.migratedAt ?? new Date().toISOString(), updatedAt: new Date().toISOString() };
    await writeAtomic(root, next);
    return next;
  }

  return canonical;
}

export async function saveCanonicalFittingStore(value: unknown, root = USER_DATA_ROOT, options: FittingPersistenceSaveOptions = {}): Promise<FittingPersistentState> {
  const current = await readCanonicalFittingStore(root);
  const incoming = normalizeFittingPersistentState(value);
  if (current.savedFits.length > 0 && incoming.savedFits.length === 0 && options.allowEmptyOverwrite !== true) {
    return current;
  }

  const next: FittingPersistentState = {
    ...current,
    ...incoming,
    schemaVersion: FITTING_STORE_SCHEMA_VERSION,
    migrationVersion: FITTING_STORE_MIGRATION_VERSION,
    savedFits: incoming.savedFits,
    fitLibraryMeta: incoming.fitLibraryMeta,
    ...(incoming.selectedFitId ? { selectedFitId: incoming.selectedFitId } : current.selectedFitId ? { selectedFitId: current.selectedFitId } : {}),
    updatedAt: new Date().toISOString(),
  };
  if (next.selectedFitId && !next.savedFits.some((fit) => fitId(fit) === next.selectedFitId)) delete next.selectedFitId;
  await writeAtomic(root, next);
  return next;
}