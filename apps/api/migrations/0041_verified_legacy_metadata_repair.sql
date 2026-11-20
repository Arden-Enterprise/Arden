SET search_path TO arden, public;

-- Operator-only, one-shot historical exception; no persistent helper, new grant,
-- RLS change or runtime endpoint. The private manifest is supplied in this same
-- transaction via arden.metadata_repair_manifest, never stored in migration SQL.
-- Without that input the schema chain is a no-op: it never guesses source data.
-- The staging operator must separately require all 30 approved targets/audits.
DO $repair$
DECLARE
    manifest jsonb;
    item record;
    original record;
    patched jsonb;
    after_draft jsonb;
    after_submission jsonb;
    after_publication jsonb;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND rolsuper) THEN
        RAISE EXCEPTION '0041 requires the trusted operator' USING ERRCODE = '42501';
    END IF;
    IF NULLIF(current_setting('arden.metadata_repair_manifest', true), '') IS NULL THEN
        RETURN;
    END IF;
    manifest := current_setting('arden.metadata_repair_manifest')::jsonb;
    IF jsonb_typeof(manifest) <> 'object'
       OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(manifest) key)
          <> ARRAY['rows', 'sourceManifestSha256']::text[]
       OR jsonb_typeof(manifest->'rows') <> 'array'
       OR COALESCE(manifest->>'sourceManifestSha256', '') !~ '^[a-f0-9]{64}$'
       OR jsonb_array_length(manifest->'rows') > 100 THEN
        RAISE EXCEPTION 'Invalid metadata repair manifest';
    END IF;
    IF jsonb_array_length(manifest->'rows') = 0 THEN RETURN; END IF;
    LOCK TABLE shared_draft, shared_draft_version, shared_submission,
        published_knowledge_version, knowledge_current_publication, audit_event
        IN SHARE ROW EXCLUSIVE MODE;
    CREATE TEMP TABLE metadata_repair_input ON COMMIT DROP AS
        SELECT * FROM jsonb_to_recordset(manifest->'rows') AS value(
            "organizationId" uuid, "documentId" uuid, "publicationId" uuid,
            "submissionId" uuid, "contentHash" text, "documentCode" text,
            type text, version text);
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(manifest->'rows') value WHERE
        (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(value) key)
          <> ARRAY['contentHash','documentCode','documentId','organizationId',
                   'publicationId','submissionId','type','version']::text[])
       OR EXISTS (SELECT 1 FROM metadata_repair_input WHERE
           "organizationId" IS NULL OR "documentId" IS NULL OR "publicationId" IS NULL
           OR "submissionId" IS NULL OR COALESCE("contentHash", '') !~ '^[a-f0-9]{64}$'
           OR COALESCE("documentCode", '') !~ '^ARD-[A-F0-9]{16}$'
           OR type IS NULL OR type NOT IN ('Policy & Standard','Procedure','Guide','Reference','Lessons Learned')
           OR COALESCE(version, '') !~ '^[A-Za-z0-9_][A-Za-z0-9_. -]{0,29}$')
       OR (SELECT count(*) <> count(DISTINCT "documentId")
               OR count(*) <> count(DISTINCT "publicationId")
               OR count(*) <> count(DISTINCT "submissionId")
               OR count(*) <> count(DISTINCT "contentHash") FROM metadata_repair_input) THEN
        RAISE EXCEPTION 'Invalid or duplicate repair target';
    END IF;
    IF (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgenabled = 'O'
        AND (tgrelid, tgname) IN (
          ('shared_submission'::regclass,'trg_freeze_submission_management'),
          ('published_knowledge_version'::regclass,'trg_freeze_publication_management'),
          ('published_knowledge_version'::regclass,'trg_published_version_immutable'),
          ('shared_draft'::regclass,'trg_shared_draft_updated_at'))) <> 4 THEN
        RAISE EXCEPTION 'Unexpected metadata guard state';
    END IF;
    -- Only these guards are suspended inside the enclosing atomic transaction.
    -- Any error (including audit failure) rolls back changes and trigger DDL.
    ALTER TABLE shared_submission DISABLE TRIGGER trg_freeze_submission_management;
    ALTER TABLE published_knowledge_version DISABLE TRIGGER trg_freeze_publication_management;
    ALTER TABLE published_knowledge_version DISABLE TRIGGER trg_published_version_immutable;
    -- Repair is not a new author edit; retain its original historical timestamp.
    ALTER TABLE shared_draft DISABLE TRIGGER trg_shared_draft_updated_at;
    FOR item IN SELECT * FROM metadata_repair_input ORDER BY "publicationId" LOOP
        SELECT to_jsonb(d) AS draft, to_jsonb(s) AS submission, to_jsonb(p) AS publication
          INTO STRICT original
          FROM shared_draft d
          JOIN shared_draft_version v ON v.shared_draft_id = d.shared_draft_id
              AND v.version_no = d.current_version_no
          JOIN shared_submission s ON s.shared_draft_id = d.shared_draft_id
              AND s.organization_id = d.organization_id AND s.submission_id = item."submissionId"
          JOIN published_knowledge_version p ON p.submission_id = s.submission_id
              AND p.shared_draft_id = d.shared_draft_id AND p.published_version_id = item."publicationId"
          JOIN knowledge_current_publication cp ON cp.shared_draft_id = d.shared_draft_id
              AND cp.organization_id = d.organization_id AND cp.published_version_id = p.published_version_id
         WHERE d.shared_draft_id = item."documentId" AND d.organization_id = item."organizationId"
           AND d.document_code = item."documentCode"
           AND d.management IS NULL AND s.management IS NULL AND p.management IS NULL
           AND s.document_code IS NULL AND p.document_code IS NULL
           AND v.content_hash = item."contentHash" AND s.content_hash = item."contentHash"
           AND p.content_hash = item."contentHash";
        -- Encode the normal metadata object; empty optional fields do not assign
        -- dates, Topics, release kinds or a fabricated historical change note.
        patched := jsonb_build_object('schemaVersion',1,'type',item.type,'version',item.version,
            'topicId',NULL,'effectiveDate',NULL,'expirationDate',NULL,'changeNote','');
        UPDATE shared_draft SET management = patched WHERE shared_draft_id = item."documentId";
        UPDATE shared_submission SET document_code = item."documentCode", management = patched
            WHERE submission_id = item."submissionId";
        UPDATE published_knowledge_version SET document_code = item."documentCode", management = patched
            WHERE published_version_id = item."publicationId";
        SELECT to_jsonb(d) INTO STRICT after_draft FROM shared_draft d WHERE shared_draft_id = item."documentId";
        SELECT to_jsonb(s) INTO STRICT after_submission FROM shared_submission s WHERE submission_id = item."submissionId";
        SELECT to_jsonb(p) INTO STRICT after_publication FROM published_knowledge_version p WHERE published_version_id = item."publicationId";
        IF (original.draft - 'management') IS DISTINCT FROM (after_draft - 'management')
           OR (original.submission - 'document_code' - 'management') IS DISTINCT FROM
              (after_submission - 'document_code' - 'management')
           OR (original.publication - 'document_code' - 'management') IS DISTINCT FROM
              (after_publication - 'document_code' - 'management') THEN
            RAISE EXCEPTION 'Repair modified protected snapshot fields: draft %, submission %, publication %',
                ARRAY(SELECT key FROM jsonb_each(original.draft - 'management')
                    WHERE value IS DISTINCT FROM after_draft->key),
                ARRAY(SELECT key FROM jsonb_each(original.submission - 'document_code' - 'management')
                    WHERE value IS DISTINCT FROM after_submission->key),
                ARRAY(SELECT key FROM jsonb_each(original.publication - 'document_code' - 'management')
                    WHERE value IS DISTINCT FROM after_publication->key);
        END IF;
        INSERT INTO audit_event (organization_id, event_type, outcome, details_json)
        VALUES (item."organizationId", 'KNOWLEDGE_LEGACY_METADATA_REPAIRED', 'SUCCESS',
            jsonb_build_object('migration','0041_verified_legacy_metadata_repair',
                'sourceManifestSha256',manifest->>'sourceManifestSha256',
                'documentId',item."documentId",'publicationId',item."publicationId",
                'submissionId',item."submissionId",'contentHash',item."contentHash",
                'operator',true,'before',jsonb_build_object('draftManagement',original.draft->'management',
                    'submissionCode',original.submission->'document_code',
                    'submissionManagement',original.submission->'management',
                    'publicationCode',original.publication->'document_code',
                    'publicationManagement',original.publication->'management'),
                'after',jsonb_build_object('documentCode',item."documentCode",'management',patched)));
    END LOOP;
    ALTER TABLE shared_submission ENABLE TRIGGER trg_freeze_submission_management;
    ALTER TABLE published_knowledge_version ENABLE TRIGGER trg_freeze_publication_management;
    ALTER TABLE published_knowledge_version ENABLE TRIGGER trg_published_version_immutable;
    ALTER TABLE shared_draft ENABLE TRIGGER trg_shared_draft_updated_at;
    PERFORM set_config('arden.metadata_repair_manifest','',true);
END;
$repair$;
