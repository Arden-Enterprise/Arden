import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { DraftListItem, PrivateDraft, StoredContentFields } from "../db/repository.js";

/** Decision 0029: owner-private collections, favorites and trash for private notes. */
export type PrivateCollection = {
  id: string;
  title: string;
  parentId: string | null;
  favoritedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type PrivateTrashEntry = {
  batchId: string;
  kind: "note" | "collection";
  id: string;
  title: string;
  fromCollectionTitle: string | null;
  itemCount: number;
  trashedAt: Date;
};

/** An archived note as the Archived view lists it (spec F03-ARR). */
export type PrivateArchivedNote = {
  id: string;
  title: string;
  /** The collection it returns to; null when it was at the root or that collection is gone. */
  collectionId: string | null;
  collectionTitle: string | null;
  archivedAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

/** The current content reference of an active, untrashed, unarchived note. */
export type PrivateNoteSource = {
  id: string;
  title: string;
  collectionId: string | null;
  versionId: string;
  sourceUri: string;
  mimeType: string;
  contentHash: string;
};

export type PrivateCollectionSubtree = {
  root: PrivateCollection;
  /** Root first, then descendants in parent-before-child order. */
  collections: PrivateCollection[];
  notes: PrivateNoteSource[];
};

export type PrivateDuplicatedCollection = {
  collection: PrivateCollection;
  collections: PrivateCollection[];
  notes: DraftListItem[];
};

/** Private content objects a purge made unreachable, grouped by tombstoned note. */
export type PurgedPrivateContent = { draftId: string; sourceUris: string[] }[];

export type UpdateCollectionResult =
  | { kind: "updated"; collection: PrivateCollection }
  | { kind: "not-found" }
  | { kind: "cycle" };

export interface PrivateOrganizationStore {
  listCollections(userId: string, organizationId: string): Promise<PrivateCollection[] | null>;
  createCollection(userId: string, organizationId: string, input: { title: string; parentId: string | null }, requestId: string): Promise<PrivateCollection | null>;
  updateCollection(userId: string, organizationId: string, collectionId: string,
    input: { title?: string; parentId?: string | null }, requestId: string): Promise<UpdateCollectionResult>;
  setCollectionFavorite(userId: string, organizationId: string, collectionId: string, favorite: boolean): Promise<PrivateCollection | null>;
  /** Places the note at `index` (0-based) in the destination's order; null appends it at the end. */
  moveNote(userId: string, organizationId: string, draftId: string, collectionId: string | null, index: number | null): Promise<DraftListItem | null>;
  setNoteFavorite(userId: string, organizationId: string, draftId: string, favorite: boolean): Promise<DraftListItem | null>;
  /** Archive or unarchive; unarchive returns the note to its collection, or the root when that collection is gone. */
  setNoteArchived(userId: string, organizationId: string, draftId: string, archived: boolean, requestId: string): Promise<DraftListItem | null>;
  listArchived(userId: string, organizationId: string): Promise<{ items: PrivateArchivedNote[]; hasMore: boolean } | null>;
  getNoteSource(userId: string, organizationId: string, draftId: string): Promise<PrivateNoteSource | null>;
  /** Null when the source note is no longer active at the same version. */
  duplicateNote(userId: string, organizationId: string, source: PrivateNoteSource, title: string,
    copy: StoredContentFields, requestId: string): Promise<PrivateDraft | null>;
  getCollectionSubtree(userId: string, organizationId: string, collectionId: string): Promise<PrivateCollectionSubtree | null>;
  /** "changed" when the subtree no longer matches the snapshot whose content was copied. */
  duplicateCollection(userId: string, organizationId: string, snapshot: PrivateCollectionSubtree, rootTitle: string,
    copies: ReadonlyMap<string, StoredContentFields>, requestId: string): Promise<PrivateDuplicatedCollection | "changed" | null>;
  trashNote(userId: string, organizationId: string, draftId: string, requestId: string): Promise<PrivateTrashEntry | null>;
  trashCollection(userId: string, organizationId: string, collectionId: string, requestId: string): Promise<PrivateTrashEntry | null>;
  listTrash(userId: string, organizationId: string): Promise<PrivateTrashEntry[] | null>;
  restoreTrash(userId: string, organizationId: string, batchId: string, requestId: string): Promise<{ collections: PrivateCollection[]; notes: DraftListItem[] } | null>;
  /** Tombstones the batch in one transaction and returns the content objects to erase after commit. */
  purgeTrash(userId: string, organizationId: string, batchId: string, requestId: string): Promise<PurgedPrivateContent | null>;
  markContentPurged(userId: string, organizationId: string, draftIds: string[]): Promise<void>;
}

/** System retention capability; it never sees active items. */
export interface PrivateTrashRetentionStore {
  purgeExpired(cutoff: Date, batchLimit: number): Promise<{ purgedBatches: number; content: PurgedPrivateContent }>;
  markContentErased(draftIds: string[]): Promise<void>;
}

type ActorTransaction = <T>(userId: string, organizationId: string, work: (client: PoolClient) => Promise<T>) => Promise<T>;
type RetentionTransaction = <T>(work: (client: PoolClient) => Promise<T>) => Promise<T>;
type Owner = { membershipId: string; workspaceId: string | null };

type CollectionRow = {
  collection_id: string; title: string; parent_collection_id: string | null;
  favorited_at: Date | null; created_at: Date; updated_at: Date;
};
type NoteSummaryRow = {
  draft_id: string; title: string; current_version_no: number; draft_version_id: string;
  mime_type: string; content_hash: string; created_at: Date; updated_at: Date;
  collection_id: string | null; favorited_at: Date | null; sort_position: number | null; archived_at: Date | null;
};
type NoteSourceRow = {
  draft_id: string; title: string; collection_id: string | null; draft_version_id: string;
  source_uri: string; mime_type: string; content_hash: string;
};
type BatchItemRow = {
  kind: "note" | "collection"; id: string; parent_id: string | null; trashed_at: Date;
};

/** Upper bound of active collections per workspace; the list route returns them all, so inserts must not exceed it. */
export const maxListedCollections = 1_000;
/** The Archived view lists at most this many notes, newest archive first. */
export const maxListedArchivedNotes = 1_000;

/** Raised inside a tree transaction when an insert or restore would exceed {@link maxListedCollections}. */
export class PrivateCollectionLimitError extends Error {
  constructor() { super("Private collection limit reached"); this.name = "PrivateCollectionLimitError"; }
}

async function ensureCollectionCapacity(client: PoolClient, workspaceId: string, adding: number): Promise<void> {
  if (adding <= 0) return;
  const result = await client.query<{ count: string }>(`SELECT count(*)::text AS count FROM private_collection c
    WHERE c.workspace_id = $1 AND ${activeCollection}`, [workspaceId]);
  if (Number(result.rows[0]?.count ?? 0) + adding > maxListedCollections) throw new PrivateCollectionLimitError();
}
const collectionColumns = `c.collection_id, c.title, c.parent_collection_id, c.favorited_at, c.created_at, c.updated_at`;
const activeCollection = `c.status = 'ACTIVE' AND c.trashed_at IS NULL`;
/** A note shown in the private tree: live, not in trash, not archived. */
const treeNote = `d.status = 'ACTIVE' AND d.trashed_at IS NULL AND d.archived_at IS NULL`;
/** Order of notes inside one container (spec F03-ARR); the UI applies the same order. */
const noteOrder = `d.sort_position ASC NULLS FIRST, d.created_at DESC, d.draft_id DESC`;
const noteSummarySelect = `
  SELECT d.draft_id, d.title, d.current_version_no, v.draft_version_id, v.mime_type, v.content_hash,
         d.created_at, d.updated_at, d.collection_id, d.favorited_at, d.sort_position, d.archived_at
    FROM draft_document d
    JOIN draft_version v ON v.draft_id = d.draft_id AND v.version_no = d.current_version_no`;

export class PgPrivateOrganizationStore implements PrivateOrganizationStore, PrivateTrashRetentionStore {
  constructor(private readonly withActor: ActorTransaction, private readonly withRetention: RetentionTransaction) {}

  async listCollections(userId: string, organizationId: string): Promise<PrivateCollection[] | null> {
    return this.withActor(userId, organizationId, async (client) => {
      const owner = await findOwner(client, userId, organizationId);
      if (!owner) return null;
      if (!owner.workspaceId) return [];
      const result = await client.query<CollectionRow>(`SELECT ${collectionColumns} FROM private_collection c
        WHERE c.workspace_id = $1 AND ${activeCollection}
        ORDER BY c.created_at, c.collection_id LIMIT $2`, [owner.workspaceId, maxListedCollections]);
      return result.rows.map(mapCollection);
    });
  }

  async createCollection(userId: string, organizationId: string, input: { title: string; parentId: string | null }, requestId: string): Promise<PrivateCollection | null> {
    return this.withActor(userId, organizationId, async (client) => {
      const owner = await findOwner(client, userId, organizationId);
      if (!owner) return null;
      const workspaceId = owner.workspaceId ?? await ensureWorkspace(client, owner.membershipId);
      if (!workspaceId) return null;
      await lockTree(client, workspaceId);
      if (input.parentId && !await isActiveCollection(client, workspaceId, input.parentId)) return null;
      await ensureCollectionCapacity(client, workspaceId, 1);
      const inserted = await client.query<CollectionRow>(`INSERT INTO private_collection AS c (workspace_id, parent_collection_id, title)
        VALUES ($1, $2, $3) RETURNING ${collectionColumns}`, [workspaceId, input.parentId, input.title]);
      const row = inserted.rows[0];
      if (!row) throw new Error("Private collection insert returned no row");
      await appendPrivateAudit(client, organizationId, owner.membershipId, "PRIVATE_COLLECTION_CREATED",
        { collectionId: row.collection_id, requestId });
      return mapCollection(row);
    });
  }

  async updateCollection(userId: string, organizationId: string, collectionId: string,
    input: { title?: string; parentId?: string | null }, requestId: string): Promise<UpdateCollectionResult> {
    return this.withActor(userId, organizationId, async (client) => {
      const owner = await findOwner(client, userId, organizationId);
      if (!owner?.workspaceId) return { kind: "not-found" };
      const workspaceId = owner.workspaceId;
      await lockTree(client, workspaceId);
      if (!await isActiveCollection(client, workspaceId, collectionId)) return { kind: "not-found" };
      const moving = input.parentId !== undefined;
      if (moving && input.parentId !== null) {
        const parentId = input.parentId as string;
        if (!await isActiveCollection(client, workspaceId, parentId)) return { kind: "not-found" };
        if (parentId === collectionId || await isAncestor(client, workspaceId, collectionId, parentId)) return { kind: "cycle" };
      }
      const updated = await client.query<CollectionRow>(`UPDATE private_collection c
          SET title = COALESCE($3, c.title),
              parent_collection_id = CASE WHEN $4::boolean THEN $5::uuid ELSE c.parent_collection_id END
        WHERE c.collection_id = $1 AND c.workspace_id = $2 AND ${activeCollection}
        RETURNING ${collectionColumns}`, [collectionId, workspaceId, input.title ?? null, moving, input.parentId ?? null]);
      const row = updated.rows[0];
      if (!row) return { kind: "not-found" };
      await appendPrivateAudit(client, organizationId, owner.membershipId, "PRIVATE_COLLECTION_UPDATED",
        { collectionId, renamed: input.title !== undefined, moved: moving, requestId });
      return { kind: "updated", collection: mapCollection(row) };
    });
  }

  async setCollectionFavorite(userId: string, organizationId: string, collectionId: string, favorite: boolean): Promise<PrivateCollection | null> {
    return this.withActor(userId, organizationId, async (client) => {
      const owner = await findOwner(client, userId, organizationId);
      if (!owner?.workspaceId) return null;
      const updated = await client.query<CollectionRow>(`UPDATE private_collection c
          SET favorited_at = CASE WHEN $3::boolean THEN COALESCE(c.favorited_at, now()) ELSE NULL END
        WHERE c.collection_id = $1 AND c.workspace_id = $2 AND ${activeCollection}
        RETURNING ${collectionColumns}`, [collectionId, owner.workspaceId, favorite]);
      const row = updated.rows[0];
      return row ? mapCollection(row) : null;
    });
  }

  async moveNote(userId: string, organizationId: string, draftId: string, collectionId: string | null, index: number | null): Promise<DraftListItem | null> {
    return this.withActor(userId, organizationId, async (client) => {
      const owner = await findOwner(client, userId, organizationId);
      if (!owner?.workspaceId) return null;
      const workspaceId = owner.workspaceId;
      await lockTree(client, workspaceId);
      if (collectionId && !await isActiveCollection(client, workspaceId, collectionId)) return null;
      const note = await client.query(`SELECT 1 FROM draft_document d
        WHERE d.draft_id = $1 AND d.workspace_id = $2 AND ${treeNote} FOR UPDATE`, [draftId, workspaceId]);
      if (!note.rowCount) return null;
      // Renumber the destination from 1 with the note inserted; only changed rows are written.
      const siblings = await client.query<{ draft_id: string }>(`SELECT d.draft_id FROM draft_document d
        WHERE d.workspace_id = $1 AND ${treeNote} AND d.collection_id IS NOT DISTINCT FROM $2::uuid AND d.draft_id <> $3
        ORDER BY ${noteOrder}`, [workspaceId, collectionId, draftId]);
      const order = siblings.rows.map((row) => row.draft_id);
      order.splice(Math.min(index ?? order.length, order.length), 0, draftId);
      await client.query(`UPDATE draft_document d
          SET sort_position = o.position::integer,
              collection_id = CASE WHEN d.draft_id = $3 THEN $2::uuid ELSE d.collection_id END
          FROM unnest($1::uuid[]) WITH ORDINALITY AS o(draft_id, position)
        WHERE d.draft_id = o.draft_id AND d.workspace_id = $4
          AND (d.draft_id = $3 OR d.sort_position IS DISTINCT FROM o.position::integer)`,
      [order, collectionId, draftId, workspaceId]);
      return (await noteSummaries(client, workspaceId, organizationId, [draftId]))[0] ?? null;
    });
  }

  async setNoteFavorite(userId: string, organizationId: string, draftId: string, favorite: boolean): Promise<DraftListItem | null> {
    return this.withActor(userId, organizationId, async (client) => {
      const owner = await findOwner(client, userId, organizationId);
      if (!owner?.workspaceId) return null;
      const updated = await client.query(`UPDATE draft_document d
          SET favorited_at = CASE WHEN $3::boolean THEN COALESCE(d.favorited_at, now()) ELSE NULL END
        WHERE d.draft_id = $1 AND d.workspace_id = $2 AND ${treeNote}`,
      [draftId, owner.workspaceId, favorite]);
      if (!updated.rowCount) return null;
      return (await noteSummaries(client, owner.workspaceId, organizationId, [draftId]))[0] ?? null;
    });
  }

  async setNoteArchived(userId: string, organizationId: string, draftId: string, archived: boolean, requestId: string): Promise<DraftListItem | null> {
    return this.withActor(userId, organizationId, async (client) => {
      const owner = await findOwner(client, userId, organizationId);
      if (!owner?.workspaceId) return null;
      const workspaceId = owner.workspaceId;
      await lockTree(client, workspaceId);
      const current = await client.query<{ archived_at: Date | null; collection_id: string | null }>(`SELECT d.archived_at, d.collection_id
        FROM draft_document d WHERE d.draft_id = $1 AND d.workspace_id = $2 AND d.status = 'ACTIVE' AND d.trashed_at IS NULL
        FOR UPDATE`, [draftId, workspaceId]);
      const row = current.rows[0];
      if (!row) return null;
      if ((row.archived_at !== null) !== archived) {
        if (archived) {
          await client.query(`UPDATE draft_document SET archived_at = now() WHERE draft_id = $1 AND workspace_id = $2`, [draftId, workspaceId]);
        } else {
          // Back to its collection while that collection is active, otherwise to the root; it shows first there.
          const collectionId = row.collection_id && await isActiveCollection(client, workspaceId, row.collection_id) ? row.collection_id : null;
          await client.query(`UPDATE draft_document SET archived_at = NULL, collection_id = $3, sort_position = NULL
            WHERE draft_id = $1 AND workspace_id = $2`, [draftId, workspaceId, collectionId]);
        }
        await appendPrivateAudit(client, organizationId, owner.membershipId,
          archived ? "PRIVATE_DRAFT_ARCHIVED" : "PRIVATE_DRAFT_UNARCHIVED", { draftId, requestId });
      }
      return (await noteSummaries(client, workspaceId, organizationId, [draftId]))[0] ?? null;
    });
  }

  async listArchived(userId: string, organizationId: string): Promise<{ items: PrivateArchivedNote[]; hasMore: boolean } | null> {
    return this.withActor(userId, organizationId, async (client) => {
      const owner = await findOwner(client, userId, organizationId);
      if (!owner) return null;
      if (!owner.workspaceId) return { items: [], hasMore: false };
      const result = await client.query<{
        draft_id: string; title: string; collection_id: string | null; collection_title: string | null;
        archived_at: Date; created_at: Date; updated_at: Date;
      }>(`SELECT d.draft_id, d.title, d.collection_id, c.title AS collection_title, d.archived_at, d.created_at, d.updated_at
          FROM draft_document d
          LEFT JOIN private_collection c ON c.collection_id = d.collection_id AND c.workspace_id = d.workspace_id AND ${activeCollection}
         WHERE d.workspace_id = $1 AND d.status = 'ACTIVE' AND d.trashed_at IS NULL AND d.archived_at IS NOT NULL
         ORDER BY d.archived_at DESC, d.draft_id DESC
         LIMIT $2`, [owner.workspaceId, maxListedArchivedNotes + 1]);
      return {
        items: result.rows.slice(0, maxListedArchivedNotes).map((row) => ({
          id: row.draft_id, title: row.title,
          collectionId: row.collection_title === null ? null : row.collection_id,
          collectionTitle: row.collection_title,
          archivedAt: row.archived_at, createdAt: row.created_at, updatedAt: row.updated_at,
        })),
        hasMore: result.rows.length > maxListedArchivedNotes,
      };
    });
  }

  async getNoteSource(userId: string, organizationId: string, draftId: string): Promise<PrivateNoteSource | null> {
    return this.withActor(userId, organizationId, async (client) => {
      const owner = await findOwner(client, userId, organizationId);
      if (!owner?.workspaceId) return null;
      return (await noteSources(client, owner.workspaceId, { draftIds: [draftId] }))[0] ?? null;
    });
  }

  async duplicateNote(userId: string, organizationId: string, source: PrivateNoteSource, title: string,
    copy: StoredContentFields, requestId: string): Promise<PrivateDraft | null> {
    return this.withActor(userId, organizationId, async (client) => {
      const owner = await findOwner(client, userId, organizationId);
      if (!owner?.workspaceId) return null;
      await lockTree(client, owner.workspaceId);
      const current = (await noteSources(client, owner.workspaceId, { draftIds: [source.id] }))[0];
      // Decision 0030: an open version can change in place, so compare its content too.
      if (!current || current.versionId !== source.versionId || current.contentHash !== source.contentHash) return null;
      const created = await insertNoteCopy(client, owner, current.collectionId, title, copy);
      await appendPrivateAudit(client, organizationId, owner.membershipId, "PRIVATE_DRAFT_DUPLICATED",
        { draftId: created.draftId, sourceDraftId: source.id, requestId });
      return {
        id: created.draftId, organizationId, title, versionId: created.versionId,
        sourceUri: copy.sourceUri, mimeType: copy.mimeType, contentHash: copy.contentHash, currentVersion: 1,
        createdAt: created.createdAt, updatedAt: created.updatedAt,
        collectionId: current.collectionId, favoritedAt: null, position: null,
      };
    });
  }

  async getCollectionSubtree(userId: string, organizationId: string, collectionId: string): Promise<PrivateCollectionSubtree | null> {
    return this.withActor(userId, organizationId, async (client) => {
      const owner = await findOwner(client, userId, organizationId);
      if (!owner?.workspaceId) return null;
      return readSubtree(client, owner.workspaceId, collectionId);
    });
  }

  async duplicateCollection(userId: string, organizationId: string, snapshot: PrivateCollectionSubtree, rootTitle: string,
    copies: ReadonlyMap<string, StoredContentFields>, requestId: string): Promise<PrivateDuplicatedCollection | "changed" | null> {
    return this.withActor(userId, organizationId, async (client) => {
      const owner = await findOwner(client, userId, organizationId);
      if (!owner?.workspaceId) return null;
      const workspaceId = owner.workspaceId;
      await lockTree(client, workspaceId);
      const current = await readSubtree(client, workspaceId, snapshot.root.id);
      if (!current) return null;
      if (!sameSubtree(current, snapshot) || current.notes.some((note) => !copies.has(note.id))) return "changed";
      await ensureCollectionCapacity(client, workspaceId, current.collections.length);

      const newIds = new Map(current.collections.map((collection) => [collection.id, randomUUID()]));
      const collections: PrivateCollection[] = [];
      for (const collection of current.collections) {
        const isRoot = collection.id === current.root.id;
        const inserted = await client.query<CollectionRow>(`INSERT INTO private_collection AS c
            (collection_id, workspace_id, parent_collection_id, title)
          VALUES ($1, $2, $3, $4) RETURNING ${collectionColumns}`, [
          newIds.get(collection.id), workspaceId,
          isRoot ? collection.parentId : newIds.get(collection.parentId ?? "") ?? null,
          isRoot ? rootTitle : collection.title]);
        const row = inserted.rows[0];
        if (!row) throw new Error("Private collection copy returned no row");
        collections.push(mapCollection(row));
      }
      const noteIds: string[] = [];
      for (const note of current.notes) {
        const created = await insertNoteCopy(client, owner, newIds.get(note.collectionId ?? "") ?? null,
          note.title, copies.get(note.id) as StoredContentFields);
        noteIds.push(created.draftId);
      }
      const root = collections[0];
      if (!root) throw new Error("Private collection copy has no root");
      await appendPrivateAudit(client, organizationId, owner.membershipId, "PRIVATE_COLLECTION_CREATED", {
        collectionId: root.id, sourceCollectionId: snapshot.root.id, duplicated: true,
        collectionCount: collections.length, noteCount: noteIds.length, requestId,
      });
      return { collection: root, collections, notes: await noteSummaries(client, workspaceId, organizationId, noteIds) };
    });
  }

  async trashNote(userId: string, organizationId: string, draftId: string, requestId: string): Promise<PrivateTrashEntry | null> {
    return this.withActor(userId, organizationId, async (client) => {
      const owner = await findOwner(client, userId, organizationId);
      if (!owner?.workspaceId) return null;
      await lockTree(client, owner.workspaceId);
      const batchId = randomUUID();
      // An archived note can be moved to trash too; restoring it brings it back to the tree.
      const trashed = await client.query(`UPDATE draft_document d SET trashed_at = now(), trash_batch_id = $3, archived_at = NULL
        WHERE d.draft_id = $1 AND d.workspace_id = $2 AND d.status = 'ACTIVE' AND d.trashed_at IS NULL`,
      [draftId, owner.workspaceId, batchId]);
      if (!trashed.rowCount) return null;
      await appendPrivateAudit(client, organizationId, owner.membershipId, "PRIVATE_ITEM_TRASHED",
        { batchId, kind: "note", itemCount: 1, requestId });
      return requireEntry(await trashEntries(client, owner.workspaceId, batchId));
    });
  }

  async trashCollection(userId: string, organizationId: string, collectionId: string, requestId: string): Promise<PrivateTrashEntry | null> {
    return this.withActor(userId, organizationId, async (client) => {
      const owner = await findOwner(client, userId, organizationId);
      if (!owner?.workspaceId) return null;
      const workspaceId = owner.workspaceId;
      await lockTree(client, workspaceId);
      const subtree = await activeSubtreeIds(client, workspaceId, collectionId);
      if (subtree.length === 0) return null;
      const batchId = randomUUID();
      // Notes before collections: every tree writer uses this order under the workspace lock.
      const notes = await client.query(`UPDATE draft_document d SET trashed_at = now(), trash_batch_id = $3
        WHERE d.workspace_id = $1 AND d.collection_id = ANY($2::uuid[]) AND ${treeNote}`,
      [workspaceId, subtree, batchId]);
      await client.query(`UPDATE private_collection c SET trashed_at = now(), trash_batch_id = $3
        WHERE c.workspace_id = $1 AND c.collection_id = ANY($2::uuid[]) AND ${activeCollection}`,
      [workspaceId, subtree, batchId]);
      await appendPrivateAudit(client, organizationId, owner.membershipId, "PRIVATE_ITEM_TRASHED",
        { batchId, kind: "collection", itemCount: subtree.length + (notes.rowCount ?? 0), requestId });
      return requireEntry(await trashEntries(client, workspaceId, batchId));
    });
  }

  async listTrash(userId: string, organizationId: string): Promise<PrivateTrashEntry[] | null> {
    return this.withActor(userId, organizationId, async (client) => {
      const owner = await findOwner(client, userId, organizationId);
      if (!owner) return null;
      return owner.workspaceId ? trashEntries(client, owner.workspaceId, null) : [];
    });
  }

  async restoreTrash(userId: string, organizationId: string, batchId: string, requestId: string): Promise<{ collections: PrivateCollection[]; notes: DraftListItem[] } | null> {
    return this.withActor(userId, organizationId, async (client) => {
      const owner = await findOwner(client, userId, organizationId);
      if (!owner?.workspaceId) return null;
      const workspaceId = owner.workspaceId;
      await lockTree(client, workspaceId);
      const items = await batchItems(client, workspaceId, batchId);
      const root = batchRoot(items);
      if (!root) return null;
      await ensureCollectionCapacity(client, workspaceId, items.filter((item) => item.kind === "collection").length);
      if (root.parent_id && !await isActiveCollection(client, workspaceId, root.parent_id)) {
        // The original parent was trashed or purged: the batch root returns to the workspace root.
        if (root.kind === "note") {
          await client.query(`UPDATE draft_document SET collection_id = NULL WHERE draft_id = $1 AND workspace_id = $2`, [root.id, workspaceId]);
        } else {
          await client.query(`UPDATE private_collection SET parent_collection_id = NULL WHERE collection_id = $1 AND workspace_id = $2`, [root.id, workspaceId]);
        }
      }
      await client.query(`UPDATE draft_document d SET trashed_at = NULL, trash_batch_id = NULL
        WHERE d.workspace_id = $1 AND d.trash_batch_id = $2 AND d.status = 'ACTIVE'`, [workspaceId, batchId]);
      await client.query(`UPDATE private_collection c SET trashed_at = NULL, trash_batch_id = NULL
        WHERE c.workspace_id = $1 AND c.trash_batch_id = $2 AND c.status = 'ACTIVE'`, [workspaceId, batchId]);
      await appendPrivateAudit(client, organizationId, owner.membershipId, "PRIVATE_ITEM_RESTORED",
        { batchId, kind: root.kind, itemCount: items.length, requestId });
      const collectionIds = items.filter((item) => item.kind === "collection").map((item) => item.id);
      const collections = collectionIds.length ? (await client.query<CollectionRow>(`SELECT ${collectionColumns}
        FROM private_collection c WHERE c.workspace_id = $1 AND c.collection_id = ANY($2::uuid[])
        ORDER BY c.created_at, c.collection_id`, [workspaceId, collectionIds])).rows.map(mapCollection) : [];
      const notes = await noteSummaries(client, workspaceId, organizationId,
        items.filter((item) => item.kind === "note").map((item) => item.id));
      return { collections, notes };
    });
  }

  async purgeTrash(userId: string, organizationId: string, batchId: string, requestId: string): Promise<PurgedPrivateContent | null> {
    return this.withActor(userId, organizationId, async (client) => {
      const owner = await findOwner(client, userId, organizationId);
      if (!owner?.workspaceId) return null;
      await lockTree(client, owner.workspaceId);
      const items = await batchItems(client, owner.workspaceId, batchId);
      if (items.length === 0) return null;
      const content = await tombstoneBatch(client, owner.workspaceId, batchId, null);
      await appendPrivateAudit(client, organizationId, owner.membershipId, "PRIVATE_ITEM_PURGED",
        { batchId, itemCount: items.length, reason: "USER", requestId });
      return content;
    });
  }

  async markContentPurged(userId: string, organizationId: string, draftIds: string[]): Promise<void> {
    if (draftIds.length === 0) return;
    await this.withActor(userId, organizationId, async (client) => {
      const owner = await findOwner(client, userId, organizationId);
      if (owner?.workspaceId) await markErased(client, draftIds, owner.workspaceId);
    });
  }

  async markContentErased(draftIds: string[]): Promise<void> {
    if (draftIds.length === 0) return;
    await this.withRetention((client) => markErased(client, draftIds, null));
  }

  async purgeExpired(cutoff: Date, batchLimit: number): Promise<{ purgedBatches: number; content: PurgedPrivateContent }> {
    return this.withRetention(async (client) => {
      // Visible rows are limited by policy to trash older than 30 days and
      // purged notes whose content erasure is still pending.
      const candidates = await client.query<{ trash_batch_id: string; workspace_id: string }>(`
        SELECT trash_batch_id, workspace_id FROM (
          SELECT trash_batch_id, workspace_id, trashed_at FROM draft_document
           WHERE status = 'ACTIVE' AND trashed_at < $1
          UNION ALL
          SELECT trash_batch_id, workspace_id, trashed_at FROM private_collection
           WHERE status = 'ACTIVE' AND trashed_at < $1
        ) expired
        GROUP BY trash_batch_id, workspace_id
        ORDER BY min(trashed_at), trash_batch_id
        LIMIT $2`, [cutoff, batchLimit]);
      let purgedBatches = 0;
      for (const candidate of candidates.rows) {
        await lockTree(client, candidate.workspace_id);
        const tombstoned = await tombstoneBatch(client, candidate.workspace_id, candidate.trash_batch_id, cutoff);
        if (tombstoned !== null) purgedBatches += 1;
      }
      const pending = await client.query<{ draft_id: string }>(`SELECT draft_id FROM draft_document
        WHERE status = 'PURGED' AND content_purged_at IS NULL ORDER BY updated_at, draft_id LIMIT 1000`);
      return { purgedBatches, content: await contentObjects(client, pending.rows.map((row) => row.draft_id)) };
    });
  }
}

async function findOwner(client: PoolClient, userId: string, organizationId: string): Promise<Owner | null> {
  const result = await client.query<{ membership_id: string; workspace_id: string | null }>(`
    SELECT om.membership_id, w.workspace_id
      FROM organization_membership om
      JOIN user_account ua ON ua.user_id = om.user_id AND ua.status = 'ACTIVE'
      JOIN organization o ON o.organization_id = om.organization_id AND o.status = 'ACTIVE'
      LEFT JOIN private_workspace w ON w.membership_id = om.membership_id AND w.status = 'ACTIVE'
     WHERE om.user_id = $1 AND om.organization_id = $2 AND om.status = 'ACTIVE'`, [userId, organizationId]);
  const row = result.rows[0];
  return row ? { membershipId: row.membership_id, workspaceId: row.workspace_id } : null;
}

async function ensureWorkspace(client: PoolClient, membershipId: string): Promise<string | null> {
  await client.query(`INSERT INTO private_workspace (membership_id, name) VALUES ($1, 'Private workspace')
    ON CONFLICT (membership_id) DO NOTHING`, [membershipId]);
  const workspace = await client.query<{ workspace_id: string }>(`SELECT workspace_id FROM private_workspace
    WHERE membership_id = $1 AND status = 'ACTIVE'`, [membershipId]);
  return workspace.rows[0]?.workspace_id ?? null;
}

/** Serializes tree-shape changes in one private workspace (moves, trash, restore, purge, copies). */
export async function lockTree(client: PoolClient, workspaceId: string): Promise<void> {
  await client.query(`SELECT pg_advisory_xact_lock(hashtextextended('arden:private-tree:' || $1::text, 0))`, [workspaceId]);
}

export async function isActiveCollection(client: PoolClient, workspaceId: string, collectionId: string): Promise<boolean> {
  const result = await client.query(`SELECT 1 FROM private_collection c
    WHERE c.collection_id = $1 AND c.workspace_id = $2 AND ${activeCollection}`, [collectionId, workspaceId]);
  return result.rowCount === 1;
}

/** True when `ancestorId` is `collectionId` itself or one of its ancestors. */
async function isAncestor(client: PoolClient, workspaceId: string, ancestorId: string, collectionId: string): Promise<boolean> {
  const result = await client.query(`WITH RECURSIVE chain(collection_id, depth) AS (
      SELECT $2::uuid, 0
      UNION ALL
      SELECT c.parent_collection_id, chain.depth + 1 FROM private_collection c
        JOIN chain ON chain.collection_id = c.collection_id
       WHERE c.workspace_id = $3 AND c.parent_collection_id IS NOT NULL AND chain.depth < 10000
    ) SELECT 1 FROM chain WHERE collection_id = $1 LIMIT 1`, [ancestorId, collectionId, workspaceId]);
  return result.rowCount === 1;
}

async function activeSubtreeIds(client: PoolClient, workspaceId: string, collectionId: string): Promise<string[]> {
  const result = await client.query<{ collection_id: string }>(`WITH RECURSIVE tree(collection_id) AS (
      SELECT c.collection_id FROM private_collection c
       WHERE c.collection_id = $2 AND c.workspace_id = $1 AND ${activeCollection}
      UNION
      SELECT c.collection_id FROM private_collection c JOIN tree ON c.parent_collection_id = tree.collection_id
       WHERE c.workspace_id = $1 AND ${activeCollection}
    ) SELECT collection_id FROM tree`, [workspaceId, collectionId]);
  return result.rows.map((row) => row.collection_id);
}

async function readSubtree(client: PoolClient, workspaceId: string, collectionId: string): Promise<PrivateCollectionSubtree | null> {
  const collections = await client.query<CollectionRow & { depth: number }>(`WITH RECURSIVE tree(collection_id, depth) AS (
      SELECT c.collection_id, 0 FROM private_collection c
       WHERE c.collection_id = $2 AND c.workspace_id = $1 AND ${activeCollection}
      UNION
      SELECT c.collection_id, tree.depth + 1 FROM private_collection c JOIN tree ON c.parent_collection_id = tree.collection_id
       WHERE c.workspace_id = $1 AND ${activeCollection}
    ) SELECT ${collectionColumns}, tree.depth FROM tree JOIN private_collection c USING (collection_id)
      ORDER BY tree.depth, c.created_at, c.collection_id`, [workspaceId, collectionId]);
  const mapped = collections.rows.map(mapCollection);
  const root = mapped[0];
  if (!root) return null;
  const notes = await noteSources(client, workspaceId, { collectionIds: mapped.map((collection) => collection.id) });
  return { root, collections: mapped, notes };
}

function sameSubtree(current: PrivateCollectionSubtree, snapshot: PrivateCollectionSubtree): boolean {
  const key = (subtree: PrivateCollectionSubtree) => JSON.stringify({
    collections: subtree.collections.map((collection) => [collection.id, collection.parentId]).sort(),
    notes: subtree.notes.map((note) => [note.id, note.versionId, note.contentHash, note.collectionId]).sort(),
  });
  return key(current) === key(snapshot);
}

async function noteSources(client: PoolClient, workspaceId: string,
  filter: { draftIds: string[] } | { collectionIds: string[] }): Promise<PrivateNoteSource[]> {
  const byDraft = "draftIds" in filter;
  const result = await client.query<NoteSourceRow>(`
    SELECT d.draft_id, d.title, d.collection_id, v.draft_version_id, v.source_uri, v.mime_type, v.content_hash
      FROM draft_document d
      JOIN draft_version v ON v.draft_id = d.draft_id AND v.version_no = d.current_version_no
     WHERE d.workspace_id = $1 AND ${treeNote}
       AND ${byDraft ? "d.draft_id" : "d.collection_id"} = ANY($2::uuid[])
     ORDER BY d.created_at, d.draft_id`, [workspaceId, byDraft ? filter.draftIds : filter.collectionIds]);
  return result.rows.map((row) => ({
    id: row.draft_id, title: row.title, collectionId: row.collection_id, versionId: row.draft_version_id,
    sourceUri: row.source_uri, mimeType: row.mime_type, contentHash: row.content_hash,
  }));
}

async function noteSummaries(client: PoolClient, workspaceId: string, organizationId: string, draftIds: string[]): Promise<DraftListItem[]> {
  if (draftIds.length === 0) return [];
  const result = await client.query<NoteSummaryRow>(`${noteSummarySelect}
     WHERE d.workspace_id = $1 AND d.draft_id = ANY($2::uuid[]) AND d.status = 'ACTIVE' AND d.trashed_at IS NULL
     ORDER BY d.created_at, d.draft_id`, [workspaceId, draftIds]);
  return result.rows.map((row) => mapNoteSummary(row, organizationId));
}

async function insertNoteCopy(client: PoolClient, owner: Owner, collectionId: string | null, title: string,
  copy: StoredContentFields): Promise<{ draftId: string; versionId: string; createdAt: Date; updatedAt: Date }> {
  const draft = await client.query<{ draft_id: string }>(`INSERT INTO draft_document
      (workspace_id, title, current_version_no, collection_id)
    VALUES ($1, $2, 1, $3) RETURNING draft_id`, [owner.workspaceId, title, collectionId]);
  const draftId = draft.rows[0]?.draft_id;
  if (!draftId) throw new Error("Private note copy returned no row");
  const version = await client.query<{ draft_version_id: string }>(`INSERT INTO draft_version
      (draft_id, version_no, source_uri, mime_type, content_hash, created_by_membership_id)
    VALUES ($1, 1, $2, $3, $4, $5) RETURNING draft_version_id`,
  [draftId, copy.sourceUri, copy.mimeType, copy.contentHash, owner.membershipId]);
  const versionId = version.rows[0]?.draft_version_id;
  if (!versionId) throw new Error("Private note copy version returned no row");
  const timestamps = await client.query<{ created_at: Date; updated_at: Date }>(`SELECT created_at, updated_at
    FROM draft_document WHERE draft_id = $1`, [draftId]);
  const row = timestamps.rows[0];
  if (!row) throw new Error("Private note copy disappeared within transaction");
  return { draftId, versionId, createdAt: row.created_at, updatedAt: row.updated_at };
}

async function batchItems(client: PoolClient, workspaceId: string, batchId: string): Promise<BatchItemRow[]> {
  const result = await client.query<BatchItemRow>(`
    SELECT 'note' AS kind, d.draft_id AS id, d.collection_id AS parent_id, d.trashed_at
      FROM draft_document d WHERE d.workspace_id = $1 AND d.trash_batch_id = $2 AND d.status = 'ACTIVE'
    UNION ALL
    SELECT 'collection', c.collection_id, c.parent_collection_id, c.trashed_at
      FROM private_collection c WHERE c.workspace_id = $1 AND c.trash_batch_id = $2 AND c.status = 'ACTIVE'`,
  [workspaceId, batchId]);
  return result.rows;
}

/** The single batch item whose parent is outside the batch. */
function batchRoot(items: BatchItemRow[]): BatchItemRow | null {
  const collectionIds = new Set(items.filter((item) => item.kind === "collection").map((item) => item.id));
  return items.find((item) => !item.parent_id || !collectionIds.has(item.parent_id)) ?? null;
}

async function trashEntries(client: PoolClient, workspaceId: string, batchId: string | null): Promise<PrivateTrashEntry[]> {
  const result = await client.query<{
    trash_batch_id: string; kind: "note" | "collection"; id: string; title: string;
    trashed_at: Date; item_count: string; from_title: string | null;
  }>(`WITH items AS (
      SELECT 'collection' AS kind, c.collection_id AS id, c.title, c.parent_collection_id AS parent_id,
             c.trash_batch_id, c.trashed_at
        FROM private_collection c
       WHERE c.workspace_id = $1 AND c.status = 'ACTIVE' AND c.trash_batch_id IS NOT NULL
         AND ($2::uuid IS NULL OR c.trash_batch_id = $2)
      UNION ALL
      SELECT 'note', d.draft_id, d.title, d.collection_id, d.trash_batch_id, d.trashed_at
        FROM draft_document d
       WHERE d.workspace_id = $1 AND d.status = 'ACTIVE' AND d.trash_batch_id IS NOT NULL
         AND ($2::uuid IS NULL OR d.trash_batch_id = $2)
    )
    SELECT root.trash_batch_id, root.kind, root.id, root.title, root.trashed_at,
           (SELECT count(*) FROM items member WHERE member.trash_batch_id = root.trash_batch_id)::text AS item_count,
           parent.title AS from_title
      FROM items root
      LEFT JOIN private_collection parent ON parent.collection_id = root.parent_id
       AND parent.workspace_id = $1 AND parent.status = 'ACTIVE'
     WHERE NOT EXISTS (SELECT 1 FROM items member
                        WHERE member.kind = 'collection' AND member.id = root.parent_id
                          AND member.trash_batch_id = root.trash_batch_id)
     ORDER BY root.trashed_at DESC, root.trash_batch_id DESC`, [workspaceId, batchId]);
  return result.rows.map((row) => ({
    batchId: row.trash_batch_id, kind: row.kind, id: row.id, title: row.title,
    fromCollectionTitle: row.from_title, itemCount: Number(row.item_count), trashedAt: row.trashed_at,
  }));
}

function requireEntry(entries: PrivateTrashEntry[]): PrivateTrashEntry {
  const entry = entries[0];
  if (!entry) throw new Error("Trashed batch has no root item");
  return entry;
}

/**
 * Turns every active item of a batch into a tombstone and returns the content
 * objects of the affected notes. Returns null when nothing in the batch was
 * still active (a concurrent restore or purge won). With a cutoff, only items
 * trashed before it are touched (retention job).
 */
async function tombstoneBatch(client: PoolClient, workspaceId: string, batchId: string, cutoff: Date | null): Promise<PurgedPrivateContent | null> {
  const notes = await client.query<{ draft_id: string }>(`SELECT draft_id FROM draft_document
    WHERE workspace_id = $3 AND trash_batch_id = $1 AND status = 'ACTIVE' AND ($2::timestamptz IS NULL OR trashed_at < $2)`, [batchId, cutoff, workspaceId]);
  const draftIds = notes.rows.map((row) => row.draft_id);
  const content = await contentObjects(client, draftIds);
  const purgedNotes = await client.query(`UPDATE draft_document
      SET status = 'PURGED', title = '', description = NULL, favorited_at = NULL, content_purged_at = NULL
    WHERE workspace_id = $3 AND trash_batch_id = $1 AND status = 'ACTIVE' AND ($2::timestamptz IS NULL OR trashed_at < $2)`, [batchId, cutoff, workspaceId]);
  const purgedCollections = await client.query(`UPDATE private_collection
      SET status = 'PURGED', title = '', favorited_at = NULL
    WHERE workspace_id = $3 AND trash_batch_id = $1 AND status = 'ACTIVE' AND ($2::timestamptz IS NULL OR trashed_at < $2)`, [batchId, cutoff, workspaceId]);
  return (purgedNotes.rowCount ?? 0) + (purgedCollections.rowCount ?? 0) > 0 ? content : null;
}

async function contentObjects(client: PoolClient, draftIds: string[]): Promise<PurgedPrivateContent> {
  if (draftIds.length === 0) return [];
  const versions = await client.query<{ draft_id: string; source_uri: string }>(`SELECT DISTINCT draft_id, source_uri
    FROM draft_version WHERE draft_id = ANY($1::uuid[]) ORDER BY draft_id, source_uri`, [draftIds]);
  const byDraft = new Map<string, string[]>(draftIds.map((id) => [id, []]));
  for (const row of versions.rows) byDraft.get(row.draft_id)?.push(row.source_uri);
  return [...byDraft].map(([draftId, sourceUris]) => ({ draftId, sourceUris }));
}

async function markErased(client: PoolClient, draftIds: string[], workspaceId: string | null): Promise<void> {
  await client.query(`UPDATE draft_document SET content_purged_at = now()
    WHERE draft_id = ANY($1::uuid[]) AND status = 'PURGED' AND content_purged_at IS NULL
      AND ($2::uuid IS NULL OR workspace_id = $2)`, [draftIds, workspaceId]);
}

/** Audit details carry identifiers and counts only, never titles or content. */
async function appendPrivateAudit(client: PoolClient, organizationId: string, membershipId: string,
  eventType: string, details: Record<string, string | number | boolean>): Promise<void> {
  await client.query(`INSERT INTO audit_event (organization_id, actor_membership_id, event_type, outcome, details_json)
    VALUES ($1, $2, $3, 'SUCCESS', $4::jsonb)`, [organizationId, membershipId, eventType, JSON.stringify(details)]);
}

function mapCollection(row: CollectionRow): PrivateCollection {
  return {
    id: row.collection_id, title: row.title, parentId: row.parent_collection_id,
    favoritedAt: row.favorited_at, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function mapNoteSummary(row: NoteSummaryRow, organizationId: string): DraftListItem {
  return {
    id: row.draft_id, organizationId, title: row.title,
    currentVersion: { id: row.draft_version_id, version: row.current_version_no, mimeType: row.mime_type, contentHash: row.content_hash },
    createdAt: row.created_at, updatedAt: row.updated_at,
    collectionId: row.collection_id, favoritedAt: row.favorited_at,
    position: row.sort_position, archivedAt: row.archived_at,
  };
}
