import { app, BrowserWindow, ipcMain } from "electron";
import { reconcileWormholeScan } from "./wormhole-scan-reconcile";
import { promises as fs } from "node:fs";
import path from "node:path";

export type WormholeSignatureKind = "wormhole" | "gas" | "relic" | "data" | "combat" | "ore" | "unknown";
export type WormholeSystemStatus = "unknown" | "friendly" | "occupied" | "hostile" | "empty" | "unscanned";
export type WormholeConnectionStatus = "unknown" | "active" | "eol" | "critical" | "quarantined" | "expired";
export type WormholeSiteState = "active" | "triggered" | "cleared";
export type WormholeWatchKind = "system" | "class" | "effect" | "wormhole-type" | "frigate-hole" | "new-k162" | "hostile-activity" | "near-home" | "eol-connection" | "critical-connection";
export type WormholeWatchRecord = { watchId:string; kind:WormholeWatchKind; value?:string; enabled:boolean; createdAt:string; updatedAt:string };
export type WormholeWatchAlert = { alertId:string; watchId:string; kind:WormholeWatchKind; fingerprint:string; message:string; systemId?:number; connectionId?:string; createdAt:string };
export type WormholeSiteStateEvent = { state: WormholeSiteState; changedAt: string; editorCharacterId?: string; editorCharacterName?: string };

export type WormholeSignatureObservation = {
  id: string;
  group: string;
  type: string;
  name: string;
  strength: string;
  distance: string;
  kind: WormholeSignatureKind;
  raw: string;
};

export type WormholeSystemRecord = {
  systemId: number;
  systemName: string;
  alias?: string;
  notes?: string;
  status: WormholeSystemStatus;
  discoveredAt: string;
  updatedAt: string;
  lastScannedAt?: string;
  archivedAt?: string;
  createdByCharacterId?: string;
  createdByCharacterName?: string;
  editedByCharacterId?: string;
  editedByCharacterName?: string;
  pinned?: boolean;
};

export type WormholeSignatureRecord = WormholeSignatureObservation & {
  signatureKey: string;
  systemId: number;
  systemName: string;
  status: "active" | "missing";
  firstSeenAt: string;
  lastSeenAt: string;
  lastChangedAt: string;
  missingSince?: string;
  createdByCharacterId?: string;
  createdByCharacterName?: string;
  editedByCharacterId?: string;
  editedByCharacterName?: string;
  siteState?: WormholeSiteState;
  bookmarkName?: string;
  metadataUpdatedAt?: string;
  siteStateHistory?: WormholeSiteStateEvent[];
};

export type WormholeConnectionRecord = {
  connectionId: string;
  fromSystemId: number;
  toSystemId?: number;
  fromSignatureId?: string;
  toSignatureId?: string;
  wormholeType?: string;
  status: WormholeConnectionStatus;
  notes?: string;
  label?: string;
  discoveredAt: string;
  updatedAt: string;
  expiresAt?: string;
  createdByCharacterId?: string;
  createdByCharacterName?: string;
  editedByCharacterId?: string;
  editedByCharacterName?: string;
  previousStatus?: WormholeConnectionStatus;
  quarantinedAt?: string;
  quarantineReason?: string;
  removedAt?: string;
};

export type WormholeScanSnapshot = {
  scanId: string;
  systemId: number;
  systemName: string;
  characterId: string;
  characterName: string;
  scannedAt: string;
  signatures: WormholeSignatureObservation[];
};

export type WormholeMapLayout = {
  positions: Record<string, { x: number; y: number }>;
  zoom: number;
  panX: number;
  panY: number;
  snapToGrid: boolean;
};

export type WormholeCleanupCandidate = {
  systemId: number;
  systemName: string;
  alias?: string;
  lastEvidenceAt: string;
  inactiveHours: number;
  reason: string;
};

export type WormholeCleanupPreview = {
  generatedAt: string;
  homeSystemId?: number;
  minInactiveHours: number;
  protectedSystemIds: number[];
  candidates: WormholeCleanupCandidate[];
  message: string;
};

export type WormholeCommandStore = {
  schemaVersion: 1;
  createdAt: string;
  updatedAt: string;
  systems: Record<string, WormholeSystemRecord>;
  signatures: Record<string, WormholeSignatureRecord>;
  connections: Record<string, WormholeConnectionRecord>;
  scanHistory: WormholeScanSnapshot[];
  mapLayout: WormholeMapLayout;
  homeSystemId?: number;
  rallySystemId?: number;
  watches: WormholeWatchRecord[];
  alerts: WormholeWatchAlert[];
};
export type WormholeSharedChainPayload = {
  schema: "new-eden-sage.wormhole-chain.v1"; payloadVersion: 1; sharedRevision: string; generatedAt: string; sourceStoreUpdatedAt: string;
  systems: Record<string, WormholeSystemRecord>; signatures: Record<string, WormholeSignatureRecord>; connections: Record<string, WormholeConnectionRecord>; scanHistory: WormholeScanSnapshot[]; mapLayout: WormholeMapLayout; homeSystemId?: number; rallySystemId?: number;
};


const SCHEMA_VERSION = 1 as const;
const MAX_SCAN_HISTORY = 5000;

function nowIso() { return new Date().toISOString(); }
function storePath() { return path.join(app.getPath("userData"), "wormhole-command-store-v1.json"); }
function signatureKey(systemId: number, id: string) { return `${systemId}:${id.toUpperCase()}`; }

