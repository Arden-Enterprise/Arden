SET search_path TO arden, public;

CREATE FUNCTION list_closed_publication_reports()
RETURNS TABLE (report_id uuid, document_id uuid, published_version_id uuid, title text, message text,
    reporter_name text, created_at timestamptz, still_current boolean, can_view boolean, resolution text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = arden, pg_temp AS $$
DECLARE
    org uuid := NULLIF(current_setting('arden.organization_id', true), '')::uuid;
    actor uuid := governance_actor_membership(NULLIF(current_setting('arden.organization_id', true), '')::uuid);
    admin boolean;
BEGIN
    IF actor IS NULL THEN RETURN; END IF;
    admin := governance_is_org_admin(actor, org);
    RETURN QUERY
    SELECT r.report_id, r.shared_draft_id, r.published_version_id, pv.title, r.message,
           COALESCE(NULLIF(btrim(ua.full_name), ''), ua.email), r.created_at,
           g.published_version_id IS NOT DISTINCT FROM r.published_version_id,
           false,
           r.resolution
      FROM publication_report r
      JOIN published_knowledge_version pv ON pv.published_version_id = r.published_version_id
      JOIN organization_membership om ON om.membership_id = r.reporter_membership_id
      JOIN user_account ua ON ua.user_id = om.user_id
      LEFT JOIN governance_current_publication g ON g.shared_draft_id = r.shared_draft_id
     WHERE r.organization_id = org AND r.status = 'CLOSED'
       AND (admin OR r.closed_by_membership_id = actor
            OR (g.shared_draft_id IS NOT NULL AND g.submitted_by_membership_id IS DISTINCT FROM actor
                AND governance_is_responsible_reviewer(actor, org, g.responsible_department_id, g.reader_mode)))
     ORDER BY r.closed_at DESC NULLS LAST, r.created_at DESC
     LIMIT 200;
END;
$$;
REVOKE ALL ON FUNCTION list_closed_publication_reports() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_closed_publication_reports() TO arden_runtime;

CREATE FUNCTION list_unmapped_open_publication_reports()
RETURNS TABLE (report_id uuid, shared_draft_id uuid, published_version_id uuid, reporter_membership_id uuid,
    message text, created_at timestamptz, verifiable boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = arden, pg_temp AS $$
DECLARE
    org uuid := NULLIF(current_setting('arden.organization_id', true), '')::uuid;
    actor uuid := governance_actor_membership(NULLIF(current_setting('arden.organization_id', true), '')::uuid);
BEGIN
    IF actor IS NULL OR NOT governance_is_org_admin(actor, org) THEN RETURN; END IF;
    RETURN QUERY
    SELECT r.report_id, r.shared_draft_id, r.published_version_id, r.reporter_membership_id, r.message, r.created_at,
           EXISTS (SELECT 1 FROM knowledge_current_publication cp
             WHERE cp.organization_id = r.organization_id AND cp.shared_draft_id = r.shared_draft_id
               AND cp.published_version_id = r.published_version_id)
      FROM publication_report r
     WHERE r.organization_id = org AND r.status = 'OPEN'
       AND NOT EXISTS (SELECT 1 FROM maintenance_report_import i
         WHERE i.organization_id = r.organization_id AND i.report_id = r.report_id)
     ORDER BY r.created_at, r.report_id
     LIMIT 200;
END;
$$;
REVOKE ALL ON FUNCTION list_unmapped_open_publication_reports() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_unmapped_open_publication_reports() TO arden_runtime;
