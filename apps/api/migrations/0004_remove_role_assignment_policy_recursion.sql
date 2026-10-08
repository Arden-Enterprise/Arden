SET search_path TO arden, public;

-- A role_assignment write policy checks the target role. The old role read
-- policy queried role_assignment, which makes that write recursively evaluate
-- role_assignment RLS. Restrict role visibility directly to the active org,
-- the actor's own memberships, and global system roles instead.
DROP POLICY role_scope_read ON role;
CREATE POLICY role_scope_read ON role FOR SELECT TO arden_runtime
    USING (
        organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
        OR (organization_id IS NULL AND is_system)
        OR EXISTS (
            SELECT 1 FROM organization_membership om
             WHERE om.organization_id = role.organization_id
               AND om.user_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid
        )
    );
