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

export function childrenOf(collections: PrivateCollection[], notes: PrivateNote[], parentId: string | null,
  titleOf: (note: PrivateNote) => string = (note) => note.title): TreeItem[] {
  return [
    ...sortCollections(collections.filter((collection) => collection.parentId === parentId)).map(collectionItem),
    ...notes.filter((note) => placementOf(note, collections) === parentId).map((note) => noteItem(note, collections, titleOf(note))),
  ];
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

export function daysUntil(isoDate: string, now = Date.now()): number {
  const time = Date.parse(isoDate);
  if (!Number.isFinite(time)) return 0;
  return Math.max(0, Math.ceil((time - now) / 86_400_000));
}
