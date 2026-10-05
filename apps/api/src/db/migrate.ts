import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";

const databaseUrl = process.env.ARDEN_MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL ??
  (process.env.NODE_ENV === "production"
    ? undefined
    : "postgresql://arden:arden_dev_only@127.0.0.1:5433/arden");

if (!databaseUrl) throw new Error("ARDEN_MIGRATION_DATABASE_URL or DATABASE_URL is required");

const migrationDirectory = resolve(process.cwd(), "migrations");
const migrationIds = (await readdir(migrationDirectory))
  .filter((file) => /^\d{4}_[a-z0-9_]+\.sql$/.test(file))
  .map((file) => file.slice(0, -4))
  .sort();
if (migrationIds.length === 0) throw new Error("No versioned SQL migrations were found");
const pool = new Pool({ connectionString: databaseUrl, max: 1 });

try {
  const client = await pool.connect();
  try {
    await client.query("CREATE TABLE IF NOT EXISTS public.arden_schema_migrations (migration_id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('arden:migrations'))");
    const applied = await client.query<{ migration_id: string }>("SELECT migration_id FROM public.arden_schema_migrations");
    const appliedIds = new Set(applied.rows.map((row) => row.migration_id));
    const unknownApplied = [...appliedIds].filter((id) => !migrationIds.includes(id));
    if (unknownApplied.length) throw new Error(`Database has migrations missing from this checkout: ${unknownApplied.join(", ")}`);
    const pending = migrationIds.filter((id) => !appliedIds.has(id));
    if (pending.length === 0) {
      await client.query("ROLLBACK");
      process.stdout.write("Database schema is up to date.\n");
    } else {
      await client.query("COMMIT");
      for (const migrationId of pending) {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(hashtext('arden:migrations'))");
        const current = await client.query("SELECT 1 FROM public.arden_schema_migrations WHERE migration_id = $1", [migrationId]);
        if (current.rowCount) {
          await client.query("COMMIT");
          continue;
        }
        const sql = await readFile(resolve(migrationDirectory, `${migrationId}.sql`), "utf8");
        await client.query(sql);
        await client.query("INSERT INTO public.arden_schema_migrations (migration_id) VALUES ($1)", [migrationId]);
        await client.query("COMMIT");
        process.stdout.write(`Applied migration ${migrationId}.\n`);
      }
    }
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
} finally {
  await pool.end();
}
