CREATE TABLE IF NOT EXISTS buyback_requests (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  contract_id INTEGER NOT NULL,
  issuer_character_id INTEGER NOT NULL,
  issuer_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  issuer_character_name TEXT NOT NULL,
  corporation_id INTEGER NOT NULL,
  contract_title TEXT NOT NULL,
  contract_status TEXT NOT NULL,
  contract_issued_at TEXT,
  contract_expires_at TEXT,
  detected_at TEXT NOT NULL,
  submitted_at TEXT NOT NULL,
  last_synced_at TEXT NOT NULL,
  gross_value_isk REAL NOT NULL,
  payout_isk REAL NOT NULL,
  payout_percent REAL NOT NULL,
  corp_margin_isk REAL NOT NULL,
  item_count INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','rejected','cancelled','expired')),
  paid_by_account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  paid_by_character_id INTEGER,
  paid_by_character_name TEXT,
  paid_at TEXT,
  rejected_by_account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  rejected_by_character_id INTEGER,
  rejected_by_character_name TEXT,
  rejected_at TEXT,
  rejection_note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (workspace_id, contract_id)
);
CREATE INDEX IF NOT EXISTS idx_buyback_requests_workspace_status ON buyback_requests(workspace_id, status, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_buyback_requests_issuer ON buyback_requests(workspace_id, issuer_character_id, submitted_at DESC);

CREATE TABLE IF NOT EXISTS buyback_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL REFERENCES buyback_requests(id) ON DELETE CASCADE,
  contract_id INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  actor_account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  actor_character_id INTEGER,
  actor_character_name TEXT,
  detail_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_buyback_events_request ON buyback_events(request_id, created_at, id);
CREATE INDEX IF NOT EXISTS idx_buyback_events_workspace ON buyback_events(workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS buyback_notifications (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL REFERENCES buyback_requests(id) ON DELETE CASCADE,
  recipient_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  acknowledged_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (request_id, recipient_account_id)
);
CREATE INDEX IF NOT EXISTS idx_buyback_notifications_account ON buyback_notifications(recipient_account_id, acknowledged_at, created_at DESC);

INSERT OR IGNORE INTO workspace_permission_rules (id, workspace_id, permission, authority_type, authority_value)
SELECT 'perm_' || id || '_buyback_manage_director', id, 'buyback.manage', 'eve_role', 'Director'
FROM workspaces
WHERE type = 'corporation';
