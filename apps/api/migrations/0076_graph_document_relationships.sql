SET search_path TO arden, public;

-- Decision 0036 (Knowledge Graph T-06): governed dual-endpoint document_relationship RLS,
-- advisory-locked RELATED deduplication and SUPERSEDES acyclicity, ghost-edge cleanup,
-- and append-only relationship idempotency ledger.
--   * Drops all three permissive 0027 author-draft policies on document_relationship so
--     PostgreSQL cannot OR-combine legacy draft policies with governed published-only RLS.
--   * SELECT enforces dual-endpoint readability and non-expiry via current_readable_document_ids()
--     (matching eligible_ai_publications() without requiring pv.index_status = 'INDEXED').
--   * INSERT binds created_by_membership_id to the caller's active membership, requires active
--     source Author or DB-re-derived Organization Admin authority, and requires BOTH endpoints
--     to be currently readable and unexpired (anti-oracle).
--   * DELETE (and remove_governed_document_relationship for ghost edges hidden from SELECT RLS
--     after a target expires or narrows Target Readers) checks source management authority only.
--   * document_relationship.relationship_type = 'SUPERSEDES' is an informational cross-document
--     lineage link; it does not alter Flow 2 version replacement, Home visibility, or AI sources.
--
-- Operator rollout: adds four reviewed SECURITY DEFINER routines
-- (current_readable_document_ids, actor_can_manage_relationship_source,
-- enforce_document_relationship_invariants, remove_governed_document_relationship;
-- 61 in the owner inventory). Apply as the trusted superuser so they keep their postgres owner.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)) THEN
        RAISE EXCEPTION '0076 must be applied by the trusted operator role (superuser or BYPASSRLS)'
            USING ERRCODE = '42501';
    END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 1. Explicitly drop all three 0027 permissive policies (closes B1 bypass).
-- ---------------------------------------------------------------------------
DROP POLICY document_relationship_author_read ON document_relationship;
DROP POLICY document_relationship_author_insert ON document_relationship;
DROP POLICY document_relationship_author_delete ON document_relationship;

-- ---------------------------------------------------------------------------
-- 2. Canonical readability and source-management helpers (SECURITY DEFINER).
-- ---------------------------------------------------------------------------

-- Current readable, unexpired Company publications for the active actor in the session
-- organization. Matches eligible_ai_publications() (0068) except without requiring
-- pv.index_status = 'INDEXED' so newly published documents can be viewed and linked.
CREATE FUNCTION current_readable_document_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = arden, pg_temp AS $$
    SELECT cp.shared_draft_id
      FROM knowledge_current_publication cp
      JOIN shared_draft d
        ON d.shared_draft_id = cp.shared_draft_id
       AND d.organization_id = cp.organization_id
       AND d.status = 'ACTIVE'
      JOIN published_knowledge_version pv
        ON pv.published_version_id = cp.published_version_id
       AND pv.shared_draft_id = cp.shared_draft_id
      JOIN knowledge_base kb
        ON kb.knowledge_base_id = pv.knowledge_base_id
     WHERE cp.organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
       AND kb.organization_id = cp.organization_id
       AND cp.valid_from <= now()
       AND (cp.valid_until IS NULL OR cp.valid_until > now())
       AND pv.published_at <= now()
       AND (
           publication_expiration_date(pv.published_version_id, pv.management) IS NULL
           OR publication_expiration_date(pv.published_version_id, pv.management) >= (now() AT TIME ZONE 'UTC')::date
       )
       AND EXISTS (
           SELECT 1
             FROM organization_membership m
             JOIN user_account u USING (user_id)
             JOIN organization o USING (organization_id)
            WHERE m.user_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid
              AND m.organization_id = cp.organization_id
              AND m.status = 'ACTIVE'
              AND u.status = 'ACTIVE'
              AND o.status = 'ACTIVE'
              AND CASE WHEN pv.reader_selection_id IS NOT NULL
                  THEN actor_in_reader_selection(pv.reader_selection_id)
                  ELSE m.membership_id IN (
                      SELECT audience_reader_memberships(cp.organization_id, pv.audience_role_ids,
                          kb.scope_type, kb.department_id))
                  END
       );
$$;
REVOKE ALL ON FUNCTION current_readable_document_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION current_readable_document_ids() TO arden_runtime;

