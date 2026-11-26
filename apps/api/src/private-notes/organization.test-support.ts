import { randomUUID } from "node:crypto";
import type { DraftListItem, PrivateDraft, StoredContentFields } from "../db/repository.js";
import type {
  PrivateArchivedNote, PrivateCollection, PrivateCollectionSubtree, PrivateDuplicatedCollection, PrivateNoteSource,
  PrivateOrganizationStore, PrivateTrashEntry, PurgedPrivateContent, UpdateCollectionResult,
} from "./organization-store.js";
import { maxListedCollections, PrivateCollectionLimitError } from "./organization-store.js";

type NoteContent = { versionId: string; version: number } & StoredContentFields;
type MemoryNote = {
  id: string; title: string; collectionId: string | null; favoritedAt: Date | null;
  trashedAt: Date | null; batchId: string | null; status: "ACTIVE" | "PURGED"; contentPurged: boolean;
  content: () => NoteContent; createdAt: Date; updatedAt: Date;
  position: number | null; archivedAt: Date | null;
};
type MemoryCollection = {
  id: string; title: string; parentId: string | null; favoritedAt: Date | null;
  trashedAt: Date | null; batchId: string | null; status: "ACTIVE" | "PURGED"; createdAt: Date; updatedAt: Date;
};

/** In-memory model of decision 0029 and spec F03-ARR for HTTP tests: one owner, other members see nothing. */
export class MemoryPrivateOrganizationStore implements PrivateOrganizationStore {
  readonly notes = new Map<string, MemoryNote>();
  readonly collections = new Map<string, MemoryCollection>();
  readonly audit: { eventType: string; details: Record<string, unknown> }[] = [];
  now = () => new Date();
  /** Mirrors maxListedCollections; tests lower it to exercise the limit. */
  collectionLimit = maxListedCollections;

  constructor(private readonly scope: { organizationId: string; ownerId: string; memberIds: string[] }) {}

  addNote(input: { id: string; title: string; collectionId?: string | null; content: () => NoteContent }): void {
    const at = this.now();
    this.notes.set(input.id, { id: input.id, title: input.title, collectionId: input.collectionId ?? null, favoritedAt: null,
      trashedAt: null, batchId: null, status: "ACTIVE", contentPurged: false, content: input.content, createdAt: at, updatedAt: at,
      position: null, archivedAt: null });
  }

  /** Notes of one container in display order: unplaced first (newest first), then by position. */
  ordered(collectionId: string | null): MemoryNote[] {
    return [...this.notes.values()]
      .filter((note) => !this.hidden(note.id) && !note.archivedAt && note.collectionId === collectionId)
      .sort((left, right) => (left.position ?? -1) - (right.position ?? -1)
        || right.createdAt.getTime() - left.createdAt.getTime() || right.id.localeCompare(left.id));
  }

  /** True when the note is trashed or purged and must behave as not found. */
  hidden(draftId: string): boolean {
    const note = this.notes.get(draftId);
    return Boolean(note && (note.status !== "ACTIVE" || note.trashedAt));
  }

  isActiveCollection(collectionId: string): boolean {
    const collection = this.collections.get(collectionId);
    return Boolean(collection && collection.status === "ACTIVE" && !collection.trashedAt);
  }

  summary(note: MemoryNote): DraftListItem {
    const content = note.content();
    return {
      id: note.id, organizationId: this.scope.organizationId, title: note.title,
      currentVersion: { id: content.versionId, version: content.version, mimeType: content.mimeType, contentHash: content.contentHash },
      createdAt: note.createdAt, updatedAt: note.updatedAt, collectionId: note.collectionId, favoritedAt: note.favoritedAt,
      position: note.position, archivedAt: note.archivedAt,
    };
  }

  activeNotes(): DraftListItem[] {
    return [...this.notes.values()].filter((note) => !this.hidden(note.id) && !note.archivedAt).map((note) => this.summary(note));
  }

  async listCollections(userId: string, organizationId: string): Promise<PrivateCollection[] | null> {
    if (!this.member(userId, organizationId)) return null;
    if (!this.owner(userId, organizationId)) return [];
    return [...this.collections.values()].filter((collection) => this.isActiveCollection(collection.id)).map(collectionView);
  }

  async createCollection(userId: string, organizationId: string, input: { title: string; parentId: string | null }, _requestId: string): Promise<PrivateCollection | null> {
    if (!this.owner(userId, organizationId)) return null;
    if (input.parentId && !this.isActiveCollection(input.parentId)) return null;
    if ([...this.collections.keys()].filter((id) => this.isActiveCollection(id)).length + 1 > this.collectionLimit) {
      throw new PrivateCollectionLimitError();
    }
    const at = this.now();
    const collection: MemoryCollection = { id: randomUUID(), title: input.title, parentId: input.parentId, favoritedAt: null,
      trashedAt: null, batchId: null, status: "ACTIVE", createdAt: at, updatedAt: at };
    this.collections.set(collection.id, collection);
    return collectionView(collection);
  }

