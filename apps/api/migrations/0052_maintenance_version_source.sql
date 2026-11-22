SET search_path TO arden, public;

CREATE FUNCTION maintenance_can_read_document_versions(p_document_id uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = arden, pg_temp AS $$
DECLARE
    org uuid := NULLIF(current_setting('arden.organization_id', true), '')::uuid;
    actor uuid := governance_actor_membership(NULLIF(current_setting('arden.organization_id', true), '')::uuid);
    current_row knowledge_current_publication%ROWTYPE;
    version_row published_knowledge_version%ROWTYPE;
BEGIN
    IF actor IS NULL OR org IS NULL THEN RETURN false; END IF;
    IF governance_is_org_admin(actor, org) THEN RETURN true; END IF;
    SELECT * INTO current_row FROM knowledge_current_publication cp
     WHERE cp.shared_draft_id = p_document_id AND cp.organization_id = org;
    IF FOUND AND actor_in_publication_audience(current_row.organization_id, current_row.audience_role_ids,
        current_row.target_scope_type, current_row.target_department_id) THEN
        RETURN true;
    END IF;
    SELECT * INTO version_row FROM published_knowledge_version pv
     WHERE pv.shared_draft_id = p_document_id
     ORDER BY pv.version_no DESC LIMIT 1;
    IF NOT FOUND THEN RETURN false; END IF;
    RETURN EXISTS (
        SELECT 1 FROM reviewer_grant g
        JOIN organization_membership om ON om.membership_id = g.reviewer_membership_id AND om.status = 'ACTIVE'
        JOIN user_account ua ON ua.user_id = om.user_id AND ua.status = 'ACTIVE'
       WHERE g.organization_id = org AND om.organization_id = org
         AND om.user_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid
         AND g.status = 'ACTIVE' AND g.valid_from <= now()
         AND (g.valid_until IS NULL OR g.valid_until > now())
         AND (g.scope = 'ORGANIZATION' OR (g.scope = 'DEPARTMENT' AND g.department_id = version_row.responsible_department_id))
         AND version_row.classification = ANY(g.classifications)
         AND (g.team_tag IS NULL OR g.team_tag IS NOT DISTINCT FROM version_row.team_tag)
         AND (g.project_tag IS NULL OR g.project_tag IS NOT DISTINCT FROM version_row.project_tag)
    );
END;
$$;
REVOKE ALL ON FUNCTION maintenance_can_read_document_versions(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION maintenance_can_read_document_versions(uuid) TO arden_runtime;

CREATE FUNCTION list_maintenance_document_versions(p_document_id uuid)
RETURNS TABLE (published_version_id uuid, version_no integer, published_at timestamptz, is_current boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = arden, pg_temp AS $$
BEGIN
    IF NOT maintenance_can_read_document_versions(p_document_id) THEN RETURN; END IF;
    RETURN QUERY
    SELECT pv.published_version_id, pv.version_no, pv.published_at,
           EXISTS (SELECT 1 FROM knowledge_current_publication cp
             WHERE cp.published_version_id = pv.published_version_id AND cp.shared_draft_id = p_document_id)
      FROM published_knowledge_version pv
     WHERE pv.shared_draft_id = p_document_id
     ORDER BY pv.version_no, pv.published_at
     LIMIT 50;
END;
$$;
REVOKE ALL ON FUNCTION list_maintenance_document_versions(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_maintenance_document_versions(uuid) TO arden_runtime;

CREATE FUNCTION maintenance_version_source(p_published_version_id uuid)
RETURNS TABLE (document_id uuid, content_uri text, content_hash text, mime_type text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = arden, pg_temp AS $$
DECLARE
    version_row published_knowledge_version%ROWTYPE;
    mime text;
BEGIN
    SELECT * INTO version_row FROM published_knowledge_version pv WHERE pv.published_version_id = p_published_version_id;
    IF NOT FOUND OR version_row.shared_draft_id IS NULL THEN RETURN; END IF;
    IF NOT maintenance_can_read_document_versions(version_row.shared_draft_id) THEN RETURN; END IF;
    SELECT s.mime_type INTO mime FROM shared_submission s WHERE s.submission_id = version_row.submission_id;
    RETURN QUERY SELECT version_row.shared_draft_id, version_row.content_uri, version_row.content_hash,
        COALESCE(mime, 'text/plain');
END;
$$;
REVOKE ALL ON FUNCTION maintenance_version_source(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION maintenance_version_source(uuid) TO arden_runtime;
