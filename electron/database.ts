import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { USER_DATA_ROOT } from "./data-paths";

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
      snapshot.characterId,
      snapshot.character.name,
      JSON.stringify(snapshot),
      snapshot.updatedAt,
    );
}

export function listSnapshots() {
  const rows = db()
    .prepare("SELECT payload FROM character_snapshots ORDER BY updated_at DESC")
    .all() as Array<{ payload: string }>;
  return rows.map((row) => JSON.parse(row.payload) as unknown);
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
    ? (JSON.parse((row as { payload: string }).payload) as unknown)
    : null;
}

export function deleteSnapshot(characterId: string) {
  db()
    .prepare("DELETE FROM character_snapshots WHERE character_id = ?")
    .run(characterId);
}

export function clearCharacterSnapshots() {
  db().prepare("DELETE FROM character_snapshots").run();
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
    schemaVersion: 3,
    exportedAt: new Date().toISOString(),
    application: "New Eden Sage",
    characterSnapshots: listSnapshots(),
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
  for (const item of data.characterSnapshots ?? []) {
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
  return { snapshots, information, opportunityProfitRecords: (data.opportunityProfitRecords ?? []).length, projectFoundryProjects: (data.projectFoundryProjects ?? []).length, planetaryPlans: (data.planetaryPlans ?? []).length, planetaryResourceObservations: (data.planetaryResourceObservations ?? []).length, planetaryAlertSettings: Boolean(data.planetaryAlertSettings) };
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
