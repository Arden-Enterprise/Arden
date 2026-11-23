import type { PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";
import { PgNotificationStore } from "./store.js";

const userId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const organizationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const notificationId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const publicationId = "abababab-abab-4aba-8aba-abababababab";

describe("PostgreSQL notification store", () => {
  it("maps share name and title for Core to authorize before presenting", async () => {
    const client = { query: vi.fn(async (query: string) => {
      if (query.includes("SELECT 1")) return { rows: [{}], rowCount: 1 };
      if (query.includes("unread_count")) return { rows: [{ unread_count: "1" }], rowCount: 1 };
      return { rows: ["DOCUMENT_SHARED_PERSONAL", "DOCUMENT_SHARED_GROUP"].map((event_type, index) => ({
        notification_id: index === 0 ? notificationId : "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        event_type, resource_type: "PUBLICATION", resource_id: publicationId,
        publication_title: "Contract review procedure", shared_by_name: "Ava Patel",
        created_at: new Date("2026-11-22T08:00:00.000Z"), read_at: null,
      })), rowCount: 2 };
    }) };
    const store = new PgNotificationStore(async (_user, _organization, work) => work(client as unknown as PoolClient));

    const page = await store.list(userId, organizationId,
      { cursor: null, unreadOnly: false, limit: 10, visibleReviewIds: [] });

    expect(page?.items).toEqual([
      expect.objectContaining({ id: notificationId, type: "DOCUMENT_SHARED_PERSONAL",
        resourceId: publicationId, publicationTitle: "Contract review procedure", sharedByName: "Ava Patel" }),
      expect.objectContaining({ type: "DOCUMENT_SHARED_GROUP", resourceId: publicationId,
        publicationTitle: "Contract review procedure", sharedByName: "Ava Patel" }),
    ]);
    expect(JSON.stringify(client.query.mock.calls.at(-1)?.[0])).toContain("n.publication_title, n.shared_by_name");
  });
});
