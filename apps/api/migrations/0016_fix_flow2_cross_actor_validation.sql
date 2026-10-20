SET search_path TO arden, public;

-- Review and publication run as the reviewer. Cross-actor validation must not
-- depend on reading the submitter's membership because that row is correctly
-- hidden from the reviewer by membership_actor_read.
CREATE OR REPLACE FUNCTION validate_audit_event_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = arden, pg_temp
AS $$
DECLARE
    related_org uuid;
BEGIN
    IF NEW.actor_membership_id IS NOT NULL THEN
        SELECT organization_id
          INTO STRICT related_org
          FROM organization_membership
         WHERE membership_id = NEW.actor_membership_id;

        IF related_org <> NEW.organization_id THEN
            RAISE EXCEPTION 'Audit actor must belong to the audit organization'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    IF NEW.role_assignment_id IS NOT NULL THEN
        SELECT m.organization_id
          INTO STRICT related_org
          FROM role_assignment ra
          JOIN organization_membership m ON m.membership_id = ra.membership_id
         WHERE ra.role_assignment_id = NEW.role_assignment_id;

        IF related_org <> NEW.organization_id THEN
            RAISE EXCEPTION 'Audited role assignment belongs to another organization'
                USING ERRCODE = '23514';
        END IF;
    ELSIF NEW.review_decision_id IS NOT NULL THEN
        SELECT COALESCE(s.organization_id, reviewer.organization_id)
          INTO STRICT related_org
          FROM review_decision rd
          JOIN shared_submission s ON s.submission_id = rd.submission_id
          JOIN organization_membership reviewer
            ON reviewer.membership_id = rd.reviewer_membership_id
         WHERE rd.review_decision_id = NEW.review_decision_id;

        IF related_org <> NEW.organization_id THEN
            RAISE EXCEPTION 'Audited review decision belongs to another organization'
                USING ERRCODE = '23514';
        END IF;
    ELSIF NEW.question_id IS NOT NULL THEN
        SELECT m.organization_id
          INTO STRICT related_org
          FROM user_question q
          JOIN organization_membership m ON m.membership_id = q.membership_id
         WHERE q.question_id = NEW.question_id;

        IF related_org <> NEW.organization_id THEN
            RAISE EXCEPTION 'Audited question belongs to another organization'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION validate_published_version()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = arden, pg_temp
AS $$
DECLARE
    submission_row record;
    knowledge_row record;
    submission_org uuid;
    publisher_org uuid;
BEGIN
    SELECT s.*
      INTO STRICT submission_row
      FROM shared_submission s
     WHERE s.submission_id = NEW.submission_id;

    SELECT organization_id, scope_type, department_id
      INTO STRICT knowledge_row
      FROM knowledge_base
     WHERE knowledge_base_id = NEW.knowledge_base_id;

    IF submission_row.shared_draft_version_id IS NOT NULL THEN
        submission_org := submission_row.organization_id;
    ELSE
        SELECT organization_id
          INTO STRICT submission_org
          FROM organization_membership
         WHERE membership_id = submission_row.submitted_by_membership_id;
    END IF;

    IF submission_row.status <> 'APPROVED'
        OR submission_org IS DISTINCT FROM knowledge_row.organization_id THEN
        RAISE EXCEPTION 'Publication requires an approved same-organization submission'
            USING ERRCODE = '23514';
    END IF;

    IF submission_row.shared_draft_version_id IS NOT NULL THEN
        IF NEW.published_by_membership_id IS NOT NULL
            OR NOT EXISTS (SELECT 1 FROM review_decision rd
                WHERE rd.submission_id = NEW.submission_id AND rd.flow2 AND rd.decision = 'APPROVED')
            OR NEW.shared_draft_id IS DISTINCT FROM submission_row.shared_draft_id
            OR NEW.title IS DISTINCT FROM submission_row.title
            OR NEW.classification IS DISTINCT FROM submission_row.classification
            OR NEW.responsible_department_id IS DISTINCT FROM submission_row.responsible_department_id
            OR NEW.audience_role_ids IS DISTINCT FROM submission_row.audience_role_ids
            OR NEW.content_uri IS DISTINCT FROM submission_row.content_uri
            OR NEW.content_hash IS DISTINCT FROM submission_row.content_hash
            OR NEW.valid_from IS NULL
            OR knowledge_row.scope_type IS DISTINCT FROM submission_row.target_scope_type
            OR knowledge_row.department_id IS DISTINCT FROM submission_row.target_department_id THEN
            RAISE EXCEPTION 'System publication must match the exact approved snapshot and scope'
                USING ERRCODE = '23514';
        END IF;
    ELSE
        SELECT organization_id
          INTO STRICT publisher_org
          FROM organization_membership
         WHERE membership_id = NEW.published_by_membership_id;

        IF publisher_org IS DISTINCT FROM submission_org THEN
            RAISE EXCEPTION 'Legacy publisher belongs to another organization'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

-- The original current-publication write policies selected the new published
-- row, while the published-row read policy selected the current pointer. That
-- circular RLS expansion fails before the exact-pointer trigger can run. Check
-- the approved submission here; trg_validate_current_publication still proves
-- that every pointer field matches the referenced published version.
DROP POLICY flow2_current_publication_reviewer_insert ON knowledge_current_publication;
CREATE POLICY flow2_current_publication_reviewer_insert
ON knowledge_current_publication FOR INSERT TO arden_runtime
WITH CHECK (
    organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
    AND EXISTS (
        SELECT 1
          FROM shared_submission s
         WHERE s.submission_id::text = current_setting('arden.publishing_submission_id', true)
           AND s.status = 'APPROVED'
           AND s.shared_draft_id = knowledge_current_publication.shared_draft_id
           AND s.organization_id = knowledge_current_publication.organization_id
           AND s.audience_role_ids = knowledge_current_publication.audience_role_ids
           AND s.target_scope_type = knowledge_current_publication.target_scope_type
           AND s.target_department_id IS NOT DISTINCT FROM knowledge_current_publication.target_department_id
           AND actor_has_reviewer_grant(s.organization_id, s.responsible_department_id,
               s.classification, s.team_tag, s.project_tag)
    )
);

DROP POLICY flow2_current_publication_reviewer_update ON knowledge_current_publication;
CREATE POLICY flow2_current_publication_reviewer_update
ON knowledge_current_publication FOR UPDATE TO arden_runtime
USING (
    organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
    AND EXISTS (
        SELECT 1
          FROM shared_submission s
         WHERE s.shared_draft_id = knowledge_current_publication.shared_draft_id
           AND s.organization_id = knowledge_current_publication.organization_id
           AND s.submission_id::text = current_setting('arden.publishing_submission_id', true)
           AND actor_has_reviewer_grant(s.organization_id, s.responsible_department_id,
               s.classification, s.team_tag, s.project_tag)
    )
)
WITH CHECK (
    organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
    AND EXISTS (
        SELECT 1
          FROM shared_submission s
         WHERE s.submission_id::text = current_setting('arden.publishing_submission_id', true)
           AND s.status = 'APPROVED'
           AND s.shared_draft_id = knowledge_current_publication.shared_draft_id
           AND s.organization_id = knowledge_current_publication.organization_id
           AND s.audience_role_ids = knowledge_current_publication.audience_role_ids
           AND s.target_scope_type = knowledge_current_publication.target_scope_type
           AND s.target_department_id IS NOT DISTINCT FROM knowledge_current_publication.target_department_id
           AND actor_has_reviewer_grant(s.organization_id, s.responsible_department_id,
               s.classification, s.team_tag, s.project_tag)
    )
);
