import type { PoolClient } from "pg";
import { systemAdministratorLifecycleLock, type SystemAuthDatabase } from "../system-auth/database.js";
import { recordSystemAdministrationEvent } from "../system-auth/store.js";

/** An isolated `arden_system.administrator` identity, never a Supabase/`arden.account` user. */
export type SystemAdministrator = {
  id: string;
  email: string;
  fullName: string;
  status: "ACTIVE" | "REVOKED";
  canManageSystemAdmins: boolean;
  grantedByAdminId: string | null;
  grantedAt: Date;
  revokedByAdminId: string | null;
  revokedAt: Date | null;
};

export type SystemAdministrationEvent = {
  id: string;
  actorAdminId: string | null;
  eventType: string;
  targetAdminId: string | null;
  requestId: string;
  occurredAt: Date;
};

export type SystemAdministrationOverview = {
  administrators: SystemAdministrator[];
  recentEvents: SystemAdministrationEvent[];
};

export type SystemAdministrationErrorCode =
  | "SYSTEM_ADMINISTRATION_UNAVAILABLE"
  | "SYSTEM_ADMINISTRATOR_CONFLICT"
  | "SYSTEM_ADMINISTRATOR_LAST_ACTIVE"
  | "SYSTEM_ADMINISTRATOR_LAST_MANAGER";

export class SystemAdministrationError extends Error {
  constructor(readonly code: SystemAdministrationErrorCode) { super(code); }
}

export type SystemAdministrationActor = { adminId: string; sessionId: string };
export type NewSystemAdministrator = { email: string; fullName: string; passwordHash: string };

export interface SystemAdministrationStore {
  overview(actor: SystemAdministrationActor): Promise<SystemAdministrationOverview>;
  grant(actor: SystemAdministrationActor, target: NewSystemAdministrator, requestId: string): Promise<SystemAdministrator>;
  revoke(actor: SystemAdministrationActor, targetAdminId: string, requestId: string): Promise<SystemAdministrator>;
  setManagerCapability(actor: SystemAdministrationActor, targetAdminId: string, enabled: boolean,
    requestId: string): Promise<SystemAdministrator>;
}

type AdministratorRow = {
  admin_id: string;
  email: string;
  full_name: string;
  status: "ACTIVE" | "REVOKED";
  can_manage_system_admins: boolean;
  granted_by_admin_id: string | null;
  granted_at: Date;
  revoked_by_admin_id: string | null;
  revoked_at: Date | null;
};

const administratorColumns = `id AS admin_id, email, full_name, status, can_manage_system_admins,
  granted_by_id AS granted_by_admin_id, granted_at, revoked_by_id AS revoked_by_admin_id, revoked_at`;

function mapAdministrator(row: AdministratorRow): SystemAdministrator {
  return { id: row.admin_id, email: row.email, fullName: row.full_name, status: row.status,
    canManageSystemAdmins: row.can_manage_system_admins, grantedByAdminId: row.granted_by_admin_id,
    grantedAt: row.granted_at, revokedByAdminId: row.revoked_by_admin_id, revokedAt: row.revoked_at };
}

function lastAdministratorError(error: unknown): SystemAdministrationError | null {
  if ((error as { code?: string }).code !== "23514") return null;
  const message = (error as { message?: string }).message ?? "";
  if (message.includes("last System Admin manager")) return new SystemAdministrationError("SYSTEM_ADMINISTRATOR_LAST_MANAGER");
  if (message.includes("last active Arden System Admin")) return new SystemAdministrationError("SYSTEM_ADMINISTRATOR_LAST_ACTIVE");
  return null;
}

/**
 * MANAGE_SYSTEM_ADMINS operations on the isolated identity store. Every call serializes on
 * the lifecycle lock and rechecks, inside the transaction, that the actor's session is live
 * and the actor is still an active manager. The database trigger protects the last
 * active administrator and the last active manager.
 */
export class PgSystemAdministrationStore implements SystemAdministrationStore {
  constructor(private readonly database: SystemAuthDatabase) {}

  private manager<T>(actor: SystemAdministrationActor, work: (client: PoolClient) => Promise<T>): Promise<T> {
    return this.database.transaction("manager", { actorId: actor.adminId, sessionId: actor.sessionId }, async (client) => {
      await client.query(systemAdministratorLifecycleLock);
      const current = await client.query(
        `SELECT 1 FROM arden_system.administrator a
           JOIN arden_system.admin_session s ON s.admin_id = a.id
          WHERE a.id = $1 AND a.status = 'ACTIVE' AND a.can_manage_system_admins
            AND s.id = $2 AND s.revoked_at IS NULL AND s.expires_at > now()`,
        [actor.adminId, actor.sessionId],
      );
      if (!current.rowCount) throw new SystemAdministrationError("SYSTEM_ADMINISTRATION_UNAVAILABLE");
      try {
        return await work(client);
      } catch (error) {
        throw lastAdministratorError(error) ?? error;
      }
    });
  }

