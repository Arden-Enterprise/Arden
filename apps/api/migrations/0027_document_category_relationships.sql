SET search_path TO arden, public;

-- Flow 2 T3.1 (BM04 RF-03): contribution form metadata.
--   * document_category: five default categories per organization. A category is a browse/filter label;
--     it never grants access.
--   * shared_draft (the knowledge document) gains category_id, keywords and change_description. They are
--     working-draft fields: nullable/empty so Save draft accepts an incomplete form (T3.2 validates Submit).
--     Existing documents receive their organization's default category.
--   * shared_submission gains frozen copies of the same fields; they join the immutable snapshot tuple.
--   * document_relationship links two documents of the same organization; composite keys make a
--     cross-organization link impossible.
--
-- Operator rollout: the backfill reads FORCE RLS tables and the seed trigger is a reviewed SECURITY
-- DEFINER routine that must keep its trusted owner, so apply this file as the trusted superuser.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)) THEN
        RAISE EXCEPTION '0027 must be applied by the trusted operator role (superuser or BYPASSRLS)'
            USING ERRCODE = '42501';
    END IF;
END;
$$;

CREATE TABLE document_category (
    category_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  uuid NOT NULL,
    code             text NOT NULL,
    name             text NOT NULL,
    sort_order       smallint NOT NULL,
    is_default       boolean NOT NULL DEFAULT false,
    status           text NOT NULL DEFAULT 'ACTIVE',
    created_at       timestamptz NOT NULL DEFAULT now(),

    -- Categories belong to their organization only; organizations are never deleted by the application.
    CONSTRAINT fk_document_category_organization
        FOREIGN KEY (organization_id) REFERENCES organization(organization_id)
        ON UPDATE RESTRICT ON DELETE CASCADE,
    CONSTRAINT uq_document_category_id_org UNIQUE (category_id, organization_id),
    CONSTRAINT uq_document_category_code UNIQUE (organization_id, code),
    CONSTRAINT ck_document_category_code CHECK (code ~ '^[A-Z][A-Z0-9_]{1,39}$'),
    CONSTRAINT ck_document_category_name CHECK (length(btrim(name)) BETWEEN 1 AND 80),
    CONSTRAINT ck_document_category_sort CHECK (sort_order BETWEEN 1 AND 1000),
    CONSTRAINT ck_document_category_status CHECK (status IN ('ACTIVE', 'ARCHIVED')),
    CONSTRAINT ck_document_category_default_active CHECK (NOT is_default OR status = 'ACTIVE')
);

CREATE UNIQUE INDEX uq_document_category_default ON document_category (organization_id) WHERE is_default;
CREATE UNIQUE INDEX uq_document_category_name
    ON document_category (organization_id, lower(btrim(name))) WHERE status = 'ACTIVE';

-- The five defaults. GENERAL is the organization default and the backfill value for existing documents.
CREATE FUNCTION default_document_categories()
RETURNS TABLE (code text, name text, sort_order smallint, is_default boolean)
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = arden, pg_temp AS $$
    VALUES ('POLICY', 'Policy', 1::smallint, false),
           ('PROCEDURE', 'Procedure', 2::smallint, false),
           ('GUIDE', 'Guide', 3::smallint, false),
           ('REFERENCE', 'Reference', 4::smallint, false),
           ('GENERAL', 'General', 5::smallint, true);
$$;
REVOKE ALL ON FUNCTION default_document_categories() FROM PUBLIC;

-- Organization creation runs as arden_runtime before the new organization is its session organization,
-- so the seed needs the owner's rights. It writes only the fixed default rows for NEW.organization_id.
CREATE FUNCTION seed_document_categories()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = arden, pg_temp AS $$
BEGIN
    INSERT INTO document_category (organization_id, code, name, sort_order, is_default)
    SELECT NEW.organization_id, d.code, d.name, d.sort_order, d.is_default
      FROM default_document_categories() d
    ON CONFLICT (organization_id, code) DO NOTHING;
    RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION seed_document_categories() FROM PUBLIC;
CREATE TRIGGER trg_seed_document_categories AFTER INSERT ON organization
FOR EACH ROW EXECUTE FUNCTION seed_document_categories();

INSERT INTO document_category (organization_id, code, name, sort_order, is_default)
SELECT o.organization_id, d.code, d.name, d.sort_order, d.is_default
  FROM organization o CROSS JOIN default_document_categories() d
ON CONFLICT (organization_id, code) DO NOTHING;

