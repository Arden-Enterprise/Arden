# 0035: Audit only consequential actions

Status: accepted
Date: 2026-11-26
Decision owner/approval: requesting project maintainer. On 2026-11-26 the maintainer asked to "record only the important audits", was shown that every autosave of a private note writes a `PRIVATE_DRAFT_UPDATED` row, three options (coalesce, drop all private audits, audit by consequence) and that this changes the audit line of decision 0002, and answered "làm theo hướng bạn đề xuất đi" ("do it the way you proposed").
Brainstorm originator / record author: maintainer request; record drafted by the coding agent.
Approval evidence and exact source revision: the maintainer answer above, against `origin/staging` a719509.
Consultation: the original author of decision 0002 was not asked; the record of that decision does not name who required per-save auditing, and its rationale cites only the general security direction. The maintainer resolved the change as project maintainer.
Implementation: branch `refactor/audit-policy` (not merged, not deployed).
Supersedes / superseded by: supersedes the audit line of [0002](0002-first-slice-private-notes-contract.md) ("Audit successful create/update metadata") and the private-note audit events listed for [0029](0029-private-notes-organization-and-trash.md) and spec F03-ARR. Everything else in those decisions stands.

## Context

`audit_event` is meant to answer "who changed something that affects other people, official knowledge or access, and when" ([security and data](../engineering/security-and-data.md#9-secrets-logging-audit-and-incident-evidence)). Decision 0002 also audited every private-note create and update. Since [0031](0031-private-note-live-version-and-autosave.md) added autosave about 1.5 seconds after typing stops, each pause in writing adds a row. Private notes are readable only by their owner, so these rows hold no content and help no review, but they quickly outnumber the events that matter.

## Options

| Option | Assessment |
| --- | --- |
| Coalesce saves into one row per editing session | Extra logic for rows that still answer no question. |
| Stop auditing private notes entirely | Loses evidence for sharing and permanent deletion. |
| **Audit by consequence (accepted)** | Keeps rows that affect other people, official knowledge, access or cannot be undone; drops routine owner-only actions. |

## Decision

Audit an action when it changes access, official knowledge or organization structure, uses an exceptional privilege, or cannot be undone. In practice:

- **Audited:** organizations, departments, invitations and membership changes; reviewer grants; reader groups; shared-draft creation (including contributing a private note), submission, review decisions including self-approval, publication, withdrawal, reader changes, renewal and catalog placement; governance inspection and report handling; System Admin changes (in their own log); and, for private items, **permanent deletion** (`PRIVATE_ITEM_PURGED`). When direct sharing lands (decision 0034 on its branch), sharing, revoking and the organization sharing setting are audited too.
- **Not audited:** routine owner-only actions on private items: create, save (manual or autosave), rename, duplicate, move, order, favorite, archive and unarchive, move to trash and restore, and creating or changing private collections. They remain protected by owner-only RLS and appear in no other member's data.

Audit details keep identifiers and counts only, never titles or content.

Out of scope: an audit viewer for Organization Admins, audit retention, and splitting `audit_event` into per-module tables. They need their own decision.

## Consequences

- The API no longer writes `PRIVATE_DRAFT_CREATED`, `PRIVATE_DRAFT_UPDATED`, `PRIVATE_DRAFT_DUPLICATED`, `PRIVATE_DRAFT_ARCHIVED`, `PRIVATE_DRAFT_UNARCHIVED`, `PRIVATE_COLLECTION_CREATED`, `PRIVATE_COLLECTION_UPDATED`, `PRIVATE_ITEM_TRASHED` or `PRIVATE_ITEM_RESTORED`. Rows already written stay; no migration is needed.
- New features follow the same rule: add an audit event only for a consequential action, and say which category it falls into.

## Verification

API unit tests and the real-PostgreSQL repository case assert that the routine events are not written and that permanent deletion is still audited without titles.
