import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { setSystemActor, systemAdministratorLifecycleLock, type SystemAuthDatabase } from "./database.js";

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

export type SystemAdminSessionRecord = {
  sessionId: string;
  adminId: string;
  expiresAt: Date;
};

export type ThrottleScope = "sign-in" | "setup";
export type ThrottleState = { retryAfterSeconds: number } | null;

export type SystemAuthErrorCode =
  | "SYSTEM_SETUP_ALREADY_COMPLETED"
  | "SYSTEM_ADMIN_EMAIL_CONFLICT";

export class SystemAuthError extends Error {
  constructor(readonly code: SystemAuthErrorCode) { super(code); }
}

/** Failed attempts allowed per bucket inside one window before a lockout starts. */
export const throttleFailureLimit = 5;
const throttleWindowSeconds = 15 * 60;
const throttleBaseLockSeconds = 30;
const throttleMaxLockSeconds = 15 * 60;

export interface SystemAuthStore {
  setupStatus(): Promise<SystemSetupStatus>;
  completeInitialSetup(input: {
    email: string;
    fullName: string;
    passwordHash: string;
    requestId: string;
    sessionExpiresAt: Date;
  }): Promise<{ account: SystemAdminAccount; session: SystemAdminSessionRecord }>;
  authenticateByEmail(email: string): Promise<{ account: SystemAdminAccount; passwordHash: string } | null>;
  startSession(adminId: string, requestId: string, expiresAt: Date): Promise<SystemAdminSessionRecord>;
  recordFailedSignIn(adminId: string, requestId: string): Promise<void>;
  getActiveSession(sessionId: string): Promise<{ session: SystemAdminSessionRecord; account: SystemAdminAccount } | null>;
  endSession(sessionId: string, requestId: string): Promise<void>;
  throttleState(scope: ThrottleScope, key: string): Promise<ThrottleState>;
  recordThrottleFailure(scope: ThrottleScope, key: string): Promise<ThrottleState>;
  clearThrottle(scope: ThrottleScope, key: string): Promise<void>;
}

export type SystemAdminRow = {
  admin_id: string;
  email: string;
  full_name: string;
  status: "ACTIVE" | "REVOKED";
  can_manage_system_admins: boolean;
  password_hash?: string;
};

export function mapSystemAdminAccount(row: SystemAdminRow): SystemAdminAccount {
  return {
    id: row.admin_id,
    email: row.email,
    fullName: row.full_name,
    status: row.status,
    canManageSystemAdmins: row.can_manage_system_admins,
  };
}

/** Throttle buckets store only a digest of the email or scope key. */
export function throttleBucket(scope: ThrottleScope, key: string): string {
  return `${scope}:${createHash("sha256").update(`arden:system-auth-throttle:${scope}:${key}`, "utf8").digest("hex")}`;
}

export function throttleLockSeconds(failures: number): number {
  if (failures < throttleFailureLimit) return 0;
  return Math.min(throttleMaxLockSeconds, throttleBaseLockSeconds * 2 ** (failures - throttleFailureLimit));
}

async function insertSession(client: PoolClient, adminId: string, expiresAt: Date): Promise<SystemAdminSessionRecord> {
  // Opportunistic cleanup keeps the session table bounded without a separate job.
  await client.query("DELETE FROM arden_system.admin_session WHERE expires_at < now() - interval '7 days'");
  const result = await client.query<{ session_id: string; admin_id: string; expires_at: Date }>(
    `INSERT INTO arden_system.admin_session (admin_id, expires_at)
     VALUES ($1, $2) RETURNING session_id, admin_id, expires_at`,
    [adminId, expiresAt],
  );
  const row = result.rows[0];
  if (!row) throw new Error("System Admin session was not created");
  return { sessionId: row.session_id, adminId: row.admin_id, expiresAt: row.expires_at };
}

