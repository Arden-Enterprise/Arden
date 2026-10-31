SET search_path TO arden, public;

ALTER TABLE reviewer_grant
    ADD COLUMN scope text NOT NULL DEFAULT 'DEPARTMENT';
ALTER TABLE reviewer_grant
    ADD CONSTRAINT ck_reviewer_grant_scope
    CHECK (scope IN ('DEPARTMENT', 'ORGANIZATION'));
ALTER TABLE reviewer_grant ALTER COLUMN department_id DROP NOT NULL;
ALTER TABLE reviewer_grant
    ADD CONSTRAINT ck_reviewer_grant_scope_department
    CHECK ((scope = 'DEPARTMENT') = (department_id IS NOT NULL));
CREATE INDEX ix_reviewer_grant_scope
    ON reviewer_grant (organization_id, scope, status);

ALTER TABLE shared_submission
    ADD COLUMN review_rule text NOT NULL DEFAULT 'LEGACY';
ALTER TABLE shared_submission
    ADD CONSTRAINT ck_shared_submission_review_rule
    CHECK (review_rule IN ('LEGACY', 'GRANT_SCOPE'));
ALTER TABLE shared_submission ALTER COLUMN review_rule SET DEFAULT 'GRANT_SCOPE';

CREATE OR REPLACE FUNCTION protect_flow2_submission_snapshot()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.shared_draft_version_id IS NOT NULL AND
       (NEW.shared_draft_version_id, NEW.shared_draft_id, NEW.snapshot_version_no,
        NEW.organization_id, NEW.submitted_by_membership_id,
        NEW.target_scope_type, NEW.target_department_id, NEW.responsible_department_id,
        NEW.title, NEW.classification, NEW.team_tag, NEW.project_tag,
        NEW.audience_role_ids, NEW.policy_version, NEW.review_rule, NEW.content_uri, NEW.mime_type,
        NEW.content_hash, NEW.submit_request_id)
       IS DISTINCT FROM
       (OLD.shared_draft_version_id, OLD.shared_draft_id, OLD.snapshot_version_no,
        OLD.organization_id, OLD.submitted_by_membership_id,
        OLD.target_scope_type, OLD.target_department_id, OLD.responsible_department_id,
        OLD.title, OLD.classification, OLD.team_tag, OLD.project_tag,
        OLD.audience_role_ids, OLD.policy_version, OLD.review_rule, OLD.content_uri, OLD.mime_type,
        OLD.content_hash, OLD.submit_request_id) THEN
        RAISE EXCEPTION 'Submitted snapshot is immutable' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END;
$$;

-- This function remains a broad RLS prerequisite while its legacy signature has no
-- frozen audience/review-rule argument. TypeScript applies the exact disjoint-scope
-- rule before returning a queue/detail or recording a decision. Tighten the database
-- gate when the legacy review schema is contracted.
CREATE OR REPLACE FUNCTION actor_has_reviewer_grant(p_organization_id uuid, p_department_id uuid,
    p_classification text, p_team_tag text, p_project_tag text)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = arden, pg_temp AS $$
    SELECT p_organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
       AND EXISTS (
          SELECT 1 FROM reviewer_grant g
          JOIN organization_membership om ON om.membership_id = g.reviewer_membership_id
          JOIN user_account ua ON ua.user_id = om.user_id AND ua.status = 'ACTIVE'
          JOIN organization o ON o.organization_id = om.organization_id AND o.status = 'ACTIVE'
          LEFT JOIN department d ON d.department_id = g.department_id
              AND d.organization_id = g.organization_id
          WHERE om.user_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid
            AND om.status = 'ACTIVE' AND om.organization_id = p_organization_id
            AND g.organization_id = p_organization_id
            AND (g.scope = 'ORGANIZATION'
              OR (g.scope = 'DEPARTMENT' AND g.department_id = p_department_id AND d.status = 'ACTIVE'))
            AND g.status = 'ACTIVE' AND g.valid_from <= now()
            AND (g.valid_until IS NULL OR g.valid_until > now())
            AND p_classification = ANY(g.classifications)
            AND (p_classification <> 'RESTRICTED' OR g.level IN ('SPECIALIST', 'SENIOR'))
            AND (g.team_tag IS NULL OR g.team_tag IS NOT DISTINCT FROM p_team_tag)
            AND (g.project_tag IS NULL OR g.project_tag IS NOT DISTINCT FROM p_project_tag));
$$;
COMMENT ON FUNCTION actor_has_reviewer_grant(uuid, uuid, text, text, text) IS
  'Broad RLS prerequisite for legacy callers; API policy enforces exact reviewer-grant scope until schema contraction.';

CREATE OR REPLACE FUNCTION organization_has_active_reviewer_grant(p_organization_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = arden, pg_temp AS $$
    SELECT EXISTS (
        SELECT 1 FROM organization_membership caller
        JOIN user_account caller_user ON caller_user.user_id = caller.user_id
          AND caller_user.status = 'ACTIVE'
        JOIN organization o ON o.organization_id = caller.organization_id AND o.status = 'ACTIVE'
        WHERE caller.user_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid
          AND caller.organization_id = p_organization_id
          AND caller.status = 'ACTIVE')
      AND EXISTS (
        SELECT 1 FROM reviewer_grant g
        JOIN organization_membership reviewer
          ON reviewer.membership_id = g.reviewer_membership_id
         AND reviewer.organization_id = g.organization_id
         AND reviewer.status = 'ACTIVE'
        JOIN user_account reviewer_user ON reviewer_user.user_id = reviewer.user_id
         AND reviewer_user.status = 'ACTIVE'
        WHERE g.organization_id = p_organization_id
          AND g.scope = 'ORGANIZATION'
          AND g.status = 'ACTIVE'
          AND g.valid_from <= now()
          AND (g.valid_until IS NULL OR g.valid_until > now()));
$$;

REVOKE ALL ON FUNCTION organization_has_active_reviewer_grant(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION organization_has_active_reviewer_grant(uuid) TO arden_runtime;
