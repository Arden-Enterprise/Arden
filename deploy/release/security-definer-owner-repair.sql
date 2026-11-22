-- Operator-only recovery of the pre-transfer internal execution identity.
-- Substitute the validated database and the fixed environment migration role.
-- No table data, runtime role, RLS policy, function body or EXECUTE grant changes.
BEGIN;
SET LOCAL search_path = pg_catalog;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SELECT pg_advisory_xact_lock(hashtext('arden:migrations'));
DO $repair_internal_execution$
DECLARE
    item record;
    -- Exact inventory after migrations 0001-0043 (35 routines). Any other count or name refuses.
    expected_names text[] := ARRAY[
        -- Reviewed baseline (0001-0022).
        'audience_snapshot_enforceable', 'claim_knowledge_index_job',
        'complete_knowledge_index_job', 'complete_knowledge_index_job_unordered_v1',
        'fail_knowledge_index_job', 'organization_has_active_reviewer_grant',
        'protect_last_system_administrator', 'validate_audience_group_membership',
        'validate_review_decision', 'validate_shared_draft_audience',
        'validate_shared_draft_source', 'validate_shared_submission',
        -- 0024-0026 Target Readers, approved readers and review authors.
        'check_reader_selection_size', 'reader_selection_member_facts', 'validate_reader_selection',
        'validate_selected_reader', 'validate_submission_reader_selection',
        'submission_proposed_reader_directory', 'review_submission_authors',
        -- 0027 categories; 0030 reader directory; 0032 governed AI sources.
        'seed_document_categories', 'eligible_ai_publications', 'maintain_knowledge_ai_release',
        'knowledge_reader_directory',
        -- 0035 publication changes; 0036 preparation retry.
        'apply_publication_change', 'retry_knowledge_publication',
        -- 0037 governance (decision 0023).
        'list_governance_publications', 'open_governance_inspection', 'use_governance_inspection',
        'responsible_publication_view', 'withdraw_publication_directly', 'list_publication_reports',
        'close_publication_report',
        -- 0039 notification fan-out; 0040 trigger-only placement validator;
        -- 0043 approved reader-change share fan-out.
        'notify_arden_notification', 'notify_arden_publication_share',
        'validate_collection_placement'];
BEGIN
    IF current_database() <> '__EXPECTED_DATABASE__'
       OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND rolsuper)
       OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres' AND rolsuper)
       OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '__MIGRATION_ROLE__'
                      AND NOT rolsuper AND NOT rolbypassrls) THEN
        RAISE EXCEPTION 'Refusing an unverified internal-executor recovery target';
    END IF;
    IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'arden' AND p.prosecdef) <> cardinality(expected_names)
       OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                   WHERE n.nspname = 'arden' AND p.prosecdef
                     AND (p.proname <> ALL(expected_names)
                          OR p.proowner NOT IN ('postgres'::regrole, '__MIGRATION_ROLE__'::regrole)))
       OR EXISTS (SELECT 1 FROM unnest(expected_names) name
                   WHERE (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                           WHERE n.nspname = 'arden' AND p.prosecdef AND p.proname = name) <> 1) THEN
        RAISE EXCEPTION 'Internal function inventory/owners changed; review before recovery';
    END IF;
    FOR item IN
        SELECT p.oid::regprocedure AS signature
          FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'arden' AND p.prosecdef AND p.proname = ANY(expected_names)
           AND p.proowner = '__MIGRATION_ROLE__'::regrole
    LOOP
        EXECUTE format('ALTER FUNCTION %s OWNER TO postgres', item.signature);
    END LOOP;
END
$repair_internal_execution$;
COMMIT;
