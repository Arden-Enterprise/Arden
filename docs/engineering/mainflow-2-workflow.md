# Mainflow 2 — current workflow and verification boundary

This is the current Flow 2 contract: how an organization member turns knowledge into a reviewed, published snapshot. It describes what the code on this branch does, and names what the decisions describe but the code does not yet implement.

Earlier `mainflow-2-group-0.md`, `mainflow-2-group-1-create.md` and `mainflow-2-group-2-review-queue.md` document incremental slices. Their statements about absent routes and the ARD-29 worktree are historical. Indexing and activation after approval belong to Mainflow 3; see the [Mainflow 3 Phase 0 contract](mainflow-3-phase-0-contract.md).

Governing decisions:

| Decision | What it governs |
|---|---|
| [0010](../decisions/0010-audiences-and-system-administration.md) | Audiences are readership only. |
| [0011](../decisions/0011-permission-aware-publication-and-semantic-documents.md) | Approve/Reject only; Organization Admin authority; preparation before activation. |
| [0013](../decisions/0013-audience-breadth-review-levels.md) | Authors no longer classify. |
| [0014](../decisions/0014-author-owns-shared-drafts.md) | The uploader's primary department owns the draft. |
| [0015](../decisions/0015-organization-wide-reviewer-grants.md) | Department and organization reviewer grants. |

All routes below are under `/api/v1/organizations/:organizationId/knowledge` and require an authenticated, active member of that organization.

## 1. Actors

| Actor | Can do |
|---|---|
| **Author** | Owns their working drafts and their submission history. Cannot read another author's draft. |
| **Department reviewer** | Holds an active `DEPARTMENT` reviewer grant for one department. Decides department- and group-only snapshots owned by that department. Never decides their own submission. |
| **Organization reviewer** | Holds an active `ORGANIZATION` reviewer grant. Decides snapshots readable by the whole organization, from any department. Never decides their own submission. |
| **Organization Admin** | Creates and deactivates grants. May inspect and decide every pending submission, including their own; a self-approval is audited with `selfApproved: true` (0011). Admin status grants no published-content readership by itself. |
| **Reader** | Any member whose current audience membership admits them to the active publication. |

## 2. Lifecycle

```text
working draft (versions 1, 2, 3 …; stays editable)
   └─ submit ─▶ submission PENDING_REVIEW   (one open submission per draft)
                  ├─ reject  ─▶ REJECTED                (never published; author may submit again)
                  └─ approve ─▶ APPROVED / PREPARING
                                   ├─ index ready ─▶ APPROVED / ACTIVE      (becomes the current publication)
                                   ├─ index fails ─▶ APPROVED / FAILED      (current publication unchanged)
                                   └─ newer snapshot already published ─▶ APPROVED / SUPERSEDED
```

- Submission `status` is `PENDING_REVIEW`, `APPROVED`, `REJECTED` or `WITHDRAWN`. No route currently produces `WITHDRAWN`; see §11.
- `publication_state` is `NONE` until approval, then `PREPARING`, `ACTIVE`, `FAILED` or `SUPERSEDED`.
- Activation is monotonic (migration 0021): an older delayed index job cannot replace a newer published snapshot. The previous active submission becomes `SUPERSEDED` when a newer one activates.

## 3. Authoring

### Creating a shared draft

There are three ways to create a draft. Each requires a UUID `Idempotency-Key` header. Replaying the same key with the same request returns the existing draft (200); the same key with a different request returns 409 `IDEMPOTENCY_CONFLICT`.

| Route | Creates | Notes |
|---|---|---|
| `POST /drafts/new` | A draft written in Arden's editor | Title (at most 200 code points; the UI limits it to 160) and a Semantic Document body (at most 100 000 bytes, see [semantic-document-v1.md](semantic-document-v1.md)). |
| `POST /drafts/pdf` | A draft from an uploaded PDF | Base64 PDF, at most 5 MB, must start with `%PDF-`. The original file is kept for review and download; it is not converted into editable text, and its body cannot be edited later. |
| `POST /drafts` | **Contribute a copy** of one saved private-note version | Only the note's owner may copy it. The private original and its protected object stay private and unchanged. Unsupported note versions return 409 `SOURCE_NOT_SUPPORTED`. |

