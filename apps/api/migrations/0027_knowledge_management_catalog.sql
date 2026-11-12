SET search_path TO arden, public;

-- Additive KM-v1 catalog. Catalogs describe navigation, never reader entitlement.
-- No existing snapshot is rewritten and no trusted function owner is changed.
CREATE TABLE knowledge_topic (
    topic_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organization(organization_id),
    name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
    description text NOT NULL DEFAULT '' CHECK (length(description) <= 300),
    status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
    configuration_version integer NOT NULL DEFAULT 1 CHECK (configuration_version > 0),
    UNIQUE (topic_id, organization_id)
);
CREATE UNIQUE INDEX uq_knowledge_topic_name ON knowledge_topic (organization_id, lower(btrim(name)));

CREATE TABLE knowledge_collection (
    collection_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organization(organization_id),
    name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
    description text NOT NULL DEFAULT '' CHECK (length(description) <= 300),
    cover text NOT NULL DEFAULT 'handbook' CHECK (cover IN ('handbook', 'production')),
    status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
    configuration_version integer NOT NULL DEFAULT 1 CHECK (configuration_version > 0),
    UNIQUE (collection_id, organization_id)
);
CREATE UNIQUE INDEX uq_knowledge_collection_name ON knowledge_collection (organization_id, lower(btrim(name)));

-- Pin curation to an exact publication: replacement content is never silently
-- included without being read/curated again. Retired sources disappear in discovery.
CREATE TABLE knowledge_collection_document (
    collection_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    published_version_id uuid NOT NULL REFERENCES published_knowledge_version(published_version_id),
    ordinal integer NOT NULL CHECK (ordinal BETWEEN 0 AND 199),
    PRIMARY KEY (collection_id, published_version_id),
    UNIQUE (collection_id, ordinal),
    FOREIGN KEY (collection_id, organization_id) REFERENCES knowledge_collection(collection_id, organization_id)
);

DO $$
DECLARE table_name text;
BEGIN
    FOREACH table_name IN ARRAY ARRAY['knowledge_topic', 'knowledge_collection', 'knowledge_collection_document'] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO arden_runtime', table_name);
        EXECUTE format($policy$
            CREATE POLICY catalog_member_read ON %I FOR SELECT TO arden_runtime USING (
                organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
                AND EXISTS (SELECT 1 FROM organization_membership om
                    JOIN user_account ua ON ua.user_id = om.user_id AND ua.status = 'ACTIVE'
                    JOIN organization o ON o.organization_id = om.organization_id AND o.status = 'ACTIVE'
                    WHERE om.organization_id = %I.organization_id AND om.status = 'ACTIVE'
                    AND om.user_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid))
        $policy$, table_name, table_name);
        EXECUTE format($policy$
            CREATE POLICY catalog_admin_write ON %I FOR ALL TO arden_runtime
            USING (organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
                AND current_setting('arden.org_admin', true) = 'true')
            WITH CHECK (organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
                AND current_setting('arden.org_admin', true) = 'true')
        $policy$, table_name);
    END LOOP;
END;
$$;

