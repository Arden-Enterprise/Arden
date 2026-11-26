SET search_path TO arden, public;

-- Decision 0031 (spec F03-SAVE): a private note keeps one open, overwritable
-- current version. Contributing it to a review draft seals that version; sealed
-- versions, and versions referenced by a review draft or a legacy submission,
-- stay immutable. Nothing is deleted here and no DELETE grant is added.

ALTER TABLE draft_version ADD COLUMN sealed_at timestamptz;

-- The current immutability trigger would reject the backfill below.
DROP TRIGGER trg_draft_version_immutable ON draft_version;

-- Keep all existing history immutable: only each live note's unreferenced
-- current version stays open.
UPDATE draft_version v
   SET sealed_at = v.created_at
  FROM draft_document d
 WHERE d.draft_id = v.draft_id
   AND (v.version_no <> d.current_version_no
        OR d.status <> 'ACTIVE'
        OR EXISTS (SELECT 1 FROM shared_draft s WHERE s.source_private_version_id = v.draft_version_id)
        OR EXISTS (SELECT 1 FROM shared_submission s WHERE s.draft_version_id = v.draft_version_id));

CREATE FUNCTION protect_private_draft_version()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = arden, pg_temp AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'draft_version is immutable: DELETE is not allowed' USING ERRCODE = '55000';
    END IF;
    IF OLD.sealed_at IS NOT NULL THEN
        RAISE EXCEPTION 'A sealed private note version is immutable' USING ERRCODE = '55000';
    END IF;
    IF (NEW.draft_version_id, NEW.draft_id, NEW.created_by_membership_id, NEW.created_at)
       IS DISTINCT FROM (OLD.draft_version_id, OLD.draft_id, OLD.created_by_membership_id, OLD.created_at) THEN
        RAISE EXCEPTION 'A private note version keeps its identity' USING ERRCODE = '55000';
    END IF;
    IF NEW.version_no < OLD.version_no THEN
        RAISE EXCEPTION 'A private note version number cannot go back' USING ERRCODE = '55000';
    END IF;
    -- A contributed version may only become sealed; its content and number never change.
    IF (NEW.sealed_at IS NOT NULL
        OR EXISTS (SELECT 1 FROM shared_draft s WHERE s.source_private_version_id = OLD.draft_version_id)
        OR EXISTS (SELECT 1 FROM shared_submission s WHERE s.draft_version_id = OLD.draft_version_id))
       AND (NEW.version_no, NEW.source_uri, NEW.mime_type, NEW.content_hash)
           IS DISTINCT FROM (OLD.version_no, OLD.source_uri, OLD.mime_type, OLD.content_hash) THEN
        RAISE EXCEPTION 'A contributed private note version is immutable' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION protect_private_draft_version() FROM PUBLIC;

CREATE TRIGGER trg_draft_version_immutable
BEFORE UPDATE OR DELETE ON draft_version
FOR EACH ROW EXECUTE FUNCTION protect_private_draft_version();

GRANT UPDATE (version_no, source_uri, mime_type, content_hash, sealed_at) ON draft_version TO arden_runtime;

CREATE INDEX ix_draft_version_source_uri ON draft_version (source_uri);

COMMENT ON COLUMN draft_version.sealed_at IS
    'Set when the version was contributed (or by migration 0065 for history); sealed versions are immutable (decision 0031)';
