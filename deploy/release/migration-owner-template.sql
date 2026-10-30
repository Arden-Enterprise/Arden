-- Root-only one-time ownership transfer for Arden's release migration login.
-- The caller substitutes the fixed environment role and validated database name.
BEGIN;
SET LOCAL search_path = pg_catalog;

DO $arden_migration_owner_preflight$
DECLARE
    target_role oid;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_roles WHERE rolname = current_user AND rolsuper
    ) THEN
        RAISE EXCEPTION 'A database superuser is required for the one-time ownership transfer';
    END IF;
    IF current_database() <> '__EXPECTED_DATABASE__' THEN
        RAISE EXCEPTION 'The selected database does not match the approved environment';
    END IF;
    SELECT oid INTO target_role FROM pg_roles WHERE rolname = '__MIGRATION_ROLE__';
    IF target_role IS NULL THEN
        RAISE EXCEPTION 'The dedicated migration role does not exist';
    END IF;
    IF EXISTS (
        SELECT 1 FROM pg_roles
         WHERE oid = target_role
           AND (rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole
                OR rolreplication OR rolinherit OR rolcanlogin)
    ) THEN
        RAISE EXCEPTION 'The migration role must be a non-login role during ownership transfer';
    END IF;
    IF EXISTS (
        SELECT 1 FROM pg_auth_members WHERE member = target_role OR roleid = target_role
    ) THEN
        RAISE EXCEPTION 'The migration role must not inherit or grant another role';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_database WHERE datname = current_database() AND datdba = target_role) THEN
        RAISE EXCEPTION 'The migration role must not own the database';
    END IF;
    EXECUTE format('REVOKE CREATE ON DATABASE %I FROM %I', current_database(), '__MIGRATION_ROLE__');
    EXECUTE format('REVOKE CREATE ON SCHEMA public FROM %I', '__MIGRATION_ROLE__');
    IF has_database_privilege(target_role, current_database(), 'CREATE')
       OR has_schema_privilege(target_role, 'public', 'CREATE') THEN
        RAISE EXCEPTION 'The migration role inherits database-wide or public-schema CREATE';
    END IF;
    IF to_regnamespace('arden') IS NULL
       OR to_regclass('public.arden_schema_migrations') IS NULL THEN
        RAISE EXCEPTION 'The Arden schema or its migration ledger is missing';
    END IF;
    IF EXISTS (
        SELECT owner_oid
          FROM (
              SELECT n.nspowner AS owner_oid FROM pg_namespace n WHERE n.nspname = 'arden'
              UNION
              SELECT c.relowner FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
               WHERE n.nspname = 'arden' AND c.relkind IN ('r','p','v','m','S','f','c')
                 AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass
                                  AND d.objid = c.oid AND d.deptype = 'e')
              UNION
              SELECT p.proowner FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
               WHERE n.nspname = 'arden'
                 AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass
                                  AND d.objid = p.oid AND d.deptype = 'e')
              UNION
              SELECT t.typowner FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
               WHERE n.nspname = 'arden' AND t.typtype IN ('c','d','e','r','m')
                 AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_type'::regclass
                                  AND d.objid = t.oid AND d.deptype = 'e')
              UNION
              SELECT c.relowner FROM pg_class c
               WHERE c.oid = 'public.arden_schema_migrations'::regclass
          ) owned
          JOIN pg_roles owner_role ON owner_role.oid = owned.owner_oid
         WHERE owned.owner_oid <> target_role AND NOT owner_role.rolsuper
    ) THEN
        RAISE EXCEPTION 'An Arden object has a non-administrator owner; review it before transfer';
    END IF;
    IF EXISTS (
        SELECT 1 FROM pg_namespace n
         WHERE n.nspowner = target_role AND n.nspname <> 'arden'
    ) OR EXISTS (
        SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE c.relowner = target_role
           AND NOT (n.nspname = 'arden' OR
                    (n.nspname = 'public' AND c.relname = 'arden_schema_migrations'))
           AND c.relkind IN ('r','p','v','m','S','f','c')
    ) OR EXISTS (
        SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE p.proowner = target_role AND n.nspname <> 'arden'
    ) OR EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
         WHERE t.typowner = target_role AND n.nspname <> 'arden'
           AND NOT (n.nspname = 'public' AND (
               t.typrelid = 'public.arden_schema_migrations'::regclass
               OR t.oid = (SELECT ledger_type.typarray FROM pg_type ledger_type
                            WHERE ledger_type.typrelid = 'public.arden_schema_migrations'::regclass)
           ))
    ) THEN
        RAISE EXCEPTION 'The migration role already owns objects outside its approved scope';
    END IF;
