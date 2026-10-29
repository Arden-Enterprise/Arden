// Every database, image and fixture belongs to this temporary hosted runner.
import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve, sep } from "node:path";

const source = JSON.parse(execFileSync(process.execPath, ["tools/releases/release.mjs", "metadata"], { encoding: "utf8" }));
const runnerTemp = process.env.RUNNER_TEMP;
if (!runnerTemp || !isAbsolute(runnerTemp)) throw new Error("Disposable release smoke requires the hosted runner temp directory");
const prefix = `arden-smoke-${randomBytes(6).toString("hex")}`;
const names = { db: `${prefix}-db`, api: `${prefix}-api`, web: `${prefix}-web` };
const docker = (...args) => {
  try {
    return execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 5 * 60_000 }).trim();
  } catch {
    // Docker arguments can contain disposable database credentials. Keep them out of CI logs.
    throw new Error(`Disposable Docker operation failed (${args[0]} ${args[1]})`);
  }
};
const apiImage = `arden-release-api:sha-${source.commit}`;
const webImage = `arden-release-web:sha-${source.commit}`;
const sleep = ms => new Promise(resolveSleep => setTimeout(resolveSleep, ms));
const migrationDirectory = mkdtempSync(join(resolve(runnerTemp), `${prefix}-migration-`));
if (!migrationDirectory.startsWith(`${resolve(runnerTemp)}${sep}`)) throw new Error("Migration fixture escaped runner temp");

function expectMigrationResult(containerArgs, expectedStatus, expectedIds = []) {
  let result;
  try { result = JSON.parse(docker(...containerArgs)); }
  catch { throw new Error(`Disposable migration command returned invalid output (${expectedStatus})`); }
  if (result.status !== expectedStatus || JSON.stringify(result.migration_ids) !== JSON.stringify(expectedIds)) {
    throw new Error(`Disposable migration command returned an unexpected result (${expectedStatus})`);
  }
}

async function healthy(name) {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (docker("inspect", "--format", "{{if .State.Health}}{{.State.Health.Status}}{{end}}", name) === "healthy") return;
    await sleep(1000);
  }
  throw new Error("Disposable image failed its health check");
}

const migrationId = "0001_smoke_create_probe";
const migrationFilename = `${migrationId}.sql`;
const migrationSql = "CREATE TABLE public.arden_safe_migration_smoke (id integer PRIMARY KEY);\n";
const migrationChecksum = createHash("sha256").update(migrationSql).digest("hex");
writeFileSync(join(migrationDirectory, migrationFilename), migrationSql, { mode: 0o644 });
writeFileSync(join(migrationDirectory, "release-policy.json"), JSON.stringify({ schema: 1, migrations: [
  { id: "0001", filename: migrationFilename, sha256: migrationChecksum, rollout: "expand" },
] }), { mode: 0o644 });
chmodSync(migrationDirectory, 0o755);

