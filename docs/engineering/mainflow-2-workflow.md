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
- `GET /drafts/:id/versions` lists the author's saved content-version IDs, numbers, MIME types and save times. `GET /drafts/:id/versions/:versionId` reads one immutable saved body or PDF for a read-only History preview. Both routes return 404 for another member or organization and `Cache-Control: no-store`; content URI/hash remain server-side. These version records do not snapshot the draft's mutable title or classification.
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

### Target Readers (Flow 2 T1.1/T1.3/T1.4 — additive, in progress)

Target Readers are the per-document reader model planned to replace audience groups. This slice adds them **alongside** audiences; nothing is removed.

- **Provenance:** Flow 2 task list (team planning artifact, exported 2026-11-10; BM04 RF-03/RF-04), tasks T1.1, T1.3 and T1.4, requested by the maintainer for implementation. Accountable decision owner: unknown; confirmation needed. Decision state: proposed for the audience replacement (T1.2/T1.6 still need an informed decision against [0010](../decisions/0010-audiences-and-system-administration.md)); the additive slice below is implemented.
- **Modes:** `ORGANIZATION` (every active member), `DEPARTMENT` (active members whose current department — an active department membership in an active department — matches), `SELECTED_MEMBERS` (2–100 distinct active members of the same organization).
- **Save:** `PATCH /drafts/:id` accepts optional `targetReaders: { mode, departmentId?, memberIds? }`. Absent keeps the saved readers. Present must pass `TargetReaderPolicy.validateSelection`; otherwise 400 `INVALID_TARGET_READERS` with `error.field` (`targetReaders.mode`, `.departmentId` or `.memberIds`) and no new version. A valid save stores a new immutable `reader_selection` (revision + 1); reads return `targetReaders` with members in the author's order.
- **Submit** freezes the draft selection as `shared_submission.proposed_selection_id` (returned as `proposedTargetReaders`). The snapshot trigger keeps it immutable.
- **Approve with approved readers (T2.1, migration 0025):** `POST /reviews/:id/decisions` accepts optional `approvedReaders: { mode, departmentId?, memberIds? }`.
  - Absent: the approved readers (A) are a copy of the proposed readers (P), stored as their own `reader_selection` row.
  - A may keep or narrow P, never widen it. ORGANIZATION → any valid mode; DEPARTMENT d → DEPARTMENT d, or 2–100 members whose current department is d at decision time; SELECTED_MEMBERS S → a subset of S with at least 2 members. Otherwise 409 `READERS_WIDENED`.
  - A must also pass `validateSelection`; otherwise 400 `INVALID_READERS` with `error.field` (`approvedReaders.*`). REJECT with readers → 400 `INVALID_REQUEST`. A legacy submission without P approves as before; readers on it → 400 `READERS_NOT_SUPPORTED`.
  - Reader checks run after snapshot and reviewer authorization in the same locked transaction, so an unauthorized caller gets 404. Replays compare readers as a set; the same key with different readers → 409 `REVIEW_CONFLICT`.
  - The decision row carries `approved_selection_id`; the approval UPDATE copies it to the submission exactly once (trigger-enforced). The audit event adds `proposedReaders`, `approvedReaders` (mode, department, member count) and `narrowed`.
  - `GET /reviews/:id` returns `proposedReaders` (`mode`, `department {id,name}`, `members [{membershipId, displayName}]`) for authorized reviewers. Submissions return `approvedTargetReaders`.
  - Open question: a member approved under DEPARTMENT d → SELECTED_MEMBERS stays a reader if they later leave d, because A is a frozen list. Decision owner: unknown; confirmation needed.
