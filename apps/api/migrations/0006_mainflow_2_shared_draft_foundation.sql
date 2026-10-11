SET search_path TO arden, public;

-- A shared draft is a separate copy, never the member's private original or a
-- published version. Submission/review/publication wiring follows in later
-- Mainflow 2 migrations; this foundation grants no runtime access yet.
CREATE TABLE shared_draft (
    shared_draft_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL,
    author_membership_id uuid NOT NULL,
    source_private_version_id uuid,
    source_published_version_id uuid,
    title text NOT NULL,
    classification text NOT NULL,
    status text NOT NULL DEFAULT 'ACTIVE',
    current_version_no integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT fk_shared_draft_author FOREIGN KEY (author_membership_id, organization_id)
        REFERENCES organization_membership (membership_id, organization_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_shared_draft_private_source FOREIGN KEY (source_private_version_id)
        REFERENCES draft_version (draft_version_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_shared_draft_published_source FOREIGN KEY (source_published_version_id)
        REFERENCES published_knowledge_version (published_version_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT uq_shared_draft_id_org UNIQUE (shared_draft_id, organization_id),
    CONSTRAINT ck_shared_draft_one_source CHECK (
        (source_private_version_id IS NOT NULL) <> (source_published_version_id IS NOT NULL)
    ),
    CONSTRAINT ck_shared_draft_title CHECK (length(btrim(title)) > 0),
    CONSTRAINT ck_shared_draft_classification CHECK (classification IN ('INTERNAL', 'CONFIDENTIAL', 'RESTRICTED')),
    CONSTRAINT ck_shared_draft_status CHECK (status IN ('ACTIVE', 'ARCHIVED')),
    CONSTRAINT ck_shared_draft_version CHECK (current_version_no >= 0)
);

CREATE TABLE shared_draft_version (
    shared_draft_version_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    shared_draft_id uuid NOT NULL,
    version_no integer NOT NULL,
    content_uri text NOT NULL,
    mime_type text NOT NULL,
    content_hash text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT fk_shared_draft_version_draft FOREIGN KEY (shared_draft_id)
        REFERENCES shared_draft (shared_draft_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT uq_shared_draft_version_number UNIQUE (shared_draft_id, version_no),
    CONSTRAINT ck_shared_draft_version_number CHECK (version_no > 0),
    CONSTRAINT ck_shared_draft_version_uri CHECK (length(btrim(content_uri)) > 0),
    CONSTRAINT ck_shared_draft_version_hash CHECK (content_hash ~ '^[0-9a-f]{64}$')
);

CREATE TABLE shared_draft_audience (
    shared_draft_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    role_id uuid NOT NULL,
    CONSTRAINT pk_shared_draft_audience PRIMARY KEY (shared_draft_id, role_id),
    CONSTRAINT fk_shared_draft_audience_draft FOREIGN KEY (shared_draft_id, organization_id)
        REFERENCES shared_draft (shared_draft_id, organization_id) ON UPDATE RESTRICT ON DELETE CASCADE,
    CONSTRAINT fk_shared_draft_audience_role FOREIGN KEY (role_id)
        REFERENCES role (role_id) ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE INDEX ix_shared_draft_author ON shared_draft (author_membership_id, status, updated_at DESC);
CREATE INDEX ix_shared_draft_audience_role ON shared_draft_audience (role_id);

CREATE FUNCTION validate_shared_draft_source()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = arden, pg_temp AS $$
DECLARE
    source_org uuid;
    source_owner uuid;
BEGIN
    IF NEW.source_private_version_id IS NOT NULL THEN
        SELECT om.organization_id, om.membership_id INTO source_org, source_owner
          FROM draft_version v
          JOIN draft_document d ON d.draft_id = v.draft_id
          JOIN private_workspace w ON w.workspace_id = d.workspace_id
          JOIN organization_membership om ON om.membership_id = w.membership_id
         WHERE v.draft_version_id = NEW.source_private_version_id;
        IF source_org IS DISTINCT FROM NEW.organization_id OR source_owner IS DISTINCT FROM NEW.author_membership_id THEN
            RAISE EXCEPTION 'Shared draft private source must belong to the author and organization'
                USING ERRCODE = '23514';
        END IF;
    ELSE
        SELECT kb.organization_id INTO source_org
          FROM published_knowledge_version pv
          JOIN knowledge_base kb ON kb.knowledge_base_id = pv.knowledge_base_id
         WHERE pv.published_version_id = NEW.source_published_version_id;
        IF source_org IS DISTINCT FROM NEW.organization_id THEN
            RAISE EXCEPTION 'Shared draft published source must belong to the organization'
                USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION validate_shared_draft_source() FROM PUBLIC;

CREATE TRIGGER trg_validate_shared_draft_source
BEFORE INSERT OR UPDATE OF organization_id, author_membership_id, source_private_version_id, source_published_version_id
ON shared_draft FOR EACH ROW EXECUTE FUNCTION validate_shared_draft_source();

CREATE FUNCTION validate_shared_draft_audience()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = arden, pg_temp AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM role r WHERE r.role_id = NEW.role_id
          AND r.organization_id = NEW.organization_id
          AND r.is_system = false AND r.status = 'ACTIVE'
    ) THEN
        RAISE EXCEPTION 'Shared draft audience must be an active custom role in the organization'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION validate_shared_draft_audience() FROM PUBLIC;

CREATE TRIGGER trg_validate_shared_draft_audience
BEFORE INSERT OR UPDATE ON shared_draft_audience
FOR EACH ROW EXECUTE FUNCTION validate_shared_draft_audience();

CREATE TRIGGER trg_shared_draft_updated_at BEFORE UPDATE ON shared_draft
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_shared_draft_version_immutable BEFORE UPDATE OR DELETE ON shared_draft_version
FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();

CREATE FUNCTION advance_shared_draft_current_version()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    UPDATE shared_draft SET current_version_no = NEW.version_no
     WHERE shared_draft_id = NEW.shared_draft_id AND current_version_no = NEW.version_no - 1;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Shared draft version must advance by exactly one'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_advance_shared_draft_current_version AFTER INSERT ON shared_draft_version
FOR EACH ROW EXECUTE FUNCTION advance_shared_draft_current_version();

ALTER TABLE shared_draft ENABLE ROW LEVEL SECURITY;
ALTER TABLE shared_draft_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE shared_draft_audience ENABLE ROW LEVEL SECURITY;
ALTER TABLE shared_draft FORCE ROW LEVEL SECURITY;
ALTER TABLE shared_draft_version FORCE ROW LEVEL SECURITY;
ALTER TABLE shared_draft_audience FORCE ROW LEVEL SECURITY;

COMMENT ON TABLE shared_draft IS 'Explicit author-owned copy for Mainflow 2; private or published source remains immutable';
COMMENT ON TABLE shared_draft_version IS 'Immutable content snapshot of a shared draft; not yet a reviewed submission';
COMMENT ON TABLE shared_draft_audience IS 'Proposed custom-role audience; submission must freeze and validate it separately';