  private async read(client: PoolClient, adminId: string): Promise<SystemAdministrator> {
    const result = await client.query<AdministratorRow>(
      `SELECT ${administratorColumns} FROM arden_system.administrator WHERE id = $1`, [adminId]);
    const row = result.rows[0];
    if (!row) throw new SystemAdministrationError("SYSTEM_ADMINISTRATOR_CONFLICT");
    return mapAdministrator(row);
  }

  overview(actor: SystemAdministrationActor) {
    return this.manager(actor, async (client) => {
      const administrators = await client.query<AdministratorRow>(
        `SELECT ${administratorColumns} FROM arden_system.administrator ORDER BY status, granted_at, id`);
      const recentEvents = await client.query<{ event_id: string; actor_admin_id: string | null; event_type: string;
        target_admin_id: string | null; request_id: string; occurred_at: Date }>(
        `SELECT id AS event_id, actor_id AS actor_admin_id, event_type, target_id AS target_admin_id, request_id, occurred_at
           FROM arden_system.administration_event ORDER BY occurred_at DESC, event_id DESC LIMIT 100`);
      return {
        administrators: administrators.rows.map(mapAdministrator),
        recentEvents: recentEvents.rows.map((row) => ({ id: row.event_id, actorAdminId: row.actor_admin_id,
          eventType: row.event_type, targetAdminId: row.target_admin_id, requestId: row.request_id,
          occurredAt: row.occurred_at })),
      };
    });
  }

  /** Creates a monitoring-only administrator, or reactivates a revoked one with a new password. */
  grant(actor: SystemAdministrationActor, target: NewSystemAdministrator, requestId: string) {
    return this.manager(actor, async (client) => {
      const changed = await client.query<{ admin_id: string }>(
        `INSERT INTO arden_system.administrator (email, full_name, password_hash, status,
           can_manage_system_admins, granted_by_id, granted_at)
         VALUES ($1, $2, $3, 'ACTIVE', false, $4, now())
         ON CONFLICT (email) DO UPDATE SET status = 'ACTIVE', full_name = EXCLUDED.full_name,
           password_hash = EXCLUDED.password_hash, can_manage_system_admins = false,
           granted_by_id = EXCLUDED.granted_by_id, granted_at = now(),
           revoked_by_id = NULL, revoked_at = NULL, updated_at = now()
         WHERE arden_system.administrator.status = 'REVOKED'
         RETURNING id AS admin_id`,
        [target.email, target.fullName, target.passwordHash, actor.adminId],
      );
      const adminId = changed.rows[0]?.admin_id;
      if (!adminId) throw new SystemAdministrationError("SYSTEM_ADMINISTRATOR_CONFLICT");
      await recordSystemAdministrationEvent(client, actor.adminId, "SYSTEM_ADMINISTRATOR_GRANTED", adminId, requestId,
        { capabilities: ["INSTANCE_ADMIN"] });
      return this.read(client, adminId);
    });
  }

  revoke(actor: SystemAdministrationActor, targetAdminId: string, requestId: string) {
    return this.manager(actor, async (client) => {
      const changed = await client.query(
        `UPDATE arden_system.administrator
            SET status = 'REVOKED', can_manage_system_admins = false, revoked_by_id = $2,
                revoked_at = now(), updated_at = now()
          WHERE id = $1 AND status = 'ACTIVE'`,
        [targetAdminId, actor.adminId],
      );
      if (!changed.rowCount) throw new SystemAdministrationError("SYSTEM_ADMINISTRATOR_CONFLICT");
      // Revocation ends every live session of the target immediately.
      await client.query(
        "UPDATE arden_system.admin_session SET revoked_at = now() WHERE admin_id = $1 AND revoked_at IS NULL",
        [targetAdminId],
      );
      await recordSystemAdministrationEvent(client, actor.adminId, "SYSTEM_ADMINISTRATOR_REVOKED", targetAdminId, requestId);
      return this.read(client, targetAdminId);
    });
  }

  setManagerCapability(actor: SystemAdministrationActor, targetAdminId: string, enabled: boolean, requestId: string) {
    return this.manager(actor, async (client) => {
      const changed = await client.query(
        `UPDATE arden_system.administrator SET can_manage_system_admins = $2, updated_at = now()
          WHERE id = $1 AND status = 'ACTIVE' AND can_manage_system_admins IS DISTINCT FROM $2`,
        [targetAdminId, enabled],
      );
      if (!changed.rowCount) {
        const current = await client.query(
          `SELECT 1 FROM arden_system.administrator
            WHERE id = $1 AND status = 'ACTIVE' AND can_manage_system_admins = $2`,
          [targetAdminId, enabled],
        );
        if (!current.rowCount) throw new SystemAdministrationError("SYSTEM_ADMINISTRATOR_CONFLICT");
        return this.read(client, targetAdminId);
      }
      await recordSystemAdministrationEvent(client, actor.adminId,
        enabled ? "SYSTEM_ADMIN_MANAGER_ENABLED" : "SYSTEM_ADMIN_MANAGER_DISABLED", targetAdminId, requestId);
      return this.read(client, targetAdminId);
    });
  }
}
