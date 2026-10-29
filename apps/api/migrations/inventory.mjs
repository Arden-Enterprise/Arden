import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const migrationFilename = /^(\d{4})_[a-z0-9_]+\.sql$/;
const digest = /^[0-9a-f]{64}$/;
const rollouts = new Set(["expand", "operator"]);
const policyKeys = ["schema", "migrations"];
const migrationKeys = ["id", "filename", "sha256", "rollout"];

function exactKeys(value, expected, description) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).sort().join("\0") !== [...expected].sort().join("\0")) {
    throw new Error(`Invalid ${description} fields`);
  }
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function validateEntry(entry, index) {
  exactKeys(entry, migrationKeys, `migration policy row ${index + 1}`);
  if (typeof entry.id !== "string" || !/^\d{4}$/.test(entry.id)
    || typeof entry.filename !== "string" || !migrationFilename.test(entry.filename)
    || entry.filename.slice(0, 4) !== entry.id
    || typeof entry.sha256 !== "string" || !digest.test(entry.sha256)
    || !rollouts.has(entry.rollout)) {
    throw new Error(`Invalid migration policy row ${index + 1}`);
  }
}

export function loadMigrationInventory(migrationDirectory, policyPath = join(migrationDirectory, "release-policy.json")) {
  const directory = resolve(migrationDirectory);
  const policyFile = resolve(policyPath);
  let policy;
  try {
    policy = JSON.parse(readFileSync(policyFile, "utf8"));
  } catch {
    throw new Error("Migration release policy is missing or invalid JSON");
  }
  exactKeys(policy, policyKeys, "migration release policy");
  if (policy.schema !== 1 || !Array.isArray(policy.migrations)) {
    throw new Error("Unsupported migration release policy schema");
  }

  const sqlFiles = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.name.toLowerCase().endsWith(".sql")) continue;
    if (!entry.isFile() || !migrationFilename.test(entry.name)) {
      throw new Error(`Invalid numbered migration filename: ${entry.name}`);
    }
    sqlFiles.push(entry.name);
  }
  sqlFiles.sort();
  if (!sqlFiles.length) throw new Error("Missing migration inventory");

  const ids = new Set();
  const actual = new Map();
  for (const filename of sqlFiles) {
    const id = filename.slice(0, 4);
    if (ids.has(id)) throw new Error(`Duplicate migration ID: ${id}`);
    ids.add(id);
    const path = join(directory, filename);
    if (!lstatSync(path).isFile()) throw new Error(`Migration is not a regular file: ${filename}`);
    actual.set(id, { id, filename, sha256: sha256(readFileSync(path)) });
  }

  const policyById = new Map();
  const policyFilenames = new Set();
  for (const [index, entry] of policy.migrations.entries()) {
    validateEntry(entry, index);
    if (policyById.has(entry.id) || policyFilenames.has(entry.filename)) {
      throw new Error(`Duplicate migration policy entry: ${entry.id}`);
    }
    policyById.set(entry.id, entry);
    policyFilenames.add(entry.filename);
  }
  if (policyById.size !== actual.size) throw new Error("Migration policy does not match the SQL inventory");

  return [...actual.values()].map(source => {
    const registered = policyById.get(source.id);
    if (!registered || registered.filename !== source.filename || registered.sha256 !== source.sha256) {
      throw new Error(`Migration policy checksum or filename mismatch: ${source.id}`);
    }
    return { ...source, rollout: registered.rollout };
  });
}

export function fingerprintMigrationInventory(entries) {
  if (!Array.isArray(entries) || !entries.length) throw new Error("Missing migration inventory");
  const normalized = entries.map((entry, index) => {
    validateEntry(entry, index);
    return { id: entry.id, filename: entry.filename, sha256: entry.sha256, rollout: entry.rollout };
  }).sort((left, right) => left.id.localeCompare(right.id));
  for (let index = 1; index < normalized.length; index += 1) {
    if (normalized[index - 1].id === normalized[index].id) throw new Error(`Duplicate migration ID: ${normalized[index].id}`);
  }
  return sha256(Buffer.from(JSON.stringify(normalized), "utf8"));
}

function removeSqlComments(sql) {
  let output = "";
  let lineComment = false;
  let blockDepth = 0;
  let quote = null;
  for (let index = 0; index < sql.length; index += 1) {
    const current = sql[index];
    const next = sql[index + 1];
    if (lineComment) {
      if (current === "\n") { lineComment = false; output += "\n"; }
      continue;
    }
    if (blockDepth > 0) {
      if (current === "/" && next === "*") { blockDepth += 1; index += 1; }
      else if (current === "*" && next === "/") { blockDepth -= 1; index += 1; }
      else if (current === "\n") output += "\n";
      continue;
    }
    if (quote) {
      output += current;
      if (current === quote && next === quote) { output += next; index += 1; }
      else if (current === quote) quote = null;
      continue;
    }
    if (current === "'" || current === '"') { quote = current; output += current; }
    else if (current === "-" && next === "-") { lineComment = true; index += 1; }
    else if (current === "/" && next === "*") { blockDepth = 1; index += 1; }
    else output += current;
  }
  return output;
}

const destructiveSql = [
  /\bDROP\s+(?:TABLE|COLUMN|SCHEMA|TYPE|INDEX|CONSTRAINT|FUNCTION|TRIGGER|DATABASE|SEQUENCE|VIEW|MATERIALIZED\s+VIEW|OWNED|POLICY|ROLE|EXTENSION)\b/i,
  /\bTRUNCATE(?:\s+TABLE)?\b/i,
  /\bDELETE\s+FROM\b/i,
];

export function assertSafeExpandMigrations(entries, migrationDirectory) {
  for (const entry of entries) {
    if (entry.rollout !== "expand") continue;
    const sql = removeSqlComments(readFileSync(join(migrationDirectory, entry.filename), "utf8"));
    if (destructiveSql.some(pattern => pattern.test(sql))) {
      throw new Error(`Migration ${entry.id} contains a known destructive SQL operation and must remain operator-class`);
    }
  }
}

export function assertImmutableMigrationHistory(baseSha, { repoRoot = process.cwd(), head = "HEAD" } = {}) {
  if (baseSha === "0".repeat(40)) return;
  if (typeof baseSha !== "string" || !/^[0-9a-f]{40}$/.test(baseSha)) {
    throw new Error("Migration history check requires a full base commit SHA");
  }
  try {
    execFileSync("git", ["cat-file", "-e", `${baseSha}^{commit}`], { cwd: repoRoot, stdio: "ignore" });
  } catch {
    try {
      execFileSync("git", ["fetch", "--no-tags", "--depth=1", "origin", baseSha], {
        cwd: repoRoot, stdio: "ignore", timeout: 120_000,
      });
    } catch {
      throw new Error("Migration base commit is unavailable; fetch it before checking history");
    }
  }
  let changes;
  try {
    changes = execFileSync("git", ["diff", "--no-renames", "--name-status", baseSha, head, "--", "apps/api/migrations"], {
      cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    throw new Error("Could not compare migration history with the requested base");
  }
  for (const line of changes.split(/\r?\n/).filter(Boolean)) {
    const [status, file] = line.split("\t");
    if (file?.toLowerCase().endsWith(".sql") && status !== "A") {
      throw new Error(`Existing migration history is immutable; ${status} ${basename(file)} against the base`);
    }
  }
}
