SET LOCAL search_path TO pg_catalog;

-- Table OIDs, grants, indexes, foreign keys and RLS policies survive the rename.
-- String-body routines retain their source text, including trigger table-name checks.
DO $schema_names$
DECLARE
    old_names text[];
    new_names text[];
    table_index integer;
    routine record;
    definition text;
    rewritten text;
BEGIN
    SELECT array_agg(old_name ORDER BY old_name), array_agg(new_name ORDER BY old_name)
      INTO old_names, new_names
      FROM (VALUES
        ('user_account', 'account'),
        ('organization_membership', 'membership'),
        ('organization_invitation', 'invitation'),
        ('draft_document', 'private_document'),
        ('draft_version', 'private_version'),
        ('private_collection', 'private_folder'),
        ('private_item_share', 'direct_share'),
        ('shared_draft', 'company_document'),
        ('shared_draft_version', 'working_version'),
        ('shared_submission', 'review_submission'),
        ('published_knowledge_version', 'published_version'),
        ('knowledge_current_publication', 'current_publication'),
        ('publication_validity_renewal', 'publication_renewal'),
        ('governance_inspection', 'inspection'),
        ('reader_selection', 'reader_policy'),
        ('selected_reader', 'policy_reader'),
        ('knowledge_collection', 'handbook'),
        ('knowledge_collection_placement', 'handbook_placement'),
        ('document_relationship_idempotency', 'relationship_request_key'),
        ('knowledge_index_generation', 'index_generation'),
        ('ai_conversation', 'conversation'),
        ('ai_conversation_turn', 'conversation_turn'),
        ('ai_turn_evidence', 'turn_evidence'),
        ('ai_turn_surface_binding', 'turn_display_source'),
        ('ai_answer_result', 'answer_result'),
        ('ai_answer_feedback', 'answer_feedback'),
        ('ai_usage_event', 'ai_usage'),
        ('ai_price_book', 'price_book'),
        ('arden_notification', 'notification'),
        ('arden_notification_outbox', 'notification_outbox'),
        ('maintenance_case_event', 'case_event'),
        ('maintenance_analysis_run', 'case_analysis'),
        ('maintenance_case_link', 'case_link'),
        ('maintenance_idempotency', 'case_intake_key')
      ) AS names(old_name, new_name);

    FOR table_index IN 1..array_length(old_names, 1) LOOP
        EXECUTE format('ALTER TABLE arden.%I RENAME TO %I', old_names[table_index], new_names[table_index]);
    END LOOP;

    FOR routine IN
        SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname IN ('arden', 'arden_system') AND p.prokind = 'f'
         ORDER BY p.oid
    LOOP
        definition := pg_get_functiondef(routine.oid);
        rewritten := definition;
        FOR table_index IN 1..array_length(old_names, 1) LOOP
            rewritten := regexp_replace(rewritten, '\m' || old_names[table_index] || '\M',
                                         new_names[table_index], 'g');
        END LOOP;
        IF rewritten <> definition THEN
            -- CREATE OR REPLACE keeps the function owner, SECURITY DEFINER, ACL and trigger links.
            EXECUTE rewritten;
        END IF;
    END LOOP;
END;
$schema_names$;