function emptyStore(): WormholeCommandStore {
  const now = nowIso();
  return { schemaVersion: SCHEMA_VERSION, createdAt: now, updatedAt: now, systems: {}, signatures: {}, connections: {}, scanHistory: [], mapLayout: { positions: {}, zoom: 1, panX: 0, panY: 0, snapToGrid: true }, homeSystemId: undefined, rallySystemId: undefined, watches: [], alerts: [] };
}

function normalizeStore(value: any): WormholeCommandStore {
  if (!value || typeof value !== "object") return emptyStore();
  const createdAt = typeof value.createdAt === "string" ? value.createdAt : nowIso();
  return {
    schemaVersion: SCHEMA_VERSION,
    createdAt,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : createdAt,
    systems: value.systems && typeof value.systems === "object" && !Array.isArray(value.systems) ? value.systems : {},
    signatures: value.signatures && typeof value.signatures === "object" && !Array.isArray(value.signatures) ? value.signatures : {},
    connections: value.connections && typeof value.connections === "object" && !Array.isArray(value.connections) ? value.connections : {},
    scanHistory: Array.isArray(value.scanHistory) ? value.scanHistory.slice(-MAX_SCAN_HISTORY) : [],
    mapLayout: {
      positions: value.mapLayout?.positions && typeof value.mapLayout.positions === "object" && !Array.isArray(value.mapLayout.positions) ? value.mapLayout.positions : {},
      zoom: Number.isFinite(Number(value.mapLayout?.zoom)) ? Math.max(0.45, Math.min(2.25, Number(value.mapLayout.zoom))) : 1,
      panX: Number.isFinite(Number(value.mapLayout?.panX)) ? Math.max(0, Number(value.mapLayout.panX)) : 0,
      panY: Number.isFinite(Number(value.mapLayout?.panY)) ? Math.max(0, Number(value.mapLayout.panY)) : 0,
      snapToGrid: value.mapLayout?.snapToGrid !== false,
    },
    homeSystemId: Number.isSafeInteger(Number(value.homeSystemId)) && Number(value.homeSystemId) > 0 ? Number(value.homeSystemId) : undefined,
    rallySystemId: Number.isSafeInteger(Number(value.rallySystemId)) && Number(value.rallySystemId) > 0 ? Number(value.rallySystemId) : undefined,
    watches: Array.isArray(value.watches) ? value.watches.slice(-200) : [],
    alerts: Array.isArray(value.alerts) ? value.alerts.slice(-500) : [],
  };
}

async function readStore(): Promise<WormholeCommandStore> {
  try { return normalizeStore(JSON.parse(await fs.readFile(storePath(), "utf8"))); }
  catch { return emptyStore(); }
}

async function writeStore(store: WormholeCommandStore) {
  const target = storePath();
  await fs.mkdir(path.dirname(target), { recursive: true });
  const next = { ...store, schemaVersion: SCHEMA_VERSION, updatedAt: nowIso(), scanHistory: store.scanHistory.slice(-MAX_SCAN_HISTORY) } as WormholeCommandStore;
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(next, null, 2), { encoding: "utf8", mode: 0o600 });
  await fs.rm(target, { force: true }).catch(() => undefined);
  await fs.rename(temporary, target);
  for (const candidate of BrowserWindow.getAllWindows()) {
    if (!candidate.isDestroyed()) candidate.webContents.send("wormhole:store-updated", next);
  }
  return next;
}

function normalizeObservation(value: any): WormholeSignatureObservation | null {
  const id = String(value?.id ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9]{3}-[0-9]{3}$/.test(id)) return null;
  const kinds: WormholeSignatureKind[] = ["wormhole", "gas", "relic", "data", "combat", "ore", "unknown"];
  const kind = kinds.includes(value?.kind) ? value.kind as WormholeSignatureKind : "unknown";
  return {
    id,
    group: String(value?.group ?? "").slice(0, 200),
    type: String(value?.type ?? "").slice(0, 200),
    name: String(value?.name ?? "").slice(0, 300),
    strength: String(value?.strength ?? "").slice(0, 60),
    distance: String(value?.distance ?? "").slice(0, 60),
    kind,
    raw: String(value?.raw ?? "").slice(0, 1200),
  };
}

function latestScanForSystem(store: WormholeCommandStore, systemId: number) {
  for (let index = store.scanHistory.length - 1; index >= 0; index -= 1) {
    if (Number(store.scanHistory[index]?.systemId) === systemId) return store.scanHistory[index];
  }
  return undefined;
}

