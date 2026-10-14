SET search_path TO arden, public;

-- ALL_MEMBERS is an organization-owned, server-managed audience marker. It is
-- deliberately not a configurable role and never receives role assignments.
INSERT INTO role (organization_id, code, name, description, is_system)
SELECT organization_id, 'ALL_MEMBERS', 'Everyone in organization',
       'Server-managed audience for every active organization member', false
  FROM organization
ON CONFLICT (organization_id, code) WHERE organization_id IS NOT NULL DO NOTHING;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM role
        WHERE code = 'ALL_MEMBERS'
          AND (organization_id IS NULL OR is_system OR status <> 'ACTIVE'
               OR name <> 'Everyone in organization')) THEN
        RAISE EXCEPTION 'ALL_MEMBERS is reserved for the organization-wide managed audience';
    END IF;
END;
$$;

INSERT INTO role_permission (role_id, permission_id)
SELECT r.role_id, p.permission_id
  FROM role r CROSS JOIN permission p
 WHERE r.code = 'ALL_MEMBERS' AND r.organization_id IS NOT NULL
   AND NOT r.is_system AND r.status = 'ACTIVE'
   AND p.code = 'PUBLISHED_CONTENT_VIEW' AND p.status = 'ACTIVE'
ON CONFLICT DO NOTHING;

-- The draft metadata boundary prevents the organization-wide marker from
-- being attached to a Department publication. Department audiences continue
-- to require their exact default/custom role.
CREATE OR REPLACE FUNCTION validate_shared_draft_audience()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = arden, pg_temp AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM role r
        JOIN shared_draft d ON d.shared_draft_id = NEW.shared_draft_id
                           AND d.organization_id = NEW.organization_id
        WHERE r.role_id = NEW.role_id
          AND r.organization_id = NEW.organization_id
          AND NOT r.is_system AND r.status = 'ACTIVE'
          AND EXISTS (SELECT 1 FROM role_permission rp JOIN permission p
              ON p.permission_id = rp.permission_id
              WHERE rp.role_id = r.role_id AND p.code = 'PUBLISHED_CONTENT_VIEW'
                AND p.status = 'ACTIVE')
          AND (r.code <> 'ALL_MEMBERS'
               OR (d.target_scope_type = 'ORGANIZATION'
                   AND d.responsible_department_id IS NOT NULL))
    ) THEN
        RAISE EXCEPTION 'Shared draft audience is not valid for its organization and scope'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

-- Active organization membership is the complete grant for ALL_MEMBERS.
-- All other role audiences retain exact assignment-scope matching.
CREATE OR REPLACE FUNCTION actor_in_publication_audience(p_organization_id uuid, p_role_ids uuid[],
    p_scope_type text, p_department_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = arden, pg_temp AS $$
    SELECT p_organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
       AND EXISTS (
           SELECT 1 FROM organization_membership om
           JOIN user_account ua ON ua.user_id = om.user_id AND ua.status = 'ACTIVE'
           JOIN organization o ON o.organization_id = om.organization_id AND o.status = 'ACTIVE'
           WHERE om.user_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid
             AND om.organization_id = p_organization_id AND om.status = 'ACTIVE'
             AND (
                 (p_scope_type = 'ORGANIZATION' AND p_department_id IS NULL
                  AND EXISTS (SELECT 1 FROM role all_members
                      JOIN role_permission rp ON rp.role_id = all_members.role_id
                      JOIN permission permission ON permission.permission_id = rp.permission_id
                          AND permission.code = 'PUBLISHED_CONTENT_VIEW' AND permission.status = 'ACTIVE'
                      WHERE all_members.organization_id = p_organization_id
                        AND all_members.code = 'ALL_MEMBERS' AND NOT all_members.is_system
                        AND all_members.status = 'ACTIVE'
                        AND all_members.role_id = ANY(p_role_ids)))
                 OR EXISTS (
                     SELECT 1 FROM role_assignment ra
                     JOIN role r ON r.role_id = ra.role_id AND r.organization_id = p_organization_id
                                AND r.status = 'ACTIVE' AND NOT r.is_system AND r.code <> 'ALL_MEMBERS'
                     JOIN role_permission rp ON rp.role_id = r.role_id
                     JOIN permission permission ON permission.permission_id = rp.permission_id
                         AND permission.code = 'PUBLISHED_CONTENT_VIEW' AND permission.status = 'ACTIVE'
                     JOIN access_scope scope ON scope.access_scope_id = ra.access_scope_id
                         AND scope.organization_id = p_organization_id AND scope.status = 'ACTIVE'
                     WHERE ra.membership_id = om.membership_id
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
                                     AND dm.department_id = p_department_id
                                     AND d.organization_id = p_organization_id
                                     AND dm.status = 'ACTIVE'))
                       )
                 )
             ));
$$;

COMMENT ON FUNCTION actor_in_publication_audience(uuid, uuid[], text, uuid) IS
    'Checks active ALL_MEMBERS organization audience or an exact active role assignment; never grants Department access through ALL_MEMBERS';
