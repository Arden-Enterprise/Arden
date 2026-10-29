"""Rehearse the 0017 -> 0021 schema upgrade and scoped restore on a disposable CI DB.

This is verification, not a release/migration command. It accepts only the
GitHub job's PostgreSQL service and creates its own unpredictable test database.
No backup is published or retained outside the temporary runner.
"""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import uuid


def main():
    container = os.environ.get("ARDEN_TEST_POSTGRES_CONTAINER", "")
    if (os.environ.get("GITHUB_ACTIONS") != "true"
            or os.environ.get("GITHUB_REPOSITORY") != "Arden-Enterprise/Arden"
            or not re.fullmatch(r"[a-f0-9]{64}", container)):
        raise ValueError("Requires this repository's disposable GitHub PostgreSQL service")

    def docker(*args, data=None):
        return subprocess.run(["docker", *args], input=data, check=True,
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=90).stdout

    values = json.loads(docker("inspect", "--format", "{{json .Config.Env}}", container))
    if "POSTGRES_DB=arden_test_ci" not in values:
        raise ValueError("Refusing a container without the disposable test marker")
    database = "arden_test_recovery_" + uuid.uuid4().hex

    def sql(query):
        return docker("exec", "-i", container, "psql", "--no-psqlrc", "-U", "postgres",
                      "-d", database, "-Atq", "-v", "ON_ERROR_STOP=1", data=query.encode())

    def snapshot():
        # Every selected table, including the migration ledger, compared by value.
        tables = sql("SELECT quote_ident(schemaname)||'.'||quote_ident(tablename) FROM pg_tables "
                     "WHERE schemaname='arden' OR (schemaname='public' AND "
                     "tablename='arden_schema_migrations') ORDER BY 1;").decode().splitlines()
        result = {}
        for table in tables:
            rows = sql(f"SELECT row_to_json(t)::text FROM {table} t ORDER BY row_to_json(t)::text;")
            result[table] = hashlib.sha256(rows).hexdigest()
        return result

    migrations = sorted(Path("apps/api/migrations").glob("[0-9][0-9][0-9][0-9]_*.sql"))
    if [p.name[:4] for p in migrations] != [f"{n:04}" for n in range(1, 22)]:
        raise ValueError("Revisit this bounded rehearsal before changing migration inventory")
    spec = importlib.util.spec_from_file_location('publication_upgrade', 'deploy/release/publication_upgrade.py')
    upgrade = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(upgrade)
    grouped = upgrade.render_upgrade([{'name': p.name, 'sql': p.read_text(encoding='utf-8')} for p in migrations])

    def migration_sql(paths):
        return "\n".join(p.read_text(encoding="utf-8") + "\nINSERT INTO public.arden_schema_migrations "
                         f"(migration_id) VALUES ('{p.stem}');" for p in paths)

    docker("exec", container, "createdb", "-U", "postgres", "--template=template0", database)
    try:
        sql("BEGIN; CREATE TABLE public.arden_schema_migrations (migration_id text PRIMARY KEY, "
            "applied_at timestamptz NOT NULL DEFAULT now());\n" + migration_sql(migrations[:17]) + "\nCOMMIT;")
        sql("INSERT INTO arden.organization(organization_id,name,slug) VALUES "
            "('10000000-0000-4000-8000-000000000001','Synthetic recovery fixture','restore-fixture');"
            "INSERT INTO arden.knowledge_base(organization_id,name,scope_type) VALUES "
            "('10000000-0000-4000-8000-000000000001','Disposable content','ORGANIZATION');"
            "CREATE TABLE public.outside_restore_boundary(value text);"
            "INSERT INTO public.outside_restore_boundary VALUES ('preserve-external-service');")
        before = snapshot()
        # pg_dump --table overrides --schema; use two independently complete
        # archives, then restore both inside the same transaction.
        backup = docker("exec", container, "pg_dump", "-U", "postgres", "-d", database,
                        "--format=custom", "--schema=arden")
        ledger = docker("exec", container, "pg_dump", "-U", "postgres", "-d", database,
                        "--format=custom", "--table=public.arden_schema_migrations")
        listing = docker("exec", "-i", container, "pg_restore", "--list", data=backup)
        assert b"SCHEMA - arden" in listing and b"knowledge_base" in listing
        assert b"arden_schema_migrations" in docker("exec", "-i", container, "pg_restore", "--list", data=ledger)
        # Failure before commit must preserve the complete old schema and data.
        try:
            sql(grouped.removesuffix('COMMIT;\n') + "SELECT 1/0; COMMIT;\n")
            raise AssertionError("Expected failed migration rehearsal")
        except subprocess.CalledProcessError:
            assert snapshot() == before, "Failed transaction changed baseline"
        sql(grouped)
        assert sql("SELECT count(*) FROM arden.knowledge_base;").strip() == b"0"
        assert sql("SELECT count(*) FROM public.arden_schema_migrations;").strip() == b"21"
        assert sql("SELECT count(*) FROM arden.organization;").strip() == b"1"
        # Recover only Arden and its ledger, keeping the external service probe.
        restore = docker("exec", "-i", container, "pg_restore", "--file=-", data=backup)
        restore += docker("exec", "-i", container, "pg_restore", "--file=-", data=ledger)
        sql("BEGIN; DROP SCHEMA arden CASCADE; DROP TABLE public.arden_schema_migrations;\n"
            + restore.decode("utf-8") + "\nCOMMIT;")
        assert snapshot() == before, "Restored data/ledger differs from baseline"
        assert sql("SELECT value FROM public.outside_restore_boundary;").strip() == b"preserve-external-service"
        assert sql("SELECT to_regclass('arden.knowledge_index_generation') IS NULL;").strip() == b"t"
        assert sql("SELECT count(*) FROM pg_trigger WHERE tgname='trg_audit_event_append_only';").strip() == b"1"
        print("PASS: atomic upgrade failure, 0017->0021 reset, exact table/ledger restore, external boundary preserved")
    finally:
        docker("exec", container, "dropdb", "-U", "postgres", database)


if __name__ == "__main__":
    main()
