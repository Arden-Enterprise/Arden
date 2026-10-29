// Real image boundary check. Every resource belongs to this temporary hosted runner.
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
const source = JSON.parse(execFileSync(process.execPath, ["tools/releases/release.mjs", "metadata"], { encoding: "utf8" }));
const prefix = `arden-smoke-${randomBytes(6).toString("hex")}`;
const names = { db: `${prefix}-db`, api: `${prefix}-api`, web: `${prefix}-web` };
const docker = (...args) => execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 90_000 }).trim();
const apiImage = `arden-release-api:sha-${source.commit}`;
const webImage = `arden-release-web:sha-${source.commit}`;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function healthy(name) {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (docker("inspect", "--format", "{{if .State.Health}}{{.State.Health.Status}}{{end}}", name) === "healthy") return;
    await sleep(1000);
  }
  throw new Error("Disposable image failed its health check");
}
try {
  docker("network", "create", prefix);
  docker("run", "-d", "--name", names.db, "--network", prefix, "--network-alias", "db",
    "--tmpfs", "/var/lib/postgresql/data:rw,nosuid,nodev", "-e", "POSTGRES_DB=arden_test_images",
    "-e", "POSTGRES_PASSWORD=disposable_ci_only", "--health-cmd", "pg_isready -U postgres",
    "--health-interval", "1s", "--health-retries", "60",
    "pgvector/pgvector:pg17-bookworm@sha256:ac08538c6f8b9904c33c8224c5e5706dbe760aca29db1d096972b4052c22a75d");
  await healthy(names.db);
  docker("run", "--rm", "--network", prefix, "-e",
    "ARDEN_MIGRATION_DATABASE_URL=postgresql://postgres:disposable_ci_only@db:5432/arden_test_images",
    apiImage, "node", "dist/db/migrate.js");
  docker("exec", names.db, "psql", "-U", "postgres", "-d", "arden_test_images", "-v", "ON_ERROR_STOP=1", "-c",
    "CREATE ROLE arden_api LOGIN PASSWORD 'disposable_runtime_only' NOSUPERUSER NOCREATEDB NOCREATEROLE; GRANT arden_runtime TO arden_api;");
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
  if (!/^\d{1,5}$/.test(port)) throw new Error("Invalid disposable port mapping");
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
  console.log("Disposable built-image smoke passed: migrations, non-superuser runtime, web identity, API readiness and anonymous denial.");
} finally {
  for (const name of Object.values(names)) {
    try { docker("rm", "--force", "--volumes", name); } catch { /* only these disposable runner fixtures */ }
  }
  try { docker("network", "rm", prefix); } catch { /* runner lifetime is the final boundary */ }
}
