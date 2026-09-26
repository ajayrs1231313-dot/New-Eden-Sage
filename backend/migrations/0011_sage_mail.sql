PRAGMA foreign_keys = ON;

-- Sage Mail is character-addressed even when several characters share one Sage account.
-- Free mailboxes keep 50 stored entries across Inbox + Sent. quota_limit = -1 is reserved
-- for a future unlimited/premium entitlement without changing the message schema.
CREATE TABLE IF NOT EXISTS sage_mail_quotas (
  character_id INTEGER PRIMARY KEY REFERENCES eve_identities(character_id) ON DELETE CASCADE,
  quota_limit INTEGER NOT NULL DEFAULT 50,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (quota_limit = -1 OR quota_limit >= 1)
);

CREATE TABLE IF NOT EXISTS sage_mail_messages (
  id TEXT PRIMARY KEY,
  sender_account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  sender_character_id INTEGER REFERENCES eve_identities(character_id) ON DELETE SET NULL,
  sender_character_name TEXT NOT NULL,
  recipient_character_id INTEGER NOT NULL REFERENCES eve_identities(character_id) ON DELETE CASCADE,
  recipient_character_name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'normal'
    CHECK (kind IN ('normal', 'doctrine', 'production', 'system')),
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sage_mail_messages_recipient
  ON sage_mail_messages(recipient_character_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sage_mail_messages_sender
  ON sage_mail_messages(sender_character_id, created_at DESC);

CREATE TABLE IF NOT EXISTS sage_mailbox_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id TEXT NOT NULL REFERENCES sage_mail_messages(id) ON DELETE CASCADE,
  owner_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  owner_character_id INTEGER NOT NULL REFERENCES eve_identities(character_id) ON DELETE CASCADE,
  folder TEXT NOT NULL CHECK (folder IN ('inbox', 'sent')),
  read_at TEXT,
  deleted_at TEXT,
  dedup_key TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(owner_character_id, folder, message_id),
  UNIQUE(owner_character_id, dedup_key)
);
CREATE INDEX IF NOT EXISTS idx_sage_mailbox_owner_folder
  ON sage_mailbox_entries(owner_character_id, folder, deleted_at, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sage_mailbox_unread
  ON sage_mailbox_entries(owner_character_id, folder, read_at, deleted_at);

-- Enforce quota in the database as well as in the API so concurrent sends cannot
-- push a free character above its allowance. -1 means unlimited.
CREATE TRIGGER IF NOT EXISTS trg_sage_mailbox_quota
BEFORE INSERT ON sage_mailbox_entries
WHEN (
  COALESCE((SELECT quota_limit FROM sage_mail_quotas WHERE character_id = NEW.owner_character_id), 50) <> -1
  AND (
    SELECT COUNT(*)
      FROM sage_mailbox_entries
     WHERE owner_character_id = NEW.owner_character_id
       AND deleted_at IS NULL
  ) >= COALESCE((SELECT quota_limit FROM sage_mail_quotas WHERE character_id = NEW.owner_character_id), 50)
)
BEGIN
  SELECT RAISE(ABORT, 'SAGE_MAILBOX_QUOTA_EXCEEDED');
END;
