SET search_path TO arden, public;

-- Accepted simplification: current indexed publications, with Published date,
-- readership and expiration checks. No applicable/upcoming/compare selector.
-- Operator-only contract migration: back up and rehearse the exact DB first.
-- Retire only obsolete scope data; keep turns, evidence and immutable snapshots.
DROP POLICY ai_applicable_generation_read ON knowledge_index_generation;
DROP POLICY ai_applicable_version_read ON published_knowledge_version;
DROP FUNCTION eligible_ai_publications(text);

CREATE FUNCTION eligible_ai_publications() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = arden, pg_temp AS $$
    SELECT pv.published_version_id
      FROM knowledge_current_publication cp
      JOIN published_knowledge_version pv ON pv.published_version_id = cp.published_version_id
           AND pv.shared_draft_id = cp.shared_draft_id
      JOIN knowledge_base kb ON kb.knowledge_base_id = pv.knowledge_base_id
     WHERE cp.organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
       AND kb.organization_id = cp.organization_id
       AND cp.valid_from <= now() AND (cp.valid_until IS NULL OR cp.valid_until > now())
       AND pv.published_at <= now() AND pv.index_status = 'INDEXED'
       AND (NULLIF(pv.management->>'expirationDate', '')::date IS NULL
            OR (pv.management->>'expirationDate')::date >= (now() AT TIME ZONE 'UTC')::date)
       AND EXISTS (
           SELECT 1 FROM organization_membership m
             JOIN user_account u USING (user_id) JOIN organization o USING (organization_id)
            WHERE m.user_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid
              AND m.organization_id = cp.organization_id
              AND m.status = 'ACTIVE' AND u.status = 'ACTIVE' AND o.status = 'ACTIVE'
              AND CASE WHEN pv.reader_selection_id IS NOT NULL
                  THEN actor_in_reader_selection(pv.reader_selection_id)
                  ELSE m.membership_id IN (
                      SELECT audience_reader_memberships(cp.organization_id, pv.audience_role_ids,
                          kb.scope_type, kb.department_id))
                  END
       );
$$;
REVOKE ALL ON FUNCTION eligible_ai_publications() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION eligible_ai_publications() TO arden_runtime;

CREATE POLICY ai_current_publication_read ON published_knowledge_version FOR SELECT TO arden_runtime
USING (published_version_id IN (SELECT eligible_ai_publications()));
CREATE POLICY ai_current_generation_read ON knowledge_index_generation FOR SELECT TO arden_runtime
USING (status = 'READY'
    AND organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM published_knowledge_version pv
        WHERE pv.submission_id = knowledge_index_generation.submission_id
          AND pv.content_hash = knowledge_index_generation.snapshot_content_hash
          AND pv.published_version_id IN (SELECT eligible_ai_publications())));

ALTER TABLE ai_conversation_turn DROP COLUMN version_scope;
DROP TRIGGER trg_knowledge_ai_release ON knowledge_current_publication;
DROP FUNCTION maintain_knowledge_ai_release();
DROP TABLE knowledge_ai_release;

-- Mutable draft cleanup only. Frozen submissions/publications keep their exact
-- historical metadata for provenance; application projections omit retired keys.
UPDATE shared_draft SET management = management - 'effectiveDate'
 WHERE management ? 'effectiveDate';

