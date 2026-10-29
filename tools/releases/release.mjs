import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { createReadStream, createWriteStream, readFileSync, writeFileSync,
  statSync, mkdirSync, chmodSync, existsSync, unlinkSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import { pathToFileURL } from "node:url";
import { exchange } from "./transport.mjs";
import { requestIdentity } from "./identity.mjs";
import { assertSafeExpandMigrations, fingerprintMigrationInventory, loadMigrationInventory } from "../../apps/api/migrations/inventory.mjs";

const sha = /^[0-9a-f]{40}$/;
const imageId = /^sha256:[0-9a-f]{64}$/;
const maxArchive = 512 * 1024 * 1024;

export function releaseContext(env) {
  if (env.GITHUB_REPOSITORY !== "Arden-Enterprise/Arden" || env.ARDEN_REPOSITORY_VISIBILITY !== "public"
    || env.GITHUB_EVENT_NAME !== "push" || !["staging", "main"].includes(env.GITHUB_REF_NAME)
    || !sha.test(env.GITHUB_SHA ?? "") || !/^[1-9][0-9]{0,19}$/.test(env.GITHUB_RUN_ID ?? "")
    || !/^[1-9][0-9]{0,2}$/.test(env.GITHUB_RUN_ATTEMPT ?? "")) {
    throw new Error("Only canonical public staging/main pushes can deploy");
  }
  return { environment: env.GITHUB_REF_NAME === "staging" ? "staging" : "production",
    commit: env.GITHUB_SHA, run_id: env.GITHUB_RUN_ID, attempt: Number(env.GITHUB_RUN_ATTEMPT) };
}

export function sshArguments({ host, port, user, key, hosts }) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9.-]{0,252}$/.test(host ?? "")
    || !/^[a-z_][a-z0-9_-]{0,31}$/.test(user ?? "")
    || !/^[0-9]{1,5}$/.test(port ?? "") || Number(port) < 1 || Number(port) > 65535
    || !isAbsolute(key ?? "") || !isAbsolute(hosts ?? "")) throw new Error("Invalid SSH deployment settings");
  return ["-F", "/dev/null", "-T", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes",
    "-o", `UserKnownHostsFile=${hosts}`, "-o", "GlobalKnownHostsFile=/dev/null",
    "-o", "IdentitiesOnly=yes", "-o", "ClearAllForwardings=yes", "-o", "ForwardAgent=no",
    "-o", "ConnectTimeout=20", "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=3",
    "-i", key, "-p", port, `${user}@${host}`];
}

