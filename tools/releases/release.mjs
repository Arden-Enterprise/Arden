import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { createReadStream, createWriteStream, readFileSync, writeFileSync, readdirSync,
  statSync, mkdirSync, chmodSync, existsSync, unlinkSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import { pathToFileURL } from "node:url";
import { exchange } from "./transport.mjs";

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
    "-o", "ConnectTimeout=20", "-i", key, "-p", port, `${user}@${host}`];
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

function metadata() {
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const tree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], { encoding: "utf8" }).trim();
  if (!sha.test(commit) || !sha.test(tree)) throw new Error("Invalid source revision");
  const directory = "apps/api/migrations";
  const files = readdirSync(directory).filter(name => /^\d{4}_[a-z0-9_]+\.sql$/.test(name)).sort();
  if (!files.length) throw new Error("Missing migration inventory");
  const inventory = files.map(name => ({ name, sha256: createHash("sha256").update(readFileSync(join(directory, name))).digest("hex") }));
  const migrations = createHash("sha256").update(JSON.stringify(inventory)).digest("hex");
  return { commit, tree, migrations };
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
  const child = spawn("ssh", sshArguments(sshSettings(env, root)), { stdio: ["pipe", "pipe", "pipe"] });
  return exchange(child, request, archive);
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
  const manifest = { schema: 1, ...source, run_id: context.run_id, attempt: context.attempt,
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
      appendFileSync(env.GITHUB_OUTPUT, Object.entries(value).map(([key, data]) => `${key}=${data}\n`).join(""));
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
  if (mode !== "deploy") throw new Error("Unknown release client command");
  const context = releaseContext(env);
  prepareSsh(env, root);
  await assertCurrentHead(env);
  if (context.environment === "staging") {
    const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
    if (manifest.commit !== context.commit || manifest.tree !== metadata().tree
      || manifest.run_id !== context.run_id || manifest.attempt !== context.attempt) throw new Error("Release bundle identity mismatch");
    await rpc(env, root, { op: "upload", environment: "staging", manifest }, join(root, "images.tar.gz"));
    await assertCurrentHead(env);
    console.log(JSON.stringify(await rpc(env, root, { op: "deploy", environment: "staging", manifest })));
  } else {
    console.log(JSON.stringify(await rpc(env, root, promotionRequest(env, metadata().tree))));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv[2], process.env).catch(() => {
    console.error("Release command failed. Check the failed stage and receiver status; no blind retries were made.");
    process.exitCode = 1;
  });
}
