import type { PoolClient } from "pg";

/**
 * Decision 0034 (spec F03-SHR): unreviewed, view-only sharing of one private note or PDF item with named
 * members of the same organization. Database RLS (migration 0070) decides who may read; this store adds the
 * owner's limits, audit and the shapes the routes return.
 */
export type DirectShareSettings = { enabled: boolean; recipientLimit: number };
export type DirectShareRecipient = { shareId: string; membershipId: string; name: string; email: string | null;
  /** False when the recipient is no longer an active member; the share then gives no access. */
  active: boolean; sharedAt: Date };
export type OwnerShares = { settings: DirectShareSettings; recipients: DirectShareRecipient[] };
export type SharedItemSummary = { id: string; title: string; kind: "note" | "pdf"; ownerName: string; sharedAt: Date; updatedAt: Date };
export type SharedItem = SharedItemSummary & { version: number; sourceUri: string; mimeType: string; contentHash: string };
export type ShareResult = { kind: "not-found" } | { kind: "disabled" } | { kind: "invalid-recipients" }
  | { kind: "limit"; limit: number } | { kind: "shared"; shares: OwnerShares; added: number };

export interface DirectShareStore {
  settings(userId: string, organizationId: string): Promise<DirectShareSettings | null>;
  /** Organization Admin only; null when the actor is not one. */
  updateSettings(userId: string, organizationId: string, input: DirectShareSettings, requestId: string): Promise<DirectShareSettings | null>;
  /** The owner's view of one item's shares; null when the actor does not own an active item with this id. */
  listShares(userId: string, organizationId: string, draftId: string): Promise<OwnerShares | null>;
  share(userId: string, organizationId: string, draftId: string, recipientMembershipIds: string[], requestId: string): Promise<ShareResult>;
  /** Revokes one share, or every share of the item when `shareId` is null. */
  revoke(userId: string, organizationId: string, draftId: string, shareId: string | null, requestId: string): Promise<OwnerShares | null>;
  listSharedWithMe(userId: string, organizationId: string): Promise<SharedItemSummary[] | null>;
  getSharedItem(userId: string, organizationId: string, draftId: string): Promise<SharedItem | null>;
}

type Transaction = <T>(userId: string, organizationId: string, work: (client: PoolClient) => Promise<T>) => Promise<T>;
type AdminTransaction = <T>(userId: string, organizationId: string, work: (client: PoolClient, membershipId: string) => Promise<T>) => Promise<T | null>;

export const defaultDirectShareSettings: DirectShareSettings = { enabled: true, recipientLimit: 10 };
/** Shared-with-me lists show at most this many items, newest share first. */
export const maxListedSharedItems = 200;

export class PgDirectShareStore implements DirectShareStore {
  constructor(private readonly withActor: Transaction, private readonly withAdmin: AdminTransaction) {}

  async settings(userId: string, organizationId: string): Promise<DirectShareSettings | null> {
    return this.withActor(userId, organizationId, async (client) =>
      await activeMembership(client, userId, organizationId) ? readSettings(client, organizationId) : null);
  }

  async updateSettings(userId: string, organizationId: string, input: DirectShareSettings, requestId: string): Promise<DirectShareSettings | null> {
    return this.withAdmin(userId, organizationId, async (client, membershipId) => {
      await client.query(`INSERT INTO organization_direct_share_setting
          (organization_id, enabled, recipient_limit, updated_by_membership_id)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (organization_id) DO UPDATE SET enabled = EXCLUDED.enabled, recipient_limit = EXCLUDED.recipient_limit,
          updated_by_membership_id = EXCLUDED.updated_by_membership_id, updated_at = now()`,
      [organizationId, input.enabled, input.recipientLimit, membershipId]);
      await audit(client, organizationId, membershipId, "DIRECT_SHARE_SETTINGS_UPDATED",
        { enabled: input.enabled, recipientLimit: input.recipientLimit, requestId });
      return readSettings(client, organizationId);
    });
  }

  async listShares(userId: string, organizationId: string, draftId: string): Promise<OwnerShares | null> {
    return this.withActor(userId, organizationId, async (client) => {
      const owner = await ownedItem(client, userId, organizationId, draftId, false);
      return owner ? ownerShares(client, organizationId, draftId) : null;
    });
  }

