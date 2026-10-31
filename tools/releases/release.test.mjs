import assert from "node:assert/strict";
import { test } from "node:test";

let release;
let migrationInventory;
try { release = await import("./release.mjs"); } catch (error) {
  if (error.code !== "ERR_MODULE_NOT_FOUND") throw error;
}
try { migrationInventory = await import("../../apps/api/migrations/inventory.mjs"); } catch (error) {
  if (error.code !== "ERR_MODULE_NOT_FOUND") throw error;
}

const environment = {
  GITHUB_REPOSITORY: "Arden-Enterprise/Arden", ARDEN_REPOSITORY_VISIBILITY: "public",
  GITHUB_EVENT_NAME: "push", GITHUB_REF_NAME: "staging", GITHUB_SHA: "a".repeat(40),
  GITHUB_RUN_ID: "12345", GITHUB_RUN_ATTEMPT: "1",
};

test("release code is present", () => assert.ok(release, "Release client is not implemented"));

test("release metadata binds the complete migration policy inventory", () => {
  assert.ok(release && migrationInventory, "Release migration inventory is not implemented");
  assert.equal(typeof release.metadata, "function", "Release metadata must be available to the bundle builder");
  const source = release.metadata();
  assert.equal(source.migrations, migrationInventory.fingerprintMigrationInventory(source.migration_inventory));
  assert.ok(source.migration_inventory.length >= 23);
  const operatorOnlyIds = new Set(["0018", "0019", "0020", "0021", "0022", "0023"]);
  for (const id of operatorOnlyIds) {
    assert.equal(source.migration_inventory.find(row => row.id === id)?.rollout, "operator",
      `Migration ${id} must remain operator-class`);
  }
});

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
  assert.ok(args.includes("ServerAliveInterval=15"));
  assert.ok(args.includes("ServerAliveCountMax=3"));
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

function inventorySource(commit, tree) {
  const migration_inventory = [{ id: "0001", filename: "0001_example.sql", sha256: "d".repeat(64), rollout: "expand" }];
  return { commit, tree, migration_inventory,
    migrations: migrationInventory.fingerprintMigrationInventory(migration_inventory) };
}

test("staging plans the exact source before upload and fences every mutating call", async () => {
  assert.ok(release, "Release client is not implemented");
  const source = inventorySource(environment.GITHUB_SHA, "b".repeat(40));
  const manifest = { schema: 2, ...source, run_id: environment.GITHUB_RUN_ID,
    attempt: 1, images: { api: { id: "sha256:" + "1".repeat(64) }, web: { id: "sha256:" + "2".repeat(64) } },
    archive_sha256: "c".repeat(64), archive_size: 10 };
  const calls = [], heads = [];
  const send = async (request, archive) => {
    calls.push({ request, archive });
    return request.op === "plan-migrations" ? { status: "READY", migration_ids: ["0001_example"] } : { status: "ok" };
  };
  const getHead = async () => { heads.push(true); return environment.GITHUB_SHA; };
  const result = await release.executeStagingRelease(environment, manifest, "temporary-archive", send, getHead);
  assert.deepEqual(result, { status: "ok" });
  assert.deepEqual(calls.map(call => call.request.op), ["plan-migrations", "upload", "deploy"]);
  assert.equal(calls[0].request.migrations, source.migrations);
  assert.deepEqual(calls[0].request.migration_inventory, source.migration_inventory);
  assert.equal(calls[0].archive, undefined);
  assert.equal(calls[1].archive, "temporary-archive");
  assert.equal(heads.length, 3);
});

test("a previous migration attempt is reconciled and replanned before upload", async () => {
  assert.ok(release, "Release client is not implemented");
  const source = inventorySource(environment.GITHUB_SHA, "b".repeat(40));
  const manifest = { schema: 2, ...source, run_id: environment.GITHUB_RUN_ID,
    attempt: 1, images: { api: { id: "sha256:" + "1".repeat(64) }, web: { id: "sha256:" + "2".repeat(64) } },
    archive_sha256: "c".repeat(64), archive_size: 10 };
  const calls = [], heads = [];
  const send = async (request, archive) => {
    calls.push({ request, archive });
    if (request.op === "plan-migrations") {
      return calls.filter(call => call.request.op === "plan-migrations").length === 1
        ? { status: "RECOVERY_REQUIRED", migration_ids: [] }
        : { status: "READY", migration_ids: ["0001_example"] };
    }
    if (request.op === "reconcile-migrations") return { status: "RECONCILED" };
    return { status: "ok" };
  };
  const result = await release.executeStagingRelease(environment, manifest, "temporary-archive", send,
    async () => { heads.push(true); return environment.GITHUB_SHA; });
  assert.deepEqual(result, { status: "ok" });
  assert.deepEqual(calls.map(call => call.request.op), [
    "plan-migrations", "reconcile-migrations", "plan-migrations", "upload", "deploy",
  ]);
  assert.equal(calls[1].request.commit, environment.GITHUB_SHA);
  assert.equal(calls[1].request.attempt, 1);
  assert.equal(heads.length, 5);
});