  async updateCollection(userId: string, organizationId: string, collectionId: string,
    input: { title?: string; parentId?: string | null }, _requestId: string): Promise<UpdateCollectionResult> {
    if (!this.owner(userId, organizationId) || !this.isActiveCollection(collectionId)) return { kind: "not-found" };
    const collection = this.collections.get(collectionId) as MemoryCollection;
    if (input.parentId) {
      if (!this.isActiveCollection(input.parentId)) return { kind: "not-found" };
      for (let cursor: string | null = input.parentId; cursor; cursor = this.collections.get(cursor)?.parentId ?? null) {
        if (cursor === collectionId) return { kind: "cycle" };
      }
    }
    if (input.title !== undefined) collection.title = input.title;
    if (input.parentId !== undefined) collection.parentId = input.parentId;
    collection.updatedAt = this.now();
    return { kind: "updated", collection: collectionView(collection) };
  }

  async setCollectionFavorite(userId: string, organizationId: string, collectionId: string, favorite: boolean): Promise<PrivateCollection | null> {
    if (!this.owner(userId, organizationId) || !this.isActiveCollection(collectionId)) return null;
    const collection = this.collections.get(collectionId) as MemoryCollection;
    collection.favoritedAt = favorite ? collection.favoritedAt ?? this.now() : null;
    return collectionView(collection);
  }

  async moveNote(userId: string, organizationId: string, draftId: string, collectionId: string | null, index: number | null): Promise<DraftListItem | null> {
    const note = this.ownedTreeNote(userId, organizationId, draftId);
    if (!note || (collectionId && !this.isActiveCollection(collectionId))) return null;
    const order = this.ordered(collectionId).filter((entry) => entry.id !== draftId);
    order.splice(Math.min(index ?? order.length, order.length), 0, note);
    note.collectionId = collectionId;
    order.forEach((entry, position) => { entry.position = position + 1; });
    return this.summary(note);
  }

  async setNoteFavorite(userId: string, organizationId: string, draftId: string, favorite: boolean): Promise<DraftListItem | null> {
    const note = this.ownedTreeNote(userId, organizationId, draftId);
    if (!note) return null;
    note.favoritedAt = favorite ? note.favoritedAt ?? this.now() : null;
    return this.summary(note);
  }

  async setNoteArchived(userId: string, organizationId: string, draftId: string, archived: boolean, _requestId: string): Promise<DraftListItem | null> {
    const note = this.ownedActiveNote(userId, organizationId, draftId);
    if (!note) return null;
    if (Boolean(note.archivedAt) !== archived) {
      if (archived) note.archivedAt = this.now();
      else {
        note.archivedAt = null;
        note.position = null;
        if (note.collectionId && !this.isActiveCollection(note.collectionId)) note.collectionId = null;
      }
    }
    return this.summary(note);
  }

  async listArchived(userId: string, organizationId: string): Promise<{ items: PrivateArchivedNote[]; hasMore: boolean } | null> {
    if (!this.member(userId, organizationId)) return null;
    if (!this.owner(userId, organizationId)) return { items: [], hasMore: false };
    const items = [...this.notes.values()].filter((note) => !this.hidden(note.id) && note.archivedAt)
      .sort((left, right) => (right.archivedAt as Date).getTime() - (left.archivedAt as Date).getTime())
      .map((note) => {
        const collection = note.collectionId && this.isActiveCollection(note.collectionId) ? this.collections.get(note.collectionId) : undefined;
        return { id: note.id, title: note.title, collectionId: collection?.id ?? null, collectionTitle: collection?.title ?? null,
          archivedAt: note.archivedAt as Date, createdAt: note.createdAt, updatedAt: note.updatedAt };
      });
    return { items, hasMore: false };
  }

  async getNoteSource(userId: string, organizationId: string, draftId: string): Promise<PrivateNoteSource | null> {
    const note = this.ownedTreeNote(userId, organizationId, draftId);
    return note ? source(note) : null;
  }