function applyScan(store: WormholeCommandStore, input: any) {
  const systemId = Number(input?.systemId ?? 0);
  if (!Number.isSafeInteger(systemId) || systemId <= 0) throw new Error("A valid solar-system ID is required for the wormhole scan.");
  const systemName = String(input?.systemName ?? `System ${systemId}`).trim().slice(0, 200) || `System ${systemId}`;
  const characterId = String(input?.characterId ?? "").trim();
  const characterName = String(input?.characterName ?? "").trim().slice(0, 200);
  const scannedAt = typeof input?.scannedAt === "string" && Number.isFinite(Date.parse(input.scannedAt)) ? new Date(input.scannedAt).toISOString() : nowIso();
  const signatures = (Array.isArray(input?.signatures) ? input.signatures : []).map(normalizeObservation).filter((row: WormholeSignatureObservation | null): row is WormholeSignatureObservation => Boolean(row));
  if (!signatures.length) throw new Error("The scan contains no valid EVE signature IDs.");

  const priorSnapshot = latestScanForSystem(store, systemId);
  const current = new Map(signatures.map((row: WormholeSignatureObservation) => [row.id, row]));
  const reconciliation = reconcileWormholeScan(priorSnapshot?.signatures ?? [], signatures) as Array<WormholeSignatureObservation & { state: "new" | "existing" | "changed" | "missing" }>;
  const currentStates = new Map(reconciliation.filter((row) => row.state !== "missing").map((row) => [row.id, row.state] as const));

  const existingSystem = store.systems[String(systemId)];
  store.systems[String(systemId)] = {
    systemId,
    systemName,
    alias: existingSystem?.alias,
    notes: existingSystem?.notes,
    status: existingSystem?.status ?? "unknown",
    discoveredAt: existingSystem?.discoveredAt ?? scannedAt,
    updatedAt: scannedAt,
    lastScannedAt: scannedAt,
    archivedAt: undefined,
    createdByCharacterId: existingSystem?.createdByCharacterId ?? (characterId || undefined),
    createdByCharacterName: existingSystem?.createdByCharacterName ?? (characterName || undefined),
    editedByCharacterId: characterId || existingSystem?.editedByCharacterId,
    editedByCharacterName: characterName || existingSystem?.editedByCharacterName,
    pinned: existingSystem?.pinned,
  };

  for (const observation of signatures) {
    const state = currentStates.get(observation.id) ?? "existing";
    const key = signatureKey(systemId, observation.id);
    const existing = store.signatures[key];
    store.signatures[key] = {
      ...observation,
      signatureKey: key,
      systemId,
      systemName,
      status: "active",
      firstSeenAt: existing?.firstSeenAt ?? scannedAt,
      lastSeenAt: scannedAt,
      lastChangedAt: state === "changed" || state === "new" ? scannedAt : existing?.lastChangedAt ?? scannedAt,
      missingSince: undefined,
      createdByCharacterId: existing?.createdByCharacterId ?? (characterId || undefined),
      createdByCharacterName: existing?.createdByCharacterName ?? (characterName || undefined),
      editedByCharacterId: characterId || existing?.editedByCharacterId,
      editedByCharacterName: characterName || existing?.editedByCharacterName,
      siteState: existing?.siteState ?? (observation.kind === "wormhole" ? undefined : "active"),
      bookmarkName: existing?.bookmarkName,
      metadataUpdatedAt: existing?.metadataUpdatedAt,
      siteStateHistory: existing?.siteStateHistory,
    };

    for (const [connectionId, connection] of Object.entries(store.connections)) {
      const linkedFrom = connection.fromSystemId === systemId && connection.fromSignatureId === observation.id;
      const linkedTo = connection.toSystemId === systemId && connection.toSignatureId === observation.id;
      if (!linkedFrom && !linkedTo) continue;
      if (connection.status === "quarantined" && connection.quarantineReason?.startsWith("Signature ")) {
        store.connections[connectionId] = {
          ...connection,
          status: connection.previousStatus ?? "active",
          previousStatus: undefined,
          quarantinedAt: undefined,
          quarantineReason: undefined,
          updatedAt: scannedAt,
        };
      }
    }
  }

  for (const prior of priorSnapshot?.signatures ?? []) {
    if (current.has(prior.id)) continue;
    const key = signatureKey(systemId, prior.id);
    const existing = store.signatures[key];
    if (existing) store.signatures[key] = { ...existing, status: "missing", missingSince: existing.missingSince ?? scannedAt };
    for (const [connectionId, connection] of Object.entries(store.connections)) {
      const linkedFrom = connection.fromSystemId === systemId && connection.fromSignatureId === prior.id;
      const linkedTo = connection.toSystemId === systemId && connection.toSignatureId === prior.id;
      if (!linkedFrom && !linkedTo) continue;
      if (connection.status === "expired" || connection.status === "quarantined") continue;
      store.connections[connectionId] = {
        ...connection,
        previousStatus: connection.status,
        status: "quarantined",
        quarantinedAt: scannedAt,
        quarantineReason: `Signature ${prior.id} missing from ${systemName} scan`,
        updatedAt: scannedAt,
      };
    }
  }

  const scanId = `${systemId}:${scannedAt}:${Math.random().toString(16).slice(2)}`;
  store.scanHistory.push({ scanId, systemId, systemName, characterId, characterName, scannedAt, signatures });
  store.scanHistory = store.scanHistory.slice(-MAX_SCAN_HISTORY);
  store.updatedAt = scannedAt;
  reconciliation.sort((a, b) => a.id.localeCompare(b.id));
  return reconciliation;
}

async function importLegacyScans(value: any) {
  const store = await readStore();
  if (!value || typeof value !== "object" || Array.isArray(value)) return store;
  const seen = new Set(store.scanHistory.map((scan) => `${scan.systemId}:${scan.scannedAt}`));
  const rows = Object.values(value as Record<string, any>).filter(Boolean).sort((a: any, b: any) => String(a.scannedAt ?? "").localeCompare(String(b.scannedAt ?? "")));
  let changed = false;
  for (const scan of rows as any[]) {
    const systemId = Number(scan?.systemId ?? 0);
    const scannedAt = String(scan?.scannedAt ?? "");
    if (!systemId || !scannedAt || seen.has(`${systemId}:${scannedAt}`)) continue;
    try {
      applyScan(store, scan);
      seen.add(`${systemId}:${scannedAt}`);
      changed = true;
    } catch { /* malformed legacy rows are ignored rather than corrupting the durable store */ }
  }
  return changed ? writeStore(store) : store;
}