`classification` is optional on all three routes and defaults to `INTERNAL` (0013). The UI never sends it.

### Editing and sharing settings

- `GET /drafts` lists only the actor's drafts. `GET /drafts/:id` reopens one.
- `PATCH /drafts/:id` saves a new immutable version.
  - It requires `If-Match: "<current version>"`: missing → 428 `PRECONDITION_REQUIRED`; stale → 412 `VERSION_CONFLICT`.
  - A PDF draft's body cannot be edited (400).
  - Invalid metadata returns 400 `INVALID_METADATA`.
- The author chooses **who can read it**: the organization audience, their department's audience, and/or audience groups. Per-person audiences and "deny" entries do not exist (0010).
- The UI derives the **target scope** from those readers and sends it with the draft; the server validates the scope/audience pairing:

  | Readers | Scope |
  |---|---|
  | Organization audience | Organization |
  | Department audience | Department |
  | Groups only | Organization, unless the author ticks "only members who are also in my department" (then Department) |

  The organization audience is valid only at Organization scope, and a department audience only at Department scope.
- **Ownership (0014):** the author owns the draft. Its responsible department is the author's active **primary department**, set by the server on every save.
  - A client may omit the field or repeat that value. Any other department is rejected.
  - The UI shows "Owned by you · reviewed by {department}" instead of a department picker.
- Optional team/project tags (Advanced) narrow which reviewer grants apply.
- `GET /options` returns:
  - the active departments and audiences;
  - `primaryDepartmentId`;
  - `organizationReviewerAvailable` — only whether an active organization reviewer exists, never who.
- The working draft stays editable while a submission is pending. The frozen submission does not change.

## 4. Submitting

- `POST /drafts/:id/submit` requires `If-Match` and an `Idempotency-Key`. It freezes the exact current version:
  - content URI and hash, MIME type and title;
  - responsible department, scope, team/project tags and audience IDs;
  - the legacy classification value;
  - `review_rule = GRANT_SCOPE`.
- Submission is ready only when:
  - the author has an active primary department, and it equals the stored responsible department;
  - a target scope is set;
  - at least one valid, enforceable audience is chosen.
- A draft that is not ready returns 409 `DRAFT_NOT_READY`. Another open submission, or an already-submitted version, returns 409 `SUBMISSION_CONFLICT`.
- `GET /submissions` lists the actor's own submissions. My Contributions uses it for status and history.

## 5. Reviewer grants (Organization Admin)

- `GET /reviewer-grants` lists the organization's grants (Organization Admin only).
- `POST /reviewer-grants` creates one:
  - `scope` is `DEPARTMENT` (default) or `ORGANIZATION`.
  - `departmentId` is required for Department scope and forbidden for Organization scope (400 otherwise).
  - Optional team/project tags and `validUntil`.
  - `classifications` and `level` are optional legacy fields: new grants store all classifications and `STANDARD`, and the product no longer shows levels.
- `POST /reviewer-grants/:grantId/deactivate` deactivates a grant (204).
- Every queue, detail and decision request rechecks the reviewer's current membership and grant.

## 6. Review

| Frozen readers of the snapshot | Who may decide |
|---|---|
| Department audience, or groups only (including groups spanning several departments) | An active `DEPARTMENT` grant for the responsible department |
| Includes the organization audience | An active `ORGANIZATION` grant |
| Any snapshot | Organization Admin |

- Scopes are disjoint (0015). An organization grant does not decide department or group snapshots, and a department grant does not decide new organization-wide snapshots.
- Group composition never changes who reviews.
- Grant tags and the validity window must match. Ordinary reviewers cannot decide their own submission.
- **Transition:** submissions that existed before migration 0022 carry `review_rule = LEGACY`.
  - A legacy organization-wide submission may also be decided by a Department grant for the responsible department with level `SPECIALIST` or `SENIOR`.
  - Legacy `CONFIDENTIAL` and `RESTRICTED` values keep their classification checks; `RESTRICTED` still needs `SPECIALIST` or `SENIOR`.
