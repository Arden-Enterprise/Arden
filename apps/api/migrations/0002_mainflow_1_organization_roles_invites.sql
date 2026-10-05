SET search_path TO arden, public;

ALTER TABLE organization ADD COLUMN created_by_user_id uuid REFERENCES user_account(user_id) ON UPDATE RESTRICT ON DELETE RESTRICT;
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM organization WHERE created_by_user_id IS NULL) THEN
        RAISE EXCEPTION 'Existing organizations need an explicitly reviewed creator/admin backfill before migration 0002 can be applied';
    END IF;
END $$;
ALTER TABLE role ADD CONSTRAINT uq_role_id_org UNIQUE (role_id, organization_id);
ALTER TABLE department ADD COLUMN default_role_id uuid;
ALTER TABLE department ADD CONSTRAINT fk_department_default_role
    FOREIGN KEY (default_role_id, organization_id) REFERENCES role(role_id, organization_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT;

INSERT INTO permission (code, resource_type, action, description) VALUES
    ('ORG_MANAGE_MEMBERS', 'ORGANIZATION', 'MANAGE_MEMBERS', 'Manage organization memberships and invitations'),
    ('ORG_MANAGE_DEPARTMENTS', 'ORGANIZATION', 'MANAGE_DEPARTMENTS', 'Manage organization departments'),
    ('ORG_MANAGE_ROLES', 'ORGANIZATION', 'MANAGE_ROLES', 'Create and assign organization roles'),
    ('PUBLISHED_CONTENT_VIEW', 'PUBLISHED_CONTENT', 'VIEW', 'View published content in an assigned role audience'),
    ('PUBLISHED_CONTENT_SEARCH', 'PUBLISHED_CONTENT', 'SEARCH', 'Search published content in an assigned role audience'),
    ('PUBLISHED_CONTENT_CONTRIBUTE', 'PUBLISHED_CONTENT', 'CONTRIBUTE', 'Submit a separate contribution copy of accessible published content')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role (organization_id, code, name, description, is_system)
VALUES (NULL, 'ORG_ADMIN', 'Organization Admin', 'Protected organization management capability', true)
ON CONFLICT (code) WHERE organization_id IS NULL DO NOTHING;

INSERT INTO role_permission (role_id, permission_id)
SELECT r.role_id, p.permission_id
  FROM role r CROSS JOIN permission p
 WHERE r.code = 'ORG_ADMIN' AND r.organization_id IS NULL
   AND p.code IN ('ORG_MANAGE_MEMBERS', 'ORG_MANAGE_DEPARTMENTS', 'ORG_MANAGE_ROLES')
ON CONFLICT DO NOTHING;

DO $$
DECLARE
    department_row record;
    generated_role_id uuid;
    generated_role_code text;
BEGIN
    FOR department_row IN SELECT department_id, organization_id, code, name FROM department WHERE default_role_id IS NULL LOOP
        generated_role_code := 'DEPT_DEFAULT_' || replace(department_row.department_id::text, '-', '');
        INSERT INTO role (organization_id, code, name, description, is_system)
        VALUES (department_row.organization_id, generated_role_code, department_row.name || ' Member',
                'Default audience role for department ' || department_row.code, false)
        RETURNING role_id INTO generated_role_id;

        UPDATE department SET default_role_id = generated_role_id WHERE department_id = department_row.department_id;

        INSERT INTO role_permission (role_id, permission_id)
        SELECT generated_role_id, permission_id FROM permission
         WHERE code IN ('PUBLISHED_CONTENT_VIEW', 'PUBLISHED_CONTENT_SEARCH', 'PUBLISHED_CONTENT_CONTRIBUTE',
                        'PRIVATE_WORKSPACE_READ', 'PRIVATE_WORKSPACE_WRITE')
        ON CONFLICT DO NOTHING;
    END LOOP;
END $$;

ALTER TABLE department ALTER COLUMN default_role_id SET NOT NULL;

INSERT INTO access_scope (organization_id, department_id, scope_type)
SELECT d.organization_id, d.department_id, 'DEPARTMENT'
  FROM department d
ON CONFLICT (organization_id, department_id) WHERE scope_type = 'DEPARTMENT' DO NOTHING;

INSERT INTO role_assignment (membership_id, role_id, access_scope_id)
SELECT dm.membership_id, d.default_role_id, s.access_scope_id
  FROM department_membership dm
  JOIN department d ON d.department_id = dm.department_id
  JOIN access_scope s ON s.organization_id = d.organization_id
                     AND s.department_id = d.department_id AND s.scope_type = 'DEPARTMENT'
 WHERE dm.status = 'ACTIVE' AND dm.is_primary
ON CONFLICT DO NOTHING;

CREATE TABLE organization_invitation (
    invitation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL,
    invited_by_membership_id uuid NOT NULL,
    department_id uuid NOT NULL,
    email text NOT NULL,
    token_hash char(64) NOT NULL,
    status text NOT NULL DEFAULT 'PENDING',
    expires_at timestamptz NOT NULL,
    accepted_by_user_id uuid REFERENCES user_account(user_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    accepted_at timestamptz,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT fk_invitation_org FOREIGN KEY (organization_id) REFERENCES organization(organization_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_invitation_inviter FOREIGN KEY (invited_by_membership_id, organization_id) REFERENCES organization_membership(membership_id, organization_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_invitation_department FOREIGN KEY (department_id, organization_id) REFERENCES department(department_id, organization_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT ck_invitation_email CHECK (email = lower(btrim(email)) AND position('@' IN email) > 1),
    CONSTRAINT ck_invitation_token_hash CHECK (token_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT ck_invitation_status CHECK (status IN ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED')),
    CONSTRAINT ck_invitation_expiry CHECK (expires_at > created_at),
    CONSTRAINT ck_invitation_acceptance CHECK (
        (status = 'ACCEPTED' AND accepted_by_user_id IS NOT NULL AND accepted_at IS NOT NULL)
        OR (status <> 'ACCEPTED' AND accepted_by_user_id IS NULL AND accepted_at IS NULL)
    ),
    CONSTRAINT ck_invitation_revocation CHECK (
        (status = 'REVOKED' AND revoked_at IS NOT NULL) OR (status <> 'REVOKED' AND revoked_at IS NULL)
    )
);
CREATE UNIQUE INDEX uq_invitation_token_hash ON organization_invitation(token_hash);
CREATE UNIQUE INDEX uq_invitation_pending_org_email ON organization_invitation(organization_id, email) WHERE status = 'PENDING';
CREATE INDEX ix_invitation_pending_expiry ON organization_invitation(expires_at) WHERE status = 'PENDING';

ALTER TABLE organization_invitation ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_invitation FORCE ROW LEVEL SECURITY;

CREATE POLICY organization_bootstrap_insert ON organization FOR INSERT TO arden_runtime
    WITH CHECK (created_by_user_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid);
CREATE POLICY organization_creator_read ON organization FOR SELECT TO arden_runtime
    USING (created_by_user_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid);

CREATE POLICY user_account_self_insert ON user_account FOR INSERT TO arden_runtime
    WITH CHECK (user_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid);
CREATE POLICY user_account_self_update ON user_account FOR UPDATE TO arden_runtime
    USING (user_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid)
    WITH CHECK (user_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid);

CREATE POLICY organization_membership_admin_access ON organization_membership FOR ALL TO arden_runtime
    USING (organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
       AND current_setting('arden.org_admin', true) = 'true')
    WITH CHECK (organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
       AND current_setting('arden.org_admin', true) = 'true');
CREATE POLICY organization_membership_creator_insert ON organization_membership FOR INSERT TO arden_runtime
    WITH CHECK (user_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid
       AND status = 'ACTIVE'
       AND EXISTS (SELECT 1 FROM organization o WHERE o.organization_id = organization_membership.organization_id
                    AND o.created_by_user_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid));
CREATE POLICY organization_membership_invitation_insert ON organization_membership FOR INSERT TO arden_runtime
    WITH CHECK (user_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid
       AND status = 'ACTIVE'
       AND EXISTS (SELECT 1 FROM organization_invitation i
                    JOIN user_account ua ON ua.user_id = organization_membership.user_id
                   WHERE i.organization_id = organization_membership.organization_id
                     AND i.token_hash = current_setting('arden.invitation_token_hash', true)
                     AND i.email = ua.email AND i.status = 'PENDING' AND i.expires_at > now()));

CREATE POLICY department_admin_access ON department FOR ALL TO arden_runtime
    USING (organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
       AND current_setting('arden.org_admin', true) = 'true')
    WITH CHECK (organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
       AND current_setting('arden.org_admin', true) = 'true');
CREATE POLICY department_membership_admin_access ON department_membership FOR ALL TO arden_runtime
    USING (EXISTS (SELECT 1 FROM organization_membership om
                    WHERE om.membership_id = department_membership.membership_id
                      AND om.organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid)
       AND EXISTS (SELECT 1 FROM department d
                    WHERE d.department_id = department_membership.department_id
                      AND d.organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid)
       AND current_setting('arden.org_admin', true) = 'true')
    WITH CHECK (EXISTS (SELECT 1 FROM organization_membership om
                         WHERE om.membership_id = department_membership.membership_id
                           AND om.organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid)
       AND EXISTS (SELECT 1 FROM department d
                    WHERE d.department_id = department_membership.department_id
                      AND d.organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid)
       AND current_setting('arden.org_admin', true) = 'true');

CREATE POLICY access_scope_admin_access ON access_scope FOR ALL TO arden_runtime
    USING (organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
       AND current_setting('arden.org_admin', true) = 'true')
    WITH CHECK (organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
       AND current_setting('arden.org_admin', true) = 'true');

CREATE POLICY role_admin_access ON role FOR ALL TO arden_runtime
    USING (organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
       AND current_setting('arden.org_admin', true) = 'true')
    WITH CHECK (organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
       AND is_system = false AND current_setting('arden.org_admin', true) = 'true');
CREATE POLICY role_bootstrap_admin_read ON role FOR SELECT TO arden_runtime
    USING (organization_id IS NULL AND is_system AND code = 'ORG_ADMIN'
       AND EXISTS (SELECT 1 FROM organization o
                    WHERE o.organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
                      AND o.created_by_user_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid));
CREATE POLICY role_department_default_read ON role FOR SELECT TO arden_runtime
    USING (EXISTS (SELECT 1 FROM department d
                    WHERE d.default_role_id = role.role_id
                      AND d.organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid));
CREATE POLICY role_permission_admin_access ON role_permission FOR ALL TO arden_runtime
    USING (EXISTS (SELECT 1 FROM role r WHERE r.role_id = role_permission.role_id
                    AND r.organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid)
       AND current_setting('arden.org_admin', true) = 'true')
    WITH CHECK (EXISTS (SELECT 1 FROM role r WHERE r.role_id = role_permission.role_id
                         AND r.organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid)
       AND current_setting('arden.org_admin', true) = 'true');
CREATE POLICY role_assignment_admin_access ON role_assignment FOR ALL TO arden_runtime
    USING (EXISTS (SELECT 1 FROM organization_membership om
                    WHERE om.membership_id = role_assignment.membership_id
                      AND om.organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid)
       AND EXISTS (SELECT 1 FROM access_scope s
                    WHERE s.access_scope_id = role_assignment.access_scope_id
                      AND s.organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid)
       AND current_setting('arden.org_admin', true) = 'true')
    WITH CHECK (EXISTS (SELECT 1 FROM organization_membership om
                         WHERE om.membership_id = role_assignment.membership_id
                           AND om.organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid)
       AND EXISTS (SELECT 1 FROM access_scope s
                    WHERE s.access_scope_id = role_assignment.access_scope_id
                      AND s.organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid)
       AND EXISTS (SELECT 1 FROM role r WHERE r.role_id = role_assignment.role_id
                    AND (r.organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
                         OR (r.is_system AND r.code = 'ORG_ADMIN' AND EXISTS (
                             SELECT 1 FROM organization o WHERE o.organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
                               AND o.created_by_user_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid
                         ))))
       AND current_setting('arden.org_admin', true) = 'true');

CREATE POLICY invitation_admin_access ON organization_invitation FOR ALL TO arden_runtime
    USING (organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
       AND current_setting('arden.org_admin', true) = 'true')
    WITH CHECK (organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
       AND current_setting('arden.org_admin', true) = 'true');
CREATE POLICY invitation_token_read ON organization_invitation FOR SELECT TO arden_runtime
    USING (token_hash = current_setting('arden.invitation_token_hash', true)
       AND status = 'PENDING' AND expires_at > now());
CREATE POLICY invitation_token_accept ON organization_invitation FOR UPDATE TO arden_runtime
    USING (token_hash = current_setting('arden.invitation_token_hash', true)
       AND status = 'PENDING' AND expires_at > now())
    WITH CHECK (token_hash = current_setting('arden.invitation_token_hash', true)
       AND status = 'ACCEPTED' AND accepted_by_user_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid);
CREATE POLICY department_membership_invitation_insert ON department_membership FOR INSERT TO arden_runtime
    WITH CHECK (EXISTS (SELECT 1 FROM organization_membership om
                         WHERE om.membership_id = department_membership.membership_id
                           AND om.user_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid)
       AND EXISTS (SELECT 1 FROM organization_invitation i
                    WHERE i.token_hash = current_setting('arden.invitation_token_hash', true)
                      AND i.department_id = department_membership.department_id
                      AND i.status = 'PENDING' AND i.expires_at > now()));
CREATE POLICY role_assignment_invitation_insert ON role_assignment FOR INSERT TO arden_runtime
    WITH CHECK (EXISTS (SELECT 1 FROM organization_membership om
                         WHERE om.membership_id = role_assignment.membership_id
                           AND om.user_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid)
       AND EXISTS (SELECT 1 FROM organization_invitation i
                    JOIN department d ON d.department_id = i.department_id
                    JOIN access_scope s ON s.department_id = d.department_id AND s.organization_id = d.organization_id
                   WHERE i.token_hash = current_setting('arden.invitation_token_hash', true)
                     AND i.status = 'PENDING' AND i.expires_at > now()
                     AND d.default_role_id = role_assignment.role_id
                     AND s.access_scope_id = role_assignment.access_scope_id));

GRANT INSERT, UPDATE ON organization, user_account, organization_membership, department,
    department_membership, role, role_permission, access_scope, role_assignment TO arden_runtime;
GRANT INSERT ON audit_event TO arden_runtime;
GRANT SELECT, INSERT, UPDATE ON organization_invitation TO arden_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA arden TO arden_runtime;
