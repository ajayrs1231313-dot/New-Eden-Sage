CREATE TABLE IF NOT EXISTS strategic_ai_failure_reports (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  request_id TEXT,
  prompt_text TEXT,
  error_text TEXT NOT NULL,
  elapsed_ms INTEGER NOT NULL DEFAULT 0,
  developer_mode INTEGER NOT NULL DEFAULT 0,
  trace_json TEXT,
  client_context_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_strategic_ai_failure_reports_account_created
  ON strategic_ai_failure_reports(account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_strategic_ai_failure_reports_request
  ON strategic_ai_failure_reports(request_id);
