SET search_path TO arden, public;

-- Reviews list (REV-02): reviewers see who submitted each item, as REVIEWS-REDESIGN already specifies
-- ("Author · date"). Members cannot read each other's profiles under RLS, so this returns only display
-- names, only for submissions in the caller's current organization that the caller may review now,
-- has already decided, or administers. The API applies the exact review rule first; this is the
-- database backstop. Adds one postgres-owned SECURITY DEFINER routine (inventory 18 -> 19).
CREATE FUNCTION review_submission_authors(p_submission_ids uuid[])
RETURNS TABLE (submission_id uuid, display_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = arden, pg_temp AS $$
    SELECT s.submission_id, COALESCE(NULLIF(btrim(ua.full_name), ''), ua.email)
      FROM shared_submission s
      JOIN organization_membership author ON author.membership_id = s.submitted_by_membership_id
      JOIN user_account ua ON ua.user_id = author.user_id
      JOIN organization_membership actor
        ON actor.organization_id = s.organization_id AND actor.status = 'ACTIVE'
       AND actor.user_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid
     WHERE s.submission_id = ANY(p_submission_ids)
       AND cardinality(p_submission_ids) <= 200
       AND s.shared_draft_version_id IS NOT NULL
       AND s.organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
       AND (EXISTS (SELECT 1 FROM role_assignment ra
               JOIN role r ON r.role_id = ra.role_id AND r.code = 'ORG_ADMIN' AND r.is_system AND r.status = 'ACTIVE'
               JOIN access_scope scope ON scope.access_scope_id = ra.access_scope_id
                AND scope.organization_id = s.organization_id AND scope.scope_type = 'ORGANIZATION'
                AND scope.status = 'ACTIVE'
              WHERE ra.membership_id = actor.membership_id AND ra.status = 'ACTIVE'
                AND ra.valid_from <= now() AND (ra.valid_until IS NULL OR ra.valid_until > now()))
         OR EXISTS (SELECT 1 FROM review_decision rd
              WHERE rd.submission_id = s.submission_id AND rd.flow2
                AND rd.reviewer_membership_id = actor.membership_id)
         OR (s.status = 'PENDING_REVIEW' AND actor.membership_id <> s.submitted_by_membership_id
             AND actor_has_reviewer_grant(s.organization_id, s.responsible_department_id,
                 s.classification, s.team_tag, s.project_tag)));
$$;
REVOKE ALL ON FUNCTION review_submission_authors(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION review_submission_authors(uuid[]) TO arden_runtime;
