import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Pool, type PoolClient } from "pg";
import { assertLocalFlow1TestTarget } from "../auth/local-flow1-test.js";
import { planMigrations, type MigrationInventoryEntry, type MigrationLedgerRow } from "./migration-plan.js";
import type * as InventoryModule from "../../migrations/inventory.mjs";

type Mode = "plan" | "apply-safe" | "local-full";

export function parseMigrationMode(arguments_: string[]): Mode {
  if (arguments_.length !== 1) throw new Error("Choose exactly one migration mode");
  const modeByArgument: Record<string, Mode> = {
    "--plan": "plan",
    "--apply-safe": "apply-safe",
    "--local-full": "local-full",
  };
  const mode = modeByArgument[arguments_[0]!];
  if (!mode) throw new Error("Unknown migration mode");
  return mode;
}

export function assertMigrationTarget(mode: string, databaseUrl: string, nodeEnvironment = ""):
  asserts mode is Mode {
  let target: URL;
  try { target = new URL(databaseUrl); }
  catch { throw new Error("Invalid migration database target"); }
  if (target.protocol !== "postgres:" && target.protocol !== "postgresql:") {
    throw new Error("Invalid migration database protocol");
  }
  if (target.search || target.hash) throw new Error("Migration database options are not accepted");
  const database = decodeURIComponent(target.pathname.replace(/^\//, ""));
  if (!database || !/^[a-zA-Z0-9_]{1,63}$/.test(database)) throw new Error("Invalid migration database name");
  const host = target.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const loopback = host === "127.0.0.1" || host === "localhost" || host === "::1";
  if (mode === "local-full") {
    if (nodeEnvironment === "production" || !loopback || !(database === "arden" || /^arden_test_[a-z0-9_]+$/.test(database))) {
      throw new Error("Full-chain migrations are restricted to a local Arden development or disposable test database");
    }
    return;
  }
  if (mode !== "plan" && mode !== "apply-safe") throw new Error("Unknown migration mode");
  if (nodeEnvironment !== "production" || loopback || !target.username || !target.password
    || (target.port && target.port !== "5432")) {
    throw new Error("Release migration modes require a production image and its private migration connection");
  }
}

const migrationDirectory = resolve(process.cwd(), "migrations");
const migrationPolicyPath = resolve(migrationDirectory, "release-policy.json");
const databaseUrlForMode = (mode: Mode): string => {
  if (mode === "local-full") {
    return process.env.ARDEN_MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL ??
      "postgresql://arden:arden_dev_only@127.0.0.1:5433/arden";
  }
  const value = process.env.ARDEN_MIGRATION_DATABASE_URL;
  if (!value) throw new Error("Private migration connection is unavailable");
  return value;
};

async function loadInventory(): Promise<MigrationInventoryEntry[]> {
  const moduleUrl = pathToFileURL(resolve(migrationDirectory, "inventory.mjs")).href;
  const inventory = await import(moduleUrl) as typeof InventoryModule;
  const entries = inventory.loadMigrationInventory(migrationDirectory, migrationPolicyPath);
  if (!entries.length) throw new Error("Migration inventory is empty");
  return entries;
}

async function ledgerSchema(client: PoolClient): Promise<"READY" | "BASELINE_REQUIRED"> {
  const result = await client.query<{ table_name: string | null }>(
    "SELECT to_regclass('public.arden_schema_migrations')::text AS table_name",
  );
  if (!result.rows[0]?.table_name) return "BASELINE_REQUIRED";
  const column = await client.query<{ present: boolean }>(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'arden_schema_migrations'
         AND column_name = 'checksum' AND data_type = 'text'
    ) AS present`);
  return column.rows[0]?.present ? "READY" : "BASELINE_REQUIRED";
}

async function readLedger(client: PoolClient): Promise<MigrationLedgerRow[] | null> {
  if (await ledgerSchema(client) !== "READY") return null;
  const result = await client.query<MigrationLedgerRow>(
    "SELECT migration_id, checksum FROM public.arden_schema_migrations ORDER BY migration_id",
  );
  return result.rows;
}

function safePlanOutput(plan: ReturnType<typeof planMigrations>) {
  return {
    status: plan.status,
    migration_ids: plan.pending.map((entry) => entry.filename.slice(0, -4)),
    ...(plan.reason ? { reason: plan.reason } : {}),
  };
}

function emit(output: unknown): void {
  process.stdout.write(`${JSON.stringify(output)}\n`);
}

export function formatMigrationFailure(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    const safeCode = typeof code === "string" && /^[A-Za-z0-9_]{1,32}$/.test(code) ? code : "unknown";
    return `Database migration failed (${safeCode})`;
  }
  if (error instanceof Error) {
    const message = error.message
      .replace(/\b(postgres(?:ql)?:\/\/)[^\s"'<>]+/gi, "$1[redacted]")
      .replace(/\b(pgpassword|password|passwd|pwd|secret|token|api[_-]?key|database[_-]?url|connection[_-]?string)(\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
        "$1$2[redacted]")
      .replace(/[\r\n\t]+/g, " ")
      .slice(0, 300);
    return `Migration runner failed: ${message || "unknown error"}`;
  }
  return "Migration runner failed: unknown error";
}

async function readOnlyPlan(pool: Pool, inventory: MigrationInventoryEntry[]): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const ledger = await readLedger(client);
    await client.query("COMMIT");
    if (ledger === null) {
      emit({ status: "BASELINE_REQUIRED", migration_ids: [], reason: "CHECKSUM_LEDGER_MISSING" });
      return 0;
    }
    const plan = planMigrations(inventory, ledger);
    emit(safePlanOutput(plan));
    return plan.status === "READY" || plan.status === "NO_PENDING" ? 0 : 1;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function acquireMigrationLock(client: PoolClient): Promise<boolean> {
  await client.query("SET lock_timeout = '5s'");
  await client.query("SET statement_timeout = '120s'");
  await client.query("SET idle_in_transaction_session_timeout = '30s'");
  await client.query("SET application_name = 'arden-release-migrations'");
  const result = await client.query<{ locked: boolean }>(
    "SELECT pg_try_advisory_lock(hashtext('arden:migrations')) AS locked",
  );
  return result.rows[0]?.locked === true;
}

async function releaseMigrationLock(client: PoolClient): Promise<void> {
  await client.query("SELECT pg_advisory_unlock(hashtext('arden:migrations'))").catch(() => undefined);
}

const localLedgerDdl = `
CREATE TABLE IF NOT EXISTS public.arden_schema_migrations (
  migration_id text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now(),
  checksum text
);
ALTER TABLE public.arden_schema_migrations ADD COLUMN IF NOT EXISTS checksum text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.arden_schema_migrations'::regclass
      AND conname = 'arden_schema_migrations_checksum_format') THEN
    ALTER TABLE public.arden_schema_migrations
      ADD CONSTRAINT arden_schema_migrations_checksum_format
      CHECK (checksum IS NULL OR checksum ~ '^[0-9a-f]{64}$');
  END IF;
END $$;
`;

async function prepareLocalLedger(client: PoolClient, inventory: MigrationInventoryEntry[]): Promise<void> {
  await client.query(localLedgerDdl);
  const rows = await client.query<MigrationLedgerRow>(
    "SELECT migration_id, checksum FROM public.arden_schema_migrations ORDER BY migration_id",
  );
  const known = new Map(inventory.map((entry) => [entry.filename.slice(0, -4), entry]));
  const seen = new Set<string>();
  const backfill: Array<{ migrationId: string; checksum: string }> = [];
  for (const row of rows.rows) {
    const candidate = known.get(row.migration_id);
    if (!candidate || seen.has(row.migration_id) || (row.checksum !== null && row.checksum !== candidate.sha256)) {
      throw new Error("Local migration ledger differs from this checkout");
    }
    seen.add(row.migration_id);
    if (row.checksum === null) {
      backfill.push({ migrationId: row.migration_id, checksum: candidate.sha256 });
    }
  }
  const applied = inventory.filter((entry) => seen.has(entry.filename.slice(0, -4)));
  if (applied.some((entry, index) => entry !== inventory[index])) {
    throw new Error("Local migration ledger is not an applied prefix");
  }
  for (const row of backfill) {
    await client.query("UPDATE public.arden_schema_migrations SET checksum = $2 WHERE migration_id = $1 AND checksum IS NULL",
      [row.migrationId, row.checksum]);
  }
}

async function applyLocalFull(pool: Pool, inventory: MigrationInventoryEntry[]): Promise<number> {
  const client = await pool.connect();
  try {
    if (!await acquireMigrationLock(client)) {
      emit({ status: "LOCKED", migration_ids: [] });
      return 1;
    }
    await prepareLocalLedger(client, inventory);
    const rows = await client.query<MigrationLedgerRow>(
      "SELECT migration_id, checksum FROM public.arden_schema_migrations ORDER BY migration_id",
    );
    const seen = new Set(rows.rows.map((row) => row.migration_id));
    const pending = inventory.filter((entry) => !seen.has(entry.filename.slice(0, -4)));
    for (const entry of pending) {
      const migrationId = entry.filename.slice(0, -4);
      await client.query("BEGIN");
      try {
        const current = await client.query<{ checksum: string | null }>(
          "SELECT checksum FROM public.arden_schema_migrations WHERE migration_id = $1",
          [migrationId],
        );
        if (current.rowCount) {
          if (current.rows[0]?.checksum !== entry.sha256) throw new Error("Local migration checksum changed during execution");
          await client.query("COMMIT");
          continue;
        }
        const sql = await readFile(resolve(migrationDirectory, entry.filename), "utf8");
        await client.query(sql);
        await client.query(
          "INSERT INTO public.arden_schema_migrations (migration_id, checksum) VALUES ($1, $2)",
          [migrationId, entry.sha256],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      }
    }
    emit({ status: pending.length ? "APPLIED" : "NO_PENDING", migration_ids: pending.map((entry) => entry.filename.slice(0, -4)) });
    return 0;
  } finally {
    await releaseMigrationLock(client);
    client.release();
  }
}

async function applySafe(pool: Pool, inventory: MigrationInventoryEntry[]): Promise<number> {
  const inventoryModule = await import(pathToFileURL(resolve(migrationDirectory, "inventory.mjs")).href) as typeof InventoryModule;
  inventoryModule.assertSafeExpandMigrations(inventory, migrationDirectory);
  const client = await pool.connect();
  try {
    if (!await acquireMigrationLock(client)) {
      emit({ status: "LOCKED", migration_ids: [] });
      return 1;
    }
    const ledger = await readLedger(client);
    if (ledger === null) {
      emit({ status: "BASELINE_REQUIRED", migration_ids: [], reason: "CHECKSUM_LEDGER_MISSING" });
      return 1;
    }
    const initial = planMigrations(inventory, ledger);
    if (initial.status === "NO_PENDING") {
      emit(safePlanOutput(initial));
      return 0;
    }
    if (initial.status !== "READY") {
      emit(safePlanOutput(initial));
      return 1;
    }

    const applied: string[] = [];
    for (const entry of initial.pending) {
      const migrationId = entry.filename.slice(0, -4);
      await client.query("BEGIN");
      try {
        const currentRows = await client.query<MigrationLedgerRow>(
          "SELECT migration_id, checksum FROM public.arden_schema_migrations ORDER BY migration_id",
        );
        const currentPlan = planMigrations(inventory, currentRows.rows);
        if (currentPlan.status !== "READY" || currentPlan.pending[0]?.filename !== entry.filename) {
          throw new Error("Migration state changed during execution");
        }
        const sql = await readFile(resolve(migrationDirectory, entry.filename), "utf8");
        await client.query(sql);
        await client.query(
          "INSERT INTO public.arden_schema_migrations (migration_id, checksum) VALUES ($1, $2)",
          [migrationId, entry.sha256],
        );
        await client.query("COMMIT");
        applied.push(migrationId);
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      }
    }
    emit({ status: "APPLIED", migration_ids: applied });
    return 0;
  } finally {
    await releaseMigrationLock(client);
    client.release();
  }
}

export async function runMigrationCommand(arguments_: string[]): Promise<number> {
  const mode = parseMigrationMode(arguments_);
  const databaseUrl = databaseUrlForMode(mode);
  assertMigrationTarget(mode, databaseUrl, process.env.NODE_ENV);
  if (mode === "local-full" && process.env.ARDEN_LOCAL_FLOW1_TEST_MODE === "true") {
    assertLocalFlow1TestTarget(databaseUrl, process.env.ARDEN_API_HOST ?? "127.0.0.1", process.env.NODE_ENV,
      Boolean(process.env.SUPABASE_URL || process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY));
  }
  const inventory = await loadInventory();
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 1,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 5000,
    statement_timeout: 120_000,
    application_name: "arden-migration-runner",
  });
  try {
    if (mode === "plan") return await readOnlyPlan(pool, inventory);
    if (mode === "apply-safe") return await applySafe(pool, inventory);
    return await applyLocalFull(pool, inventory);
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runMigrationCommand(process.argv.slice(2)).then((status) => {
    process.exitCode = status;
  }).catch((error: unknown) => {
    process.stderr.write(`${formatMigrationFailure(error)}\n`);
    emit({ status: "FAILED", reason: "MIGRATION_RUNNER_FAILED", migration_ids: [] });
    process.exitCode = 1;
  });
}
