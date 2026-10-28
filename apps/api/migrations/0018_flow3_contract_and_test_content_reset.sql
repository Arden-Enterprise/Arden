SET search_path TO arden, public;

-- Mainflow 3 starts from a deliberately clean content corpus. The project
-- owner confirmed that every existing content row is disposable test data.
-- Identity, organizations, departments, audiences and reviewer grants remain.
-- The reset deliberately suspends append-only guards only inside this atomic
-- migration, then reinstates the same guards before commit.
DROP TRIGGER trg_audit_event_append_only ON audit_event;
DROP TRIGGER trg_review_decision_immutable ON review_decision;
DROP TRIGGER trg_published_version_immutable ON published_knowledge_version;
DROP TRIGGER trg_shared_draft_version_immutable ON shared_draft_version;
DROP TRIGGER trg_draft_version_immutable ON draft_version;

DELETE FROM audit_event
 WHERE review_decision_id IS NOT NULL
    OR question_id IS NOT NULL
    OR event_type LIKE 'PRIVATE_DRAFT_%'
    OR event_type LIKE 'SHARED_DRAFT_%'
    OR event_type LIKE 'KNOWLEDGE_%';
DELETE FROM citation;
DELETE FROM ai_response;
DELETE FROM user_question;
DELETE FROM knowledge_chunk;

-- Break the legacy source/publication cycle before clearing both sides.
UPDATE shared_draft SET source_published_version_id = NULL
 WHERE source_published_version_id IS NOT NULL;
DELETE FROM knowledge_current_publication;
DELETE FROM published_knowledge_version;
DELETE FROM review_decision;
DELETE FROM shared_submission;
DELETE FROM shared_draft_audience;
DELETE FROM shared_draft_version;
DELETE FROM shared_draft;
DELETE FROM draft_version;
DELETE FROM draft_document;
DELETE FROM knowledge_base;

CREATE TRIGGER trg_audit_event_append_only BEFORE UPDATE OR DELETE ON audit_event
  FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();
CREATE TRIGGER trg_review_decision_immutable BEFORE UPDATE OR DELETE ON review_decision
  FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();
CREATE TRIGGER trg_published_version_immutable BEFORE UPDATE OR DELETE ON published_knowledge_version
  FOR EACH ROW EXECUTE FUNCTION protect_published_version_content();
CREATE TRIGGER trg_shared_draft_version_immutable BEFORE UPDATE OR DELETE ON shared_draft_version
  FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();
CREATE TRIGGER trg_draft_version_immutable BEFORE UPDATE OR DELETE ON draft_version
  FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();

-- Review has exactly two terminal decisions. Historical CHANGES_REQUESTED
-- compatibility is intentionally removed with the discarded test corpus.
ALTER TABLE shared_submission DROP CONSTRAINT ck_shared_submission_status;
ALTER TABLE shared_submission ADD CONSTRAINT ck_shared_submission_status
  CHECK (status IN ('PENDING_REVIEW', 'APPROVED', 'REJECTED', 'WITHDRAWN'));
ALTER TABLE review_decision DROP CONSTRAINT ck_review_decision_value;
ALTER TABLE review_decision ADD CONSTRAINT ck_review_decision_value
  CHECK (decision IN ('APPROVED', 'REJECTED'));

ALTER TABLE shared_submission ADD COLUMN publication_state text NOT NULL DEFAULT 'NONE';
ALTER TABLE shared_submission ADD CONSTRAINT ck_shared_submission_publication_state
  CHECK ((status = 'APPROVED' AND publication_state IN ('PREPARING', 'ACTIVE', 'FAILED'))
      OR (status <> 'APPROVED' AND publication_state = 'NONE'));

-- A working draft and its audience metadata remain mutable while the submitted
-- snapshot stays immutable.
DROP TRIGGER trg_reject_pending_shared_draft_change ON shared_draft;
DROP TRIGGER trg_reject_pending_shared_draft_audience_change ON shared_draft_audience;

CREATE UNIQUE INDEX uq_flow3_open_release_candidate
  ON shared_submission(shared_draft_id) WHERE status = 'PENDING_REVIEW';

GRANT UPDATE (publication_state) ON shared_submission TO arden_runtime;

DROP POLICY flow2_submission_reviewer_update ON shared_submission;
CREATE POLICY flow3_submission_reviewer_update ON shared_submission FOR UPDATE TO arden_runtime
  USING (shared_draft_version_id IS NOT NULL AND status = 'PENDING_REVIEW'
     AND (current_setting('arden.org_admin', true) = 'true'
       OR actor_has_reviewer_grant(organization_id, responsible_department_id,
            classification, team_tag, project_tag)))
  WITH CHECK (shared_draft_version_id IS NOT NULL
     AND status IN ('APPROVED', 'REJECTED')
     AND (current_setting('arden.org_admin', true) = 'true'
       OR actor_has_reviewer_grant(organization_id, responsible_department_id,
            classification, team_tag, project_tag)));

CREATE POLICY flow3_submission_org_admin_read ON shared_submission FOR SELECT TO arden_runtime
  USING (organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
     AND current_setting('arden.org_admin', true) = 'true');

