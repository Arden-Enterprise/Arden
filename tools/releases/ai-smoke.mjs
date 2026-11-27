// Disposable smoke check for the hardened services/ai runtime image on the CI runner.
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error("Invalid git revision for AI smoke check");

const image = `arden-release-ai:sha-${commit}`;
const containerName = `arden-ai-smoke-${randomBytes(6).toString("hex")}`;
const token = randomBytes(24).toString("hex");
const sleep = ms => new Promise(done => setTimeout(done, ms));

const docker = (...args) => {
  try {
    return execFileSync("docker", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 5 * 60_000,
    }).trim();
  } catch {
    // Never leak disposable tokens or container flags in CI logs.
    throw new Error(`Disposable AI Docker operation failed (${args[0]} ${args[1] ?? ""})`);
  }
};

const commonSecurityArgs = [
  "--read-only",
  "--cap-drop", "ALL",
  "--security-opt", "no-new-privileges:true",
  "--tmpfs", "/tmp:rw,nosuid,nodev,size=128m",
  "--memory", "1536m",
  "--pids-limit", "256",
];

// 1. Offline runtime hygiene + pre-baked tiktoken encoding verification under --network none.
const offlineScript = [
  "import os, shutil, tiktoken",
  "assert os.getuid() == 1000, f'expected uid 1000, got {os.getuid()}'",
  "assert shutil.which('uv') is None, 'uv must not exist in runtime image'",
  "assert shutil.which('curl') is None, 'curl must not exist in runtime image'",
  "for name in ('cl100k_base', 'o200k_base'):",
  "    enc = tiktoken.get_encoding(name)",
  "    assert len(enc.encode('Arden offline smoke check')) > 0",
  "print('OFFLINE_SMOKE_OK')",
].join("\n");

const offlineOutput = docker(
  "run", "--rm", "--network", "none", ...commonSecurityArgs,
  image, "/app/.venv/bin/python", "-c", offlineScript,
);
if (!offlineOutput.includes("OFFLINE_SMOKE_OK")) {
  throw new Error("Offline non-root / tiktoken smoke verification failed");
}

// 2. Live HTTP smoke under exact production hardening flags (health, 401 auth, redacted 422).
const maintenanceFixture = JSON.parse(
  readFileSync(resolve("services/ai/tests/fixtures/maintenance-analysis-v1.json"), "utf8"),
);

try {
  docker(
    "run", "-d",
    "--name", containerName,
    ...commonSecurityArgs,
    "-p", "127.0.0.1::8080",
    "-e", "ARDEN_AI_ENVIRONMENT=staging",
    "-e", `ARDEN_AI_SERVICE_TOKEN=${token}`,
    "-e", "ARDEN_AI_MAINTENANCE_PROVIDER_ENABLED=true",
    image,
  );

  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    const status = docker(
      "inspect", "--format", "{{if .State.Health}}{{.State.Health.Status}}{{end}}", containerName,
    );
    if (status === "healthy") {
      ready = true;
      break;
    }
    await sleep(1000);
  }
  if (!ready) throw new Error("AI runtime image did not reach healthy state");

  const port = docker(
    "inspect", "--format", '{{(index (index .NetworkSettings.Ports "8080/tcp") 0).HostPort}}', containerName,
  );
  if (!/^[1-9][0-9]{0,4}$/.test(port) || Number(port) > 65535) {
    throw new Error("Invalid disposable AI host port");
  }
  const baseUrl = `http://127.0.0.1:${port}`;
  const authHeaders = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  for (const path of ["/health/live", "/health/ready"]) {
    const res = await fetch(`${baseUrl}${path}`);
    if (res.status !== 200) throw new Error(`Expected 200 on ${path}, got ${res.status}`);
  }

  for (const path of ["/v3/generations", "/v2/maintenance-analyses"]) {
    const anon = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    if (anon.status !== 401) throw new Error(`Expected 401 anonymous denial on ${path}, got ${anon.status}`);
  }

  const v1Res = await fetch(`${baseUrl}/v1/maintenance-analyses`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify(maintenanceFixture),
  });
  if (v1Res.status !== 200) throw new Error(`Expected 200 on /v1/maintenance-analyses, got ${v1Res.status}`);

  const sentinel = "SMOKE_SECRET_SENTINEL_DO_NOT_ECHO";
  const v2BadHash = await fetch(`${baseUrl}/v2/maintenance-analyses`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      contractVersion: 2,
      requestId: "10000000-0000-4000-8000-000000000099",
      caseId: maintenanceFixture.caseId,
      sources: [{
        versionId: maintenanceFixture.versionIds[0],
        text: sentinel,
        textHash: "0".repeat(64),
      }],
    }),
  });
  const v2Body = await v2BadHash.text();
  if (v2BadHash.status !== 422 || v2Body.includes(sentinel)) {
    throw new Error(`Expected redacted 422 on /v2/maintenance-analyses, got ${v2BadHash.status}`);
  }
  console.log("AI image smoke checks passed (offline tiktoken, non-root, health, 401 auth, redacted 422).");
} finally {
  try { docker("rm", "-f", containerName); } catch { /* Best-effort cleanup on disposable runner. */ }
}
