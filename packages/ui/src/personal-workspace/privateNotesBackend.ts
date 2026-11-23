import type { Platform, PrivateCollection, PrivateNote } from "../shared/types";
import { ApiError } from "../shared/api-client";
import * as api from "../shared/private-workspace-api";
import type { PrivateCollectionRecord, PrivateNoteRecord, PrivateNoteSummary, PrivateTrashEntry } from "../shared/private-workspace-api";
import { itemSubtree, UNTITLED_COLLECTION, UNTITLED_NOTE, type TreeItemRef } from "./privateNotesModel";

/** A loaded note plus the content version its next edit must be based on. */
export type LoadedNote = PrivateNote & { version: number };
export type NotePlacement = { id: string; collectionId: string | null; favoritedAt: string | null };

/**
 * Every Private Notes operation, served either by the Core API or by the in-memory demo.
 * Both return the same shapes so the hook applies results the same way.
 */
export interface PrivateNotesBackend {
  readonly kind: "server" | "demo";
  load(): Promise<{ notes: LoadedNote[]; collections: PrivateCollection[]; trash: PrivateTrashEntry[] }>;
  loadTrash(): Promise<PrivateTrashEntry[]>;
  createNote(input: { title: string; body: string; collectionId: string | null }): Promise<LoadedNote>;
  updateNote(id: string, version: number, input: { title: string; body: string }): Promise<LoadedNote>;
  createCollection(title: string, parentId: string | null): Promise<PrivateCollection>;
  updateCollection(id: string, input: { title?: string; parentId?: string | null }): Promise<PrivateCollection>;
  moveNote(id: string, collectionId: string | null): Promise<NotePlacement>;
  favoriteNote(id: string, favorite: boolean): Promise<NotePlacement>;
  favoriteCollection(id: string, favorite: boolean): Promise<PrivateCollection>;
  duplicateNote(id: string): Promise<LoadedNote>;
  duplicateCollection(id: string): Promise<{ collection: PrivateCollection; collections: PrivateCollection[]; notes: LoadedNote[] }>;
  trash(item: TreeItemRef): Promise<PrivateTrashEntry>;
  restore(batchId: string): Promise<{ collections: PrivateCollection[]; notes: LoadedNote[] }>;
  purge(batchId: string): Promise<void>;
}

const toCollection = (record: PrivateCollectionRecord): PrivateCollection => ({
  id: record.id, title: record.title, parentId: record.parentId ?? null, favoritedAt: record.favoritedAt ?? null,
});

function toNote(record: PrivateNoteRecord): LoadedNote {
  return {
    id: record.id, title: record.title, body: record.body,
    updatedLabel: `Saved ${new Date(record.updatedAt).toLocaleString()}`,
    sourceVersionId: record.currentVersion.id, version: record.currentVersion.version,
    collectionId: record.collectionId ?? null, favoritedAt: record.favoritedAt ?? null,
  };
}

const toPlacement = (summary: PrivateNoteSummary): NotePlacement => ({
  id: summary.id, collectionId: summary.collectionId ?? null, favoritedAt: summary.favoritedAt ?? null,
});

export function createServerBackend(platform: Platform, organizationId: string): PrivateNotesBackend {
  /** Summaries carry no body; read each note, a few at a time. */
  const loadBodies = async (ids: string[]) => {
    const loaded: LoadedNote[] = [];
    for (let offset = 0; offset < ids.length; offset += 6) {
      loaded.push(...await Promise.all(ids.slice(offset, offset + 6)
        .map(async (id) => toNote(await api.loadPrivateNote(platform, organizationId, id)))));
    }
    return loaded;
  };
  return {
    kind: "server",
    async load() {
      const summaries: PrivateNoteSummary[] = [];
      let cursor: string | null = null;
      do {
        const page = await api.listPrivateNotes(platform, organizationId, cursor);
        summaries.push(...page.items);
        cursor = page.nextCursor;
      } while (cursor);
      const [collections, trash, notes] = await Promise.all([
        api.listPrivateCollections(platform, organizationId),
        api.listPrivateTrash(platform, organizationId),
        loadBodies(summaries.map((item) => item.id)),
      ]);
      return { notes, collections: collections.map(toCollection), trash };
    },
    loadTrash: () => api.listPrivateTrash(platform, organizationId),
    async createNote(input) { return toNote(await api.createPrivateNote(platform, organizationId, input)); },
    async updateNote(id, version, input) { return toNote(await api.updatePrivateNote(platform, organizationId, id, version, input)); },
    async createCollection(title, parentId) { return toCollection(await api.createPrivateCollection(platform, organizationId, { title, parentId })); },
    async updateCollection(id, input) { return toCollection(await api.updatePrivateCollection(platform, organizationId, id, input)); },
    async moveNote(id, collectionId) { return toPlacement(await api.movePrivateNote(platform, organizationId, id, collectionId)); },
    async favoriteNote(id, favorite) { return toPlacement(await api.setPrivateNoteFavorite(platform, organizationId, id, favorite)); },
    async favoriteCollection(id, favorite) { return toCollection(await api.setPrivateCollectionFavorite(platform, organizationId, id, favorite)); },
    async duplicateNote(id) { return toNote(await api.duplicatePrivateNote(platform, organizationId, id)); },
    async duplicateCollection(id) {
      const result = await api.duplicatePrivateCollection(platform, organizationId, id);
      return { collection: toCollection(result.collection), collections: result.collections.map(toCollection),
        notes: await loadBodies(result.notes.map((note) => note.id)) };
    },
    trash: (item) => item.kind === "note"
      ? api.trashPrivateNote(platform, organizationId, item.id)
      : api.trashPrivateCollection(platform, organizationId, item.id),
    async restore(batchId) {
      const result = await api.restorePrivateTrash(platform, organizationId, batchId);
      return { collections: result.collections.map(toCollection), notes: await loadBodies(result.notes.map((note) => note.id)) };
    },
    purge: (batchId) => api.purgePrivateTrash(platform, organizationId, batchId),
  };
}

