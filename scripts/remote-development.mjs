import { createHash, randomUUID } from "node:crypto";
import { access, readFile, readdir, stat } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const remoteConfigPath = path.join(repositoryRoot, ".private", "remote.json");
const allowedRootFiles = ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "tsconfig.base.json"];
const allowedPackageRoots = ["apps/api", "packages/domain", "packages/db", "packages/ai", "packages/api-client"];
const uploadExtensions = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".yaml", ".yml", ".sql"]);
const excludedDirectories = new Set(["node_modules", "dist", "out", "coverage", "fixtures", "backups", "data"]);
const maxFileBytes = 2 * 1024 * 1024;
const maxTotalBytes = 16 * 1024 * 1024;
const leaseRefreshMilliseconds = 180_000;
const sourceSyncMilliseconds = 2_000;
const apiReadyUrl = "http://127.0.0.1:3001/api/health/ready";

function validateRemoteSettings(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
    Object.keys(value).sort().join(",") !== "defaultSlot,localApiPort,remoteRoot,sshAlias") {
    throw new Error(".private/remote.json must contain only the documented SSH alias, root, slot, and local port settings.");
  }
  if (typeof value.sshAlias !== "string" || !/^[a-zA-Z0-9._-]{1,80}$/.test(value.sshAlias) ||
    value.remoteRoot !== "/srv/arden-hosted" || value.defaultSlot !== "dev-2" ||
    value.localApiPort !== 3001) {
    throw new Error(".private/remote.json does not match the approved Kiet Local development slot settings.");
  }
  return { sshAlias: value.sshAlias, remoteRoot: value.remoteRoot, slot: value.defaultSlot, localApiPort: value.localApiPort };
}

async function readRemoteSettings() {
  let raw;
  try { raw = await readFile(remoteConfigPath, "utf8"); }
  catch { throw new Error("Copy the private remote.json settings from kiet-local into .private/remote.json first."); }
  try { return validateRemoteSettings(JSON.parse(raw)); }
  catch (error) {
    if (error instanceof SyntaxError) throw new Error(".private/remote.json is not valid JSON.");
    throw error;
  }
}

function spawnCaptured(command, args, { input, timeout = 30_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: repositoryRoot, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill(), timeout);
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(stderr.trim() || `${command} exited with status ${code ?? "unknown"}.`));
      resolve(stdout);
    });
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}

function sshArguments(settings, remoteCommand, args) {
  return ["-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes", "-T", settings.sshAlias, remoteCommand, ...args];
}

async function callSync(settings, action, token = "-", input) {
  const scriptPath = `${settings.remoteRoot}/ops/sync.py`;
  const responseText = await spawnCaptured("ssh", sshArguments(settings, "python3", [scriptPath, settings.slot, action, token]), { input });
  let response;
  try { response = JSON.parse(responseText); }
  catch { throw new Error("The remote slot returned an invalid status response."); }
  if (!response?.ok) throw new Error(response?.error || "The remote slot operation was rejected.");
  return response;
}

async function callStart(settings) {
  const scriptPath = `${settings.remoteRoot}/ops/start.py`;
  const responseText = await spawnCaptured("ssh", sshArguments(settings, "sudo", ["-n", "/usr/bin/python3", scriptPath, settings.slot]));
  let response;
  try { response = JSON.parse(responseText); }
  catch { throw new Error("The managed API start helper returned an invalid response."); }
  if (!response?.ok) throw new Error("The managed API could not start. Ask the server operator to inspect the development slot.");
}

