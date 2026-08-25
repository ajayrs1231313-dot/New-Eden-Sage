PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'deleted'))
);

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  label TEXT,
  platform TEXT,
  last_seen_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_devices_account ON devices(account_id);

CREATE TABLE IF NOT EXISTS eve_identities (
  character_id INTEGER PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  character_name TEXT NOT NULL,
  corporation_id INTEGER,
  alliance_id INTEGER,
  scopes_json TEXT NOT NULL DEFAULT '[]',
  roles_json TEXT NOT NULL DEFAULT '[]',
  titles_json TEXT NOT NULL DEFAULT '[]',
  refresh_token_ciphertext TEXT,
  last_verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_eve_identities_account ON eve_identities(account_id);
CREATE INDEX IF NOT EXISTS idx_eve_identities_corporation ON eve_identities(corporation_id);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  device_id TEXT REFERENCES devices(id) ON DELETE SET NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_account ON sessions(account_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);

CREATE TABLE IF NOT EXISTS oauth_states (
  state_hash TEXT PRIMARY KEY,
  return_to TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  eve_corporation_id INTEGER UNIQUE,
  eve_alliance_id INTEGER,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  archived_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_workspaces_corporation ON workspaces(eve_corporation_id);

CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  eve_character_id INTEGER REFERENCES eve_identities(character_id) ON DELETE SET NULL,
  membership_state TEXT NOT NULL DEFAULT 'active' CHECK (membership_state IN ('active', 'revoked', 'left')),
  last_verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (workspace_id, account_id, eve_character_id)
);
CREATE INDEX IF NOT EXISTS idx_workspace_members_account ON workspace_members(account_id);

CREATE TABLE IF NOT EXISTS workspace_permission_rules (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  permission TEXT NOT NULL,
  authority_type TEXT NOT NULL CHECK (authority_type IN ('eve_role', 'eve_title', 'account')),
  authority_value TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (workspace_id, permission, authority_type, authority_value)
);
CREATE INDEX IF NOT EXISTS idx_permission_rules_lookup ON workspace_permission_rules(workspace_id, permission, enabled);

CREATE TABLE IF NOT EXISTS shared_objects (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  object_type TEXT NOT NULL,
  current_version INTEGER NOT NULL DEFAULT 1,
  visibility TEXT NOT NULL DEFAULT 'workspace',
  created_by_account_id TEXT NOT NULL REFERENCES accounts(id),
  updated_by_account_id TEXT NOT NULL REFERENCES accounts(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  published_at TEXT,
  archived_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_shared_objects_workspace_type ON shared_objects(workspace_id, object_type, archived_at);

CREATE TABLE IF NOT EXISTS shared_object_versions (
  object_id TEXT NOT NULL REFERENCES shared_objects(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  published_by_account_id TEXT NOT NULL REFERENCES accounts(id),
  published_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (object_id, version)
);

CREATE TABLE IF NOT EXISTS events_outbox (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  object_id TEXT,
  object_version INTEGER,
  payload_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  queued_at TEXT,
  dispatched_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_workspace_sequence ON events_outbox(workspace_id, sequence);
CREATE INDEX IF NOT EXISTS idx_events_pending ON events_outbox(dispatched_at, queued_at, sequence);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  operation TEXT NOT NULL,
  resource_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT,
  PRIMARY KEY (workspace_id, account_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS notification_preferences (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  channel TEXT NOT NULL DEFAULT 'sage',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (account_id, workspace_id, event_type, channel)
);

CREATE TABLE IF NOT EXISTS discord_integrations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  guild_id TEXT NOT NULL,
  channel_id TEXT,
  enabled INTEGER NOT NULL DEFAULT 0,
  credential_ref TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL,
  actor_account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  detail_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_workspace_created ON audit_log(workspace_id, created_at);