async function observeSystem(input: any) {
  const store = await readStore();
  const systemId = Number(input?.systemId ?? 0);
  if (!Number.isSafeInteger(systemId) || systemId <= 0) throw new Error("A valid solar-system ID is required.");
  const systemName = String(input?.systemName ?? `System ${systemId}`).trim().slice(0, 200) || `System ${systemId}`;
  const observedAt = typeof input?.observedAt === "string" && Number.isFinite(Date.parse(input.observedAt)) ? new Date(input.observedAt).toISOString() : nowIso();
  const characterId = String(input?.characterId ?? "").trim() || undefined;
  const characterName = String(input?.characterName ?? "").trim().slice(0, 200) || undefined;
  const existing = store.systems[String(systemId)];
  store.systems[String(systemId)] = {
    systemId, systemName,
    alias: existing?.alias, notes: existing?.notes,
    status: existing?.status ?? "unscanned",
    discoveredAt: existing?.discoveredAt ?? observedAt,
    updatedAt: observedAt, lastScannedAt: existing?.lastScannedAt, archivedAt: undefined,
    createdByCharacterId: existing?.createdByCharacterId ?? characterId,
    createdByCharacterName: existing?.createdByCharacterName ?? characterName,
    editedByCharacterId: characterId ?? existing?.editedByCharacterId,
    editedByCharacterName: characterName ?? existing?.editedByCharacterName,
    pinned: existing?.pinned,
  };
  return writeStore(store);
}

async function upsertWatch(input:any) {
  const store = await readStore();
  const kinds:WormholeWatchKind[] = ["system","class","effect","wormhole-type","frigate-hole","new-k162","hostile-activity","near-home","eol-connection","critical-connection"];
  if (!kinds.includes(input?.kind)) throw new Error("Unknown wormhole watch kind.");
  const now = nowIso();
  const watchId = String(input?.watchId ?? "").trim() || `watch:${Date.now()}:${Math.random().toString(16).slice(2)}`;
  const existing = store.watches.find((row) => row.watchId === watchId);
  const value = String(input?.value ?? existing?.value ?? "").trim().slice(0,160) || undefined;
  const watch:WormholeWatchRecord = { watchId, kind:input.kind, value, enabled:input?.enabled == null ? existing?.enabled !== false : Boolean(input.enabled), createdAt:existing?.createdAt ?? now, updatedAt:now };
  store.watches = [...store.watches.filter((row) => row.watchId !== watchId), watch].slice(-200);
  return writeStore(store);
}

async function removeWatch(watchIdValue:unknown) {
  const store = await readStore();
  const watchId = String(watchIdValue ?? "");
  store.watches = store.watches.filter((row) => row.watchId !== watchId);
  return writeStore(store);
}

async function recordWatchAlert(input:any) {
  const store = await readStore();
  const watchId = String(input?.watchId ?? "").trim();
  const fingerprint = String(input?.fingerprint ?? "").trim().slice(0,300);
  const watch = store.watches.find((row) => row.watchId === watchId && row.enabled);
  if (!watch || !fingerprint) return { store, created:false };
  if (store.alerts.some((row) => row.watchId === watchId && row.fingerprint === fingerprint)) return { store, created:false };
  const alert:WormholeWatchAlert = { alertId:`alert:${Date.now()}:${Math.random().toString(16).slice(2)}`, watchId, kind:watch.kind, fingerprint, message:String(input?.message ?? "Wormhole watch triggered").slice(0,500), systemId:Number.isSafeInteger(Number(input?.systemId)) && Number(input.systemId)>0 ? Number(input.systemId) : undefined, connectionId:String(input?.connectionId ?? "").trim() || undefined, createdAt:nowIso() };
  store.alerts = [...store.alerts, alert].slice(-500);
  return { store:await writeStore(store), created:true, alert };
}

async function dismissWatchAlert(alertIdValue:unknown) {
  const store = await readStore();
  const alertId = String(alertIdValue ?? "");
  store.alerts = store.alerts.filter((row) => row.alertId !== alertId);
  return writeStore(store);
}

async function patchMapLayout(input: any) {
  const store = await readStore();
  const current = store.mapLayout;
  const positions = input?.positions && typeof input.positions === "object" && !Array.isArray(input.positions)
    ? Object.fromEntries(Object.entries(input.positions).flatMap(([key, value]: [string, any]) => {
        const systemId = Number(key);
        const x = Number(value?.x);
        const y = Number(value?.y);
        return Number.isSafeInteger(systemId) && systemId > 0 && Number.isFinite(x) && Number.isFinite(y)
          ? [[String(systemId), { x: Math.max(0, Math.min(20000, x)), y: Math.max(0, Math.min(20000, y)) }]]
          : [];
      }))
    : current.positions;
  store.mapLayout = {
    positions,
    zoom: input?.zoom == null ? current.zoom : Math.max(0.45, Math.min(2.25, Number(input.zoom) || 1)),
    panX: input?.panX == null ? current.panX : Math.max(0, Number(input.panX) || 0),
    panY: input?.panY == null ? current.panY : Math.max(0, Number(input.panY) || 0),
    snapToGrid: input?.snapToGrid == null ? current.snapToGrid : Boolean(input.snapToGrid),
  };
  return writeStore(store);
}