CREATE OR REPLACE FUNCTION freeze_knowledge_management() RETURNS trigger
LANGUAGE plpgsql SET search_path = arden, pg_temp AS $$
DECLARE source record;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF OLD.document_code IS DISTINCT FROM NEW.document_code
           OR (TG_TABLE_NAME <> 'shared_draft' AND OLD.management IS DISTINCT FROM NEW.management) THEN
            RAISE EXCEPTION 'Document identity and snapshot metadata are immutable' USING ERRCODE = '55000';
        END IF;
        RETURN NEW;
    END IF;
    -- Nested IF: only shared_submission rows have request_type (plpgsql does not short-circuit AND).
    IF TG_TABLE_NAME = 'shared_submission' THEN
        IF NEW.request_type <> 'CONTENT' THEN
            SELECT released.document_code, released.management INTO STRICT source
              FROM published_knowledge_version pv
              JOIN shared_submission released ON released.submission_id = pv.submission_id
             WHERE pv.published_version_id = NEW.target_published_version_id
               AND pv.shared_draft_id = NEW.shared_draft_id;
            NEW.document_code := source.document_code;
            NEW.management := source.management;
            RETURN NEW;
        END IF;
    END IF;
    IF TG_TABLE_NAME = 'shared_submission' THEN
        SELECT d.document_code, d.management - 'topicId' - 'topicName' - 'effectiveDate' AS management
            INTO STRICT source FROM shared_draft d
            WHERE d.shared_draft_id = NEW.shared_draft_id AND d.organization_id = NEW.organization_id;
    ELSE
        SELECT s.document_code, s.management INTO STRICT source FROM shared_submission s
            WHERE s.submission_id = NEW.submission_id;
    END IF;
    NEW.document_code := source.document_code;
    NEW.management := source.management;
    IF TG_TABLE_NAME = 'shared_submission' AND NEW.management IS NOT NULL THEN
        NEW.management := NEW.management || jsonb_build_object('releaseKind', CASE WHEN EXISTS (
            SELECT 1 FROM shared_submission prior WHERE prior.shared_draft_id = NEW.shared_draft_id
              AND prior.publication_state IN ('ACTIVE', 'SUPERSEDED')) THEN 'UPDATED' ELSE 'NEW' END);
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION freeze_knowledge_management() FROM PUBLIC;


-- Maintenance proof uses publication time, not retired effective-date metadata.
CREATE OR REPLACE FUNCTION maintenance_publication_proof(p_document_id uuid, p_reported_version_id uuid)
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
    withdrawn_version_id uuid
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = arden, pg_temp AS $$
DECLARE
    org uuid := NULLIF(current_setting('arden.organization_id', true), '')::uuid;
    actor uuid := governance_actor_membership(NULLIF(current_setting('arden.organization_id', true), '')::uuid);
    reported published_knowledge_version%ROWTYPE;
    current_row record;
    was_rejected boolean;
    taken_down uuid;
BEGIN
    IF actor IS NULL THEN RETURN; END IF;
    SELECT pv.* INTO reported FROM published_knowledge_version pv
      JOIN shared_draft d ON d.shared_draft_id = pv.shared_draft_id AND d.organization_id = org
     WHERE pv.published_version_id = p_reported_version_id AND pv.shared_draft_id = p_document_id;
    IF NOT FOUND THEN RETURN; END IF;
    IF NOT governance_is_org_admin(actor, org) AND NOT maintenance_reviewer_eligible(actor, p_reported_version_id) THEN
        RETURN;
    END IF;
    was_rejected := EXISTS (
        SELECT 1 FROM shared_submission rejected_submission
         WHERE rejected_submission.shared_draft_id = p_document_id AND rejected_submission.organization_id = org
           AND rejected_submission.status = 'REJECTED'
           AND rejected_submission.request_type IN ('CONTENT', 'WITHDRAWAL'));
    SELECT pv.published_version_id, pv.version_no,
           GREATEST(pv.valid_from, pv.published_at) AS valid_from,
           pv.valid_until, s.status, s.request_type, s.publication_state
      INTO current_row
      FROM knowledge_current_publication cp
      JOIN published_knowledge_version pv ON pv.published_version_id = cp.published_version_id
      JOIN shared_submission s ON s.submission_id = pv.submission_id
     WHERE cp.shared_draft_id = p_document_id AND cp.organization_id = org;
    IF NOT FOUND THEN
        SELECT pv.published_version_id INTO taken_down
          FROM published_knowledge_version pv
          JOIN shared_submission s ON s.submission_id = pv.submission_id
         WHERE pv.shared_draft_id = p_document_id AND s.organization_id = org
           AND s.publication_state = 'WITHDRAWN' AND pv.version_no >= reported.version_no
         ORDER BY pv.version_no DESC LIMIT 1;
        RETURN QUERY SELECT NULL::uuid, NULL::integer, reported.version_no, NULL::timestamptz, NULL::timestamptz,
            NULL::text, NULL::text, NULL::text, was_rejected, taken_down;
        RETURN;
    END IF;
    RETURN QUERY SELECT current_row.published_version_id, current_row.version_no, reported.version_no,
        current_row.valid_from, current_row.valid_until, current_row.status, current_row.request_type,
        current_row.publication_state, was_rejected, NULL::uuid;
END;
$$;
REVOKE ALL ON FUNCTION maintenance_publication_proof(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION maintenance_publication_proof(uuid, uuid) TO arden_runtime;