END
$arden_migration_owner_preflight$;

-- PostgreSQL requires the new owner to have database CREATE at the instant
-- ownership changes. It also requires CREATE on the existing public ledger's
-- schema while changing that table's owner. Grant both only inside this transaction
-- and revoke them before commit; the deployment login retains neither privilege.
DO $arden_migration_temporary_database_create$
BEGIN
    EXECUTE format('GRANT CREATE ON DATABASE %I TO %I', current_database(), '__MIGRATION_ROLE__');
END
$arden_migration_temporary_database_create$;

-- Database CONNECT is the only persistent database-level permission required.
DO $arden_migration_database_connect$
BEGIN
    EXECUTE format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), '__MIGRATION_ROLE__');
END
$arden_migration_database_connect$;

DO $arden_migration_public_usage$
BEGIN
    EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', '__MIGRATION_ROLE__');
END
$arden_migration_public_usage$;

ALTER SCHEMA arden OWNER TO __MIGRATION_ROLE__;

DO $arden_migration_owner_transfer$
DECLARE
    item record;
BEGIN
    FOR item IN
        SELECT c.relname, c.relkind
          FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'arden' AND c.relkind IN ('r','p','v','m','S','f')
           AND c.relowner <> '__MIGRATION_ROLE__'::regrole
           AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass
                            AND d.objid = c.oid AND d.deptype = 'e')
         ORDER BY c.relname
    LOOP
        IF item.relkind IN ('r','p') THEN
            EXECUTE format('ALTER TABLE %I.%I OWNER TO %I', 'arden', item.relname, '__MIGRATION_ROLE__');
        ELSIF item.relkind = 'v' THEN
            EXECUTE format('ALTER VIEW %I.%I OWNER TO %I', 'arden', item.relname, '__MIGRATION_ROLE__');
        ELSIF item.relkind = 'm' THEN
            EXECUTE format('ALTER MATERIALIZED VIEW %I.%I OWNER TO %I', 'arden', item.relname, '__MIGRATION_ROLE__');
        ELSIF item.relkind = 'S' THEN
            EXECUTE format('ALTER SEQUENCE %I.%I OWNER TO %I', 'arden', item.relname, '__MIGRATION_ROLE__');
        ELSIF item.relkind = 'f' THEN
            EXECUTE format('ALTER FOREIGN TABLE %I.%I OWNER TO %I', 'arden', item.relname, '__MIGRATION_ROLE__');
        END IF;
    END LOOP;

    FOR item IN
        SELECT p.oid::regprocedure AS signature
          FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'arden' AND p.proowner <> '__MIGRATION_ROLE__'::regrole
           -- SECURITY DEFINER ownership is an execution capability, not DDL bookkeeping.
           -- Preserve the reviewed internal executor; FORCE RLS would otherwise hide
           -- the rows used by validation triggers and the indexing capability.
           AND NOT p.prosecdef
           AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass
                            AND d.objid = p.oid AND d.deptype = 'e')
         ORDER BY p.oid::regprocedure::text
    LOOP
        EXECUTE format('ALTER ROUTINE %s OWNER TO %I', item.signature, '__MIGRATION_ROLE__');
    END LOOP;

    FOR item IN
        SELECT t.typname
          FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
         WHERE n.nspname = 'arden' AND t.typtype IN ('c','d','e','r','m')
           AND t.typowner <> '__MIGRATION_ROLE__'::regrole
           AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_type'::regclass
                            AND d.objid = t.oid AND d.deptype = 'e')
         ORDER BY t.typname
    LOOP
        EXECUTE format('ALTER TYPE %I.%I OWNER TO %I', 'arden', item.typname, '__MIGRATION_ROLE__');
    END LOOP;
END
$arden_migration_owner_transfer$;

DO $arden_migration_temporary_public_create$
BEGIN
    EXECUTE format('GRANT CREATE ON SCHEMA public TO %I', '__MIGRATION_ROLE__');
END
$arden_migration_temporary_public_create$;

ALTER TABLE public.arden_schema_migrations OWNER TO __MIGRATION_ROLE__;

DO $arden_migration_revoke_database_create$
BEGIN
    EXECUTE format('REVOKE CREATE ON DATABASE %I FROM %I', current_database(), '__MIGRATION_ROLE__');
    EXECUTE format('REVOKE CREATE ON SCHEMA public FROM %I', '__MIGRATION_ROLE__');
END
$arden_migration_revoke_database_create$;

COMMIT;
