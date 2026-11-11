SET search_path TO arden, public;

-- Flow 2 T1.2 (BM04 RF-03): forward-only data migration of legacy audiences to Target Readers.
--
-- Every current publication without readers gets a Target Readers selection that admits nobody the
-- legacy audience does not admit today:
--   * organization audience (ALL_MEMBERS, organization scope)        -> ORGANIZATION
--   * department scope whose readers are exactly that department     -> DEPARTMENT
--   * anything else (groups, partial departments, mixed audiences)   -> SELECTED_MEMBERS, the exact
--                                                                       current readers (2-100)
--   * fewer than 2 or more than 100 readers that fit no mode         -> left unmapped (readers NULL keeps
--                                                                       today's audience path) and reported
-- A mode is chosen only when the members it admits are a subset of today's audience readers, and the
-- migration fails if any mapped publication would be wider. Audience tables, columns and policies stay
-- until T1.6. Publication RLS keeps both policies, so effective access can only narrow.
--
-- Operator rollout: these functions read FORCE RLS tables, so they run only for the trusted operator role.
-- Rehearse on a copy first: the migration raises a NOTICE with before/after counts per publication, and
-- `SELECT * FROM arden.migrate_publication_readers(false)` reports the same rows at any time afterwards.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)) THEN
        RAISE EXCEPTION '0028 must be applied by the trusted operator role (superuser or BYPASSRLS)'
            USING ERRCODE = '42501';
    END IF;
END;
$$;

-- Members who pass actor_in_publication_audience (0012) today, evaluated for every member at once.
CREATE FUNCTION audience_reader_memberships(p_organization_id uuid, p_role_ids uuid[],
    p_scope_type text, p_department_id uuid)
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY INVOKER SET search_path = arden, pg_temp AS $$
    SELECT om.membership_id
      FROM organization_membership om
      JOIN user_account ua ON ua.user_id = om.user_id AND ua.status = 'ACTIVE'
      JOIN organization o ON o.organization_id = om.organization_id AND o.status = 'ACTIVE'
     WHERE om.organization_id = p_organization_id AND om.status = 'ACTIVE'
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
       );
$$;
REVOKE ALL ON FUNCTION audience_reader_memberships(uuid, uuid[], text, uuid) FROM PUBLIC;

-- Members a Target Readers mode admits today; same rule as actor_in_reader_selection (0025).
CREATE FUNCTION reader_mode_memberships(p_organization_id uuid, p_mode text, p_department_id uuid,
    p_selection_id uuid)
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY INVOKER SET search_path = arden, pg_temp AS $$
    SELECT om.membership_id
      FROM organization_membership om
      JOIN user_account ua ON ua.user_id = om.user_id AND ua.status = 'ACTIVE'
      JOIN organization o ON o.organization_id = om.organization_id AND o.status = 'ACTIVE'
     WHERE om.organization_id = p_organization_id AND om.status = 'ACTIVE'
       AND (p_mode = 'ORGANIZATION'
         OR (p_mode = 'DEPARTMENT' AND EXISTS (
             SELECT 1 FROM department_membership dm
               JOIN department d ON d.department_id = dm.department_id
                                AND d.organization_id = p_organization_id AND d.status = 'ACTIVE'
              WHERE dm.membership_id = om.membership_id AND dm.department_id = p_department_id
                AND dm.status = 'ACTIVE'))
         OR (p_mode = 'SELECTED_MEMBERS' AND EXISTS (
             SELECT 1 FROM selected_reader sr
              WHERE sr.selection_id = p_selection_id AND sr.membership_id = om.membership_id)));
$$;
REVOKE ALL ON FUNCTION reader_mode_memberships(uuid, text, uuid, uuid) FROM PUBLIC;

-- One row per current publication (optionally of one organization). p_apply = false only reports; p_apply = true also assigns readers to
-- unmapped publications. audience_readers = today's legacy readers ("before"); target_readers = members
-- the Target Readers admit ("after"); wider_readers = members admitted by Target Readers but not today.
CREATE FUNCTION migrate_publication_readers(p_apply boolean, p_organization_id uuid DEFAULT NULL)
RETURNS TABLE (shared_draft_id uuid, published_version_id uuid, organization_id uuid, outcome text,
    reader_mode text, audience_readers integer, target_readers integer, wider_readers integer)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = arden, pg_temp AS $$
