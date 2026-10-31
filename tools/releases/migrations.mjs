import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  assertImmutableMigrationHistory, assertSafeExpandMigrations,
  fingerprintMigrationInventory, loadMigrationInventory, migrationSqlChecksum,
} from "../../apps/api/migrations/inventory.mjs";

export { assertImmutableMigrationHistory };

const migrationFilename = /^(\d{4})_[a-z0-9_]+\.sql$/;
const digest = /^[0-9a-f]{64}$/;
const expectedPolicyKeys = ["schema", "migrations"];
const expectedRowKeys = ["id", "filename", "sha256", "rollout"];

function exactKeys(value, keys, description) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).sort().join("\0") !== [...keys].sort().join("\0")) {
    throw new Error(`Invalid ${description} fields`);
  }
}

function listMigrationFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.name.toLowerCase().endsWith(".sql")) continue;
    if (!entry.isFile() || !migrationFilename.test(entry.name)) {
      throw new Error(`Invalid numbered migration filename: ${entry.name}`);
    }
    files.push(entry.name);
  }
  return files.sort();
}

export function refreshMigrationPolicy(migrationDirectory, policyPath = join(migrationDirectory, "release-policy.json")) {
  const directory = resolve(migrationDirectory);
  const policyFile = resolve(policyPath);
  let policy;
  try { policy = JSON.parse(readFileSync(policyFile, "utf8")); }
  catch { throw new Error("Migration release policy is missing or invalid JSON"); }
  exactKeys(policy, expectedPolicyKeys, "migration release policy");
  if (policy.schema !== 1 || !Array.isArray(policy.migrations)) {
    throw new Error("Unsupported migration release policy schema");
  }

  const existingById = new Map();
  const filenames = new Set();
  for (const [index, row] of policy.migrations.entries()) {
    exactKeys(row, expectedRowKeys, `migration policy row ${index + 1}`);
    if (typeof row.id !== "string" || !/^\d{4}$/.test(row.id)
      || typeof row.filename !== "string" || !migrationFilename.test(row.filename)
      || row.filename.slice(0, 4) !== row.id || typeof row.sha256 !== "string" || !digest.test(row.sha256)
      || !["expand", "operator"].includes(row.rollout)) {
      throw new Error(`Invalid migration policy row ${index + 1}`);
    }
    if (existingById.has(row.id) || filenames.has(row.filename)) throw new Error(`Duplicate migration policy entry: ${row.id}`);
    existingById.set(row.id, row);
    filenames.add(row.filename);
  }

  const files = listMigrationFiles(directory);
  const currentById = new Map();
  for (const filename of files) {
    const id = filename.slice(0, 4);
    if (currentById.has(id)) throw new Error(`Duplicate migration ID: ${id}`);
    if (!existingById.has(id)) throw new Error(`Refusing to register unreviewed migration: ${id}`);
    const registered = existingById.get(id);
    if (registered.filename !== filename) throw new Error(`Migration filename changed for existing ID: ${id}`);
    const path = join(directory, filename);
    if (!lstatSync(path).isFile()) throw new Error(`Migration is not a regular file: ${filename}`);
    const sha256 = migrationSqlChecksum(readFileSync(path));
    currentById.set(id, { id, filename, sha256, rollout: registered.rollout });
  }
  if (currentById.size !== existingById.size) throw new Error("Refusing to remove a registered migration from policy");

  const next = { schema: 1, migrations: [...currentById.values()].sort((a, b) => a.id.localeCompare(b.id)) };
  // Validate the complete next manifest before replacing the existing file.
  const temporary = `${policyFile}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, { flag: "wx" });
  try {
    loadMigrationInventory(directory, temporary);
    renameSync(temporary, policyFile);
  }
  catch (error) {
    try { unlinkSync(temporary); } catch { /* Preserve the original policy on cleanup failure. */ }
    throw error;
  }
  return next.migrations;
}

export function checkMigrationInventory({ migrationDirectory = "apps/api/migrations", policyPath, baseSha, repoRoot = process.cwd() } = {}) {
  const entries = loadMigrationInventory(migrationDirectory, policyPath);
  assertSafeExpandMigrations(entries, migrationDirectory);
  if (baseSha !== undefined) assertImmutableMigrationHistory(baseSha, { repoRoot });
  return { entries, fingerprint: fingerprintMigrationInventory(entries) };
}

function parseArguments(args) {
  const [command, ...rest] = args;
  if (!new Set(["check", "refresh"]).has(command)) throw new Error("Use migrations.mjs check or migrations.mjs refresh");
  const options = {};
  while (rest.length) {
    const option = rest.shift();
    const value = rest.shift();
    if (!value || !["--base", "--directory", "--policy"].includes(option) || options[option]) {
      throw new Error("Invalid migration command arguments");
    }
    options[option] = value;
  }
  return { command, options };
}

function main(args) {
  const { command, options } = parseArguments(args);
  const directory = options["--directory"] ?? "apps/api/migrations";
  const policyPath = options["--policy"] ?? join(directory, "release-policy.json");
  if (command === "refresh") {
    const entries = refreshMigrationPolicy(directory, policyPath);
    console.log(`Refreshed checksums for ${entries.length} registered migrations; rollout classes were preserved.`);
    return;
  }
  const result = checkMigrationInventory({ migrationDirectory: directory, policyPath,
    baseSha: options["--base"], repoRoot: process.cwd() });
  console.log(`Migration inventory passed: ${result.entries.length} entries, fingerprint ${result.fingerprint}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main(process.argv.slice(2)); }
  catch (error) {
    console.error(error instanceof Error ? error.message : "Migration inventory check failed");
    process.exitCode = 1;
  }
}