- **Legacy audiences → Target Readers (T1.2, migration 0028):** a forward-only backfill gives every current publication without readers a selection that admits nobody its legacy audience does not admit today. ALL_MEMBERS at organization scope → ORGANIZATION; a department scope whose current members all hold the department audience → DEPARTMENT; anything else (groups, partial departments, mixed audiences) → SELECTED_MEMBERS frozen to the exact current readers (2–100). A publication read by fewer than 2 (including nobody) or more than 100 members that fits no mode stays on the audience path and is reported as `UNMAPPED`. The migration raises a NOTICE with the before/after reader counts per publication and fails if any mapped publication would gain a reader. `SELECT * FROM arden.migrate_publication_readers(false)` prints the same report at any time (operator role only). Audience tables, columns and policies stay until T1.6.
  - **Authority after cutover:** once a publication has Target Readers, that selection is the source of read entitlement. Removing someone from an old Audience does not revoke their Target Readers entitlement; adding someone to that Audience does not add them to a frozen selected-member list. Revoke through a governed Target Readers change or suspend organization membership. Current account/organization/membership and applicable department checks still apply. Publications reported as `UNMAPPED` retain the legacy audience path.
  - **Decision provenance:** on 2026-11-12 the requesting maintainer explicitly chose Target Readers authority after comparing it with the earlier dual-check contract, including the lost legacy-Audience revocation effect. This supersedes the earlier T1.2 statement that both readership policies must admit every mapped reader, and refines [0010](../decisions/0010-audiences-and-system-administration.md) for mapped publications as recorded in [0020](../decisions/0020-knowledge-management-catalog.md). Separate consultation with the earlier author is not established. Physical removal of the legacy schema remains separate work; keeping it does not make it a second entitlement source. The operator report remains useful for initial mapping/legacy comparisons, not an ongoing Target Readers authorization audit.
- Audience readiness rules for submit are unchanged in this slice.

### Contribution metadata (Flow 2 T3.1, migration 0027)

- **Integration status:** this section describes retained compatibility storage. [KM-v1](../product/graph-ai-and-work.md#knowledge-management-refinement-km-v1-accepted-12-november-2026) owns the standardized form: fixed Type (including Lessons Learned), one Topic and conditional Change Note. The legacy General category is not a canonical Type, and Keywords do not return to the form.
- **Provenance:** Flow 2 task list T3.1 (BM04 RF-03), requested by the maintainer on 2026-11-11. The task does not name the categories; the maintainer confirmed on 2026-11-12 the five defaults proposed in the task conversation: Policy, Procedure, Guide, Reference and General (the default).
- `document_category`: every organization has the five defaults, seeded by a trigger on organization creation and backfilled for existing organizations. A category is a browse/filter label and grants no access. Members read only their organization's categories.
- `shared_draft` gains `category_id`, `keywords` (at most 20 distinct entries of 1–50 characters) and `change_description` (≤ 2000 characters). They are nullable working fields so Save draft accepts an incomplete form; T3.2 validates them on Submit. Existing documents got their organization's default category.
- `shared_submission` gains frozen copies of the same three fields, part of the immutable snapshot tuple.
- `document_relationship` links two documents (`RELATED`, `REFERENCES`, `SUPERSEDES`) of the same organization; composite foreign keys make a cross-organization link impossible, and only the source document's author can add or remove a link. The API and screens for these fields are T3.2/T3.3.

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
- **Withdraw (T5.1, FR-DOC-06, migration 0029):** `POST /submissions/:id/withdraw` lets the author withdraw their own `PENDING_REVIEW` submission. It becomes `WITHDRAWN`, leaves every review queue and frees the document for a new submission; the draft is kept. Another member's or an unknown submission → 404 `RESOURCE_NOT_AVAILABLE`; a decided one → 409 `SUBMISSION_NOT_PENDING`; repeating a completed withdrawal returns it again (200). A trigger makes `WITHDRAWN` reachable only from `PENDING_REVIEW` and final; an RLS policy lets only the submitting author make that change.

### Reader-change and withdrawal requests (T6.1/T6.2, migrations 0034–0035)

- **Request (T6.1):** `POST /documents/:documentId/change-requests` with an `Idempotency-Key` and `{ type: "READER_CHANGE" | "WITHDRAWAL", reason, targetReaders? }` lets the author of a published document ask to change its readers or to withdraw it. The reason is required (1–1000 characters). `READER_CHANGE` requires `targetReaders` (validated like a draft save; 400 `INVALID_TARGET_READERS` with `error.field`); `WITHDRAWAL` refuses them (400 `INVALID_REQUEST`). A document without a current publication → 409 `DOCUMENT_NOT_PUBLISHED`; another pending request or submission for the document → 409 `SUBMISSION_CONFLICT`; another member or an unknown document → 404. The same key replays the request (200).
- The request is a `shared_submission` with `request_type`, `request_reason` and `target_published_version_id`. It repeats the current publication's frozen snapshot and KM-v1 metadata (not the working draft's), so it routes to the same reviewers; new readers are its proposed readers. A trigger verifies the requester is the author and the snapshot is the current publication's. While it is pending, the current version and readers do not change. It appears in the review queue with `requestType`; submissions and reviews return `requestType` and `requestReason`. The author can withdraw it (T5.1).
- **Approval (T6.2):** the same `POST /reviews/:id/decisions` route. A reader change is approved with its proposed readers kept or narrowed as in T2.1 (`approvedReaders`); the approved readers then become the readers of the current publication (same version and content) on the next request. An approved withdrawal deletes the current pointer, so the document leaves the library, document detail, search, Ask Arden sources and citation rechecks on the next request; the released submission's `publicationState` becomes `WITHDRAWN`; versions stay for history. There is no restore: publishing again is a new content submission, which the 0021 high-water mark still orders. The request itself ends `APPROVED` with `publicationState` `NONE`. Approval returns 409 `PUBLICATION_CHANGED` when the request no longer names the current publication or, for a withdrawal, while a newer approved version is still being prepared; the reviewer can still reject. The database applies the change in the decision transaction through the reviewed SECURITY DEFINER `apply_publication_change` (activation lock; a stale or repeated application is refused with 40001). The decision audit event adds `requestType` and `publishedVersionId`.
- Provenance: Flow 2 task list T6.1/T6.2 and SDD S-16, requested by the maintainer on 2026-11-12 and 2026-11-14. Only the author can request in this slice; the SDD also names the responsible reviewer, and the Org Admin emergency path is T6.3. Screens are T2.2/T6.4.

