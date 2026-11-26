SET search_path TO arden, public;

-- Installation Console foundation. Existing administrators are downgraded to
-- monitoring only; an operator bootstraps one explicitly selected manager.
ALTER TABLE system_administrator
    ADD COLUMN can_manage_system_admins boolean NOT NULL DEFAULT false;
ALTER TABLE system_administrator
    ALTER COLUMN can_manage_system_admins SET DEFAULT false;

-- Existing content versions without a measured byte count remain unknown. New
-- writes record object size so reports never present missing history as zero.
ALTER TABLE draft_version ADD COLUMN content_size_bytes bigint
    CHECK (content_size_bytes IS NULL OR content_size_bytes >= 0);
ALTER TABLE shared_draft_version ADD COLUMN content_size_bytes bigint
    CHECK (content_size_bytes IS NULL OR content_size_bytes >= 0);

CREATE TABLE ai_price_book (
    price_book_version text NOT NULL,
    provider text NOT NULL,
    model text NOT NULL,
    input_micro_usd_per_million_tokens bigint NOT NULL CHECK (input_micro_usd_per_million_tokens >= 0),
    output_micro_usd_per_million_tokens bigint NOT NULL CHECK (output_micro_usd_per_million_tokens >= 0),
    effective_from timestamptz NOT NULL,
    effective_until timestamptz,
    PRIMARY KEY (price_book_version, provider, model),
    CHECK (effective_until IS NULL OR effective_until > effective_from)
);
ALTER TABLE ai_price_book ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_price_book FORCE ROW LEVEL SECURITY;
GRANT SELECT ON ai_price_book TO arden_runtime, arden_indexer;
CREATE POLICY ai_price_book_runtime_read ON ai_price_book FOR SELECT TO arden_runtime, arden_indexer
USING (true);

CREATE TABLE ai_usage_event (
    usage_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organization(organization_id),
    request_id uuid NOT NULL,
    idempotency_key text NOT NULL UNIQUE CHECK (length(btrim(idempotency_key)) BETWEEN 1 AND 160),
    operation text NOT NULL CHECK (operation IN (
        'CHAT_RETRIEVAL', 'CHAT_GENERATION', 'READER_QUESTION_RETRIEVAL',
        'READER_QUESTION_GENERATION', 'READER_SUMMARY', 'INDEX_EMBEDDING',
        'MAINTENANCE_ANALYSIS')),
    provider text NOT NULL CHECK (length(btrim(provider)) BETWEEN 1 AND 80),
    model text NOT NULL CHECK (length(btrim(model)) BETWEEN 1 AND 120),
    input_tokens bigint CHECK (input_tokens IS NULL OR input_tokens >= 0),
    output_tokens bigint CHECK (output_tokens IS NULL OR output_tokens >= 0),
    latency_ms integer CHECK (latency_ms IS NULL OR latency_ms >= 0),
    estimated_cost_micro_usd bigint CHECK (estimated_cost_micro_usd IS NULL OR estimated_cost_micro_usd >= 0),
    price_book_version text,
    usage_complete boolean NOT NULL DEFAULT false,
    occurred_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_ai_usage_cost_provenance CHECK (
        estimated_cost_micro_usd IS NULL OR (price_book_version IS NOT NULL AND length(btrim(price_book_version)) > 0)),
    CONSTRAINT ck_ai_usage_complete_counts CHECK (
        NOT usage_complete OR (input_tokens IS NOT NULL AND output_tokens IS NOT NULL))
);
CREATE INDEX ix_ai_usage_org_time ON ai_usage_event(organization_id, occurred_at DESC);

