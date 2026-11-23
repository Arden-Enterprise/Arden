import type { PrivateCollection, PrivateNote } from "../shared/types";

/** Pure tree helpers for the Private Notes sidebar (ADR 0029). Collections come before notes at every level. */
export type TreeItemRef = { kind: "note" | "collection"; id: string };
export type TreeItem =
  | { kind: "collection"; id: string; title: string; parentId: string | null; favoritedAt: string | null; collection: PrivateCollection }
  | { kind: "note"; id: string; title: string; parentId: string | null; favoritedAt: string | null; note: PrivateNote };

export const ROOT_LABEL = "Private Notes";
export const UNTITLED_COLLECTION = "Untitled collection";
export const UNTITLED_NOTE = "Untitled private note";

/** Collections are listed by title so a restored or duplicated collection lands in a predictable place. */
export function sortCollections(collections: PrivateCollection[]): PrivateCollection[] {
  return [...collections].sort((left, right) => (left.title || UNTITLED_COLLECTION).localeCompare(right.title || UNTITLED_COLLECTION));
}

export function collectionItem(collection: PrivateCollection): TreeItem {
  return { kind: "collection", id: collection.id, title: collection.title || UNTITLED_COLLECTION, parentId: collection.parentId,
    favoritedAt: collection.favoritedAt, collection };
}

export function noteItem(note: PrivateNote, collections: PrivateCollection[], title = note.title): TreeItem {
  return { kind: "note", id: note.id, title: title.trim() || UNTITLED_NOTE, parentId: placementOf(note, collections),
    favoritedAt: note.favoritedAt ?? null, note };
}

/** A note whose collection is no longer loaded is shown at the root rather than disappearing. */
export function placementOf(note: PrivateNote, collections: PrivateCollection[]): string | null {
  const id = note.collectionId ?? null;
  return id && collections.some((collection) => collection.id === id) ? id : null;
}

/**
 * Order of notes inside one container, as the API orders them (spec F03-ARR): notes never placed by the
 * owner come first, newest first (a never-saved note counts as newest), then placed notes by position.
 * Ties keep the incoming order.
 */
export function compareNotes(left: PrivateNote, right: PrivateNote): number {
  const leftPosition = left.position ?? null;
  const rightPosition = right.position ?? null;
  if (leftPosition === null && rightPosition !== null) return -1;
  if (leftPosition !== null && rightPosition === null) return 1;
  if (leftPosition !== null && rightPosition !== null && leftPosition !== rightPosition) return leftPosition - rightPosition;
  const leftCreated = left.createdAt ?? "￿";
  const rightCreated = right.createdAt ?? "￿";
  return leftCreated > rightCreated ? -1 : leftCreated < rightCreated ? 1 : 0;
}

/** The notes shown directly inside a collection (or the root when null), in display order. */
export function notesIn(collections: PrivateCollection[], notes: PrivateNote[], parentId: string | null): PrivateNote[] {
  return notes.filter((note) => placementOf(note, collections) === parentId).sort(compareNotes);
}

export function childrenOf(collections: PrivateCollection[], notes: PrivateNote[], parentId: string | null,
  titleOf: (note: PrivateNote) => string = (note) => note.title): TreeItem[] {
  return [
    ...sortCollections(collections.filter((collection) => collection.parentId === parentId)).map(collectionItem),
    ...notesIn(collections, notes, parentId).map((note) => noteItem(note, collections, titleOf(note))),
  ];
}

/**
 * Places a note at `index` among the notes of `parentId` (null appends it last) and renumbers that
 * container from 1, exactly as `PUT /drafts/:id/collection` does on the server. Returns only changed notes.
 */
export function placeNote(collections: PrivateCollection[], notes: PrivateNote[], noteId: string, parentId: string | null,
  index: number | null): PrivateNote[] {
  const moving = notes.find((note) => note.id === noteId);
  if (!moving) return [];
  const order = notesIn(collections, notes, parentId).filter((note) => note.id !== noteId);
  order.splice(Math.min(index ?? order.length, order.length), 0, moving);
  const changed: PrivateNote[] = [];
  order.forEach((note, offset) => {
    const position = offset + 1;
    if (note.id === noteId) changed.push({ ...note, collectionId: parentId, position });
    else if (note.position !== position) changed.push({ ...note, position });
  });
  return changed;
}

/**
 * The index to send to the server for a drop at `index` among the displayed notes of a container:
 * never-saved notes exist only in this browser, so they are not counted.
 */
export function serverIndex(displayed: PrivateNote[], index: number, isLocal: (note: PrivateNote) => boolean): number {
  return displayed.slice(0, index).filter((note) => !isLocal(note)).length;
}

