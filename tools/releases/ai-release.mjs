import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import {
  appendFileSync, chmodSync, createReadStream, createWriteStream, existsSync,
  mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync,
} from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import { pathToFileURL } from "node:url";
import { exchange } from "./transport.mjs";
import { requestAiIdentity } from "./ai-identity.mjs";

const sha = /^[0-9a-f]{40}$/;
const imageId = /^sha256:[0-9a-f]{64}$/;
const maxArchive = 1024 * 1024 * 1024;
const stagingFreshnessSeconds = 86_400;
const aiExchangeTimeoutMs = 30 * 60 * 1000;

export function aiReleaseContext(env) {
  const branch = env.GITHUB_REF_NAME;
  const event = env.GITHUB_EVENT_NAME;
  const allowedEvent = (branch === "staging" && ["push", "workflow_dispatch"].includes(event))
    || (branch === "main" && event === "push");
  if (env.GITHUB_REPOSITORY !== "Arden-Enterprise/Arden"
    || env.ARDEN_REPOSITORY_VISIBILITY !== "public"
    || !allowedEvent
    || !sha.test(env.GITHUB_SHA ?? "")
    || !/^[1-9][0-9]{0,19}$/.test(env.GITHUB_RUN_ID ?? "")
    || !/^[1-9][0-9]{0,2}$/.test(env.GITHUB_RUN_ATTEMPT ?? "")) {
    throw new Error("Only canonical public staging/main AI release runs can deploy");
  }
  return {
    environment: branch === "staging" ? "staging" : "production",
    commit: env.GITHUB_SHA,
    run_id: env.GITHUB_RUN_ID,
    attempt: Number(env.GITHUB_RUN_ATTEMPT),
  };
}

export function sshArguments({ host, port, user, key, hosts }) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9.-]{0,252}$/.test(host ?? "")
    || !/^[a-z_][a-z0-9_-]{0,31}$/.test(user ?? "")
    || !/^[0-9]{1,5}$/.test(port ?? "") || Number(port) < 1 || Number(port) > 65535
    || !isAbsolute(key ?? "") || !isAbsolute(hosts ?? "")) {
    throw new Error("Invalid AI SSH deployment settings");
  }
  return [
    "-F", "/dev/null", "-T",
    "-o", "BatchMode=yes",
    "-o", "StrictHostKeyChecking=yes",
    "-o", `UserKnownHostsFile=${hosts}`,
    "-o", "GlobalKnownHostsFile=/dev/null",
    "-o", "IdentitiesOnly=yes",
    "-o", "ClearAllForwardings=yes",
    "-o", "ForwardAgent=no",
    "-o", "ConnectTimeout=20",
    "-o", "ServerAliveInterval=15",
    "-o", "ServerAliveCountMax=6",
    "-i", key, "-p", port, `${user}@${host}`,
  ];
}

