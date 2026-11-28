SET search_path TO arden, public;

-- Legacy Q&A is outside the current Reader/Company interaction model.
-- Require a preservation decision if this installation has historical rows.
LOCK TABLE audit_event, citation, ai_response, user_question, knowledge_chunk IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM audit_event WHERE question_id IS NOT NULL)
       OR EXISTS (SELECT 1 FROM citation)
       OR EXISTS (SELECT 1 FROM ai_response)
       OR EXISTS (SELECT 1 FROM user_question)
       OR EXISTS (SELECT 1 FROM knowledge_chunk) THEN
        RAISE EXCEPTION 'Legacy Q&A or audit references must be preserved before cutover';
    END IF;
END;
$$;

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
    END IF;

    RETURN NEW;
END;
$$;

ALTER TABLE audit_event
    DROP CONSTRAINT ck_audit_event_single_subject,
    DROP CONSTRAINT fk_audit_event_question,
    DROP COLUMN question_id,
    ADD CONSTRAINT ck_audit_event_single_subject
        CHECK (num_nonnulls(role_assignment_id, review_decision_id) <= 1);

DROP TABLE citation;
DROP TABLE ai_response;
DROP TABLE user_question;
DROP TABLE knowledge_chunk;
DROP FUNCTION validate_citation_tenant_scope();
