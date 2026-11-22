SET search_path TO arden, public;

CREATE INDEX ix_publication_report_closed_page
    ON publication_report (organization_id, closed_at DESC, created_at DESC, report_id DESC)
    WHERE status = 'CLOSED';

CREATE FUNCTION list_closed_publication_reports(p_after uuid)
RETURNS TABLE (report_id uuid, document_id uuid, published_version_id uuid, title text, message text,
    reporter_name text, created_at timestamptz, still_current boolean, can_view boolean, resolution text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = arden, pg_temp AS $$
DECLARE
    org uuid := NULLIF(current_setting('arden.organization_id', true), '')::uuid;
    actor uuid := governance_actor_membership(org);
    admin boolean;
BEGIN
    IF actor IS NULL THEN RETURN; END IF;
    admin := governance_is_org_admin(actor, org);
    RETURN QUERY
    WITH visible AS NOT MATERIALIZED (
        SELECT r.*, g.published_version_id AS current_version_id
          FROM publication_report r
          LEFT JOIN governance_current_publication g ON g.shared_draft_id = r.shared_draft_id
         WHERE r.organization_id = org AND r.status = 'CLOSED'
           AND (admin OR r.closed_by_membership_id = actor
                OR (g.shared_draft_id IS NOT NULL AND g.submitted_by_membership_id IS DISTINCT FROM actor
                    AND governance_is_responsible_reviewer(actor, org, g.responsible_department_id, g.reader_mode)))
    ), boundary AS (
        SELECT a.closed_at, a.created_at, a.report_id FROM visible a WHERE a.report_id = p_after
    )
    SELECT r.report_id, r.shared_draft_id, r.published_version_id, pv.title, r.message,
           COALESCE(NULLIF(btrim(ua.full_name), ''), ua.email), r.created_at,
           r.current_version_id IS NOT DISTINCT FROM r.published_version_id, false, r.resolution
      FROM visible r
      JOIN published_knowledge_version pv ON pv.published_version_id = r.published_version_id
      JOIN organization_membership om ON om.membership_id = r.reporter_membership_id
      JOIN user_account ua ON ua.user_id = om.user_id
     WHERE p_after IS NULL OR EXISTS (
        SELECT 1 FROM boundary b
         WHERE (r.closed_at, r.created_at, r.report_id) < (b.closed_at, b.created_at, b.report_id))
     ORDER BY r.closed_at DESC, r.created_at DESC, r.report_id DESC
     LIMIT 201;
END;
$$;
REVOKE ALL ON FUNCTION list_closed_publication_reports(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_closed_publication_reports(uuid) TO arden_runtime;

CREATE OR REPLACE FUNCTION list_closed_publication_reports()
RETURNS TABLE (report_id uuid, document_id uuid, published_version_id uuid, title text, message text,
    reporter_name text, created_at timestamptz, still_current boolean, can_view boolean, resolution text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = arden, pg_temp AS $$
    SELECT * FROM list_closed_publication_reports(NULL::uuid) LIMIT 200;
$$;
