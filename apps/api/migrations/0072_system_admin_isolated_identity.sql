-- Isolated System Admin identity store in a dedicated schema and non-bypass role.
-- Normal-user runtime (`arden_runtime`) receives zero privileges on `arden_system`.
-- System Admin authentication does not use Supabase Auth or `arden.user_account`.

CREATE SCHEMA IF NOT EXISTS arden_system;
REVOKE ALL ON SCHEMA arden_system FROM PUBLIC;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'arden_system_auth') THEN
        CREATE ROLE arden_system_auth NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS;
    END IF;
END $$;
ALTER ROLE arden_system_auth NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS;

GRANT USAGE ON SCHEMA arden_system TO arden_system_auth;
GRANT USAGE ON SCHEMA arden TO arden_system_auth;

CREATE TABLE arden_system.administrator (
    admin_id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email                    text NOT NULL UNIQUE,
    full_name                text NOT NULL,
    password_hash            text NOT NULL,
    status                   text NOT NULL DEFAULT 'ACTIVE',
    can_manage_system_admins boolean NOT NULL DEFAULT false,
    granted_by_admin_id      uuid REFERENCES arden_system.administrator(admin_id),
    granted_at               timestamptz NOT NULL DEFAULT now(),
    revoked_by_admin_id      uuid REFERENCES arden_system.administrator(admin_id),
    revoked_at               timestamptz,
    created_at               timestamptz NOT NULL DEFAULT now(),
    updated_at               timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_sys_admin_email_normalized
        CHECK (email = lower(btrim(email)) AND position('@' IN email) > 1 AND length(email) <= 320),
    CONSTRAINT ck_sys_admin_full_name
        CHECK (length(btrim(full_name)) BETWEEN 1 AND 200),
    CONSTRAINT ck_sys_admin_password_hash
        CHECK (length(password_hash) BETWEEN 32 AND 512),
    CONSTRAINT ck_sys_admin_status
        CHECK (status IN ('ACTIVE', 'REVOKED'))
);

