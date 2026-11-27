import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  runAiContractParity,
  validateAiDockerfile,
  validateAiDockerignore,
  validateChromaPin,
  validateFixturePairs,
} from "./ai-contract-parity.mjs";

test("repository passes AI contract parity, Chroma pin, Dockerfile, and dockerignore checks", () => {
  assert.deepEqual(runAiContractParity(process.cwd()), []);
});

test("validateFixturePairs rejects drift outside explicit ignoreKeys", () => {
  const root = mkdtempSync(join(tmpdir(), "arden-ai-parity-"));
  try {
    mkdirSync(join(root, "core"), { recursive: true });
    mkdirSync(join(root, "ai"), { recursive: true });
    writeFileSync(join(root, "core/f.json"), JSON.stringify({ ok: true, usageEvents: [], extra: 1 }));
    writeFileSync(join(root, "ai/f.json"), JSON.stringify({ ok: true }));
    const errors = validateFixturePairs(root, {
      fixturePairs: [{ name: "sample", core: "core/f.json", ai: "ai/f.json", ignoreKeys: ["usageEvents"] }],
    });
    assert.equal(errors.length, 1);
    assert.match(errors[0], /drifted/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("validateChromaPin detects lockfile drift", () => {
  const lock = '[[package]]\nname = "chromadb"\nversion = "1.6.0"\n';
  const errors = validateChromaPin(lock, "1.5.9");
  assert.equal(errors.length, 1);
  assert.match(errors[0], /1\.6\.0.*1\.5\.9/);
});

test("validateAiDockerfile rejects unpinned base images, curl, uv runtime, or Core label reuse", () => {
  const bad = [
    "FROM python:3.11-slim-bookworm AS ai",
    'LABEL io.arden.release.managed="1"',
    "RUN apt-get install curl",
    'CMD ["uv", "run", "uvicorn"]',
  ].join("\n");
  const errors = validateAiDockerfile(bad);
  assert.ok(errors.some(e => e.includes("multi-stage")));
  assert.ok(errors.some(e => e.includes("Unpinned base image")));
  assert.ok(errors.some(e => e.includes("curl")));
  assert.ok(errors.some(e => e.includes("uv")));
  assert.ok(errors.some(e => e.includes("io.arden.release.managed")));
});

test("validateAiDockerignore requires strict allowlist and secret exclusions", () => {
  const denylist = ".git\n.env\n";
  const errors = validateAiDockerignore(denylist);
  assert.ok(errors.some(e => e.includes("allowlist")));
  assert.ok(errors.some(e => e.includes("**/.env.*")));
});