Review UI safety: the pending queue labels reader-change/withdrawal requests. The decision pane
shows their request type and reason, and confirmation/success copy describes the actual effect
(replace readers or remove from Library/AI), never preparation of a new version. Cancel sends
no decision. This corrects presentation of existing approved T6.2 behavior; it adds no new
request-management capability or permission. `reviewRequest.test.tsx` exercises the real page
with synthetic API boundaries for all three request types.

## 5. Reviewer grants (Organization Admin)

- `GET /reviewer-grants` lists the organization's grants (Organization Admin only).
- `POST /reviewer-grants` creates one:
  - `scope` is `DEPARTMENT` (default) or `ORGANIZATION`.
  - `departmentId` is required for Department scope and forbidden for Organization scope (400 otherwise).
  - Optional team/project tags and `validUntil`.
  - `classifications` and `level` are optional legacy fields: new grants store all classifications and `STANDARD`, and the product no longer shows levels.
  - A second effective grant with the same reviewer, scope, department, team/project tags and legacy classification/level coverage returns 409 `REVIEWER_GRANT_EXISTS`. Different tags are allowed. Migration `0031` deactivates earlier exact duplicates, keeps the oldest grant, and records an audit event; distinct legacy classification/level coverage remains available for frozen pending submissions. Apply it only through the reviewed migration path after a disposable database rehearsal.
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
  - `items` also carry `versionNo` and `authorName`; `decided` lists the submissions this reviewer approved or rejected (newest first, up to 100, read-only) for the REV-02 Reviews list.
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
- **Target Readers in the API (T1.3, closes BM02 R-01):** the library list, the document detail and the Ask Arden allow-list call `TargetReaderPolicy.canRead` in the route, not only RLS. A publication's readers are `published_knowledge_version.reader_selection_id` (copied from the submission's approved readers on activation, and onto the current pointer); a publication without one keeps the audience behaviour above. From 0025 a restrictive RLS policy on the current pointer applies the same rule (`actor_in_reader_selection`), so the published version, Ask Arden generations and citations are narrowed in the database too; an approver or author outside A cannot read the publication. Unreadable and missing documents return the same 404 `RESOURCE_NOT_AVAILABLE`; Ask Arden rechecks after generation, so an unreadable document is never cited. Library responses expose only `targetReaders.mode`/`departmentId`, never the member list.

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
| Invalid Target Readers on draft save | 400 `INVALID_TARGET_READERS` with `error.field` |
| Invalid approved readers / readers on a reject / readers on a legacy submission | 400 `INVALID_READERS` (with `error.field`) / `INVALID_REQUEST` / `READERS_NOT_SUPPORTED` |
| Approved readers wider than proposed | 409 `READERS_WIDENED` |
| Withdrawing a submission that is no longer pending | 409 `SUBMISSION_NOT_PENDING` |
| Change request for a document that is not published | 409 `DOCUMENT_NOT_PUBLISHED` |
| Approving a change request whose publication is no longer current, or a withdrawal while a newer version is prepared | 409 `PUBLICATION_CHANGED` |
| Request body fails schema validation | 400 `INVALID_REQUEST` ("The request is invalid.") |

