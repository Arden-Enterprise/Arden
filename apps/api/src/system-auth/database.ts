import type { Pool, PoolClient } from "pg";

/** Transaction-local RLS modes understood by the `arden_system` policies. */
export type SystemAuthMode = "setup" | "sign_in" | "session" | "manager";

export const systemAdministratorLifecycleLock = "SELECT pg_advisory_xact_lock(hashtextextended('arden:system-administrator-lifecycle', 0))";

/**
 * Runs isolated System Admin work as `arden_system_auth`. The pool must come from the
 * dedicated `ARDEN_SYSTEM_AUTH_DATABASE_URL` login (a member of `arden_system_auth` only);
 * the ordinary request login has no membership in that role.
 */
export class SystemAuthDatabase {
  constructor(private readonly pool: Pool) {}

  async transaction<T>(mode: SystemAuthMode, context: { actorId?: string | null; sessionId?: string | null },
    work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE arden_system_auth");
      await client.query("SET LOCAL search_path TO arden_system, arden, public");
      await client.query(
        `SELECT set_config('arden.system_auth_mode', $1, true),
                set_config('arden.actor_id', $2, true),
                set_config('arden.system_session_id', $3, true),
                set_config('arden.instance_admin', 'false', true)`,
        [mode, context.actorId ?? "", context.sessionId ?? ""],
      );
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}

export async function setSystemActor(client: PoolClient, actorId: string): Promise<void> {
  await client.query("SELECT set_config('arden.actor_id', $1, true)", [actorId]);
}