try {
  docker("network", "create", prefix);
  docker("run", "-d", "--name", names.db, "--network", prefix, "--network-alias", "db",
    "-p", "127.0.0.1::5432", "--tmpfs", "/var/lib/postgresql/data:rw,nosuid,nodev",
    "-e", "POSTGRES_DB=arden_test_images", "-e", "POSTGRES_PASSWORD=disposable_ci_only",
    "--health-cmd", "pg_isready -U postgres", "--health-interval", "1s", "--health-retries", "60",
    "pgvector/pgvector:pg17-bookworm@sha256:ac08538c6f8b9904c33c8224c5e5706dbe760aca29db1d096972b4052c22a75d");
  await healthy(names.db);

  const databasePort = docker("inspect", "--format", '{{(index (index .NetworkSettings.Ports "5432/tcp") 0).HostPort}}', names.db);
  if (!/^[1-9][0-9]{0,4}$/.test(databasePort) || Number(databasePort) > 65535) throw new Error("Invalid disposable PostgreSQL port");
  docker("run", "--rm", "--network", "host", "--read-only", "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges:true", "--tmpfs", "/tmp:rw,nosuid,nodev,size=32m",
    "-e", "NODE_ENV=development",
    "-e", `ARDEN_MIGRATION_DATABASE_URL=postgresql://postgres:disposable_ci_only@127.0.0.1:${databasePort}/arden_test_images`,
    apiImage, "node", "dist/db/migrate.js", "--local-full");
  docker("exec", names.db, "psql", "-U", "postgres", "-d", "arden_test_images", "-v", "ON_ERROR_STOP=1", "-c",
    "CREATE ROLE arden_api LOGIN PASSWORD 'disposable_runtime_only' NOSUPERUSER NOCREATEDB NOCREATEROLE; GRANT arden_runtime TO arden_api;");

  docker("exec", names.db, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c",
    "CREATE ROLE arden_migration_smoke LOGIN PASSWORD 'disposable_migration_only' NOSUPERUSER NOCREATEDB NOCREATEROLE;");
  docker("exec", names.db, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c",
    "CREATE DATABASE arden_migration_smoke;");
  docker("exec", names.db, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c",
    "GRANT CONNECT ON DATABASE arden_migration_smoke TO arden_migration_smoke;");
  docker("exec", names.db, "psql", "-U", "postgres", "-d", "arden_migration_smoke", "-v", "ON_ERROR_STOP=1", "-c",
    "GRANT CREATE ON SCHEMA public TO arden_migration_smoke; CREATE TABLE public.arden_schema_migrations (migration_id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now(), checksum text NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$')); ALTER TABLE public.arden_schema_migrations OWNER TO arden_migration_smoke;");
  const migrationRole = docker("exec", names.db, "psql", "-U", "postgres", "-d", "arden_migration_smoke", "-At", "-v", "ON_ERROR_STOP=1", "-c",
    "SELECT rolsuper::text || '|' || rolcreatedb::text || '|' || rolcreaterole::text || '|' || (SELECT (pg_get_userbyid(datdba) <> 'arden_migration_smoke')::text FROM pg_database WHERE datname='arden_migration_smoke') FROM pg_roles WHERE rolname='arden_migration_smoke';");
  if (migrationRole !== "false|false|false|true") throw new Error("Disposable migration role exceeded its restricted database grants");

  const migrationImageArgs = ["run", "--rm", "--network", prefix, "--read-only", "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges:true", "--tmpfs", "/tmp:rw,nosuid,nodev,size=32m",
    "-v", `${migrationDirectory}:/app/migrations:ro`,
    "-e", "NODE_ENV=production",
    "-e", "ARDEN_MIGRATION_DATABASE_URL=postgresql://arden_migration_smoke:disposable_migration_only@db:5432/arden_migration_smoke",
    apiImage, "node", "dist/db/migrate.js"];
  expectMigrationResult([...migrationImageArgs, "--plan"], "READY", [migrationId]);
  expectMigrationResult([...migrationImageArgs, "--apply-safe"], "APPLIED", [migrationId]);
  expectMigrationResult([...migrationImageArgs, "--apply-safe"], "NO_PENDING");
  expectMigrationResult([...migrationImageArgs, "--plan"], "NO_PENDING");
  const applied = docker("exec", names.db, "psql", "-U", "postgres", "-d", "arden_migration_smoke", "-At", "-v", "ON_ERROR_STOP=1", "-c",
    "SELECT migration_id || '|' || checksum FROM public.arden_schema_migrations; SELECT 'TABLE|' || tableowner FROM pg_tables WHERE schemaname='public' AND tablename='arden_safe_migration_smoke';");
  if (!applied.includes(`${migrationId}|${migrationChecksum}`) || !applied.includes("TABLE|arden_migration_smoke")) {
    throw new Error("Disposable migration ledger or restricted-owner check failed");
  }

  docker("run", "-d", "--name", names.api, "--network", prefix, "--network-alias", "arden-api",
    "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true",
    "--tmpfs", "/tmp:rw,nosuid,nodev,size=64m", "--tmpfs", "/var/lib/arden/private:rw,nosuid,nodev,uid=1000,gid=1000,size=32m",
    "-e", "DATABASE_URL=postgresql://arden_api:disposable_runtime_only@db:5432/arden_test_images",
    "-e", "SUPABASE_URL=http://127.0.0.1:1", "-e", "SUPABASE_PUBLISHABLE_KEY=synthetic-not-a-live-key",
    "-e", "SUPABASE_AUTH_PUBLIC_URL=https://auth.example.test",
    "-e", "ARDEN_AUTH_TRUSTED_ORIGINS=https://example.test", "-e", "ARDEN_PRIVATE_STORAGE_ROOT=/var/lib/arden/private", apiImage);
  await healthy(names.api);
  docker("run", "-d", "--name", names.web, "--network", prefix, "--read-only", "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges:true", "--tmpfs", "/tmp:rw,nosuid,nodev,size=32m",
    "-p", "127.0.0.1::8080", webImage);
  await healthy(names.web);
  const port = docker("inspect", "--format", '{{(index (index .NetworkSettings.Ports "8080/tcp") 0).HostPort}}', names.web);
  if (!/^[1-9][0-9]{0,4}$/.test(port) || Number(port) > 65535) throw new Error("Invalid disposable web port mapping");
  const origin = `http://127.0.0.1:${port}`;
  const home = await fetch(origin);
  if (!home.ok || !(await home.text()).toLowerCase().includes("<!doctype html")) throw new Error("Web image has no application");
  const version = await (await fetch(`${origin}/release.json`)).json();
  if (version.commit !== source.commit || version.tree !== source.tree) throw new Error("Image source identity mismatch");
  const ready = await (await fetch(`${origin}/api/health/ready`)).json();
  if (ready.status !== "ok" || (await fetch(`${origin}/api/v1/me`)).status !== 401) throw new Error("API readiness/denial failed");
  for (const path of ["/", "/release.json", "/healthz", "/assets/missing.js", "/api/v1/me", "/auth/missing", "/verify",
    "/api/v1/organizations/00000000-0000-0000-0000-000000000000/knowledge/drafts/pdf"]) {
    const response = await fetch(`${origin}${path}`);
    if (response.headers.get("x-content-type-options") !== "nosniff") throw new Error(`Missing or duplicate nosniff header: ${path}`);
    await response.body?.cancel();
  }
  console.log("Disposable built-image smoke passed: full-chain schema, restricted migration role, plan/apply/no-op, runtime startup, web identity and anonymous denial.");
} finally {
  for (const name of Object.values(names)) {
    try { docker("rm", "--force", "--volumes", name); } catch { /* only this disposable runner fixture */ }
  }
  try { docker("network", "rm", prefix); } catch { /* only this disposable runner network */ }
  rmSync(migrationDirectory, { recursive: true, force: true });
}
