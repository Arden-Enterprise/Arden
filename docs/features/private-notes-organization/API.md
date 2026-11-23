# Private notes organization — API contract

Owner: [ADR 0029](../../decisions/0029-private-notes-organization-and-trash.md), spec F03-ORG in [identity and access](../../product/identity-and-access.md#f03-org-collections-favorites-and-trash). Base: `origin/staging` 990ee1c.

All routes are under `/api/v1/organizations/:organizationId/private-workspace`. They use the existing actor resolution, owner-only RLS (`actor_owns_private_membership`) and return the existing non-enumerating `404` (error code `RESOURCE_NOT_AVAILABLE`) for anything the caller does not own, for trashed items (except trash routes) and for purged items. JSON bodies use the existing inline Fastify schema style. Timestamps are ISO-8601 strings.

## Shapes

```ts
type NoteSummary = {            // GET /drafts list item (extended, existing fields kept)
  id: string; organizationId: string; title: string;
  currentVersion: { id: string; version: number; mimeType: string; contentHash: string };
  createdAt: string; updatedAt: string;
  collectionId: string | null;  // NEW
  favoritedAt: string | null;   // NEW
};
type Note = NoteSummary & { body: string; version: number };  // GET /drafts/:id (existing + NEW fields)

type Collection = {
  id: string; title: string; parentId: string | null;
  favoritedAt: string | null; createdAt: string; updatedAt: string;
};

type TrashEntry = {
  batchId: string; kind: "note" | "collection"; id: string; title: string;
  fromCollectionTitle: string | null;   // null = workspace root
  itemCount: number;                     // root + descendants in the batch
  trashedAt: string; purgeAfter: string; // trashedAt + 30 days
};
```

## Routes

Existing routes keep their behaviour; list and get add `collectionId` and `favoritedAt` and exclude trashed/purged notes. `POST /drafts` accepts optional `collectionId` (must be an active collection of the caller, else 404).

| Method | Path | Body | Success |
| --- | --- | --- | --- |
| GET | `/collections` | — | 200 `{ items: Collection[] }` (all active, unpaginated; cap 1,000) |
| POST | `/collections` | `{ title: string(1–200), parentId?: string \| null }` | 201 `Collection` |
| PATCH | `/collections/:id` | `{ title?, parentId? }` (minProperties 1) | 200 `Collection`; 409 `COLLECTION_CYCLE` when moving into itself/descendant |
| PUT | `/drafts/:id/collection` | `{ collectionId: string \| null }` | 200 `NoteSummary` |
| PUT | `/drafts/:id/favorite` | `{ favorite: boolean }` | 200 `NoteSummary` |
| PUT | `/collections/:id/favorite` | `{ favorite: boolean }` | 200 `Collection` |
| POST | `/drafts/:id/duplicate` | — | 201 `Note` (title `"<title> (copy)"`, same collection, new content object) |
| POST | `/collections/:id/duplicate` | — | 201 `{ collection: Collection, collections: Collection[], notes: NoteSummary[] }` (whole copied subtree) |
| POST | `/drafts/:id/trash` | — | 200 `TrashEntry` |
| POST | `/collections/:id/trash` | — | 200 `TrashEntry` (whole subtree in one batch) |
| GET | `/trash` | — | 200 `{ items: TrashEntry[] }` newest first |
| POST | `/trash/:batchId/restore` | — | 200 `{ collections: Collection[], notes: NoteSummary[] }` restored items |
| POST | `/trash/:batchId/purge` | — | 204 |

Rename of a note keeps using `PATCH /drafts/:id` with `If-Match` (creates a new version). Placement, favorite, trash and restore are not content versions and do not require `If-Match`; they are idempotent where it makes sense (favorite twice = same state).

## Rules

- A collection title is trimmed; empty becomes `"Untitled collection"`.
- A workspace holds at most 1,000 active collections. Creating, duplicating or restoring past that returns 409 `COLLECTION_LIMIT_REACHED`. Duplicating one collection is also capped at 500 notes / 1,000 collections (409 `COLLECTION_TOO_LARGE`); a tree changed during the copy returns 409 `PRIVATE_TREE_CHANGED`.
- `GET /drafts` list items return `currentVersion` as the object above (it was a number before this change; the shipped UI reads only `id` from list items).
- Retention-job purges are logged as counts only (the job has no organization context); manual purges are audited.
- Moving a note into a trashed collection, or creating a collection under one, returns 404.
- Trashing an item that is already in trash returns 404.
- Restore: the batch root returns to its original parent if that collection is active, otherwise to the root. Descendants keep their relations.
- Purge (manual or the 30-day job): delete every private-storage content object of the affected note versions, set note and collection titles to `''`, status `PURGED`, keep rows. The job runs in-process every hour and purges batches with `trashed_at < now() - interval '30 days'`.
- Audit events: `PRIVATE_COLLECTION_CREATED/UPDATED`, `PRIVATE_ITEM_TRASHED/RESTORED/PURGED`, `PRIVATE_DRAFT_DUPLICATED`. Audit payloads must not contain titles or content.
- Desktop `apiRequestPolicy` allows exactly these paths and methods (GET/POST/PATCH/PUT); no DELETE method is introduced.
