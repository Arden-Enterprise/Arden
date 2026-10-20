SET search_path TO arden, public;

-- A shared copy keeps its origin and tenant identity for its entire lifetime.
-- Metadata and proposed audience may change while drafting, but changing the
-- source requires a new shared draft and a fresh review cycle.
CREATE FUNCTION protect_shared_draft_provenance()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
       OR NEW.author_membership_id IS DISTINCT FROM OLD.author_membership_id
       OR NEW.source_private_version_id IS DISTINCT FROM OLD.source_private_version_id
       OR NEW.source_published_version_id IS DISTINCT FROM OLD.source_published_version_id THEN
        RAISE EXCEPTION 'Shared draft provenance is immutable'
            USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_protect_shared_draft_provenance
BEFORE UPDATE ON shared_draft
FOR EACH ROW EXECUTE FUNCTION protect_shared_draft_provenance();