type DemoBatch = { entry: PrivateTrashEntry; notes: LoadedNote[]; collections: PrivateCollection[] };
const TRASH_RETENTION_MS = 30 * 86_400_000;

/**
 * In-memory stand-in used by the sign-in Demo and `?preview=1`. Nothing leaves this
 * browser tab or is written to storage; refreshing or exiting clears it (DESIGN.md private-note contract).
 */
export function createDemoBackend(seed: { notes: PrivateNote[]; collections: PrivateCollection[] }, now: () => Date = () => new Date()): PrivateNotesBackend {
  let notes: LoadedNote[] = seed.notes.map((note) => ({ ...note, version: 1, collectionId: note.collectionId ?? null, favoritedAt: note.favoritedAt ?? null }));
  let collections: PrivateCollection[] = seed.collections.map((collection) => ({ ...collection }));
  const batches = new Map<string, DemoBatch>();
  const newId = () => `preview-${crypto.randomUUID()}`;
  const stamp = () => now().toISOString();
  const missing = () => Promise.reject(new ApiError(404, "This item is no longer available.", "NOT_FOUND"));
  const findNote = (id: string) => notes.find((note) => note.id === id);
  const findCollection = (id: string) => collections.find((collection) => collection.id === id);
  const placement = (note: LoadedNote): NotePlacement => ({ id: note.id, collectionId: note.collectionId ?? null, favoritedAt: note.favoritedAt ?? null });
  const copyNote = (note: LoadedNote, collectionId: string | null, title: string): LoadedNote =>
    ({ ...note, id: newId(), title, collectionId, favoritedAt: null, version: 1, sourceVersionId: undefined, updatedLabel: "Saved in this preview" });

  return {
    kind: "demo",
    async load() { return { notes: notes.map((note) => ({ ...note })), collections: [...collections], trash: [...batches.values()].map((batch) => batch.entry).reverse() }; },
    async loadTrash() { return [...batches.values()].map((batch) => batch.entry).reverse(); },
    async createNote(input) {
      if (input.collectionId && !findCollection(input.collectionId)) return missing();
      const note: LoadedNote = { id: newId(), title: input.title.trim() || UNTITLED_NOTE, body: input.body, updatedLabel: "Saved in this preview",
        version: 1, collectionId: input.collectionId, favoritedAt: null };
      notes = [note, ...notes];
      return { ...note };
    },
    async updateNote(id, version, input) {
      const note = findNote(id);
      if (!note) return missing();
      if (note.version !== version) return Promise.reject(new ApiError(409, "This note has changed.", "VERSION_CONFLICT"));
      const updated = { ...note, title: input.title.trim() || UNTITLED_NOTE, body: input.body, version: note.version + 1, updatedLabel: "Saved in this preview" };
      notes = notes.map((entry) => entry.id === id ? updated : entry);
      return { ...updated };
    },
    async createCollection(title, parentId) {
      if (parentId && !findCollection(parentId)) return missing();
      const collection: PrivateCollection = { id: newId(), title: title.trim() || UNTITLED_COLLECTION, parentId, favoritedAt: null };
      collections = [...collections, collection];
      return { ...collection };
    },
    async updateCollection(id, input) {
      const collection = findCollection(id);
      if (!collection) return missing();
      if (input.parentId !== undefined && input.parentId !== null) {
        if (!findCollection(input.parentId)) return missing();
        if (itemSubtree(collections, notes, { kind: "collection", id }).collectionIds.has(input.parentId)) {
          return Promise.reject(new ApiError(409, "Conflict", "COLLECTION_CYCLE"));
        }
      }
      const updated: PrivateCollection = { ...collection,
        ...(input.title !== undefined ? { title: input.title.trim() || UNTITLED_COLLECTION } : {}),
        ...(input.parentId !== undefined ? { parentId: input.parentId } : {}) };
      collections = collections.map((entry) => entry.id === id ? updated : entry);
      return { ...updated };
    },
    async moveNote(id, collectionId) {
      const note = findNote(id);
      if (!note || (collectionId && !findCollection(collectionId))) return missing();
      note.collectionId = collectionId;
      return placement(note);
    },
    async favoriteNote(id, favorite) {
      const note = findNote(id);
      if (!note) return missing();
      note.favoritedAt = favorite ? note.favoritedAt ?? stamp() : null;
      return placement(note);
    },
    async favoriteCollection(id, favorite) {
      const collection = findCollection(id);
      if (!collection) return missing();
      const updated = { ...collection, favoritedAt: favorite ? collection.favoritedAt ?? stamp() : null };
      collections = collections.map((entry) => entry.id === id ? updated : entry);
      return { ...updated };
    },
    async duplicateNote(id) {
      const note = findNote(id);
      if (!note) return missing();
      const copy = copyNote(note, note.collectionId ?? null, `${note.title} (copy)`);
      notes = [copy, ...notes];
      return { ...copy };
    },
    async duplicateCollection(id) {
      const root = findCollection(id);
      if (!root) return missing();
      const subtree = itemSubtree(collections, notes, { kind: "collection", id });
      const ids = new Map([...subtree.collectionIds].map((source) => [source, newId()]));
      const copiedCollections = collections.filter((collection) => subtree.collectionIds.has(collection.id)).map((collection) => ({
        ...collection, id: ids.get(collection.id)!, favoritedAt: null,
        title: collection.id === id ? `${collection.title} (copy)` : collection.title,
        parentId: collection.id === id ? collection.parentId : ids.get(collection.parentId!) ?? null,
      }));
      const copiedNotes = notes.filter((note) => subtree.noteIds.has(note.id))
        .map((note) => copyNote(note, ids.get(note.collectionId!) ?? null, note.title));
      collections = [...collections, ...copiedCollections];
      notes = [...copiedNotes, ...notes];
      return { collection: copiedCollections.find((collection) => collection.id === ids.get(id))!, collections: copiedCollections, notes: copiedNotes };
    },
    async trash(item) {
      const source = item.kind === "note" ? findNote(item.id) : findCollection(item.id);
      if (!source) return missing();
      const subtree = itemSubtree(collections, notes, item);
      const parentId = item.kind === "note" ? (source as LoadedNote).collectionId ?? null : (source as PrivateCollection).parentId;
      const trashedAt = now();
      const entry: PrivateTrashEntry = {
        batchId: newId(), kind: item.kind, id: item.id,
        title: source.title || (item.kind === "note" ? UNTITLED_NOTE : UNTITLED_COLLECTION),
        fromCollectionTitle: parentId ? findCollection(parentId)?.title ?? null : null,
        itemCount: subtree.noteIds.size + subtree.collectionIds.size,
        trashedAt: trashedAt.toISOString(), purgeAfter: new Date(trashedAt.getTime() + TRASH_RETENTION_MS).toISOString(),
      };
      batches.set(entry.batchId, {
        entry,
        notes: notes.filter((note) => subtree.noteIds.has(note.id)),
        collections: collections.filter((collection) => subtree.collectionIds.has(collection.id)),
      });
      notes = notes.filter((note) => !subtree.noteIds.has(note.id));
      collections = collections.filter((collection) => !subtree.collectionIds.has(collection.id));
      return { ...entry };
    },
    async restore(batchId) {
      const batch = batches.get(batchId);
      if (!batch) return missing();
      batches.delete(batchId);
      // The batch root returns to its original parent only while that collection is still active.
      const rootParentGone = (parentId: string | null | undefined) => Boolean(parentId && !findCollection(parentId));
      const restoredCollections = batch.collections.map((collection) => collection.id === batch.entry.id && rootParentGone(collection.parentId)
        ? { ...collection, parentId: null } : collection);
      const restoredNotes = batch.notes.map((note) => note.id === batch.entry.id && rootParentGone(note.collectionId)
        ? { ...note, collectionId: null } : note);
      collections = [...collections, ...restoredCollections];
      notes = [...restoredNotes, ...notes];
      return { collections: restoredCollections, notes: restoredNotes.map((note) => ({ ...note })) };
    },
    async purge(batchId) {
      if (!batches.delete(batchId)) return missing();
    },
  };
}