The [Mainflow 3 error taxonomy](mainflow-3-phase-0-contract.md#error-taxonomy) is the target. Some current codes still differ: `SUBMISSION_CONFLICT` rather than `OPEN_RELEASE_CANDIDATE_EXISTS`, and 412 rather than 409 for a stale save.

## 10. Audit events

- **Drafts:** `SHARED_DRAFT_CREATED`, `SHARED_DRAFT_UPDATED`.
- **Submissions and decisions:** `KNOWLEDGE_SUBMITTED`, `KNOWLEDGE_SUBMISSION_WITHDRAWN`, `KNOWLEDGE_CHANGE_REQUESTED` (with `requestType`), `KNOWLEDGE_REVIEW_DECIDED` (with `requestType` for change requests) (with `selfApproved` when an Organization Admin decides their own submission).
- **Grants:** `REVIEWER_GRANT_CREATED` (including scope), `REVIEWER_GRANT_DEACTIVATED`.
- **Activation:** `KNOWLEDGE_INDEX_ACTIVATED`, written by the indexing pipeline.

## 11. Described by decisions, not yet implemented

- **Organization Admin cancel of a pending submission.** The Mainflow 3 contract also lets an Organization Admin cancel; only the author's withdrawal (T5.1) is implemented.
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
| **Library → My Contributions** | The author's drafts with status, reviewer note and history; "Withdraw request" with an in-place confirmation while a submission awaits review. |
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
| `0024_target_reader_selection.sql` | Target Readers: `reader_selection`, `selected_reader`, draft/submission selection columns, RLS and freeze triggers (operator-class). |
| `0025_review_approved_readers.sql` | Approved readers on the decision and submission, publication `reader_selection_id`, restrictive read policy, reviewer reader directory (operator-class). |
| `0026_review_list_authors.sql` | Reviewer-only submitter display names for the Reviews list (REV-02); 19 postgres-owned SECURITY DEFINER routines in total (operator-class). |
| `0027_document_category_relationships.sql` | Categories (five defaults per organization), document keywords/change description, frozen submission copies, `document_relationship`; adds the `seed_document_categories` trigger, 20 postgres-owned SECURITY DEFINER routines in total (operator-class, trusted superuser/BYPASSRLS only). |
| `0028_audience_to_target_readers.sql` | Forward-only backfill of current publications from legacy audiences to Target Readers, with the operator report function (operator-class, trusted superuser/BYPASSRLS only). |
| `0029_withdraw_pending_submission.sql` | Author withdrawal policy and the `PENDING_REVIEW → WITHDRAWN` (final) trigger (operator-class). |
| `0034_publication_change_requests.sql` | `request_type`, `request_reason`, `target_published_version_id`; change requests copy the published version's KM-v1 metadata; replaces two reviewed SECURITY DEFINER validators (operator-class, trusted superuser). |
| `0035_apply_publication_change_requests.sql` | Applies approved reader-change and withdrawal requests (`apply_publication_change`, 24 postgres-owned SECURITY DEFINER routines including Reader AI), `WITHDRAWN` release state, updated decision outcome check (operator-class, trusted superuser). |

Run migrations before starting an API build that depends on them. The 0022 code reads `reviewer_grant.scope` and `shared_submission.review_rule`. The 0024 code reads `shared_draft.draft_selection_id`, the submission selection columns and `publication_reader_selection_id()`.

**Target Readers evidence (0024):** `src/target-readers/policy.test.ts` and the T1.3/T1.4 request tests in `src/app.test.ts` run without a database. `src/target-readers/target-readers.integration.test.ts` and the Target Readers step in `src/db/repository.integration.test.ts` need `ARDEN_TEST_DATABASE_URL`. On 2026-11-11 they ran on a disposable local PostgreSQL 17 (Docker) after a clean apply of 0001–0025 and the CI ownership handoff: full API suite 234 passed (only the real-Supabase auth test skipped), five consecutive runs. Migration 0024 has not been rehearsed on a staging copy.

**Approved readers evidence (0025):** `src/target-readers/narrowing.test.ts`, the T2.1 cases in `src/knowledge/review-decision.test.ts` and the T2.1 request tests in `src/app.test.ts` run without a database. The T2.1 scenario in `src/db/repository.integration.test.ts` (widening refused with no decision/audit rows, narrowing, as-proposed copy, replay, legacy path, immutability, reviewer directory, activation and RLS/API reading) needs `ARDEN_TEST_DATABASE_URL`; it passed in the 2026-11-11 local PostgreSQL run above, and an end-to-end smoke through the running API (draft readers → submit → narrowed approval) passed. Not rehearsed on a staging copy. 0024/0025 add postgres-owned `SECURITY DEFINER` functions (18 in total); the operator repair script `deploy/release/security-definer-owner-repair.sql` still lists the reviewed 12 and will refuse until an operator reviews the new inventory.

**Categories, backfill and withdrawal evidence (0027–0029):** `src/target-readers/target-readers.integration.test.ts` covers T3.1 (five defaults for an organization created by the runtime role, no pre-0027 document without a category, member-only category reads, keyword rules, cross-organization category/link refusal, author-only links), T1.2 (dry run, apply and re-report of organization, department, partial-department, one-member group and empty audiences with zero wider readers; operator-only function) and T5.1 (author-only withdrawal, replay, audit, 409 for an approved submission, final state, no reviewer withdrawal). `src/app.test.ts` and `packages/ui/tests/withdrawSubmission.test.ts` cover the route and the My Contributions button. On 2026-11-11 the full API suite passed on the disposable local PostgreSQL 17 after applying 0027–0029 (244 passed, Supabase auth skipped; an earlier run hit the existing 5-second timeout once in the activation scenario under parallel load). 0027–0029 were also applied to the local anonymized staging sample (3 organizations → 15 categories, all 12 drafts categorized; it has no current publications, so 0028 mapped nothing there). Not rehearsed on a real staging copy; the repair script still lists 12 functions.

**Change-request evidence (0034–0035):** the T6.1/T6.2 cases in `src/knowledge/review-decision.test.ts` and the change-request route test in `src/app.test.ts` run without a database. `src/target-readers/target-readers.integration.test.ts` covers requests (not published, another member, reason/readers rules, replay, conflict, unchanged pointer, queue type, rejection, integrity trigger) and approvals (withdrawal removes the pointer and hides the document, released submission `WITHDRAWN`, audit type, repeated application refused, republishing as a new submission; reader change applies new readers to the same version; stale request refused). Reconciled with staging Reader AI 0032, preserving applied history; new directory/change migrations are 0033–0035. Direct calls to `apply_publication_change` are refused outside the review trigger, including replay of an older approved selection after later narrowing. Full-chain CI and staging-copy rehearsal remain release gates, not inferred from unit tests.

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