CREATE TABLE ai_answer_result (
    request_id uuid PRIMARY KEY,
    organization_id uuid NOT NULL REFERENCES organization(organization_id),
    owner_membership_id uuid NOT NULL,
    result_type text NOT NULL CHECK (result_type IN ('CHAT', 'READER_QUESTION')),
    answer_status text NOT NULL CHECK (answer_status IN ('ANSWERED', 'INSUFFICIENT_EVIDENCE')),
    citation_count integer NOT NULL CHECK (citation_count >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT fk_ai_answer_result_owner FOREIGN KEY (owner_membership_id, organization_id)
        REFERENCES organization_membership(membership_id, organization_id),
    CONSTRAINT uq_ai_answer_result_owner UNIQUE (request_id, owner_membership_id)
);
CREATE INDEX ix_ai_answer_result_org_time ON ai_answer_result(organization_id, created_at DESC);

CREATE TABLE ai_answer_feedback (
    feedback_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    membership_id uuid NOT NULL,
    rating text NOT NULL CHECK (rating IN ('POSITIVE', 'NEGATIVE')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT fk_ai_answer_feedback_result FOREIGN KEY (request_id)
        REFERENCES ai_answer_result(request_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_ai_answer_feedback_org FOREIGN KEY (organization_id)
        REFERENCES organization(organization_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_ai_answer_feedback_member FOREIGN KEY (membership_id, organization_id)
        REFERENCES organization_membership(membership_id, organization_id),
    CONSTRAINT uq_ai_answer_feedback_actor UNIQUE (request_id, membership_id)
);
CREATE INDEX ix_ai_answer_feedback_org_time ON ai_answer_feedback(organization_id, updated_at DESC);

ALTER TABLE ai_usage_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_usage_event FORCE ROW LEVEL SECURITY;
ALTER TABLE ai_answer_result ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_answer_result FORCE ROW LEVEL SECURITY;
ALTER TABLE ai_answer_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_answer_feedback FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT ON ai_usage_event TO arden_runtime;
GRANT SELECT, INSERT ON ai_answer_result TO arden_runtime;
GRANT SELECT, INSERT, UPDATE ON ai_answer_feedback TO arden_runtime;

CREATE POLICY ai_usage_event_writer ON ai_usage_event FOR INSERT TO arden_runtime
WITH CHECK (organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM organization_membership om
      JOIN user_account ua ON ua.user_id=om.user_id AND ua.status='ACTIVE'
      JOIN organization o ON o.organization_id=om.organization_id AND o.status='ACTIVE'
      WHERE om.user_id=NULLIF(current_setting('arden.actor_id', true), '')::uuid
        AND om.organization_id=ai_usage_event.organization_id AND om.status='ACTIVE'));
CREATE POLICY ai_usage_event_system_console_read ON ai_usage_event FOR SELECT TO arden_runtime
USING (current_setting('arden.instance_admin', true) = 'true');

-- The indexer can insert only metadata for the job it currently owns. A small
-- SECURITY DEFINER gate resolves that job and pricebook without granting table reads.
CREATE FUNCTION record_index_ai_usage(p_job_id uuid, p_worker_id uuid, p_events jsonb)
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
    SELECT g.organization_id, j.generation_id INTO job_org, job_generation
      FROM knowledge_index_job j JOIN knowledge_index_generation g USING (generation_id)
     WHERE j.job_id=p_job_id AND j.status='RUNNING' AND j.lease_owner=p_worker_id
       AND j.lease_expires_at > now() AND g.status='PROCESSING';
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
REVOKE ALL ON FUNCTION record_index_ai_usage(uuid,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_index_ai_usage(uuid,uuid,jsonb) TO arden_indexer;

CREATE POLICY ai_answer_result_owner ON ai_answer_result FOR SELECT TO arden_runtime
USING (organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM organization_membership om
         WHERE om.membership_id = owner_membership_id AND om.organization_id = ai_answer_result.organization_id
           AND om.user_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid AND om.status = 'ACTIVE'));
CREATE POLICY ai_answer_result_writer ON ai_answer_result FOR INSERT TO arden_runtime
WITH CHECK (organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM organization_membership om
         WHERE om.membership_id = owner_membership_id AND om.organization_id = ai_answer_result.organization_id
           AND om.user_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid AND om.status = 'ACTIVE'));
CREATE POLICY ai_answer_feedback_owner ON ai_answer_feedback FOR ALL TO arden_runtime
USING (organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
    AND membership_id IN (SELECT om.membership_id FROM organization_membership om
         WHERE om.organization_id = ai_answer_feedback.organization_id
           AND om.user_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid AND om.status = 'ACTIVE'))
WITH CHECK (organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
    AND membership_id IN (SELECT om.membership_id FROM organization_membership om
         WHERE om.organization_id = ai_answer_feedback.organization_id
           AND om.user_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid AND om.status = 'ACTIVE')
    AND EXISTS (SELECT 1 FROM ai_answer_result ar WHERE ar.request_id = ai_answer_feedback.request_id
         AND ar.organization_id = ai_answer_feedback.organization_id AND ar.owner_membership_id = ai_answer_feedback.membership_id));

-- The policy exposes only the one target account/membership selected by a
-- manager transaction. It replaces the former instance-wide account read.
DROP POLICY user_account_instance_admin_read ON user_account;
DROP POLICY system_administrator_instance_access ON system_administrator;
CREATE POLICY system_administrator_manager_access ON system_administrator FOR ALL TO arden_runtime
USING (current_setting('arden.instance_admin', true) = 'true'
    AND current_setting('arden.manage_system_admins', true) = 'true')
WITH CHECK (current_setting('arden.instance_admin', true) = 'true'
    AND current_setting('arden.manage_system_admins', true) = 'true');
CREATE POLICY system_administrator_self_read ON system_administrator FOR SELECT TO arden_runtime
USING (current_setting('arden.instance_admin', true) = 'true'
    AND user_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid);
DROP POLICY system_administration_event_instance_access ON system_administration_event;
DROP POLICY system_administration_event_instance_insert ON system_administration_event;
CREATE POLICY system_administration_event_manager_read ON system_administration_event FOR SELECT TO arden_runtime
USING (current_setting('arden.instance_admin', true) = 'true'
    AND current_setting('arden.manage_system_admins', true) = 'true');
CREATE POLICY system_administration_event_manager_insert ON system_administration_event FOR INSERT TO arden_runtime
WITH CHECK (current_setting('arden.instance_admin', true) = 'true'
    AND current_setting('arden.manage_system_admins', true) = 'true'
    AND actor_user_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid);
CREATE POLICY user_account_instance_admin_target_read ON user_account FOR SELECT TO arden_runtime
USING (current_setting('arden.instance_admin', true) = 'true'
    AND user_id = NULLIF(current_setting('arden.system_admin_target_id', true), '')::uuid);
CREATE POLICY organization_membership_instance_admin_target_read ON organization_membership FOR SELECT TO arden_runtime
USING (current_setting('arden.instance_admin', true) = 'true'
    AND user_id = NULLIF(current_setting('arden.system_admin_target_id', true), '')::uuid);

CREATE OR REPLACE FUNCTION protect_last_system_administrator()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = arden, pg_temp AS $$
DECLARE target_id uuid; removing_admin boolean; removing_manager boolean;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended('arden:system-administrator-lifecycle', 0));
    IF TG_TABLE_NAME = 'user_account' THEN
        target_id := OLD.user_id;
        IF NEW.status = 'ACTIVE' AND EXISTS (
            SELECT 1 FROM system_administrator sa
            WHERE sa.user_id=NEW.user_id AND sa.status='ACTIVE'
              AND EXISTS (SELECT 1 FROM organization_membership om WHERE om.user_id=NEW.user_id)
        ) THEN
            RAISE EXCEPTION 'An active Arden System Admin cannot have organization memberships'
                USING ERRCODE='23514';
        END IF;
        removing_admin := OLD.status = 'ACTIVE' AND NEW.status <> 'ACTIVE';
        removing_manager := removing_admin;
    ELSE
        IF TG_OP = 'INSERT' THEN
            target_id := NEW.user_id;
            IF NEW.status = 'ACTIVE' AND EXISTS (
                SELECT 1 FROM organization_membership om WHERE om.user_id=NEW.user_id
            ) THEN
                RAISE EXCEPTION 'An active Arden System Admin cannot have organization memberships'
                    USING ERRCODE='23514';
            END IF;
            removing_admin := false;
            removing_manager := false;
        ELSIF TG_OP = 'DELETE' THEN
            target_id := OLD.user_id;
            removing_admin := OLD.status = 'ACTIVE';
            removing_manager := OLD.status = 'ACTIVE' AND OLD.can_manage_system_admins;
        ELSE
            target_id := OLD.user_id;
            IF NEW.status = 'ACTIVE' AND EXISTS (
                SELECT 1 FROM organization_membership om WHERE om.user_id=NEW.user_id
            ) THEN
                RAISE EXCEPTION 'An active Arden System Admin cannot have organization memberships'
                    USING ERRCODE='23514';
            END IF;
            removing_admin := OLD.status = 'ACTIVE' AND NEW.status <> 'ACTIVE';
            removing_manager := OLD.status = 'ACTIVE' AND OLD.can_manage_system_admins
                AND (NEW.status <> 'ACTIVE' OR NOT NEW.can_manage_system_admins);
        END IF;
    END IF;
    IF removing_manager AND EXISTS (
        SELECT 1 FROM system_administrator target
        JOIN user_account account ON account.user_id = target.user_id
        WHERE target.user_id = target_id AND target.status = 'ACTIVE'
          AND target.can_manage_system_admins AND account.status = 'ACTIVE'
    ) AND NOT EXISTS (
        SELECT 1 FROM system_administrator other
        JOIN user_account account ON account.user_id = other.user_id
        WHERE other.status = 'ACTIVE' AND other.can_manage_system_admins
          AND account.status = 'ACTIVE' AND other.user_id <> target_id
    ) THEN
        RAISE EXCEPTION 'The last System Admin manager cannot be removed'
            USING ERRCODE = '23514';
    END IF;
    IF removing_admin AND EXISTS (
        SELECT 1 FROM system_administrator target JOIN user_account account ON account.user_id = target.user_id
        WHERE target.user_id = target_id AND target.status = 'ACTIVE' AND account.status = 'ACTIVE'
    ) AND NOT EXISTS (
        SELECT 1 FROM system_administrator other JOIN user_account account ON account.user_id = other.user_id
        WHERE other.status = 'ACTIVE' AND account.status = 'ACTIVE' AND other.user_id <> target_id
    ) THEN
        RAISE EXCEPTION 'The last active Arden System Admin cannot be removed'
            USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION protect_last_system_administrator() FROM PUBLIC;
DROP TRIGGER trg_protect_last_system_administrator ON system_administrator;
CREATE TRIGGER trg_protect_last_system_administrator
BEFORE INSERT OR UPDATE OR DELETE ON system_administrator
FOR EACH ROW EXECUTE FUNCTION protect_last_system_administrator();
CREATE TRIGGER trg_protect_last_system_admin_account
BEFORE UPDATE OF status ON user_account
FOR EACH ROW EXECUTE FUNCTION protect_last_system_administrator();

CREATE FUNCTION system_admin_lifecycle_counts(p_actor uuid)
RETURNS TABLE(active_admins bigint, active_managers bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = arden, pg_temp AS $$
    SELECT count(*) FILTER (WHERE sa.status = 'ACTIVE' AND ua.status = 'ACTIVE'),
           count(*) FILTER (WHERE sa.status = 'ACTIVE' AND ua.status = 'ACTIVE' AND sa.can_manage_system_admins)
      FROM system_administrator sa JOIN user_account ua ON ua.user_id = sa.user_id
     WHERE p_actor = NULLIF(current_setting('arden.actor_id', true), '')::uuid
       AND current_setting('arden.instance_admin', true) = 'true'
       AND current_setting('arden.manage_system_admins', true) = 'true'
       AND EXISTS (SELECT 1 FROM system_administrator caller
          JOIN user_account caller_account ON caller_account.user_id = caller.user_id
         WHERE caller.user_id = p_actor AND caller.status = 'ACTIVE' AND caller.can_manage_system_admins
           AND caller_account.status = 'ACTIVE'
           AND NOT EXISTS (SELECT 1 FROM organization_membership om WHERE om.user_id = p_actor));
$$;
REVOKE ALL ON FUNCTION system_admin_lifecycle_counts(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION system_admin_lifecycle_counts(uuid) TO arden_runtime;

-- Both organization membership creation and System Admin grants serialize on
-- the same lifecycle lock. The application also checks these conditions before
-- returning success; this trigger prevents an alternate runtime write path.
CREATE FUNCTION guard_system_admin_membership()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = arden, pg_temp AS $$
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended('arden:system-administrator-lifecycle', 0));
    IF EXISTS (SELECT 1 FROM system_administrator sa
                WHERE sa.user_id = NEW.user_id AND sa.status = 'ACTIVE') THEN
        RAISE EXCEPTION 'An active Arden System Admin cannot join an organization'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION guard_system_admin_membership() FROM PUBLIC;
CREATE TRIGGER trg_guard_system_admin_membership
BEFORE INSERT OR UPDATE ON organization_membership
FOR EACH ROW EXECUTE FUNCTION guard_system_admin_membership();

-- A single narrow SECURITY DEFINER read returns aggregates and anonymous
-- references only. System Admin never receives SELECT on tenant content tables.
CREATE FUNCTION system_console_report(
    p_actor uuid, p_kind text, p_organization uuid DEFAULT NULL,
    p_from timestamptz DEFAULT now() - interval '30 days',
    p_to timestamptz DEFAULT now(), p_search text DEFAULT '',
    p_status text DEFAULT '', p_page integer DEFAULT 1, p_page_size integer DEFAULT 25)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = arden, pg_temp AS $$
DECLARE result jsonb; offset_rows integer;
BEGIN
    IF p_actor IS DISTINCT FROM NULLIF(current_setting('arden.actor_id', true), '')::uuid
       OR current_setting('arden.instance_admin', true) IS DISTINCT FROM 'true'
       OR length(coalesce(p_search, '')) > 120
       OR coalesce(p_status, '') NOT IN ('', 'ACTIVE', 'SUSPENDED', 'ARCHIVED')
       OR p_from IS NULL OR p_to IS NULL OR p_from >= p_to OR p_to - p_from > interval '366 days'
       OR p_page NOT BETWEEN 1 AND 100000 OR p_page_size NOT BETWEEN 1 AND 50
       OR p_kind NOT IN ('OVERVIEW', 'ORGANIZATIONS', 'ORGANIZATION', 'KNOWLEDGE',
          'AI_USAGE', 'CONTRIBUTIONS', 'FEEDBACK', 'QUALITY', 'HEALTH') THEN
        RAISE EXCEPTION 'Invalid System Console query' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM system_administrator sa JOIN user_account ua ON ua.user_id = sa.user_id
         WHERE sa.user_id = p_actor AND sa.status = 'ACTIVE' AND ua.status = 'ACTIVE')
       OR EXISTS (SELECT 1 FROM organization_membership om WHERE om.user_id = p_actor) THEN
        RAISE EXCEPTION 'System Console access is unavailable' USING ERRCODE = '42501';
    END IF;
    offset_rows := (p_page - 1) * p_page_size;

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
              FROM ai_answer_feedback f WHERE f.updated_at >= p_from AND f.updated_at < p_to))
          INTO result FROM organization;
        RETURN result;
    ELSIF p_kind = 'ORGANIZATIONS' THEN
        SELECT jsonb_build_object('page', p_page, 'pageSize', p_page_size,
          'total', (SELECT count(*) FROM organization o WHERE (p_search = '' OR o.name ILIKE '%' || p_search || '%')
            AND (p_status = '' OR o.status = p_status)),
          'items', coalesce((SELECT jsonb_agg(item ORDER BY item->>'name') FROM (
              SELECT jsonb_build_object('id', o.organization_id, 'name', o.name, 'status', o.status,
                'createdAt', o.created_at, 'drafts', (SELECT count(*) FROM shared_draft sd WHERE sd.organization_id = o.organization_id AND sd.status = 'ACTIVE'),
                'published', (SELECT count(*) FROM knowledge_current_publication cp WHERE cp.organization_id = o.organization_id),
                'openCases', (SELECT count(*) FROM maintenance_case mc WHERE mc.organization_id = o.organization_id AND mc.reporter_status <> 'Resolved')) AS item
                FROM organization o WHERE (p_search = '' OR o.name ILIKE '%' || p_search || '%')
                  AND (p_status = '' OR o.status = p_status)
                ORDER BY o.name, o.organization_id OFFSET offset_rows LIMIT p_page_size
          ) page_rows), '[]'::jsonb)) INTO result;
        RETURN result;
    ELSIF p_kind = 'ORGANIZATION' THEN
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
        SELECT jsonb_build_object('items',coalesce(jsonb_agg(jsonb_build_object('organizationId',org_id,'departmentId',department_id,
          'submitted',submitted,'approved',approved,'rejected',rejected,'pending',pending)), '[]'::jsonb)) INTO result
        FROM (SELECT om.organization_id AS org_id, dm.department_id,
          count(*) AS submitted, count(*) FILTER (WHERE s.status='APPROVED') AS approved,
          count(*) FILTER (WHERE s.status='REJECTED') AS rejected,
          count(*) FILTER (WHERE s.status='PENDING_REVIEW') AS pending
          FROM shared_submission s JOIN organization_membership om ON om.membership_id=s.submitted_by_membership_id
          LEFT JOIN department_membership dm ON dm.membership_id=om.membership_id AND dm.is_primary AND dm.status='ACTIVE'
          WHERE s.submitted_at>=p_from AND s.submitted_at<p_to AND (p_organization IS NULL OR om.organization_id=p_organization)
          GROUP BY om.organization_id, dm.department_id) grouped;
        RETURN result;
    ELSIF p_kind = 'FEEDBACK' THEN
        SELECT jsonb_build_object(
          'positive',(SELECT count(*) FROM ai_answer_feedback f WHERE f.rating='POSITIVE' AND f.updated_at>=p_from AND f.updated_at<p_to AND (p_organization IS NULL OR f.organization_id=p_organization)),
          'negative',(SELECT count(*) FROM ai_answer_feedback f WHERE f.rating='NEGATIVE' AND f.updated_at>=p_from AND f.updated_at<p_to AND (p_organization IS NULL OR f.organization_id=p_organization)),
          'openCases',(SELECT count(*) FROM maintenance_case mc WHERE mc.reporter_status <> 'Resolved' AND (p_organization IS NULL OR mc.organization_id=p_organization)),
          'caseAgeOver30Days',(SELECT count(*) FROM maintenance_case mc WHERE mc.reporter_status <> 'Resolved' AND mc.created_at < now()-interval '30 days' AND (p_organization IS NULL OR mc.organization_id=p_organization)))
          INTO result;
        RETURN result;
    ELSIF p_kind = 'QUALITY' THEN
        SELECT jsonb_build_object('items',coalesce(jsonb_agg(item), '[]'::jsonb)) INTO result FROM (
          SELECT jsonb_build_object('documentRef',substr(md5(cp.organization_id::text || cp.shared_draft_id::text),1,16),
            'signal','OPEN_CASES','count',count(*),'status','OPEN') item
            FROM maintenance_case mc JOIN knowledge_current_publication cp ON cp.shared_draft_id=mc.document_id AND cp.organization_id=mc.organization_id
           WHERE mc.reporter_status <> 'Resolved' AND (p_organization IS NULL OR mc.organization_id=p_organization)
           GROUP BY cp.organization_id,cp.shared_draft_id HAVING count(*)>=2
          UNION ALL
          SELECT jsonb_build_object('documentRef',substr(md5(cp.organization_id::text || cp.shared_draft_id::text),1,16),'signal','STALE_PUBLICATION','count',1,'status','REVIEW')
            FROM knowledge_current_publication cp WHERE cp.updated_at < now()-interval '180 days' AND (p_organization IS NULL OR cp.organization_id=p_organization)
          UNION ALL
          SELECT jsonb_build_object('documentRef',substr(md5(cp.organization_id::text || cp.shared_draft_id::text),1,16),'signal','EXPIRED','count',1,'status','EXPIRED')
            FROM knowledge_current_publication cp JOIN published_knowledge_version pv USING(published_version_id)
           WHERE NULLIF(pv.management->>'expirationDate','')::date < (now() AT TIME ZONE 'UTC')::date AND (p_organization IS NULL OR cp.organization_id=p_organization)
          UNION ALL
          SELECT jsonb_build_object('documentRef',substr(md5(cp.organization_id::text || cp.shared_draft_id::text),1,16),'signal','EXACT_DUPLICATE','count',dupe.copies,'status','REVIEW')
            FROM knowledge_current_publication cp JOIN published_knowledge_version pv USING(published_version_id)
            JOIN (SELECT cp2.organization_id,pv2.content_hash,count(*) copies FROM knowledge_current_publication cp2 JOIN published_knowledge_version pv2 USING(published_version_id)
              GROUP BY cp2.organization_id,pv2.content_hash HAVING count(*)>1) dupe ON dupe.organization_id=cp.organization_id AND dupe.content_hash=pv.content_hash
           WHERE p_organization IS NULL OR cp.organization_id=p_organization
        ) signals;
        RETURN result;
    ELSE
        SELECT jsonb_build_object('database',jsonb_build_object('status','ok'),
          'indexing',jsonb_build_object(
            'status',CASE WHEN count(*) FILTER (WHERE j.status='FAILED') > 0
                OR min(j.created_at) FILTER (WHERE j.status='PENDING') < now()-interval '5 minutes'
              THEN 'degraded' ELSE 'ok' END,
            'pending',count(*) FILTER (WHERE j.status='PENDING'),
            'running',count(*) FILTER (WHERE j.status='RUNNING'),
            'failed',count(*) FILTER (WHERE j.status='FAILED'),
            'oldestPendingSeconds',CASE WHEN min(j.created_at) FILTER (WHERE j.status='PENDING') IS NULL THEN NULL
              ELSE floor(extract(epoch FROM now()-min(j.created_at) FILTER (WHERE j.status='PENDING'))) END),
          'notifications', (SELECT jsonb_build_object(
            'status',CASE WHEN count(*) FILTER (WHERE status='FAILED') > 0
                OR min(created_at) FILTER (WHERE status IN ('PENDING','LEASED')) < now()-interval '5 minutes'
              THEN 'degraded' ELSE 'ok' END,
            'pending',count(*) FILTER (WHERE status IN ('PENDING','LEASED')),
            'failed',count(*) FILTER (WHERE status='FAILED'),
            'oldestPendingSeconds',CASE WHEN min(created_at) FILTER (WHERE status IN ('PENDING','LEASED')) IS NULL THEN NULL
              ELSE floor(extract(epoch FROM now()-min(created_at) FILTER (WHERE status IN ('PENDING','LEASED')))) END)
            FROM arden_notification_outbox))
          INTO result FROM knowledge_index_job j;
        RETURN result;
    END IF;
END;
$$;
REVOKE ALL ON FUNCTION system_console_report(uuid,text,uuid,timestamptz,timestamptz,text,text,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION system_console_report(uuid,text,uuid,timestamptz,timestamptz,text,text,integer,integer) TO arden_runtime;

COMMENT ON FUNCTION system_console_report(uuid,text,uuid,timestamptz,timestamptz,text,text,integer,integer) IS
    'Narrow aggregate-only System Console projection; never returns tenant document or user text.';
