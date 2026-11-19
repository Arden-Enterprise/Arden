SET search_path TO arden, public;

-- Decision 0025: remove knowledge Topics in one step.
--   * Submission freezing no longer adds a Topic name, and strips any Topic keys left in a draft.
--   * The generated draft Topic column and its foreign key go, then the Topic data in mutable drafts,
--     then the knowledge_topic catalog table with its policies.
--   * Submitted and published versions are immutable snapshots (decision 0011). Their frozen management
--     JSON keeps historical topicId/topicName keys; the immutability trigger is not relaxed to rewrite them,
--     and the application no longer reads those keys.
--
-- Operator rollout: drops a table with its data and replaces a trigger function. No SECURITY DEFINER
-- routine changes (32 in total). Take a backup first; restoring Topics requires it.

-- 0034 behaviour without the Topic name.
CREATE OR REPLACE FUNCTION freeze_knowledge_management() RETURNS trigger
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
    -- Nested IF: only shared_submission rows have request_type (plpgsql does not short-circuit AND).
    IF TG_TABLE_NAME = 'shared_submission' THEN
        IF NEW.request_type <> 'CONTENT' THEN
            SELECT released.document_code, released.management INTO STRICT source
              FROM published_knowledge_version pv
              JOIN shared_submission released ON released.submission_id = pv.submission_id
             WHERE pv.published_version_id = NEW.target_published_version_id
               AND pv.shared_draft_id = NEW.shared_draft_id;
            NEW.document_code := source.document_code;
            NEW.management := source.management;
            RETURN NEW;
        END IF;
    END IF;
    IF TG_TABLE_NAME = 'shared_submission' THEN
        SELECT d.document_code, d.management - 'topicId' - 'topicName' AS management
            INTO STRICT source FROM shared_draft d
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

ALTER TABLE shared_draft DROP CONSTRAINT fk_draft_management_topic;
ALTER TABLE shared_draft DROP COLUMN management_topic_id;

UPDATE shared_draft SET management = management - 'topicId' - 'topicName'
 WHERE management ?| ARRAY['topicId', 'topicName'];

DROP TABLE knowledge_topic;