async function patchSignature(input: any) {
  const store = await readStore();
  const systemId = Number(input?.systemId ?? 0);
  const signatureId = String(input?.signatureId ?? "").trim().toUpperCase();
  const key = signatureKey(systemId, signatureId);
  const existing = store.signatures[key];
  if (!existing) throw new Error("The signature is not present in Wormhole Command.");
  const states: WormholeSiteState[] = ["active", "triggered", "cleared"];
  const siteState = input?.siteState == null ? existing.siteState : states.includes(input.siteState) ? input.siteState as WormholeSiteState : existing.siteState;
  const bookmarkName = input?.bookmarkName == null ? existing.bookmarkName : String(input.bookmarkName).trim().slice(0, 180) || undefined;
  const metadataUpdatedAt = nowIso();
  const editorCharacterId = String(input?.editorCharacterId ?? existing.editedByCharacterId ?? "") || undefined;
  const editorCharacterName = String(input?.editorCharacterName ?? existing.editedByCharacterName ?? "").slice(0, 200) || undefined;
  const siteStateHistory = siteState && siteState !== existing.siteState
    ? [...(existing.siteStateHistory ?? []), { state: siteState, changedAt: metadataUpdatedAt, editorCharacterId, editorCharacterName }].slice(-100)
    : existing.siteStateHistory;
  store.signatures[key] = {
    ...existing,
    siteState,
    bookmarkName,
    metadataUpdatedAt,
    siteStateHistory,
    editedByCharacterId: editorCharacterId,
    editedByCharacterName: editorCharacterName,
  };
  return writeStore(store);
}

async function patchSystem(input: any) {
  const store = await readStore();
  const systemId = Number(input?.systemId ?? 0);
  const existing = store.systems[String(systemId)];
  if (!existing) throw new Error("Scan or create this system before editing its wormhole metadata.");
  const statuses: WormholeSystemStatus[] = ["unknown", "friendly", "occupied", "hostile", "empty", "unscanned"];
  const status = statuses.includes(input?.status) ? input.status as WormholeSystemStatus : existing.status;
  store.systems[String(systemId)] = {
    ...existing,
    alias: input?.alias == null ? existing.alias : String(input.alias).trim().slice(0, 120) || undefined,
    notes: input?.notes == null ? existing.notes : String(input.notes).slice(0, 6000) || undefined,
    status,
    pinned: input?.pinned == null ? existing.pinned : Boolean(input.pinned),
    updatedAt: nowIso(),
    editedByCharacterId: String(input?.editorCharacterId ?? existing.editedByCharacterId ?? "") || undefined,
    editedByCharacterName: String(input?.editorCharacterName ?? existing.editedByCharacterName ?? "").slice(0, 200) || undefined,
  };
  return writeStore(store);
}

async function archiveSystem(systemIdValue: unknown, editor?: any) {
  const store = await readStore();
  const systemId = Number(systemIdValue ?? 0);
  const existing = store.systems[String(systemId)];
  if (!existing) return store;
  const timestamp = nowIso();
  store.systems[String(systemId)] = {
    ...existing,
    archivedAt: timestamp,
    updatedAt: timestamp,
    editedByCharacterId: String(editor?.characterId ?? existing.editedByCharacterId ?? "") || undefined,
    editedByCharacterName: String(editor?.characterName ?? existing.editedByCharacterName ?? "").slice(0, 200) || undefined,
  };
  if (store.homeSystemId === systemId) store.homeSystemId = undefined;
  if (store.rallySystemId === systemId) store.rallySystemId = undefined;
  return writeStore(store);
}

async function patchMapMarkers(input: any) {
  const store = await readStore();
  if (Object.prototype.hasOwnProperty.call(input ?? {}, "homeSystemId")) {
    const id = input?.homeSystemId == null ? 0 : Number(input.homeSystemId);
    if (id && !store.systems[String(id)]) throw new Error("Home system must already exist in Wormhole Command.");
    store.homeSystemId = id > 0 ? id : undefined;
  }
  if (Object.prototype.hasOwnProperty.call(input ?? {}, "rallySystemId")) {
    const id = input?.rallySystemId == null ? 0 : Number(input.rallySystemId);
    if (id && !store.systems[String(id)]) throw new Error("Rally system must already exist in Wormhole Command.");
    store.rallySystemId = id > 0 ? id : undefined;
  }
  return writeStore(store);
}

function currentConnection(connection: WormholeConnectionRecord, nowMs: number) {
  if (connection.status === "quarantined" || connection.status === "expired") return false;
  const expiry = connection.expiresAt ? Date.parse(connection.expiresAt) : Number.NaN;
  return !(Number.isFinite(expiry) && expiry <= nowMs);
}