  async duplicateNote(userId: string, organizationId: string, from: PrivateNoteSource, title: string,
    copy: StoredContentFields, _requestId: string): Promise<PrivateDraft | null> {
    const note = this.ownedTreeNote(userId, organizationId, from.id);
    if (!note || note.content().versionId !== from.versionId) return null;
    const created = this.copyNote(title, note.collectionId, copy);
    const content = created.content();
    return {
      id: created.id, organizationId, title, versionId: content.versionId, sourceUri: copy.sourceUri, mimeType: copy.mimeType,
      contentHash: copy.contentHash, currentVersion: 1, createdAt: created.createdAt, updatedAt: created.updatedAt,
      collectionId: created.collectionId, favoritedAt: null, position: null,
    };
  }

  async getCollectionSubtree(userId: string, organizationId: string, collectionId: string): Promise<PrivateCollectionSubtree | null> {
    if (!this.owner(userId, organizationId) || !this.isActiveCollection(collectionId)) return null;
    return this.subtree(collectionId);
  }

  async duplicateCollection(userId: string, organizationId: string, snapshot: PrivateCollectionSubtree, rootTitle: string,
    copies: ReadonlyMap<string, StoredContentFields>, _requestId: string): Promise<PrivateDuplicatedCollection | "changed" | null> {
    if (!this.owner(userId, organizationId) || !this.isActiveCollection(snapshot.root.id)) return null;
    const current = this.subtree(snapshot.root.id);
    if (JSON.stringify(current.notes.map((note) => note.versionId)) !== JSON.stringify(snapshot.notes.map((note) => note.versionId))) return "changed";
    const newIds = new Map(current.collections.map((collection) => [collection.id, randomUUID()]));
    const collections = current.collections.map((collection) => {
      const isRoot = collection.id === snapshot.root.id;
      const at = this.now();
      const copy: MemoryCollection = { id: newIds.get(collection.id) as string, title: isRoot ? rootTitle : collection.title,
        parentId: isRoot ? collection.parentId : newIds.get(collection.parentId ?? "") ?? null, favoritedAt: null,
        trashedAt: null, batchId: null, status: "ACTIVE", createdAt: at, updatedAt: at };
      this.collections.set(copy.id, copy);
      return collectionView(copy);
    });
    const notes = current.notes.map((note) => this.summary(this.copyNote(note.title,
      newIds.get(note.collectionId ?? "") ?? null, copies.get(note.id) as StoredContentFields)));
    return { collection: collections[0] as PrivateCollection, collections, notes };
  }

  async trashNote(userId: string, organizationId: string, draftId: string, _requestId: string): Promise<PrivateTrashEntry | null> {
    const note = this.ownedActiveNote(userId, organizationId, draftId);
    if (!note) return null;
    const batchId = randomUUID();
    note.trashedAt = this.now();
    note.batchId = batchId;
    note.archivedAt = null;
    return this.entries().find((entry) => entry.batchId === batchId) ?? null;
  }

  async trashCollection(userId: string, organizationId: string, collectionId: string, _requestId: string): Promise<PrivateTrashEntry | null> {
    if (!this.owner(userId, organizationId) || !this.isActiveCollection(collectionId)) return null;
    const subtree = this.subtree(collectionId);
    const batchId = randomUUID();
    const at = this.now();
    for (const collection of subtree.collections) Object.assign(this.collections.get(collection.id) as MemoryCollection, { trashedAt: at, batchId });
    for (const note of subtree.notes) Object.assign(this.notes.get(note.id) as MemoryNote, { trashedAt: at, batchId });
    return this.entries().find((entry) => entry.batchId === batchId) ?? null;
  }

  async listTrash(userId: string, organizationId: string): Promise<PrivateTrashEntry[] | null> {
    if (!this.member(userId, organizationId)) return null;
    return this.owner(userId, organizationId) ? this.entries() : [];
  }

  async restoreTrash(userId: string, organizationId: string, batchId: string, _requestId: string): Promise<{ collections: PrivateCollection[]; notes: DraftListItem[] } | null> {
    if (!this.owner(userId, organizationId)) return null;
    const { notes, collections } = this.batch(batchId);
    const root = this.entries().find((entry) => entry.batchId === batchId);
    if (!root) return null;
    if (root.kind === "note") {
      const note = this.notes.get(root.id) as MemoryNote;
      if (note.collectionId && !this.isActiveCollection(note.collectionId)) note.collectionId = null;
    } else {
      const collection = this.collections.get(root.id) as MemoryCollection;
      if (collection.parentId && !this.isActiveCollection(collection.parentId)) collection.parentId = null;
    }
    for (const item of [...notes, ...collections]) Object.assign(item, { trashedAt: null, batchId: null });
    return { collections: collections.map(collectionView), notes: notes.map((note) => this.summary(note)) };
  }

