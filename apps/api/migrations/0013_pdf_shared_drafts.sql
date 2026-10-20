SET search_path TO arden, public;

-- A reviewed PDF remains the exact uploaded object; only the allowed snapshot
-- MIME types change. The rest of the frozen submission contract is unchanged.
ALTER TABLE shared_submission DROP CONSTRAINT ck_shared_submission_flow2_snapshot;
ALTER TABLE shared_submission ADD CONSTRAINT ck_shared_submission_flow2_snapshot
    CHECK (shared_draft_version_id IS NULL OR (
        organization_id IS NOT NULL AND shared_draft_id IS NOT NULL
        AND snapshot_version_no IS NOT NULL AND snapshot_version_no > 0
        AND responsible_department_id IS NOT NULL
        AND title IS NOT NULL AND length(btrim(title)) > 0
        AND classification IS NOT NULL AND classification IN ('INTERNAL', 'CONFIDENTIAL', 'RESTRICTED')
        AND policy_version IS NOT NULL AND policy_version = 1
        AND content_uri IS NOT NULL AND mime_type IN ('text/plain', 'application/pdf')
        AND content_hash IS NOT NULL AND content_hash ~ '^[0-9a-f]{64}$'
        AND submit_request_id IS NOT NULL AND audience_role_ids IS NOT NULL
        AND cardinality(audience_role_ids) BETWEEN 1 AND 100));
