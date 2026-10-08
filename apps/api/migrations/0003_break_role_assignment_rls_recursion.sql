SET search_path TO arden, public;

-- Scope visibility must not read role_assignment: the old role_assignment policy
-- also read access_scope, which created a recursive RLS dependency.
DROP POLICY access_scope_read ON access_scope;
CREATE POLICY access_scope_read ON access_scope FOR SELECT TO arden_runtime
    USING (
        organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
        OR EXISTS (
            SELECT 1 FROM organization_membership om
             WHERE om.organization_id = access_scope.organization_id
               AND om.user_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid
        )
    );

-- Keep administrator reads separate from writes so actor reads never enter
-- a policy that validates rows through access_scope and role.
DROP POLICY role_assignment_admin_access ON role_assignment;

CREATE POLICY role_assignment_admin_read ON role_assignment FOR SELECT TO arden_runtime
    USING (
        current_setting('arden.org_admin', true) = 'true'
        AND EXISTS (
            SELECT 1 FROM organization_membership om
             WHERE om.membership_id = role_assignment.membership_id
               AND om.organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
        )
        AND EXISTS (
            SELECT 1 FROM access_scope s
             WHERE s.access_scope_id = role_assignment.access_scope_id
               AND s.organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
        )
    );

CREATE POLICY role_assignment_admin_insert ON role_assignment FOR INSERT TO arden_runtime
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM organization_membership om
             WHERE om.membership_id = role_assignment.membership_id
               AND om.organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
        )
        AND EXISTS (
            SELECT 1 FROM access_scope s
             WHERE s.access_scope_id = role_assignment.access_scope_id
               AND s.organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
        )
        AND EXISTS (
            SELECT 1 FROM role r
             WHERE r.role_id = role_assignment.role_id
               AND (r.organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
                    OR (r.is_system AND r.code = 'ORG_ADMIN' AND EXISTS (
                        SELECT 1 FROM organization o
                         WHERE o.organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
                           AND o.created_by_user_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid
                    )))
        )
        AND current_setting('arden.org_admin', true) = 'true'
    );

CREATE POLICY role_assignment_admin_update ON role_assignment FOR UPDATE TO arden_runtime
    USING (
        EXISTS (
            SELECT 1 FROM organization_membership om
             WHERE om.membership_id = role_assignment.membership_id
               AND om.organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
        )
        AND EXISTS (
            SELECT 1 FROM access_scope s
             WHERE s.access_scope_id = role_assignment.access_scope_id
               AND s.organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
        )
        AND current_setting('arden.org_admin', true) = 'true'
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM organization_membership om
             WHERE om.membership_id = role_assignment.membership_id
               AND om.organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
        )
        AND EXISTS (
            SELECT 1 FROM access_scope s
             WHERE s.access_scope_id = role_assignment.access_scope_id
               AND s.organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
        )
        AND EXISTS (
            SELECT 1 FROM role r
             WHERE r.role_id = role_assignment.role_id
               AND (r.organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
                    OR (r.is_system AND r.code = 'ORG_ADMIN' AND EXISTS (
                        SELECT 1 FROM organization o
                         WHERE o.organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
                           AND o.created_by_user_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid
                    )))
        )
        AND current_setting('arden.org_admin', true) = 'true'
    );

CREATE POLICY role_assignment_admin_delete ON role_assignment FOR DELETE TO arden_runtime
    USING (
        EXISTS (
            SELECT 1 FROM organization_membership om
             WHERE om.membership_id = role_assignment.membership_id
               AND om.organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
        )
        AND EXISTS (
            SELECT 1 FROM access_scope s
             WHERE s.access_scope_id = role_assignment.access_scope_id
               AND s.organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
        )
        AND current_setting('arden.org_admin', true) = 'true'
    );
