CREATE TABLE IF NOT EXISTS strategic_ai_browser_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  request_id TEXT,
  action TEXT NOT NULL,
  query_text TEXT,
  target_url TEXT,
  purpose_text TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (account_id) REFERENCES accounts(id)
);

CREATE INDEX IF NOT EXISTS idx_strategic_ai_browser_logs_account_created
  ON strategic_ai_browser_logs(account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_strategic_ai_browser_logs_created
  ON strategic_ai_browser_logs(created_at);