#variable_conflict use_column
DECLARE
    publication record;
    audience_set uuid[];
    candidate_set uuid[];
    chosen_mode text;
    chosen_department uuid;
    new_selection uuid;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)) THEN
        RAISE EXCEPTION 'migrate_publication_readers requires the trusted operator role' USING ERRCODE = '42501';
    END IF;
    FOR publication IN
        SELECT cp.shared_draft_id, cp.published_version_id, cp.organization_id, cp.audience_role_ids,
               cp.target_scope_type, cp.target_department_id, cp.reader_selection_id,
               rs.reader_mode, rs.department_id AS selection_department_id
          FROM knowledge_current_publication cp
          LEFT JOIN reader_selection rs ON rs.selection_id = cp.reader_selection_id
         WHERE p_organization_id IS NULL OR cp.organization_id = p_organization_id
         ORDER BY cp.organization_id, cp.shared_draft_id
    LOOP
        audience_set := ARRAY(SELECT audience_reader_memberships(publication.organization_id,
            publication.audience_role_ids, publication.target_scope_type, publication.target_department_id));
        shared_draft_id := publication.shared_draft_id;
        published_version_id := publication.published_version_id;
        organization_id := publication.organization_id;
        audience_readers := cardinality(audience_set);

        IF publication.reader_selection_id IS NOT NULL THEN
            outcome := 'ALREADY_SET';
            reader_mode := publication.reader_mode;
            candidate_set := ARRAY(SELECT reader_mode_memberships(publication.organization_id,
                publication.reader_mode, publication.selection_department_id, publication.reader_selection_id));
        ELSE
            chosen_mode := NULL;
            chosen_department := NULL;
            candidate_set := ARRAY(SELECT reader_mode_memberships(publication.organization_id,
                'ORGANIZATION', NULL, NULL));
            IF cardinality(audience_set) = 0 THEN
                candidate_set := ARRAY[]::uuid[];  -- nobody reads it today; no mode can express that
            ELSIF publication.target_scope_type = 'ORGANIZATION' AND candidate_set <@ audience_set
                  -- Intent as well as today's set: a group that happens to hold everyone stays a group.
                  AND EXISTS (SELECT 1 FROM role r WHERE r.organization_id = publication.organization_id
                                AND r.code = 'ALL_MEMBERS' AND NOT r.is_system
                                AND r.role_id = ANY(publication.audience_role_ids)) THEN
                chosen_mode := 'ORGANIZATION';
            ELSIF publication.target_scope_type = 'DEPARTMENT' THEN
                candidate_set := ARRAY(SELECT reader_mode_memberships(publication.organization_id,
                    'DEPARTMENT', publication.target_department_id, NULL));
                IF cardinality(candidate_set) > 0 AND candidate_set <@ audience_set
                   AND EXISTS (SELECT 1 FROM department d WHERE d.department_id = publication.target_department_id
                                 AND d.status = 'ACTIVE'
                                 AND d.default_role_id = ANY(publication.audience_role_ids)) THEN
                    chosen_mode := 'DEPARTMENT';
                    chosen_department := publication.target_department_id;
                END IF;
            END IF;
            IF chosen_mode IS NULL AND cardinality(audience_set) > 0 THEN
                candidate_set := audience_set;
                IF cardinality(audience_set) BETWEEN 2 AND 100 THEN
                    chosen_mode := 'SELECTED_MEMBERS';
                END IF;
            END IF;

            reader_mode := chosen_mode;
            IF chosen_mode IS NULL THEN
                outcome := 'UNMAPPED';
                candidate_set := ARRAY[]::uuid[];
            ELSIF p_apply THEN
                outcome := 'MAPPED';
                INSERT INTO reader_selection (organization_id, reader_mode, department_id)
                VALUES (publication.organization_id, chosen_mode, chosen_department)
                RETURNING selection_id INTO new_selection;
                IF chosen_mode = 'SELECTED_MEMBERS' THEN
                    INSERT INTO selected_reader (selection_id, organization_id, membership_id, ordinal)
                    SELECT new_selection, publication.organization_id, member_id,
                           row_number() OVER (ORDER BY member_id)
                      FROM unnest(audience_set) AS member_id;
                END IF;
                -- Only the readers column changes; protect_published_version_content allows it.
                UPDATE published_knowledge_version pv SET reader_selection_id = new_selection
                 WHERE pv.published_version_id = publication.published_version_id
                   AND pv.reader_selection_id IS NULL;
                -- assign_current_publication_readers copies the published version's readers.
                UPDATE knowledge_current_publication cp SET updated_at = cp.updated_at
                 WHERE cp.shared_draft_id = publication.shared_draft_id;
            ELSE
                outcome := 'WOULD_MAP';
            END IF;
        END IF;

        target_readers := cardinality(candidate_set);
        wider_readers := (SELECT count(*) FROM unnest(candidate_set) AS member_id
                           WHERE member_id <> ALL (audience_set));
        RETURN NEXT;
    END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION migrate_publication_readers(boolean, uuid) FROM PUBLIC;

DO $$
DECLARE
    result record;
    mapped integer := 0;
    unmapped integer := 0;
BEGIN
    FOR result IN SELECT * FROM migrate_publication_readers(true) LOOP
        RAISE NOTICE 'publication % (%): % readers % -> %, wider %', result.shared_draft_id, result.outcome,
            coalesce(result.reader_mode, 'AUDIENCE'), result.audience_readers, result.target_readers,
            result.wider_readers;
        IF result.outcome = 'MAPPED' AND result.wider_readers > 0 THEN
            RAISE EXCEPTION 'Publication % would gain % readers; nothing was migrated',
                result.shared_draft_id, result.wider_readers USING ERRCODE = '23514';
        END IF;
        IF result.outcome = 'MAPPED' THEN mapped := mapped + 1; END IF;
        IF result.outcome = 'UNMAPPED' THEN unmapped := unmapped + 1; END IF;
    END LOOP;
    RAISE NOTICE 'Target Readers backfill: % mapped, % left on the audience path', mapped, unmapped;
END;
$$;
