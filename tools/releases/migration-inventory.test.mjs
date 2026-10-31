import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

let inventory;
let releaseMigrations;
try {
  inventory = await import("../../apps/api/migrations/inventory.mjs");
  releaseMigrations = await import("./migrations.mjs");
} catch (error) {
  if (error.code !== "ERR_MODULE_NOT_FOUND") throw error;
}

function withFixture(files, policyFactory, run) {
  const root = mkdtempSync(join(tmpdir(), "arden-migration-inventory-"));
  const migrationDirectory = join(root, "migrations");
  mkdirSync(migrationDirectory, { recursive: true });
  for (const [filename, content] of Object.entries(files)) {
    writeFileSync(join(migrationDirectory, filename), content);
  }
  const records = Object.entries(files).map(([filename, content]) => ({
    id: filename.slice(0, 4), filename,
    sha256: migrationChecksum(content), rollout: "operator",
  }));
  const policyPath = join(root, "release-policy.json");
  writeFileSync(policyPath, JSON.stringify(policyFactory ? policyFactory(records) : {
    schema: 1, migrations: records,
  }));
  try { return run({ root, migrationDirectory, policyPath }); }
  finally { rmSync(root, { recursive: true, force: true }); }
}

function migrationChecksum(content) {
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
  return createHash("sha256").update(bytes).digest("hex");
}

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function makeGitRepo(migrationContent = "SELECT 1;\n") {
  const root = mkdtempSync(join(tmpdir(), "arden-migration-history-"));
  mkdirSync(join(root, "apps", "api", "migrations"), { recursive: true });
  git(root, ["init", "-q", "--initial-branch=main"]);
  git(root, ["config", "user.email", "migration-test@example.test"]);
  git(root, ["config", "user.name", "Migration Test"]);
  const migration = join(root, "apps", "api", "migrations", "0001_initial.sql");
  writeFileSync(migration, migrationContent);
  git(root, ["add", "apps/api/migrations/0001_initial.sql"]);
  git(root, ["commit", "-qm", "base"]);
  return { root, migration, base: git(root, ["rev-parse", "HEAD"]) };
}

test("migration inventory implementation is present", () => {
  assert.ok(inventory && releaseMigrations, "migration inventory and release checks are not implemented");
});