function cleanupPreviewForStore(store: WormholeCommandStore, minInactiveHoursValue: unknown): WormholeCleanupPreview {
  const nowMs = Date.now();
  const generatedAt = new Date(nowMs).toISOString();
  const minInactiveHours = Math.max(1, Math.min(24 * 30, Math.round(Number(minInactiveHoursValue) || 24)));
  const activeSystems = Object.values(store.systems).filter((system) => !system.archivedAt);
  const home = store.homeSystemId ? store.systems[String(store.homeSystemId)] : undefined;
  const protectedIds = new Set<number>();
  if (store.homeSystemId) protectedIds.add(store.homeSystemId);
  if (store.rallySystemId) protectedIds.add(store.rallySystemId);
  for (const system of activeSystems) if (system.pinned) protectedIds.add(system.systemId);
  if (!home || home.archivedAt) {
    return { generatedAt, homeSystemId: store.homeSystemId, minInactiveHours, protectedSystemIds: [...protectedIds], candidates: [], message: "Set an active Home system before previewing orphan cleanup." };
  }

  const activeIds = new Set(activeSystems.map((system) => system.systemId));
  const adjacency = new Map<number, Set<number>>();
  for (const id of activeIds) adjacency.set(id, new Set());
  for (const connection of Object.values(store.connections)) {
    if (!connection.toSystemId || !currentConnection(connection, nowMs)) continue;
    if (!activeIds.has(connection.fromSystemId) || !activeIds.has(connection.toSystemId)) continue;
    adjacency.get(connection.fromSystemId)?.add(connection.toSystemId);
    adjacency.get(connection.toSystemId)?.add(connection.fromSystemId);
  }

  const reachable = new Set<number>([home.systemId]);
  const queue = [home.systemId];
  for (let index = 0; index < queue.length; index += 1) {
    for (const next of adjacency.get(queue[index]) ?? []) {
      if (reachable.has(next)) continue;
      reachable.add(next);
      queue.push(next);
    }
  }

  const signatureEvidence = new Map<number, number>();
  for (const signature of Object.values(store.signatures)) {
    const evidence = Math.max(
      Date.parse(signature.lastSeenAt) || 0,
      Date.parse(signature.lastChangedAt) || 0,
      Date.parse(signature.firstSeenAt) || 0,
      Date.parse(signature.missingSince ?? "") || 0,
    );
    signatureEvidence.set(signature.systemId, Math.max(signatureEvidence.get(signature.systemId) ?? 0, evidence));
  }

  const connectionEvidence = new Map<number, number>();
  for (const connection of Object.values(store.connections)) {
    const evidence = Math.max(
      Date.parse(connection.updatedAt) || 0,
      Date.parse(connection.discoveredAt) || 0,
      Date.parse(connection.quarantinedAt ?? "") || 0,
    );
    connectionEvidence.set(connection.fromSystemId, Math.max(connectionEvidence.get(connection.fromSystemId) ?? 0, evidence));
    if (connection.toSystemId) connectionEvidence.set(connection.toSystemId, Math.max(connectionEvidence.get(connection.toSystemId) ?? 0, evidence));
  }

  const candidates = activeSystems.flatMap((system) => {
    if (reachable.has(system.systemId) || protectedIds.has(system.systemId)) return [];
    const lastEvidenceMs = Math.max(
      Date.parse(system.lastScannedAt ?? "") || 0,
      Date.parse(system.updatedAt) || 0,
      Date.parse(system.discoveredAt) || 0,
      signatureEvidence.get(system.systemId) ?? 0,
      connectionEvidence.get(system.systemId) ?? 0,
    );
    const inactiveHours = Math.max(0, (nowMs - lastEvidenceMs) / 3_600_000);
    if (inactiveHours < minInactiveHours) return [];
    return [{
      systemId: system.systemId,
      systemName: system.systemName,
      alias: system.alias,
      lastEvidenceAt: new Date(lastEvidenceMs || nowMs).toISOString(),
      inactiveHours: Math.floor(inactiveHours * 10) / 10,
      reason: "Disconnected from Home across all current non-expired links.",
    } satisfies WormholeCleanupCandidate];
  }).sort((a, b) => b.inactiveHours - a.inactiveHours || a.systemName.localeCompare(b.systemName));

  return {
    generatedAt,
    homeSystemId: home.systemId,
    minInactiveHours,
    protectedSystemIds: [...protectedIds].sort((a, b) => a - b),
    candidates,
    message: candidates.length
      ? `${candidates.length} disconnected stale system${candidates.length === 1 ? "" : "s"} can be archived without deleting history.`
      : "No unprotected disconnected systems meet the inactivity threshold.",
  };
}

async function previewCleanup(input: any) {
  return cleanupPreviewForStore(await readStore(), input?.minInactiveHours);
}

async function applyCleanup(input: any) {
  const store = await readStore();
  const preview = cleanupPreviewForStore(store, input?.minInactiveHours);
  const allowed = new Set(preview.candidates.map((candidate) => candidate.systemId));
  const requested: number[] = Array.isArray(input?.systemIds)
    ? [...new Set<number>((input.systemIds as unknown[]).map((value) => Number(value)).filter((id): id is number => Number.isSafeInteger(id) && id > 0))]
    : [];
  const archiveIds = requested.filter((id: number) => allowed.has(id));
  const timestamp = nowIso();
  const editorCharacterId = String(input?.editorCharacterId ?? "") || undefined;
  const editorCharacterName = String(input?.editorCharacterName ?? "").slice(0, 200) || undefined;
  const archivedSystemIds: number[] = [];
  for (const systemId of archiveIds) {
    const existing = store.systems[String(systemId)];
    if (!existing || existing.archivedAt || existing.pinned || store.homeSystemId === systemId || store.rallySystemId === systemId) continue;
    store.systems[String(systemId)] = {
      ...existing,
      archivedAt: timestamp,
      updatedAt: timestamp,
      editedByCharacterId: editorCharacterId ?? existing.editedByCharacterId,
      editedByCharacterName: editorCharacterName ?? existing.editedByCharacterName,
    };
    archivedSystemIds.push(systemId);
  }
  return { store: archivedSystemIds.length ? await writeStore(store) : store, archivedSystemIds, preview };
}