async function checkPortFree(port) {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function collectUploadFiles() {
  const names = new Set(allowedRootFiles);
  for (const directory of ["apps", "packages"]) {
    const root = path.join(repositoryRoot, directory);
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.name.startsWith(".")) names.add(`${directory}/${entry.name}/package.json`);
    }
  }
  for (const root of allowedPackageRoots) {
    const absoluteRoot = path.join(repositoryRoot, root);
    try { await access(absoluteRoot); }
    catch { continue; }
    await collectDirectory(absoluteRoot, root, names);
  }

  const orderedNames = [...names].sort();
  const files = [];
  let totalBytes = 0;
  for (const name of orderedNames) {
    const absolutePath = path.join(repositoryRoot, ...name.split("/"));
    const metadata = await stat(absolutePath);
    if (!metadata.isFile()) continue;
    const content = await readFile(absolutePath);
    if (content.byteLength > maxFileBytes) throw new Error(`Backend source file exceeds the ${maxFileBytes / 1024 / 1024} MiB upload limit: ${name}`);
    totalBytes += content.byteLength;
    if (totalBytes > maxTotalBytes) throw new Error(`Backend source exceeds the ${maxTotalBytes / 1024 / 1024} MiB upload limit.`);
    files.push({ name, content: content.toString("base64"), hash: createHash("sha256").update(content).digest("hex") });
  }
  for (const required of ["apps/api/package.json", "apps/api/src/index.ts", ...allowedRootFiles]) {
    if (!files.some((file) => file.name === required)) throw new Error(`Required backend source is missing: ${required}`);
  }
  return { manifest: files.map((file) => file.name), files };
}