ALTER TABLE document_category ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_category FORCE ROW LEVEL SECURITY;
GRANT SELECT ON document_category TO arden_runtime;
CREATE POLICY document_category_member_read ON document_category FOR SELECT TO arden_runtime
USING (organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
   AND EXISTS (SELECT 1 FROM organization_membership om
        WHERE om.organization_id = document_category.organization_id
          AND om.user_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid
          AND om.status = 'ACTIVE'));

-- ---------------------------------------------------------------------------
-- Keywords: at most 20 distinct entries of 1-50 visible characters. Keywords help search only.
-- ---------------------------------------------------------------------------
CREATE FUNCTION document_keywords_valid(p_keywords text[])
RETURNS boolean LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = arden, pg_temp AS $$
    SELECT p_keywords IS NOT NULL
       AND coalesce(array_length(p_keywords, 1), 0) <= 20
       AND array_position(p_keywords, NULL) IS NULL
       AND NOT EXISTS (SELECT 1 FROM unnest(p_keywords) k
            WHERE length(btrim(k)) NOT BETWEEN 1 AND 50 OR k <> btrim(k))
       AND (SELECT count(DISTINCT lower(k)) FROM unnest(p_keywords) k) = coalesce(array_length(p_keywords, 1), 0);
$$;
REVOKE ALL ON FUNCTION document_keywords_valid(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION document_keywords_valid(text[]) TO arden_runtime;

ALTER TABLE shared_draft ADD COLUMN category_id uuid;
ALTER TABLE shared_draft ADD COLUMN keywords text[] NOT NULL DEFAULT '{}';
ALTER TABLE shared_draft ADD COLUMN change_description text;
ALTER TABLE shared_draft ADD CONSTRAINT fk_shared_draft_category
    FOREIGN KEY (category_id, organization_id)
    REFERENCES document_category(category_id, organization_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE shared_draft ADD CONSTRAINT ck_shared_draft_keywords CHECK (document_keywords_valid(keywords));
ALTER TABLE shared_draft ADD CONSTRAINT ck_shared_draft_change_description
    CHECK (change_description IS NULL OR length(change_description) <= 2000);
CREATE INDEX ix_shared_draft_category ON shared_draft (category_id) WHERE category_id IS NOT NULL;
GRANT UPDATE (category_id, keywords, change_description) ON shared_draft TO arden_runtime;

-- Existing documents get the default category. The backfill does not count as an author edit.
ALTER TABLE shared_draft DISABLE TRIGGER trg_shared_draft_updated_at;
UPDATE shared_draft d SET category_id = c.category_id
  FROM document_category c
 WHERE c.organization_id = d.organization_id AND c.is_default AND d.category_id IS NULL;
ALTER TABLE shared_draft ENABLE TRIGGER trg_shared_draft_updated_at;

ALTER TABLE shared_submission ADD COLUMN category_id uuid;
ALTER TABLE shared_submission ADD COLUMN keywords text[];
ALTER TABLE shared_submission ADD COLUMN change_description text;
ALTER TABLE shared_submission ADD CONSTRAINT fk_shared_submission_category
    FOREIGN KEY (category_id, organization_id)
    REFERENCES document_category(category_id, organization_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE shared_submission ADD CONSTRAINT ck_shared_submission_keywords
    CHECK (keywords IS NULL OR document_keywords_valid(keywords));
ALTER TABLE shared_submission ADD CONSTRAINT ck_shared_submission_change_description
    CHECK (change_description IS NULL OR length(change_description) <= 2000);

-- Same rules as 0025, with the new frozen fields added to the immutable snapshot tuple.
CREATE OR REPLACE FUNCTION protect_flow2_submission_snapshot()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.shared_draft_version_id IS NOT NULL AND
       (NEW.shared_draft_version_id, NEW.shared_draft_id, NEW.snapshot_version_no,
        NEW.organization_id, NEW.submitted_by_membership_id,
        NEW.target_scope_type, NEW.target_department_id, NEW.responsible_department_id,
        NEW.title, NEW.classification, NEW.team_tag, NEW.project_tag,
        NEW.audience_role_ids, NEW.policy_version, NEW.review_rule, NEW.content_uri, NEW.mime_type,
        NEW.content_hash, NEW.submit_request_id, NEW.proposed_selection_id,
        NEW.category_id, NEW.keywords, NEW.change_description)
       IS DISTINCT FROM
       (OLD.shared_draft_version_id, OLD.shared_draft_id, OLD.snapshot_version_no,
        OLD.organization_id, OLD.submitted_by_membership_id,
        OLD.target_scope_type, OLD.target_department_id, OLD.responsible_department_id,
        OLD.title, OLD.classification, OLD.team_tag, OLD.project_tag,
        OLD.audience_role_ids, OLD.policy_version, OLD.review_rule, OLD.content_uri, OLD.mime_type,
        OLD.content_hash, OLD.submit_request_id, OLD.proposed_selection_id,
        OLD.category_id, OLD.keywords, OLD.change_description) THEN
        RAISE EXCEPTION 'Submitted snapshot is immutable' USING ERRCODE = '55000';
    END IF;
    IF NEW.approved_selection_id IS DISTINCT FROM OLD.approved_selection_id
       AND (OLD.approved_selection_id IS NOT NULL OR NEW.approved_selection_id IS NULL
            OR OLD.proposed_selection_id IS NULL
            OR OLD.status <> 'PENDING_REVIEW' OR NEW.status <> 'APPROVED') THEN
        RAISE EXCEPTION 'Approved readers are recorded once, at approval' USING ERRCODE = '55000';
    END IF;
    IF OLD.proposed_selection_id IS NOT NULL AND OLD.status = 'PENDING_REVIEW' AND NEW.status = 'APPROVED'
       AND NEW.approved_selection_id IS NULL THEN
        RAISE EXCEPTION 'Approving proposed readers must record the approved readers' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- Related documents. Both ends carry the same organization_id through composite foreign keys, so a link
-- across organizations cannot be stored. Readers see a link only when they may read the target (T3.2/WF-03).
-- ---------------------------------------------------------------------------
CREATE TABLE document_relationship (
    relationship_id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id           uuid NOT NULL,
    source_document_id        uuid NOT NULL,
    target_document_id        uuid NOT NULL,
    relationship_type         text NOT NULL DEFAULT 'RELATED',
    created_by_membership_id  uuid NOT NULL,
    created_at                timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT fk_document_relationship_source
        FOREIGN KEY (source_document_id, organization_id)
        REFERENCES shared_draft(shared_draft_id, organization_id)
        ON UPDATE RESTRICT ON DELETE CASCADE,
    CONSTRAINT fk_document_relationship_target
        FOREIGN KEY (target_document_id, organization_id)
        REFERENCES shared_draft(shared_draft_id, organization_id)
        ON UPDATE RESTRICT ON DELETE CASCADE,
    CONSTRAINT fk_document_relationship_creator
        FOREIGN KEY (created_by_membership_id, organization_id)
        REFERENCES organization_membership(membership_id, organization_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT uq_document_relationship UNIQUE (source_document_id, target_document_id, relationship_type),
    CONSTRAINT ck_document_relationship_not_self CHECK (source_document_id <> target_document_id),
    CONSTRAINT ck_document_relationship_type
        CHECK (relationship_type IN ('RELATED', 'REFERENCES', 'SUPERSEDES'))
);
CREATE INDEX ix_document_relationship_target ON document_relationship (target_document_id);

ALTER TABLE document_relationship ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_relationship FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, DELETE ON document_relationship TO arden_runtime;

-- The author of the source document manages its links. shared_draft RLS applies inside these subqueries.
CREATE POLICY document_relationship_author_read ON document_relationship FOR SELECT TO arden_runtime
USING (organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
   AND EXISTS (SELECT 1 FROM shared_draft d WHERE d.shared_draft_id = document_relationship.source_document_id));
CREATE POLICY document_relationship_author_insert ON document_relationship FOR INSERT TO arden_runtime
WITH CHECK (organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
   AND EXISTS (SELECT 1 FROM shared_draft d
        JOIN organization_membership om ON om.membership_id = d.author_membership_id
       WHERE d.shared_draft_id = document_relationship.source_document_id
         AND d.author_membership_id = document_relationship.created_by_membership_id
         AND om.user_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid
         AND om.status = 'ACTIVE'));
CREATE POLICY document_relationship_author_delete ON document_relationship FOR DELETE TO arden_runtime
USING (organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
   AND EXISTS (SELECT 1 FROM shared_draft d
        JOIN organization_membership om ON om.membership_id = d.author_membership_id
       WHERE d.shared_draft_id = document_relationship.source_document_id
         AND om.user_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid
         AND om.status = 'ACTIVE'));