test("a blocked or malformed staging plan stops before any upload", async () => {
  assert.ok(release, "Release client is not implemented");
  const source = inventorySource(environment.GITHUB_SHA, "b".repeat(40));
  const manifest = { schema: 2, ...source, run_id: environment.GITHUB_RUN_ID,
    attempt: 1, images: { api: { id: "sha256:" + "1".repeat(64) }, web: { id: "sha256:" + "2".repeat(64) } },
    archive_sha256: "c".repeat(64), archive_size: 10 };
  for (const plan of [
    { status: "REQUIRES_OPERATOR", migration_ids: ["0022_remove_old_data"] },
    { status: "DRIFT", migration_ids: [] },
    { status: "READY", migration_ids: [] },
    { status: "NO_PENDING", migration_ids: ["0001_example"] },
    { status: "READY", migration_ids: ["../../secret"] },
  ]) {
    const calls = [];
    await assert.rejects(() => release.executeStagingRelease(environment, manifest, "temporary-archive",
      async request => { calls.push(request.op); return plan; }, async () => environment.GITHUB_SHA));
    assert.deepEqual(calls, ["plan-migrations"]);
  }
});

test("production plans against its own verified staging artifact then promotes without upload or rebuild", async () => {
  assert.ok(release, "Release client is not implemented");
  const main = { ...environment, GITHUB_REF_NAME: "main" };
  const source = inventorySource(main.GITHUB_SHA, "b".repeat(40));
  const calls = [], heads = [];
  const send = async (request, archive) => {
    calls.push({ request, archive });
    return request.op === "plan-migrations" ? { status: "NO_PENDING", migration_ids: [] } : { status: "promoted" };
  };
  const result = await release.executeProductionRelease(main, source, send,
    async () => { heads.push(true); return main.GITHUB_SHA; });
  assert.deepEqual(result, { status: "promoted" });
  assert.deepEqual(calls.map(call => call.request.op), ["plan-migrations", "promote"]);
  assert.equal(calls[0].request.environment, "production");
  assert.equal(calls[0].request.tree, source.tree);
  assert.equal(calls[1].request.tree, source.tree);
  assert.equal(calls[0].archive, undefined);
  assert.equal(Object.hasOwn(calls[1].request, "images"), false);
  assert.equal(heads.length, 2);
});

test("PR, fork and stale-head jobs cannot send migration or deployment requests", async () => {
  assert.ok(release, "Release client is not implemented");
  const source = inventorySource(environment.GITHUB_SHA, "b".repeat(40));
  const manifest = { schema: 2, ...source, run_id: environment.GITHUB_RUN_ID,
    attempt: 1, images: { api: { id: "sha256:" + "1".repeat(64) }, web: { id: "sha256:" + "2".repeat(64) } },
    archive_sha256: "c".repeat(64), archive_size: 10 };
  for (const env of [{ ...environment, GITHUB_EVENT_NAME: "pull_request" },
    { ...environment, GITHUB_REPOSITORY: "attacker/Arden" }]) {
    const calls = [];
    await assert.rejects(() => release.executeStagingRelease(env, manifest, "archive",
      async request => calls.push(request.op), async () => env.GITHUB_SHA));
    assert.deepEqual(calls, []);
  }
  const calls = [];
  await assert.rejects(() => release.executeStagingRelease(environment, manifest, "archive",
    async request => { calls.push(request.op); return { status: "NO_PENDING", migration_ids: [] }; },
    async () => "e".repeat(40)), /superseded/i);
  assert.deepEqual(calls, []);
});

test("preflight checks each environment with a read-only status request", async () => {
  for (const branch of ["staging", "main"]) {
    const calls = [];
    await release.checkReadiness({ ...environment, GITHUB_REF_NAME: branch }, async request => {
      calls.push(request);
      return { active: { manifest: { schema: 1, commit: "b".repeat(40) } }, pending: null };
    });
    assert.deepEqual(calls, [{ op: "status", environment: branch === "main" ? "production" : "staging" }]);
  }
  await release.checkReadiness(environment, async () => ({
    active: { manifest: { schema: 2, commit: "b".repeat(40) } }, pending: null,
  }));
  await release.checkReadiness(environment, async () => ({
    active: { manifest: { schema: 2, commit: "b".repeat(40) } },
    pending: { phase: "migrating" },
  }));
});

test("preflight refuses unavailable, incomplete or unresolved release state", async () => {
  const active = { manifest: { schema: 1, commit: "b".repeat(40) } };
  for (const status of [undefined, {}, { active }, { active, pending: {} },
    { active: { manifest: { schema: 3, commit: "b".repeat(40) } }, pending: null }]) {
    await assert.rejects(() => release.checkReadiness(environment, async () => status));
  }
  await assert.rejects(() => release.checkReadiness(environment, async () => { throw new Error("unreachable"); }), /unreachable/);
  let called = false;
  await assert.rejects(() => release.checkReadiness({ ...environment, GITHUB_EVENT_NAME: "pull_request" }, async () => { called = true; }));
  assert.equal(called, false);
});

test("preflight accepts the operator's non-promotable manual baseline format", async () => {
  const status = {
    active: { eligible_for_promotion: false, manifest: {
      commit: "b".repeat(40), tree: "c".repeat(40), migrations: "d".repeat(64),
      images: { api: { id: "sha256:" + "e".repeat(64) }, web: { id: "sha256:" + "f".repeat(64) } },
    } },
    pending: null,
  };
  await release.checkReadiness(environment, async () => status);
  status.active.eligible_for_promotion = true;
  await assert.rejects(() => release.checkReadiness(environment, async () => status));
  status.active.eligible_for_promotion = false;
  status.active.manifest.images.api.id = "unverified";
  await assert.rejects(() => release.checkReadiness(environment, async () => status));
});
