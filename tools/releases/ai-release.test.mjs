import assert from "node:assert/strict";
import { test } from "node:test";
import {
  aiMetadata,
  aiReleaseContext,
  assertCurrentHead,
  checkAiReadiness,
  executeProductionAiRelease,
  executeStagingAiRelease,
  formatCliError,
  isStagingUpToDate,
  planPromotionRequest,
  promotionRequest,
  sshArguments,
} from "./ai-release.mjs";

const baseEnv = {
  GITHUB_REPOSITORY: "Arden-Enterprise/Arden",
  ARDEN_REPOSITORY_VISIBILITY: "public",
  GITHUB_EVENT_NAME: "push",
  GITHUB_REF_NAME: "staging",
  GITHUB_SHA: "a".repeat(40),
  GITHUB_RUN_ID: "12345",
  GITHUB_RUN_ATTEMPT: "1",
};

test("aiMetadata returns valid commit and services/ai tree SHA", () => {
  const m = aiMetadata();
  assert.match(m.commit, /^[0-9a-f]{40}$/);
  assert.match(m.ai_tree, /^[0-9a-f]{40}$/);
});

test("aiReleaseContext allows push/workflow_dispatch on staging and push-only on main", () => {
  assert.equal(aiReleaseContext(baseEnv).environment, "staging");
  assert.equal(aiReleaseContext({ ...baseEnv, GITHUB_EVENT_NAME: "workflow_dispatch" }).environment, "staging");
  assert.equal(aiReleaseContext({ ...baseEnv, GITHUB_REF_NAME: "main" }).environment, "production");

  for (const patch of [
    { GITHUB_REF_NAME: "main", GITHUB_EVENT_NAME: "workflow_dispatch" },
    { GITHUB_EVENT_NAME: "pull_request" },
    { GITHUB_REF_NAME: "feat/other" },
    { ARDEN_REPOSITORY_VISIBILITY: "private" },
    { GITHUB_REPOSITORY: "fork/Arden" },
    { GITHUB_RUN_ATTEMPT: "0" },
  ]) {
    assert.throws(() => aiReleaseContext({ ...baseEnv, ...patch }));
  }
});

test("isStagingUpToDate requires matching ai_tree, promotable flag, fresh 24h timestamp, unchanged tooling, and no force", () => {
  const now = 200_000;
  const freshStatus = {
    pending: null,
    active: {
      eligible_for_promotion: true,
      verified_at: now - 3600,
      manifest: { schema: 1, commit: "a".repeat(40), ai_tree: "b".repeat(40) },
    },
  };
  assert.equal(isStagingUpToDate(freshStatus, { ai_tree: "b".repeat(40), now }), true);
  assert.equal(isStagingUpToDate(freshStatus, { ai_tree: "b".repeat(40), forceDeploy: true, now }), false);
  assert.equal(isStagingUpToDate(freshStatus, { ai_tree: "b".repeat(40), toolingChanged: true, now }), false);
  assert.equal(isStagingUpToDate(freshStatus, { ai_tree: "c".repeat(40), now }), false);
  assert.equal(isStagingUpToDate({ ...freshStatus, pending: { phase: "activating" } }, { ai_tree: "b".repeat(40), now }), false);
  assert.equal(isStagingUpToDate({ ...freshStatus, active: { ...freshStatus.active, eligible_for_promotion: false } }, { ai_tree: "b".repeat(40), now }), false);
  assert.equal(isStagingUpToDate({ ...freshStatus, active: { ...freshStatus.active, verified_at: now - 90_000 } }, { ai_tree: "b".repeat(40), now }), false);
  assert.equal(isStagingUpToDate({ ...freshStatus, active: { ...freshStatus.active, manifest: { commit: "a".repeat(40), ai_tree: "b".repeat(40) } } }, { ai_tree: "b".repeat(40), now }), false);
});

test("checkAiReadiness accepts schema-1 and manual operator baseline but refuses pending or malformed state", () => {
  checkAiReadiness(baseEnv, {
    pending: null,
    active: { manifest: { schema: 1, commit: "a".repeat(40), ai_tree: "b".repeat(40) } },
  });
  checkAiReadiness(baseEnv, {
    pending: null,
    active: {
      eligible_for_promotion: false,
      manifest: { commit: "a".repeat(40), ai_tree: "b".repeat(40), images: { ai: { id: "sha256:" + "1".repeat(64) } } },
    },
  });
  for (const bad of [
    null,
    {},
    { pending: { phase: "activating" }, active: { manifest: { schema: 1, commit: "a".repeat(40), ai_tree: "b".repeat(40) } } },
    { pending: null, active: { eligible_for_promotion: true, manifest: { commit: "a".repeat(40), ai_tree: "b".repeat(40), images: { ai: { id: "sha256:" + "1".repeat(64) } } } } },
  ]) {
    assert.throws(() => checkAiReadiness(baseEnv, bad));
  }
});

