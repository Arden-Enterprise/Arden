SET search_path TO arden, public;

-- Flow 2 T6.3 (retry part; decision 0011 allows FAILED -> PREPARING): an approved snapshot whose index
-- preparation failed for a temporary reason can be prepared again without a new review.
--   * Automatic retries now span about 15 minutes (6 attempts, backoff 30 s doubling to 8 min) instead of
--     about 15 seconds, so a short Arden-AI restart no longer leaves approvals FAILED. Existing jobs keep
--     their own max_attempts; only the backoff and the default for new jobs change.
--   * The failure reason is kept on the submission so its author can see what kind of failure it was:
--     TEMPORARY (service unavailable, timeout, overload, unexpected), CONTENT (the file was refused) or
--     SYSTEM (configuration, invalid AI output, integrity). Only TEMPORARY can be retried.
--   * retry_knowledge_publication lets the submitting author, while an active member, restart preparation of
--     the same immutable snapshot. It never re-reviews and never activates by itself: activation still goes
--     through complete_knowledge_index_job and its 0021 high-water mark, so a newer publication wins.
--
-- Operator rollout: adds one reviewed SECURITY DEFINER routine (retry_knowledge_publication, 25 in total) and
-- replaces fail_knowledge_index_job; apply as the trusted superuser so both keep their postgres owner.

ALTER TABLE shared_submission ADD COLUMN publication_failure_code text;
ALTER TABLE shared_submission ADD CONSTRAINT ck_shared_submission_failure_code
    CHECK (publication_failure_code IS NULL
        OR (status = 'APPROVED' AND publication_failure_code ~ '^[A-Z][A-Z0-9_]{0,63}$'));

