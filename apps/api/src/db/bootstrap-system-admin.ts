import { Pool } from "pg";

const databaseUrl = process.env.ARDEN_MIGRATION_DATABASE_URL;
const userId = process.env.ARDEN_BOOTSTRAP_SYSTEM_ADMIN_USER_ID;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

if (!databaseUrl) throw new Error("ARDEN_MIGRATION_DATABASE_URL is required for one-time System Admin bootstrap");
if (!userId || !uuid.test(userId)) throw new Error("ARDEN_BOOTSTRAP_SYSTEM_ADMIN_USER_ID must be a canonical UUID");

const pool = new Pool({ connectionString: databaseUrl, max: 1 });
try {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('arden:system-administrator-lifecycle', 0))");
    const migrated = await client.query(`SELECT 1 FROM public.arden_schema_migrations
      WHERE migration_id = '0017_audience_and_instance_admin_foundation'`);
    if (!migrated.rowCount) throw new Error("Migration 0017 must be applied before System Admin bootstrap");
    const existing = await client.query("SELECT 1 FROM arden.system_administrator LIMIT 1");
    if (existing.rowCount) throw new Error("System Admin bootstrap is closed because an administrator already exists");
    const account = await client.query("SELECT 1 FROM arden.user_account WHERE user_id = $1 AND status = 'ACTIVE'", [userId]);
    if (!account.rowCount) throw new Error("Bootstrap target must be an existing active Arden user account");
    await client.query(`INSERT INTO arden.system_administrator(user_id, status, granted_by_user_id)
      VALUES ($1, 'ACTIVE', NULL)`, [userId]);
    await client.query("COMMIT");
    process.stdout.write(`Bootstrapped Arden System Admin ${userId}. The one-time bootstrap is now closed.\n`);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
} finally {
  await pool.end();
}
