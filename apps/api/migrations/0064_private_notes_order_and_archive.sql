SET search_path TO arden, public;

-- Spec F03-ARR (refines decision 0029): owner-chosen order of private notes
-- inside a collection (or the workspace root) and an Archive that hides a note
-- from the tree, favorites and lists without deleting it.

-- NULL means "not placed yet": such notes sort first, newest first. A reorder
-- renumbers every note of the affected container from 1.
ALTER TABLE draft_document ADD COLUMN sort_position integer;
ALTER TABLE draft_document ADD COLUMN archived_at timestamptz;

ALTER TABLE draft_document ADD CONSTRAINT ck_draft_document_sort_position
    CHECK (sort_position IS NULL OR sort_position >= 0);
-- An archived note is a live, untrashed note; moving it to trash clears the flag.
ALTER TABLE draft_document ADD CONSTRAINT ck_draft_document_archive_state
    CHECK (archived_at IS NULL OR (status = 'ACTIVE' AND trashed_at IS NULL));

CREATE INDEX ix_draft_document_archived
    ON draft_document (workspace_id, archived_at DESC) WHERE archived_at IS NOT NULL;

-- Placement (collection and position) and archiving are organization, not
-- content: they must not move the note's last-saved time, which the UI shows
-- as "Saved" and the Archived view sorts by. Every other update keeps the
-- previous behaviour.
DROP TRIGGER trg_draft_document_updated_at ON draft_document;
CREATE TRIGGER trg_draft_document_updated_at
BEFORE UPDATE ON draft_document
FOR EACH ROW
WHEN (OLD.sort_position IS NOT DISTINCT FROM NEW.sort_position
      AND OLD.collection_id IS NOT DISTINCT FROM NEW.collection_id
      AND OLD.archived_at IS NOT DISTINCT FROM NEW.archived_at)
EXECUTE FUNCTION set_updated_at();

COMMENT ON COLUMN draft_document.sort_position IS
    'Owner-chosen order inside the note''s collection or the root (spec F03-ARR); NULL sorts first';
COMMENT ON COLUMN draft_document.archived_at IS
    'Set while the owner has archived the note; archived notes are hidden from the private tree and lists';
