-- Manual rollback-only rehearsal. No persistent fixture or user data changes.
-- Run as the existing migration owner, with psql ON_ERROR_STOP=1 and pager=off.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';
SET LOCAL search_path = arden, public;
CREATE TEMP TABLE role_rehearsal_ids ON COMMIT DROP AS SELECT
    gen_random_uuid() AS owner_user, gen_random_uuid() AS other_user,
    gen_random_uuid() AS organization_id, gen_random_uuid() AS owner_member,
    gen_random_uuid() AS other_member, gen_random_uuid() AS workspace_id,
    gen_random_uuid() AS role_id, gen_random_uuid() AS department_id,
    gen_random_uuid() AS organization_scope, gen_random_uuid() AS department_scope;
GRANT SELECT ON role_rehearsal_ids TO arden_runtime;
INSERT INTO user_account(user_id, email, full_name)
    SELECT owner_user, owner_user::text || '@example.test', 'Synthetic Owner' FROM role_rehearsal_ids
    UNION ALL SELECT other_user, other_user::text || '@example.test', 'Synthetic Other' FROM role_rehearsal_ids;
INSERT INTO organization(organization_id, name, slug, created_by_user_id)
    SELECT organization_id, 'Custom role rollback rehearsal', 'rehearsal-' || organization_id::text, owner_user FROM role_rehearsal_ids;
INSERT INTO organization_membership(membership_id, organization_id, user_id)
    SELECT owner_member, organization_id, owner_user FROM role_rehearsal_ids
    UNION ALL SELECT other_member, organization_id, other_user FROM role_rehearsal_ids;
INSERT INTO role(role_id, organization_id, code, name, is_system)
    SELECT role_id, organization_id, 'REHEARSAL_READER', 'Rehearsal Reader', false FROM role_rehearsal_ids;
INSERT INTO role_permission(role_id, permission_id)
    SELECT i.role_id, p.permission_id FROM role_rehearsal_ids i CROSS JOIN permission p WHERE p.code = 'PUBLISHED_CONTENT_VIEW';
INSERT INTO department(department_id, organization_id, code, name, default_role_id)
    SELECT department_id, organization_id, 'REHEARSAL', 'Rehearsal Department', role_id FROM role_rehearsal_ids;
INSERT INTO department_membership(membership_id, department_id)
    SELECT owner_member, department_id FROM role_rehearsal_ids;
INSERT INTO access_scope(access_scope_id, organization_id, scope_type, department_id)
    SELECT organization_scope, organization_id, 'ORGANIZATION', NULL::uuid FROM role_rehearsal_ids
    UNION ALL SELECT department_scope, organization_id, 'DEPARTMENT', department_id FROM role_rehearsal_ids;
DO $$ DECLARE i record; BEGIN
    SELECT * INTO STRICT i FROM role_rehearsal_ids;
    PERFORM set_config('arden.actor_id', i.owner_user::text, true);
    PERFORM set_config('arden.organization_id', i.organization_id::text, true);
    PERFORM set_config('arden.org_admin', 'false', true);
END; $$;
SET LOCAL ROLE arden_runtime;
INSERT INTO private_workspace(workspace_id, membership_id, name)
    SELECT workspace_id, owner_member, 'Synthetic Private' FROM role_rehearsal_ids;
INSERT INTO draft_document(workspace_id, title, current_version_no)
    SELECT workspace_id, 'Synthetic private draft', 1 FROM role_rehearsal_ids;
DO $$ DECLARE i record; BEGIN
    SELECT * INTO STRICT i FROM role_rehearsal_ids;
    IF NOT actor_owns_private_membership(i.owner_member) OR actor_owns_private_membership(i.other_member) THEN
        RAISE EXCEPTION 'Owner default policy failed';
    END IF;
    IF (SELECT count(*) FROM private_workspace WHERE workspace_id = i.workspace_id) <> 1 THEN
        RAISE EXCEPTION 'Owner without any role assignment cannot read private workspace';
    END IF;
END; $$;
RESET ROLE;
INSERT INTO role_assignment(membership_id, role_id, access_scope_id)
    SELECT owner_member, role_id, organization_scope FROM role_rehearsal_ids;
SET LOCAL ROLE arden_runtime;
DO $$ DECLARE i record; BEGIN
    SELECT * INTO STRICT i FROM role_rehearsal_ids;
    IF NOT actor_in_publication_audience(i.organization_id, ARRAY[i.role_id], 'ORGANIZATION', NULL)
       OR actor_in_publication_audience(i.organization_id, ARRAY[i.role_id], 'DEPARTMENT', i.department_id) THEN
        RAISE EXCEPTION 'Organization scope leaked into Department';
    END IF;
END; $$;
RESET ROLE;
UPDATE role_assignment SET status = 'REVOKED' WHERE membership_id = (SELECT owner_member FROM role_rehearsal_ids);
INSERT INTO role_assignment(membership_id, role_id, access_scope_id)
    SELECT owner_member, role_id, department_scope FROM role_rehearsal_ids;
SET LOCAL ROLE arden_runtime;
DO $$ DECLARE i record; BEGIN
    SELECT * INTO STRICT i FROM role_rehearsal_ids;
    IF NOT actor_in_publication_audience(i.organization_id, ARRAY[i.role_id], 'DEPARTMENT', i.department_id)
       OR actor_in_publication_audience(i.organization_id, ARRAY[i.role_id], 'ORGANIZATION', NULL) THEN
        RAISE EXCEPTION 'Department scope leaked into Organization';
    END IF;
END; $$;
RESET ROLE;
DELETE FROM role_permission WHERE role_id = (SELECT role_id FROM role_rehearsal_ids);
SET LOCAL ROLE arden_runtime;
DO $$ DECLARE i record; BEGIN
    SELECT * INTO STRICT i FROM role_rehearsal_ids;
    IF actor_in_publication_audience(i.organization_id, ARRAY[i.role_id], 'DEPARTMENT', i.department_id) THEN
        RAISE EXCEPTION 'VIEW removal did not revoke access';
    END IF;
    PERFORM set_config('arden.actor_id', i.other_user::text, true);
    PERFORM set_config('arden.org_admin', 'true', true);
    IF actor_owns_private_membership(i.owner_member)
       OR EXISTS (SELECT 1 FROM private_workspace WHERE workspace_id = i.workspace_id)
       OR EXISTS (SELECT 1 FROM draft_document WHERE workspace_id = i.workspace_id) THEN
        RAISE EXCEPTION 'Other member/admin can read private content';
    END IF;
END; $$;
RESET ROLE;
ROLLBACK;
SELECT 'PASS: owner default, private isolation, strict scopes, VIEW revocation; fixtures rolled back' AS result;