test("executeStagingAiRelease checks head before upload and deploy", async () => {
  const manifest = {
    schema: 1, commit: baseEnv.GITHUB_SHA, ai_tree: "b".repeat(40),
    run_id: baseEnv.GITHUB_RUN_ID, attempt: 1,
    images: { ai: { tag: `arden-release-ai:sha-${baseEnv.GITHUB_SHA}`, id: "sha256:" + "1".repeat(64) } },
    archive_sha256: "c".repeat(64), archive_size: 123,
  };
  const ops = [];
  let heads = 0;
  const result = await executeStagingAiRelease(
    baseEnv,
    manifest,
    "temp-ai.tar.gz",
    async (req, archive) => { ops.push([req.op, archive]); return { status: "deployed" }; },
    async () => { heads += 1; return baseEnv.GITHUB_SHA; },
  );
  assert.deepEqual(result, { status: "deployed" });
  assert.deepEqual(ops, [["upload", "temp-ai.tar.gz"], ["deploy", undefined]]);
  assert.equal(heads, 2);
});

test("executeProductionAiRelease plans before promoting and handles ALREADY_CURRENT or blocked states", async () => {
  const prodEnv = { ...baseEnv, GITHUB_REF_NAME: "main" };
  const source = { commit: prodEnv.GITHUB_SHA, ai_tree: "b".repeat(40) };

  const ops = [];
  const promoted = await executeProductionAiRelease(
    prodEnv,
    source,
    async req => { ops.push(req.op); return req.op === "plan-promote" ? { status: "READY" } : { status: "deployed" }; },
    async () => prodEnv.GITHUB_SHA,
  );
  assert.deepEqual(ops, ["plan-promote", "promote"]);
  assert.deepEqual(promoted, { status: "deployed" });

  const noopOps = [];
  const current = await executeProductionAiRelease(
    prodEnv,
    source,
    async req => { noopOps.push(req.op); return { status: "ALREADY_CURRENT" }; },
    async () => prodEnv.GITHUB_SHA,
  );
  assert.deepEqual(noopOps, ["plan-promote"]);
  assert.equal(current.status, "already-current");

  await assert.rejects(() => executeProductionAiRelease(
    prodEnv,
    source,
    async () => ({ status: "STAGING_REQUIRED" }),
    async () => prodEnv.GITHUB_SHA,
  ), /STAGING_REQUIRED/);
});

test("sshArguments, promotionRequest, planPromotionRequest, and assertCurrentHead enforce strict validation", async () => {
  const args = sshArguments({
    host: "server.example.test", port: "2222", user: "arden-ai-staging",
    key: "/tmp/ai/key", hosts: "/tmp/ai/known_hosts",
  });
  assert.ok(args.includes("StrictHostKeyChecking=yes"));
  assert.equal(args.at(-1), "arden-ai-staging@server.example.test");
  assert.throws(() => sshArguments({ host: "-oProxyCommand=bad", port: "22", user: "u", key: "/k", hosts: "/h" }));

  const prodEnv = { ...baseEnv, GITHUB_REF_NAME: "main" };
  assert.equal(planPromotionRequest(prodEnv, "b".repeat(40)).op, "plan-promote");
  assert.equal(promotionRequest(prodEnv, "b".repeat(40)).op, "promote");
  await assert.rejects(() => assertCurrentHead(baseEnv, async () => "f".repeat(40)), /superseded/i);
});

test("formatCliError surfaces allowlisted local bundle errors while redacting raw transport failures", () => {
  const oversized = Object.assign(new Error("AI release archive (2000 bytes) exceeds approved 1024 limit"), {
    code: "ARDEN_AI_ARCHIVE_LIMIT",
  });
  assert.match(formatCliError("bundle", oversized), /2000 bytes/);
  assert.doesNotMatch(formatCliError("check-bundle", new Error("raw secret stdout")), /raw secret|receiver status/i);
  assert.match(formatCliError("deploy", new Error("raw ssh stderr")), /receiver status/i);
});