if (inventory && releaseMigrations) {
  test("loader returns exact ordered entries and hashes the exact SQL bytes", () => {
    withFixture({
      "0002_second.sql": "-- second\r\nSELECT 2;\n",
      "0001_first.sql": "-- first\nSELECT 1;\n",
    }, null, ({ migrationDirectory, policyPath }) => {
      const rows = inventory.loadMigrationInventory(migrationDirectory, policyPath);
      assert.deepEqual(rows.map(row => [row.id, row.filename, row.rollout]), [
        ["0001", "0001_first.sql", "operator"],
        ["0002", "0002_second.sql", "operator"],
      ]);
      assert.equal(rows[1].sha256, migrationChecksum(readFileSync(join(migrationDirectory, "0002_second.sql"))));
    });
  });

  test("loader permits an explicitly reviewed compatible expand migration", () => {
    withFixture({ "0024_expand.sql": "ALTER TABLE item ADD COLUMN future_value text;\n" }, records => ({
      schema: 1, migrations: records.map(record => ({ ...record, rollout: "expand" })),
    }), ({ migrationDirectory, policyPath }) => {
      const rows = inventory.loadMigrationInventory(migrationDirectory, policyPath);
      assert.equal(rows[0].rollout, "expand");
      assert.doesNotThrow(() => inventory.assertSafeExpandMigrations(rows, migrationDirectory));
    });
  });

  test("policy refresh records exact SQL bytes and detects an unreviewed line-ending change", () => {
    withFixture({ "0001_first.sql": "SELECT 1;\r\n" }, null, ({ migrationDirectory, policyPath }) => {
      writeFileSync(join(migrationDirectory, "0001_first.sql"), "SELECT 2;\r\n");
      releaseMigrations.refreshMigrationPolicy(migrationDirectory, policyPath);
      const policy = JSON.parse(readFileSync(policyPath, "utf8"));
      assert.equal(policy.migrations[0].sha256, migrationChecksum("SELECT 2;\r\n"));
      assert.equal(inventory.loadMigrationInventory(migrationDirectory, policyPath)[0].sha256, policy.migrations[0].sha256);
      writeFileSync(join(migrationDirectory, "0001_first.sql"), "SELECT 2;\n");
      assert.throws(() => inventory.loadMigrationInventory(migrationDirectory, policyPath), /checksum|hash|digest/i);
      releaseMigrations.refreshMigrationPolicy(migrationDirectory, policyPath);
      const lfPolicy = JSON.parse(readFileSync(policyPath, "utf8"));
      assert.equal(lfPolicy.migrations[0].sha256, migrationChecksum("SELECT 2;\n"));
      assert.notEqual(lfPolicy.migrations[0].sha256, policy.migrations[0].sha256);
    });
  });

  test("inventory fingerprint is canonical, order independent, and includes rollout class", () => {
    const first = { id: "0001", filename: "0001_first.sql", sha256: "a".repeat(64), rollout: "expand" };
    const second = { id: "0002", filename: "0002_second.sql", sha256: "b".repeat(64), rollout: "operator" };
    const fingerprint = inventory.fingerprintMigrationInventory([first, second]);
    assert.equal(inventory.fingerprintMigrationInventory([second, first]), fingerprint);
    assert.equal(fingerprint, "3902c789680733d25fc37e2e60ddcfe2babd40e4346c39a93e053fceb24ed761");
    assert.notEqual(inventory.fingerprintMigrationInventory([{ ...first, rollout: "operator" }, second]), fingerprint);
    assert.match(fingerprint, /^[0-9a-f]{64}$/);
  });

  test("loader rejects missing and extra policy rows", () => {
    withFixture({ "0001_first.sql": "SELECT 1;\n" }, records => ({ schema: 1, migrations: [] }), ({ migrationDirectory, policyPath }) => {
      assert.throws(() => inventory.loadMigrationInventory(migrationDirectory, policyPath), /match|missing|inventory/i);
    });
    withFixture({ "0001_first.sql": "SELECT 1;\n" }, records => ({ schema: 1, migrations: [
      ...records, { ...records[0], id: "0002", filename: "0002_extra.sql" },
    ] }), ({ migrationDirectory, policyPath }) => {
      assert.throws(() => inventory.loadMigrationInventory(migrationDirectory, policyPath), /match|extra|inventory/i);
    });
  });

  test("loader rejects duplicate IDs, malformed hashes, and invalid rollout classes", () => {
    withFixture({ "0001_first.sql": "SELECT 1;\n", "0001_second.sql": "SELECT 2;\n" }, null, ({ migrationDirectory, policyPath }) => {
      assert.throws(() => inventory.loadMigrationInventory(migrationDirectory, policyPath), /duplicate|unique/i);
    });
    for (const invalid of [
      records => ({ schema: 1, migrations: [{ ...records[0], sha256: "A".repeat(64) }] }),
      records => ({ schema: 1, migrations: [{ ...records[0], rollout: "safe" }] }),
    ]) {
      withFixture({ "0001_first.sql": "SELECT 1;\n" }, invalid, ({ migrationDirectory, policyPath }) => {
        assert.throws(() => inventory.loadMigrationInventory(migrationDirectory, policyPath));
      });
    }
  });

  test("loader rejects SQL whose bytes no longer match its reviewed policy checksum", () => {
    withFixture({ "0001_first.sql": "SELECT 1;\n" }, records => ({ schema: 1, migrations: [
      { ...records[0], sha256: "f".repeat(64) },
    ] }), ({ migrationDirectory, policyPath }) => {
      assert.throws(() => inventory.loadMigrationInventory(migrationDirectory, policyPath), /checksum|hash|digest/i);
    });
  });

  test("loader rejects unnumbered SQL files instead of silently omitting them", () => {
    withFixture({ "0001_first.sql": "SELECT 1;\n", "adhoc.sql": "SELECT 2;\n" }, null, ({ migrationDirectory, policyPath }) => {
      assert.throws(() => inventory.loadMigrationInventory(migrationDirectory, policyPath), /filename|numbered|inventory/i);
    });
  });

  test("checked-in policy keeps pending operator migrations blocked without banning future expand reviews", () => {
    const rows = inventory.loadMigrationInventory("apps/api/migrations");
    assert.ok(rows.length >= 23);
    const operatorOnlyIds = new Set(["0018", "0019", "0020", "0021", "0022", "0023"]);
    for (const id of operatorOnlyIds) {
      assert.equal(rows.find(row => row.id === id)?.rollout, "operator", `Migration ${id} must remain operator-class`);
    }
  });

  test("refresh updates registered checksums only and refuses to register an unreviewed migration", () => {
    withFixture({ "0001_first.sql": "SELECT 1;\n" }, null, ({ migrationDirectory, policyPath }) => {
      const before = JSON.parse(readFileSync(policyPath, "utf8"));
      writeFileSync(join(migrationDirectory, "0001_first.sql"), "SELECT 2;\n");
      releaseMigrations.refreshMigrationPolicy(migrationDirectory, policyPath);
      const refreshed = JSON.parse(readFileSync(policyPath, "utf8"));
      assert.equal(refreshed.migrations[0].rollout, before.migrations[0].rollout);
      assert.equal(refreshed.migrations[0].sha256, migrationChecksum("SELECT 2;\n"));
      writeFileSync(join(migrationDirectory, "0002_second.sql"), "SELECT 3;\n");
      const unchanged = readFileSync(policyPath, "utf8");
      assert.throws(() => releaseMigrations.refreshMigrationPolicy(migrationDirectory, policyPath), /unreviewed|unregistered|new migration/i);
      assert.equal(readFileSync(policyPath, "utf8"), unchanged);
    });
  });

  test("history check permits new SQL but rejects modifications and removals from the base", () => {
    const { root, migration, base } = makeGitRepo();
    try {
      const added = join(root, "apps", "api", "migrations", "0002_expand.sql");
      writeFileSync(added, "ALTER TABLE item ADD COLUMN description text;\n");
      git(root, ["add", "apps/api/migrations/0002_expand.sql"]);
      git(root, ["commit", "-qm", "add migration"]);
      assert.doesNotThrow(() => releaseMigrations.assertImmutableMigrationHistory(base, { repoRoot: root }));

      writeFileSync(migration, "SELECT 9;\n");
      git(root, ["add", "apps/api/migrations/0001_initial.sql"]);
      git(root, ["commit", "-qm", "edit old migration"]);
      assert.throws(() => releaseMigrations.assertImmutableMigrationHistory(base, { repoRoot: root }), /immutable|modify|history/i);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("history check rejects removing a migration present in the base", () => {
    const { root, migration, base } = makeGitRepo();
    try {
      rmSync(migration);
      git(root, ["add", "-u"]);
      git(root, ["commit", "-qm", "remove old migration"]);
      assert.throws(() => releaseMigrations.assertImmutableMigrationHistory(base, { repoRoot: root }), /immutable|remov|history/i);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("expand policy rejects known destructive SQL while operator policy remains eligible for review", () => {
    withFixture({ "0001_first.sql": "-- DROP TABLE item;\nALTER TABLE item ADD COLUMN note text;\nALTER TABLE item ALTER COLUMN note SET DEFAULT 'DROP';\n" }, records => ({ schema: 1, migrations: [
      { ...records[0], rollout: "expand" },
    ] }), ({ migrationDirectory, policyPath }) => {
      const rows = inventory.loadMigrationInventory(migrationDirectory, policyPath);
      assert.doesNotThrow(() => inventory.assertSafeExpandMigrations(rows, migrationDirectory));
      for (const destructive of ["DELETE FROM item WHERE id = 1;", "ALTER TABLE item DROP COLUMN old_value;",
        "ALTER TABLE item DROP old_value;",
        "TRUNCATE item;", "DROP MATERIALIZED VIEW old_item_view;"]) {
        writeFileSync(join(migrationDirectory, rows[0].filename), `${destructive}\n`);
        assert.throws(() => inventory.assertSafeExpandMigrations(rows, migrationDirectory), /destructive|operator|expand/i);
      }
    });
    withFixture({ "0001_first.sql": "TRUNCATE item;\n" }, null, ({ migrationDirectory, policyPath }) => {
      const rows = inventory.loadMigrationInventory(migrationDirectory, policyPath);
      assert.doesNotThrow(() => inventory.assertSafeExpandMigrations(rows, migrationDirectory));
    });
  });
}
