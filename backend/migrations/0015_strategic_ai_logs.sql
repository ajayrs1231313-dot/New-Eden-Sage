CREATE TABLE IF NOT EXISTS strategic_ai_logs (
  request_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  policy_tier TEXT NOT NULL,
  policy_category TEXT,
  status TEXT NOT NULL,
  prompt_text TEXT,
  response_text TEXT,
  error_text TEXT,
  usage_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (account_id) REFERENCES accounts(id)
);

CREATE INDEX IF NOT EXISTS idx_strategic_ai_logs_account_created
  ON strategic_ai_logs(account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_strategic_ai_logs_created
  ON strategic_ai_logs(created_at);
