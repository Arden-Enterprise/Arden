# 0031: Private notes keep one live version; contribution seals it

Status: accepted
Date: 2026-11-24
Decision owner/approval: requesting project maintainer. In the implementation session on 2026-11-24 the maintainer was shown that every save of a private note adds an immutable `draft_version` row and content object (decision 0002), was given four options with their trade-offs (keep, working copy + snapshots, coalesce versions, prune old versions) and the recommendation to consult the team, and answered "vậy thay đổi đi, note thì không cần lưu draft chứ" ("then change it; a note does not need to keep drafts"). Team consultation: not recorded.
Brainstorm originator / record author: maintainer request; record drafted by the coding agent.
Approval evidence and exact source revision: maintainer answer above, against `origin/staging` d47ddc5 plus the unmerged F03-ARR branch `feat/private-notes-arrange-archive`.
Implementation: branch `feat/private-notes-arrange-archive` (not merged, not deployed). Migration `0065_private_note_live_version.sql`, spec F03-SAVE.
Supersedes / superseded by: supersedes the part of [0002](0002-first-slice-private-notes-contract.md) that makes **every** private-note save an immutable version. Owner-only access, `ETag`/`If-Match` concurrency, protected private storage and the decision 0029 trash/tombstone rules are unchanged.

## Context

Autosave was requested. Under 0002 each save writes a new content object and a `draft_version` row that can never be changed or deleted, so autosave would leave hundreds of versions per writing session. No product path reads a private note's history. Review drafts (`shared_draft.source_private_version_id`) and legacy `shared_submission.draft_version_id` must keep pointing at the exact content that was contributed.

## Decision

- A private note has at most one **open** version: its current one. A save (body, title, rename, autosave) overwrites that version's content reference and raises its version number; the replaced content object is erased after commit unless another version still uses it.
- Creating a review draft from a note **seals** the contributed version (`draft_version.sealed_at`). A sealed version is immutable; the next save of that note creates a new open version.
- Migration seals every existing version except each live note's unreferenced current version, so earlier history stays exactly as it was. No rows or objects are deleted by the migration.
- The `draft_version` trigger now rejects every delete, every change to a sealed version, any identity change, and any content change to a version referenced by a review draft or legacy submission. The runtime gets column-level `UPDATE` on the version number, content reference and `sealed_at` only.
- The note's `ETag` stays the version number, so stale saves still get `412 VERSION_CONFLICT`.

## Consequences

- Autosave becomes cheap: one live content object per note, plus one per contribution.
- Private notes no longer have a save history. Restoring an earlier wording is not possible unless it was contributed.
- Operations that compared version ids to detect concurrent edits (duplicate) also compare content hashes.
- New `SECURITY INVOKER` trigger function; the `SECURITY DEFINER` inventory is unchanged.
