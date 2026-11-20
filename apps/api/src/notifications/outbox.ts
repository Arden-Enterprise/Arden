import type { Pool } from "pg";
import { broadcastNotification, type NotificationRealtimeConfiguration } from "./realtime.js";

type LeasedNotification = { outbox_id: string; notification_id: string; organization_id: string;
  recipient_membership_id: string; attempt_count: number };

export type NotificationWorkerLogger = {
  info(fields: Record<string, unknown>, message: string): void;
  warn(fields: Record<string, unknown>, message: string): void;
  error(fields: Record<string, unknown>, message: string): void;
};

export class NotificationOutboxWorker {
  constructor(private readonly workerId: string, private readonly pool: Pool,
    private readonly configuration: NotificationRealtimeConfiguration,
    private readonly logger: NotificationWorkerLogger,
    private readonly send: typeof broadcastNotification = broadcastNotification) {}

  async runOnce(): Promise<boolean> {
    const lease = await this.withWorkerRole(async client => {
      await client.query(`UPDATE arden_notification_outbox
        SET status = 'FAILED', lease_owner = NULL, lease_expires_at = NULL,
            last_error_code = 'LEASE_EXHAUSTED'
        WHERE status = 'LEASED' AND lease_expires_at <= now() AND attempt_count >= 8`);
      const result = await client.query<LeasedNotification>(`WITH candidates AS (
          SELECT o.outbox_id, o.notification_id
          FROM arden_notification_outbox o
          WHERE ((o.status = 'PENDING' AND o.available_at <= now())
              OR (o.status = 'LEASED' AND o.lease_expires_at <= now()))
            AND o.attempt_count < 8
          ORDER BY o.available_at, o.created_at, o.outbox_id
          LIMIT 25 FOR UPDATE OF o SKIP LOCKED
        )
        UPDATE arden_notification_outbox o
        SET status = 'LEASED', lease_owner = $1,
            lease_expires_at = now() + make_interval(secs => $2),
            attempt_count = o.attempt_count + 1
        FROM candidates c JOIN arden_notification n ON n.notification_id = c.notification_id
        WHERE o.outbox_id = c.outbox_id
        RETURNING o.outbox_id, n.notification_id, n.organization_id,
          n.recipient_membership_id, o.attempt_count`, [this.workerId, 180]);
      return result.rows;
    });
    if (!lease.length) return false;
    for (const item of lease) {
      try {
        await this.send(this.configuration, { organizationId: item.organization_id,
          membershipId: item.recipient_membership_id, notificationId: item.notification_id });
        const completed = await this.withWorkerRole(async client => client.query(`UPDATE arden_notification_outbox
          SET status = 'SENT', delivered_at = now(), lease_owner = NULL,
              lease_expires_at = NULL, last_error_code = NULL
          WHERE outbox_id = $1 AND status = 'LEASED' AND lease_owner = $2
            AND lease_expires_at > now()`, [item.outbox_id, this.workerId]));
        if (completed.rowCount) this.logger.info({ notificationId: item.notification_id }, "Notification broadcast delivered");
      } catch (error) {
        const errorCode = safeNotificationErrorCode(error);
        await this.withWorkerRole(client => client.query(
          `UPDATE arden_notification_outbox SET
              status = CASE WHEN attempt_count >= 8 THEN 'FAILED' ELSE 'PENDING' END,
              available_at = now() + ($4::double precision * interval '1 second'),
              lease_owner = NULL, lease_expires_at = NULL, last_error_code = $3
            WHERE outbox_id = $1 AND status = 'LEASED' AND lease_owner = $2`,
          [item.outbox_id, this.workerId, errorCode, Math.min(300, 5 * 2 ** Math.min(item.attempt_count, 6))]));
        this.logger.warn({ notificationId: item.notification_id, attempt: item.attempt_count, errorCode },
          "Notification broadcast will retry");
      }
    }
    return true;
  }

  private async withWorkerRole<T>(work: (client: import("pg").PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE arden_notification_worker");
      await client.query("SET LOCAL search_path TO arden, public");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }
}

function safeNotificationErrorCode(error: unknown): string {
  if (error instanceof Error && /^REALTIME_HTTP_[0-9]{3}$/.test(error.message)) return error.message;
  if (error instanceof Error && error.name === "TimeoutError") return "REALTIME_TIMEOUT";
  return "REALTIME_DELIVERY_FAILED";
}

export function notificationWorkerPollMilliseconds(worked: boolean): number {
  return worked ? 25 : 2_000;
}
