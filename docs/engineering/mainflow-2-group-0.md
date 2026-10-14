# Mainflow 2 — Group 0 foundation

Group 0 prepared the backend boundary for the shared-knowledge workflow. The later Group 1 function 1 adds only shared-draft creation. Submission, review, and publication routes must not be enabled until their database transactions, RLS policies, frozen submission metadata, and audit events are implemented and tested.

## Reviewable functions

- `requireAuthenticatedActor()` in `apps/api/src/app.ts` resolves the server-side Supabase session (or the explicitly fenced local test actor). A missing, invalid, or unavailable session fails closed. Existing protected routes use this guard.
- `ArdenRepository.requireActiveMembership()` in `apps/api/src/db/repository.ts` looks up a current member by verified user ID and organization ID under `arden_runtime` RLS. It returns `null` if the user, membership, or organization is not active. Group 1 routes should call it before any shared-content action.
- `canCreateSharedDraft()` allows an active author to make a separate copy of their private version, or an active reader to contribute a copy of a currently authorized published version.
- `canSubmitSnapshot()` requires the author's current shared-draft version, a content hash, a nonempty valid audience, and server-confirmed audience enforceability. `ALL_MEMBERS` is valid only for Organization scope; other audiences are active organization-local roles with VIEW.
- `canReviewSnapshot()` requires a live reviewer grant for the submitting department and classification, matching optional attributes, a matching policy version, an enforceable audience, and no self-approval. `RESTRICTED` requires a specialist or senior grant; it does not automatically require two reviewers.
- `canReadPublication()` requires a current publication and either active organization membership for its Organization-only `ALL_MEMBERS` audience or one matching, currently valid exact-scope role assignment. Org Admin status alone never grants content access; unknown or invalid audience tags deny access.

The policy inputs (`audienceRoles`, assignments, reviewer grant, policy version, and `audienceEnforceable`) must be resolved by the server from current database state inside the operation's transaction. They are **not** request-body claims. The pure functions are not yet wired to routes, so their presence alone is not an access-control guarantee.

## Schema boundary

Migration `0006_mainflow_2_shared_draft_foundation.sql` adds a separate `shared_draft`, immutable `shared_draft_version`, and proposed `shared_draft_audience`. A shared draft records exactly one source version (private or published) and its author/organization. Cross-organization and non-owner private sources are rejected. Role audience tags must be active organization-local custom roles. Migration `0007_protect_shared_draft_provenance.sql` makes source, author, and organization immutable after creation.

At the Group 0 migration boundary, all three new tables have RLS enabled and forced, with no `arden_runtime` grants or policies. Migration 0008 later adds narrow author-only draft-creation access. Submission snapshots, reviewer-grant persistence, final-approval system publication, current-version pointers, and RAG audience filtering remain later groups.

## Local checks

Run `pnpm --filter @arden/api typecheck` and `pnpm --filter @arden/api test`. The policy tests cover active/revoked/expired role grants, unknown audiences, source ownership, stale snapshots, self-approval, reviewer scope, restricted classification, and policy version. Database integration tests require an isolated `arden_test_*` database via `ARDEN_TEST_DATABASE_URL` and are skipped without it.
