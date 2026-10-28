import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { validatePullRequest } from "./conventions.mjs";

const valid = {
  branch: "feat/private-notes",
  title: "feat(notes): preserve private drafts",
  author: "contributor",
};

test("accept documented work types without a tool or agent namespace", () => {
  for (const type of ["feat", "fix", "docs", "refactor", "perf", "test", "chore", "build", "ci", "hotfix", "security", "revert"]) {
    assert.deepEqual(validatePullRequest({ ...valid, branch: `${type}/scoped-document-change`, title: `${type}: preserve current behavior` }).errors, []);
  }
});

test("accept only the two exact deployment branches for release promotion PRs", () => {
  for (const branch of ["staging", "main"]) {
    assert.deepEqual(validatePullRequest({ ...valid, branch, title: "ci: promote verified staging release" }).errors, []);
  }
  for (const branch of ["develop", "staging/test", "production", "Staging", "staging\n"]) {
    assert.ok(validatePullRequest({ ...valid, branch }).errors.length);
  }
});

test("accept semantic release versions including prerelease/build suffixes", () => {
  for (const version of ["0.1.0", "1.0.0-rc.1", "1.2.3+build.7", "1.2.3-beta.2+linux"]) {
    assert.deepEqual(validatePullRequest({ ...valid, branch: `release/${version}`, title: "release: prepare supported version" }).errors, []);
  }
  for (const version of ["v1.0.0", "01.0.0", "1.0", "1.0.0-01", "1.0.0+", "not-a-version"]) {
    assert.ok(validatePullRequest({ ...valid, branch: `release/${version}` }).errors.length);
  }
});

test("reject malformed names, control characters and unknown work types", () => {
  for (const branch of ["feature/private-notes", "feat/notes", "feat/Private-Notes", "codex/private-notes", "codex/feat/scoped-document-change", "codex/docs/too/many/segments", "feat/private-notes\n", "feat/private--notes", "feat/private notes"]) {
    assert.ok(validatePullRequest({ ...valid, branch }).errors.length, branch);
  }
});

test("enforce exact branch and title length boundaries", () => {
  assert.deepEqual(validatePullRequest({ ...valid, branch: `feat/${"a".repeat(73)}-b` }).errors, []);
  assert.ok(validatePullRequest({ ...valid, branch: `feat/${"a".repeat(74)}-b` }).errors.length);
  assert.deepEqual(validatePullRequest({ ...valid, title: `feat: ${"x".repeat(94)}` }).errors, []);
  assert.ok(validatePullRequest({ ...valid, title: `feat: ${"x".repeat(95)}` }).errors.length);
  assert.deepEqual(validatePullRequest({ ...valid, title: "fix: abcdefgh" }).errors, []);
  assert.ok(validatePullRequest({ ...valid, title: "fix: abcdefg" }).errors.length);
});

test("accept breaking changes and Unicode summaries without multiline output", () => {
  assert.deepEqual(validatePullRequest({ ...valid, title: "feat(api)!: update permission contract" }).errors, []);
  assert.deepEqual(validatePullRequest({ ...valid, title: "docs: cập nhật hướng dẫn" }).errors, []);
  for (const title of ["Fix private notes", "feat: too short\n", " feat: preserve private drafts", "feat: preserve private drafts ", "feat: ::error::injected\ncommand"]) {
    assert.ok(validatePullRequest({ ...valid, title }).errors.length);
  }
});

test("only exempt the real Dependabot account on a Dependabot branch", () => {
  assert.equal(validatePullRequest({ branch: "dependabot/npm/package-1.2.3", title: "Bump package", author: "dependabot[bot]" }).exempt, true);
  assert.ok(validatePullRequest({ branch: "dependabot/npm/package-1.2.3", title: "Bump package", author: "contributor" }).errors.length);
  assert.ok(validatePullRequest({ branch: "main", title: "Bump package", author: "dependabot[bot]" }).errors.length);
});

test("invalid runtime input returns errors instead of throwing", () => {
  for (const value of [undefined, null, {}, { branch: 12, title: null }, { branch: "", title: "" }]) {
    assert.ok(validatePullRequest(value).errors.length);
  }
});

test("CLI reports static messages and appropriate exit codes", () => {
  const script = fileURLToPath(new URL("./conventions.mjs", import.meta.url));
  const run = (branch, title) => spawnSync(process.execPath, [script], {
    encoding: "utf8",
    env: { ...process.env, PR_BRANCH: branch, PR_TITLE: title, PR_AUTHOR: "contributor" },
  });
  assert.equal(run(valid.branch, valid.title).status, 0);
  const rejected = run("bad-branch", "::error::untrusted title");
  assert.equal(rejected.status, 1);
  assert.equal(rejected.stdout.includes("untrusted title"), false);
});

test("reject explicitly prohibited generic descriptions and bare dates", () => {
  for (const branch of ["feat/new-branch", "docs/new-branch", "fix/2026-10-24"]) {
    assert.ok(validatePullRequest({ ...valid, branch }).errors.length, branch);
  }
});
