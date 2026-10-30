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
    expected_names text[] := ARRAY[
        'audience_snapshot_enforceable', 'claim_knowledge_index_job',
        'complete_knowledge_index_job', 'complete_knowledge_index_job_unordered_v1',
        'fail_knowledge_index_job', 'organization_has_active_reviewer_grant',
        'protect_last_system_administrator', 'validate_audience_group_membership',
        'validate_review_decision', 'validate_shared_draft_audience',
        'validate_shared_draft_source', 'validate_shared_submission'];
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
