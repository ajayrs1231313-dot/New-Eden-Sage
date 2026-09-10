CREATE TABLE IF NOT EXISTS corporation_hr_applications (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  corporation_id INTEGER NOT NULL,
  corporation_name TEXT NOT NULL,
  recruiter_account_id TEXT NOT NULL,
  recruiter_character_id INTEGER NOT NULL,
  recruiter_name TEXT NOT NULL,
  code_hash TEXT NOT NULL UNIQUE,
  code_hint TEXT NOT NULL,
  requested_categories_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'awaiting-applicant',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  submitted_at TEXT,
  withdrawn_at TEXT,
  applicant_account_id TEXT,
  applicant_character_id INTEGER,
  applicant_character_name TEXT,
  snapshot_schema_version INTEGER,
  snapshot_json TEXT,
  snapshot_sha256 TEXT,
  decision_by_account_id TEXT,
  decision_by_character_id INTEGER,
  decision_by_character_name TEXT,
  decision_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_hr_applications_code_hash ON corporation_hr_applications(code_hash);
CREATE INDEX IF NOT EXISTS idx_hr_applications_workspace_created ON corporation_hr_applications(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hr_applications_status_expiry ON corporation_hr_applications(status, expires_at);

CREATE TABLE IF NOT EXISTS corporation_hr_notes (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES corporation_hr_applications(id) ON DELETE CASCADE,
  recruiter_account_id TEXT NOT NULL,
  recruiter_character_id INTEGER NOT NULL,
  recruiter_name TEXT NOT NULL,
  note_text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_hr_notes_application_created ON corporation_hr_notes(application_id, created_at ASC);

-- HR is a separate authority surface. Personnel Manager is the initial default;
-- CEO/Director continue to inherit administrator authority from the existing policy layer.
INSERT OR IGNORE INTO workspace_permission_rules (id, workspace_id, permission, authority_type, authority_value)
SELECT 'perm_' || id || '_hr_manage_personnel', id, 'hr.manage', 'eve_role', 'Personnel_Manager'
FROM workspaces WHERE type = 'corporation' AND archived_at IS NULL;

INSERT OR IGNORE INTO workspace_permission_rules (id, workspace_id, permission, authority_type, authority_value)
SELECT 'perm_' || id || '_hr_review_personnel', id, 'hr.review', 'eve_role', 'Personnel_Manager'
FROM workspaces WHERE type = 'corporation' AND archived_at IS NULL;