/** Appends one audit event. Details are a JSON object of non-sensitive metadata only. */
export async function recordSystemAdministrationEvent(client: PoolClient, actorId: string | null, eventType: string,
  targetId: string | null, requestId: string, details: Record<string, unknown> = {}): Promise<void> {
  await client.query(
    `INSERT INTO arden_system.administration_event (
       actor_admin_id, event_type, target_admin_id, request_id, details_json
     ) VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [actorId, eventType, targetId, requestId, JSON.stringify(details)],
  );
}

export class PgSystemAuthStore implements SystemAuthStore {
  constructor(private readonly database: SystemAuthDatabase) {}

  async setupStatus(): Promise<SystemSetupStatus> {
    return this.database.transaction("setup", {}, async (client) => {
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
    sessionExpiresAt: Date;
  }) {
    return this.database.transaction("setup", {}, async (client) => {
      await client.query(systemAdministratorLifecycleLock);
      const statusResult = await client.query<{ needs_initial_setup: boolean }>(
        "SELECT needs_initial_setup FROM arden_system.installation_setup_status()",
      );
      if (!statusResult.rows[0]?.needs_initial_setup) {
        throw new SystemAuthError("SYSTEM_SETUP_ALREADY_COMPLETED");
      }
      let inserted: SystemAdminRow | undefined;
      try {
        const result = await client.query<SystemAdminRow>(
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
      await setSystemActor(client, inserted.admin_id);
      await recordSystemAdministrationEvent(client, inserted.admin_id, "SYSTEM_ADMIN_FIRST_SETUP", inserted.admin_id,
        input.requestId, { capabilities: ["INSTANCE_ADMIN", "MANAGE_SYSTEM_ADMINS"] });
      const session = await insertSession(client, inserted.admin_id, input.sessionExpiresAt);
      return { account: mapSystemAdminAccount(inserted), session };
    });
  }

  async authenticateByEmail(email: string): Promise<{ account: SystemAdminAccount; passwordHash: string } | null> {
    return this.database.transaction("sign_in", {}, async (client) => {
      const result = await client.query<SystemAdminRow>(
        `SELECT admin_id, email, full_name, status, can_manage_system_admins, password_hash
           FROM arden_system.administrator
          WHERE email = $1 AND status = 'ACTIVE'`,
        [email],
      );
      const row = result.rows[0];
      if (!row || !row.password_hash) return null;
      return { account: mapSystemAdminAccount(row), passwordHash: row.password_hash };
    });
  }

  async startSession(adminId: string, requestId: string, expiresAt: Date): Promise<SystemAdminSessionRecord> {
    return this.database.transaction("sign_in", { actorId: adminId }, async (client) => {
      const active = await client.query(
        "SELECT 1 FROM arden_system.administrator WHERE admin_id = $1 AND status = 'ACTIVE' FOR SHARE",
        [adminId],
      );
      if (!active.rowCount) throw new Error("System Admin is no longer active");
      await recordSystemAdministrationEvent(client, adminId, "SYSTEM_ADMIN_SIGNED_IN", adminId, requestId);
      return insertSession(client, adminId, expiresAt);
    });
  }

  async recordFailedSignIn(adminId: string, requestId: string): Promise<void> {
    await this.database.transaction("sign_in", {}, async (client) => {
      await recordSystemAdministrationEvent(client, null, "SYSTEM_ADMIN_SIGN_IN_FAILED", adminId, requestId);
    });
  }

  async getActiveSession(sessionId: string) {
    return this.database.transaction("session", { sessionId }, async (client) => {
      const session = await client.query<{ session_id: string; admin_id: string; expires_at: Date }>(
        `SELECT session_id, admin_id, expires_at FROM arden_system.admin_session
          WHERE session_id = $1 AND revoked_at IS NULL AND expires_at > now()`,
        [sessionId],
      );
      const sessionRow = session.rows[0];
      if (!sessionRow) return null;
      await setSystemActor(client, sessionRow.admin_id);
      const account = await client.query<SystemAdminRow>(
        `SELECT admin_id, email, full_name, status, can_manage_system_admins
           FROM arden_system.administrator WHERE admin_id = $1 AND status = 'ACTIVE'`,
        [sessionRow.admin_id],
      );
      const accountRow = account.rows[0];
      if (!accountRow) return null;
      return {
        session: { sessionId: sessionRow.session_id, adminId: sessionRow.admin_id, expiresAt: sessionRow.expires_at },
        account: mapSystemAdminAccount(accountRow),
      };
    });
  }

  async endSession(sessionId: string, requestId: string): Promise<void> {
    await this.database.transaction("session", { sessionId }, async (client) => {
      const ended = await client.query<{ admin_id: string }>(
        `UPDATE arden_system.admin_session SET revoked_at = now()
          WHERE session_id = $1 AND revoked_at IS NULL RETURNING admin_id`,
        [sessionId],
      );
      const adminId = ended.rows[0]?.admin_id;
      if (!adminId) return;
      await setSystemActor(client, adminId);
      await recordSystemAdministrationEvent(client, adminId, "SYSTEM_ADMIN_SIGNED_OUT", adminId, requestId);
    });
  }

  async throttleState(scope: ThrottleScope, key: string): Promise<ThrottleState> {
    return this.database.transaction(scope === "setup" ? "setup" : "sign_in", {}, async (client) => {
      const result = await client.query<{ retry_after: string | null }>(
        `SELECT ceil(extract(epoch FROM locked_until - now()))::text AS retry_after
           FROM arden_system.auth_throttle WHERE bucket = $1 AND locked_until > now()`,
        [throttleBucket(scope, key)],
      );
      const seconds = Number(result.rows[0]?.retry_after ?? 0);
      return seconds > 0 ? { retryAfterSeconds: seconds } : null;
    });
  }

  async recordThrottleFailure(scope: ThrottleScope, key: string): Promise<ThrottleState> {
    return this.database.transaction(scope === "setup" ? "setup" : "sign_in", {}, async (client) => {
      const bucket = throttleBucket(scope, key);
      await client.query("DELETE FROM arden_system.auth_throttle WHERE updated_at < now() - interval '1 day'");
      await client.query(
        "INSERT INTO arden_system.auth_throttle (bucket) VALUES ($1) ON CONFLICT (bucket) DO NOTHING",
        [bucket],
      );
      const current = await client.query<{ failures: number; window_expired: boolean }>(
        `SELECT failures, window_started_at < now() - make_interval(secs => $2) AS window_expired
           FROM arden_system.auth_throttle WHERE bucket = $1 FOR UPDATE`,
        [bucket, throttleWindowSeconds],
      );
      const row = current.rows[0];
      const restart = !row || row.window_expired;
      const failures = restart ? 1 : row.failures + 1;
      const lockSeconds = throttleLockSeconds(failures);
      await client.query(
        `UPDATE arden_system.auth_throttle
            SET failures = $2::integer,
                window_started_at = CASE WHEN $3::boolean THEN now() ELSE window_started_at END,
                locked_until = CASE WHEN $4::integer > 0 THEN now() + make_interval(secs => $4::integer) ELSE NULL END,
                updated_at = now()
          WHERE bucket = $1`,
        [bucket, failures, restart, lockSeconds],
      );
      return lockSeconds > 0 ? { retryAfterSeconds: lockSeconds } : null;
    });
  }

  async clearThrottle(scope: ThrottleScope, key: string): Promise<void> {
    await this.database.transaction(scope === "setup" ? "setup" : "sign_in", {}, async (client) => {
      await client.query("DELETE FROM arden_system.auth_throttle WHERE bucket = $1", [throttleBucket(scope, key)]);
    });
  }
}
