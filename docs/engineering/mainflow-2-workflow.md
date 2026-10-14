# Mainflow 2 — current workflow and verification boundary

This is the current Flow 2 contract. Earlier `mainflow-2-group-1-create.md` and `mainflow-2-group-2-review-queue.md` document incremental slices; their statements about absent routes and the ARD-29 worktree are historical, not the current branch state.

## Authoring

There are two creation paths. `POST /api/v1/organizations/:organizationId/knowledge/drafts/new` starts a new text draft; `POST /api/v1/organizations/:organizationId/knowledge/drafts` makes a separate **Contribute copy** of one saved private-note version. Both require an authenticated, active organization member and a UUID `Idempotency-Key`. Only the private-note owner may contribute that note. The private original and its protected object remain unchanged.

Each shared draft has immutable content versions. `GET /knowledge/drafts` lists only the actor's drafts, `GET /knowledge/drafts/:id` reopens one, and `PATCH /knowledge/drafts/:id` requires `If-Match: "<current version>"`. Editing writes a new version; it never mutates the previous one. The author supplies title, responsible department, classification, target scope, optional team/project tags and active audience roles. `GET /knowledge/options` provides selectable active departments and content-view-capable audience roles. While a submission is pending, editing is locked. Saving after a completed decision creates the next version.

`POST /knowledge/drafts/:id/submit` requires `If-Match` and an idempotency key. Submission freezes the exact current version, title, classification, responsible department, scope, tags, audience-role IDs, content URI and hash. A draft needs an active responsible department, target scope and at least one valid audience. Custom/default audiences require an active organization-local role with `PUBLISHED_CONTENT_VIEW`; the reserved `ALL_MEMBERS` audience is valid only for Organization scope.

## Review and publication

Org Admin creates a `reviewer_grant` through Administration or `POST /knowledge/reviewer-grants`. The grant is scoped to one department, classifications, optional team/project tags and validity interval. `RESTRICTED` requires a Specialist or Senior grant. Org Admin status alone grants neither review nor published-content readership. Grants can be deactivated; each queue, detail and decision request rechecks current membership and grant status.

`GET /knowledge/reviews` returns only pending, non-self submissions within the actor's current grants. It returns metadata, not protected text. `GET /knowledge/reviews/:submissionId` reauthorizes, loads the exact immutable submitted text, and reauthorizes again before responding. If proposed audience roles are no longer enforceable, the queue marks `approvalBlocked`: revision and rejection remain possible, approval does not.

`POST /knowledge/reviews/:submissionId/decisions` requires a UUID `Idempotency-Key`, the expected snapshot-version ID and content hash. Request Revision and Reject require a reason, return that reason to the author in submission history, and never publish. Approval is one transaction: lock submission, recheck authority and audience, insert immutable decision and reviewer audit, change status, insert the exact published snapshot, replace current-publication pointer, and insert a distinct system publication audit. A deferred database trigger rejects approval missing publication or either audit record. The author can edit and resubmit a **new** draft version after a decision.

`GET /knowledge/published` and `GET /knowledge/published/:id` expose only current, valid publications. Custom/default audiences require a live assignment in the exact current scope; Organization-only `ALL_MEMBERS` requires active organization membership and no assignment. The detail endpoint rechecks authorization after reading protected text. Approval does not automatically make the reviewer or Org Admin a reader unless an independent audience rule grants access. Only current approved/published versions are eligible for future Search/AI use; Search/AI implementation is outside Flow 2.

## Migration and deployment gate

This branch uses one migration ledger, `apps/api/migrations`, including `0009_mainflow_2_authoring.sql` and `0010_mainflow_2_submission_review.sql`. The deleted ARD-29 worktree is not a dependency. The UI separates authenticated server records from session-only samples; Electron's main process allowlists the live routes and keeps tokens outside the renderer.

The new migrations have **not** been exercised against a disposable PostgreSQL instance in this checkout. TypeScript and synthetic API tests do not verify SQL/RLS. Before applying to a hosted slot, run the migrations, RLS actor-boundary checks, rollback and concurrent-decision tests on a disposable `arden_test_*` database. Do not use a shared Coolify Supabase instance as a disposable test database. Deployment is not part of the current implementation turn.