export async function assertCurrentHead(env, getHead = async () => execFileSync("gh", ["api",
  `repos/${env.GITHUB_REPOSITORY}/git/ref/heads/${env.GITHUB_REF_NAME}`, "--jq", ".object.sha"],
{ encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()) {
  releaseContext(env);
  if ((await getHead()) !== env.GITHUB_SHA) throw new Error("This build was superseded by a newer branch head");
}

export function promotionRequest(env, tree) {
  const context = releaseContext(env);
  if (context.environment !== "production" || !sha.test(tree)) throw new Error("Invalid promotion identity");
  return { op: "promote", environment: "production", ...context, tree };
}

const migrationStatuses = new Set(["NO_PENDING", "READY", "REQUIRES_OPERATOR", "DRIFT",
  "BACKUP_NOT_READY", "BASELINE_REQUIRED", "OUTCOME_UNKNOWN", "STALE_RUN", "RECOVERY_REQUIRED"]);

export function migrationPlanRequest(env, candidate) {
  const context = releaseContext(env);
  if (!candidate || candidate.commit !== context.commit || !sha.test(candidate.tree ?? "")
    || !Array.isArray(candidate.migration_inventory)
    || fingerprintMigrationInventory(candidate.migration_inventory) !== candidate.migrations) {
    throw new Error("Migration plan source does not match this workflow commit");
  }
  return { op: "plan-migrations", environment: context.environment, commit: context.commit,
    tree: candidate.tree, run_id: context.run_id, attempt: context.attempt,
    migrations: candidate.migrations, migration_inventory: candidate.migration_inventory };
}

export function migrationReconcileRequest(env) {
  const context = releaseContext(env);
  return { op: "reconcile-migrations", environment: context.environment,
    commit: context.commit, run_id: context.run_id, attempt: context.attempt };
}

async function planMigrationsWithRecovery(env, candidate, send, getHead) {
  const request = migrationPlanRequest(env, candidate);
  let plan = await send(request);
  if (plan?.status === "RECOVERY_REQUIRED") {
    await assertCurrentHead(env, getHead);
    const result = await send(migrationReconcileRequest(env));
    if (!result || typeof result !== "object" || Array.isArray(result)
      || Object.keys(result).sort().join("\0") !== "status"
      || !["RECONCILED", "NO_PENDING"].includes(result.status)) {
      throw new Error("Migration recovery could not be verified");
    }
    await assertCurrentHead(env, getHead);
    plan = await send(request);
  }
  return assertMigrationPlan(plan);
}

export function assertMigrationPlan(plan) {
  if (!plan || typeof plan !== "object" || Array.isArray(plan)
    || Object.keys(plan).sort().join("\0") !== ["migration_ids", "status"].sort().join("\0")
    || !migrationStatuses.has(plan.status) || !Array.isArray(plan.migration_ids)
    || plan.migration_ids.length > 1000
    || plan.migration_ids.some(id => typeof id !== "string" || !/^\d{4}_[a-z0-9_]+$/.test(id))
    || new Set(plan.migration_ids).size !== plan.migration_ids.length
    || (plan.status === "NO_PENDING" && plan.migration_ids.length !== 0)
    || (plan.status === "READY" && plan.migration_ids.length === 0)) {
    throw new Error("Receiver returned an invalid migration plan");
  }
  if (plan.status !== "NO_PENDING" && plan.status !== "READY") {
    const error = new Error(`Migration plan blocked: ${plan.status}`
      + (plan.migration_ids.length ? ` (${plan.migration_ids.join(", ")})` : ""));
    error.code = "ARDEN_MIGRATION_BLOCKED";
    error.status = plan.status;
    error.migrationIds = plan.migration_ids;
    throw error;
  }
  return plan;
}

export async function executeStagingRelease(env, manifest, archive, send, getHead) {
  const context = releaseContext(env);
  if (context.environment !== "staging" || manifest?.schema !== 2
    || manifest.commit !== context.commit || manifest.run_id !== context.run_id
    || manifest.attempt !== context.attempt) throw new Error("Staging release identity is invalid");
  await assertCurrentHead(env, getHead);
  await planMigrationsWithRecovery(env, manifest, send, getHead);
  await assertCurrentHead(env, getHead);
  await send({ op: "upload", environment: "staging", manifest }, archive);
  await assertCurrentHead(env, getHead);
  return send({ op: "deploy", environment: "staging", manifest });
}

export async function executeProductionRelease(env, source, send, getHead) {
  const context = releaseContext(env);
  if (context.environment !== "production" || source?.commit !== context.commit) {
    throw new Error("Production promotion source does not match this workflow commit");
  }
  await assertCurrentHead(env, getHead);
  await planMigrationsWithRecovery(env, source, send, getHead);
  await assertCurrentHead(env, getHead);
  return send(promotionRequest(env, source.tree));
}

export async function checkReadiness(env, request) {
  const { environment } = releaseContext(env);
  const status = await request({ op: "status", environment });
  const manifest = status?.active?.manifest;
  // Operator baselines predate uploads and intentionally have no upload schema.
  const baseline = manifest != null && !Object.hasOwn(manifest, "schema")
    && status.active.eligible_for_promotion === false && sha.test(manifest.tree ?? "")
    && /^[0-9a-f]{64}$/.test(manifest.migrations ?? "")
    && ["api", "web"].every(component => imageId.test(manifest.images?.[component]?.id ?? ""));
  const recoverableMigration = status?.pending !== null && status?.pending?.phase === "migrating";
  if ((status?.pending !== null && !recoverableMigration)
    || (![1, 2].includes(manifest?.schema) && !baseline)
    || !sha.test(manifest?.commit ?? "")) {
    throw new Error("Release state needs operator inspection before building or deploying");
  }
}

export function metadata() {
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const tree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], { encoding: "utf8" }).trim();
  if (!sha.test(commit) || !sha.test(tree)) throw new Error("Invalid source revision");
  const directory = "apps/api/migrations";
  const migration_inventory = loadMigrationInventory(directory);
  assertSafeExpandMigrations(migration_inventory, directory);
  const migrations = fingerprintMigrationInventory(migration_inventory);
  return { commit, tree, migrations, migration_inventory };
}

