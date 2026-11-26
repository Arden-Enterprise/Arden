SET search_path TO arden, public;

-- Decision 0021: the Target Readers picker finds active members of the caller's organization by name or
-- email, like sharing in Google Drive, and shows the full email and primary department. Same boundary as
-- 0030: only the caller's organization, only active identities, and the caller must be an active member.
-- Search returns at most 20 suggestions; already-selected IDs (at most 100) are always resolved.
--
-- Operator rollout: replaces one reviewed SECURITY DEFINER routine (the return shape changes, so it is
-- dropped and recreated); apply as the trusted superuser so it keeps its postgres owner (23 in total).

DROP FUNCTION knowledge_reader_directory(text, uuid[]);

CREATE FUNCTION knowledge_reader_directory(p_query text, p_ids uuid[] DEFAULT '{}')
RETURNS TABLE (membership_id uuid, display_name text, email text, department_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = arden, pg_temp AS $$
    WITH members AS (
        SELECT om.membership_id, COALESCE(NULLIF(btrim(ua.full_name), ''), 'Member') AS display_name,
               lower(ua.email) AS email,
               (SELECT d.name FROM department_membership dm
                  JOIN department d ON d.department_id = dm.department_id AND d.status = 'ACTIVE'
                 WHERE dm.membership_id = om.membership_id AND dm.status = 'ACTIVE'
                 ORDER BY dm.is_primary DESC, d.name LIMIT 1) AS department_name
          FROM organization_membership om
          JOIN user_account ua USING (user_id)
          JOIN organization o USING (organization_id)
         WHERE om.organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
           AND om.status = 'ACTIVE' AND ua.status = 'ACTIVE' AND o.status = 'ACTIVE'
           AND cardinality(p_ids) <= 100 AND length(p_query) <= 80
           AND EXISTS (SELECT 1 FROM organization_membership actor
                JOIN user_account account ON account.user_id = actor.user_id
               WHERE actor.organization_id = om.organization_id AND actor.status = 'ACTIVE'
                 AND account.status = 'ACTIVE'
                 AND actor.user_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid)
    ), selected AS (
        SELECT * FROM members WHERE membership_id = ANY(p_ids)
    ), found AS (
        SELECT * FROM members
         WHERE length(btrim(p_query)) >= 2
           AND (strpos(lower(display_name), lower(btrim(p_query))) > 0
             OR strpos(email, lower(btrim(p_query))) > 0)
         -- An exact email first, then names and addresses that start with the query.
         ORDER BY (email = lower(btrim(p_query))) DESC,
                  (lower(display_name) LIKE lower(btrim(p_query)) || '%' OR email LIKE lower(btrim(p_query)) || '%') DESC,
                  display_name, membership_id
         LIMIT 20
    )
    SELECT membership_id, display_name, email, department_name FROM selected
    UNION
    SELECT membership_id, display_name, email, department_name FROM found
    ORDER BY 2, 1;
$$;
REVOKE ALL ON FUNCTION knowledge_reader_directory(text, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION knowledge_reader_directory(text, uuid[]) TO arden_runtime;