  async purgeTrash(userId: string, organizationId: string, batchId: string, requestId: string): Promise<PurgedPrivateContent | null> {
    if (!this.owner(userId, organizationId)) return null;
    const { notes, collections } = this.batch(batchId);
    if (notes.length + collections.length === 0) return null;
    const content = notes.map((note) => ({ draftId: note.id, sourceUris: [note.content().sourceUri] }));
    for (const note of notes) Object.assign(note, { status: "PURGED", title: "", favoritedAt: null });
    for (const collection of collections) Object.assign(collection, { status: "PURGED", title: "", favoritedAt: null });
    this.audit.push({ eventType: "PRIVATE_ITEM_PURGED", details: { batchId, itemCount: notes.length + collections.length, requestId } });
    return content;
  }

  async markContentPurged(userId: string, organizationId: string, draftIds: string[]): Promise<void> {
    if (!this.owner(userId, organizationId)) return;
    for (const id of draftIds) {
      const note = this.notes.get(id);
      if (note?.status === "PURGED") note.contentPurged = true;
    }
  }

  private member(userId: string, organizationId: string): boolean {
    return organizationId === this.scope.organizationId && (userId === this.scope.ownerId || this.scope.memberIds.includes(userId));
  }

  private owner(userId: string, organizationId: string): boolean {
    return organizationId === this.scope.organizationId && userId === this.scope.ownerId;
  }

  private ownedActiveNote(userId: string, organizationId: string, draftId: string): MemoryNote | null {
    if (!this.owner(userId, organizationId) || this.hidden(draftId)) return null;
    return this.notes.get(draftId) ?? null;
  }

  private ownedTreeNote(userId: string, organizationId: string, draftId: string): MemoryNote | null {
    const note = this.ownedActiveNote(userId, organizationId, draftId);
    return note && !note.archivedAt ? note : null;
  }

  private copyNote(title: string, collectionId: string | null, copy: StoredContentFields): MemoryNote {
    const content: NoteContent = { versionId: randomUUID(), version: 1, ...copy };
    const id = randomUUID();
    this.addNote({ id, title, collectionId, content: () => content });
    return this.notes.get(id) as MemoryNote;
  }

  private subtree(collectionId: string): PrivateCollectionSubtree {
    const ids = [collectionId];
    for (let index = 0; index < ids.length; index += 1) {
      for (const collection of this.collections.values()) {
        if (collection.parentId === ids[index] && this.isActiveCollection(collection.id)) ids.push(collection.id);
      }
    }
    const collections = ids.map((id) => collectionView(this.collections.get(id) as MemoryCollection));
    const notes = [...this.notes.values()].filter((note) => note.collectionId && ids.includes(note.collectionId)
      && !this.hidden(note.id) && !note.archivedAt).map(source);
    return { root: collections[0] as PrivateCollection, collections, notes };
  }

  private batch(batchId: string) {
    return {
      notes: [...this.notes.values()].filter((note) => note.batchId === batchId && note.status === "ACTIVE"),
      collections: [...this.collections.values()].filter((collection) => collection.batchId === batchId && collection.status === "ACTIVE"),
    };
  }

  private entries(): PrivateTrashEntry[] {
    const batchIds = new Set([...this.notes.values(), ...this.collections.values()]
      .filter((item) => item.status === "ACTIVE" && item.batchId).map((item) => item.batchId as string));
    return [...batchIds].map((batchId) => {
      const { notes, collections } = this.batch(batchId);
      const inBatch = new Set(collections.map((collection) => collection.id));
      const rootCollection = collections.find((collection) => !collection.parentId || !inBatch.has(collection.parentId));
      const rootNote = rootCollection ? undefined : notes[0];
      const parentId = rootCollection ? rootCollection.parentId : rootNote?.collectionId ?? null;
      const parent = parentId ? this.collections.get(parentId) : undefined;
      const root = (rootCollection ?? rootNote) as MemoryCollection | MemoryNote;
      return {
        batchId, kind: rootCollection ? "collection" as const : "note" as const, id: root.id, title: root.title,
        fromCollectionTitle: parent?.status === "ACTIVE" ? parent.title : null,
        itemCount: notes.length + collections.length, trashedAt: root.trashedAt as Date,
      };
    }).sort((left, right) => right.trashedAt.getTime() - left.trashedAt.getTime());
  }
}

function collectionView(collection: MemoryCollection): PrivateCollection {
  return { id: collection.id, title: collection.title, parentId: collection.parentId, favoritedAt: collection.favoritedAt,
    createdAt: collection.createdAt, updatedAt: collection.updatedAt };
}

function source(note: MemoryNote): PrivateNoteSource {
  const content = note.content();
  return { id: note.id, title: note.title, collectionId: note.collectionId, versionId: content.versionId,
    sourceUri: content.sourceUri, mimeType: content.mimeType, contentHash: content.contentHash };
}