-- Legacy valid_from/valid_until columns stay for forward compatibility, but
-- Flow 3 publication eligibility is the active pointer plus current audience
-- policy. Dates no longer hide a current publication.
DROP POLICY flow2_current_publication_audience_read ON knowledge_current_publication;
CREATE POLICY flow3_current_publication_audience_read ON knowledge_current_publication FOR SELECT TO arden_runtime
  USING (organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
     AND actor_in_publication_audience(organization_id, audience_role_ids,
         target_scope_type, target_department_id));

DROP POLICY flow2_review_decision_insert ON review_decision;
CREATE POLICY flow3_review_decision_insert ON review_decision FOR INSERT TO arden_runtime
  WITH CHECK (flow2 AND EXISTS (SELECT 1 FROM shared_submission s
      WHERE s.submission_id = review_decision.submission_id AND s.status = 'PENDING_REVIEW'
        AND ((current_setting('arden.org_admin', true) = 'true')
          OR (s.submitted_by_membership_id <> review_decision.reviewer_membership_id
            AND actor_has_reviewer_grant(s.organization_id, s.responsible_department_id,
                s.classification, s.team_tag, s.project_tag))))
     AND EXISTS (SELECT 1 FROM organization_membership om
         WHERE om.membership_id = review_decision.reviewer_membership_id
           AND om.user_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid
           AND om.status = 'ACTIVE'));

CREATE OR REPLACE FUNCTION validate_review_decision()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = arden, pg_temp AS $$
DECLARE submission_row record; reviewer_org uuid; is_org_admin boolean;
BEGIN
    SELECT s.submitted_by_membership_id, s.organization_id, s.shared_draft_version_id,
           s.content_hash, s.responsible_department_id, s.classification,
           s.team_tag, s.project_tag, s.audience_role_ids, s.status
      INTO STRICT submission_row FROM shared_submission s WHERE s.submission_id = NEW.submission_id;
    SELECT organization_id INTO STRICT reviewer_org FROM organization_membership
     WHERE membership_id = NEW.reviewer_membership_id;
    is_org_admin := COALESCE(current_setting('arden.org_admin', true), 'false') = 'true';
    IF reviewer_org IS DISTINCT FROM submission_row.organization_id
       OR (NEW.reviewer_membership_id = submission_row.submitted_by_membership_id AND NOT is_org_admin) THEN
        RAISE EXCEPTION 'Reviewer authority does not cover this submission' USING ERRCODE = '23514';
    END IF;
    IF submission_row.shared_draft_version_id IS NOT NULL THEN
        IF NOT NEW.flow2
            OR NEW.snapshot_version_id IS DISTINCT FROM submission_row.shared_draft_version_id
            OR NEW.content_hash IS DISTINCT FROM submission_row.content_hash
            OR (NOT is_org_admin AND NOT actor_has_reviewer_grant(submission_row.organization_id,
                submission_row.responsible_department_id, submission_row.classification,
                submission_row.team_tag, submission_row.project_tag)) THEN
            RAISE EXCEPTION 'Review decision does not match a live authorized snapshot' USING ERRCODE = '23514';
        END IF;
        IF NEW.decision = 'APPROVED' AND NOT audience_snapshot_enforceable(
            submission_row.organization_id, submission_row.audience_role_ids,
            (SELECT target_scope_type FROM shared_submission WHERE submission_id = NEW.submission_id),
            (SELECT target_department_id FROM shared_submission WHERE submission_id = NEW.submission_id)) THEN
            RAISE EXCEPTION 'Approval audience is no longer enforceable' USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION apply_review_decision()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    UPDATE shared_submission
       SET status = NEW.decision,
           publication_state = CASE WHEN NEW.decision = 'APPROVED' THEN 'PREPARING' ELSE 'NONE' END
     WHERE submission_id = NEW.submission_id;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_flow2_review_outcome()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = arden, pg_temp AS $$
DECLARE submission_row record; publication_count integer;
BEGIN
    IF NOT NEW.flow2 THEN RETURN NEW; END IF;
    SELECT status, publication_state, organization_id, responsible_department_id,
           classification, team_tag, project_tag
      INTO STRICT submission_row FROM shared_submission WHERE submission_id = NEW.submission_id;
    IF submission_row.status IS DISTINCT FROM NEW.decision THEN
        RAISE EXCEPTION 'Review decision and submission status diverged' USING ERRCODE = '23514';
    END IF;
    IF COALESCE(current_setting('arden.org_admin', true), 'false') <> 'true'
       AND NOT actor_has_reviewer_grant(submission_row.organization_id,
           submission_row.responsible_department_id, submission_row.classification,
           submission_row.team_tag, submission_row.project_tag) THEN
        RAISE EXCEPTION 'Review decision lacks current reviewer authority' USING ERRCODE = '23514';
    END IF;
    SELECT count(*) INTO publication_count FROM published_knowledge_version
     WHERE submission_id = NEW.submission_id;
    IF NEW.decision = 'APPROVED' THEN
        IF submission_row.publication_state <> 'PREPARING' OR publication_count <> 0 THEN
            RAISE EXCEPTION 'Approval must enter PREPARING without activating a publication'
                USING ERRCODE = '23514';
        END IF;
    ELSIF publication_count <> 0 THEN
        RAISE EXCEPTION 'Rejected submission cannot be published' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM audit_event a WHERE a.review_decision_id = NEW.review_decision_id
        AND a.event_type = 'KNOWLEDGE_REVIEW_DECIDED' AND a.outcome = 'SUCCESS') THEN
        RAISE EXCEPTION 'Review decision needs a separate audit record' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
