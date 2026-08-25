-- Move untouched corporation operation policies from the old bootstrap set to the
-- current default creator/approver set. Custom policies are deliberately left alone.
-- D1 disallows TEMP tables in remote migrations, so short-lived ordinary helper
-- tables are created and dropped inside this migration.

CREATE TABLE migration_0006_legacy_fleet_manage (workspace_id TEXT PRIMARY KEY);
INSERT INTO migration_0006_legacy_fleet_manage (workspace_id)
SELECT workspace_id
FROM workspace_permission_rules
WHERE permission = 'fleet.manage' AND enabled = 1
GROUP BY workspace_id
HAVING COUNT(*) = 3
   AND SUM(CASE WHEN authority_type = 'eve_role' AND authority_value IN ('Director','Personnel_Manager','Fitting_Manager') THEN 1 ELSE 0 END) = 3;

UPDATE workspace_permission_rules
SET enabled = 0
WHERE workspace_id IN (SELECT workspace_id FROM migration_0006_legacy_fleet_manage)
  AND permission = 'fleet.manage';

INSERT OR IGNORE INTO workspace_permission_rules (id, workspace_id, permission, authority_type, authority_value, enabled)
SELECT 'perm_' || workspace_id || '_fleet_manage_personnel_manager', workspace_id, 'fleet.manage', 'eve_role', 'Personnel_Manager', 1 FROM migration_0006_legacy_fleet_manage;
INSERT OR IGNORE INTO workspace_permission_rules (id, workspace_id, permission, authority_type, authority_value, enabled)
SELECT 'perm_' || workspace_id || '_fleet_manage_communications_officer', workspace_id, 'fleet.manage', 'eve_role', 'Communications_Officer', 1 FROM migration_0006_legacy_fleet_manage;
INSERT OR IGNORE INTO workspace_permission_rules (id, workspace_id, permission, authority_type, authority_value, enabled)
SELECT 'perm_' || workspace_id || '_fleet_manage_starbase_defense_operator', workspace_id, 'fleet.manage', 'eve_role', 'Starbase_Defense_Operator', 1 FROM migration_0006_legacy_fleet_manage;
INSERT OR IGNORE INTO workspace_permission_rules (id, workspace_id, permission, authority_type, authority_value, enabled)
SELECT 'perm_' || workspace_id || '_fleet_manage_skill_plan_manager', workspace_id, 'fleet.manage', 'eve_role', 'Skill_Plan_Manager', 1 FROM migration_0006_legacy_fleet_manage;
UPDATE workspace_permission_rules SET enabled = 1
WHERE workspace_id IN (SELECT workspace_id FROM migration_0006_legacy_fleet_manage)
  AND permission = 'fleet.manage'
  AND authority_type = 'eve_role'
  AND authority_value IN ('Personnel_Manager','Communications_Officer','Starbase_Defense_Operator','Skill_Plan_Manager');
DROP TABLE migration_0006_legacy_fleet_manage;

CREATE TABLE migration_0006_legacy_fleet_approve (workspace_id TEXT PRIMARY KEY);
INSERT INTO migration_0006_legacy_fleet_approve (workspace_id)
SELECT workspace_id
FROM workspace_permission_rules
WHERE permission = 'fleet.approve' AND enabled = 1
GROUP BY workspace_id
HAVING COUNT(*) = 3
   AND SUM(CASE WHEN authority_type = 'eve_role' AND authority_value IN ('Director','Personnel_Manager','Fitting_Manager') THEN 1 ELSE 0 END) = 3;

UPDATE workspace_permission_rules
SET enabled = 0
WHERE workspace_id IN (SELECT workspace_id FROM migration_0006_legacy_fleet_approve)
  AND permission = 'fleet.approve';

INSERT OR IGNORE INTO workspace_permission_rules (id, workspace_id, permission, authority_type, authority_value, enabled)
SELECT 'perm_' || workspace_id || '_fleet_approve_personnel_manager', workspace_id, 'fleet.approve', 'eve_role', 'Personnel_Manager', 1 FROM migration_0006_legacy_fleet_approve;
INSERT OR IGNORE INTO workspace_permission_rules (id, workspace_id, permission, authority_type, authority_value, enabled)
SELECT 'perm_' || workspace_id || '_fleet_approve_communications_officer', workspace_id, 'fleet.approve', 'eve_role', 'Communications_Officer', 1 FROM migration_0006_legacy_fleet_approve;
INSERT OR IGNORE INTO workspace_permission_rules (id, workspace_id, permission, authority_type, authority_value, enabled)
SELECT 'perm_' || workspace_id || '_fleet_approve_starbase_defense_operator', workspace_id, 'fleet.approve', 'eve_role', 'Starbase_Defense_Operator', 1 FROM migration_0006_legacy_fleet_approve;
INSERT OR IGNORE INTO workspace_permission_rules (id, workspace_id, permission, authority_type, authority_value, enabled)
SELECT 'perm_' || workspace_id || '_fleet_approve_skill_plan_manager', workspace_id, 'fleet.approve', 'eve_role', 'Skill_Plan_Manager', 1 FROM migration_0006_legacy_fleet_approve;
UPDATE workspace_permission_rules SET enabled = 1
WHERE workspace_id IN (SELECT workspace_id FROM migration_0006_legacy_fleet_approve)
  AND permission = 'fleet.approve'
  AND authority_type = 'eve_role'
  AND authority_value IN ('Personnel_Manager','Communications_Officer','Starbase_Defense_Operator','Skill_Plan_Manager');
DROP TABLE migration_0006_legacy_fleet_approve;
