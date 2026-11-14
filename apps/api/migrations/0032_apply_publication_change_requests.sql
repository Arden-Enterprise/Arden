SET search_path TO arden, public;

-- Flow 2 T6.2 (BM04 RF-03, SDD S-16, M-05): approving a reader-change or withdrawal request.
--   * READER_CHANGE: the approved readers (the request's proposed readers, kept or narrowed by the reviewer as
--     in T2.1) become the readers of the current publication on the next request.
--   * WITHDRAWAL: the current pointer is removed, so the document leaves the library, search, Ask Arden and
--     citations on the next request; the released submission is marked WITHDRAWN. There is no restore:
--     publishing again needs a new content submission, which the 0021 high-water mark still orders.
-- Both apply only while the request still names the current publication. A withdrawal is refused while a
-- newer approved version is still being prepared, because its activation would publish the document again.
--
-- Operator rollout: adds one reviewed SECURITY DEFINER routine (apply_publication_change); apply as the
-- trusted superuser so it keeps its postgres owner.

-- An approved change request has no index preparation of its own; a released version can end WITHDRAWN.
ALTER TABLE shared_submission DROP CONSTRAINT ck_shared_submission_publication_state;
ALTER TABLE shared_submission ADD CONSTRAINT ck_shared_submission_publication_state CHECK (
    (status = 'APPROVED' AND request_type = 'CONTENT'
        AND publication_state IN ('PREPARING', 'ACTIVE', 'FAILED', 'SUPERSEDED', 'WITHDRAWN'))
    OR (status = 'APPROVED' AND request_type <> 'CONTENT' AND publication_state = 'NONE')
    OR (status <> 'APPROVED' AND publication_state = 'NONE'));

DROP TRIGGER trg_reject_change_request_approval ON review_decision;
DROP FUNCTION reject_change_request_approval();

-- Runs inside the review decision transaction, after the request row is APPROVED with its readers. It reads
-- and writes only the request's own document. Calling it again cannot do more than the approval allowed.
CREATE FUNCTION apply_publication_change(p_submission_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = arden, pg_temp AS $$
DECLARE request record; current_version uuid;
BEGIN
    SELECT s.request_type, s.shared_draft_id, s.target_published_version_id, s.approved_selection_id, s.status
      INTO request FROM shared_submission s WHERE s.submission_id = p_submission_id;
    IF NOT FOUND OR request.status <> 'APPROVED' OR request.request_type = 'CONTENT' THEN
        RAISE EXCEPTION 'Only an approved change request can be applied' USING ERRCODE = '55000';
    END IF;
    -- Same lock as activation (0021), so a pointer change and an activation of this document serialize.
    PERFORM 1 FROM shared_draft WHERE shared_draft_id = request.shared_draft_id FOR UPDATE;
    SELECT cp.published_version_id INTO current_version
      FROM knowledge_current_publication cp WHERE cp.shared_draft_id = request.shared_draft_id FOR UPDATE;
    IF current_version IS DISTINCT FROM request.target_published_version_id THEN
        RAISE EXCEPTION 'The publication changed after the request was made' USING ERRCODE = '40001';
    END IF;

    IF request.request_type = 'READER_CHANGE' THEN
        IF request.approved_selection_id IS NULL THEN
            RAISE EXCEPTION 'A reader change needs approved readers' USING ERRCODE = '23514';
        END IF;
        UPDATE published_knowledge_version SET reader_selection_id = request.approved_selection_id
         WHERE published_version_id = current_version;
        -- assign_current_publication_readers copies the published version's readers to the pointer.
        UPDATE knowledge_current_publication SET updated_at = now() WHERE shared_draft_id = request.shared_draft_id;
    ELSE
        IF EXISTS (SELECT 1 FROM shared_submission c WHERE c.shared_draft_id = request.shared_draft_id
                     AND c.status = 'APPROVED' AND c.publication_state = 'PREPARING') THEN
            RAISE EXCEPTION 'A newer version is being prepared; withdraw after it finishes' USING ERRCODE = '40001';
        END IF;
        UPDATE shared_submission SET publication_state = 'WITHDRAWN'
         WHERE submission_id = (SELECT pv.submission_id FROM published_knowledge_version pv
                                 WHERE pv.published_version_id = current_version);
        DELETE FROM knowledge_current_publication WHERE shared_draft_id = request.shared_draft_id;
    END IF;
END;
$$;
REVOKE ALL ON FUNCTION apply_publication_change(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION apply_publication_change(uuid) TO arden_runtime;

-- 0025 behaviour for content submissions; an approved change request is applied instead of indexed.
CREATE OR REPLACE FUNCTION apply_review_decision()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE new_generation_id uuid; kind text;
BEGIN
    UPDATE shared_submission
       SET status = NEW.decision,
           publication_state = CASE WHEN NEW.decision = 'APPROVED' AND request_type = 'CONTENT'
                                    THEN 'PREPARING' ELSE 'NONE' END,
           approved_selection_id = COALESCE(NEW.approved_selection_id, approved_selection_id)
     WHERE submission_id = NEW.submission_id
     RETURNING request_type INTO kind;

    IF NEW.flow2 AND NEW.decision = 'APPROVED' AND kind <> 'CONTENT' THEN
        PERFORM apply_publication_change(NEW.submission_id);
    ELSIF NEW.flow2 AND NEW.decision = 'APPROVED' THEN
        new_generation_id := gen_random_uuid();
        INSERT INTO knowledge_index_generation (
            generation_id, organization_id, submission_id, shared_draft_id,
            snapshot_version_id, snapshot_content_hash)
        SELECT new_generation_id, organization_id, submission_id, shared_draft_id,
               shared_draft_version_id, content_hash
          FROM shared_submission
         WHERE submission_id = NEW.submission_id;

        INSERT INTO knowledge_index_job (generation_id) VALUES (new_generation_id);
    END IF;
    RETURN NEW;
END;
$$;

-- 0018 rule for content approvals (PREPARING, nothing published yet). An approved change request publishes
-- nothing of its own and stays NONE; it acted on an existing publication through apply_publication_change.
CREATE OR REPLACE FUNCTION enforce_flow2_review_outcome()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = arden, pg_temp AS $$
DECLARE submission_row record; publication_count integer;
BEGIN
    IF NOT NEW.flow2 THEN RETURN NEW; END IF;
    SELECT status, publication_state, organization_id, responsible_department_id,
           classification, team_tag, project_tag, request_type
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
        IF publication_count <> 0
           OR (submission_row.request_type = 'CONTENT' AND submission_row.publication_state <> 'PREPARING')
           OR (submission_row.request_type <> 'CONTENT' AND submission_row.publication_state <> 'NONE') THEN
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
