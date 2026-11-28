SET search_path TO arden, public;

-- Refuse the switch if any live publication still needs the compatibility policy,
-- or if in-flight approvals could activate a document without Target Readers.
LOCK TABLE shared_submission, published_knowledge_version, knowledge_current_publication
    IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM knowledge_current_publication cp
        JOIN published_knowledge_version pv ON pv.published_version_id = cp.published_version_id
         WHERE cp.reader_selection_id IS NULL OR cp.reader_selection_id IS DISTINCT FROM pv.reader_selection_id
    ) OR EXISTS (
        SELECT 1 FROM shared_submission s WHERE s.request_type = 'CONTENT' AND (
            (s.status = 'PENDING_REVIEW' AND s.proposed_selection_id IS NULL)
            OR (s.status = 'APPROVED' AND s.publication_state IN ('PREPARING', 'FAILED')
                AND s.approved_selection_id IS NULL))
    ) THEN
        RAISE EXCEPTION 'Complete and verify the Target Readers backfill before retiring Audience reads'
            USING ERRCODE = '55000';
    END IF;
END;
$$;

DROP POLICY flow3_current_publication_audience_read ON knowledge_current_publication;
ALTER POLICY target_readers_current_publication_read ON knowledge_current_publication
    USING (reader_selection_id IS NOT NULL AND actor_in_reader_selection(reader_selection_id));

-- The permission check uses the same current pointer as the publication RLS.
-- Keep the existing time window, expiry and index status rules for each surface.

CREATE OR REPLACE FUNCTION eligible_ai_publications() RETURNS SETOF uuid
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
       AND (publication_expiration_date(pv.published_version_id, pv.management) IS NULL
            OR publication_expiration_date(pv.published_version_id, pv.management) >= (now() AT TIME ZONE 'UTC')::date)
       AND EXISTS (
           SELECT 1 FROM organization_membership m
             JOIN user_account u USING (user_id) JOIN organization o USING (organization_id)
            WHERE m.user_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid
              AND m.organization_id = cp.organization_id
              AND m.status = 'ACTIVE' AND u.status = 'ACTIVE' AND o.status = 'ACTIVE'
              AND actor_in_reader_selection(cp.reader_selection_id)
       );
$$;

CREATE OR REPLACE FUNCTION current_readable_document_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = arden, pg_temp AS $$
    SELECT cp.shared_draft_id
      FROM knowledge_current_publication cp
      JOIN shared_draft d
        ON d.shared_draft_id = cp.shared_draft_id
       AND d.organization_id = cp.organization_id
       AND d.status = 'ACTIVE'
      JOIN published_knowledge_version pv
        ON pv.published_version_id = cp.published_version_id
       AND pv.shared_draft_id = cp.shared_draft_id
      JOIN knowledge_base kb
        ON kb.knowledge_base_id = pv.knowledge_base_id
     WHERE cp.organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
       AND kb.organization_id = cp.organization_id
       AND cp.valid_from <= now()
       AND (cp.valid_until IS NULL OR cp.valid_until > now())
       AND pv.published_at <= now()
       AND (
           publication_expiration_date(pv.published_version_id, pv.management) IS NULL
           OR publication_expiration_date(pv.published_version_id, pv.management) >= (now() AT TIME ZONE 'UTC')::date
       )
       AND EXISTS (
           SELECT 1
             FROM organization_membership m
             JOIN user_account u USING (user_id)
             JOIN organization o USING (organization_id)
            WHERE m.user_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid
              AND m.organization_id = cp.organization_id
              AND m.status = 'ACTIVE'
              AND u.status = 'ACTIVE'
              AND o.status = 'ACTIVE'
              AND actor_in_reader_selection(cp.reader_selection_id)
       );
$$;

CREATE OR REPLACE FUNCTION actor_can_manage_relationship_source(
    p_organization_id uuid,
    p_source_document_id uuid
)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = arden, pg_temp AS $$
    SELECT p_organization_id IS NOT NULL
       AND p_source_document_id IS NOT NULL
       AND p_organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
       AND governance_actor_membership(p_organization_id) IS NOT NULL
       AND EXISTS (
           SELECT 1
             FROM knowledge_current_publication cp
             JOIN shared_draft d
               ON d.shared_draft_id = cp.shared_draft_id
              AND d.organization_id = cp.organization_id
              AND d.status = 'ACTIVE'
             JOIN published_knowledge_version pv
               ON pv.published_version_id = cp.published_version_id
              AND pv.shared_draft_id = cp.shared_draft_id
             JOIN knowledge_base kb
               ON kb.knowledge_base_id = pv.knowledge_base_id
              AND kb.organization_id = cp.organization_id
            WHERE cp.organization_id = p_organization_id
              AND cp.shared_draft_id = p_source_document_id
              AND cp.valid_from <= now()
              AND (cp.valid_until IS NULL OR cp.valid_until > now())
              AND pv.published_at <= now()
              AND (
                  d.author_membership_id = governance_actor_membership(p_organization_id)
                  OR (
                      governance_is_org_admin(governance_actor_membership(p_organization_id), p_organization_id)
                      AND actor_in_reader_selection(cp.reader_selection_id)
                  )
              )
       );
$$;
