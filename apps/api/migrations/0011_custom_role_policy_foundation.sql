SET search_path TO arden, public;

-- Do not silently remove legacy publication access when tightening scopes.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM knowledge_current_publication) THEN
        RAISE EXCEPTION 'Review current publication scopes before applying custom role scope rules';
    END IF;
END;
$$;

ALTER TABLE role ADD COLUMN configuration_version integer NOT NULL DEFAULT 1
    CHECK (configuration_version > 0);

-- Private access is an owner default, not a custom-role permission.
CREATE FUNCTION actor_owns_private_membership(p_membership_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = arden, pg_temp AS $$
    SELECT EXISTS (
        SELECT 1 FROM organization_membership om
        JOIN user_account ua ON ua.user_id = om.user_id AND ua.status = 'ACTIVE'
        JOIN organization o ON o.organization_id = om.organization_id AND o.status = 'ACTIVE'
        WHERE om.membership_id = p_membership_id AND om.status = 'ACTIVE'
          AND om.user_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid
          AND om.organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
    );
$$;
REVOKE ALL ON FUNCTION actor_owns_private_membership(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION actor_owns_private_membership(uuid) TO arden_runtime;

DROP POLICY private_workspace_owner_access ON private_workspace;
CREATE POLICY private_workspace_owner_access ON private_workspace FOR ALL TO arden_runtime
    USING (actor_owns_private_membership(membership_id))
    WITH CHECK (actor_owns_private_membership(membership_id));

DROP POLICY draft_document_owner_access ON draft_document;
CREATE POLICY draft_document_owner_access ON draft_document FOR ALL TO arden_runtime
    USING (EXISTS (SELECT 1 FROM private_workspace w WHERE w.workspace_id = draft_document.workspace_id
        AND actor_owns_private_membership(w.membership_id)))
    WITH CHECK (EXISTS (SELECT 1 FROM private_workspace w WHERE w.workspace_id = draft_document.workspace_id
        AND actor_owns_private_membership(w.membership_id)));

DROP POLICY draft_version_owner_access ON draft_version;
CREATE POLICY draft_version_owner_access ON draft_version FOR ALL TO arden_runtime
    USING (EXISTS (SELECT 1 FROM draft_document d JOIN private_workspace w ON w.workspace_id = d.workspace_id
        WHERE d.draft_id = draft_version.draft_id AND actor_owns_private_membership(w.membership_id)))
    WITH CHECK (EXISTS (SELECT 1 FROM draft_document d JOIN private_workspace w ON w.workspace_id = d.workspace_id
        WHERE d.draft_id = draft_version.draft_id AND w.membership_id = draft_version.created_by_membership_id
          AND actor_owns_private_membership(w.membership_id)));

CREATE OR REPLACE FUNCTION actor_in_publication_audience(p_organization_id uuid, p_role_ids uuid[],
    p_scope_type text, p_department_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = arden, pg_temp AS $$
    SELECT p_organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
       AND EXISTS (
           SELECT 1 FROM organization_membership om
           JOIN user_account ua ON ua.user_id = om.user_id AND ua.status = 'ACTIVE'
           JOIN organization o ON o.organization_id = om.organization_id AND o.status = 'ACTIVE'
           JOIN role_assignment ra ON ra.membership_id = om.membership_id
           JOIN role r ON r.role_id = ra.role_id AND r.organization_id = p_organization_id
                       AND r.status = 'ACTIVE' AND NOT r.is_system
           JOIN role_permission rp ON rp.role_id = r.role_id
           JOIN permission permission ON permission.permission_id = rp.permission_id
               AND permission.code = 'PUBLISHED_CONTENT_VIEW' AND permission.status = 'ACTIVE'
           JOIN access_scope scope ON scope.access_scope_id = ra.access_scope_id
               AND scope.organization_id = p_organization_id AND scope.status = 'ACTIVE'
           WHERE om.user_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid
             AND om.organization_id = p_organization_id AND om.status = 'ACTIVE'
             AND ra.status = 'ACTIVE' AND ra.valid_from <= now()
             AND (ra.valid_until IS NULL OR ra.valid_until > now())
             AND r.role_id = ANY(p_role_ids)
             AND (
                 (p_scope_type = 'ORGANIZATION' AND p_department_id IS NULL
                     AND scope.scope_type = 'ORGANIZATION' AND scope.department_id IS NULL)
                 OR (p_scope_type = 'DEPARTMENT' AND p_department_id IS NOT NULL
                     AND scope.scope_type = 'DEPARTMENT' AND scope.department_id = p_department_id
                     AND EXISTS (SELECT 1 FROM department_membership dm
                         JOIN department d ON d.department_id = dm.department_id AND d.status = 'ACTIVE'
                         WHERE dm.membership_id = om.membership_id
                           AND dm.department_id = p_department_id AND d.organization_id = p_organization_id
                           AND dm.status = 'ACTIVE'))
             ));
$$;
