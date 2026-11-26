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
| POST | `/drafts/:id/questions` | `{ requestId: UUID, query: string, expectedVersion: positive integer }` | 200 answer with verified excerpts from the requested saved note, or an insufficient-evidence result |

Private note questions require an active owner, organization and membership. Archived and
trashed notes are unavailable. The route accepts one saved revision, reads its protected
text by hash, and checks access and revision before inference and again before returning.
A stale revision returns 409 `NOTE_CHANGED`. The handler sends bounded excerpts from
that note to the configured Arden-AI service and returns `Cache-Control: no-store`.
Recognized whole-note overview requests use the complete note within the evidence
budget or sample across a longer note. Other questions rank passages by relevance.
After inference, `noteCoverage` is `FULL` if the supplied evidence covers all
non-whitespace text in the saved revision, and `PARTIAL` if any was omitted.
Questions and replies are held only in the sidebar session. The route requires an
organization opt-in via `ARDEN_PRIVATE_NOTE_AI_ORGANIZATIONS`. See the
[AI context contract](../../engineering/knowledge-source-contexts.md).

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
- Audit events: only `PRIVATE_ITEM_PURGED` (permanent deletion), under [decision 0035](../../decisions/0035-audit-only-consequential-actions.md). Collection changes, duplicate, trash and restore are routine owner-only actions and are not audited. Audit payloads must not contain titles or content.
- Desktop `apiRequestPolicy` allows exactly these paths and methods (GET/POST/PATCH/PUT); no DELETE method is introduced.

## Spec F03-ARR: order and archive

Owner: spec [F03-ARR](../../product/identity-and-access.md#f03-arr-note-order-in-place-collection-titles-and-archive). Base: `origin/staging` d47ddc5. Migration `0064_private_notes_order_and_archive.sql` adds `draft_document.sort_position` and `draft_document.archived_at`.

Note summaries (`GET /drafts` items, placement/favorite/archive responses) add `position: number | null` and `archivedAt: string | null`; `GET /drafts/:id` adds `position`. Notes inside one collection (or the root) are ordered: `position` null first (newest first), then ascending `position`.

```ts
type ArchivedNote = {
  id: string; title: string;
  collectionId: string | null;     // where Unarchive returns it; null = root or that collection is gone
  collectionTitle: string | null;
  archivedAt: string; createdAt: string; updatedAt: string;
};
```

| Method | Path | Body | Success |
| --- | --- | --- | --- |
| PUT | `/drafts/:id/collection` | `{ collectionId: string \| null, index?: integer 0–1,000,000 }` | 200 `NoteSummary`. With `index` the note is placed at that 0-based position of the destination (clamped to the end); without it the note goes last. The destination is renumbered from 1. |
| PUT | `/drafts/:id/archive` | `{ archived: boolean }` | 200 `NoteSummary`; idempotent. Unarchive returns the note to its collection while it is active, otherwise to the root, with `position` null. |
| GET | `/archive` | — | 200 `{ items: ArchivedNote[], hasMore: boolean }`, newest archive first, at most 1,000 items. |

Rules:

- Archived notes are excluded from `GET /drafts`, favorites, placement, duplicate and collection subtrees (collection duplicate/trash). Trashing a collection leaves its archived notes archived. `POST /drafts/:id/trash` also accepts an archived note and clears the archive flag. A database check forbids a note being archived and in trash at once.
- Placement (`collection_id`, `sort_position`) and `archived_at` changes do not update `updated_at`; content edits, favorites and trash keep their previous behaviour.
- Archive and unarchive are not audited ([decision 0035](../../decisions/0035-audit-only-consequential-actions.md)).
- Other members, Org Admins and System Admins get the existing non-enumerating 404 for every route above and an empty archive list. The desktop allow-list adds exactly `PUT /drafts/:id/archive` and `GET /archive`.

## Decision 0031: saving a note

`PATCH /drafts/:id` keeps its request, `If-Match` and response shape. The note's open current version is overwritten (same `currentVersion.id`, higher `version`), and the replaced content object is erased after commit. When the current version has been contributed (sealed), the save creates a new version with a new `currentVersion.id`. `POST /knowledge/drafts` from a private version seals that version. Clients that compare version ids to detect changes must also compare `currentVersion.contentHash`.

## Decision 0034: private PDF items (spec F03-FILE)

A PDF item is a private draft whose current version has `mimeType` `application/pdf`. Summaries and records carry `kind: "pdf"`; records also carry `textAvailable` and an empty `body`. The file is never part of a list, save or summary response.

| Method | Path | Body | Success |
| --- | --- | --- | --- |
| POST | `/drafts/pdf` | `{ title, pdfBase64, text?, collectionId? }` | 201 record with `kind: "pdf"`. `pdfBase64` is a canonical PDF of at most 5 MB (`%PDF-` header and `%%EOF` trailer); `text` is what the browser extracted (at most 100,000 UTF-8 bytes; blank for a scan). |
| GET | `/drafts/:id/pdf` | — | 200 `{ id, version, contentHash, pdfBase64 }`, `Cache-Control: no-store`. 404 for a text note. |
| PUT | `/drafts/:id/pdf` | `{ pdfBase64, text?, title? }` with `If-Match` | 200 record. Overwrites the open version under decision 0031 and erases the replaced file and text objects; a contributed version is kept and a new open version is created. 409 `NOT_A_PDF_ITEM` for a text note, 412 on a stale version. |

Rules:

- `PATCH /drafts/:id` renames a PDF item; a `body` returns 409 `PDF_ITEM_NOT_EDITABLE`. A text note never takes a PDF file.
- Invalid or oversized uploads return 400 `INVALID_PDF` and store nothing. The file and its text object are written to protected private storage and served only through these owner-checked routes; there is no public URL.
- Duplicate copies the file and its text. Trash, restore and the 30-day purge treat PDF items like notes; purge erases the file and the text object.
- `POST /knowledge/drafts` from a PDF item's version creates a shared PDF draft holding a copy of the file and seals the version (migration 0069 keeps the sealed version's text immutable too).
- The private AI side panel answers a PDF item from its extracted text; a PDF without text returns 422 `DOCUMENT_QUESTION_UNSUPPORTED`.
- The desktop allow-list adds exactly `POST /drafts/pdf`, `GET /drafts/:id/pdf` and `PUT /drafts/:id/pdf` (with `If-Match`), with the 7.1 MB PDF body and response limits.

