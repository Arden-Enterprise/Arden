SET search_path TO arden, public;

-- The old client can check its own outstanding pre-cutover report without
-- receiving source rows or access to other reporters' history.
CREATE FUNCTION maintenance_has_unmapped_open_reader_report(p_document_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = arden, pg_temp AS $$
    SELECT EXISTS (
        SELECT 1
          FROM publication_report r
         WHERE r.organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
           AND r.shared_draft_id = p_document_id
           AND r.status = 'OPEN'
           AND r.reporter_membership_id = maintenance_actor_membership(r.organization_id)
           AND NOT EXISTS (
               SELECT 1 FROM maintenance_report_import i
                WHERE i.organization_id = r.organization_id AND i.report_id = r.report_id));
$$;
REVOKE ALL ON FUNCTION maintenance_has_unmapped_open_reader_report(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION maintenance_has_unmapped_open_reader_report(uuid) TO arden_runtime;
