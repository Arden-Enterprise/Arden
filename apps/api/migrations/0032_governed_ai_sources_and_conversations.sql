SET search_path TO arden, public;

-- Derived release lineage, not another mutable publication or permission source.
-- Seed only current pointers: historical withdrawals cannot safely be inferred.
CREATE TABLE knowledge_ai_release (
    epoch_id uuid NOT NULL,
    shared_draft_id uuid NOT NULL REFERENCES shared_draft(shared_draft_id),
    organization_id uuid NOT NULL REFERENCES organization(organization_id),
    published_version_id uuid NOT NULL REFERENCES published_knowledge_version(published_version_id),
    active boolean NOT NULL DEFAULT true,
    PRIMARY KEY (epoch_id, published_version_id)
);
CREATE INDEX knowledge_ai_release_document ON knowledge_ai_release(organization_id, shared_draft_id);
ALTER TABLE knowledge_ai_release ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_ai_release FORCE ROW LEVEL SECURITY;
INSERT INTO knowledge_ai_release(epoch_id, shared_draft_id, organization_id, published_version_id)
SELECT gen_random_uuid(), shared_draft_id, organization_id, published_version_id
  FROM knowledge_current_publication;

CREATE FUNCTION maintain_knowledge_ai_release() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = arden, pg_temp AS $$
DECLARE epoch uuid;
BEGIN
    IF TG_OP = 'DELETE' THEN
        UPDATE knowledge_ai_release SET active = false
         WHERE shared_draft_id = OLD.shared_draft_id AND active;
        RETURN OLD;
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.published_version_id = OLD.published_version_id THEN
        RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE' THEN
        SELECT epoch_id INTO STRICT epoch FROM knowledge_ai_release
         WHERE published_version_id = OLD.published_version_id AND active;
    ELSE
        epoch := gen_random_uuid();
    END IF;
    INSERT INTO knowledge_ai_release(epoch_id, shared_draft_id, organization_id, published_version_id)
    VALUES (epoch, NEW.shared_draft_id, NEW.organization_id, NEW.published_version_id);
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION maintain_knowledge_ai_release() FROM PUBLIC;
CREATE TRIGGER trg_knowledge_ai_release AFTER INSERT OR UPDATE OR DELETE
ON knowledge_current_publication FOR EACH ROW EXECUTE FUNCTION maintain_knowledge_ai_release();

-- Choose the version BEFORE checking its reader selection. A denied or expired
-- replacement must not revive an older policy. Calendar dates use UTC explicitly.
CREATE FUNCTION eligible_ai_publications(p_scope text DEFAULT 'CURRENT') RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = arden, pg_temp AS $$
    WITH actor AS (
        SELECT m.membership_id FROM organization_membership m
          JOIN user_account u USING (user_id) JOIN organization o USING (organization_id)
         WHERE m.user_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid
           AND m.organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
           AND m.status = 'ACTIVE' AND u.status = 'ACTIVE' AND o.status = 'ACTIVE'
    ), versions AS (
        SELECT pv.*, l.epoch_id, l.organization_id, kb.scope_type, kb.department_id,
               COALESCE(NULLIF(pv.management->>'effectiveDate', '')::date,
                        (pv.published_at AT TIME ZONE 'UTC')::date) AS effective_date,
               NULLIF(pv.management->>'expirationDate', '')::date AS expiration_date
          FROM knowledge_ai_release l
          JOIN knowledge_current_publication cp ON cp.shared_draft_id = l.shared_draft_id
               AND cp.organization_id = l.organization_id
          JOIN published_knowledge_version pv ON pv.published_version_id = l.published_version_id
          JOIN knowledge_base kb ON kb.knowledge_base_id = pv.knowledge_base_id
         WHERE l.active AND l.organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
           AND cp.valid_from <= now() AND (cp.valid_until IS NULL OR cp.valid_until > now())
           AND pv.index_status = 'INDEXED' AND EXISTS (SELECT 1 FROM actor)
    ), current_version AS (
        SELECT DISTINCT ON (shared_draft_id) * FROM versions
         WHERE effective_date <= (now() AT TIME ZONE 'UTC')::date
         ORDER BY shared_draft_id, version_no DESC
    ), announced AS (
        SELECT DISTINCT ON (shared_draft_id) * FROM versions
         ORDER BY shared_draft_id, version_no DESC
    ), chosen AS (
        SELECT * FROM current_version WHERE p_scope IN ('CURRENT', 'COMPARE')
        UNION ALL
        SELECT * FROM announced WHERE p_scope IN ('UPCOMING', 'COMPARE')
          AND effective_date > (now() AT TIME ZONE 'UTC')::date
    )
    SELECT DISTINCT v.published_version_id FROM chosen v
     WHERE (v.expiration_date IS NULL OR v.expiration_date >= (now() AT TIME ZONE 'UTC')::date)
       AND (CASE WHEN v.reader_selection_id IS NOT NULL
            THEN actor_in_reader_selection(v.reader_selection_id)
            ELSE EXISTS (SELECT 1 FROM actor a WHERE a.membership_id IN (
                SELECT audience_reader_memberships(v.organization_id, v.audience_role_ids,
                    v.scope_type, v.department_id))) END);
