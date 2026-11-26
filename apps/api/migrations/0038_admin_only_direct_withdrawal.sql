SET search_path TO arden, public;

-- Decision 0024: only a current Organization Admin may withdraw directly.
-- Keep 0037 immutable and preserve the existing guarded routine's trusted owner,
-- signature and EXECUTE boundary. Apply as the trusted operator, not runtime.
-- Responsible review, author change requests and historical provenance remain unchanged.
CREATE OR REPLACE FUNCTION withdraw_publication_directly(p_document_id uuid, p_reason text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = arden, pg_temp AS $$
DECLARE
    org uuid := NULLIF(current_setting('arden.organization_id', true), '')::uuid;
    actor uuid := governance_actor_membership(NULLIF(current_setting('arden.organization_id', true), '')::uuid);
    current_row governance_current_publication%ROWTYPE;
BEGIN
    IF NOT governance_is_org_admin(actor, org) THEN RETURN 'NOT_FOUND'; END IF;
    IF p_reason IS NULL OR char_length(btrim(p_reason)) NOT BETWEEN 1 AND 1000 THEN
        RAISE EXCEPTION 'Give a reason of 1 to 1000 characters' USING ERRCODE = '22023';
    END IF;
    -- Serialize against activation and approved publication changes (0021/0035).
    PERFORM 1 FROM shared_draft WHERE shared_draft_id = p_document_id AND organization_id = org FOR UPDATE;
    IF NOT FOUND THEN RETURN 'NOT_FOUND'; END IF;
    SELECT * INTO current_row FROM governance_current_publication g
     WHERE g.shared_draft_id = p_document_id AND g.organization_id = org;
    IF NOT FOUND THEN RETURN 'NOT_FOUND'; END IF;
    IF EXISTS (SELECT 1 FROM shared_submission c WHERE c.shared_draft_id = p_document_id
                 AND c.status = 'APPROVED' AND c.publication_state = 'PREPARING') THEN
        RETURN 'PREPARING';
    END IF;
    IF current_row.submission_id IS NOT NULL THEN
        UPDATE shared_submission
           SET publication_state = 'WITHDRAWN', withdrawn_by = 'ORGANIZATION_ADMIN',
               withdrawn_reason = btrim(p_reason), withdrawn_at = now()
         WHERE submission_id = current_row.submission_id;
    END IF;
    DELETE FROM knowledge_current_publication WHERE shared_draft_id = p_document_id;
    UPDATE publication_report SET status = 'CLOSED', closed_by_membership_id = actor, closed_at = now(),
           resolution = 'WITHDRAWN'
     WHERE shared_draft_id = p_document_id AND status = 'OPEN';
    INSERT INTO audit_event (organization_id, actor_membership_id, event_type, outcome, details_json)
    VALUES (org, actor, 'KNOWLEDGE_PUBLICATION_WITHDRAWN', 'SUCCESS',
        jsonb_build_object('documentId', p_document_id, 'publishedVersionId', current_row.published_version_id,
            'submissionId', current_row.submission_id, 'withdrawnBy', 'ORGANIZATION_ADMIN',
            'reason', btrim(p_reason)));
    RETURN 'WITHDRAWN';
END;
$$;
REVOKE ALL ON FUNCTION withdraw_publication_directly(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION withdraw_publication_directly(uuid, text) TO arden_runtime;
