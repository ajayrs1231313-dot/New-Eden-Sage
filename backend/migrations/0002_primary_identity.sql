ALTER TABLE accounts ADD COLUMN primary_eve_character_id INTEGER;
ALTER TABLE eve_identities ADD COLUMN is_primary INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_primary_eve_character
  ON accounts(primary_eve_character_id)
  WHERE primary_eve_character_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_eve_identities_one_primary_per_account
  ON eve_identities(account_id)
  WHERE is_primary = 1;