- `GET /reviews` returns metadata (not protected text) for pending submissions the actor may decide. Organization Admin sees every pending submission in the organization.
  - If the frozen audiences are no longer enforceable, the item is `approvalBlocked`: rejection remains possible, approval does not.
- `GET /reviews/:submissionId` reauthorizes, loads the exact frozen content, and reauthorizes again before responding.
- `POST /reviews/:submissionId/decisions`:
  - **Request:** `action` (`APPROVE` or `REJECT`), `expectedSnapshotVersionId`, `expectedContentHash`, an optional `comment`, and a UUID `Idempotency-Key`.
  - **Rejection:** requires a comment (400 `COMMENT_REQUIRED`). It is recorded and never publishes.
  - **Approval:** locks the submission, rechecks authority and audience, records the immutable decision and audit event, and moves the snapshot to `PREPARING`. It does not replace the current publication.
  - **Errors:** a stale snapshot or changed submission returns 409. An unauthorized actor gets 404 without learning that the submission exists.
  - There is no "request revision" outcome (0011).
- The author may keep editing the working draft throughout review. They can submit a new snapshot once the open submission closes.

## 7. Publication preparation and activation

Approval hands the exact snapshot to the Mainflow 3 indexing pipeline (migrations 0019 and 0021).

- When a complete index generation is ready, it atomically becomes the current publication (`knowledge_current_publication`) and the submission becomes `ACTIVE`.
- A failed generation leaves the current publication unchanged (`FAILED`).
- A generation older than an already-published snapshot is `SUPERSEDED`.
- There is no human publisher role.

## 8. Reading published knowledge

- `GET /published` and `GET /published/:id` return only the current active publication. The detail route rechecks authorization after reading protected content.
- **Readership follows the publication's audiences (0010):**
  - The organization audience admits every active member.
  - A department audience admits active members of that department.
  - A group audience admits its active, currently valid members, from any department.
  - A Department-scope publication additionally requires active membership in its target department.
- Approving a snapshot does not make the reviewer or Organization Admin a reader. They need an audience rule like anyone else.
- **Database bridge:** publication RLS (`actor_in_publication_audience`, migration 0012) still evaluates audiences through the legacy role projection kept by migration 0017. Audience IDs equal the legacy role IDs, and role-backed shadow data keeps those checks working. This bridge remains until the Phase 5 contraction in the [audience/system-admin implementation plan](audience-system-admin-implementation.md); it is not part of the product or API contract.
- Only current active publications are eligible for Search and Ask Arden (Mainflow 3).

## 9. Error responses (current codes)

| Condition | Response |
|---|---|
| Missing or foreign resource, or unauthorized actor | 404 `RESOURCE_NOT_AVAILABLE`, without revealing existence |
| Missing `If-Match` | 428 `PRECONDITION_REQUIRED` |
| Stale draft version on save | 412 `VERSION_CONFLICT` |
| Same idempotency key, different request | 409 `IDEMPOTENCY_CONFLICT` |
| Draft not ready to submit | 409 `DRAFT_NOT_READY` |
| Open submission exists, or version already submitted | 409 `SUBMISSION_CONFLICT` |
| Stale snapshot or changed submission on decision | 409 `REVIEW_CONFLICT` or the denial reason |
| Reject without a comment | 400 `COMMENT_REQUIRED` |
| Invalid metadata, PDF or Semantic Document | 400 `INVALID_METADATA` / `INVALID_PDF` / `INVALID_DOCUMENT` |
| Request body fails schema validation | 400 `INVALID_REQUEST` ("The request is invalid.") |