export async function assertCurrentHead(
  env,
  getHead = async () => execFileSync("gh", [
    "api", `repos/${env.GITHUB_REPOSITORY}/git/ref/heads/${env.GITHUB_REF_NAME}`, "--jq", ".object.sha",
  ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(),
) {
  aiReleaseContext(env);
  if ((await getHead()) !== env.GITHUB_SHA) {
    throw new Error("This AI build was superseded by a newer branch head");
  }
}

export function planPromotionRequest(env, aiTree) {
  const context = aiReleaseContext(env);
  if (context.environment !== "production" || !sha.test(aiTree ?? "")) {
    throw new Error("Invalid AI promotion plan identity");
  }
  return { op: "plan-promote", environment: "production", ...context, ai_tree: aiTree };
}

export function promotionRequest(env, aiTree) {
  const context = aiReleaseContext(env);
  if (context.environment !== "production" || !sha.test(aiTree ?? "")) {
    throw new Error("Invalid AI promotion identity");
  }
  return { op: "promote", environment: "production", ...context, ai_tree: aiTree };
}

export function checkAiReadiness(env, status) {
  aiReleaseContext(env);
  const manifest = status?.active?.manifest;
  const baseline = manifest != null
    && !Object.hasOwn(manifest, "schema")
    && status.active.eligible_for_promotion === false
    && sha.test(manifest.commit ?? "")
    && sha.test(manifest.ai_tree ?? "")
    && imageId.test(manifest.images?.ai?.id ?? "");
  if (status?.pending !== null
    || (manifest?.schema !== 1 && !baseline)
    || !sha.test(manifest?.commit ?? "")
    || !sha.test(manifest?.ai_tree ?? "")) {
    throw new Error("AI release state needs operator inspection before building or deploying");
  }
  return status;
}

export function isStagingUpToDate(status, {
  ai_tree,
  toolingChanged = false,
  forceDeploy = false,
  now = Math.floor(Date.now() / 1000),
}) {
  if (forceDeploy || toolingChanged || !sha.test(ai_tree ?? "")) return false;
  if (status?.pending !== null) return false;
  const active = status?.active;
  if (!active || active.eligible_for_promotion !== true) return false;
  if (active.manifest?.schema !== 1 || active.manifest?.ai_tree !== ai_tree) return false;
  if (typeof active.verified_at !== "number" || !Number.isFinite(active.verified_at)) return false;
  return active.verified_at >= now - stagingFreshnessSeconds && active.verified_at <= now + 60;
}

export async function executeStagingAiRelease(env, manifest, archive, send, getHead) {
  const context = aiReleaseContext(env);
  if (context.environment !== "staging" || manifest?.schema !== 1
    || manifest.commit !== context.commit || manifest.run_id !== context.run_id
    || manifest.attempt !== context.attempt || !sha.test(manifest.ai_tree ?? "")) {
    throw new Error("Staging AI release identity is invalid");
  }
  await assertCurrentHead(env, getHead);
  await send({ op: "upload", environment: "staging", manifest }, archive);
  await assertCurrentHead(env, getHead);
  return send({ op: "deploy", environment: "staging", manifest });
}

export async function executeProductionAiRelease(env, source, send, getHead) {
  const context = aiReleaseContext(env);
  if (context.environment !== "production" || source?.commit !== context.commit || !sha.test(source?.ai_tree ?? "")) {
    throw new Error("Production AI promotion source does not match this workflow commit");
  }
  await assertCurrentHead(env, getHead);
  const plan = await send(planPromotionRequest(env, source.ai_tree));
  if (plan?.status === "ALREADY_CURRENT") {
    return { status: "already-current", commit: source.commit, ai_tree: source.ai_tree };
  }
  if (plan?.status !== "READY") {
    throw new Error(`Production AI promotion blocked: ${plan?.status ?? "UNKNOWN"}`);
  }
  await assertCurrentHead(env, getHead);
  return send(promotionRequest(env, source.ai_tree));
}

export function aiMetadata() {
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const ai_tree = execFileSync("git", ["rev-parse", "HEAD:services/ai"], { encoding: "utf8" }).trim();
  if (!sha.test(commit) || !sha.test(ai_tree)) throw new Error("Invalid AI source revision");
  return { commit, ai_tree };
}

function workspace(env) {
  if (!env.RUNNER_TEMP || !isAbsolute(env.RUNNER_TEMP)) {
    throw new Error("A temporary runner directory is required");
  }
  const root = join(env.RUNNER_TEMP, "arden-release-ai");
  mkdirSync(root, { recursive: true, mode: 0o700 });
  return root;
}

function sshSettings(env, root) {
  return {
    host: env.DEPLOY_AI_SSH_HOST,
    port: env.DEPLOY_AI_SSH_PORT,
    user: env.DEPLOY_AI_SSH_USER,
    key: join(root, "key"),
    hosts: join(root, "known_hosts"),
  };
}

function prepareSsh(env, root) {
  aiReleaseContext(env);
  const settings = sshSettings(env, root);
  sshArguments(settings);
  if (!env.DEPLOY_AI_SSH_KEY?.includes("BEGIN OPENSSH PRIVATE KEY")
    || !env.DEPLOY_AI_SSH_KNOWN_HOSTS?.trim()
    || env.DEPLOY_AI_SSH_KNOWN_HOSTS.length > 32768) {
    throw new Error("Missing approved AI deployment key or host pins");
  }
  writeFileSync(settings.key, env.DEPLOY_AI_SSH_KEY.trim() + "\n", { mode: 0o600 });
  writeFileSync(settings.hosts, env.DEPLOY_AI_SSH_KNOWN_HOSTS.trim() + "\n", { mode: 0o600 });
  chmodSync(settings.key, 0o600);
  chmodSync(settings.hosts, 0o600);
}

function clearSshFiles(root) {
  for (const name of ["key", "known_hosts"]) {
    const path = join(root, name);
    if (existsSync(path)) unlinkSync(path);
  }
}

async function rpc(env, root, request, archive) {
  const message = request.op === "status"
    ? request
    : { request, identity_token: await requestAiIdentity(env, request) };
  const child = spawn("ssh", sshArguments(sshSettings(env, root)), { stdio: ["pipe", "pipe", "pipe"] });
  return exchange(child, message, archive, aiExchangeTimeoutMs);
}

async function bundle(env, root, context = aiReleaseContext(env)) {
  if (context.environment !== "staging") {
    throw new Error("Production cannot build a replacement AI image");
  }
  const source = aiMetadata();
  if (source.commit !== context.commit) throw new Error("Checkout does not match workflow source");
  const tag = `arden-release-ai:sha-${source.commit}`;
  const archive = join(root, "ai-image.tar.gz");
  const rawArchive = join(root, "raw-ai-image.tar.gz");
  const child = spawn("docker", ["image", "save", tag], { stdio: ["ignore", "pipe", "pipe"] });
  child.stderr.resume();
  const completion = new Promise((accept, reject) => {
    child.on("error", () => reject(new Error("AI image archive creation could not start")));
    child.on("close", code => (code === 0 ? accept() : reject(new Error("AI image archive creation failed"))));
  });
  try {
    await Promise.all([
      pipeline(child.stdout, createGzip({ level: 3 }), createWriteStream(rawArchive, { mode: 0o600 })),
      completion,
    ]);
  } catch (error) {
    child.kill();
    throw error;
  }
  const normalized = JSON.parse(execFileSync("python3", ["-I", "deploy/release-ai/archive.py", rawArchive, archive], {
    encoding: "utf8",
    timeout: 360_000,
  }));
  if (normalized?.ai?.tag !== tag || !imageId.test(normalized?.ai?.id ?? "")) {
    throw new Error("Portable AI archive identity is invalid");
  }
  unlinkSync(rawArchive);
  const size = statSync(archive).size;
  if (size <= 0 || size > maxArchive) {
    throw new Error(`AI release archive (${size} bytes) exceeds approved 1024 MiB limit`);
  }
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(archive)) hash.update(chunk);
  const manifest = {
    schema: 1,
    commit: source.commit,
    ai_tree: source.ai_tree,
    run_id: context.run_id,
    attempt: context.attempt,
    images: { ai: normalized.ai },
    archive_sha256: hash.digest("hex"),
    archive_size: size,
  };
  writeFileSync(join(root, "manifest.json"), JSON.stringify(manifest), { mode: 0o600 });
  execFileSync("python3", ["-I", "deploy/release-ai/archive.py", "verify", archive, join(root, "manifest.json")], {
    stdio: "inherit",
    timeout: 360_000,
  });
  console.log(`Prepared verified AI release archive (${Math.round(size / (1024 * 1024))} MiB).`);
}

function writeOutput(env, pairs) {
  if (!env.GITHUB_OUTPUT) return;
  const lines = Object.entries(pairs).map(([k, v]) => `${k}=${v}\n`).join("");
  appendFileSync(env.GITHUB_OUTPUT, lines);
}

async function main(mode, env) {
  if (mode === "metadata") {
    const value = aiMetadata();
    if (env.GITHUB_SHA && value.commit !== env.GITHUB_SHA) throw new Error("Checkout identity mismatch");
    writeOutput(env, value);
    console.log(JSON.stringify(value));
    return;
  }
  const root = workspace(env);
  if (mode === "cleanup") {
    for (const name of ["key", "known_hosts", "raw-ai-image.tar.gz", "ai-image.tar.gz", "manifest.json"]) {
      const path = join(root, name);
      if (existsSync(path)) unlinkSync(path);
    }
    return;
  }
  if (mode === "bundle") return bundle(env, root);
  if (mode === "check-bundle") {
    await bundle(env, root, { environment: "staging", commit: aiMetadata().commit, run_id: "1", attempt: 1 });
    execFileSync("python3", [
      "-I", "deploy/release-ai/archive.py", "roundtrip",
      join(root, "ai-image.tar.gz"), join(root, "manifest.json"), join(root, "roundtrip"),
    ], { stdio: "inherit", timeout: 360_000 });
    return;
  }
  if (!["preflight", "deploy"].includes(mode)) throw new Error("Unknown AI release client command");
  const context = aiReleaseContext(env);
  const source = aiMetadata();
  if (source.commit !== context.commit) throw new Error("Checkout does not match workflow source");
  prepareSsh(env, root);
  if (mode === "preflight") {
    try {
      await assertCurrentHead(env);
      const status = checkAiReadiness(env, await rpc(env, root, { op: "status", environment: context.environment }));
      if (context.environment === "staging") {
        const upToDate = isStagingUpToDate(status, {
          ai_tree: source.ai_tree,
          toolingChanged: env.ARDEN_AI_TOOLING_CHANGED === "true",
          forceDeploy: env.ARDEN_AI_FORCE_DEPLOY === "true",
        });
        const action = upToDate ? "up_to_date" : "deploy";
        writeOutput(env, { deploy_action: action, ai_tree: source.ai_tree });
        console.log(`Staging AI preflight complete: deploy_action=${action}.`);
      } else {
        const plan = await rpc(env, root, planPromotionRequest(env, source.ai_tree));
        if (plan?.status === "ALREADY_CURRENT") {
          writeOutput(env, { deploy_action: "already_current", ai_tree: source.ai_tree });
          console.log("Production AI preflight complete: deploy_action=already_current.");
        } else if (plan?.status === "READY") {
          writeOutput(env, { deploy_action: "promote", ai_tree: source.ai_tree });
          console.log("Production AI preflight complete: deploy_action=promote.");
        } else {
          throw new Error(`Production AI preflight blocked: ${plan?.status ?? "UNKNOWN"}`);
        }
      }
    } finally {
      clearSshFiles(root);
    }
    return;
  }
  try {
    if (context.environment === "staging") {
      const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
      if (manifest.commit !== context.commit || manifest.ai_tree !== source.ai_tree
        || manifest.run_id !== context.run_id || manifest.attempt !== context.attempt) {
        throw new Error("AI release bundle identity mismatch");
      }
      const result = await executeStagingAiRelease(
        env, manifest, join(root, "ai-image.tar.gz"), (req, archive) => rpc(env, root, req, archive),
      );
      console.log(JSON.stringify(result));
    } else {
      const result = await executeProductionAiRelease(
        env, source, req => rpc(env, root, req),
      );
      console.log(JSON.stringify(result));
    }
  } finally {
    clearSshFiles(root);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv[2], process.env).catch(error => {
    console.error("AI release command failed. Check the failed stage and receiver status; no blind retries were made.");
    if (error?.message?.startsWith("Production AI")) console.error(error.message);
    process.exitCode = 1;
  });
}
