PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS shared_object_acl (
  object_id TEXT NOT NULL REFERENCES shared_objects(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (object_id, account_id)
);
CREATE INDEX IF NOT EXISTS idx_shared_object_acl_account ON shared_object_acl(account_id, object_id);