The [Mainflow 3 error taxonomy](mainflow-3-phase-0-contract.md#error-taxonomy) is the target. Some current codes still differ: `SUBMISSION_CONFLICT` rather than `OPEN_RELEASE_CANDIDATE_EXISTS`, and 412 rather than 409 for a stale save.

## 10. Audit events

- **Drafts:** `SHARED_DRAFT_CREATED`, `SHARED_DRAFT_UPDATED`.
- **Submissions and decisions:** `KNOWLEDGE_SUBMITTED`, `KNOWLEDGE_REVIEW_DECIDED` (with `selfApproved` when an Organization Admin decides their own submission).
- **Grants:** `REVIEWER_GRANT_CREATED` (including scope), `REVIEWER_GRANT_DEACTIVATED`.
- **Activation:** `KNOWLEDGE_INDEX_ACTIVATED`, written by the indexing pipeline.

## 11. Described by decisions, not yet implemented

- **Withdraw / cancel a pending submission.** The Mainflow 3 contract allows the author or Organization Admin to cancel. The `WITHDRAWN` status exists, but no route sets it.
- **Unpublish.** Decision 0011 lets Organization Admin unpublish explicitly. The database keeps a monotonic publication high-water mark for it, but there is no API route or UI.
- **Retry a `FAILED` preparation** from the product. The pipeline state machine allows `FAILED → PREPARING`; there is no Flow 2 control for it.
- **Notifications** to reviewers or authors. None are sent; queues and lists are pulled.
- **Schema contraction.** The `classification` and grant `level` columns remain. The SQL reviewer-eligibility function is broader than the TypeScript policy until then (0015).

## 12. Screens

| Screen | Purpose |
|---|---|
| **Library → New shared draft** | Choose the content source (PDF or Arden editor) and the title. |
| **Private Notes → Contribute a copy** | Copy one saved note version into a shared draft. It opens in the status island. |
| **Draft editor → Before you submit** | Owner line, "Who can read it" picker, derived scope and reviewer, Advanced tags, readiness, Save version, Submit. |
| **Library → My Contributions** | The author's drafts with status, reviewer note and history. |
| **Reviews** | Queue, frozen document and decision island with a pinned Approve/Reject footer. Confirmation happens in place. |
| **Library** | Current publications the member may read, and the document reader. |
| **Administration → Reviewer access** | Create a "One department" or "Whole organization" grant, list grants, revoke. |

Web and desktop share these screens. The desktop main process allowlists these routes and keeps session tokens outside the renderer.

## 13. Migrations and verification

The migration ledger is `apps/api/migrations`. Flow 2 relies on:

| Migration | Purpose |
|---|---|
| `0009_mainflow_2_authoring.sql` | Authoring. |
| `0010_mainflow_2_submission_review.sql` | Submission and review. |
| `0016_fix_flow2_cross_actor_validation.sql` | Forward fix for cross-actor validation. |
| `0017_audience_and_instance_admin_foundation.sql` | Audiences and their legacy bridge. |
| `0019` / `0021` | Preparation and monotonic activation. |
| `0022_organization_reviewer_grants.sql` | Grant scope and the frozen `review_rule`. |

Run migrations before starting an API build that depends on them. The 0022 code reads `reviewer_grant.scope` and `shared_submission.review_rule`.

**Evidence obtained:**
- API unit and request tests cover:
  - the review policy, including disjoint scopes, the legacy transition, fail-closed breadth and Organization Admin authority;
  - responsible-department derivation;
  - optional classification;
  - grant-scope validation.
- UI tests cover the reader-selection, owner and grant-coverage helpers.
- On 2026-10-16, migration 0016 and the cross-member approve/publish transaction were exercised in one rollback-only transaction on the `dev-3` database under `arden_runtime`. Migration 0016 was then applied to the `dev-3` ledger. Staging and production were not changed.

**Not obtained:**
- The repository integration suite runs only with `ARDEN_TEST_DATABASE_URL` pointing to an `arden_test_*` database. It has not run against migrations 0020–0022, so the following are unverified on PostgreSQL:
  - the grant-scope cases;
  - the primary-department query;
  - the organization-wide detection.
- Clean-install and populated-upgrade rehearsal of 0022 remains outstanding. Do not use a shared Coolify Supabase instance as a disposable test database.
- End-to-end browser and desktop flows on a live slot have not been recorded for 0014 and 0015.
