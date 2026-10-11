# Mainflow 2 — Group 1, function 1: createKnowledgeDraft

This slice implements only the first Group 1 function. It creates an author-owned shared draft as a separate copy of one existing private-note version. It does not implement `updateKnowledgeDraft`, `submitKnowledgeDraft`, copying from a publication, role audience editing, review, or publication.

## HTTP contract

`POST /api/v1/organizations/:organizationId/knowledge/drafts` requires an authenticated session, a UUID `Idempotency-Key` header, and `{ "sourcePrivateVersionId": "<uuid>", "classification": "INTERNAL|CONFIDENTIAL|RESTRICTED" }`. The organization and active membership are resolved server-side. The source must be an active private note/version in that organization, owned by the actor, with `PRIVATE_WORKSPACE_READ` permission. Only bounded `text/plain` content is supported in this slice. A manager/admin is not allowed to copy another member's private note.

The server reads and verifies the private version's content hash, writes a new protected object, then commits the `shared_draft`, immutable version 1, and `SHARED_DRAFT_CREATED` audit event in one database transaction. The original private object remains unchanged. The response contains the new shared draft's title, body, classification, version/hash and timestamps, but no private source ID or storage URI. No shared-draft read or list route exists yet.

A new request returns 201; an identical retry with the same key returns 200 and does not create another draft or audit event. Reusing the key with a different source/classification returns 409. An unavailable/unauthorized source returns the same 404. Invalid input returns 400. If DB commit acknowledgment is ambiguous, the new protected object is retained rather than risk deleting content referenced by a committed row; orphan reconciliation is required before deleting it.

## Database boundary and verification

Migration `0008_enable_private_shared_draft_creation.sql` adds the per-author idempotency key and grants author-only RLS access for private-sourced shared drafts. The runtime role can update only the parent current-version pointer needed by the version-insert trigger. Version insertion is restricted to initial version 1; audience rows and published-source contributions remain inaccessible to the runtime role. Apply migrations explicitly before starting an API build with this route.

Run `pnpm --filter @arden/api typecheck`, `pnpm --filter @arden/api test`, and `pnpm --filter @arden/api build`. The request tests use a synthetic repository/storage. The RLS test requires a disposable, migrated PostgreSQL database named `arden_test_*` via `ARDEN_TEST_DATABASE_URL`; it must not target a shared Coolify database. Until that real-DB test passes, the migration/RLS behavior is not release-verified.
