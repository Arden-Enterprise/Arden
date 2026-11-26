import type { Pool, PoolClient } from "pg";

export type SystemAdminAccount = {
  id: string;
  email: string;
  fullName: string;
  status: "ACTIVE" | "REVOKED";
  canManageSystemAdmins: boolean;
};

export type SystemSetupStatus = {
  needsInitialSetup: boolean;
  hasOrganizations: boolean;
};

export type SystemAuthErrorCode =
  | "SYSTEM_SETUP_ALREADY_COMPLETED"
  | "SYSTEM_ADMIN_EMAIL_CONFLICT";

export class SystemAuthError extends Error {
  constructor(readonly code: SystemAuthErrorCode) { super(code); }
}

export interface SystemAuthStore {
  setupStatus(): Promise<SystemSetupStatus>;
  completeInitialSetup(input: {
    email: string;
    fullName: string;
    passwordHash: string;
    requestId: string;
  }): Promise<SystemAdminAccount>;
  authenticateByEmail(email: string): Promise<{ account: SystemAdminAccount; passwordHash: string } | null>;
  recordSignIn(adminId: string, requestId: string): Promise<void>;
  getActiveAdministrator(adminId: string): Promise<SystemAdminAccount | null>;
}

type AdminRow = {
  admin_id: string;
  email: string;
  full_name: string;
  status: "ACTIVE" | "REVOKED";
  can_manage_system_admins: boolean;
  password_hash?: string;
};

function mapAccount(row: AdminRow): SystemAdminAccount {
  return {
    id: row.admin_id,
    email: row.email,
    fullName: row.full_name,
    status: row.status,
    canManageSystemAdmins: row.can_manage_system_admins,
  };
}

export class PgSystemAuthStore implements SystemAuthStore {
  constructor(private readonly pool: Pool) {}

  private async withSystemAuthRole<T>(
    mode: "setup" | "sign_in" | "session" | "manager",
    actorId: string | null,
    work: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE arden_system_auth");
      await client.query("SET LOCAL search_path TO arden_system, arden, public");
      await client.query(
        `SELECT set_config('arden.system_auth_mode', $1, true),
                set_config('arden.actor_id', $2, true),
                set_config('arden.instance_admin', 'false', true)`,
        [mode, actorId ?? ""],
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

  async setupStatus(): Promise<SystemSetupStatus> {
    return this.withSystemAuthRole("setup", null, async (client) => {
      const result = await client.query<{ needs_initial_setup: boolean; has_organizations: boolean }>(
        "SELECT needs_initial_setup, has_organizations FROM arden_system.installation_setup_status()",
      );
      const row = result.rows[0];
      return {
        needsInitialSetup: Boolean(row?.needs_initial_setup),
        hasOrganizations: Boolean(row?.has_organizations),
      };
    });
  }

  async completeInitialSetup(input: {
    email: string;
    fullName: string;
    passwordHash: string;
    requestId: string;
  }): Promise<SystemAdminAccount> {
    return this.withSystemAuthRole("setup", null, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('arden:system-administrator-lifecycle', 0))");
      const statusResult = await client.query<{ needs_initial_setup: boolean }>(
        "SELECT needs_initial_setup FROM arden_system.installation_setup_status()",
      );
      if (!statusResult.rows[0]?.needs_initial_setup) {
        throw new SystemAuthError("SYSTEM_SETUP_ALREADY_COMPLETED");
      }
      let inserted: AdminRow | undefined;
      try {
        const result = await client.query<AdminRow>(
          `INSERT INTO arden_system.administrator (
             email, full_name, password_hash, status, can_manage_system_admins, granted_by_admin_id
           ) VALUES ($1, $2, $3, 'ACTIVE', true, NULL)
           RETURNING admin_id, email, full_name, status, can_manage_system_admins`,
          [input.email, input.fullName, input.passwordHash],
        );
        inserted = result.rows[0];
      } catch (error) {
        if ((error as { code?: string }).code === "23505") {
          throw new SystemAuthError("SYSTEM_ADMIN_EMAIL_CONFLICT");
        }
        throw error;
      }
      if (!inserted) {
        throw new SystemAuthError("SYSTEM_SETUP_ALREADY_COMPLETED");
      }
      await client.query("SELECT set_config('arden.actor_id', $1, true)", [inserted.admin_id]);
      await client.query(
        `INSERT INTO arden_system.administration_event (
           actor_admin_id, event_type, target_admin_id, request_id, details_json
         ) VALUES ($1, 'SYSTEM_ADMIN_FIRST_SETUP', $1, $2, '{"capabilities":["INSTANCE_ADMIN","MANAGE_SYSTEM_ADMINS"]}'::jsonb)`,
        [inserted.admin_id, input.requestId],
      );
      return mapAccount(inserted);
    });
  }

  async authenticateByEmail(email: string): Promise<{ account: SystemAdminAccount; passwordHash: string } | null> {
    return this.withSystemAuthRole("sign_in", null, async (client) => {
      const result = await client.query<AdminRow>(
        `SELECT admin_id, email, full_name, status, can_manage_system_admins, password_hash
           FROM arden_system.administrator
          WHERE email = $1 AND status = 'ACTIVE'`,
        [email],
      );
      const row = result.rows[0];
      if (!row || !row.password_hash) return null;
      return { account: mapAccount(row), passwordHash: row.password_hash };
    });
  }

  async recordSignIn(adminId: string, requestId: string): Promise<void> {
    await this.withSystemAuthRole("sign_in", adminId, async (client) => {
      await client.query(
        `INSERT INTO arden_system.administration_event (
           actor_admin_id, event_type, target_admin_id, request_id, details_json
         ) VALUES ($1, 'SYSTEM_ADMIN_SIGNED_IN', $1, $2, '{}'::jsonb)`,
        [adminId, requestId],
      );
    });
  }

  async getActiveAdministrator(adminId: string): Promise<SystemAdminAccount | null> {
    return this.withSystemAuthRole("session", adminId, async (client) => {
      const result = await client.query<AdminRow>(
        `SELECT admin_id, email, full_name, status, can_manage_system_admins
           FROM arden_system.administrator
          WHERE admin_id = $1 AND status = 'ACTIVE'`,
        [adminId],
      );
      const row = result.rows[0];
      return row ? mapAccount(row) : null;
    });
  }
}
