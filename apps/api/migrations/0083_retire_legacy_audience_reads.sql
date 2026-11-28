SET search_path TO arden, public;

LOCK TABLE shared_draft, shared_draft_audience, audience, shared_submission,
    published_knowledge_version, knowledge_current_publication
    IN ACCESS EXCLUSIVE MODE;

-- The original Organization audience means the whole active organization.
-- Recover that intent only when it was the sole active audience of the same
-- organization. Leave existing proposals, approvals and live pointers intact.
-- A historical version is eligible only when it carries that same frozen scope.
CREATE TEMP TABLE legacy_organization_readers ON COMMIT DROP AS
WITH organization_audiences AS (
    SELECT a.audience_id, a.organization_id
      FROM audience a JOIN organization o USING (organization_id)
     WHERE a.kind = 'ORGANIZATION_ALL' AND a.status = 'ACTIVE'
       AND a.department_id IS NULL AND o.status = 'ACTIVE'
), targets AS (
    SELECT 'draft' AS subject, d.shared_draft_id AS subject_id, d.organization_id
      FROM shared_draft d
      JOIN shared_draft_audience da USING (shared_draft_id, organization_id)
      JOIN organization_audiences a ON a.audience_id = da.role_id AND a.organization_id = d.organization_id
     WHERE d.draft_selection_id IS NULL AND d.target_scope_type = 'ORGANIZATION'
       AND NOT EXISTS (SELECT 1 FROM shared_draft_audience other
            WHERE other.shared_draft_id = d.shared_draft_id AND other.role_id <> da.role_id)
    UNION ALL
    SELECT 'submission', s.submission_id, s.organization_id
      FROM shared_submission s
      JOIN organization_audiences a ON s.audience_role_ids = ARRAY[a.audience_id]
                                    AND a.organization_id = s.organization_id
     WHERE s.shared_draft_version_id IS NOT NULL AND s.request_type = 'CONTENT'
       AND s.proposed_selection_id IS NULL AND s.target_scope_type = 'ORGANIZATION' AND s.target_department_id IS NULL
    UNION ALL
    SELECT 'historical_version', pv.published_version_id, s.organization_id
      FROM published_knowledge_version pv JOIN shared_submission s USING (submission_id)
      JOIN knowledge_base kb ON kb.knowledge_base_id = pv.knowledge_base_id AND kb.organization_id = s.organization_id
      JOIN organization_audiences a ON pv.audience_role_ids = ARRAY[a.audience_id]
                                    AND a.organization_id = s.organization_id
     WHERE pv.reader_selection_id IS NULL AND pv.shared_draft_id = s.shared_draft_id
       AND s.status = 'APPROVED' AND s.request_type = 'CONTENT' AND s.approved_selection_id IS NULL
       AND s.target_scope_type = 'ORGANIZATION' AND s.target_department_id IS NULL
       AND pv.audience_role_ids = s.audience_role_ids
       AND NOT EXISTS (SELECT 1 FROM knowledge_current_publication cp
            WHERE cp.published_version_id = pv.published_version_id)
)
SELECT *, gen_random_uuid() AS selection_id FROM targets;

SET CONSTRAINTS trg_check_reader_selection_size IMMEDIATE;
INSERT INTO reader_selection (selection_id, organization_id, reader_mode)
SELECT selection_id, organization_id, 'ORGANIZATION' FROM legacy_organization_readers;
SET CONSTRAINTS trg_check_reader_selection_size DEFERRED;

ALTER TABLE shared_draft DISABLE TRIGGER trg_shared_draft_updated_at;
UPDATE shared_draft d SET draft_selection_id = r.selection_id
  FROM legacy_organization_readers r
 WHERE r.subject = 'draft' AND r.subject_id = d.shared_draft_id AND d.draft_selection_id IS NULL;
ALTER TABLE shared_draft ENABLE TRIGGER trg_shared_draft_updated_at;

ALTER TABLE shared_submission DISABLE TRIGGER trg_protect_flow2_submission_snapshot;
UPDATE shared_submission s SET proposed_selection_id = r.selection_id
  FROM legacy_organization_readers r
 WHERE r.subject = 'submission' AND r.subject_id = s.submission_id AND s.proposed_selection_id IS NULL;
ALTER TABLE shared_submission ENABLE TRIGGER trg_protect_flow2_submission_snapshot;

-- These versions are historical. Their reader metadata has no bearing on the
-- current Handbook placement or on activation of the live document.
ALTER TABLE published_knowledge_version DISABLE TRIGGER trg_reconcile_collection_readers;
UPDATE published_knowledge_version pv SET reader_selection_id = r.selection_id
  FROM legacy_organization_readers r
 WHERE r.subject = 'historical_version' AND r.subject_id = pv.published_version_id AND pv.reader_selection_id IS NULL;
ALTER TABLE published_knowledge_version ENABLE TRIGGER trg_reconcile_collection_readers;

-- Refuse the switch if a live publication still needs legacy rights or a
-- review cannot use an approved reader policy.
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
