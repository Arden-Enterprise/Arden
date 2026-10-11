SET search_path TO arden, public;

-- Group 1 initially permits only an author-owned private-version copy. Published
-- sources and proposed audiences stay inaccessible until their read policies exist.
ALTER TABLE shared_draft ADD COLUMN create_request_id uuid;
ALTER TABLE shared_draft ADD COLUMN create_request_hash text;
ALTER TABLE shared_draft ADD CONSTRAINT ck_shared_draft_create_request
    CHECK ((create_request_id IS NULL AND create_request_hash IS NULL)
        OR (create_request_id IS NOT NULL AND create_request_hash ~ '^[0-9a-f]{64}$'));
CREATE UNIQUE INDEX uq_shared_draft_author_create_request
    ON shared_draft (author_membership_id, create_request_id)
    WHERE create_request_id IS NOT NULL;

GRANT SELECT, INSERT ON shared_draft TO arden_runtime;
-- Only the version-insert trigger needs to advance this parent pointer. Later
-- authoring endpoints must grant their own narrowly scoped write columns.
GRANT UPDATE (current_version_no) ON shared_draft TO arden_runtime;
GRANT SELECT, INSERT ON shared_draft_version TO arden_runtime;

CREATE POLICY shared_draft_author_read ON shared_draft FOR SELECT TO arden_runtime
    USING (source_private_version_id IS NOT NULL AND source_published_version_id IS NULL
        AND organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
        AND EXISTS (
            SELECT 1 FROM organization_membership om
            JOIN user_account ua ON ua.user_id = om.user_id AND ua.status = 'ACTIVE'
            JOIN organization o ON o.organization_id = om.organization_id AND o.status = 'ACTIVE'
            WHERE om.membership_id = shared_draft.author_membership_id
              AND om.organization_id = shared_draft.organization_id
              AND om.user_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid
              AND om.status = 'ACTIVE'
        ));

CREATE POLICY shared_draft_author_insert ON shared_draft FOR INSERT TO arden_runtime
    WITH CHECK (source_private_version_id IS NOT NULL AND source_published_version_id IS NULL
        AND organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
        AND EXISTS (
            SELECT 1 FROM organization_membership om
            JOIN user_account ua ON ua.user_id = om.user_id AND ua.status = 'ACTIVE'
            JOIN organization o ON o.organization_id = om.organization_id AND o.status = 'ACTIVE'
            WHERE om.membership_id = shared_draft.author_membership_id
              AND om.organization_id = shared_draft.organization_id
              AND om.user_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid
              AND om.status = 'ACTIVE'
        ));

-- The version-insert trigger advances current_version_no on its parent row.
CREATE POLICY shared_draft_author_update ON shared_draft FOR UPDATE TO arden_runtime
    USING (status = 'ACTIVE' AND source_private_version_id IS NOT NULL
        AND source_published_version_id IS NULL
        AND organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
        AND EXISTS (
            SELECT 1 FROM organization_membership om
            JOIN user_account ua ON ua.user_id = om.user_id AND ua.status = 'ACTIVE'
            JOIN organization o ON o.organization_id = om.organization_id AND o.status = 'ACTIVE'
            WHERE om.membership_id = shared_draft.author_membership_id
              AND om.organization_id = shared_draft.organization_id
              AND om.user_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid
              AND om.status = 'ACTIVE'
        ))
    WITH CHECK (source_private_version_id IS NOT NULL AND source_published_version_id IS NULL
        AND organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
        AND EXISTS (
            SELECT 1 FROM organization_membership om
            JOIN user_account ua ON ua.user_id = om.user_id AND ua.status = 'ACTIVE'
            JOIN organization o ON o.organization_id = om.organization_id AND o.status = 'ACTIVE'
            WHERE om.membership_id = shared_draft.author_membership_id
              AND om.organization_id = shared_draft.organization_id
              AND om.user_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid
              AND om.status = 'ACTIVE'
        ));

CREATE POLICY shared_draft_version_author_read ON shared_draft_version FOR SELECT TO arden_runtime
    USING (EXISTS (
        SELECT 1 FROM shared_draft d
        WHERE d.shared_draft_id = shared_draft_version.shared_draft_id
    ));

CREATE POLICY shared_draft_version_author_insert ON shared_draft_version FOR INSERT TO arden_runtime
    WITH CHECK (EXISTS (
        SELECT 1 FROM shared_draft d
        WHERE d.shared_draft_id = shared_draft_version.shared_draft_id
          AND d.status = 'ACTIVE'
          AND d.current_version_no = 0
          AND shared_draft_version.version_no = 1
    ));
