SET search_path TO arden, public;

-- Operator rollout: adds a narrow trusted trigger validator. Existing numbered
-- SQL, frozen metadata and exact-publication legacy links are not rewritten.
CREATE FUNCTION valid_collection_types(p_types text[]) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = arden, pg_temp AS $$
    SELECT CASE WHEN p_types IS NULL OR COALESCE(array_ndims(p_types), 0) <> 1 THEN false ELSE
       cardinality(p_types) BETWEEN 1 AND 5
       AND p_types <@ ARRAY['Policy & Standard', 'Procedure', 'Guide', 'Reference', 'Lessons Learned']::text[]
       AND array_position(p_types, NULL) IS NULL
       AND cardinality(p_types) = (SELECT count(DISTINCT value) FROM unnest(p_types) AS allowed(value)) END
$$;
REVOKE ALL ON FUNCTION valid_collection_types(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION valid_collection_types(text[]) TO arden_runtime;

-- NULL marks an unconfigured legacy collection, never "all types". New API
-- writes must require explicit types; legacy conversion needs reviewed mapping.
ALTER TABLE knowledge_collection ADD COLUMN allowed_types text[];
ALTER TABLE knowledge_collection ADD CONSTRAINT ck_collection_allowed_types
    CHECK (allowed_types IS NULL OR valid_collection_types(allowed_types));

-- Placement follows the existing logical contribution identity, not a PDF
-- revision. A null folder is a retained Unassigned tombstone for optimistic
-- moves, so remove/re-add cannot reset its revision (ABA).
CREATE TABLE knowledge_collection_placement (
    shared_draft_id uuid PRIMARY KEY,
    organization_id uuid NOT NULL,
    collection_id uuid,
    placement_revision bigint NOT NULL DEFAULT 1 CHECK (placement_revision > 0),
    updated_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (shared_draft_id, organization_id)
        REFERENCES shared_draft(shared_draft_id, organization_id),
    FOREIGN KEY (collection_id, organization_id)
        REFERENCES knowledge_collection(collection_id, organization_id)
);
CREATE INDEX ix_collection_placement_folder ON knowledge_collection_placement(collection_id)
    WHERE collection_id IS NOT NULL;

CREATE FUNCTION collection_source_eligible(p_organization_id uuid, p_document_id uuid, p_collection_id uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path = arden, pg_temp AS $$
    SELECT EXISTS (
        SELECT 1 FROM knowledge_current_publication cp
        JOIN published_knowledge_version pv ON pv.published_version_id = cp.published_version_id
        JOIN reader_selection readers ON readers.selection_id = pv.reader_selection_id
        LEFT JOIN knowledge_collection c ON c.collection_id = p_collection_id AND c.organization_id = cp.organization_id
        WHERE cp.organization_id = p_organization_id AND cp.shared_draft_id = p_document_id
          AND cp.valid_from <= now() AND (cp.valid_until IS NULL OR cp.valid_until > now())
          AND readers.reader_mode = 'ORGANIZATION'
          AND (p_collection_id IS NULL OR (c.status = 'ACTIVE'
              AND pv.management->>'type' = ANY(c.allowed_types))))
$$;
REVOKE ALL ON FUNCTION collection_source_eligible(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION collection_source_eligible(uuid, uuid, uuid) TO arden_runtime;

ALTER TABLE knowledge_collection_placement ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_collection_placement FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON knowledge_collection_placement TO arden_runtime;
CREATE POLICY placement_member_read ON knowledge_collection_placement FOR SELECT TO arden_runtime USING (
    organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM organization_membership om JOIN user_account ua USING(user_id)
        JOIN organization o USING(organization_id)
        WHERE om.user_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid
          AND om.organization_id = knowledge_collection_placement.organization_id
          AND om.status = 'ACTIVE' AND ua.status = 'ACTIVE' AND o.status = 'ACTIVE')
    AND collection_source_eligible(organization_id, shared_draft_id, collection_id));
CREATE POLICY placement_admin_write ON knowledge_collection_placement FOR ALL TO arden_runtime
USING (
    organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
    AND current_setting('arden.org_admin', true) = 'true'
    AND EXISTS (SELECT 1 FROM organization_membership om JOIN user_account ua USING(user_id)
        JOIN organization o USING(organization_id)
        WHERE om.user_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid
          AND om.organization_id = knowledge_collection_placement.organization_id
          AND om.status = 'ACTIVE' AND ua.status = 'ACTIVE' AND o.status = 'ACTIVE'))
WITH CHECK (
    organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
    AND current_setting('arden.org_admin', true) = 'true'
    AND EXISTS (SELECT 1 FROM organization_membership om JOIN user_account ua USING(user_id)
        JOIN organization o USING(organization_id)
        WHERE om.user_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid
          AND om.organization_id = knowledge_collection_placement.organization_id
          AND om.status = 'ACTIVE' AND ua.status = 'ACTIVE' AND o.status = 'ACTIVE'));

-- Trusted only to lock the current pointer without granting runtime UPDATE on
-- publication tables. No runtime/PUBLIC EXECUTE and no content-returning surface.
CREATE FUNCTION validate_collection_placement() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = arden, pg_temp AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.shared_draft_id <> OLD.shared_draft_id OR NEW.organization_id <> OLD.organization_id THEN
            RAISE EXCEPTION 'Placement identity is immutable' USING ERRCODE = '55000';
        END IF;
        NEW.placement_revision := OLD.placement_revision + 1;
    ELSE
        NEW.placement_revision := 1;
    END IF;
    NEW.updated_at := now();
    IF NEW.collection_id IS NOT NULL THEN
        -- Locks serialize eligibility with folder edits/Archive and activation.
        PERFORM 1 FROM knowledge_collection WHERE collection_id = NEW.collection_id
          AND organization_id = NEW.organization_id FOR SHARE;
        PERFORM 1 FROM knowledge_current_publication WHERE shared_draft_id = NEW.shared_draft_id
          AND organization_id = NEW.organization_id FOR SHARE;
        IF NOT collection_source_eligible(NEW.organization_id, NEW.shared_draft_id, NEW.collection_id) THEN
            RAISE EXCEPTION 'Document is not eligible for this collection' USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION validate_collection_placement() FROM PUBLIC;
CREATE TRIGGER trg_validate_collection_placement BEFORE INSERT OR UPDATE ON knowledge_collection_placement
FOR EACH ROW EXECUTE FUNCTION validate_collection_placement();

-- Invoker execution: normal Admin operations retain runtime RLS; trusted worker
-- activation/governance callers keep their existing reviewed execution context.
CREATE FUNCTION reconcile_collection_placement() RETURNS trigger
LANGUAGE plpgsql SET search_path = arden, pg_temp AS $$
DECLARE document_id uuid;
BEGIN
    IF TG_TABLE_NAME = 'knowledge_collection' THEN
        UPDATE knowledge_collection_placement p SET collection_id = NULL
          WHERE p.collection_id = NEW.collection_id
            AND NOT collection_source_eligible(p.organization_id, p.shared_draft_id, p.collection_id);
    ELSE
        document_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.shared_draft_id ELSE NEW.shared_draft_id END;
        UPDATE knowledge_collection_placement p SET collection_id = NULL
          WHERE p.shared_draft_id = document_id AND p.collection_id IS NOT NULL
            AND NOT collection_source_eligible(p.organization_id, p.shared_draft_id, p.collection_id);
    END IF;
    RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION reconcile_collection_placement() FROM PUBLIC;
CREATE TRIGGER trg_reconcile_collection_config AFTER UPDATE OF status, allowed_types ON knowledge_collection
FOR EACH ROW EXECUTE FUNCTION reconcile_collection_placement();
CREATE TRIGGER trg_reconcile_collection_current AFTER INSERT OR UPDATE OR DELETE ON knowledge_current_publication
FOR EACH ROW EXECUTE FUNCTION reconcile_collection_placement();
CREATE TRIGGER trg_reconcile_collection_readers AFTER UPDATE OF reader_selection_id ON published_knowledge_version
FOR EACH ROW EXECUTE FUNCTION reconcile_collection_placement();

-- Intentionally no backfill: legacy multi-link/exact-version associations remain
-- intact. Deployment must inventory and explicitly resolve their destination.
