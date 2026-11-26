export const notificationTypes = [
  "REVIEW_REQUESTED", "REVIEW_APPROVED", "REVIEW_REJECTED", "PUBLICATION_ACTIVE",
  "PUBLICATION_FAILED", "DOCUMENT_SHARED_PERSONAL", "DOCUMENT_SHARED_GROUP",
  "PRIMARY_DEPARTMENT_CHANGED", "REVIEWER_GRANT_CREATED", "REVIEWER_GRANT_REVOKED",
  "PUBLICATION_EXPIRING", "PUBLICATION_RENEWAL_ON_BEHALF", "DOCUMENT_SHARED_DIRECT",
] as const;

export type NotificationType = typeof notificationTypes[number];
export type NotificationResourceType = "SUBMISSION" | "PUBLICATION" | "DOCUMENT" | "DEPARTMENT" | "REVIEWER_GRANT" | "PRIVATE_ITEM";
export type NotificationRecord = {
  id: string;
  type: NotificationType;
  resourceType: NotificationResourceType;
  resourceId: string;
  /** Present only for personal/group share records. */
  publicationTitle?: string;
  /** Present only for personal/group share records. */
  sharedByName?: string;
  /** PUBLICATION_EXPIRING only (decision 0032): the Valid until the reminder is about. */
  expiresOn?: string;
  /** PUBLICATION_RENEWAL_ON_BEHALF only: why the renewal was requested. */
  requestReason?: string;
  createdAt: string;
  readAt: string | null;
};
export type NotificationPage = {
  items: NotificationRecord[];
  unreadCount: number;
  nextCursor: string | null;
};
export type NotificationCursor = { createdAt: Date; id: string };

export function encodeNotificationCursor(cursor: NotificationCursor): string {
  return Buffer.from(`${cursor.createdAt.toISOString()}\n${cursor.id}`, "utf8").toString("base64url");
}

export function decodeNotificationCursor(value: string | undefined): NotificationCursor | null {
  if (!value) return null;
  if (value.length > 180 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("INVALID_CURSOR");
  let decoded: string;
  try { decoded = Buffer.from(value, "base64url").toString("utf8"); }
  catch { throw new Error("INVALID_CURSOR"); }
  const [createdAtText, id, extra] = decoded.split("\n");
  const createdAt = new Date(createdAtText ?? "");
  if (extra !== undefined || !Number.isFinite(createdAt.getTime())
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id ?? "")) {
    throw new Error("INVALID_CURSOR");
  }
  return { createdAt, id: id! };
}