function workspace(env) {
  if (!env.RUNNER_TEMP || !isAbsolute(env.RUNNER_TEMP)) throw new Error("A temporary runner directory is required");
  const root = join(env.RUNNER_TEMP, "arden-release");
  mkdirSync(root, { recursive: true, mode: 0o700 });
  return root;
}

function sshSettings(env, root) {
  return { host: env.DEPLOY_SSH_HOST, port: env.DEPLOY_SSH_PORT, user: env.DEPLOY_SSH_USER,
    key: join(root, "key"), hosts: join(root, "known_hosts") };
}

function prepareSsh(env, root) {
  releaseContext(env);
  const settings = sshSettings(env, root);
  sshArguments(settings);
  if (!env.DEPLOY_SSH_KEY?.includes("BEGIN OPENSSH PRIVATE KEY") || !env.DEPLOY_SSH_KNOWN_HOSTS?.trim()
    || env.DEPLOY_SSH_KNOWN_HOSTS.length > 32768) throw new Error("Missing approved deployment key or host pins");
  writeFileSync(settings.key, env.DEPLOY_SSH_KEY.trim() + "\n", { mode: 0o600 });
  writeFileSync(settings.hosts, env.DEPLOY_SSH_KNOWN_HOSTS.trim() + "\n", { mode: 0o600 });
  chmodSync(settings.key, 0o600);
  chmodSync(settings.hosts, 0o600);
}

async function rpc(env, root, request, archive) {
  const message = request.op === "status" ? request : { request, identity_token: await requestIdentity(env, request) };
  const child = spawn("ssh", sshArguments(sshSettings(env, root)), { stdio: ["pipe", "pipe", "pipe"] });
  return exchange(child, message, archive);
}

async function bundle(env, root, context = releaseContext(env)) {
  if (context.environment !== "staging") throw new Error("Production cannot build a replacement image pair");
  const source = metadata();
  if (source.commit !== context.commit) throw new Error("Checkout does not match workflow source");
  const images = {};
  for (const component of ["api", "web"]) {
    const tag = `arden-release-${component}:sha-${source.commit}`;
    images[component] = { tag };
  }
  const archive = join(root, "images.tar.gz");
  const rawArchive = join(root, "raw-images.tar.gz");
  const child = spawn("docker", ["image", "save", images.api.tag, images.web.tag], { stdio: ["ignore", "pipe", "pipe"] });
  child.stderr.resume();
  const completion = new Promise((accept, reject) => {
    child.on("error", () => reject(new Error("Image archive creation could not start")));
    child.on("close", code => code === 0 ? accept() : reject(new Error("Image archive creation failed")));
  });
  try {
    await Promise.all([pipeline(child.stdout, createGzip({ level: 3 }), createWriteStream(rawArchive, { mode: 0o600 })), completion]);
  } catch (error) { child.kill(); throw error; }
  const normalized = JSON.parse(execFileSync("python3", ["-I", "deploy/release/archive.py", rawArchive, archive],
    { encoding: "utf8", timeout: 180_000 }));
  for (const component of ["api", "web"]) {
    if (normalized[component]?.tag !== images[component].tag || !imageId.test(normalized[component]?.id ?? "")) {
      throw new Error("Portable archive identity is invalid");
    }
    images[component] = normalized[component];
  }
  unlinkSync(rawArchive);
  const size = statSync(archive).size;
  if (size <= 0 || size > maxArchive) throw new Error("Release archive exceeds approved size limit");
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(archive)) hash.update(chunk);
  const manifest = { schema: 2, ...source, run_id: context.run_id, attempt: context.attempt,
    images, archive_sha256: hash.digest("hex"), archive_size: size };
  writeFileSync(join(root, "manifest.json"), JSON.stringify(manifest), { mode: 0o600 });
  execFileSync("python3", ["-I", "deploy/release/archive.py", "verify", archive, join(root, "manifest.json")],
    { stdio: "inherit", timeout: 180_000 });
}

