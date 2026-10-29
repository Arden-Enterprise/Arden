SET search_path TO arden, public;

-- Forward-only repair: deployments may already have applied 0019. Keep its
-- implementation private behind a serialized, monotonic activation boundary.
ALTER TABLE shared_submission DROP CONSTRAINT ck_shared_submission_publication_state;
ALTER TABLE shared_submission ADD CONSTRAINT ck_shared_submission_publication_state
  CHECK ((status = 'APPROVED' AND publication_state IN ('PREPARING', 'ACTIVE', 'FAILED', 'SUPERSEDED'))
      OR (status <> 'APPROVED' AND publication_state = 'NONE'));

UPDATE shared_submission s SET publication_state = 'SUPERSEDED'
 WHERE s.publication_state = 'ACTIVE' AND NOT EXISTS (
   SELECT 1 FROM knowledge_current_publication cp
   JOIN published_knowledge_version pv ON pv.published_version_id = cp.published_version_id
   WHERE pv.submission_id = s.submission_id);

ALTER FUNCTION complete_knowledge_index_job(uuid, uuid, jsonb)
  RENAME TO complete_knowledge_index_job_unordered_v1;
REVOKE ALL ON FUNCTION complete_knowledge_index_job_unordered_v1(uuid, uuid, jsonb)
  FROM PUBLIC, arden_indexer;

CREATE FUNCTION complete_knowledge_index_job(p_job_id uuid, p_worker_id uuid, p_manifest jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = arden, pg_temp AS $$
DECLARE
    draft_id uuid;
    candidate_version integer;
    newest_published_version integer;
    result_id uuid;
BEGIN
    SELECT g.shared_draft_id INTO STRICT draft_id
      FROM knowledge_index_job j JOIN knowledge_index_generation g USING (generation_id)
     WHERE j.job_id = p_job_id;
    -- Every activation for this draft holds the same lock before inspecting
    -- history or moving the current pointer. The next statement sees the
    -- preceding activation's committed state under READ COMMITTED.
    PERFORM 1 FROM shared_draft WHERE shared_draft_id = draft_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Index draft is unavailable' USING ERRCODE = '23514'; END IF;

    SELECT s.snapshot_version_no INTO STRICT candidate_version
      FROM knowledge_index_job j JOIN knowledge_index_generation g USING (generation_id)
      JOIN shared_submission s ON s.submission_id = g.submission_id
     WHERE j.job_id = p_job_id;
    -- Publication history remains a high-water mark even after unpublication;
    -- deleting a pointer must not enable an older delayed job to resurrect it.
    SELECT max(s.snapshot_version_no) INTO newest_published_version
      FROM published_knowledge_version pv JOIN shared_submission s USING (submission_id)
     WHERE pv.shared_draft_id = draft_id;
    IF newest_published_version >= candidate_version THEN
        RAISE EXCEPTION 'Index generation is superseded by a published snapshot' USING ERRCODE = 'AR001';
    END IF;

    result_id := complete_knowledge_index_job_unordered_v1(p_job_id, p_worker_id, p_manifest);
    UPDATE shared_submission SET publication_state = 'SUPERSEDED'
     WHERE shared_draft_id = draft_id AND publication_state = 'ACTIVE'
       AND submission_id <> (SELECT submission_id FROM published_knowledge_version WHERE published_version_id = result_id);
    RETURN result_id;
END;
$$;
REVOKE ALL ON FUNCTION complete_knowledge_index_job(uuid, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION complete_knowledge_index_job(uuid, uuid, jsonb) TO arden_indexer;

-- This forward migration has not been applied to either release database.
-- Keep terminal job failure distinct from a replaced author-facing snapshot.
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
           available_at = now() + make_interval(secs => LEAST(60, 5 * (2 ^ (job_row.attempt_count - 1))))
     WHERE knowledge_index_job.job_id = p_job_id;
    UPDATE knowledge_index_generation
       SET status = 'PENDING', started_at = NULL
     WHERE generation_id = job_row.generation_id;
    RETURN 'PENDING';
END;
$$;

UPDATE shared_submission s SET publication_state = 'SUPERSEDED'
  FROM knowledge_index_generation g
 WHERE s.submission_id = g.submission_id AND s.publication_state = 'FAILED'
   AND g.failure_code = 'INDEX_GENERATION_SUPERSEDED';
