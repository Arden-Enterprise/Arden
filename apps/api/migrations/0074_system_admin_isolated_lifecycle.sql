-- Review fixes for the isolated System Admin identity (ADR 0010, 2026-11-27 refinement).
-- * Setup closes permanently once any isolated administrator exists; legacy
--   `arden.system_administrator` rows no longer close it.
-- * Server-side System Admin sessions and PostgreSQL-backed sign-in/setup throttling.
-- * Administrator lifecycle runs on `arden_system.administrator` only.
-- * The System Console report is reachable only through `arden_system_auth`; the
--   runtime-callable `arden.system_console_report` is removed.
-- * Index usage writes compare the lease with wall-clock time.
-- Operator-class: requires a superuser-equivalent migration connection, like 0072.

SET search_path TO arden_system, arden, public;

-- Administrator invariants: a revoked row records its revocation and cannot manage.
ALTER TABLE arden_system.administrator
    ADD CONSTRAINT ck_sys_admin_revocation_consistent CHECK (
        (status = 'ACTIVE' AND revoked_at IS NULL AND revoked_by_admin_id IS NULL)
        OR (status = 'REVOKED' AND revoked_at IS NOT NULL)),
    ADD CONSTRAINT ck_sys_admin_revoked_not_manager CHECK (
        status = 'ACTIVE' OR NOT can_manage_system_admins);

-- Audit events: object details only; failed sign-in attempts have no authenticated actor.
ALTER TABLE arden_system.administration_event ALTER COLUMN actor_admin_id DROP NOT NULL;
ALTER TABLE arden_system.administration_event
    ADD CONSTRAINT ck_sys_admin_event_details_object CHECK (jsonb_typeof(details_json) = 'object'),
    ADD CONSTRAINT ck_sys_admin_event_actor CHECK (
        actor_admin_id IS NOT NULL OR event_type = 'SYSTEM_ADMIN_SIGN_IN_FAILED');
CREATE INDEX ix_sys_admin_event_target_time
    ON arden_system.administration_event(target_admin_id, occurred_at DESC);

DROP POLICY sys_admin_event_insert ON arden_system.administration_event;
CREATE POLICY sys_admin_event_insert ON arden_system.administration_event FOR INSERT TO arden_system_auth
WITH CHECK (
    current_setting('arden.system_auth_mode', true) IN ('setup', 'sign_in', 'session', 'manager')
    AND actor_admin_id IS NOT DISTINCT FROM NULLIF(current_setting('arden.actor_id', true), '')::uuid
);

-- Server-side sessions: the HttpOnly cookie carries a signed session id, so sign-out,
-- revocation and expiry take effect on the next request.
CREATE TABLE arden_system.admin_session (
    session_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id    uuid NOT NULL REFERENCES arden_system.administrator(admin_id),
    created_at  timestamptz NOT NULL DEFAULT now(),
    expires_at  timestamptz NOT NULL,
    revoked_at  timestamptz,
    CONSTRAINT ck_sys_admin_session_lifetime
        CHECK (expires_at > created_at AND expires_at <= created_at + interval '24 hours 5 minutes'),
    CONSTRAINT ck_sys_admin_session_revocation
        CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);
CREATE INDEX ix_sys_admin_session_admin_active
    ON arden_system.admin_session(admin_id) WHERE revoked_at IS NULL;
CREATE INDEX ix_sys_admin_session_expiry ON arden_system.admin_session(expires_at);
ALTER TABLE arden_system.admin_session ENABLE ROW LEVEL SECURITY;
ALTER TABLE arden_system.admin_session FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON arden_system.admin_session TO arden_system_auth;
CREATE POLICY sys_admin_session_access ON arden_system.admin_session FOR ALL TO arden_system_auth
USING (
    current_setting('arden.system_auth_mode', true) IN ('setup', 'sign_in', 'manager')
    OR (current_setting('arden.system_auth_mode', true) = 'session'
        AND session_id = NULLIF(current_setting('arden.system_session_id', true), '')::uuid)
)
WITH CHECK (
    (current_setting('arden.system_auth_mode', true) IN ('setup', 'sign_in')
        AND admin_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid)
    OR current_setting('arden.system_auth_mode', true) = 'manager'
    OR (current_setting('arden.system_auth_mode', true) = 'session'
        AND session_id = NULLIF(current_setting('arden.system_session_id', true), '')::uuid)
);

