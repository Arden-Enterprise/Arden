import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const digestPinnedFrom = /^FROM\s+\S+@sha256:[0-9a-f]{64}(?:\s+AS\s+[a-z0-9_-]+)?$/i;

function stripKeys(value, ignored) {
  if (Array.isArray(value)) return value.map(item => stripKeys(item, ignored));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .filter(key => !ignored.has(key))
        .sort()
        .map(key => [key, stripKeys(value[key], ignored)]),
    );
  }
  return value;
}

export function validateFixturePairs(root, manifest) {
  const errors = [];
  if (!Array.isArray(manifest?.fixturePairs) || manifest.fixturePairs.length === 0) {
    return ["parity-manifest.json must declare at least one fixture pair"];
  }
  for (const pair of manifest.fixturePairs) {
    const ignored = new Set(Array.isArray(pair.ignoreKeys) ? pair.ignoreKeys : []);
    let coreData;
    let aiData;
    try {
      coreData = JSON.parse(readFileSync(resolve(root, pair.core), "utf8"));
    } catch {
      errors.push(`${pair.name}: missing or invalid Core fixture (${pair.core})`);
      continue;
    }
    try {
      aiData = JSON.parse(readFileSync(resolve(root, pair.ai), "utf8"));
    } catch {
      errors.push(`${pair.name}: missing or invalid AI fixture (${pair.ai})`);
      continue;
    }
    const left = JSON.stringify(stripKeys(coreData, ignored));
    const right = JSON.stringify(stripKeys(aiData, ignored));
    if (left !== right) {
      errors.push(`${pair.name}: Core fixture (${pair.core}) drifted from AI fixture (${pair.ai})`);
    }
  }
  return errors;
}

export function validateChromaPin(lockText, expectedVersion) {
  const match = /\[\[package\]\]\s+name\s*=\s*"chromadb"\s+version\s*=\s*"([^"]+)"/.exec(lockText);
  if (!match) return ["services/ai/uv.lock is missing a chromadb package entry"];
  if (match[1] !== expectedVersion) {
    return [`services/ai/uv.lock pins chromadb ${match[1]}, expected ${expectedVersion}`];
  }
  return [];
}

export function validateAiDockerfile(dockerfileText) {
  const errors = [];
  const lines = dockerfileText
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith("#"));
  const fromLines = lines.filter(line => /^FROM\s+/i.test(line));
  if (fromLines.length < 2) {
    errors.push("services/ai/Dockerfile must be a multi-stage build (builder + hardened runtime)");
  }
  for (const line of fromLines) {
    if (!digestPinnedFrom.test(line)) {
      errors.push(`Unpinned base image in services/ai/Dockerfile: ${line}`);
    }
  }
  const lastFromIndex = lines.reduce((acc, line, index) => (/^FROM\s+/i.test(line) ? index : acc), -1);
  const runtimeSection = lastFromIndex >= 0 ? lines.slice(lastFromIndex).join("\n") : "";
  const requiredInRuntime = [
    ["USER 1000:1000", "runtime stage must set explicit non-root USER 1000:1000"],
    ["HOME=/tmp", "runtime stage must set HOME=/tmp for read-only root compatibility"],
    ["ANONYMIZED_TELEMETRY=FALSE", "runtime stage must disable ChromaDB telemetry"],
    ["TIKTOKEN_CACHE_DIR=/app/.tiktoken-cache", "runtime stage must use pre-baked TIKTOKEN_CACHE_DIR"],
    ['io.arden.release.ai_managed="1"', "runtime stage must carry distinct io.arden.release.ai_managed=\"1\" label"],
    ["site-packages/setuptools*", "runtime stage must strip base-image pip/setuptools/wheel toolchains"],
    ["urllib.request", "runtime HEALTHCHECK must use Python urllib.request instead of curl"],
    ["/app/.venv/bin/uvicorn", "runtime CMD must invoke /app/.venv/bin/uvicorn directly"],
  ];
  for (const [needle, reason] of requiredInRuntime) {
    if (!runtimeSection.includes(needle)) errors.push(`services/ai/Dockerfile: ${reason}`);
  }
  if (/\bcurl\b/.test(runtimeSection)) {
    errors.push("services/ai/Dockerfile: runtime stage must not install or invoke curl");
  }
  if (/\buv\s+(?:run|sync)\b/.test(runtimeSection)) {
    errors.push("services/ai/Dockerfile: runtime stage must not invoke uv");
  }
  if (runtimeSection.includes('io.arden.release.managed="1"')) {
    errors.push("services/ai/Dockerfile: must not reuse Core's io.arden.release.managed label");
  }
  return errors;
}

export function validateAiDockerignore(dockerignoreText) {
  const errors = [];
  const lines = dockerignoreText.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith("#"));
  if (lines[0] !== "**") {
    errors.push("services/ai/Dockerfile.dockerignore must be a strict allowlist starting with '**'");
  }
  for (const secretPattern of ["**/.env", "**/.env.*", "**/*.key", "**/*.pem", "**/.private", "**/.venv"]) {
    if (!lines.includes(secretPattern)) {
      errors.push(`services/ai/Dockerfile.dockerignore missing required exclusion: ${secretPattern}`);
    }
  }
  if (lines.some(line => /^!tests(?:\/|$)/.test(line))) {
    errors.push("services/ai/Dockerfile.dockerignore must not include tests/ in the runtime build context");
  }
  return errors;
}

export function runAiContractParity(root = process.cwd()) {
  const manifest = JSON.parse(readFileSync(resolve(root, "services/ai/schemas/parity-manifest.json"), "utf8"));
  const lockText = readFileSync(resolve(root, "services/ai/uv.lock"), "utf8");
  const dockerfileText = readFileSync(resolve(root, "services/ai/Dockerfile"), "utf8");
  const dockerignoreText = readFileSync(resolve(root, "services/ai/Dockerfile.dockerignore"), "utf8");
  return [
    ...validateFixturePairs(root, manifest),
    ...validateChromaPin(lockText, manifest.chromaServerVersion),
    ...validateAiDockerfile(dockerfileText),
    ...validateAiDockerignore(dockerignoreText),
  ];
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const errors = runAiContractParity(process.cwd());
  if (errors.length > 0) {
    for (const error of errors) console.error(`ERROR: ${error}`);
    process.exitCode = 1;
  } else {
    console.log("AI contract parity, Chroma pin, Dockerfile, and allowlist dockerignore checks passed.");
  }
}
