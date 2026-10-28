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
