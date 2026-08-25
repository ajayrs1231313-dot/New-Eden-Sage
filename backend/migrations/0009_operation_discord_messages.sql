PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS operation_discord_messages (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  object_id TEXT NOT NULL REFERENCES shared_objects(id) ON DELETE CASCADE,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  sent_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT,
  PRIMARY KEY (workspace_id, object_id)
);

CREATE INDEX IF NOT EXISTS idx_operation_discord_message_lookup
  ON operation_discord_messages(workspace_id, object_id, deleted_at);
