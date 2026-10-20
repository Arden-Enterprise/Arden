import type { PoolClient } from "pg";

export type SystemAdministrator = {
  userId: string;
  status: "ACTIVE" | "REVOKED";
  grantedByUserId: string | null;
  grantedAt: Date;
  revokedByUserId: string | null;
  revokedAt: Date | null;
};

export type SystemAdministrationEvent = {
  id: string;
  actorUserId: string;
  eventType: string;
  targetUserId: string | null;
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
  | "SYSTEM_ADMINISTRATOR_LAST_ACTIVE";

export class SystemAdministrationError extends Error {
  constructor(readonly code: SystemAdministrationErrorCode) { super(code); }
}

export interface SystemAdministrationStore {
  overview(actorUserId: string): Promise<SystemAdministrationOverview>;
  grant(actorUserId: string, targetUserId: string, requestId: string): Promise<SystemAdministrator>;
  revoke(actorUserId: string, targetUserId: string, requestId: string): Promise<SystemAdministrator>;
}

type SystemAdminTransaction = <T>(actorUserId: string,
  work: (client: PoolClient) => Promise<T>) => Promise<T | null>;

type AdministratorRow = {
  user_id: string;
  status: "ACTIVE" | "REVOKED";
  granted_by_user_id: string | null;
  granted_at: Date;
  revoked_by_user_id: string | null;
  revoked_at: Date | null;
};

function mapAdministrator(row: AdministratorRow): SystemAdministrator {
  return { userId: row.user_id, status: row.status, grantedByUserId: row.granted_by_user_id,
    grantedAt: row.granted_at, revokedByUserId: row.revoked_by_user_id, revokedAt: row.revoked_at };
}

export class PgSystemAdministrationStore implements SystemAdministrationStore {
  constructor(private readonly withSystemAdmin: SystemAdminTransaction) {}

  private async transaction<T>(actorUserId: string, work: (client: PoolClient) => Promise<T>) {
    const result = await this.withSystemAdmin(actorUserId, work);
    if (result === null) throw new SystemAdministrationError("SYSTEM_ADMINISTRATION_UNAVAILABLE");
    return result;
  }

  private async read(client: PoolClient, userId: string) {
    const result = await client.query<AdministratorRow>(`SELECT user_id, status, granted_by_user_id,
      granted_at, revoked_by_user_id, revoked_at FROM system_administrator WHERE user_id = $1`, [userId]);
    const row = result.rows[0];
    if (!row) throw new SystemAdministrationError("SYSTEM_ADMINISTRATOR_CONFLICT");
    return mapAdministrator(row);
  }

  private async audit(client: PoolClient, actorUserId: string, eventType: string,
    targetUserId: string, requestId: string) {
    await client.query(`INSERT INTO system_administration_event(
      actor_user_id, event_type, target_user_id, request_id)
      VALUES ($1, $2, $3, $4)`, [actorUserId, eventType, targetUserId, requestId]);
  }

  async overview(actorUserId: string) {
    return this.transaction(actorUserId, async client => {
      const administrators = await client.query<AdministratorRow>(`SELECT user_id, status,
        granted_by_user_id, granted_at, revoked_by_user_id, revoked_at
        FROM system_administrator ORDER BY status, granted_at, user_id`);
      const recentEvents = await client.query<{ id: string; actor_user_id: string; event_type: string;
        target_user_id: string | null; request_id: string; occurred_at: Date }>(`SELECT
        system_administration_event_id AS id, actor_user_id, event_type, target_user_id,
        request_id, occurred_at FROM system_administration_event
        ORDER BY occurred_at DESC, system_administration_event_id DESC LIMIT 100`);
      return { administrators: administrators.rows.map(mapAdministrator), recentEvents: recentEvents.rows.map(row => ({
        id: row.id, actorUserId: row.actor_user_id, eventType: row.event_type,
        targetUserId: row.target_user_id, requestId: row.request_id, occurredAt: row.occurred_at,
      })) };
    });
  }

  async grant(actorUserId: string, targetUserId: string, requestId: string) {
    return this.transaction(actorUserId, async client => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('arden:system-administrator-lifecycle', 0))");
      const target = await client.query("SELECT 1 FROM user_account WHERE user_id = $1 AND status = 'ACTIVE'", [targetUserId]);
      if (!target.rowCount) throw new SystemAdministrationError("SYSTEM_ADMINISTRATOR_CONFLICT");
      const changed = await client.query(`INSERT INTO system_administrator(
          user_id, status, granted_by_user_id, granted_at)
        VALUES ($1, 'ACTIVE', $2, now())
        ON CONFLICT (user_id) DO UPDATE SET status = 'ACTIVE', granted_by_user_id = EXCLUDED.granted_by_user_id,
          granted_at = now(), revoked_by_user_id = NULL, revoked_at = NULL, updated_at = now()
        WHERE system_administrator.status = 'REVOKED'`, [targetUserId, actorUserId]);
      if (!changed.rowCount) throw new SystemAdministrationError("SYSTEM_ADMINISTRATOR_CONFLICT");
      await this.audit(client, actorUserId, "SYSTEM_ADMINISTRATOR_GRANTED", targetUserId, requestId);
      return this.read(client, targetUserId);
    });
  }

  async revoke(actorUserId: string, targetUserId: string, requestId: string) {
    return this.transaction(actorUserId, async client => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('arden:system-administrator-lifecycle', 0))");
      try {
        const changed = await client.query(`UPDATE system_administrator
          SET status = 'REVOKED', revoked_by_user_id = $2, revoked_at = now(), updated_at = now()
          WHERE user_id = $1 AND status = 'ACTIVE'`, [targetUserId, actorUserId]);
        if (!changed.rowCount) throw new SystemAdministrationError("SYSTEM_ADMINISTRATOR_CONFLICT");
      } catch (error) {
        if ((error as { code?: string }).code === "23514") {
          throw new SystemAdministrationError("SYSTEM_ADMINISTRATOR_LAST_ACTIVE");
        }
        throw error;
      }
      await this.audit(client, actorUserId, "SYSTEM_ADMINISTRATOR_REVOKED", targetUserId, requestId);
      return this.read(client, targetUserId);
    });
  }
}