async function collectDirectory(absoluteDirectory, relativeDirectory, names) {
  for (const entry of await readdir(absoluteDirectory, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    if (entry.isSymbolicLink()) throw new Error(`Backend uploads do not accept symbolic links: ${relativeDirectory}/${entry.name}`);
    const relativePath = `${relativeDirectory}/${entry.name}`;
    if (entry.isDirectory()) {
      if (!excludedDirectories.has(entry.name)) await collectDirectory(path.join(absoluteDirectory, entry.name), relativePath, names);
    } else if (entry.isFile() && uploadExtensions.has(path.extname(entry.name))) {
      if (/(secret|credential|token|password|private|\.local)([._-]|$)/i.test(entry.name)) continue;
      names.add(relativePath);
    }
  }
}

async function callSyncStatus(settings) {
  const status = await callSync(settings, "status");
  console.log(`Kiet Local ${settings.slot}: ${status.busy ? "writer active" : "available"}; API tunnel port ${status.port}; ${status.files} backend files on server.`);
  return status;
}

async function waitForApiReady(timeoutMilliseconds = 180_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMilliseconds) {
    try {
      const response = await fetch(apiReadyUrl, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return;
    } catch { /* Wait for the managed API and database health check. */ }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error("Kiet Local API did not become ready through the SSH tunnel. Check server status and database migrations.");
}

async function verifyRemoteSession() {
  let response;
  try { response = await fetch("http://127.0.0.1:3001/api/v1/me", { signal: AbortSignal.timeout(5_000) }); }
  catch { throw new Error("The Kiet Local API tunnel is open, but the session endpoint could not be reached."); }
  if (response.ok) {
    let session;
    try { session = await response.json(); }
    catch { throw new Error("The Kiet Local API returned an invalid test-session response."); }
    if (session?.testMode === true) {
      console.log("Kiet Local API is running with the mock-account test provider.");
    } else {
      console.log(`Kiet Local API is running with active session for ${session?.actor?.id ?? "authenticated user"}.`);
    }
  } else if (response.status === 401) {
    let body;
    try { body = await response.json(); } catch { body = {}; }
    if (body?.error?.code === "UNAUTHENTICATED") {
      console.log("Kiet Local API is running with live Supabase authentication.");
    } else {
      throw new Error(`Kiet Local API returned an unexpected 401 response: ${JSON.stringify(body)}`);
    }
  } else {
    throw new Error(`Kiet Local API returned unexpected status ${response.status}.`);
  }
}

function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  if (process.platform === "win32" && child.pid) {
    return spawnCaptured("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { timeout: 10_000 }).catch(() => undefined);
  }
  child.kill("SIGTERM");
  return new Promise((resolve) => {
    const timer = setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 5_000);
    child.once("close", () => { clearTimeout(timer); resolve(); });
  });
}

async function startDevSession(settings) {
  await checkPortFree(settings.localApiPort).catch(() => { throw new Error(`Local API tunnel port ${settings.localApiPort} is occupied. Stop the Arden session that owns it first.`); });
  await checkPortFree(5180).catch(() => { throw new Error("Local web port 5180 is occupied. Stop the Arden web session that owns it first."); });

  const status = await callSyncStatus(settings);
  if (status.busy) throw new Error("This development slot already has an active writer. Stop that session first.");

  const writerToken = randomUUID();
  await callSync(settings, "acquire", writerToken);
  let tunnel;
  let web;
  let leaseTimer;
  let syncTimer;
  let exiting = false;
  let syncInProgress = false;
  let previousFingerprint = "";

  const cleanup = async () => {
    if (exiting) return;
    exiting = true;
    clearInterval(leaseTimer);
    clearInterval(syncTimer);
    await Promise.all([stopChild(web), stopChild(tunnel)]);
    await callSync(settings, "release", writerToken).catch(() => console.error("Could not release the remote writer lease; it will expire automatically."));
  };

  const handleSignal = () => { void cleanup().finally(() => process.exit()); };
  process.once("SIGINT", handleSignal);
  process.once("SIGTERM", handleSignal);

  leaseTimer = setInterval(() => {
    if (!exiting) void callSync(settings, "acquire", writerToken).catch((error) => {
      console.error(error instanceof Error ? error.message : "Could not renew the remote writer lease.");
      void cleanup();
    });
  }, leaseRefreshMilliseconds);

  try {
    let source = await collectUploadFiles();
    previousFingerprint = fingerprint(source);
    await callSync(settings, "apply", writerToken, JSON.stringify(source));
    await callStart(settings);

    tunnel = spawn("ssh", [
      "-N", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes",
      "-o", "ExitOnForwardFailure=yes", "-o", "ServerAliveInterval=10", "-o", "ServerAliveCountMax=3",
      "-L", `127.0.0.1:${settings.localApiPort}:127.0.0.1:${status.port}`, settings.sshAlias,
    ], { stdio: "inherit" });
    tunnel.once("error", () => { if (!exiting) void cleanup(); });
    tunnel.once("exit", (code) => { if (!exiting && code !== 0) { console.error("The Kiet Local SSH tunnel stopped unexpectedly."); void cleanup(); } });

    await waitForApiReady();
    await verifyRemoteSession();
    console.log(`Kiet Local API is ready. Starting the local frontend at http://127.0.0.1:5180/`);
    web = spawn(process.platform === "win32" ? "pnpm.cmd" : "pnpm", ["dev:web"], {
      cwd: repositoryRoot,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    web.once("error", () => { if (!exiting) void cleanup(); });
    web.once("exit", (code) => { if (!exiting) { if (code && code !== 0) console.error(`Local frontend exited with status ${code}.`); void cleanup(); } });

    syncTimer = setInterval(async () => {
      if (exiting || syncInProgress) return;
      syncInProgress = true;
      try {
        source = await collectUploadFiles();
        const nextFingerprint = fingerprint(source);
        if (nextFingerprint !== previousFingerprint) {
          await callSync(settings, "apply", writerToken, JSON.stringify(source));
          previousFingerprint = nextFingerprint;
          console.log("Backend source synced; the hosted API watcher will reload it.");
        }
      } catch (error) {
        console.error(error instanceof Error ? error.message : "Backend source sync failed.");
        await cleanup();
      } finally { syncInProgress = false; }
    }, sourceSyncMilliseconds);

    await new Promise((resolve) => {
      const check = setInterval(() => {
        if (exiting || web?.exitCode !== null && web?.exitCode !== undefined || tunnel?.exitCode !== null && tunnel?.exitCode !== undefined) {
          clearInterval(check); clearInterval(leaseTimer); clearInterval(syncTimer); resolve();
        }
      }, 500);
    });
    await cleanup();
  } catch (error) {
    await cleanup();
    throw error;
  } finally {
    process.removeListener("SIGINT", handleSignal);
    process.removeListener("SIGTERM", handleSignal);
  }
}

function fingerprint(source) {
  const hash = createHash("sha256");
  for (const file of source.files) hash.update(file.name).update(file.hash);
  return hash.digest("hex");
}

async function main() {
  const command = process.argv[2];
  if (command !== "status" && command !== "dev") {
    throw new Error("Use `pnpm remote:status` or `pnpm dev:remote`.");
  }
  const settings = await readRemoteSettings();
  if (command === "status") await callSyncStatus(settings);
  else await startDevSession(settings);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Remote development failed.");
    process.exitCode = 1;
  });
}