CREATE TABLE arden_system.administration_event (
    event_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_admin_id  uuid NOT NULL REFERENCES arden_system.administrator(admin_id),
    event_type      text NOT NULL CHECK (length(btrim(event_type)) BETWEEN 1 AND 80),
    target_admin_id uuid REFERENCES arden_system.administrator(admin_id),
    request_id      text NOT NULL CHECK (length(btrim(request_id)) BETWEEN 1 AND 160),
    details_json    jsonb NOT NULL DEFAULT '{}'::jsonb,
    occurred_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_sys_admin_event_time
    ON arden_system.administration_event(occurred_at DESC, event_id DESC);

ALTER TABLE arden_system.administrator ENABLE ROW LEVEL SECURITY;
ALTER TABLE arden_system.administrator FORCE ROW LEVEL SECURITY;
ALTER TABLE arden_system.administration_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE arden_system.administration_event FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON arden_system.administrator TO arden_system_auth;
GRANT SELECT, INSERT ON arden_system.administration_event TO arden_system_auth;

-- RLS policies scope `arden_system_auth` operations to explicit transaction-local modes:
-- `setup`, `sign_in`, `session`, or `manager`.
CREATE POLICY sys_admin_access ON arden_system.administrator FOR ALL TO arden_system_auth
USING (
    current_setting('arden.system_auth_mode', true) IN ('setup', 'sign_in', 'manager')
    OR (
        current_setting('arden.system_auth_mode', true) = 'session'
        AND admin_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid
    )
)
WITH CHECK (
    current_setting('arden.system_auth_mode', true) IN ('setup', 'manager')
);

CREATE POLICY sys_admin_event_read ON arden_system.administration_event FOR SELECT TO arden_system_auth
USING (current_setting('arden.system_auth_mode', true) = 'manager');

CREATE POLICY sys_admin_event_insert ON arden_system.administration_event FOR INSERT TO arden_system_auth
WITH CHECK (
    current_setting('arden.system_auth_mode', true) IN ('setup', 'sign_in', 'manager')
    AND actor_admin_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid
);

CREATE FUNCTION arden_system.protect_last_administrator()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = arden_system, pg_temp AS $$
DECLARE
    removing_admin boolean := false;
    removing_manager boolean := false;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended('arden:system-administrator-lifecycle', 0));
    IF TG_OP = 'DELETE' THEN
        removing_admin := OLD.status = 'ACTIVE';
        removing_manager := OLD.status = 'ACTIVE' AND OLD.can_manage_system_admins;
    ELSIF TG_OP = 'UPDATE' THEN
        removing_admin := OLD.status = 'ACTIVE' AND NEW.status <> 'ACTIVE';
        removing_manager := OLD.status = 'ACTIVE' AND OLD.can_manage_system_admins
            AND (NEW.status <> 'ACTIVE' OR NOT NEW.can_manage_system_admins);
    END IF;

    IF removing_manager AND NOT EXISTS (
        SELECT 1 FROM arden_system.administrator other
         WHERE other.status = 'ACTIVE'
           AND other.can_manage_system_admins
           AND other.admin_id <> OLD.admin_id
    ) THEN
        RAISE EXCEPTION 'The last System Admin manager cannot be removed'
            USING ERRCODE = '23514';
    END IF;

    IF removing_admin AND NOT EXISTS (
        SELECT 1 FROM arden_system.administrator other
         WHERE other.status = 'ACTIVE'
           AND other.admin_id <> OLD.admin_id
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
REVOKE ALL ON FUNCTION arden_system.protect_last_administrator() FROM PUBLIC;
CREATE TRIGGER trg_protect_last_system_admin_isolated
BEFORE UPDATE OR DELETE ON arden_system.administrator
FOR EACH ROW EXECUTE FUNCTION arden_system.protect_last_administrator();

-- Narrow status probe: reports only whether initial System Admin setup is still open
-- and whether any organization already exists, without exposing identities or counts.
CREATE FUNCTION arden_system.installation_setup_status()
RETURNS TABLE(needs_initial_setup boolean, has_organizations boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = arden_system, arden, pg_temp AS $$
    SELECT
        NOT EXISTS (
            SELECT 1 FROM arden_system.administrator sa
             WHERE sa.status = 'ACTIVE' AND sa.can_manage_system_admins
        )
        AND NOT EXISTS (
            SELECT 1 FROM arden.system_administrator legacy
            JOIN arden.user_account ua ON ua.user_id = legacy.user_id
             WHERE legacy.status = 'ACTIVE'
               AND legacy.can_manage_system_admins
               AND ua.status = 'ACTIVE'
        ) AS needs_initial_setup,
        EXISTS (SELECT 1 FROM arden.organization) AS has_organizations;
$$;
REVOKE ALL ON FUNCTION arden_system.installation_setup_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION arden_system.installation_setup_status() TO arden_system_auth;

-- Allow the isolated `arden_system.administrator` identity (via `arden_system_auth`)
-- to call the existing narrow aggregate-only `arden.system_console_report` routine.
SET search_path TO arden, public;

CREATE OR REPLACE FUNCTION system_console_report(
    p_actor uuid, p_kind text, p_organization uuid DEFAULT NULL,
    p_from timestamptz DEFAULT now() - interval '30 days',
    p_to timestamptz DEFAULT now(), p_search text DEFAULT '',
    p_status text DEFAULT '', p_page integer DEFAULT 1, p_page_size integer DEFAULT 25)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = arden, arden_system, pg_temp AS $$
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
    IF NOT (
        EXISTS (
            SELECT 1 FROM arden_system.administrator iso
             WHERE iso.admin_id = p_actor AND iso.status = 'ACTIVE'
        )
        OR (
            EXISTS (
                SELECT 1 FROM arden.system_administrator sa
                JOIN arden.user_account ua ON ua.user_id = sa.user_id
                 WHERE sa.user_id = p_actor AND sa.status = 'ACTIVE' AND ua.status = 'ACTIVE'
            )
            AND NOT EXISTS (SELECT 1 FROM arden.organization_membership om WHERE om.user_id = p_actor)
        )
    ) THEN
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

GRANT EXECUTE ON FUNCTION arden.system_console_report(uuid,text,uuid,timestamptz,timestamptz,text,text,integer,integer) TO arden_system_auth;
