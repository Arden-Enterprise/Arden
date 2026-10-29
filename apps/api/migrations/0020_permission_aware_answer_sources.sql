SET search_path TO arden, public;

-- The API may reveal a READY generation identifier only when the same actor
-- can still read the exact active publication protected by publication RLS.
-- Arden-AI receives these identifiers as a narrowing allow-list; Chroma never
-- decides authorization.
GRANT SELECT ON knowledge_index_generation TO arden_runtime;

CREATE POLICY flow3_generation_authorized_publication_read
ON knowledge_index_generation FOR SELECT TO arden_runtime
USING (
    status = 'READY'
    AND organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
    AND EXISTS (
        SELECT 1
          FROM published_knowledge_version pv
          JOIN knowledge_current_publication cp
            ON cp.published_version_id = pv.published_version_id
         WHERE pv.submission_id = knowledge_index_generation.submission_id
           AND pv.shared_draft_id = knowledge_index_generation.shared_draft_id
           AND pv.content_hash = knowledge_index_generation.snapshot_content_hash
           AND cp.organization_id = knowledge_index_generation.organization_id
    )
);
