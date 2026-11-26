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
    const leastPrivilegeMigration = await client.query(`SELECT 1 FROM public.arden_schema_migrations
      WHERE migration_id = '0071_system_console_least_privilege'`);
    if (!migrated.rowCount || !leastPrivilegeMigration.rowCount) {
      throw new Error("Migrations 0017 and 0071 must be applied before System Admin bootstrap");
    }
    const existing = await client.query<{ active_admins: string; active_managers: string }>(`
      SELECT count(*) FILTER (WHERE sa.status='ACTIVE' AND ua.status='ACTIVE')::text AS active_admins,
             count(*) FILTER (WHERE sa.status='ACTIVE' AND ua.status='ACTIVE'
               AND sa.can_manage_system_admins)::text AS active_managers
        FROM arden.system_administrator sa
        JOIN arden.user_account ua ON ua.user_id = sa.user_id`);
    if (Number(existing.rows[0]?.active_managers ?? 0) > 0) {
      throw new Error("System Admin manager bootstrap is closed because a manager already exists");
    }
    const account = await client.query(`SELECT 1 FROM arden.user_account ua WHERE ua.user_id = $1 AND ua.status = 'ACTIVE'
      AND NOT EXISTS (SELECT 1 FROM arden.organization_membership om WHERE om.user_id = ua.user_id)`, [userId]);
    if (!account.rowCount) throw new Error("Bootstrap target must be an active Arden account without any organization membership");
    const bootstrapType = Number(existing.rows[0]?.active_admins ?? 0) === 0
      ? "SYSTEM_ADMIN_BOOTSTRAPPED" : "SYSTEM_ADMIN_MANAGER_BOOTSTRAPPED";
    const granted = await client.query(`INSERT INTO arden.system_administrator(
        user_id, status, can_manage_system_admins, granted_by_user_id, granted_at, revoked_by_user_id, revoked_at)
      VALUES ($1, 'ACTIVE', true, NULL, now(), NULL, NULL)
      ON CONFLICT (user_id) DO UPDATE SET status='ACTIVE', can_manage_system_admins=true,
        granted_by_user_id=NULL, granted_at=now(), revoked_by_user_id=NULL, revoked_at=NULL, updated_at=now()
      WHERE system_administrator.status='REVOKED'
         OR (system_administrator.status='ACTIVE' AND NOT system_administrator.can_manage_system_admins)
      RETURNING user_id`, [userId]);
    if (!granted.rowCount) throw new Error("Bootstrap target already has an active System Admin manager assignment");
    await client.query(`INSERT INTO arden.system_administration_event(
      actor_user_id, event_type, target_user_id, request_id, details_json)
      VALUES ($1, $2, $1, $3, '{"capabilities":["INSTANCE_ADMIN","MANAGE_SYSTEM_ADMINS"]}'::jsonb)`,
    [userId, bootstrapType, `bootstrap:${userId}`]);
    await client.query("COMMIT");
    process.stdout.write(`Bootstrapped the first Arden System Admin manager ${userId}. The one-time bootstrap is now closed.\n`);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
} finally {
  await pool.end();
}
