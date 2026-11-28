SET search_path TO arden, public;

LOCK TABLE knowledge_collection_document, knowledge_collection_placement, published_knowledge_version
    IN ACCESS EXCLUSIVE MODE;
LOCK TABLE knowledge_collection, knowledge_current_publication IN SHARE MODE;

-- Preserve explicit placements, including a null placement after removal.
-- An eligible link with no placement still needs an administrator's decision.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM knowledge_collection_document legacy
          JOIN published_knowledge_version pv USING (published_version_id)
          LEFT JOIN knowledge_collection_placement placement
            ON placement.shared_draft_id = pv.shared_draft_id AND placement.organization_id = legacy.organization_id
         WHERE pv.organization_id IS DISTINCT FROM legacy.organization_id
            OR (placement.shared_draft_id IS NULL
                AND collection_source_eligible(legacy.organization_id, pv.shared_draft_id, legacy.collection_id))
    ) THEN
        RAISE EXCEPTION 'Resolve legacy collection links before retiring their storage' USING ERRCODE = '55000';
    END IF;
END;
$$;

-- Keep exact-version provenance for superseded links. A current source missing
-- its document Type or an allowed Type stays in the organization master list.
INSERT INTO audit_event (organization_id, event_type, outcome, details_json)
SELECT legacy.organization_id, 'LEGACY_HANDBOOK_LINK_RETIRED', 'SUCCESS',
       jsonb_build_object('handbookId', legacy.collection_id, 'documentId', pv.shared_draft_id,
                          'publicationId', legacy.published_version_id, 'ordinal', legacy.ordinal,
                          'currentHandbookId', placement.collection_id)
  FROM knowledge_collection_document legacy
  JOIN published_knowledge_version pv USING (published_version_id)
  LEFT JOIN knowledge_collection_placement placement
    ON placement.shared_draft_id = pv.shared_draft_id AND placement.organization_id = legacy.organization_id
 WHERE placement.collection_id IS DISTINCT FROM legacy.collection_id;

DROP TABLE knowledge_collection_document;
