SET search_path TO arden, public;

-- One generation owns one dispatch record. Carry over its identity, retry
-- budget, lease and timestamps, including those of a worker still in flight.
LOCK TABLE knowledge_index_generation, knowledge_index_job IN ACCESS EXCLUSIVE MODE;

ALTER TABLE knowledge_index_generation
    ADD COLUMN job_id uuid,
    ADD COLUMN job_status text,
    ADD COLUMN attempt_count integer,
    ADD COLUMN max_attempts integer,
    ADD COLUMN available_at timestamptz,
    ADD COLUMN lease_owner_id uuid,
    ADD COLUMN lease_expires_at timestamptz,
    ADD COLUMN last_error_code text,
    ADD COLUMN job_created_at timestamptz,
    ADD COLUMN job_completed_at timestamptz,
    ADD COLUMN job_updated_at timestamptz;

ALTER TABLE knowledge_index_generation DISABLE TRIGGER trg_knowledge_index_generation_updated_at;
UPDATE knowledge_index_generation g SET
    job_id = j.job_id, job_status = j.status, attempt_count = j.attempt_count, max_attempts = j.max_attempts,
    available_at = j.available_at, lease_owner_id = j.lease_owner, lease_expires_at = j.lease_expires_at,
    last_error_code = j.last_error_code, job_created_at = j.created_at,
    job_completed_at = j.completed_at, job_updated_at = j.updated_at
FROM knowledge_index_job j WHERE j.generation_id = g.generation_id;
ALTER TABLE knowledge_index_generation ENABLE TRIGGER trg_knowledge_index_generation_updated_at;

CREATE UNIQUE INDEX uq_index_generation_job_id ON knowledge_index_generation (job_id);
CREATE INDEX ix_index_generation_dispatch
    ON knowledge_index_generation (available_at, job_created_at, job_id)
    WHERE job_status IN ('PENDING', 'RUNNING');
ALTER TABLE knowledge_index_generation ADD CONSTRAINT ck_index_generation_dispatch CHECK (
    (job_id IS NULL AND job_status IS NULL AND attempt_count IS NULL AND max_attempts IS NULL
      AND available_at IS NULL AND lease_owner_id IS NULL AND lease_expires_at IS NULL AND last_error_code IS NULL
      AND job_created_at IS NULL AND job_completed_at IS NULL AND job_updated_at IS NULL)
    OR (job_id IS NOT NULL AND job_status IS NOT NULL AND job_status IN ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED')
      AND attempt_count IS NOT NULL AND max_attempts BETWEEN 1 AND 10 AND max_attempts IS NOT NULL
      AND attempt_count BETWEEN 0 AND max_attempts
      AND available_at IS NOT NULL AND job_created_at IS NOT NULL AND job_updated_at IS NOT NULL
      AND ((job_status = 'RUNNING' AND lease_owner_id IS NOT NULL AND lease_expires_at IS NOT NULL)
        OR (job_status <> 'RUNNING' AND lease_owner_id IS NULL AND lease_expires_at IS NULL))
      AND (job_status IN ('SUCCEEDED', 'FAILED')) = (job_completed_at IS NOT NULL))
);

-- Runtime can still resolve answer sources, but worker leases and dispatch
-- details are not part of that read contract.
REVOKE SELECT ON knowledge_index_generation FROM arden_runtime;
GRANT SELECT (generation_id, organization_id, submission_id, shared_draft_id, snapshot_version_id,
    snapshot_content_hash, status, manifest_json, failure_code, created_at, started_at, completed_at, updated_at)
    ON knowledge_index_generation TO arden_runtime;
ALTER POLICY flow3_generation_approval_insert ON knowledge_index_generation WITH CHECK (
    status = 'PENDING' AND job_status = 'PENDING' AND job_id IS NOT NULL AND attempt_count = 0 AND max_attempts = 6
    AND available_at <= now() AND last_error_code IS NULL AND job_completed_at IS NULL
    AND EXISTS (SELECT 1 FROM shared_submission s
        WHERE s.submission_id = knowledge_index_generation.submission_id
          AND s.organization_id = knowledge_index_generation.organization_id
          AND s.shared_draft_id = knowledge_index_generation.shared_draft_id
          AND s.shared_draft_version_id = knowledge_index_generation.snapshot_version_id
          AND s.content_hash = knowledge_index_generation.snapshot_content_hash
          AND s.status = 'APPROVED' AND s.publication_state = 'PREPARING')
);

