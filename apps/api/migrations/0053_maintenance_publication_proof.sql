SET search_path TO arden, public;

CREATE FUNCTION maintenance_publication_proof(p_document_id uuid, p_reported_version_id uuid)
RETURNS TABLE (
    current_version_id uuid,
    current_version_no integer,
    reported_version_no integer,
    valid_from timestamptz,
    valid_until timestamptz,
    status text,
    request_type text,
    publication_state text,
    rejected boolean,
    withdrawn boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = arden, pg_temp AS $$
DECLARE
    reported published_knowledge_version%ROWTYPE;
    current_row record;
BEGIN
    IF NOT maintenance_can_read_document_versions(p_document_id) THEN RETURN; END IF;
    SELECT * INTO reported FROM published_knowledge_version pv
     WHERE pv.published_version_id = p_reported_version_id AND pv.shared_draft_id = p_document_id;
    IF NOT FOUND THEN RETURN; END IF;
    SELECT pv.published_version_id, pv.version_no, pv.valid_from, pv.valid_until,
           s.status, s.request_type, s.publication_state
      INTO current_row
      FROM knowledge_current_publication cp
      JOIN published_knowledge_version pv ON pv.published_version_id = cp.published_version_id
      JOIN shared_submission s ON s.submission_id = pv.submission_id
     WHERE cp.shared_draft_id = p_document_id
       AND cp.organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid;
    IF NOT FOUND THEN
        RETURN QUERY SELECT NULL::uuid, NULL::integer, reported.version_no, NULL::timestamptz, NULL::timestamptz,
            NULL::text, NULL::text, NULL::text,
            EXISTS (
                SELECT 1 FROM shared_submission rejected_submission
                 WHERE rejected_submission.shared_draft_id = p_document_id
                   AND rejected_submission.status = 'REJECTED'
                   AND rejected_submission.request_type IN ('CONTENT', 'WITHDRAWAL')),
            EXISTS (
                SELECT 1 FROM shared_submission withdrawn_submission
                 WHERE withdrawn_submission.shared_draft_id = p_document_id
                   AND withdrawn_submission.publication_state = 'WITHDRAWN');
        RETURN;
    END IF;
    RETURN QUERY SELECT
        current_row.published_version_id,
        current_row.version_no,
        reported.version_no,
        current_row.valid_from,
        current_row.valid_until,
        current_row.status,
        current_row.request_type,
        current_row.publication_state,
        EXISTS (
            SELECT 1 FROM shared_submission rejected_submission
             WHERE rejected_submission.shared_draft_id = p_document_id
               AND rejected_submission.status = 'REJECTED'
               AND rejected_submission.request_type IN ('CONTENT', 'WITHDRAWAL')
        ),
        EXISTS (
            SELECT 1 FROM shared_submission withdrawn_submission
             WHERE withdrawn_submission.shared_draft_id = p_document_id
               AND withdrawn_submission.publication_state = 'WITHDRAWN'
        );
END;
$$;
REVOKE ALL ON FUNCTION maintenance_publication_proof(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION maintenance_publication_proof(uuid, uuid) TO arden_runtime;
