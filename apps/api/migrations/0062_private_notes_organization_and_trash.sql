SET search_path TO arden, public;

-- Decision 0029: owner-private collections, favorites and a 30-day trash for
-- private notes. Permanent deletion erases content objects and keeps a
-- tombstone row, so no DELETE grant is introduced and the immutable
-- draft_version history (and shared-draft provenance) stays valid.

CREATE TABLE private_collection (
    collection_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id         uuid NOT NULL,
    parent_collection_id uuid,
    title                text NOT NULL,
    favorited_at         timestamptz,
    trashed_at           timestamptz,
    trash_batch_id       uuid,
    status               text NOT NULL DEFAULT 'ACTIVE',
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT fk_private_collection_workspace
        FOREIGN KEY (workspace_id)
        REFERENCES private_workspace (workspace_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT uq_private_collection_workspace UNIQUE (workspace_id, collection_id),
    -- The composite key keeps a parent inside the same owner's workspace.
    CONSTRAINT fk_private_collection_parent
        FOREIGN KEY (workspace_id, parent_collection_id)
        REFERENCES private_collection (workspace_id, collection_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT ck_private_collection_not_own_parent
        CHECK (parent_collection_id IS NULL OR parent_collection_id <> collection_id),
    CONSTRAINT ck_private_collection_status
        CHECK (status IN ('ACTIVE', 'PURGED')),
    CONSTRAINT ck_private_collection_trash_pair
        CHECK ((trashed_at IS NULL) = (trash_batch_id IS NULL)),
    CONSTRAINT ck_private_collection_title
        CHECK (char_length(title) <= 200
            AND (status = 'PURGED' OR char_length(btrim(title)) > 0)),
    CONSTRAINT ck_private_collection_tombstone
        CHECK (status = 'ACTIVE' OR (title = '' AND trashed_at IS NOT NULL AND favorited_at IS NULL))
);

CREATE INDEX ix_private_collection_workspace
    ON private_collection (workspace_id, status, parent_collection_id);
CREATE INDEX ix_private_collection_parent
    ON private_collection (parent_collection_id) WHERE parent_collection_id IS NOT NULL;
CREATE INDEX ix_private_collection_trash_batch
    ON private_collection (trash_batch_id) WHERE trash_batch_id IS NOT NULL;
CREATE INDEX ix_private_collection_trashed_at
    ON private_collection (trashed_at) WHERE status = 'ACTIVE' AND trashed_at IS NOT NULL;

CREATE TRIGGER trg_private_collection_updated_at
BEFORE UPDATE ON private_collection
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Defense in depth for the API's cycle check: a collection can never become
-- its own ancestor. Invoker context sees only the owner's rows, and the
-- composite parent key guarantees every ancestor is in that same workspace.
CREATE FUNCTION reject_private_collection_cycle()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = arden, pg_temp AS $$
BEGIN
    IF NEW.parent_collection_id IS NOT NULL AND EXISTS (
        WITH RECURSIVE ancestor(collection_id, depth) AS (
            SELECT NEW.parent_collection_id, 1
            UNION ALL
            SELECT c.parent_collection_id, a.depth + 1
              FROM private_collection c
              JOIN ancestor a ON a.collection_id = c.collection_id
             WHERE c.parent_collection_id IS NOT NULL AND a.depth < 10000
        )
        SELECT 1 FROM ancestor WHERE collection_id = NEW.collection_id
    ) THEN
        RAISE EXCEPTION 'A private collection cannot be moved into itself or a descendant'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION reject_private_collection_cycle() FROM PUBLIC;

CREATE TRIGGER trg_private_collection_no_cycle
BEFORE UPDATE OF parent_collection_id ON private_collection
FOR EACH ROW EXECUTE FUNCTION reject_private_collection_cycle();

ALTER TABLE draft_document ADD COLUMN collection_id uuid;
ALTER TABLE draft_document ADD COLUMN favorited_at timestamptz;
ALTER TABLE draft_document ADD COLUMN trashed_at timestamptz;
ALTER TABLE draft_document ADD COLUMN trash_batch_id uuid;
-- NULL while a purged note still has private content objects to erase.
ALTER TABLE draft_document ADD COLUMN content_purged_at timestamptz;

ALTER TABLE draft_document ADD CONSTRAINT fk_draft_document_collection
    FOREIGN KEY (workspace_id, collection_id)
    REFERENCES private_collection (workspace_id, collection_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE draft_document DROP CONSTRAINT ck_draft_document_status;
ALTER TABLE draft_document ADD CONSTRAINT ck_draft_document_status
    CHECK (status IN ('ACTIVE', 'ARCHIVED', 'PURGED'));
ALTER TABLE draft_document ADD CONSTRAINT ck_draft_document_trash_pair
    CHECK ((trashed_at IS NULL) = (trash_batch_id IS NULL));
ALTER TABLE draft_document ADD CONSTRAINT ck_draft_document_tombstone
    CHECK (status <> 'PURGED' OR (title = '' AND description IS NULL
        AND trashed_at IS NOT NULL AND favorited_at IS NULL));
ALTER TABLE draft_document ADD CONSTRAINT ck_draft_document_content_purged
    CHECK (content_purged_at IS NULL OR status = 'PURGED');

CREATE INDEX ix_draft_document_collection
    ON draft_document (collection_id) WHERE collection_id IS NOT NULL;
CREATE INDEX ix_draft_document_trash_batch
    ON draft_document (trash_batch_id) WHERE trash_batch_id IS NOT NULL;
CREATE INDEX ix_draft_document_trashed_at
    ON draft_document (trashed_at) WHERE status = 'ACTIVE' AND trashed_at IS NOT NULL;
CREATE INDEX ix_draft_document_content_pending
    ON draft_document (draft_id) WHERE status = 'PURGED' AND content_purged_at IS NULL;

ALTER TABLE private_collection ENABLE ROW LEVEL SECURITY;
ALTER TABLE private_collection FORCE ROW LEVEL SECURITY;

-- Owner-only access, mirroring draft_document_owner_access (migration 0011).
CREATE POLICY private_collection_owner_access ON private_collection FOR ALL TO arden_runtime
    USING (EXISTS (SELECT 1 FROM private_workspace w WHERE w.workspace_id = private_collection.workspace_id
        AND actor_owns_private_membership(w.membership_id)))
    WITH CHECK (EXISTS (SELECT 1 FROM private_workspace w WHERE w.workspace_id = private_collection.workspace_id
        AND actor_owns_private_membership(w.membership_id)));

-- Retention job context. The API sets arden.private_trash_retention only in
-- its in-process purge transaction, with no actor or organization. It can see
-- ids and content references of trash older than 30 days (and purged notes
-- whose content erasure is still pending), and may only turn them into
-- tombstones. It never sees active items or another owner's live notes.
-- PostgreSQL requires an updated row to stay visible through SELECT policies, so
-- the retention context may also see PURGED collection tombstones (ids and
-- timestamps only: their title is '' and they hold no content).
CREATE POLICY private_collection_retention_read ON private_collection FOR SELECT TO arden_runtime
    USING (current_setting('arden.private_trash_retention', true) = 'true'
        AND ((status = 'ACTIVE' AND trashed_at < now() - interval '30 days')
            OR status = 'PURGED'));
CREATE POLICY private_collection_retention_purge ON private_collection FOR UPDATE TO arden_runtime
    USING (current_setting('arden.private_trash_retention', true) = 'true'
        AND status = 'ACTIVE' AND trashed_at < now() - interval '30 days')
    WITH CHECK (current_setting('arden.private_trash_retention', true) = 'true'
        AND status = 'PURGED' AND title = '');

-- As for collections, updated tombstones must stay visible, so PURGED note
-- tombstones (title '' and no description) are readable here; content
-- references stay limited by draft_version_retention_read below.
CREATE POLICY draft_document_retention_read ON draft_document FOR SELECT TO arden_runtime
    USING (current_setting('arden.private_trash_retention', true) = 'true'
        AND ((status = 'ACTIVE' AND trashed_at < now() - interval '30 days')
            OR status = 'PURGED'));
CREATE POLICY draft_document_retention_purge ON draft_document FOR UPDATE TO arden_runtime
    USING (current_setting('arden.private_trash_retention', true) = 'true'
        AND ((status = 'ACTIVE' AND trashed_at < now() - interval '30 days')
            OR (status = 'PURGED' AND content_purged_at IS NULL)))
    WITH CHECK (current_setting('arden.private_trash_retention', true) = 'true'
        AND status = 'PURGED' AND title = '');

CREATE POLICY draft_version_retention_read ON draft_version FOR SELECT TO arden_runtime
    USING (current_setting('arden.private_trash_retention', true) = 'true'
        AND EXISTS (SELECT 1 FROM draft_document d WHERE d.draft_id = draft_version.draft_id
            AND ((d.status = 'ACTIVE' AND d.trashed_at < now() - interval '30 days')
                OR (d.status = 'PURGED' AND d.content_purged_at IS NULL))));

GRANT SELECT, INSERT, UPDATE ON private_collection TO arden_runtime;

COMMENT ON TABLE private_collection IS
    'Owner-private folder of private notes (decision 0029); PURGED rows are tombstones';
COMMENT ON COLUMN draft_document.content_purged_at IS
    'Set after every private content object of a PURGED note was erased';
