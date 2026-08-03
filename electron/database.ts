import { app } from "electron";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";

let database: DatabaseSync | undefined;

function db() {
  if (!database) {
    database = new DatabaseSync(
      path.join(app.getPath("userData"), "new-eden-sage.sqlite"),
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

export function exportDatabaseData() {
  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    application: "New Eden Sage",
    characterSnapshots: listSnapshots(),
    importedInformation: listImportedInformation(),
  };
}

export function importDatabaseData(data: {
  characterSnapshots?: unknown[];
  importedInformation?: Array<{
    source_name?: string;
    sourceName?: string;
    content: string;
  }>;
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
  return { snapshots, information };
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