$$;
REVOKE ALL ON FUNCTION eligible_ai_publications(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION eligible_ai_publications(text) TO arden_runtime;
CREATE POLICY ai_applicable_version_read ON published_knowledge_version FOR SELECT TO arden_runtime
USING (current_setting('arden.ai_version_scope', true) IN ('CURRENT', 'UPCOMING', 'COMPARE')
    AND published_version_id IN (SELECT eligible_ai_publications(current_setting('arden.ai_version_scope', true))));
CREATE POLICY ai_applicable_generation_read ON knowledge_index_generation FOR SELECT TO arden_runtime
USING (status = 'READY'
    AND organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
    AND current_setting('arden.ai_version_scope', true) IN ('CURRENT', 'UPCOMING', 'COMPARE')
    AND EXISTS (SELECT 1 FROM published_knowledge_version pv
        WHERE pv.submission_id = knowledge_index_generation.submission_id
          AND pv.content_hash = knowledge_index_generation.snapshot_content_hash
          AND pv.published_version_id IN (
              SELECT eligible_ai_publications(current_setting('arden.ai_version_scope', true)))));

CREATE TABLE ai_conversation (
    conversation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organization(organization_id),
    owner_membership_id uuid NOT NULL,
    title text NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
    revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (conversation_id, organization_id),
    FOREIGN KEY (owner_membership_id, organization_id)
        REFERENCES organization_membership(membership_id, organization_id)
);
CREATE TABLE ai_conversation_turn (
    turn_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    sequence integer NOT NULL CHECK (sequence > 0),
    request_id uuid NOT NULL,
    question text NOT NULL CHECK (length(question) BETWEEN 1 AND 4000),
    answer text NOT NULL CHECK (length(answer) BETWEEN 1 AND 12000),
    status text NOT NULL CHECK (status IN ('ANSWERED', 'INSUFFICIENT_EVIDENCE')),
    version_scope text NOT NULL CHECK (version_scope IN ('CURRENT', 'UPCOMING', 'COMPARE')),
    citations jsonb NOT NULL CHECK (jsonb_typeof(citations) = 'array' AND jsonb_array_length(citations) <= 12),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (conversation_id, request_id),
    UNIQUE (conversation_id, sequence),
    UNIQUE (turn_id, organization_id),
    FOREIGN KEY (conversation_id, organization_id)
        REFERENCES ai_conversation(conversation_id, organization_id)
);
CREATE TABLE ai_turn_evidence (
    turn_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    generation_id uuid NOT NULL REFERENCES knowledge_index_generation(generation_id),
    published_version_id uuid NOT NULL REFERENCES published_knowledge_version(published_version_id),
    snapshot_version_id uuid NOT NULL,
    snapshot_content_hash text NOT NULL CHECK (snapshot_content_hash ~ '^[a-f0-9]{64}$'),
    chunk_id text NOT NULL CHECK (chunk_id ~ '^[a-f0-9]{64}$'),
    PRIMARY KEY (turn_id, generation_id, chunk_id),
    FOREIGN KEY (turn_id, organization_id) REFERENCES ai_conversation_turn(turn_id, organization_id)
);
ALTER TABLE ai_conversation ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_conversation FORCE ROW LEVEL SECURITY;
ALTER TABLE ai_conversation_turn ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_conversation_turn FORCE ROW LEVEL SECURITY;
ALTER TABLE ai_turn_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_turn_evidence FORCE ROW LEVEL SECURITY;
CREATE POLICY ai_conversation_owner ON ai_conversation FOR ALL TO arden_runtime
USING (organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
   AND EXISTS (SELECT 1 FROM organization_membership m JOIN user_account u USING (user_id)
      JOIN organization o USING (organization_id)
      WHERE m.membership_id = owner_membership_id AND m.organization_id = ai_conversation.organization_id
        AND m.user_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid
        AND m.status = 'ACTIVE' AND u.status = 'ACTIVE' AND o.status = 'ACTIVE'));
CREATE POLICY ai_turn_owner ON ai_conversation_turn FOR ALL TO arden_runtime
USING (EXISTS (SELECT 1 FROM ai_conversation c WHERE c.conversation_id = ai_conversation_turn.conversation_id
    AND c.organization_id = ai_conversation_turn.organization_id));
CREATE POLICY ai_turn_evidence_owner ON ai_turn_evidence FOR SELECT TO arden_runtime
USING (EXISTS (SELECT 1 FROM ai_conversation_turn t WHERE t.turn_id = ai_turn_evidence.turn_id
    AND t.organization_id = ai_turn_evidence.organization_id));
CREATE POLICY ai_turn_evidence_insert ON ai_turn_evidence FOR INSERT TO arden_runtime
WITH CHECK (EXISTS (SELECT 1 FROM ai_conversation_turn t WHERE t.turn_id = ai_turn_evidence.turn_id
    AND t.organization_id = ai_turn_evidence.organization_id)
    AND EXISTS (SELECT 1 FROM knowledge_index_generation g JOIN published_knowledge_version pv
        ON pv.submission_id = g.submission_id
        WHERE g.generation_id = ai_turn_evidence.generation_id
          AND g.organization_id = ai_turn_evidence.organization_id
          AND pv.published_version_id = ai_turn_evidence.published_version_id
          AND g.snapshot_version_id = ai_turn_evidence.snapshot_version_id
          AND g.snapshot_content_hash = ai_turn_evidence.snapshot_content_hash
          AND EXISTS (SELECT 1 FROM jsonb_array_elements(g.manifest_json->'chunks') chunk
              WHERE chunk->>'chunkId' = ai_turn_evidence.chunk_id)));
GRANT SELECT, INSERT, UPDATE ON ai_conversation TO arden_runtime;
GRANT SELECT, INSERT ON ai_conversation_turn, ai_turn_evidence TO arden_runtime;
