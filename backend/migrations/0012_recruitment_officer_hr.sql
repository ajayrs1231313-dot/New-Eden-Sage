-- Recruitment Officers are first-class HR authorities.
-- This is title-based because corporations commonly assign recruitment responsibility
-- through custom EVE titles rather than the built-in Personnel_Manager role.

INSERT OR IGNORE INTO workspace_permission_rules (id, workspace_id, permission, authority_type, authority_value)
SELECT 'perm_' || id || '_hr_manage_recruitment_officer', id, 'hr.manage', 'eve_title', 'Recruitment Officer'
FROM workspaces
WHERE type = 'corporation' AND archived_at IS NULL;

INSERT OR IGNORE INTO workspace_permission_rules (id, workspace_id, permission, authority_type, authority_value)
SELECT 'perm_' || id || '_hr_review_recruitment_officer', id, 'hr.review', 'eve_title', 'Recruitment Officer'
FROM workspaces
WHERE type = 'corporation' AND archived_at IS NULL;