async function main(mode, env) {
  if (mode === "metadata") {
    const value = metadata();
    if (env.GITHUB_SHA && value.commit !== env.GITHUB_SHA) throw new Error("Checkout identity mismatch");
    if (env.GITHUB_OUTPUT) {
      const { appendFileSync } = await import("node:fs");
      appendFileSync(env.GITHUB_OUTPUT, ["commit", "tree", "migrations"].map(key => `${key}=${value[key]}\n`).join(""));
    }
    console.log(JSON.stringify(value));
    return;
  }
  const root = workspace(env);
  if (mode === "cleanup") {
    for (const name of ["key", "known_hosts", "raw-images.tar.gz", "images.tar.gz", "manifest.json"]) {
      const path = join(root, name);
      if (existsSync(path)) unlinkSync(path);
    }
    return;
  }
  if (mode === "bundle") return bundle(env, root);
  if (mode === "check-bundle") {
    await bundle(env, root, { environment: "staging", commit: metadata().commit, run_id: "1", attempt: 1 });
    execFileSync("python3", ["-I", "deploy/release/archive.py", "roundtrip", join(root, "images.tar.gz"),
      join(root, "manifest.json"), join(root, "roundtrip")], { stdio: "inherit", timeout: 180_000 });
    return;
  }
  if (!["preflight", "deploy"].includes(mode)) throw new Error("Unknown release client command");
  const context = releaseContext(env);
  prepareSsh(env, root);
  if (mode === "preflight") {
    try {
      await assertCurrentHead(env);
      await checkReadiness(env, request => rpc(env, root, request));
      console.log("Restricted deployment connection and release state are ready.");
    } finally {
      // Keep deployment credentials out of the following build/scan steps.
      for (const name of ["key", "known_hosts"]) {
        const path = join(root, name);
        if (existsSync(path)) unlinkSync(path);
      }
    }
    return;
  }
  if (context.environment === "staging") {
    const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
    if (manifest.commit !== context.commit || manifest.tree !== metadata().tree
      || manifest.run_id !== context.run_id || manifest.attempt !== context.attempt) throw new Error("Release bundle identity mismatch");
    const result = await executeStagingRelease(env, manifest, join(root, "images.tar.gz"),
      (request, archive) => rpc(env, root, request, archive));
    console.log(JSON.stringify(result));
  } else {
    const source = metadata();
    if (source.commit !== context.commit) throw new Error("Promotion checkout does not match workflow source");
    const result = await executeProductionRelease(env, source, request => rpc(env, root, request));
    console.log(JSON.stringify(result));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv[2], process.env).catch(error => {
    if (error?.code === "ARDEN_MIGRATION_BLOCKED" && migrationStatuses.has(error.status)) {
      console.error(error.message);
    } else {
      console.error("Release command failed. Check the failed stage and receiver status; no blind retries were made.");
    }
    process.exitCode = 1;
  });
}
