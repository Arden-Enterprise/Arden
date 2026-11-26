import type { PoolClient } from "pg";
import { encodeNotificationCursor, type NotificationCursor,
  type NotificationPage, type NotificationRecord } from "./contracts.js";

type ActorTransaction = <T>(userId: string, organizationId: string,
  work: (client: PoolClient) => Promise<T>) => Promise<T>;

type NotificationRow = {
  notification_id: string;
  event_type: NotificationRecord["type"];
  resource_type: NotificationRecord["resourceType"];
  resource_id: string;
  publication_title: string | null;
  shared_by_name: string | null;
  expires_on: string | null;
  request_reason: string | null;
  created_at: Date;
  read_at: Date | null;
};

export interface NotificationStore {
  /** Resource candidates from this member's inbox; authorization is checked by Core for these IDs. */
  listReviewRequestResourceIds(userId: string, organizationId: string, unreadOnly: boolean): Promise<string[] | null>;
  list(userId: string, organizationId: string, input: {
    cursor: NotificationCursor | null; unreadOnly: boolean; limit: number; visibleReviewIds: string[];
  }): Promise<NotificationPage | null>;
  markRead(userId: string, organizationId: string, notificationId: string): Promise<boolean | null>;
  markAllRead(userId: string, organizationId: string): Promise<number | null>;
}

export class PgNotificationStore implements NotificationStore {
  constructor(private readonly withActor: ActorTransaction) {}

  async listReviewRequestResourceIds(userId: string, organizationId: string, unreadOnly: boolean): Promise<string[] | null> {
    return this.withActor(userId, organizationId, async (client) => {
      if (!await this.hasActiveMembership(client, userId, organizationId)) return null;
      const result = await client.query<{ resource_id: string }>(`SELECT DISTINCT n.resource_id
        FROM arden_notification n
        WHERE n.organization_id = $1 AND n.event_type = 'REVIEW_REQUESTED'
          AND ($2::boolean = false OR n.read_at IS NULL)`, [organizationId, unreadOnly]);
      return result.rows.map(row => row.resource_id);
    });
  }

  async list(userId: string, organizationId: string, input: {
    cursor: NotificationCursor | null; unreadOnly: boolean; limit: number; visibleReviewIds: string[];
  }): Promise<NotificationPage | null> {
    return this.withActor(userId, organizationId, async (client) => {
      if (!await this.hasActiveMembership(client, userId, organizationId)) return null;
      const visibleReviewIds = input.visibleReviewIds;
      const count = await client.query<{ unread_count: string }>(`SELECT count(*)::text AS unread_count
        FROM arden_notification n
        WHERE n.organization_id = $1 AND n.read_at IS NULL
          AND (n.event_type <> 'REVIEW_REQUESTED' OR n.resource_id = ANY($2::uuid[]))`,
      [organizationId, visibleReviewIds]);
      const rows = await client.query<NotificationRow>(`SELECT n.notification_id, n.event_type,
          n.resource_type, n.resource_id, n.publication_title, n.shared_by_name,
          to_char(n.expires_on, 'YYYY-MM-DD') AS expires_on, n.request_reason, n.created_at, n.read_at
        FROM arden_notification n
        WHERE n.organization_id = $1
          AND ($2::boolean = false OR n.read_at IS NULL)
          AND (n.event_type <> 'REVIEW_REQUESTED' OR n.resource_id = ANY($3::uuid[]))
          AND ($4::timestamptz IS NULL OR (n.created_at, n.notification_id) < ($4::timestamptz, $5::uuid))
        ORDER BY n.created_at DESC, n.notification_id DESC LIMIT $6`,
      [organizationId, input.unreadOnly, visibleReviewIds, input.cursor?.createdAt ?? null,
        input.cursor?.id ?? null, input.limit + 1]);
      const hasMore = rows.rows.length > input.limit;
      const pageRows = rows.rows.slice(0, input.limit);
      const last = pageRows.at(-1);
      const items: NotificationRecord[] = pageRows.map(row => ({
        id: row.notification_id, type: row.event_type, resourceType: row.resource_type,
        resourceId: row.resource_id, createdAt: row.created_at.toISOString(), readAt: row.read_at?.toISOString() ?? null,
        ...(row.event_type === "DOCUMENT_SHARED_PERSONAL" || row.event_type === "DOCUMENT_SHARED_GROUP"
          || row.event_type === "DOCUMENT_SHARED_DIRECT" ? {
          publicationTitle: row.publication_title ?? undefined, sharedByName: row.shared_by_name ?? undefined,
        } : {}),
        ...(row.event_type === "PUBLICATION_EXPIRING" ? {
          publicationTitle: row.publication_title ?? undefined, expiresOn: row.expires_on ?? undefined,
        } : {}),
        ...(row.event_type === "PUBLICATION_RENEWAL_ON_BEHALF" ? {
          publicationTitle: row.publication_title ?? undefined, sharedByName: row.shared_by_name ?? undefined,
          requestReason: row.request_reason ?? undefined,
        } : {}),
      }));
      return { items, unreadCount: Number(count.rows[0]?.unread_count ?? 0),
        nextCursor: hasMore && last ? encodeNotificationCursor({ createdAt: last.created_at, id: last.notification_id }) : null };
    });
  }

  async markRead(userId: string, organizationId: string, notificationId: string): Promise<boolean | null> {
    return this.withActor(userId, organizationId, async client => {
      const result = await client.query(`UPDATE arden_notification SET read_at = COALESCE(read_at, now())
        WHERE notification_id = $1 AND organization_id = $2`, [notificationId, organizationId]);
      if (result.rowCount) return true;
      const membership = await client.query(`SELECT 1 FROM organization_membership
        WHERE user_id = $1 AND organization_id = $2 AND status = 'ACTIVE'`, [userId, organizationId]);
      return membership.rowCount ? false : null;
    });
  }

  async markAllRead(userId: string, organizationId: string): Promise<number | null> {
    return this.withActor(userId, organizationId, async client => {
      const membership = await client.query(`SELECT 1 FROM organization_membership
        WHERE user_id = $1 AND organization_id = $2 AND status = 'ACTIVE'`, [userId, organizationId]);
      if (!membership.rowCount) return null;
      const result = await client.query(`UPDATE arden_notification SET read_at = now()
        WHERE organization_id = $1 AND read_at IS NULL`, [organizationId]);
      return result.rowCount ?? 0;
    });
  }

  private async hasActiveMembership(client: PoolClient, userId: string, organizationId: string): Promise<boolean> {
    const result = await client.query(`SELECT 1 FROM organization_membership om
      JOIN user_account ua ON ua.user_id = om.user_id AND ua.status = 'ACTIVE'
      JOIN organization o ON o.organization_id = om.organization_id AND o.status = 'ACTIVE'
      WHERE om.user_id = $1 AND om.organization_id = $2 AND om.status = 'ACTIVE'`, [userId, organizationId]);
    return Boolean(result.rowCount);
  }
}
