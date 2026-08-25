CREATE TABLE IF NOT EXISTS discord_notification_targets (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  eve_character_id INTEGER NOT NULL,
  discord_user_id TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (workspace_id, account_id, eve_character_id)
);
CREATE INDEX IF NOT EXISTS idx_discord_notification_targets_character
  ON discord_notification_targets(workspace_id, eve_character_id, enabled);
CREATE INDEX IF NOT EXISTS idx_discord_notification_targets_discord
  ON discord_notification_targets(discord_user_id, enabled);

-- Preserve existing personal Discord opt-ins as the initial notification routing.
INSERT OR IGNORE INTO discord_notification_targets
  (workspace_id, account_id, eve_character_id, discord_user_id, enabled, updated_at)
SELECT workspace_id, account_id, eve_character_id, discord_user_id, dm_enabled, updated_at
  FROM discord_user_links
 WHERE dm_enabled = 1;
