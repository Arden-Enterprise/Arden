import assert from "node:assert/strict";
import { test } from "node:test";

let release;
try { release = await import("./release.mjs"); } catch (error) {
  if (error.code !== "ERR_MODULE_NOT_FOUND") throw error;
}

const environment = {
  GITHUB_REPOSITORY: "Arden-Enterprise/Arden", ARDEN_REPOSITORY_VISIBILITY: "public",
  GITHUB_EVENT_NAME: "push", GITHUB_REF_NAME: "staging", GITHUB_SHA: "a".repeat(40),
  GITHUB_RUN_ID: "12345", GITHUB_RUN_ATTEMPT: "1",
};

test("release code is present", () => assert.ok(release, "Release client is not implemented"));

test("only public canonical push targets can obtain a deployment environment", () => {
  assert.ok(release, "Release client is not implemented");
  assert.equal(release.releaseContext(environment).environment, "staging");
  assert.equal(release.releaseContext({ ...environment, GITHUB_REF_NAME: "main" }).environment, "production");
  for (const patch of [
    { GITHUB_REF_NAME: "feat/example" }, { GITHUB_EVENT_NAME: "pull_request" },
    { ARDEN_REPOSITORY_VISIBILITY: "private" }, { GITHUB_REPOSITORY: "fork/Arden" },
    { GITHUB_SHA: "$(whoami)" }, { GITHUB_RUN_ATTEMPT: "0" },
  ]) assert.throws(() => release.releaseContext({ ...environment, ...patch }));
});

test("SSH uses fixed operations, pinned hosts and validated connection fields", () => {
  assert.ok(release, "Release client is not implemented");
  const args = release.sshArguments({ host: "server.example.test", port: "2222", user: "arden-ci-staging",
    key: "/tmp/release/key", hosts: "/tmp/release/known_hosts" });
  assert.ok(args.includes("StrictHostKeyChecking=yes"));
  assert.ok(args.includes("ClearAllForwardings=yes"));
  assert.equal(args.at(-1), "arden-ci-staging@server.example.test");
  for (const patch of [{ host: "-oProxyCommand=evil" }, { port: "22;whoami" },
    { user: "root\ncommand" }, { port: "0" }]) {
    assert.throws(() => release.sshArguments({ host: "host.test", port: "22", user: "ci-user",
      key: "/tmp/key", hosts: "/tmp/hosts", ...patch }));
  }
});

test("stale builds fail before a deployment call", async () => {
  assert.ok(release, "Release client is not implemented");
  await assert.rejects(() => release.assertCurrentHead(environment, async () => "b".repeat(40)), /superseded/i);
  await release.assertCurrentHead(environment, async () => "a".repeat(40));
});

test("production promotion changes deployment identity without rebuilding images", () => {
  assert.ok(release, "Release client is not implemented");
  const result = release.promotionRequest({ ...environment, GITHUB_REF_NAME: "main" }, "b".repeat(40));
  assert.deepEqual(result, { op: "promote", environment: "production", commit: "a".repeat(40),
    tree: "b".repeat(40), run_id: "12345", attempt: 1 });
  assert.equal(Object.hasOwn(result, "images"), false);
});