async function upsertConnection(input: any) {
  const store = await readStore();
  const fromSystemId = Number(input?.fromSystemId ?? 0);
  const toSystemId = input?.toSystemId == null ? undefined : Number(input.toSystemId);
  if (!Number.isSafeInteger(fromSystemId) || fromSystemId <= 0) throw new Error("A valid source system is required.");
  if (toSystemId != null && (!Number.isSafeInteger(toSystemId) || toSystemId <= 0)) throw new Error("The destination system ID is invalid.");
  if (!store.systems[String(fromSystemId)]) throw new Error("The source system is not present in Wormhole Command yet.");
  if (toSystemId != null && !store.systems[String(toSystemId)]) throw new Error("The destination system is not present in Wormhole Command yet.");
  const id = String(input?.connectionId ?? "").trim() || `wh-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const existing = store.connections[id];
  const statuses: WormholeConnectionStatus[] = ["unknown", "active", "eol", "critical", "quarantined", "expired"];
  const timestamp = nowIso();
  const record: WormholeConnectionRecord = {
    connectionId: id,
    fromSystemId,
    toSystemId,
    fromSignatureId: input?.fromSignatureId ? String(input.fromSignatureId).trim().toUpperCase().slice(0, 20) : existing?.fromSignatureId,
    toSignatureId: input?.toSignatureId ? String(input.toSignatureId).trim().toUpperCase().slice(0, 20) : existing?.toSignatureId,
    wormholeType: input?.wormholeType ? String(input.wormholeType).trim().toUpperCase().slice(0, 30) : existing?.wormholeType,
    status: statuses.includes(input?.status) ? input.status as WormholeConnectionStatus : existing?.status ?? "unknown",
    notes: input?.notes == null ? existing?.notes : String(input.notes).slice(0, 6000) || undefined,
    label: input?.label == null ? existing?.label : String(input.label).trim().slice(0, 120) || undefined,
    discoveredAt: existing?.discoveredAt ?? timestamp,
    updatedAt: timestamp,
    expiresAt: input?.expiresAt ? new Date(input.expiresAt).toISOString() : existing?.expiresAt,
    createdByCharacterId: existing?.createdByCharacterId ?? (String(input?.editorCharacterId ?? "") || undefined),
    createdByCharacterName: existing?.createdByCharacterName ?? (String(input?.editorCharacterName ?? "").slice(0, 200) || undefined),
    editedByCharacterId: String(input?.editorCharacterId ?? existing?.editedByCharacterId ?? "") || undefined,
    editedByCharacterName: String(input?.editorCharacterName ?? existing?.editedByCharacterName ?? "").slice(0, 200) || undefined,
    previousStatus: input?.status && input.status !== "quarantined" ? undefined : existing?.previousStatus,
    quarantinedAt: input?.status && input.status !== "quarantined" ? undefined : existing?.quarantinedAt,
    quarantineReason: input?.status && input.status !== "quarantined" ? undefined : existing?.quarantineReason,
  };
  store.connections[id] = record;
  return { store: await writeStore(store), connection: record };
}

async function removeConnection(connectionIdValue: unknown) {
  const store = await readStore();
  const connectionId = String(connectionIdValue ?? "").trim();
  const existing = store.connections[connectionId];
  if (!connectionId || !existing) return store;
  const timestamp = nowIso();
  store.connections[connectionId] = { ...existing, previousStatus: existing.status, status: "expired", removedAt: timestamp, updatedAt: timestamp };
  return writeStore(store);
}

const SHARED_CHAIN_SCHEMA = "new-eden-sage.wormhole-chain.v1" as const;
const SHARED_CHAIN_SOFT_LIMIT_BYTES = 470 * 1024;

async function exportSharedChain(): Promise<WormholeSharedChainPayload> {
  const store=await readStore(); let history=store.scanHistory.slice(-500);
  const make=():WormholeSharedChainPayload=>({schema:SHARED_CHAIN_SCHEMA,payloadVersion:1,sharedRevision:`${store.updatedAt}:${Object.keys(store.systems).length}:${Object.keys(store.connections).length}:${history.length}`,generatedAt:nowIso(),sourceStoreUpdatedAt:store.updatedAt,systems:store.systems,signatures:store.signatures,connections:store.connections,scanHistory:history,mapLayout:store.mapLayout,homeSystemId:store.homeSystemId,rallySystemId:store.rallySystemId});
  let payload=make(); while(Buffer.byteLength(JSON.stringify(payload),"utf8")>SHARED_CHAIN_SOFT_LIMIT_BYTES && history.length>0){history=history.slice(-Math.floor(history.length/2));payload=make();}
  if(Buffer.byteLength(JSON.stringify(payload),"utf8")>SHARED_CHAIN_SOFT_LIMIT_BYTES) throw new Error("This wormhole chain is too large for Sage Online even without scan history. Archive stale systems/connections before publishing.");
  return payload;
}

async function importSharedChain(value: unknown): Promise<WormholeCommandStore> {
  const payload=validateSharedChain(value);
  const local=await readStore(); const next=normalizeStore({schemaVersion:1,createdAt:local.createdAt,updatedAt:typeof payload.sourceStoreUpdatedAt==="string"?payload.sourceStoreUpdatedAt:nowIso(),systems:payload.systems,signatures:payload.signatures,connections:payload.connections,scanHistory:payload.scanHistory,mapLayout:payload.mapLayout,homeSystemId:payload.homeSystemId,rallySystemId:payload.rallySystemId,watches:local.watches,alerts:local.alerts});
  next.watches=local.watches; next.alerts=local.alerts; return writeStore(next);
}

function validateSharedChain(value: unknown): WormholeSharedChainPayload {
  const payload=value as Partial<WormholeSharedChainPayload>|null;
  if(!payload||payload.schema!==SHARED_CHAIN_SCHEMA||payload.payloadVersion!==1) throw new Error("Unsupported Sage wormhole-chain payload.");
  return payload as WormholeSharedChainPayload;
}

function newerBy<T>(left:T|undefined,right:T|undefined,time:(value:T)=>string|undefined):T|undefined {
  if(!left)return right; if(!right)return left; return Date.parse(time(right)??"")>=Date.parse(time(left)??"")?right:left;
}

async function mergeSharedChain(value: unknown): Promise<WormholeCommandStore> {
  const payload=validateSharedChain(value); const local=await readStore();
  const systems={...payload.systems,...local.systems};
  for(const key of new Set([...Object.keys(payload.systems??{}),...Object.keys(local.systems??{})])) systems[key]=newerBy(local.systems[key],payload.systems[key],row=>row.updatedAt)!;
  const signatures={...payload.signatures,...local.signatures};
  for(const key of new Set([...Object.keys(payload.signatures??{}),...Object.keys(local.signatures??{})])) signatures[key]=newerBy(local.signatures[key],payload.signatures[key],row=>row.metadataUpdatedAt??row.lastChangedAt??row.lastSeenAt)!;
  const connections={...payload.connections,...local.connections};
  for(const key of new Set([...Object.keys(payload.connections??{}),...Object.keys(local.connections??{})])) connections[key]=newerBy(local.connections[key],payload.connections[key],row=>row.updatedAt)!;
  const scans=new Map<string,WormholeScanSnapshot>(); for(const scan of [...(payload.scanHistory??[]),...local.scanHistory]) scans.set(scan.scanId,scan);
  const scanHistory=[...scans.values()].sort((a,b)=>Date.parse(a.scannedAt)-Date.parse(b.scannedAt)).slice(-MAX_SCAN_HISTORY);
  const next=normalizeStore({schemaVersion:1,createdAt:local.createdAt,updatedAt:nowIso(),systems,signatures,connections,scanHistory,mapLayout:{...payload.mapLayout,...local.mapLayout,positions:{...(payload.mapLayout?.positions??{}),...(local.mapLayout?.positions??{})}},homeSystemId:local.homeSystemId??payload.homeSystemId,rallySystemId:local.rallySystemId??payload.rallySystemId,watches:local.watches,alerts:local.alerts});
  next.watches=local.watches; next.alerts=local.alerts; return writeStore(next);
}

export function registerWormholeCommandIpc() {
  ipcMain.handle("wormhole:store-get", () => readStore());
  ipcMain.handle("wormhole:shared-export", () => exportSharedChain());
  ipcMain.handle("wormhole:shared-import", (_event, input: unknown) => importSharedChain(input));
  ipcMain.handle("wormhole:shared-merge", (_event, input: unknown) => mergeSharedChain(input));
  ipcMain.handle("wormhole:legacy-import", (_event, input: unknown) => importLegacyScans(input));
  ipcMain.handle("wormhole:record-scan", async (_event, input: unknown) => {
    const store = await readStore();
    const reconciliation = applyScan(store, input);
    return { store: await writeStore(store), reconciliation };
  });
  ipcMain.handle("wormhole:system-observe", (_event, input: unknown) => observeSystem(input));
  ipcMain.handle("wormhole:watch-upsert", (_event, input: unknown) => upsertWatch(input));
  ipcMain.handle("wormhole:watch-remove", (_event, watchId: unknown) => removeWatch(watchId));
  ipcMain.handle("wormhole:watch-alert", (_event, input: unknown) => recordWatchAlert(input));
  ipcMain.handle("wormhole:watch-alert-dismiss", (_event, alertId: unknown) => dismissWatchAlert(alertId));
  ipcMain.handle("wormhole:map-update", (_event, input: unknown) => patchMapLayout(input));
  ipcMain.handle("wormhole:markers-update", (_event, input: unknown) => patchMapMarkers(input));
  ipcMain.handle("wormhole:signature-update", (_event, input: unknown) => patchSignature(input));
  ipcMain.handle("wormhole:system-update", (_event, input: unknown) => patchSystem(input));
  ipcMain.handle("wormhole:system-archive", (_event, input: { systemId?: number; editorCharacterId?: string; editorCharacterName?: string }) => archiveSystem(input?.systemId, { characterId: input?.editorCharacterId, characterName: input?.editorCharacterName }));
  ipcMain.handle("wormhole:cleanup-preview", (_event, input: unknown) => previewCleanup(input));
  ipcMain.handle("wormhole:cleanup-apply", (_event, input: unknown) => applyCleanup(input));
  ipcMain.handle("wormhole:connection-upsert", (_event, input: unknown) => upsertConnection(input));
  ipcMain.handle("wormhole:connection-remove", (_event, connectionId: unknown) => removeConnection(connectionId));
}