CREATE OR REPLACE FUNCTION apply_review_decision()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE kind text;
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
        INSERT INTO knowledge_index_generation (
            organization_id, submission_id, shared_draft_id, snapshot_version_id, snapshot_content_hash,
            job_id, job_status, attempt_count, max_attempts, available_at, job_created_at, job_updated_at)
        SELECT organization_id, submission_id, shared_draft_id, shared_draft_version_id, content_hash,
               gen_random_uuid(), 'PENDING', 0, 6, now(), now(), now()
          FROM shared_submission
         WHERE submission_id = NEW.submission_id;
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION claim_knowledge_index_job(
    p_worker_id uuid,
    p_lease_seconds integer DEFAULT 90
)
RETURNS TABLE (
    job_id uuid,
    generation_id uuid,
    organization_id uuid,
    submission_id uuid,
    snapshot_version_id uuid,
    snapshot_content_hash text,
    source_uri text,
    mime_type text,
    attempt_count integer,
    max_attempts integer
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = arden, pg_temp AS $$
BEGIN
    IF p_worker_id IS NULL OR p_lease_seconds NOT BETWEEN 15 AND 600 THEN
        RAISE EXCEPTION 'Invalid indexing worker lease request' USING ERRCODE = '22023';
    END IF;

    WITH exhausted AS (
        UPDATE knowledge_index_generation g
           SET status = 'FAILED', failure_code = 'INDEXING_LEASE_EXHAUSTED', completed_at = now(),
               job_status = 'FAILED', lease_owner_id = NULL, lease_expires_at = NULL,
               last_error_code = 'INDEXING_LEASE_EXHAUSTED', job_completed_at = now(), job_updated_at = now()
         WHERE g.job_status = 'RUNNING' AND g.lease_expires_at <= now()
           AND g.attempt_count >= g.max_attempts
        RETURNING g.submission_id
    )
    UPDATE shared_submission s SET publication_state = 'FAILED'
      FROM exhausted e
     WHERE s.submission_id = e.submission_id
       AND s.status = 'APPROVED' AND s.publication_state = 'PREPARING';

    RETURN QUERY
    WITH candidate AS (
        SELECT g.generation_id
          FROM knowledge_index_generation g
          JOIN shared_submission s ON s.submission_id = g.submission_id
         WHERE ((g.job_status = 'PENDING' AND g.available_at <= now())
            OR (g.job_status = 'RUNNING' AND g.lease_expires_at <= now()))
           AND g.attempt_count < g.max_attempts
           AND g.status IN ('PENDING', 'PROCESSING')
           AND s.status = 'APPROVED' AND s.publication_state = 'PREPARING'
           AND s.shared_draft_version_id = g.snapshot_version_id AND s.content_hash = g.snapshot_content_hash
         ORDER BY g.available_at, g.job_created_at, g.job_id
         FOR UPDATE OF g, s SKIP LOCKED
         LIMIT 1
    ), claimed AS (
        UPDATE knowledge_index_generation g
           SET status = 'PROCESSING', started_at = COALESCE(g.started_at, now()),
               job_status = 'RUNNING', attempt_count = g.attempt_count + 1, lease_owner_id = p_worker_id,
               lease_expires_at = now() + make_interval(secs => p_lease_seconds), last_error_code = NULL,
               job_updated_at = now()
          FROM candidate c
         WHERE g.generation_id = c.generation_id
        RETURNING g.*
    )
    SELECT g.job_id, g.generation_id, g.organization_id, g.submission_id,
           g.snapshot_version_id, g.snapshot_content_hash, s.content_uri, s.mime_type,
           g.attempt_count, g.max_attempts
      FROM claimed g JOIN shared_submission s ON s.submission_id = g.submission_id;
END;
$$;

CREATE OR REPLACE FUNCTION fail_knowledge_index_job(
    p_job_id uuid,
    p_worker_id uuid,
    p_error_code text,
    p_retryable boolean DEFAULT true
)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = arden, pg_temp AS $$
DECLARE generation_row knowledge_index_generation%ROWTYPE;
BEGIN
    IF p_error_code IS NULL OR p_error_code !~ '^[A-Z][A-Z0-9_]{0,63}$' THEN
        RAISE EXCEPTION 'Invalid indexing failure code' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO STRICT generation_row FROM knowledge_index_generation g WHERE g.job_id = p_job_id FOR UPDATE;
    IF generation_row.job_status <> 'RUNNING' OR generation_row.lease_owner_id IS DISTINCT FROM p_worker_id THEN
        RAISE EXCEPTION 'Index job lease is no longer valid' USING ERRCODE = '40001';
    END IF;

    IF NOT p_retryable OR generation_row.attempt_count >= generation_row.max_attempts THEN
        UPDATE knowledge_index_generation
           SET status = 'FAILED', failure_code = p_error_code, completed_at = now(),
               job_status = 'FAILED', lease_owner_id = NULL, lease_expires_at = NULL,
               last_error_code = p_error_code, job_completed_at = now(), job_updated_at = now()
         WHERE generation_id = generation_row.generation_id;
        UPDATE shared_submission SET publication_state = CASE
            WHEN p_error_code = 'INDEX_GENERATION_SUPERSEDED' THEN 'SUPERSEDED' ELSE 'FAILED' END
         WHERE submission_id = generation_row.submission_id AND status = 'APPROVED' AND publication_state = 'PREPARING';
        RETURN 'FAILED';
    END IF;

    UPDATE knowledge_index_generation
       SET status = 'PENDING', started_at = NULL,
           job_status = 'PENDING', lease_owner_id = NULL, lease_expires_at = NULL, last_error_code = p_error_code,
           available_at = now() + make_interval(secs => LEAST(900, 30 * (2 ^ (generation_row.attempt_count - 1)))),
           job_updated_at = now()
     WHERE generation_id = generation_row.generation_id;
    RETURN 'PENDING';
END;
$$;

CREATE OR REPLACE FUNCTION complete_knowledge_index_job(p_job_id uuid, p_worker_id uuid, p_manifest jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = arden, pg_temp AS $$
DECLARE
    draft_id uuid;
    candidate_version integer;
    newest_published_version integer;
    result_id uuid;
BEGIN
    SELECT g.shared_draft_id INTO STRICT draft_id
      FROM knowledge_index_generation g
     WHERE g.job_id = p_job_id;
    -- Every activation for this draft holds the same lock before inspecting
    -- history or moving the current pointer. The next statement sees the
    -- preceding activation's committed state under READ COMMITTED.
    PERFORM 1 FROM shared_draft WHERE shared_draft_id = draft_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Index draft is unavailable' USING ERRCODE = '23514'; END IF;

    SELECT s.snapshot_version_no INTO STRICT candidate_version
      FROM knowledge_index_generation g
      JOIN shared_submission s ON s.submission_id = g.submission_id
     WHERE g.job_id = p_job_id;
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

CREATE OR REPLACE FUNCTION complete_knowledge_index_job_unordered_v1(
    p_job_id uuid,
    p_worker_id uuid,
    p_manifest jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = arden, pg_temp
AS $$
DECLARE
    generation_row knowledge_index_generation%ROWTYPE;
    submission_row shared_submission%ROWTYPE;
    knowledge_base_id_value uuid;
    published_version_id_value uuid;
    decision_id uuid;
BEGIN
    IF p_manifest IS NULL OR jsonb_typeof(p_manifest) <> 'object' THEN
        RAISE EXCEPTION 'Index manifest must be an object' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO STRICT generation_row FROM knowledge_index_generation g WHERE g.job_id = p_job_id FOR UPDATE;
    IF generation_row.job_status <> 'RUNNING' OR generation_row.lease_owner_id IS DISTINCT FROM p_worker_id
       OR generation_row.lease_expires_at <= clock_timestamp() THEN
        RAISE EXCEPTION 'Index job lease is no longer valid' USING ERRCODE = '40001';
    END IF;
    SELECT * INTO STRICT submission_row FROM shared_submission
     WHERE shared_submission.submission_id = generation_row.submission_id FOR UPDATE;

    IF generation_row.status <> 'PROCESSING'
       OR submission_row.status <> 'APPROVED'
       OR submission_row.publication_state <> 'PREPARING'
       OR submission_row.shared_draft_version_id IS DISTINCT FROM generation_row.snapshot_version_id
       OR submission_row.content_hash IS DISTINCT FROM generation_row.snapshot_content_hash
       OR NOT EXISTS (
           SELECT 1 FROM reader_selection rs
            WHERE rs.selection_id = submission_row.approved_selection_id
              AND rs.organization_id = submission_row.organization_id
       ) THEN
        RAISE EXCEPTION 'Index generation is no longer activatable' USING ERRCODE = '23514';
    END IF;

    IF p_manifest->>'jobId' IS DISTINCT FROM p_job_id::text
       OR p_manifest->>'generationId' IS DISTINCT FROM generation_row.generation_id::text
       OR p_manifest->>'snapshotVersionId' IS DISTINCT FROM generation_row.snapshot_version_id::text
       OR p_manifest->>'snapshotContentHash' IS DISTINCT FROM generation_row.snapshot_content_hash
       OR p_manifest->>'contractVersion' IS DISTINCT FROM '1'
       OR COALESCE(p_manifest->>'compilerVersion', '') = ''
       OR COALESCE(p_manifest->>'chunkingVersion', '') = ''
       OR COALESCE(p_manifest->>'embeddingModel', '') = ''
       OR COALESCE((p_manifest->>'embeddingDimensions')::integer, 0) <= 0
       OR COALESCE(p_manifest->>'markdownContentHash', '') !~ '^[0-9a-f]{64}$'
       OR COALESCE(p_manifest->>'chunksDigest', '') !~ '^[0-9a-f]{64}$'
       OR jsonb_typeof(p_manifest->'chunks') <> 'array'
       OR jsonb_array_length(p_manifest->'chunks') = 0 THEN
        RAISE EXCEPTION 'Index manifest does not match the claimed generation' USING ERRCODE = '23514';
    END IF;

    INSERT INTO knowledge_base (organization_id, department_id, name, scope_type)
    VALUES (submission_row.organization_id, submission_row.target_department_id,
            'Arden Knowledge', submission_row.target_scope_type)
    ON CONFLICT DO NOTHING;

    SELECT kb.knowledge_base_id INTO STRICT knowledge_base_id_value
      FROM knowledge_base kb
     WHERE kb.organization_id = submission_row.organization_id
       AND kb.name = 'Arden Knowledge'
       AND kb.scope_type = submission_row.target_scope_type
       AND kb.department_id IS NOT DISTINCT FROM submission_row.target_department_id
       AND kb.status = 'ACTIVE';

    INSERT INTO published_knowledge_version (
        submission_id, knowledge_base_id, published_by_membership_id,
        shared_draft_id, title, version_no, content_uri, content_hash,
        index_status, classification, responsible_department_id,
        audience_role_ids, valid_from, valid_until)
    VALUES (
        submission_row.submission_id, knowledge_base_id_value, NULL,
        submission_row.shared_draft_id, submission_row.title,
        nextval('flow2_publication_version_seq'), submission_row.content_uri,
        submission_row.content_hash, 'INDEXED', submission_row.classification,
        submission_row.responsible_department_id, submission_row.audience_role_ids,
        now(), NULL)
    RETURNING published_version_id INTO STRICT published_version_id_value;

    INSERT INTO knowledge_current_publication (
        shared_draft_id, organization_id, published_version_id,
        audience_role_ids, target_scope_type, target_department_id,
        valid_from, valid_until)
    VALUES (
        submission_row.shared_draft_id, submission_row.organization_id,
        published_version_id_value, submission_row.audience_role_ids,
        submission_row.target_scope_type, submission_row.target_department_id,
        now(), NULL)
    ON CONFLICT (shared_draft_id) DO UPDATE SET
        published_version_id = EXCLUDED.published_version_id,
        audience_role_ids = EXCLUDED.audience_role_ids,
        target_scope_type = EXCLUDED.target_scope_type,
        target_department_id = EXCLUDED.target_department_id,
        valid_from = EXCLUDED.valid_from,
        valid_until = EXCLUDED.valid_until,
        updated_at = now();

    UPDATE knowledge_index_generation
       SET status = 'READY', manifest_json = p_manifest, completed_at = now(),
           job_status = 'SUCCEEDED', lease_owner_id = NULL, lease_expires_at = NULL,
           job_completed_at = now(), job_updated_at = now()
     WHERE generation_id = generation_row.generation_id;
    UPDATE shared_submission SET publication_state = 'ACTIVE'
     WHERE submission_id = submission_row.submission_id;

    SELECT rd.review_decision_id INTO STRICT decision_id
      FROM review_decision rd
     WHERE rd.submission_id = submission_row.submission_id
       AND rd.flow2 AND rd.decision = 'APPROVED';
    INSERT INTO audit_event (
        organization_id, actor_membership_id, review_decision_id,
        event_type, outcome, details_json)
    VALUES (
        submission_row.organization_id, NULL, decision_id,
        'KNOWLEDGE_INDEX_ACTIVATED', 'SUCCESS',
        jsonb_build_object(
            'jobId', p_job_id,
            'generationId', generation_row.generation_id,
            'publishedVersionId', published_version_id_value,
            'snapshotVersionId', generation_row.snapshot_version_id));

    RETURN published_version_id_value;
END;
$$;

CREATE OR REPLACE FUNCTION retry_knowledge_publication(p_submission_id uuid)
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
       SET status = 'PENDING', failure_code = NULL, started_at = NULL, completed_at = NULL,
           job_status = 'PENDING', attempt_count = 0, max_attempts = 6, available_at = now(),
           lease_owner_id = NULL, lease_expires_at = NULL, last_error_code = NULL,
           job_completed_at = NULL, job_updated_at = now()
     WHERE submission_id = p_submission_id AND status = 'FAILED' AND job_status = 'FAILED'
     RETURNING generation_id INTO restarted_generation;
    IF restarted_generation IS NULL THEN
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

CREATE OR REPLACE FUNCTION record_index_ai_usage(p_job_id uuid, p_worker_id uuid, p_events jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = arden, pg_temp AS $$
DECLARE job_org uuid; job_generation uuid; event jsonb; inserted integer := 0; event_id uuid; operation text;
        provider_name text; model_name text; input_count bigint; output_count bigint;
        duration_ms integer; complete_usage boolean;
BEGIN
    IF current_setting('role', true) <> 'arden_indexer'
       OR p_events IS NULL OR jsonb_typeof(p_events) IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'Index usage write is unavailable' USING ERRCODE='42501';
    END IF;
    IF jsonb_array_length(p_events) > 32 THEN
        RAISE EXCEPTION 'Index usage write is unavailable' USING ERRCODE='42501';
    END IF;
    SELECT g.organization_id, g.generation_id INTO job_org, job_generation
      FROM knowledge_index_generation g
     WHERE g.job_id=p_job_id AND g.job_status='RUNNING' AND g.lease_owner_id=p_worker_id
       AND g.lease_expires_at > clock_timestamp() AND g.status='PROCESSING';
    IF job_org IS NULL THEN
        RAISE EXCEPTION 'Index usage job is not owned by this worker' USING ERRCODE='42501';
    END IF;
    FOR event IN SELECT value FROM jsonb_array_elements(p_events) LOOP
        IF jsonb_typeof(event) IS DISTINCT FROM 'object' THEN
            RAISE EXCEPTION 'Invalid index usage event' USING ERRCODE='22023';
        END IF;
        IF (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(event) AS keys(key)) IS DISTINCT FROM
             ARRAY['eventId','inputTokens','latencyMs','model','operation','outputTokens','provider','usageComplete']::text[] THEN
            RAISE EXCEPTION 'Invalid index usage event' USING ERRCODE='22023';
        END IF;
        event_id := (event->>'eventId')::uuid;
        operation := event->>'operation'; provider_name := event->>'provider'; model_name := event->>'model';
        input_count := NULLIF(event->>'inputTokens','')::bigint;
        output_count := NULLIF(event->>'outputTokens','')::bigint;
        duration_ms := NULLIF(event->>'latencyMs','')::integer;
        complete_usage := (event->>'usageComplete')::boolean;
        IF event_id IS NULL OR operation IS DISTINCT FROM 'INDEX_EMBEDDING'
           OR provider_name IS NULL OR provider_name !~ '^[A-Z0-9_-]{1,80}$'
           OR model_name IS NULL OR length(model_name) NOT BETWEEN 1 AND 120
           OR (input_count IS NOT NULL AND input_count < 0) OR (output_count IS NOT NULL AND output_count < 0)
           OR (duration_ms IS NOT NULL AND duration_ms < 0)
           OR (complete_usage AND (input_count IS NULL OR output_count IS NULL)) THEN
            RAISE EXCEPTION 'Invalid index usage event values' USING ERRCODE='22023';
        END IF;
        INSERT INTO ai_usage_event(organization_id, request_id, idempotency_key, operation, provider, model,
            input_tokens, output_tokens, latency_ms, usage_complete, estimated_cost_micro_usd, price_book_version)
        SELECT job_org, p_job_id, job_generation::text || ':' || event_id::text, operation, provider_name, model_name,
          input_count, output_count, duration_ms, complete_usage,
          CASE WHEN complete_usage AND price.price_book_version IS NOT NULL THEN
            ceil((input_count::numeric * price.input_micro_usd_per_million_tokens
              + output_count::numeric * price.output_micro_usd_per_million_tokens) / 1000000)::bigint END,
          price.price_book_version
        FROM (SELECT 1) seed LEFT JOIN LATERAL (SELECT pb.price_book_version, pb.input_micro_usd_per_million_tokens,
            pb.output_micro_usd_per_million_tokens FROM ai_price_book pb
          WHERE pb.provider=provider_name AND pb.model=model_name AND pb.effective_from<=now()
            AND (pb.effective_until IS NULL OR pb.effective_until>now())
          ORDER BY pb.effective_from DESC LIMIT 1) price ON true
        ON CONFLICT (idempotency_key) DO NOTHING;
        inserted := inserted + CASE WHEN FOUND THEN 1 ELSE 0 END;
    END LOOP;
    RETURN inserted;
END;
$$;

CREATE OR REPLACE FUNCTION arden_system.console_report(
    p_actor uuid, p_kind text, p_organization uuid DEFAULT NULL,
    p_from timestamptz DEFAULT now() - interval '30 days',
    p_to timestamptz DEFAULT now(), p_search text DEFAULT '',
    p_status text DEFAULT '', p_page integer DEFAULT 1, p_page_size integer DEFAULT 25)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = arden, arden_system, pg_temp AS $$
DECLARE result jsonb; offset_rows integer; search_pattern text;
BEGIN
    IF p_actor IS NULL OR p_kind IS NULL OR p_page IS NULL OR p_page_size IS NULL
       OR p_actor IS DISTINCT FROM NULLIF(current_setting('arden.actor_id', true), '')::uuid
       OR current_setting('arden.system_auth_mode', true) IS DISTINCT FROM 'session'
       OR length(coalesce(p_search, '')) > 120
       OR coalesce(p_status, '') NOT IN ('', 'ACTIVE', 'SUSPENDED', 'ARCHIVED')
       OR p_from IS NULL OR p_to IS NULL OR p_from >= p_to OR p_to - p_from > interval '366 days'
       OR p_page NOT BETWEEN 1 AND 100000 OR p_page_size NOT BETWEEN 1 AND 50
       OR p_kind NOT IN ('OVERVIEW', 'ORGANIZATIONS', 'ORGANIZATION', 'KNOWLEDGE', 'AI_USAGE',
          'CONTRIBUTIONS', 'FEEDBACK', 'QUALITY', 'HEALTH', 'PRIVATE_FEEDBACK') THEN
        RAISE EXCEPTION 'Invalid System Console query' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM arden_system.administrator iso
                    WHERE iso.admin_id = p_actor AND iso.status = 'ACTIVE') THEN
        RAISE EXCEPTION 'System Console access is unavailable' USING ERRCODE = '42501';
    END IF;
    offset_rows := (p_page - 1) * p_page_size;
    -- Literal search: escape LIKE metacharacters before wrapping in wildcards.
    search_pattern := '%' || replace(replace(replace(coalesce(p_search, ''), '\', '\\'), '%', '\%'), '_', '\_') || '%';

    IF p_kind = 'OVERVIEW' THEN
        SELECT jsonb_build_object(
          'organizations', jsonb_build_object('total', count(*),
            'active', count(*) FILTER (WHERE status = 'ACTIVE'),
            'suspended', count(*) FILTER (WHERE status = 'SUSPENDED'),
            'archived', count(*) FILTER (WHERE status = 'ARCHIVED')),
          'knowledge', (SELECT jsonb_build_object('drafts', count(*) FILTER (WHERE sd.status = 'ACTIVE'),
              'archivedDrafts', count(*) FILTER (WHERE sd.status = 'ARCHIVED'))
              FROM shared_draft sd),
          'publications', (SELECT jsonb_build_object('current', count(*),
              'expired', count(*) FILTER (WHERE NULLIF(pv.management->>'expirationDate','')::date < (now() AT TIME ZONE 'UTC')::date))
              FROM knowledge_current_publication cp JOIN published_knowledge_version pv USING (published_version_id)),
          'contributions', (SELECT jsonb_build_object('pending', count(*) FILTER (WHERE s.status = 'PENDING_REVIEW'),
              'approved', count(*) FILTER (WHERE s.status = 'APPROVED'), 'rejected', count(*) FILTER (WHERE s.status = 'REJECTED'))
              FROM shared_submission s WHERE s.submitted_at >= p_from AND s.submitted_at < p_to),
          'ai', (SELECT jsonb_build_object('calls', count(*), 'inputTokens', sum(input_tokens),
              'outputTokens', sum(output_tokens), 'estimatedCostMicroUsd', CASE WHEN count(*) = 0 THEN NULL
                WHEN bool_and(usage_complete AND estimated_cost_micro_usd IS NOT NULL) THEN sum(estimated_cost_micro_usd) END,
              'usageComplete', coalesce(bool_and(usage_complete AND estimated_cost_micro_usd IS NOT NULL), false))
              FROM ai_usage_event u WHERE u.occurred_at >= p_from AND u.occurred_at < p_to),
          'feedback', (SELECT jsonb_build_object('positive', count(*) FILTER (WHERE rating = 'POSITIVE'),
              'negative', count(*) FILTER (WHERE rating = 'NEGATIVE'))
              FROM answer_ratings r WHERE r.rated_at >= p_from AND r.rated_at < p_to))
          INTO result FROM organization;
        RETURN result;
    ELSIF p_kind = 'ORGANIZATIONS' THEN
        SELECT jsonb_build_object('page', p_page, 'pageSize', p_page_size,
          'total', (SELECT count(*) FROM organization o WHERE (p_search = '' OR o.name ILIKE search_pattern ESCAPE '\')
            AND (p_status = '' OR o.status = p_status)),
          'items', coalesce((SELECT jsonb_agg(item ORDER BY item->>'name', item->>'id') FROM (
              SELECT jsonb_build_object('id', o.organization_id, 'name', o.name, 'status', o.status,
                'createdAt', o.created_at, 'drafts', (SELECT count(*) FROM shared_draft sd WHERE sd.organization_id = o.organization_id AND sd.status = 'ACTIVE'),
                'published', (SELECT count(*) FROM knowledge_current_publication cp WHERE cp.organization_id = o.organization_id),
                'openCases', (SELECT count(*) FROM maintenance_case mc WHERE mc.organization_id = o.organization_id AND mc.reporter_status <> 'Resolved')) AS item
                FROM organization o WHERE (p_search = '' OR o.name ILIKE search_pattern ESCAPE '\')
                  AND (p_status = '' OR o.status = p_status)
                ORDER BY o.name, o.organization_id OFFSET offset_rows LIMIT p_page_size
          ) page_rows), '[]'::jsonb)) INTO result;
        RETURN result;
    ELSIF p_kind = 'ORGANIZATION' THEN
        -- An unknown organization returns NULL so the API answers 404, not an empty report.
        SELECT jsonb_build_object('id', o.organization_id, 'name', o.name, 'status', o.status,
          'createdAt', o.created_at,
          'drafts', (SELECT count(*) FROM shared_draft sd WHERE sd.organization_id = o.organization_id AND sd.status = 'ACTIVE'),
          'published', (SELECT count(*) FROM knowledge_current_publication cp WHERE cp.organization_id = o.organization_id),
          'contributions', (SELECT jsonb_build_object('pending', count(*) FILTER (WHERE s.status = 'PENDING_REVIEW'),
            'approved', count(*) FILTER (WHERE s.status = 'APPROVED'), 'rejected', count(*) FILTER (WHERE s.status = 'REJECTED'))
            FROM shared_submission s JOIN organization_membership om ON om.membership_id = s.submitted_by_membership_id
            WHERE om.organization_id = o.organization_id AND s.submitted_at >= p_from AND s.submitted_at < p_to),
          'openCases', (SELECT count(*) FROM maintenance_case mc WHERE mc.organization_id = o.organization_id AND mc.reporter_status <> 'Resolved'),
          'storageBytes', (SELECT CASE WHEN count(*) FILTER (WHERE bytes IS NULL) > 0 THEN NULL ELSE coalesce(sum(bytes),0) END
            FROM (SELECT content_uri, max(content_size_bytes) AS bytes FROM (
              SELECT dv.source_uri AS content_uri, dv.content_size_bytes FROM draft_version dv
                JOIN draft_document dd USING (draft_id) JOIN private_workspace pw USING (workspace_id)
                JOIN organization_membership om USING (membership_id) WHERE om.organization_id = o.organization_id
              UNION ALL
              SELECT sv.content_uri, sv.content_size_bytes FROM shared_draft_version sv
                JOIN shared_draft sd USING (shared_draft_id) WHERE sd.organization_id = o.organization_id
            ) referenced GROUP BY content_uri) distinct_objects))
          INTO result FROM organization o WHERE o.organization_id = p_organization;
        RETURN result;
    ELSIF p_kind = 'KNOWLEDGE' THEN
        SELECT jsonb_build_object('drafts', (SELECT jsonb_build_object('active',count(*) FILTER (WHERE status='ACTIVE'), 'archived',count(*) FILTER (WHERE status='ARCHIVED')) FROM shared_draft WHERE p_organization IS NULL OR organization_id=p_organization),
          'submissions', (SELECT jsonb_build_object('pendingReview',count(*) FILTER (WHERE s.status='PENDING_REVIEW'),'approved',count(*) FILTER (WHERE s.status='APPROVED'),'rejected',count(*) FILTER (WHERE s.status='REJECTED'))
            FROM shared_submission s JOIN organization_membership om ON om.membership_id=s.submitted_by_membership_id WHERE s.submitted_at>=p_from AND s.submitted_at<p_to AND (p_organization IS NULL OR om.organization_id=p_organization)),
          'publications', (SELECT jsonb_build_object('current',count(*),'expired',count(*) FILTER (WHERE NULLIF(pv.management->>'expirationDate','')::date < (now() AT TIME ZONE 'UTC')::date)) FROM knowledge_current_publication cp JOIN published_knowledge_version pv USING(published_version_id) WHERE p_organization IS NULL OR cp.organization_id=p_organization))
          INTO result;
        RETURN result;
    ELSIF p_kind = 'AI_USAGE' THEN
        SELECT jsonb_build_object('calls',count(*),'inputTokens',sum(input_tokens),'outputTokens',sum(output_tokens),
          'avgLatencyMs',round(avg(latency_ms)),'estimatedCostMicroUsd',CASE WHEN count(*) > 0
            AND bool_and(usage_complete AND estimated_cost_micro_usd IS NOT NULL) THEN sum(estimated_cost_micro_usd) END,
          'usageComplete',coalesce(bool_and(usage_complete AND estimated_cost_micro_usd IS NOT NULL),false),
          'citationRate', (SELECT round(CASE WHEN count(*)=0 THEN NULL
            ELSE count(*) FILTER (WHERE citation_count>0)::numeric * 100 / count(*) END, 2)
            FROM ai_answer_result ar WHERE ar.created_at>=p_from AND ar.created_at<p_to
              AND (p_organization IS NULL OR ar.organization_id=p_organization)),
          'byOperation',coalesce((SELECT jsonb_agg(jsonb_build_object('operation',operation,'provider',provider,'model',model,'calls',calls,
            'inputTokens',input_tokens,'outputTokens',output_tokens,
            'estimatedCostMicroUsd',CASE WHEN complete THEN cost END,'usageComplete',complete) ORDER BY operation,provider,model)
            FROM (SELECT operation,provider,model,count(*) calls,sum(input_tokens) input_tokens,
              sum(output_tokens) output_tokens,sum(estimated_cost_micro_usd) cost,
              bool_and(usage_complete AND estimated_cost_micro_usd IS NOT NULL) complete
              FROM ai_usage_event grouped_usage WHERE occurred_at>=p_from AND occurred_at<p_to
                AND (p_organization IS NULL OR organization_id=p_organization)
              GROUP BY operation,provider,model) grouped), '[]'::jsonb))
          INTO result FROM ai_usage_event u WHERE u.occurred_at>=p_from AND u.occurred_at<p_to
            AND (p_organization IS NULL OR u.organization_id=p_organization);
        RETURN result;
    ELSIF p_kind = 'CONTRIBUTIONS' THEN
        WITH grouped AS (
          SELECT om.organization_id AS org_id, dm.department_id,
            count(*) AS submitted, count(*) FILTER (WHERE s.status='APPROVED') AS approved,
            count(*) FILTER (WHERE s.status='REJECTED') AS rejected,
            count(*) FILTER (WHERE s.status='PENDING_REVIEW') AS pending
            FROM shared_submission s JOIN organization_membership om ON om.membership_id=s.submitted_by_membership_id
            LEFT JOIN department_membership dm ON dm.membership_id=om.membership_id AND dm.is_primary AND dm.status='ACTIVE'
           WHERE s.submitted_at>=p_from AND s.submitted_at<p_to AND (p_organization IS NULL OR om.organization_id=p_organization)
           GROUP BY om.organization_id, dm.department_id),
        page_rows AS (
          SELECT * FROM grouped ORDER BY org_id, department_id NULLS LAST OFFSET offset_rows LIMIT p_page_size)
        SELECT jsonb_build_object('page', p_page, 'pageSize', p_page_size,
          'total', (SELECT count(*) FROM grouped),
          'items', coalesce((SELECT jsonb_agg(jsonb_build_object('organizationId',org_id,'departmentId',department_id,
            'submitted',submitted,'approved',approved,'rejected',rejected,'pending',pending)
            ORDER BY org_id, department_id NULLS LAST) FROM page_rows), '[]'::jsonb)) INTO result;
        RETURN result;
    ELSIF p_kind = 'FEEDBACK' THEN
        SELECT jsonb_build_object(
          'positive',(SELECT count(*) FROM answer_ratings r WHERE r.rating='POSITIVE' AND r.rated_at>=p_from AND r.rated_at<p_to AND (p_organization IS NULL OR r.organization_id=p_organization)),
          'negative',(SELECT count(*) FROM answer_ratings r WHERE r.rating='NEGATIVE' AND r.rated_at>=p_from AND r.rated_at<p_to AND (p_organization IS NULL OR r.organization_id=p_organization)),
          'openCases',(SELECT count(*) FROM maintenance_case mc WHERE mc.reporter_status <> 'Resolved' AND (p_organization IS NULL OR mc.organization_id=p_organization)),
          'caseAgeOver30Days',(SELECT count(*) FROM maintenance_case mc WHERE mc.reporter_status <> 'Resolved' AND mc.created_at < now()-interval '30 days' AND (p_organization IS NULL OR mc.organization_id=p_organization)))
          INTO result;
        RETURN result;
    ELSIF p_kind = 'QUALITY' THEN
        WITH signals AS (
          SELECT substr(md5(cp.organization_id::text || cp.shared_draft_id::text),1,16) AS document_ref,
            'OPEN_CASES' AS signal, count(*) AS signal_count, 'OPEN' AS signal_status
            FROM maintenance_case mc JOIN knowledge_current_publication cp ON cp.shared_draft_id=mc.document_id AND cp.organization_id=mc.organization_id
           WHERE mc.reporter_status <> 'Resolved' AND (p_organization IS NULL OR mc.organization_id=p_organization)
           GROUP BY cp.organization_id,cp.shared_draft_id HAVING count(*)>=2
          UNION ALL
          SELECT substr(md5(cp.organization_id::text || cp.shared_draft_id::text),1,16), 'STALE_PUBLICATION', 1, 'REVIEW'
            FROM knowledge_current_publication cp WHERE cp.updated_at < now()-interval '180 days' AND (p_organization IS NULL OR cp.organization_id=p_organization)
          UNION ALL
          SELECT substr(md5(cp.organization_id::text || cp.shared_draft_id::text),1,16), 'EXPIRED', 1, 'EXPIRED'
            FROM knowledge_current_publication cp JOIN published_knowledge_version pv USING(published_version_id)
           WHERE NULLIF(pv.management->>'expirationDate','')::date < (now() AT TIME ZONE 'UTC')::date AND (p_organization IS NULL OR cp.organization_id=p_organization)
          UNION ALL
          SELECT substr(md5(cp.organization_id::text || cp.shared_draft_id::text),1,16), 'EXACT_DUPLICATE', dupe.copies, 'REVIEW'
            FROM knowledge_current_publication cp JOIN published_knowledge_version pv USING(published_version_id)
            JOIN (SELECT cp2.organization_id,pv2.content_hash,count(*) copies FROM knowledge_current_publication cp2 JOIN published_knowledge_version pv2 USING(published_version_id)
              GROUP BY cp2.organization_id,pv2.content_hash HAVING count(*)>1) dupe ON dupe.organization_id=cp.organization_id AND dupe.content_hash=pv.content_hash
           WHERE p_organization IS NULL OR cp.organization_id=p_organization),
        page_rows AS (
          SELECT * FROM signals ORDER BY signal, document_ref OFFSET offset_rows LIMIT p_page_size)
        SELECT jsonb_build_object('page', p_page, 'pageSize', p_page_size,
          'total', (SELECT count(*) FROM signals),
          'items', coalesce((SELECT jsonb_agg(jsonb_build_object('documentRef',document_ref,'signal',signal,
            'count',signal_count,'status',signal_status) ORDER BY signal, document_ref) FROM page_rows), '[]'::jsonb))
          INTO result;
        RETURN result;
    ELSIF p_kind = 'PRIVATE_FEEDBACK' THEN
        -- Private Notes answer ratings: weekly totals for the last twelve UTC weeks only.
        WITH cutoff AS (SELECT date_trunc('week', now() AT TIME ZONE 'UTC') AS current_week),
        weeks AS (SELECT current_week + offset_week * interval '1 week' AS week_start
          FROM cutoff CROSS JOIN generate_series(-11, 0) AS offset_week),
        totals AS (
          SELECT to_char(week_start, 'YYYY-MM-DD') AS week_label,
            count(*) FILTER (WHERE feedback = 'GOOD') AS good,
            count(*) FILTER (WHERE feedback = 'BAD') AS bad, week_start
          FROM weeks LEFT JOIN private_ai_feedback
            ON rated_at >= week_start AT TIME ZONE 'UTC'
           AND rated_at < (week_start + interval '1 week') AT TIME ZONE 'UTC'
          GROUP BY week_start)
        SELECT jsonb_build_object('weeks', coalesce(jsonb_agg(jsonb_build_object(
          'weekStart', week_label, 'good', good, 'bad', bad) ORDER BY week_start DESC), '[]'::jsonb))
          INTO result FROM totals;
        RETURN result;
    ELSE
        SELECT jsonb_build_object('database',jsonb_build_object('status','ok'),
          'indexing',jsonb_build_object(
            'status',CASE WHEN count(*) FILTER (WHERE j.job_status='FAILED') > 0
                OR min(j.job_created_at) FILTER (WHERE j.job_status='PENDING') < now()-interval '5 minutes'
              THEN 'degraded' ELSE 'ok' END,
            'pending',count(*) FILTER (WHERE j.job_status='PENDING'),
            'running',count(*) FILTER (WHERE j.job_status='RUNNING'),
            'failed',count(*) FILTER (WHERE j.job_status='FAILED'),
            'oldestPendingSeconds',CASE WHEN min(j.job_created_at) FILTER (WHERE j.job_status='PENDING') IS NULL THEN NULL
              ELSE floor(extract(epoch FROM now()-min(j.job_created_at) FILTER (WHERE j.job_status='PENDING'))) END),
          'notifications', (SELECT jsonb_build_object(
            'status',CASE WHEN count(*) FILTER (WHERE status='FAILED') > 0
                OR min(created_at) FILTER (WHERE status IN ('PENDING','LEASED')) < now()-interval '5 minutes'
              THEN 'degraded' ELSE 'ok' END,
            'pending',count(*) FILTER (WHERE status IN ('PENDING','LEASED')),
            'failed',count(*) FILTER (WHERE status='FAILED'),
            'oldestPendingSeconds',CASE WHEN min(created_at) FILTER (WHERE status IN ('PENDING','LEASED')) IS NULL THEN NULL
              ELSE floor(extract(epoch FROM now()-min(created_at) FILTER (WHERE status IN ('PENDING','LEASED')))) END)
            FROM arden_notification_outbox))
          INTO result FROM knowledge_index_generation j WHERE j.job_id IS NOT NULL;
        RETURN result;
    END IF;
END;
$$;

DROP TABLE knowledge_index_job;
