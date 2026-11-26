# 0029: Private notes organization, favorites and 30-day trash

Status: accepted
Date: 2026-11-23
Decision owner/approval: requesting project maintainer. On 2026-11-23 the maintainer reviewed an interactive canvas prototype and asked for a Notion-style Private Notes tree with collections, favorites, a `···` action menu and a Trash reached from the account menu. They chose a 30-day trash retention when asked, and chose "erase content, keep a tombstone" over hard row deletion after the trade-off below was shown.
Brainstorm originator / record author: maintainer request; record drafted by the coding agent.
Approval evidence and exact source/spec revision: maintainer answers in the implementation session, against `origin/staging` 990ee1c. Linear ARD-83.
Implementation: branch `feat/private-notes-collections` (not merged, not deployed).
This extends [0002](0002-first-slice-private-notes-contract.md) with deletion and retention. Under [0034](0034-share-button-direct-share-and-private-pdf.md), Private supports PDF items and owners can share individual items. Trash revokes those shares permanently. Under [0035](0035-audit-only-consequential-actions.md), permanent deletion and share revocations are audited.

## Context and requirement

The capstone scope requires users to "organize personal knowledge collections". Private notes were a flat list in a second sidebar with no delete. Decision 0002 deferred deletion and retention.

## Options and tradeoffs for permanent deletion

| Option | Benefit | Cost |
| --- | --- | --- |
| Hard-delete note and version rows | Nothing left in the database | Needs DELETE grants, weakens the immutable-version trigger, and is blocked for versions contributed to shared drafts (`ON DELETE RESTRICT`) |
| **Erase content, keep a tombstone (accepted)** | No new DELETE grants; contributed-version provenance stays valid | A minimal row (ids, timestamps, content hashes) remains |

## Decision

- **Collections** are owner-private folders inside the owner's private workspace. They nest. A note belongs to at most one collection or to the root. Collections are never shared or readable by anyone else, including Org Admins and System Admins.
- **Favorites** are a per-item flag on notes and collections, shown in a Favorites section at the top of the sidebar tree. The item still lives in its collection.
- **Actions**: Add to/Remove from favorites, Duplicate, Rename, Move to, Move to trash, on rows and in the note header. Duplicating a note writes a new content object; duplicating a collection copies its whole subtree.
- **Trash**: moving an item to trash hides it and its subtree as one batch. Restore returns the batch; if the original parent collection is no longer active the root item returns to the workspace root. Trashed notes cannot be opened, edited or contributed.
- **Retention**: a server job permanently deletes trash batches older than **30 days**. Users can also delete a batch permanently at any time.
- **Permanent deletion** erases every content object of the affected note versions from private storage, clears titles, and marks the rows `PURGED`. Rows, ids, timestamps and content hashes remain as a tombstone so existing shared-draft provenance stays valid. Purged items never appear in any API response.

## Consequences

- New migration for collections and note organization columns; no new DELETE grants on existing tables.
- New private-workspace API routes and desktop request allow-list entries.
- An in-process purge loop in the API, following the existing background-loop pattern.