-- Proves the active session actor is either the active author of a current (including expired
-- current) published document or an active Organization Admin re-derived from role_assignment
-- (never trusting arden.org_admin GUC) who is also an authorized reader of that publication.
-- Runs in owner context because shared_draft RLS is author-only and knowledge_current_publication
-- RLS hides restricted publications from non-reader admins.
CREATE FUNCTION actor_can_manage_relationship_source(
    p_organization_id uuid,
    p_source_document_id uuid
)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = arden, pg_temp AS $$
    SELECT p_organization_id IS NOT NULL
       AND p_source_document_id IS NOT NULL
       AND p_organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
       AND governance_actor_membership(p_organization_id) IS NOT NULL
       AND EXISTS (
           SELECT 1
             FROM knowledge_current_publication cp
             JOIN shared_draft d
               ON d.shared_draft_id = cp.shared_draft_id
              AND d.organization_id = cp.organization_id
              AND d.status = 'ACTIVE'
             JOIN published_knowledge_version pv
               ON pv.published_version_id = cp.published_version_id
              AND pv.shared_draft_id = cp.shared_draft_id
             JOIN knowledge_base kb
               ON kb.knowledge_base_id = pv.knowledge_base_id
              AND kb.organization_id = cp.organization_id
            WHERE cp.organization_id = p_organization_id
              AND cp.shared_draft_id = p_source_document_id
              AND cp.valid_from <= now()
              AND (cp.valid_until IS NULL OR cp.valid_until > now())
              AND pv.published_at <= now()
              AND (
                  d.author_membership_id = governance_actor_membership(p_organization_id)
                  OR (
                      governance_is_org_admin(governance_actor_membership(p_organization_id), p_organization_id)
                      AND CASE WHEN pv.reader_selection_id IS NOT NULL
                          THEN actor_in_reader_selection(pv.reader_selection_id)
                          ELSE governance_actor_membership(p_organization_id) IN (
                              SELECT audience_reader_memberships(cp.organization_id, pv.audience_role_ids,
                                  kb.scope_type, kb.department_id))
                          END
                  )
              )
       );