ALTER TABLE shared_draft ADD COLUMN document_code text NOT NULL
    DEFAULT ('ARD-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 16)));
CREATE UNIQUE INDEX uq_shared_draft_document_code ON shared_draft (organization_id, document_code);
ALTER TABLE shared_draft ADD COLUMN management jsonb;
ALTER TABLE shared_draft ADD COLUMN management_topic_id uuid
    GENERATED ALWAYS AS ((management->>'topicId')::uuid) STORED;
ALTER TABLE shared_draft ADD CONSTRAINT fk_draft_management_topic
    FOREIGN KEY (management_topic_id, organization_id) REFERENCES knowledge_topic(topic_id, organization_id);
ALTER TABLE shared_draft ADD CONSTRAINT ck_draft_management_object
    CHECK (management IS NULL OR jsonb_typeof(management) = 'object');
GRANT UPDATE (management) ON shared_draft TO arden_runtime;

ALTER TABLE shared_submission ADD COLUMN document_code text;
ALTER TABLE shared_submission ADD COLUMN management jsonb;
ALTER TABLE published_knowledge_version ADD COLUMN document_code text;
ALTER TABLE published_knowledge_version ADD COLUMN management jsonb;

-- SECURITY INVOKER: called in the existing runtime/trusted activation context.
-- Freeze display metadata at submit; catalog renaming cannot rewrite history.
CREATE FUNCTION freeze_knowledge_management() RETURNS trigger
LANGUAGE plpgsql SET search_path = arden, pg_temp AS $$
DECLARE source record;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF OLD.document_code IS DISTINCT FROM NEW.document_code
           OR (TG_TABLE_NAME <> 'shared_draft' AND OLD.management IS DISTINCT FROM NEW.management) THEN
            RAISE EXCEPTION 'Document identity and snapshot metadata are immutable' USING ERRCODE = '55000';
        END IF;
        RETURN NEW;
    END IF;
    IF TG_TABLE_NAME = 'shared_submission' THEN
        SELECT d.document_code, CASE WHEN d.management IS NULL THEN NULL ELSE
            d.management || jsonb_build_object('topicName', topic.name) END AS management
            INTO STRICT source FROM shared_draft d
            LEFT JOIN knowledge_topic topic ON topic.topic_id = d.management_topic_id
                AND topic.organization_id = d.organization_id
            WHERE d.shared_draft_id = NEW.shared_draft_id AND d.organization_id = NEW.organization_id;
    ELSE
        SELECT s.document_code, s.management INTO STRICT source FROM shared_submission s
            WHERE s.submission_id = NEW.submission_id;
    END IF;
    NEW.document_code := source.document_code;
    NEW.management := source.management;
    IF TG_TABLE_NAME = 'shared_submission' AND NEW.management IS NOT NULL THEN
        NEW.management := NEW.management || jsonb_build_object('releaseKind', CASE WHEN EXISTS (
            SELECT 1 FROM shared_submission prior WHERE prior.shared_draft_id = NEW.shared_draft_id
              AND prior.publication_state IN ('ACTIVE', 'SUPERSEDED')) THEN 'UPDATED' ELSE 'NEW' END);
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION freeze_knowledge_management() FROM PUBLIC;
CREATE TRIGGER trg_freeze_draft_identity BEFORE UPDATE ON shared_draft
FOR EACH ROW EXECUTE FUNCTION freeze_knowledge_management();

-- Minimal active-member name lookup for explicit Target Readers. It cannot read
-- private notes, email addresses, arbitrary organizations or inactive identities.
-- This reviewed new SECURITY DEFINER routine requires operator rollout.
CREATE FUNCTION knowledge_reader_directory(p_query text, p_ids uuid[] DEFAULT '{}')
RETURNS TABLE (membership_id uuid, display_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = arden, pg_temp AS $$
    SELECT om.membership_id, COALESCE(NULLIF(btrim(ua.full_name), ''), 'Member')
    FROM organization_membership om JOIN user_account ua USING (user_id)
    JOIN organization o USING (organization_id)
    WHERE om.organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
      AND om.status = 'ACTIVE' AND ua.status = 'ACTIVE' AND o.status = 'ACTIVE'
      AND cardinality(p_ids) <= 100 AND length(p_query) <= 80
      AND EXISTS (SELECT 1 FROM organization_membership actor JOIN user_account account ON account.user_id = actor.user_id
        WHERE actor.organization_id = om.organization_id AND actor.status = 'ACTIVE' AND account.status = 'ACTIVE'
          AND actor.user_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid)
      AND (om.membership_id = ANY(p_ids) OR (length(btrim(p_query)) >= 2
        AND strpos(lower(COALESCE(ua.full_name, '')), lower(btrim(p_query))) > 0))
    ORDER BY 2, 1 LIMIT 100;
$$;
REVOKE ALL ON FUNCTION knowledge_reader_directory(text, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION knowledge_reader_directory(text, uuid[]) TO arden_runtime;

-- New explicit selections are the entitlement; legacy audience membership must
-- not veto a selected reader in another department. This is pointer-only (no
-- pointer -> publication -> pointer recursion); 0025's restrictive check remains.
CREATE POLICY approved_reader_publication_pointer ON knowledge_current_publication
FOR SELECT TO arden_runtime USING (
    organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
    AND valid_from <= now() AND (valid_until IS NULL OR valid_until > now())
    AND reader_selection_id IS NOT NULL AND actor_in_reader_selection(reader_selection_id));

CREATE TRIGGER trg_freeze_submission_management BEFORE INSERT OR UPDATE ON shared_submission
FOR EACH ROW EXECUTE FUNCTION freeze_knowledge_management();
CREATE TRIGGER trg_freeze_publication_management BEFORE INSERT OR UPDATE ON published_knowledge_version
FOR EACH ROW EXECUTE FUNCTION freeze_knowledge_management();
