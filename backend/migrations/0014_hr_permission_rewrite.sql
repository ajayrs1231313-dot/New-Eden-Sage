-- HR no longer uses the generic corporation permission-rule engine.
-- Keep historical rows for auditability, but disable them so they cannot affect access.
UPDATE workspace_permission_rules
SET enabled = 0
WHERE permission IN ('hr.manage', 'hr.review');
