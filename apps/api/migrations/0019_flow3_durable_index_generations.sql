SET search_path TO arden, public;

-- Core-owned durable state for the Arden -> Arden-AI handoff. Chroma remains
-- a derived index; only a READY generation may become the current publication.
CREATE TABLE knowledge_index_generation (
    generation_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id       uuid NOT NULL REFERENCES organization(organization_id),
    submission_id         uuid NOT NULL UNIQUE REFERENCES shared_submission(submission_id),
    shared_draft_id       uuid NOT NULL REFERENCES shared_draft(shared_draft_id),
    snapshot_version_id   uuid NOT NULL REFERENCES shared_draft_version(shared_draft_version_id),
    snapshot_content_hash text NOT NULL,
    status                text NOT NULL DEFAULT 'PENDING',
    manifest_json         jsonb,
    failure_code          text,
    created_at            timestamptz NOT NULL DEFAULT now(),
    started_at            timestamptz,
    completed_at          timestamptz,
    updated_at            timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT uq_knowledge_index_generation_snapshot UNIQUE (snapshot_version_id),
    CONSTRAINT ck_knowledge_index_generation_hash
        CHECK (snapshot_content_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT ck_knowledge_index_generation_status
        CHECK (status IN ('PENDING', 'PROCESSING', 'READY', 'FAILED')),
    CONSTRAINT ck_knowledge_index_generation_outcome CHECK (
        (status = 'READY' AND manifest_json IS NOT NULL AND failure_code IS NULL AND completed_at IS NOT NULL)
        OR (status = 'FAILED' AND manifest_json IS NULL AND failure_code IS NOT NULL AND completed_at IS NOT NULL)
        OR (status IN ('PENDING', 'PROCESSING') AND manifest_json IS NULL AND failure_code IS NULL AND completed_at IS NULL)
    )
);

CREATE TABLE knowledge_index_job (
    job_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    generation_id   uuid NOT NULL UNIQUE REFERENCES knowledge_index_generation(generation_id),
    status          text NOT NULL DEFAULT 'PENDING',
    attempt_count   integer NOT NULL DEFAULT 0,
    max_attempts    integer NOT NULL DEFAULT 3,
    available_at    timestamptz NOT NULL DEFAULT now(),
    lease_owner     uuid,
    lease_expires_at timestamptz,
    last_error_code text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    completed_at    timestamptz,
    updated_at      timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT ck_knowledge_index_job_status
        CHECK (status IN ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED')),
    CONSTRAINT ck_knowledge_index_job_attempts
        CHECK (attempt_count >= 0 AND max_attempts BETWEEN 1 AND 10 AND attempt_count <= max_attempts),
    CONSTRAINT ck_knowledge_index_job_lease CHECK (
        (status = 'RUNNING' AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)
        OR (status <> 'RUNNING' AND lease_owner IS NULL AND lease_expires_at IS NULL)
    ),
    CONSTRAINT ck_knowledge_index_job_completion CHECK (
        (status IN ('SUCCEEDED', 'FAILED') AND completed_at IS NOT NULL)
        OR (status IN ('PENDING', 'RUNNING') AND completed_at IS NULL)
    )
);

CREATE INDEX ix_knowledge_index_job_claim
    ON knowledge_index_job (available_at, created_at)
    WHERE status IN ('PENDING', 'RUNNING');
CREATE INDEX ix_knowledge_index_generation_org_status
    ON knowledge_index_generation (organization_id, status, created_at);

CREATE TRIGGER trg_knowledge_index_generation_updated_at
BEFORE UPDATE ON knowledge_index_generation
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_knowledge_index_job_updated_at
BEFORE UPDATE ON knowledge_index_job
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'arden_indexer') THEN
        CREATE ROLE arden_indexer NOLOGIN NOSUPERUSER NOBYPASSRLS;
    END IF;
END;
$$;
ALTER ROLE arden_indexer NOLOGIN NOSUPERUSER NOBYPASSRLS;
GRANT USAGE ON SCHEMA arden TO arden_indexer;

-- Approval and outbox creation are one transaction. Replacing this function
-- preserves the existing trigger and adds only the durable preparation intent.
CREATE OR REPLACE FUNCTION apply_review_decision()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE new_generation_id uuid;
BEGIN
    UPDATE shared_submission
       SET status = NEW.decision,
           publication_state = CASE WHEN NEW.decision = 'APPROVED' THEN 'PREPARING' ELSE 'NONE' END
     WHERE submission_id = NEW.submission_id;

    IF NEW.flow2 AND NEW.decision = 'APPROVED' THEN
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
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = arden, pg_temp
AS $$
BEGIN
    IF p_worker_id IS NULL OR p_lease_seconds NOT BETWEEN 15 AND 600 THEN
        RAISE EXCEPTION 'Invalid indexing worker lease request' USING ERRCODE = '22023';
    END IF;

    -- A worker may disappear after claiming its final allowed attempt. Close
    -- such an expired lease before selecting another job so it cannot remain
    -- RUNNING forever.
    WITH exhausted AS (
        UPDATE knowledge_index_job j
           SET status = 'FAILED', lease_owner = NULL, lease_expires_at = NULL,
               last_error_code = 'INDEXING_LEASE_EXHAUSTED', completed_at = now()
         WHERE j.status = 'RUNNING' AND j.lease_expires_at <= now()
           AND j.attempt_count >= j.max_attempts
        RETURNING j.generation_id
    ), failed_generations AS (
        UPDATE knowledge_index_generation g
           SET status = 'FAILED', failure_code = 'INDEXING_LEASE_EXHAUSTED', completed_at = now()
          FROM exhausted e
         WHERE g.generation_id = e.generation_id
        RETURNING g.submission_id
    )
    UPDATE shared_submission s SET publication_state = 'FAILED'
      FROM failed_generations f
     WHERE s.submission_id = f.submission_id
       AND s.status = 'APPROVED' AND s.publication_state = 'PREPARING';

    RETURN QUERY
    WITH candidate AS (
        SELECT j.job_id
          FROM knowledge_index_job j
          JOIN knowledge_index_generation g ON g.generation_id = j.generation_id
          JOIN shared_submission s ON s.submission_id = g.submission_id
         WHERE ((j.status = 'PENDING' AND j.available_at <= now())
            OR (j.status = 'RUNNING' AND j.lease_expires_at <= now()))
           AND j.attempt_count < j.max_attempts
           AND g.status IN ('PENDING', 'PROCESSING')
           AND s.status = 'APPROVED' AND s.publication_state = 'PREPARING'
         ORDER BY j.available_at, j.created_at, j.job_id
         FOR UPDATE SKIP LOCKED
         LIMIT 1
    ), claimed AS (
        UPDATE knowledge_index_job j
           SET status = 'RUNNING',
               attempt_count = j.attempt_count + 1,
               lease_owner = p_worker_id,
               lease_expires_at = now() + make_interval(secs => p_lease_seconds),
               last_error_code = NULL
          FROM candidate c
         WHERE j.job_id = c.job_id AND j.attempt_count < j.max_attempts
        RETURNING j.*
    ), started AS (
        UPDATE knowledge_index_generation g
           SET status = 'PROCESSING', started_at = COALESCE(g.started_at, now())
          FROM claimed c
         WHERE g.generation_id = c.generation_id
        RETURNING g.*
    )
    SELECT c.job_id, g.generation_id, g.organization_id, g.submission_id,
           g.snapshot_version_id, g.snapshot_content_hash,
           s.content_uri, s.mime_type, c.attempt_count, c.max_attempts
      FROM claimed c
      JOIN started g ON g.generation_id = c.generation_id
      JOIN shared_submission s ON s.submission_id = g.submission_id
     WHERE s.status = 'APPROVED' AND s.publication_state = 'PREPARING'
       AND s.shared_draft_version_id = g.snapshot_version_id
       AND s.content_hash = g.snapshot_content_hash;
END;
$$;

CREATE OR REPLACE FUNCTION complete_knowledge_index_job(
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
    job_row knowledge_index_job%ROWTYPE;
    generation_row knowledge_index_generation%ROWTYPE;
    submission_row shared_submission%ROWTYPE;
    knowledge_base_id_value uuid;
    published_version_id_value uuid;
    decision_id uuid;
BEGIN
    IF p_manifest IS NULL OR jsonb_typeof(p_manifest) <> 'object' THEN
        RAISE EXCEPTION 'Index manifest must be an object' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO STRICT job_row FROM knowledge_index_job
     WHERE knowledge_index_job.job_id = p_job_id FOR UPDATE;
    IF job_row.status <> 'RUNNING' OR job_row.lease_owner IS DISTINCT FROM p_worker_id
       OR job_row.lease_expires_at <= now() THEN
        RAISE EXCEPTION 'Index job lease is no longer valid' USING ERRCODE = '40001';
    END IF;

    SELECT * INTO STRICT generation_row FROM knowledge_index_generation
     WHERE knowledge_index_generation.generation_id = job_row.generation_id FOR UPDATE;
    SELECT * INTO STRICT submission_row FROM shared_submission
     WHERE shared_submission.submission_id = generation_row.submission_id FOR UPDATE;

    IF generation_row.status <> 'PROCESSING'
       OR submission_row.status <> 'APPROVED'
       OR submission_row.publication_state <> 'PREPARING'
       OR submission_row.shared_draft_version_id IS DISTINCT FROM generation_row.snapshot_version_id
       OR submission_row.content_hash IS DISTINCT FROM generation_row.snapshot_content_hash
       OR NOT audience_snapshot_enforceable(submission_row.organization_id,
            submission_row.audience_role_ids, submission_row.target_scope_type,
            submission_row.target_department_id) THEN
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
       SET status = 'READY', manifest_json = p_manifest, completed_at = now()
     WHERE generation_id = generation_row.generation_id;
    UPDATE knowledge_index_job
       SET status = 'SUCCEEDED', lease_owner = NULL, lease_expires_at = NULL,
           completed_at = now()
     WHERE knowledge_index_job.job_id = p_job_id;
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
        UPDATE shared_submission s SET publication_state = 'FAILED'
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

REVOKE ALL ON FUNCTION claim_knowledge_index_job(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION complete_knowledge_index_job(uuid, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION fail_knowledge_index_job(uuid, uuid, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_knowledge_index_job(uuid, integer) TO arden_indexer;
GRANT EXECUTE ON FUNCTION complete_knowledge_index_job(uuid, uuid, jsonb) TO arden_indexer;
GRANT EXECUTE ON FUNCTION fail_knowledge_index_job(uuid, uuid, text, boolean) TO arden_indexer;

ALTER TABLE knowledge_index_generation ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_index_job ENABLE ROW LEVEL SECURITY;

-- Runtime actors do not read worker internals. The trigger function runs in
-- the approval transaction and inserts under this exact approved snapshot.
GRANT INSERT ON knowledge_index_generation, knowledge_index_job TO arden_runtime;
CREATE POLICY flow3_generation_approval_insert ON knowledge_index_generation
FOR INSERT TO arden_runtime WITH CHECK (
    EXISTS (SELECT 1 FROM shared_submission s
        WHERE s.submission_id = knowledge_index_generation.submission_id
          AND s.organization_id = knowledge_index_generation.organization_id
          AND s.shared_draft_id = knowledge_index_generation.shared_draft_id
          AND s.shared_draft_version_id = knowledge_index_generation.snapshot_version_id
          AND s.content_hash = knowledge_index_generation.snapshot_content_hash
          AND s.status = 'APPROVED' AND s.publication_state = 'PREPARING')
);
CREATE POLICY flow3_index_job_approval_insert ON knowledge_index_job
FOR INSERT TO arden_runtime WITH CHECK (
    status = 'PENDING' AND attempt_count = 0 AND max_attempts = 3
    AND available_at <= now() AND lease_owner IS NULL
    AND lease_expires_at IS NULL AND last_error_code IS NULL
    AND completed_at IS NULL
);
