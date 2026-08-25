ALTER TABLE workspaces ADD COLUMN eve_corporation_ceo_id INTEGER;

-- Remove the temporary/bootstrap account grants for operation management so the
-- corporation role policy is authoritative.
UPDATE workspace_permission_rules
SET enabled = 0
WHERE permission IN ('fleet.manage', 'fleet.approve')
  AND authority_type IN ('account', 'eve_title');

-- Default operation managers: Director, Personnel Manager, Fitting Manager.
-- CEO authority is derived from the corporation CEO character id and is not a
-- synthetic EVE role rule.
INSERT OR IGNORE INTO workspace_permission_rules (id, workspace_id, permission, authority_type, authority_value)
SELECT 'perm_' || id || '_fleet_manage_director', id, 'fleet.manage', 'eve_role', 'Director'
FROM workspaces WHERE type = 'corporation' AND archived_at IS NULL;
INSERT OR IGNORE INTO workspace_permission_rules (id, workspace_id, permission, authority_type, authority_value)
SELECT 'perm_' || id || '_fleet_manage_personnel', id, 'fleet.manage', 'eve_role', 'Personnel_Manager'
FROM workspaces WHERE type = 'corporation' AND archived_at IS NULL;
INSERT OR IGNORE INTO workspace_permission_rules (id, workspace_id, permission, authority_type, authority_value)
SELECT 'perm_' || id || '_fleet_manage_fitting', id, 'fleet.manage', 'eve_role', 'Fitting_Manager'
FROM workspaces WHERE type = 'corporation' AND archived_at IS NULL;

-- Approval is deliberately separate from operation creation/editing even though
-- the initial default role set is the same.
INSERT OR IGNORE INTO workspace_permission_rules (id, workspace_id, permission, authority_type, authority_value)
SELECT 'perm_' || id || '_fleet_approve_director', id, 'fleet.approve', 'eve_role', 'Director'
FROM workspaces WHERE type = 'corporation' AND archived_at IS NULL;
INSERT OR IGNORE INTO workspace_permission_rules (id, workspace_id, permission, authority_type, authority_value)
SELECT 'perm_' || id || '_fleet_approve_personnel', id, 'fleet.approve', 'eve_role', 'Personnel_Manager'
FROM workspaces WHERE type = 'corporation' AND archived_at IS NULL;
INSERT OR IGNORE INTO workspace_permission_rules (id, workspace_id, permission, authority_type, authority_value)
SELECT 'perm_' || id || '_fleet_approve_fitting', id, 'fleet.approve', 'eve_role', 'Fitting_Manager'
FROM workspaces WHERE type = 'corporation' AND archived_at IS NULL;
