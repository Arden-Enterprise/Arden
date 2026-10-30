"""Exercise the release migration-owner handoff on the disposable CI database."""
import os
from pathlib import Path
import re
import subprocess
import sys
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "deploy" / "release"))
from management import migration_role_name, migration_role_probe_sql, valid_migration_role_probe


def main():
    container = os.environ.get("ARDEN_TEST_POSTGRES_CONTAINER", "")
    if (os.environ.get("GITHUB_ACTIONS") != "true"
            or os.environ.get("GITHUB_REPOSITORY") != "Arden-Enterprise/Arden"
            or not re.fullmatch(r"[a-f0-9]{64}", container)):
        raise ValueError("Requires this repository's disposable GitHub PostgreSQL service")

    def docker(*args, data=None, check=True):
        return subprocess.run(["docker", *args], input=data, check=check,
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=90)

    values = docker("inspect", "--format", "{{json .Config.Env}}", container).stdout.decode()
    if '"POSTGRES_DB=arden_test_ci"' not in values:
        raise ValueError("Refusing a container without the disposable test marker")

    database = "arden_test_owner_" + uuid.uuid4().hex
    role = migration_role_name("staging")
    existing = docker("exec", container, "psql", "--no-psqlrc", "-U", "postgres", "-d", "postgres",
                      "-Atq", "-c", "SELECT 1 FROM pg_roles WHERE rolname = '" + role + "'").stdout.strip()
    if existing:
        raise ValueError("The disposable CI cluster already contains the dedicated test role")

    def sql(query, expected=True):
        result = docker("exec", "-i", container, "psql", "--no-psqlrc", "-U", "postgres", "-d", database,
                        "-Atq", "-v", "ON_ERROR_STOP=1", data=query.encode(), check=False)
        if expected and result.returncode != 0:
            raise RuntimeError("Disposable PostgreSQL ownership setup failed")
        if not expected and result.returncode == 0:
            raise AssertionError("The migration role unexpectedly changed an out-of-scope object")
        return result.stdout.decode().strip()

    docker("exec", container, "psql", "--no-psqlrc", "-U", "postgres", "-d", "postgres", "-v",
           "ON_ERROR_STOP=1", "-c", f"CREATE ROLE {role} NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS "
                                      "NOCREATEDB NOCREATEROLE NOREPLICATION")
    docker("exec", container, "createdb", "-U", "postgres", "--template=template0", database)
    try:
        sql("CREATE SCHEMA arden;"
            "CREATE TABLE arden.owner_probe(id integer PRIMARY KEY, payload text);"
            "CREATE SEQUENCE arden.owner_probe_sequence;"
            "CREATE TYPE arden.owner_probe_enum AS ENUM ('active','retired');"
            "CREATE DOMAIN arden.owner_probe_domain AS text;"
            "CREATE TYPE arden.owner_probe_composite AS (label text);"
            "CREATE FUNCTION arden.owner_probe_function(integer) RETURNS integer "
            "LANGUAGE sql IMMUTABLE AS $$ SELECT $1 $$;"
            "CREATE TABLE public.arden_schema_migrations(migration_id text PRIMARY KEY, "
            "applied_at timestamptz NOT NULL DEFAULT now());"
            "CREATE TABLE public.outside_probe(id integer PRIMARY KEY);"
            "CREATE SCHEMA auth; CREATE TABLE auth.users(id integer PRIMARY KEY);")

        template = Path("deploy/release/migration-owner-template.sql").read_text(encoding="utf-8")
        template = template.replace("__EXPECTED_DATABASE__", database).replace("__MIGRATION_ROLE__", role)
        if "__EXPECTED_DATABASE__" in template or "__MIGRATION_ROLE__" in template:
            raise ValueError("Migration ownership template contains an unresolved placeholder")
        sql(template)
        docker("exec", container, "psql", "--no-psqlrc", "-U", "postgres", "-d", "postgres", "-v",
               "ON_ERROR_STOP=1", "-c", f"ALTER ROLE {role} LOGIN")

        probe = sql("SET ROLE " + role + ";\n" + migration_role_probe_sql())
        if not valid_migration_role_probe(probe, database, role):
            raise AssertionError("Migration role probe did not match the approved scope: " + probe)

        sql("SET ROLE " + role + ";"
            "CREATE TABLE arden.created_by_migration(id integer PRIMARY KEY);"
            "INSERT INTO public.arden_schema_migrations(migration_id) VALUES ('0001_probe');")
        sql("SET ROLE " + role + "; CREATE TABLE public.forbidden_probe(id integer);", expected=False)
        sql("SET ROLE " + role + "; ALTER TABLE auth.users ADD COLUMN forbidden_probe integer;", expected=False)
        sql("SET ROLE " + role + "; ALTER TABLE public.outside_probe ADD COLUMN forbidden_probe integer;",
            expected=False)
        print("PASS: temporary ownership grants were revoked; migration role can change Arden and its ledger only")
    finally:
        docker("exec", container, "dropdb", "-U", "postgres", "--if-exists", database)
        docker("exec", container, "psql", "--no-psqlrc", "-U", "postgres", "-d", "postgres", "-v",
               "ON_ERROR_STOP=1", "-c", f"DROP ROLE IF EXISTS {role}")


if __name__ == "__main__":
    main()