  async share(userId: string, organizationId: string, draftId: string, recipientMembershipIds: string[], requestId: string): Promise<ShareResult> {
    return this.withActor(userId, organizationId, async (client) => {
      // Locking the item serializes concurrent shares of it, so the limit holds.
      const owner = await ownedItem(client, userId, organizationId, draftId, true);
      if (!owner) return { kind: "not-found" };
      const settings = await readSettings(client, organizationId);
      if (!settings.enabled) return { kind: "disabled" };
      const requested = [...new Set(recipientMembershipIds)];
      if (requested.length === 0 || requested.includes(owner.membershipId)) return { kind: "invalid-recipients" };
      // The reviewed reader directory lists only active members of this organization.
      const known = await client.query<{ membership_id: string }>(
        "SELECT membership_id FROM knowledge_reader_directory('', $1::uuid[])", [requested]);
      if (known.rowCount !== requested.length) return { kind: "invalid-recipients" };
      const existing = new Set((await client.query<{ recipient_membership_id: string }>(`SELECT recipient_membership_id
        FROM private_item_share WHERE draft_id = $1 AND revoked_at IS NULL`, [draftId])).rows.map((row) => row.recipient_membership_id));
      const added = requested.filter((id) => !existing.has(id));
      if (existing.size + added.length > settings.recipientLimit) return { kind: "limit", limit: settings.recipientLimit };
      for (const recipient of added) {
        const inserted = await client.query<{ share_id: string }>(`INSERT INTO private_item_share
            (organization_id, draft_id, owner_membership_id, recipient_membership_id)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (draft_id, recipient_membership_id) WHERE revoked_at IS NULL DO NOTHING
          RETURNING share_id`, [organizationId, draftId, owner.membershipId, recipient]);
        const shareId = inserted.rows[0]?.share_id;
        if (shareId) {
          await audit(client, organizationId, owner.membershipId, "PRIVATE_ITEM_SHARED",
            { draftId, shareId, recipientMembershipId: recipient, requestId });
        }
      }
      return { kind: "shared", shares: await ownerShares(client, organizationId, draftId), added: added.length };
    });
  }

  async revoke(userId: string, organizationId: string, draftId: string, shareId: string | null, requestId: string): Promise<OwnerShares | null> {
    return this.withActor(userId, organizationId, async (client) => {
      const owner = await ownedItem(client, userId, organizationId, draftId, true);
      if (!owner) return null;
      const revoked = await client.query<{ share_id: string }>(`UPDATE private_item_share
          SET revoked_at = now(), revoked_by_membership_id = $2
        WHERE draft_id = $1 AND owner_membership_id = $2 AND revoked_at IS NULL AND ($3::uuid IS NULL OR share_id = $3)
        RETURNING share_id`, [draftId, owner.membershipId, shareId]);
      if (shareId && !revoked.rowCount) return null;
      if (revoked.rowCount) {
        await audit(client, organizationId, owner.membershipId, "PRIVATE_ITEM_SHARE_REVOKED",
          { draftId, revokedCount: revoked.rowCount, ...(shareId ? { shareId } : {}), requestId });
      }
      return ownerShares(client, organizationId, draftId);
    });
  }

  async listSharedWithMe(userId: string, organizationId: string): Promise<SharedItemSummary[] | null> {
    return this.withActor(userId, organizationId, async (client) => {
      if (!await activeMembership(client, userId, organizationId)) return null;
      return sharedItems(client, null);
    });
  }

  async getSharedItem(userId: string, organizationId: string, draftId: string): Promise<SharedItem | null> {
    return this.withActor(userId, organizationId, async (client) => {
      if (!await activeMembership(client, userId, organizationId)) return null;
      return (await sharedItems(client, draftId))[0] ?? null;
    });
  }
}

type SharedRow = { draft_id: string; title: string; mime_type: string; source_uri: string; content_hash: string;
  current_version_no: number; owner_membership_id: string; shared_at: Date; updated_at: Date };

