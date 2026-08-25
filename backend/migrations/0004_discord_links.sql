CREATE UNIQUE INDEX IF NOT EXISTS idx_discord_integrations_workspace ON discord_integrations(workspace_id);

CREATE TABLE IF NOT EXISTS discord_user_links (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  eve_character_id INTEGER NOT NULL,
  discord_user_id TEXT NOT NULL,
  discord_username TEXT NOT NULL,
  discord_global_name TEXT,
  dm_enabled INTEGER NOT NULL DEFAULT 1,
  linked_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (workspace_id, account_id, eve_character_id)
);
CREATE INDEX IF NOT EXISTS idx_discord_user_links_character ON discord_user_links(workspace_id, eve_character_id);
CREATE INDEX IF NOT EXISTS idx_discord_user_links_discord ON discord_user_links(discord_user_id);

CREATE TABLE IF NOT EXISTS discord_oauth_states (
  state TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  eve_character_id INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_discord_oauth_states_expiry ON discord_oauth_states(expires_at);
