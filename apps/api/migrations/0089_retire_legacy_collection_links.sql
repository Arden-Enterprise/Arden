SET search_path TO arden, public;

LOCK TABLE knowledge_collection_document, knowledge_collection_placement, published_knowledge_version
    IN ACCESS EXCLUSIVE MODE;

-- Links to old published versions are redundant only when the current
-- document-level assignment already records the same Handbook.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM knowledge_collection_document legacy
          JOIN published_knowledge_version pv USING (published_version_id)
          LEFT JOIN knowledge_collection_placement placement
            ON placement.shared_draft_id = pv.shared_draft_id AND placement.organization_id = legacy.organization_id
         WHERE placement.collection_id IS DISTINCT FROM legacy.collection_id
    ) THEN
        RAISE EXCEPTION 'Resolve legacy collection links before retiring their storage' USING ERRCODE = '55000';
    END IF;
END;
$$;

DROP TABLE knowledge_collection_document;