/** Items shared with the actor, as RLS lets the recipient read them; titles and owners only, never other items. */
async function sharedItems(client: PoolClient, draftId: string | null): Promise<SharedItem[]> {
  const rows = (await client.query<SharedRow>(`
    SELECT DISTINCT ON (d.draft_id) d.draft_id, d.title, v.mime_type, v.source_uri, v.content_hash, d.current_version_no,
           s.owner_membership_id, s.created_at AS shared_at, d.updated_at
      FROM private_item_share s
      JOIN draft_document d ON d.draft_id = s.draft_id AND d.status = 'ACTIVE' AND d.trashed_at IS NULL
      JOIN draft_version v ON v.draft_id = d.draft_id AND v.version_no = d.current_version_no
     WHERE s.revoked_at IS NULL AND actor_owns_private_membership(s.recipient_membership_id)
       AND actor_can_read_direct_share(d.draft_id)
       AND ($1::uuid IS NULL OR d.draft_id = $1)
     ORDER BY d.draft_id, s.created_at DESC`, [draftId])).rows
    .sort((left, right) => right.shared_at.getTime() - left.shared_at.getTime()).slice(0, maxListedSharedItems);
  const owners = await directory(client, [...new Set(rows.map((row) => row.owner_membership_id))]);
  return rows.flatMap((row) => {
    const owner = owners.get(row.owner_membership_id);
    // An owner who left is not listed by the directory; RLS has already hidden their items.
    return owner ? [{
      id: row.draft_id, title: row.title, kind: row.mime_type === "application/pdf" ? "pdf" as const : "note" as const,
      ownerName: owner.name, sharedAt: row.shared_at, updatedAt: row.updated_at,
      version: row.current_version_no, sourceUri: row.source_uri, mimeType: row.mime_type, contentHash: row.content_hash,
    }] : [];
  });
}

async function ownerShares(client: PoolClient, organizationId: string, draftId: string): Promise<OwnerShares> {
  const rows = (await client.query<{ share_id: string; recipient_membership_id: string; created_at: Date }>(`
    SELECT share_id, recipient_membership_id, created_at FROM private_item_share
     WHERE draft_id = $1 AND revoked_at IS NULL ORDER BY created_at, share_id`, [draftId])).rows;
  const people = await directory(client, rows.map((row) => row.recipient_membership_id));
  return {
    settings: await readSettings(client, organizationId),
    recipients: rows.map((row) => {
      const person = people.get(row.recipient_membership_id);
      return { shareId: row.share_id, membershipId: row.recipient_membership_id, name: person?.name ?? "Former member",
        email: person?.email ?? null, active: Boolean(person), sharedAt: row.created_at };
    }),
  };
}

async function directory(client: PoolClient, ids: string[]): Promise<Map<string, { name: string; email: string | null }>> {
  if (ids.length === 0) return new Map();
  const rows = (await client.query<{ membership_id: string; display_name: string; email: string | null }>(
    "SELECT membership_id, display_name, email FROM knowledge_reader_directory('', $1::uuid[])", [ids])).rows;
  return new Map(rows.map((row) => [row.membership_id, { name: row.display_name, email: row.email }]));
}

async function readSettings(client: PoolClient, organizationId: string): Promise<DirectShareSettings> {
  const row = (await client.query<{ enabled: boolean; recipient_limit: number }>(`SELECT enabled, recipient_limit
    FROM organization_direct_share_setting WHERE organization_id = $1`, [organizationId])).rows[0];
  return row ? { enabled: row.enabled, recipientLimit: row.recipient_limit } : { ...defaultDirectShareSettings };
}

async function activeMembership(client: PoolClient, userId: string, organizationId: string): Promise<string | null> {
  const row = (await client.query<{ membership_id: string }>(`SELECT om.membership_id FROM organization_membership om
    JOIN user_account ua ON ua.user_id = om.user_id AND ua.status = 'ACTIVE'
    JOIN organization o ON o.organization_id = om.organization_id AND o.status = 'ACTIVE'
    WHERE om.user_id = $1 AND om.organization_id = $2 AND om.status = 'ACTIVE'`, [userId, organizationId])).rows[0];
  return row?.membership_id ?? null;
}

/** The actor's own active, untrashed item; optionally locked against concurrent shares and saves. */
async function ownedItem(client: PoolClient, userId: string, organizationId: string, draftId: string,
  lock: boolean): Promise<{ membershipId: string } | null> {
  const membershipId = await activeMembership(client, userId, organizationId);
  if (!membershipId) return null;
  const row = await client.query(`SELECT d.draft_id FROM draft_document d
    JOIN private_workspace w ON w.workspace_id = d.workspace_id
    WHERE d.draft_id = $1 AND w.membership_id = $2 AND w.status = 'ACTIVE' AND d.status = 'ACTIVE' AND d.trashed_at IS NULL
    ${lock ? "FOR UPDATE OF d" : ""}`, [draftId, membershipId]);
  return row.rowCount ? { membershipId } : null;
}

/** Audit details carry identifiers and counts only, never titles or content. */
async function audit(client: PoolClient, organizationId: string, membershipId: string, eventType: string,
  details: Record<string, string | number | boolean>): Promise<void> {
  await client.query(`INSERT INTO audit_event (organization_id, actor_membership_id, event_type, outcome, details_json)
    VALUES ($1, $2, $3, 'SUCCESS', $4::jsonb)`, [organizationId, membershipId, eventType, JSON.stringify(details)]);
}