-- Attempt throttling shared by every API replica. Buckets are opaque digests.
CREATE TABLE arden_system.auth_throttle (
    bucket            text PRIMARY KEY CHECK (bucket ~ '^(sign-in|setup):[0-9a-f]{64}$'),
    failures          integer NOT NULL DEFAULT 0 CHECK (failures >= 0),
    window_started_at timestamptz NOT NULL DEFAULT now(),
    locked_until      timestamptz,
    updated_at        timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE arden_system.auth_throttle ENABLE ROW LEVEL SECURITY;
ALTER TABLE arden_system.auth_throttle FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON arden_system.auth_throttle TO arden_system_auth;
CREATE POLICY sys_auth_throttle_access ON arden_system.auth_throttle FOR ALL TO arden_system_auth
USING (current_setting('arden.system_auth_mode', true) IN ('setup', 'sign_in'))
WITH CHECK (current_setting('arden.system_auth_mode', true) IN ('setup', 'sign_in'));

-- Setup is a one-time event for the isolated store: any isolated administrator row,
-- active or revoked, closes it. Legacy Supabase-backed administrators do not.
CREATE OR REPLACE FUNCTION arden_system.installation_setup_status()
RETURNS TABLE(needs_initial_setup boolean, has_organizations boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = arden_system, arden, pg_temp AS $$
    SELECT NOT EXISTS (SELECT 1 FROM arden_system.administrator) AS needs_initial_setup,
           EXISTS (SELECT 1 FROM arden.organization) AS has_organizations;
$$;

-- The runtime-callable console routine also accepted isolated identities. Remove it; the
-- isolated entry point below is executable only by `arden_system_auth`.
DROP FUNCTION arden.system_console_report(uuid, text, uuid, timestamptz, timestamptz, text, text, integer, integer);
-- Console reads now go through the routine below, which reads as its trusted owner.
DROP POLICY ai_usage_event_system_console_read ON arden.ai_usage_event;

-- One source per answer surface, so a rating is never counted twice: Ask Arden chat ratings are
-- the saved turn feedback the member sees (filtered by answer time, as turns record no rating
-- time); Reader questions use `ai_answer_feedback`. Only the Console routine reads this view.
CREATE VIEW arden_system.answer_ratings AS
    SELECT f.organization_id, CASE f.rating WHEN 'POSITIVE' THEN 'POSITIVE' ELSE 'NEGATIVE' END AS rating,
           f.updated_at AS rated_at
      FROM arden.ai_answer_feedback f
      JOIN arden.ai_answer_result ar ON ar.request_id = f.request_id AND ar.result_type = 'READER_QUESTION'
    UNION ALL
    SELECT t.organization_id, CASE t.feedback WHEN 'GOOD' THEN 'POSITIVE' ELSE 'NEGATIVE' END, t.created_at
      FROM arden.ai_conversation_turn t
     WHERE t.feedback IS NOT NULL;
REVOKE ALL ON arden_system.answer_ratings FROM PUBLIC;

CREATE FUNCTION arden_system.console_report(
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
REVOKE ALL ON FUNCTION arden_system.console_report(uuid,text,uuid,timestamptz,timestamptz,text,text,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION arden_system.console_report(uuid,text,uuid,timestamptz,timestamptz,text,text,integer,integer) TO arden_system_auth;

-- Index usage: reject writes after the lease has expired in wall-clock time, even when the
-- writing transaction started before expiry.
SET search_path TO arden, public;
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
    SELECT g.organization_id, j.generation_id INTO job_org, job_generation
      FROM knowledge_index_job j JOIN knowledge_index_generation g USING (generation_id)
     WHERE j.job_id=p_job_id AND j.status='RUNNING' AND j.lease_owner=p_worker_id
       AND j.lease_expires_at > clock_timestamp() AND g.status='PROCESSING';
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