$$;
REVOKE ALL ON FUNCTION actor_can_manage_relationship_source(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION actor_can_manage_relationship_source(uuid, uuid) TO arden_runtime;

-- ---------------------------------------------------------------------------
-- 3. Replacement dual-endpoint RLS policies on document_relationship.
-- ---------------------------------------------------------------------------
CREATE POLICY document_relationship_dual_reader_select
ON document_relationship FOR SELECT TO arden_runtime
USING (
    organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
    AND source_document_id IN (SELECT current_readable_document_ids())
    AND target_document_id IN (SELECT current_readable_document_ids())
);

CREATE POLICY document_relationship_governed_insert
ON document_relationship FOR INSERT TO arden_runtime
WITH CHECK (
    organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
    AND created_by_membership_id = maintenance_actor_membership(organization_id)
    AND actor_can_manage_relationship_source(organization_id, source_document_id)
    AND source_document_id IN (SELECT current_readable_document_ids())
    AND target_document_id IN (SELECT current_readable_document_ids())
);

CREATE POLICY document_relationship_governed_delete
ON document_relationship FOR DELETE TO arden_runtime
USING (
    organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
    AND actor_can_manage_relationship_source(organization_id, source_document_id)
);

-- Removes one outgoing relationship from a published (including expired) source document the
-- actor manages. Runs in owner context solely so stale ghost edges whose target later expired
-- or narrowed Target Readers can still be removed even though SELECT RLS hides those edges
-- from a direct DELETE ... WHERE / RETURNING statement under arden_runtime.
CREATE FUNCTION remove_governed_document_relationship(
    p_source_document_id uuid,
    p_relationship_id uuid
)
RETURNS TABLE (
    relationship_id uuid,
    source_document_id uuid,
    target_document_id uuid,
    relationship_type text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = arden, pg_temp AS $$
DECLARE
    org uuid := NULLIF(current_setting('arden.organization_id', true), '')::uuid;
BEGIN
    IF org IS NULL OR p_source_document_id IS NULL OR p_relationship_id IS NULL THEN
        RETURN;
    END IF;
    IF NOT actor_can_manage_relationship_source(org, p_source_document_id) THEN
        RETURN;
    END IF;
    RETURN QUERY
    DELETE FROM document_relationship r
     WHERE r.relationship_id = p_relationship_id
       AND r.organization_id = org
       AND r.source_document_id = p_source_document_id
    RETURNING r.relationship_id, r.source_document_id, r.target_document_id, r.relationship_type;
END;
$$;
REVOKE ALL ON FUNCTION remove_governed_document_relationship(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION remove_governed_document_relationship(uuid, uuid) TO arden_runtime;

-- ---------------------------------------------------------------------------
-- 4. Advisory-locked BEFORE INSERT/UPDATE trigger: symmetric RELATED dedupe
--    and SUPERSEDES acyclicity across all organization edges.
-- ---------------------------------------------------------------------------
CREATE FUNCTION enforce_document_relationship_invariants()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = arden, pg_temp AS $$
DECLARE
    has_cycle boolean;
BEGIN
    -- For runtime callers, enforce the governed INSERT RLS preconditions before touching
    -- hidden organization edges so probing an unreadable target never produces a 409 oracle.
    IF session_user = 'arden_runtime' OR current_setting('role', true) = 'arden_runtime' THEN
        IF NEW.organization_id IS DISTINCT FROM NULLIF(current_setting('arden.organization_id', true), '')::uuid
           OR NEW.created_by_membership_id IS DISTINCT FROM governance_actor_membership(NEW.organization_id)
           OR NOT actor_can_manage_relationship_source(NEW.organization_id, NEW.source_document_id)
           OR NOT (NEW.source_document_id IN (SELECT current_readable_document_ids()))
           OR NOT (NEW.target_document_id IN (SELECT current_readable_document_ids())) THEN
            RAISE EXCEPTION 'new row violates row-level security policy for table "document_relationship"'
                USING ERRCODE = '42501';
        END IF;
    END IF;

    -- Let ck_document_relationship_not_self handle self-links cleanly.
    IF NEW.source_document_id = NEW.target_document_id THEN
        RETURN NEW;
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext('arden:doc_rel:' || NEW.organization_id::text));

    IF NEW.relationship_type = 'RELATED' THEN
        IF EXISTS (
            SELECT 1
              FROM document_relationship r
             WHERE r.organization_id = NEW.organization_id
               AND r.relationship_type = 'RELATED'
               AND r.source_document_id = NEW.target_document_id
               AND r.target_document_id = NEW.source_document_id
               AND (TG_OP = 'INSERT' OR r.relationship_id <> OLD.relationship_id)
        ) THEN
            RAISE EXCEPTION 'Symmetric RELATED relationship already exists'
                USING ERRCODE = '23505', CONSTRAINT = 'uq_document_relationship_symmetric_related';
        END IF;
    ELSIF NEW.relationship_type = 'SUPERSEDES' THEN
        WITH RECURSIVE supersedes_walk(doc_id, path) AS (
            SELECT NEW.target_document_id, ARRAY[NEW.target_document_id]
            UNION ALL
            SELECT r.target_document_id, w.path || r.target_document_id
              FROM supersedes_walk w
              JOIN document_relationship r
                ON r.organization_id = NEW.organization_id
               AND r.relationship_type = 'SUPERSEDES'
               AND r.source_document_id = w.doc_id
               AND (TG_OP = 'INSERT' OR r.relationship_id <> OLD.relationship_id)
             WHERE NOT (r.target_document_id = ANY(w.path))
        )
        SELECT EXISTS (
            SELECT 1
              FROM supersedes_walk
             WHERE doc_id = NEW.source_document_id
        ) INTO has_cycle;

        IF has_cycle THEN
            RAISE EXCEPTION 'SUPERSEDES relationship would form a cycle'
                USING ERRCODE = '23514', CONSTRAINT = 'ck_document_relationship_supersedes_acyclic';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION enforce_document_relationship_invariants() FROM PUBLIC;

CREATE TRIGGER trg_enforce_document_relationship_invariants
    BEFORE INSERT OR UPDATE ON document_relationship
    FOR EACH ROW EXECUTE FUNCTION enforce_document_relationship_invariants();

-- ---------------------------------------------------------------------------
-- 5. Append-only idempotency ledger (no FK to document_relationship so REMOVE
--    replays survive row deletion).
-- ---------------------------------------------------------------------------
CREATE TABLE document_relationship_idempotency (
    organization_id     uuid NOT NULL,
    actor_membership_id uuid NOT NULL,
    idempotency_key     uuid NOT NULL,
    operation           text NOT NULL,
    request_hash        text NOT NULL,
    status_code         smallint NOT NULL,
    response_json       jsonb NOT NULL,
    created_at          timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (organization_id, actor_membership_id, idempotency_key),
    CONSTRAINT fk_document_relationship_idempotency_actor
        FOREIGN KEY (actor_membership_id, organization_id)
        REFERENCES organization_membership(membership_id, organization_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT ck_document_relationship_idempotency_operation
        CHECK (operation IN ('CREATE', 'REMOVE')),
    CONSTRAINT ck_document_relationship_idempotency_hash
        CHECK (request_hash ~ '^[a-f0-9]{64}$'),
    CONSTRAINT ck_document_relationship_idempotency_status
        CHECK (status_code BETWEEN 200 AND 599),
    CONSTRAINT ck_document_relationship_idempotency_response
        CHECK (jsonb_typeof(response_json) = 'object')
);

CREATE FUNCTION reject_document_relationship_idempotency_mutation()
RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = arden, pg_temp AS $$
BEGIN
    RAISE EXCEPTION 'document_relationship_idempotency is append-only' USING ERRCODE = '55000';
END;
$$;
REVOKE ALL ON FUNCTION reject_document_relationship_idempotency_mutation() FROM PUBLIC;

CREATE TRIGGER trg_document_relationship_idempotency_append_only
    BEFORE UPDATE OR DELETE ON document_relationship_idempotency
    FOR EACH ROW EXECUTE FUNCTION reject_document_relationship_idempotency_mutation();

ALTER TABLE document_relationship_idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_relationship_idempotency FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON document_relationship_idempotency TO arden_runtime;

CREATE POLICY document_relationship_idempotency_actor_select
ON document_relationship_idempotency FOR SELECT TO arden_runtime
USING (
    organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
    AND actor_membership_id = maintenance_actor_membership(organization_id)
);

CREATE POLICY document_relationship_idempotency_actor_insert
ON document_relationship_idempotency FOR INSERT TO arden_runtime
WITH CHECK (
    organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
    AND actor_membership_id = maintenance_actor_membership(organization_id)
);