-- One classification for the database (retry eligibility) and the API (what the author is told).
CREATE FUNCTION knowledge_publication_failure_kind(p_code text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = arden, pg_temp AS $$
    SELECT CASE
        WHEN p_code IS NULL THEN NULL
        WHEN p_code IN ('AI_SERVICE_UNAVAILABLE', 'AI_SERVICE_HTTP_408', 'AI_SERVICE_HTTP_429',
                        'INDEXING_UNEXPECTED_FAILURE', 'INDEXING_LEASE_EXHAUSTED')
          OR p_code ~ '^AI_SERVICE_HTTP_5[0-9]{2}$' THEN 'TEMPORARY'
        WHEN p_code IN ('AI_SERVICE_HTTP_400', 'AI_SERVICE_HTTP_413', 'AI_SERVICE_HTTP_415',
                        'AI_SERVICE_HTTP_422', 'AI_MANIFEST_TOO_LARGE') THEN 'CONTENT'
        ELSE 'SYSTEM'
    END
$$;
REVOKE ALL ON FUNCTION knowledge_publication_failure_kind(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION knowledge_publication_failure_kind(text) TO arden_runtime;

-- Both terminal paths (fail_knowledge_index_job and the expired final lease in claim_knowledge_index_job)
-- mark the generation FAILED inside their SECURITY DEFINER routine; copy the code to the submission there.
CREATE FUNCTION record_publication_failure_code()
RETURNS trigger LANGUAGE plpgsql SET search_path = arden, pg_temp AS $$
BEGIN
    IF NEW.status = 'FAILED' AND OLD.status IS DISTINCT FROM 'FAILED' THEN
        UPDATE shared_submission SET publication_failure_code = NEW.failure_code
         WHERE submission_id = NEW.submission_id;
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION record_publication_failure_code() FROM PUBLIC;
CREATE TRIGGER trg_record_publication_failure_code AFTER UPDATE OF status ON knowledge_index_generation
FOR EACH ROW EXECUTE FUNCTION record_publication_failure_code();

UPDATE shared_submission s SET publication_failure_code = g.failure_code
  FROM knowledge_index_generation g
 WHERE g.submission_id = s.submission_id AND g.status = 'FAILED' AND s.publication_state = 'FAILED';

ALTER TABLE knowledge_index_job ALTER COLUMN max_attempts SET DEFAULT 6;
-- The approval trigger inserts jobs as arden_runtime; its 0019 policy pinned the old attempt budget.
DROP POLICY flow3_index_job_approval_insert ON knowledge_index_job;
CREATE POLICY flow3_index_job_approval_insert ON knowledge_index_job
FOR INSERT TO arden_runtime WITH CHECK (
    status = 'PENDING' AND attempt_count = 0 AND max_attempts = 6
    AND available_at <= now() AND lease_owner IS NULL
    AND lease_expires_at IS NULL AND last_error_code IS NULL
    AND completed_at IS NULL
);

-- 0021 behaviour with a longer backoff: 30 s, 60 s, 120 s, 240 s, 480 s (capped at 15 min).
CREATE OR REPLACE FUNCTION fail_knowledge_index_job(
    p_job_id uuid,
    p_worker_id uuid,
    p_error_code text,
    p_retryable boolean DEFAULT true
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = arden, pg_temp
AS $$
DECLARE
    job_row knowledge_index_job%ROWTYPE;
    terminal boolean;
BEGIN
    IF p_error_code IS NULL OR p_error_code !~ '^[A-Z][A-Z0-9_]{0,63}$' THEN
        RAISE EXCEPTION 'Invalid indexing failure code' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO STRICT job_row FROM knowledge_index_job
     WHERE knowledge_index_job.job_id = p_job_id FOR UPDATE;
    IF job_row.status <> 'RUNNING' OR job_row.lease_owner IS DISTINCT FROM p_worker_id THEN
        RAISE EXCEPTION 'Index job lease is no longer valid' USING ERRCODE = '40001';
    END IF;

    terminal := NOT p_retryable OR job_row.attempt_count >= job_row.max_attempts;
    IF terminal THEN
        UPDATE knowledge_index_job
           SET status = 'FAILED', lease_owner = NULL, lease_expires_at = NULL,
               last_error_code = p_error_code, completed_at = now()
         WHERE knowledge_index_job.job_id = p_job_id;
        UPDATE knowledge_index_generation
           SET status = 'FAILED', failure_code = p_error_code, completed_at = now()
         WHERE generation_id = job_row.generation_id;
        UPDATE shared_submission s SET publication_state = CASE
            WHEN p_error_code = 'INDEX_GENERATION_SUPERSEDED' THEN 'SUPERSEDED'
            ELSE 'FAILED' END
          FROM knowledge_index_generation g
         WHERE g.generation_id = job_row.generation_id
           AND s.submission_id = g.submission_id
           AND s.status = 'APPROVED' AND s.publication_state = 'PREPARING';
        RETURN 'FAILED';
    END IF;

    UPDATE knowledge_index_job
       SET status = 'PENDING', lease_owner = NULL, lease_expires_at = NULL,
           last_error_code = p_error_code,
           available_at = now() + make_interval(secs => LEAST(900, 30 * (2 ^ (job_row.attempt_count - 1))))
     WHERE knowledge_index_job.job_id = p_job_id;
    UPDATE knowledge_index_generation
       SET status = 'PENDING', started_at = NULL
     WHERE generation_id = job_row.generation_id;
    RETURN 'PENDING';
END;
$$;
REVOKE ALL ON FUNCTION fail_knowledge_index_job(uuid, uuid, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fail_knowledge_index_job(uuid, uuid, text, boolean) TO arden_indexer;

-- Returns PREPARING (restarted, or already preparing: a repeated call is a no-op), NOT_FOUND (not this
-- actor's submission), NOT_FAILED, NOT_RETRYABLE (CONTENT or SYSTEM failure) or SUPERSEDED (a newer
-- snapshot of the document is already published, so this one could never become current).
CREATE FUNCTION retry_knowledge_publication(p_submission_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = arden, pg_temp AS $$
DECLARE
    actor uuid := NULLIF(current_setting('arden.actor_id', true), '')::uuid;
    org uuid := NULLIF(current_setting('arden.organization_id', true), '')::uuid;
    sub record;
    newest_published integer;
    restarted_generation uuid;
BEGIN
    IF actor IS NULL OR org IS NULL OR p_submission_id IS NULL THEN
        RAISE EXCEPTION 'Retrying a publication needs an actor context' USING ERRCODE = '42501';
    END IF;
    SELECT s.submission_id, s.shared_draft_id, s.snapshot_version_no, s.status, s.request_type,
           s.publication_state, s.publication_failure_code, s.submitted_by_membership_id
      INTO sub
      FROM shared_submission s
      JOIN organization_membership om ON om.membership_id = s.submitted_by_membership_id
     WHERE s.submission_id = p_submission_id AND s.organization_id = org
       AND om.organization_id = org AND om.user_id = actor AND om.status = 'ACTIVE';
    IF NOT FOUND THEN RETURN 'NOT_FOUND'; END IF;

    -- Same lock as activation (0021) and publication changes (0035).
    PERFORM 1 FROM shared_draft WHERE shared_draft_id = sub.shared_draft_id FOR UPDATE;
    SELECT s.status, s.request_type, s.publication_state, s.publication_failure_code
      INTO sub.status, sub.request_type, sub.publication_state, sub.publication_failure_code
      FROM shared_submission s WHERE s.submission_id = p_submission_id FOR UPDATE;

    IF sub.status = 'APPROVED' AND sub.publication_state = 'PREPARING' THEN RETURN 'PREPARING'; END IF;
    IF sub.status <> 'APPROVED' OR sub.request_type <> 'CONTENT' OR sub.publication_state <> 'FAILED' THEN
        RETURN 'NOT_FAILED';
    END IF;
    IF knowledge_publication_failure_kind(sub.publication_failure_code) IS DISTINCT FROM 'TEMPORARY' THEN
        RETURN 'NOT_RETRYABLE';
    END IF;
    SELECT max(s.snapshot_version_no) INTO newest_published
      FROM published_knowledge_version pv JOIN shared_submission s USING (submission_id)
     WHERE pv.shared_draft_id = sub.shared_draft_id;
    IF newest_published >= sub.snapshot_version_no THEN RETURN 'SUPERSEDED'; END IF;

    UPDATE knowledge_index_generation
       SET status = 'PENDING', failure_code = NULL, started_at = NULL, completed_at = NULL
     WHERE submission_id = p_submission_id AND status = 'FAILED'
     RETURNING generation_id INTO restarted_generation;
    IF restarted_generation IS NULL THEN
        RAISE EXCEPTION 'The failed preparation is unavailable' USING ERRCODE = '55000';
    END IF;
    UPDATE knowledge_index_job
       SET status = 'PENDING', attempt_count = 0, max_attempts = 6, available_at = now(),
           lease_owner = NULL, lease_expires_at = NULL, last_error_code = NULL, completed_at = NULL
     WHERE generation_id = restarted_generation AND status = 'FAILED';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'The failed preparation job is unavailable' USING ERRCODE = '55000';
    END IF;
    UPDATE shared_submission SET publication_state = 'PREPARING', publication_failure_code = NULL
     WHERE submission_id = p_submission_id;
    INSERT INTO audit_event (organization_id, actor_membership_id, event_type, outcome, details_json)
    VALUES (org, sub.submitted_by_membership_id, 'KNOWLEDGE_PUBLICATION_RETRIED', 'SUCCESS',
            jsonb_build_object('submissionId', p_submission_id, 'draftId', sub.shared_draft_id,
                               'generationId', restarted_generation,
                               'previousFailureCode', sub.publication_failure_code));
    RETURN 'PREPARING';
END;
$$;
REVOKE ALL ON FUNCTION retry_knowledge_publication(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION retry_knowledge_publication(uuid) TO arden_runtime;