/** The collection and every collection nested inside it. */
export function collectionSubtree(collections: PrivateCollection[], rootId: string): Set<string> {
  const ids = new Set([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const collection of collections) {
      if (collection.parentId && ids.has(collection.parentId) && !ids.has(collection.id)) {
        ids.add(collection.id);
        grew = true;
      }
    }
  }
  return ids;
}

/** Everything that moves to trash (or is duplicated) together with the given item. */
export function itemSubtree(collections: PrivateCollection[], notes: PrivateNote[], item: TreeItemRef) {
  if (item.kind === "note") return { collectionIds: new Set<string>(), noteIds: new Set([item.id]) };
  const collectionIds = collectionSubtree(collections, item.id);
  const noteIds = new Set(notes.filter((note) => note.collectionId && collectionIds.has(note.collectionId)).map((note) => note.id));
  return { collectionIds, noteIds };
}

export type MoveDestination = { id: string | null; title: string; depth: number; current: boolean };

/** Root plus active collections in tree order; a collection cannot move into itself or its descendants. */
export function moveDestinations(collections: PrivateCollection[], item: TreeItemRef & { parentId: string | null }): MoveDestination[] {
  const excluded = item.kind === "collection" ? collectionSubtree(collections, item.id) : new Set<string>();
  const result: MoveDestination[] = [{ id: null, title: ROOT_LABEL, depth: 0, current: item.parentId === null }];
  const walk = (parentId: string | null, depth: number) => {
    for (const collection of sortCollections(collections.filter((entry) => entry.parentId === parentId))) {
      if (excluded.has(collection.id)) continue;
      result.push({ id: collection.id, title: collection.title || UNTITLED_COLLECTION, depth, current: item.parentId === collection.id });
      walk(collection.id, depth + 1);
    }
  };
  walk(null, 1);
  return result;
}

/** Favorited collections and notes, oldest favorite first. */
export function favoriteItems(collections: PrivateCollection[], notes: PrivateNote[], titleOf: (note: PrivateNote) => string = (note) => note.title): TreeItem[] {
  return [
    ...collections.filter((collection) => collection.favoritedAt).map(collectionItem),
    ...notes.filter((note) => note.favoritedAt).map((note) => noteItem(note, collections, titleOf(note))),
  ].sort((left, right) => (left.favoritedAt ?? "").localeCompare(right.favoritedAt ?? ""));
}

/** Titles of the collections containing an item, outermost first. */
export function ancestorsOf(collections: PrivateCollection[], parentId: string | null): PrivateCollection[] {
  const path: PrivateCollection[] = [];
  const seen = new Set<string>();
  let current = parentId ? collections.find((collection) => collection.id === parentId) : undefined;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.unshift(current);
    current = current.parentId ? collections.find((collection) => collection.id === current!.parentId) : undefined;
  }
  return path;
}

export type ArchiveSort = "archived" | "updated" | "title";
export type ArchiveGroup<T> = { key: string; collectionId: string | null; title: string; items: T[] };
type ArchivedLike = { id: string; title: string; collectionId: string | null; collectionTitle: string | null; archivedAt: string; updatedAt: string };

/**
 * The Archived view (spec F03-ARR): case-insensitive title search, then one group per original
 * collection (root last), each sorted by the chosen order. Groups follow their first item's order.
 */
export function arrangeArchived<T extends ArchivedLike>(items: T[], query: string, sort: ArchiveSort): ArchiveGroup<T>[] {
  const needle = query.trim().toLocaleLowerCase();
  const matching = needle ? items.filter((item) => (item.title || UNTITLED_NOTE).toLocaleLowerCase().includes(needle)) : [...items];
  const compare = (left: T, right: T) => sort === "title"
    ? (left.title || UNTITLED_NOTE).localeCompare(right.title || UNTITLED_NOTE)
    : sort === "updated" ? right.updatedAt.localeCompare(left.updatedAt) : right.archivedAt.localeCompare(left.archivedAt);
  const groups = new Map<string, ArchiveGroup<T>>();
  for (const item of matching.sort(compare)) {
    const key = item.collectionId ?? "";
    const group = groups.get(key) ?? { key, collectionId: item.collectionId, title: item.collectionTitle || ROOT_LABEL, items: [] };
    group.items.push(item);
    groups.set(key, group);
  }
  return [...groups.values()].sort((left, right) => Number(left.collectionId === null) - Number(right.collectionId === null));
}

export function daysUntil(isoDate: string, now = Date.now()): number {
  const time = Date.parse(isoDate);
  if (!Number.isFinite(time)) return 0;
  return Math.max(0, Math.ceil((time - now) / 86_400_000));
}
