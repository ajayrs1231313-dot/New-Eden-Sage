-- Discord administration now follows the same selected-character fleet.manage authority as Command Ops.
DELETE FROM workspace_permission_rules WHERE permission = 'discord.manage';

CREATE TABLE IF NOT EXISTS discord_device_keys (
  device_id TEXT PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  public_key_spki_b64 TEXT NOT NULL,
  algorithm TEXT NOT NULL DEFAULT 'ECDSA_P256_SHA256' CHECK (algorithm = 'ECDSA_P256_SHA256'),
  fingerprint_sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT,
  revoked_at TEXT,
  UNIQUE (account_id, fingerprint_sha256)
);
CREATE INDEX IF NOT EXISTS idx_discord_device_keys_account ON discord_device_keys(account_id, revoked_at);

CREATE TABLE IF NOT EXISTS discord_command_nonces (
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  nonce TEXT NOT NULL,
  request_time_ms INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (device_id, nonce)
);
CREATE INDEX IF NOT EXISTS idx_discord_command_nonces_expiry ON discord_command_nonces(expires_at);

CREATE TABLE IF NOT EXISTS discord_action_tickets (
  token_hash TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  eve_character_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_discord_action_tickets_scope ON discord_action_tickets(workspace_id, account_id, action, created_at);
CREATE INDEX IF NOT EXISTS idx_discord_action_tickets_expiry ON discord_action_tickets(expires_at, used_at);

CREATE TABLE IF NOT EXISTS discord_command_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  eve_character_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_discord_command_events_rate ON discord_command_events(workspace_id, account_id, action, created_at);

CREATE TABLE IF NOT EXISTS discord_allowed_channels (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL,
  channel_name TEXT,
  category_id TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (workspace_id, channel_id)
);
CREATE INDEX IF NOT EXISTS idx_discord_allowed_channels_workspace ON discord_allowed_channels(workspace_id, enabled);
