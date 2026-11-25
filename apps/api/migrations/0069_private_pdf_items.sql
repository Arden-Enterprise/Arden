SET search_path TO arden, public;

-- Decision 0034 (spec F03-FILE): a private item may keep an original PDF.
-- A PDF item is a draft_document whose live version has mime_type
-- application/pdf; its extracted text, when the PDF has any, is a separate
-- private text object used by the owner's private AI side panel. Owner-only
-- access, decision 0031 live-version saving and the decision 0029 trash and
-- tombstone rules are unchanged. Nothing is deleted and no DELETE grant is added.

ALTER TABLE draft_version
    ADD COLUMN text_source_uri   text,
    ADD COLUMN text_content_hash text,
    ADD CONSTRAINT ck_draft_version_text_pair
        CHECK ((text_source_uri IS NULL) = (text_content_hash IS NULL)),
    ADD CONSTRAINT ck_draft_version_text_pdf_only
        CHECK (text_source_uri IS NULL OR mime_type = 'application/pdf'),
    ADD CONSTRAINT ck_draft_version_text_hash
        CHECK (text_content_hash IS NULL OR text_content_hash ~ '^[0-9a-f]{64}$');

-- Same rules as migration 0065; the extracted text of a sealed or contributed
-- version is immutable together with its file.
CREATE OR REPLACE FUNCTION protect_private_draft_version()
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
       AND (NEW.version_no, NEW.source_uri, NEW.mime_type, NEW.content_hash, NEW.text_source_uri, NEW.text_content_hash)
           IS DISTINCT FROM (OLD.version_no, OLD.source_uri, OLD.mime_type, OLD.content_hash, OLD.text_source_uri, OLD.text_content_hash) THEN
        RAISE EXCEPTION 'A contributed private note version is immutable' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION protect_private_draft_version() FROM PUBLIC;

GRANT UPDATE (text_source_uri, text_content_hash) ON draft_version TO arden_runtime;

CREATE INDEX ix_draft_version_text_source_uri ON draft_version (text_source_uri) WHERE text_source_uri IS NOT NULL;

COMMENT ON COLUMN draft_version.text_source_uri IS
    'Private text object extracted from a PDF version (decision 0034); null for text notes and PDFs without text';
