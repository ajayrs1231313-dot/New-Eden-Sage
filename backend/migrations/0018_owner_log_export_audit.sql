CREATE TABLE IF NOT EXISTS owner_log_export_audit (
  id TEXT PRIMARY KEY,
  owner_account_id TEXT NOT NULL,
  target_account_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('ai', 'failures', 'browser')),
  row_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_owner_log_export_audit_created ON owner_log_export_audit(created_at DESC);