## Decision 0034: sharing with people (spec F03-SHR)

| Method | Path | Body | Success |
| --- | --- | --- | --- |
| GET | `/drafts/:id/shares` | — | 200 `{ enabled, recipientLimit, recipients: [{ shareId, membershipId, name, email, active, sharedAt }] }`, owner only. |
| POST | `/drafts/:id/shares` | `{ recipientMembershipIds: uuid[1..100] }` | 201 when someone was added, 200 when all already had access. 400 `INVALID_RECIPIENTS` (self, inactive or another organization), 409 `DIRECT_SHARE_LIMIT`, 409 `DIRECT_SHARING_DISABLED`. |
| POST | `/drafts/:id/shares/:shareId/revoke`, `/drafts/:id/shares/revoke-all` | — | 200 with the remaining recipients. |
| GET | `/api/v1/organizations/:organizationId/shared-with-me` | — | 200 `{ items: [{ id, title, kind, ownerName, sharedAt, updatedAt, reviewed: false }] }`, newest first, at most 200. |
| GET | `/api/v1/organizations/:organizationId/shared-with-me/:id` | — | 200 the item with `version` and the current text `body` (empty for a PDF). |
| GET | `/api/v1/organizations/:organizationId/shared-with-me/:id/pdf` | — | 200 `{ id, version, pdfBase64 }`. |
| GET / PUT | `/api/v1/organizations/:organizationId/direct-sharing` | PUT `{ enabled, recipientLimit: 1..100 }` | Every active member reads; only an Organization Admin writes (404 otherwise). |

Rules:

- Migration 0070 stores grants in `private_item_share` (revoke only, never delete) and the setting in `organization_direct_share_setting` (no row means enabled, 10 people).
- RLS gives a recipient SELECT on the shared item and its current version only, while the share is active, both members are active and sharing is on. Owner-only writes are unchanged.
- Moving an item to trash revokes its shares; restore does not share again. Purge keeps the revoked rows.
- Each new grant writes one `DOCUMENT_SHARED_DIRECT` notice (title and owner name, no content); Core shows its details only while the item is still shared with the reader.
- Audit events `PRIVATE_ITEM_SHARED`, `PRIVATE_ITEM_SHARE_REVOKED` and `DIRECT_SHARE_SETTINGS_UPDATED` carry identifiers and counts only.
- The desktop allow-list adds exactly these routes; the recipient PDF read has the 7.1 MB response limit.
