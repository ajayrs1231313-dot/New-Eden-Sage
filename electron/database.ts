import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { USER_DATA_ROOT } from "./data-paths";
import { normalizeSnapshotBlueprintAssetValuation } from "./asset-valuation";
import { decryptSnapshotPayload, encryptSnapshotPayload, isEncryptedSnapshotPayload, snapshotEncryptionFingerprint } from "./snapshot-crypto";

let database: DatabaseSync | undefined;

function db() {
  if (!database) {
    database = new DatabaseSync(
      path.join(USER_DATA_ROOT, "new-eden-sage.sqlite"),
    );
    database.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS character_snapshots (
        character_id TEXT PRIMARY KEY,
        character_name TEXT NOT NULL,
        payload TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS private_esi_datasets (
        character_id TEXT NOT NULL,
        request_path TEXT NOT NULL,
        dataset_id TEXT NOT NULL,
        scope_required TEXT,
        encrypted_payload TEXT NOT NULL,
        encryption_version INTEGER NOT NULL,
        key_fingerprint TEXT NOT NULL,
        status TEXT NOT NULL,
        last_http_status INTEGER,
        fetched_at TEXT,
        last_attempt_at TEXT NOT NULL,
        last_success_at TEXT,
        next_eligible_at TEXT,
        etag TEXT,
        last_modified TEXT,
        cache_control TEXT,
        expires TEXT,
        rate_group TEXT,
        x_pages INTEGER,
        last_error TEXT,
        failure_kind TEXT,
        schema_version INTEGER NOT NULL,
        PRIMARY KEY(character_id, request_path)
      );
      CREATE INDEX IF NOT EXISTS idx_private_esi_dataset_id ON private_esi_datasets(character_id, dataset_id);
      CREATE TABLE IF NOT EXISTS imported_information (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_name TEXT NOT NULL,
        content TEXT NOT NULL,
        imported_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS market_region_summaries (
        region_id INTEGER PRIMARY KEY,
        region_name TEXT NOT NULL,
        payload TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS planetary_plans (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        character_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        saved_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS planetary_resource_observations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        planet_id INTEGER NOT NULL,
        resource_type_id INTEGER,
        resource_name TEXT,
        character_id TEXT,
        payload TEXT NOT NULL,
        observed_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_pi_observations_planet ON planetary_resource_observations (planet_id);
      CREATE TABLE IF NOT EXISTS planetary_settings (
        key TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS opportunity_profit_records (
        id TEXT PRIMARY KEY,
        character_id TEXT NOT NULL,
        source TEXT NOT NULL,
        source_key TEXT NOT NULL,
        payload TEXT NOT NULL,
        completed_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_profit_records_character ON opportunity_profit_records(character_id, completed_at DESC);
      CREATE TABLE IF NOT EXISTS project_foundry_projects (
        id TEXT PRIMARY KEY,
        corporation_id TEXT NOT NULL,
        name TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_foundry_projects_corporation ON project_foundry_projects(corporation_id, updated_at DESC);
    `);
  }
  return database;
}

export function saveSnapshot(snapshot: {
  characterId: string;
  character: { name: string };
  updatedAt: string;
}) {
  const normalized = normalizeSnapshotBlueprintAssetValuation(snapshot);
  db()
    .prepare(
      `
    INSERT INTO character_snapshots (character_id, character_name, payload, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(character_id) DO UPDATE SET
      character_name = excluded.character_name,
      payload = excluded.payload,
      updated_at = excluded.updated_at
  `,
    )
    .run(
      normalized.characterId,
      normalized.character.name,
      encryptSnapshotPayload(normalized),
      normalized.updatedAt,
    );
}

export function listSnapshots() {
  const rows = db()
    .prepare("SELECT payload FROM character_snapshots ORDER BY updated_at DESC")
    .all() as Array<{ payload: string }>;
  return rows.map((row) => normalizeSnapshotBlueprintAssetValuation(decryptSnapshotPayload<unknown>(row.payload)));
}

export function getSnapshot(characterId?: string) {
  const row = characterId
    ? db()
        .prepare(
          "SELECT payload FROM character_snapshots WHERE character_id = ?",
        )
        .get(characterId)
    : db()
        .prepare(
          "SELECT payload FROM character_snapshots ORDER BY updated_at DESC LIMIT 1",
        )
        .get();
  return row
    ? normalizeSnapshotBlueprintAssetValuation(decryptSnapshotPayload<unknown>((row as { payload: string }).payload))
    : null;
}

export function migratePlaintextSnapshotsToEncrypted() {
  const rows = db().prepare("SELECT character_id, payload FROM character_snapshots").all() as Array<{ character_id:string; payload:string }>;
  const update = db().prepare("UPDATE character_snapshots SET payload = ? WHERE character_id = ?");
  let migrated = 0;
  for (const row of rows) {
    if (isEncryptedSnapshotPayload(row.payload)) continue;
    const parsed = JSON.parse(row.payload) as unknown;
    update.run(encryptSnapshotPayload(parsed), row.character_id);
    migrated += 1;
  }
  return migrated;
}

export function exportEncryptedSnapshotRecords() {
  return (db().prepare("SELECT character_id, character_name, payload, updated_at FROM character_snapshots ORDER BY updated_at DESC").all() as Array<any>).map((row) => ({
    characterId: String(row.character_id),
    characterName: String(row.character_name),
    encryptedPayload: String(row.payload),
    updatedAt: String(row.updated_at),
    keyFingerprint: snapshotEncryptionFingerprint(),
  }));
}

export function importEncryptedSnapshotRecords(records: Array<{ characterId:string; characterName:string; encryptedPayload:string; updatedAt:string; keyFingerprint?:string }>) {
  const insert = db().prepare(`INSERT INTO character_snapshots (character_id, character_name, payload, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(character_id) DO UPDATE SET character_name=excluded.character_name, payload=excluded.payload, updated_at=excluded.updated_at`);
  let imported = 0;
  for (const record of records ?? []) {
    if (!record?.characterId || !record?.characterName || !record?.encryptedPayload || !record?.updatedAt) continue;
    if (!isEncryptedSnapshotPayload(record.encryptedPayload)) continue;
    if (record.keyFingerprint && record.keyFingerprint !== snapshotEncryptionFingerprint()) throw new Error("Encrypted Sage backup belongs to a different local data key.");
    decryptSnapshotPayload(record.encryptedPayload);
    insert.run(record.characterId, record.characterName, record.encryptedPayload, record.updatedAt);
    imported += 1;
  }
  return imported;
}

export function deleteSnapshot(characterId: string) {
  db()
    .prepare("DELETE FROM character_snapshots WHERE character_id = ?")
    .run(characterId);
}

export function clearCharacterSnapshots() {
  db().prepare("DELETE FROM character_snapshots").run();
}

export type PrivateEsiDatasetRecord = {
  characterId: string;
  requestPath: string;
  datasetId: string;
  scopeRequired?: string | null;
  encryptedPayload: string;
  encryptionVersion: number;
  keyFingerprint: string;
  status: string;
  lastHttpStatus?: number | null;
  fetchedAt?: string | null;
  lastAttemptAt: string;
  lastSuccessAt?: string | null;
  nextEligibleAt?: string | null;
  etag?: string | null;
  lastModified?: string | null;
  cacheControl?: string | null;
  expires?: string | null;
  rateGroup?: string | null;
  xPages?: number | null;
  lastError?: string | null;
  failureKind?: string | null;
  schemaVersion: number;
};

function privateEsiRow(row: any): PrivateEsiDatasetRecord {
  return {
    characterId: String(row.character_id),
    requestPath: String(row.request_path),
    datasetId: String(row.dataset_id),
    scopeRequired: row.scope_required == null ? null : String(row.scope_required),
    encryptedPayload: String(row.encrypted_payload),
    encryptionVersion: Number(row.encryption_version),
    keyFingerprint: String(row.key_fingerprint),
    status: String(row.status),
    lastHttpStatus: row.last_http_status == null ? null : Number(row.last_http_status),
    fetchedAt: row.fetched_at == null ? null : String(row.fetched_at),
    lastAttemptAt: String(row.last_attempt_at),
    lastSuccessAt: row.last_success_at == null ? null : String(row.last_success_at),
    nextEligibleAt: row.next_eligible_at == null ? null : String(row.next_eligible_at),
    etag: row.etag == null ? null : String(row.etag),
    lastModified: row.last_modified == null ? null : String(row.last_modified),
    cacheControl: row.cache_control == null ? null : String(row.cache_control),
    expires: row.expires == null ? null : String(row.expires),
    rateGroup: row.rate_group == null ? null : String(row.rate_group),
    xPages: row.x_pages == null ? null : Number(row.x_pages),
    lastError: row.last_error == null ? null : String(row.last_error),
    failureKind: row.failure_kind == null ? null : String(row.failure_kind),
    schemaVersion: Number(row.schema_version),
  };
}

export function savePrivateEsiDatasetRecord(record: PrivateEsiDatasetRecord) {
  db().prepare(`
    INSERT INTO private_esi_datasets (
      character_id, request_path, dataset_id, scope_required, encrypted_payload, encryption_version, key_fingerprint,
      status, last_http_status, fetched_at, last_attempt_at, last_success_at, next_eligible_at, etag, last_modified,
      cache_control, expires, rate_group, x_pages, last_error, failure_kind, schema_version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(character_id, request_path) DO UPDATE SET
      dataset_id=excluded.dataset_id, scope_required=excluded.scope_required, encrypted_payload=excluded.encrypted_payload,
      encryption_version=excluded.encryption_version, key_fingerprint=excluded.key_fingerprint, status=excluded.status,
      last_http_status=excluded.last_http_status, fetched_at=excluded.fetched_at, last_attempt_at=excluded.last_attempt_at,
      last_success_at=excluded.last_success_at, next_eligible_at=excluded.next_eligible_at, etag=excluded.etag,
      last_modified=excluded.last_modified, cache_control=excluded.cache_control, expires=excluded.expires,
      rate_group=excluded.rate_group, x_pages=excluded.x_pages, last_error=excluded.last_error,
      failure_kind=excluded.failure_kind, schema_version=excluded.schema_version
  `).run(
    record.characterId, record.requestPath, record.datasetId, record.scopeRequired ?? null, record.encryptedPayload,
    record.encryptionVersion, record.keyFingerprint, record.status, record.lastHttpStatus ?? null, record.fetchedAt ?? null,
    record.lastAttemptAt, record.lastSuccessAt ?? null, record.nextEligibleAt ?? null, record.etag ?? null,
    record.lastModified ?? null, record.cacheControl ?? null, record.expires ?? null, record.rateGroup ?? null,
    record.xPages ?? null, record.lastError ?? null, record.failureKind ?? null, record.schemaVersion,
  );
}

export function getPrivateEsiDatasetRecord(characterId: string, requestPath: string) {
  const row = db().prepare("SELECT * FROM private_esi_datasets WHERE character_id = ? AND request_path = ?").get(characterId, requestPath);
  return row ? privateEsiRow(row) : null;
}

export function listPrivateEsiDatasetRecords(characterId?: string) {
  const rows = characterId
    ? db().prepare("SELECT * FROM private_esi_datasets WHERE character_id = ? ORDER BY dataset_id, request_path").all(characterId)
    : db().prepare("SELECT * FROM private_esi_datasets ORDER BY character_id, dataset_id, request_path").all();
  return (rows as any[]).map(privateEsiRow);
}

export function deletePrivateEsiDatasetRecords(characterId: string) {
  db().prepare("DELETE FROM private_esi_datasets WHERE character_id = ?").run(characterId);
}

export function addImportedInformation(sourceName: string, content: string) {
  db()
    .prepare(
      "INSERT INTO imported_information (source_name, content, imported_at) VALUES (?, ?, ?)",
    )
    .run(sourceName, content, new Date().toISOString());
}

export function listImportedInformation() {
  return db()
    .prepare(
      "SELECT id, source_name, content, imported_at FROM imported_information ORDER BY imported_at DESC",
    )
    .all();
}

export type SavedPlanetaryPlanRecord = {
  id: string;
  name: string;
  savedAt: string;
  input: unknown;
  kind?: "plan" | "template";
  category?: string;
  scope?: "personal" | "corporation";
  publishedObjectId?: string;
  publishedVersion?: number;
  publishedAt?: string;
  designerLayout?: unknown;
  eveTemplate?: unknown;
  layoutProfile?: string;
};

export type PlanetaryResourceObservationRecord = {
  planetId: number;
  systemId?: number;
  systemName?: string;
  planetTypeId?: number;
  planetType?: string;
  radiusKm?: number;
  resourceTypeId?: number;
  resourceName?: string;
  percent?: number;
  score?: number;
  note?: string;
  characterId?: string;
  characterName?: string;
  source?: string;
  confidence?: number;
  scope?: "personal" | "corporation";
  observedAt?: string;
};

export type PlanetaryAlertSettingsRecord = {
  enabled?: Record<string, boolean>;
  extractorWarningHours?: number[];
  storageThresholds?: number[];
  stockpileDays?: number;
  optimizerMinIskPerDay?: number;
  overrides?: Record<string, { enabled?:Record<string,boolean>; extractorWarningHours?:number[]; storageThresholds?:number[]; stockpileDays?:number; optimizerMinIskPerDay?:number }>;
};

export function listPlanetaryPlans(): SavedPlanetaryPlanRecord[] {
  const rows = db()
    .prepare("SELECT id, name, payload, saved_at FROM planetary_plans ORDER BY updated_at DESC")
    .all() as Array<{ id: string; name: string; payload: string; saved_at: string }>;
  return rows.flatMap((row) => {
    try {
      const parsed = JSON.parse(row.payload) as any;
      if (parsed && Number(parsed.schemaVersion) >= 2 && Object.prototype.hasOwnProperty.call(parsed, "input")) {
        const { schemaVersion: _schemaVersion, ...record } = parsed;
        return [{ id: row.id, name: row.name, savedAt: row.saved_at, ...record } as SavedPlanetaryPlanRecord];
      }
      return [{ id: row.id, name: row.name, savedAt: row.saved_at, input: parsed }];
    } catch {
      return [];
    }
  });
}

export function savePlanetaryPlan(plan: SavedPlanetaryPlanRecord) {
  const id = String(plan.id ?? "").trim();
  const name = String(plan.name ?? "").trim();
  const characterId = String((plan.input as { characterId?: unknown } | null)?.characterId ?? "").trim();
  if (!id || !name || !characterId) throw new Error("A PI plan requires an id, name and character.");
  const savedAt = plan.savedAt || new Date().toISOString();
  const updatedAt = new Date().toISOString();
  const payload = JSON.stringify({ schemaVersion: 3, input: plan.input, kind: plan.kind ?? "plan", category: plan.category, scope: plan.scope ?? "personal", publishedObjectId: plan.publishedObjectId, publishedVersion: plan.publishedVersion, publishedAt: plan.publishedAt, designerLayout: plan.designerLayout, eveTemplate: plan.eveTemplate, layoutProfile: plan.layoutProfile });
  db().prepare(`
    INSERT INTO planetary_plans (id, name, character_id, payload, saved_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name,
      character_id=excluded.character_id,
      payload=excluded.payload,
      updated_at=excluded.updated_at
  `).run(id, name, characterId, payload, savedAt, updatedAt);
  return { ...plan, id, name, savedAt };
}

export function deletePlanetaryPlan(id: string) {
  db().prepare("DELETE FROM planetary_plans WHERE id = ?").run(String(id));
  return true;
}

export function listPlanetaryResourceObservations(): PlanetaryResourceObservationRecord[] {
  const rows = db()
    .prepare("SELECT payload FROM planetary_resource_observations ORDER BY observed_at DESC, id DESC")
    .all() as Array<{ payload: string }>;
  return rows.flatMap((row) => {
    try { return [JSON.parse(row.payload) as PlanetaryResourceObservationRecord]; }
    catch { return []; }
  });
}

export function replacePlanetaryResourceObservations(observations: PlanetaryResourceObservationRecord[]) {
  const database = db();
  database.exec("BEGIN IMMEDIATE");
  try {
    database.prepare("DELETE FROM planetary_resource_observations").run();
    const insert = database.prepare(`
      INSERT INTO planetary_resource_observations
        (planet_id, resource_type_id, resource_name, character_id, payload, observed_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const observation of observations) {
      const planetId = Number(observation.planetId);
      const percentRaw = Number(observation.percent);
      const scoreRaw = Number(observation.score);
      const percent = Number.isFinite(percentRaw) ? Math.max(0, Math.min(100, percentRaw)) : Number.isFinite(scoreRaw) ? Math.max(0, Math.min(100, scoreRaw <= 5 ? scoreRaw * 20 : scoreRaw)) : NaN;
      if (!(planetId > 0) || !Number.isFinite(percent)) continue;
      const normalized = {
        ...observation,
        planetId,
        systemId: observation.systemId == null ? undefined : Number(observation.systemId),
        planetTypeId: observation.planetTypeId == null ? undefined : Number(observation.planetTypeId),
        radiusKm: observation.radiusKm == null ? undefined : Math.max(0, Number(observation.radiusKm)),
        resourceTypeId: observation.resourceTypeId == null ? undefined : Number(observation.resourceTypeId),
        percent,
        score: observation.score == null ? undefined : Math.max(0, Math.min(5, Number(observation.score))),
        confidence: observation.confidence == null ? undefined : Math.max(0, Math.min(1, Number(observation.confidence))),
        scope: observation.scope ?? "personal",
        source: observation.source ?? (observation.score != null && observation.percent == null ? "legacy" : "manual"),
        observedAt: observation.observedAt || new Date().toISOString(),
      };
      insert.run(normalized.planetId, normalized.resourceTypeId ?? null, normalized.resourceName ?? null, normalized.characterId ?? null, JSON.stringify(normalized), normalized.observedAt);
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  return listPlanetaryResourceObservations();
}

export function getPlanetaryAlertSettings(): PlanetaryAlertSettingsRecord {
  const row = db().prepare("SELECT payload FROM planetary_settings WHERE key = ?").get("alerts") as { payload?: string } | undefined;
  if (!row?.payload) return {};
  try { return JSON.parse(row.payload) as PlanetaryAlertSettingsRecord; } catch { return {}; }
}

export function savePlanetaryAlertSettings(settings: PlanetaryAlertSettingsRecord) {
  const normalized = { ...settings, stockpileDays: settings.stockpileDays == null ? undefined : Math.max(0.25, Number(settings.stockpileDays)), optimizerMinIskPerDay: settings.optimizerMinIskPerDay == null ? undefined : Math.max(0, Number(settings.optimizerMinIskPerDay)) };
  db().prepare(`INSERT INTO planetary_settings (key, payload, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at`).run("alerts", JSON.stringify(normalized), new Date().toISOString());
  return getPlanetaryAlertSettings();
}

export function listProjectFoundryProjects(corporationId?: string) {
  const rows = corporationId
    ? db().prepare("SELECT payload FROM project_foundry_projects WHERE corporation_id = ? ORDER BY updated_at DESC").all(String(corporationId))
    : db().prepare("SELECT payload FROM project_foundry_projects ORDER BY updated_at DESC").all();
  return (rows as Array<{ payload: string }>).flatMap((row) => { try { return [JSON.parse(row.payload) as unknown]; } catch { return []; } });
}

export function saveProjectFoundryProject(project: any) {
  const id = String(project?.id ?? "").trim();
  const corporationId = String(project?.corporationId ?? "").trim();
  const name = String(project?.name ?? "").trim();
  if (!id || !corporationId || !name) throw new Error("Project Foundry records require an id, corporation and name.");
  const createdAt = String(project?.createdAt ?? new Date().toISOString());
  const updatedAt = String(project?.updatedAt ?? new Date().toISOString());
  db().prepare(`INSERT INTO project_foundry_projects (id, corporation_id, name, payload, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET corporation_id=excluded.corporation_id, name=excluded.name, payload=excluded.payload, updated_at=excluded.updated_at`)
    .run(id, corporationId, name, JSON.stringify(project), createdAt, updatedAt);
  return project;
}

export function deleteProjectFoundryProject(id: string) {
  db().prepare("DELETE FROM project_foundry_projects WHERE id = ?").run(String(id));
  return true;
}

export function listOpportunityProfitRecords(characterId?: string) {
  const rows = characterId
    ? db().prepare("SELECT payload FROM opportunity_profit_records WHERE character_id = ? ORDER BY completed_at DESC").all(String(characterId))
    : db().prepare("SELECT payload FROM opportunity_profit_records ORDER BY completed_at DESC").all();
  return (rows as Array<{ payload: string }>).flatMap((row) => { try { return [JSON.parse(row.payload) as unknown]; } catch { return []; } });
}

export function saveOpportunityProfitRecord(record: any) {
  const id = String(record?.id ?? "").trim();
  const characterId = String(record?.characterId ?? "").trim();
  if (!id || !characterId) throw new Error("Profit record requires an id and character.");
  const completedAt = String(record?.completedAt ?? new Date().toISOString());
  db().prepare(`INSERT INTO opportunity_profit_records (id, character_id, source, source_key, payload, completed_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET character_id=excluded.character_id, source=excluded.source, source_key=excluded.source_key, payload=excluded.payload, completed_at=excluded.completed_at, updated_at=excluded.updated_at`)
    .run(id, characterId, String(record?.source ?? "unknown"), String(record?.sourceKey ?? ""), JSON.stringify(record), completedAt, new Date().toISOString());
  return record;
}

export function deleteOpportunityProfitRecord(id: string) {
  db().prepare("DELETE FROM opportunity_profit_records WHERE id = ?").run(String(id));
  return true;
}
export function exportDatabaseData() {
  return {
    schemaVersion: 4,
    exportedAt: new Date().toISOString(),
    application: "New Eden Sage",
    characterSnapshots: listSnapshots().map((snapshot:any) => ({ characterId:snapshot.characterId, character:{ name:snapshot.character?.name ?? "Unknown", corporation_id:snapshot.character?.corporation_id ?? null, corporation_name:snapshot.character?.corporation_name ?? null }, updatedAt:snapshot.updatedAt, snapshotState:snapshot.snapshotState })),
    encryptedCharacterSnapshots: exportEncryptedSnapshotRecords(),
    privateEsiDatasets: listPrivateEsiDatasetRecords(),
    privateDataProtection: {
      encrypted: true,
      algorithm: "AES-256-GCM",
      keyStorage: "Electron safeStorage / installation-bound",
      note: "Private ESI payloads and complete character snapshots are included as ciphertext. Public snapshot identity metadata remains readable; the local data-encryption key is never exported.",
    },
    importedInformation: listImportedInformation(),
    planetaryPlans: listPlanetaryPlans(),
    planetaryResourceObservations: listPlanetaryResourceObservations(),
    planetaryAlertSettings: getPlanetaryAlertSettings(),
    opportunityProfitRecords: listOpportunityProfitRecords(),
    projectFoundryProjects: listProjectFoundryProjects(),
  };
}

export function importDatabaseData(data: {
  characterSnapshots?: unknown[];
  encryptedCharacterSnapshots?: Array<{ characterId:string; characterName:string; encryptedPayload:string; updatedAt:string; keyFingerprint?:string }>;
  privateEsiDatasets?: PrivateEsiDatasetRecord[];
  importedInformation?: Array<{
    source_name?: string;
    sourceName?: string;
    content: string;
  }>;
  planetaryPlans?: SavedPlanetaryPlanRecord[];
  planetaryResourceObservations?: PlanetaryResourceObservationRecord[];
  planetaryAlertSettings?: PlanetaryAlertSettingsRecord;
  opportunityProfitRecords?: any[];
  projectFoundryProjects?: any[];
}) {
  let snapshots = 0;
  let information = 0;
  if (data.encryptedCharacterSnapshots?.length) snapshots += importEncryptedSnapshotRecords(data.encryptedCharacterSnapshots);
  for (const item of data.encryptedCharacterSnapshots?.length ? [] : (data.characterSnapshots ?? [])) {
    const snapshot = item as {
      characterId?: string;
      character?: { name?: string };
      updatedAt?: string;
    };
    if (
      snapshot.characterId &&
      snapshot.character?.name &&
      snapshot.updatedAt
    ) {
      saveSnapshot(
        snapshot as {
          characterId: string;
          character: { name: string };
          updatedAt: string;
        },
      );
      snapshots += 1;
    }
  }
  for (const record of data.privateEsiDatasets ?? []) {
    if (record?.characterId && record?.requestPath && record?.encryptedPayload && record?.keyFingerprint) {
      savePrivateEsiDatasetRecord(record);
    }
  }
  for (const item of data.importedInformation ?? []) {
    if (item.content) {
      addImportedInformation(
        item.source_name ?? item.sourceName ?? "Imported information",
        item.content,
      );
      information += 1;
    }
  }
  for (const plan of data.planetaryPlans ?? []) {
    savePlanetaryPlan(plan);
  }
  if (data.planetaryResourceObservations) {
    replacePlanetaryResourceObservations(data.planetaryResourceObservations);
  }
  if (data.planetaryAlertSettings) savePlanetaryAlertSettings(data.planetaryAlertSettings);
  for (const record of data.opportunityProfitRecords ?? []) saveOpportunityProfitRecord(record);
  for (const project of data.projectFoundryProjects ?? []) saveProjectFoundryProject(project);
  return { snapshots, information, privateEsiDatasets: (data.privateEsiDatasets ?? []).length, opportunityProfitRecords: (data.opportunityProfitRecords ?? []).length, projectFoundryProjects: (data.projectFoundryProjects ?? []).length, planetaryPlans: (data.planetaryPlans ?? []).length, planetaryResourceObservations: (data.planetaryResourceObservations ?? []).length, planetaryAlertSettings: Boolean(data.planetaryAlertSettings) };
}

export function saveMarketSummary(summary: {
  regionId: number;
  regionName: string;
  updatedAt: string;
}) {
  db()
    .prepare(
      `INSERT INTO market_region_summaries (region_id, region_name, payload, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(region_id) DO UPDATE SET region_name=excluded.region_name, payload=excluded.payload, updated_at=excluded.updated_at`,
    )
    .run(
      summary.regionId,
      summary.regionName,
      JSON.stringify(summary),
      summary.updatedAt,
    );
}

export function listMarketSummaries() {
  const rows = db()
    .prepare("SELECT payload FROM market_region_summaries ORDER BY region_name")
    .all() as Array<{ payload: string }>;
  return rows.map((row) => JSON.parse(row.payload) as unknown);
}
