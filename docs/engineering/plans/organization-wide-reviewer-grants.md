# Plan: organization-wide reviewer grants

> Implementation plan for a coding agent (Codex). Written 2026-10-26 from a design discussion with the repository user, who approved the recommendations below. Status: **implemented in the working tree on 2026-10-26; PostgreSQL verification remains pending**.

## 0. Before you start

- Follow `AGENTS.md`. In particular, apply §1 (fetch and read current main), §6 and §9, and read `docs/engineering/code-quality.md`, `docs/engineering/security-and-data.md` and `docs/engineering/technology-guide.md`.
- Branch: `feat/ard-16-knowledge-workflow-updates`. It has **uncommitted work for decision 0014** (responsible department = author's primary department):
  - `apps/api/src/{app.test.ts,db/repository.ts,knowledge/policy.ts,knowledge/policy.test.ts}`
  - `packages/ui/src/{knowledge/ServerKnowledgeFeaturePage.tsx,knowledge/readerSelection.ts,shared/api-client.ts,styles/island-knowledge.css}`
  - `packages/ui/tests/readerSelection.test.ts`, `DESIGN.md`, `docs/decisions/0014-author-owns-shared-drafts.md`

  **Do not revert or discard it.** Ask the user whether to commit 0014 separately before you begin. Do not commit, push or deploy without the user's explicit instruction.
- Read these decision records first: `docs/decisions/0010` (audiences; readers ≠ reviewers), `0011` (Organization Admin may decide and self-approve with `selfApproved` audit), `0013` (classification removed from authoring; review level from audience breadth; interim phase 1a), `0014` (author's primary department owns the draft).

## 1. Goal and accepted rules

An Organization Admin can grant a member authority to review **knowledge that the whole organization reads**.

| Frozen readers of the snapshot | Who may decide |
|---|---|
| Department audience, or groups only | An active grant with scope `DEPARTMENT` for the snapshot's responsible department |
| Includes the `ORGANIZATION_ALL` audience ("organization-wide") | An active grant with scope `ORGANIZATION` |
| Any snapshot | Organization Admin, unchanged from 0011 |

Decisions the user accepted:

1. **Scopes are disjoint.** An `ORGANIZATION` grant reviews only organization-wide snapshots. A `DEPARTMENT` grant never reviews an organization-wide snapshot, except under the transition rule in item 4.
2. **One reviewer decides.** There is no two-step review in this change.
3. **Unchanged checks still apply to both scopes:** grant status `ACTIVE`, the validity window, team/project tag match, and no self-review for ordinary reviewers.
4. **Transition.** Submissions that already exist when the migration runs (`review_rule = 'LEGACY'`) keep their old rule:
   - An organization-wide legacy submission may be decided by an `ORGANIZATION` grant **or** by the old rule (a `DEPARTMENT` grant of the responsible department with level `SPECIALIST`/`SENIOR`).
   - Legacy `CONFIDENTIAL`/`RESTRICTED` snapshots keep their classification rule unchanged. `RESTRICTED` still needs `SPECIALIST`/`SENIOR`, which an `ORGANIZATION` grant (level `STANDARD`) does not satisfy.
   - New submissions (`review_rule = 'GRANT_SCOPE'`) follow only the table above.
5. **Levels leave the product.** The UI stops asking for `STANDARD`/`SPECIALIST`/`SENIOR`, and new grants store `STANDARD`. The `level` column stays until a later contraction, because legacy `RESTRICTED` snapshots still depend on it.
6. **The responsible department is unchanged** (0014): the author's primary department owns the content. Only review authority moves to organization scope.

Out of scope: two-step review, per-person audiences, dropping the classification or level columns, and deployment.

## 2. Database — new migration `apps/api/migrations/0022_organization_reviewer_grants.sql`

Migrations run in filename order (`apps/api/src/db/migrate.ts`) and are recorded in `public.arden_schema_migrations`. Read the latest definitions of everything you change (migrations 0010, 0016, 0018, 0019) before writing.

1. **`reviewer_grant`:**
   - `ADD COLUMN scope text NOT NULL DEFAULT 'DEPARTMENT'` with `CHECK (scope IN ('DEPARTMENT','ORGANIZATION'))`.
   - `ALTER COLUMN department_id DROP NOT NULL`, plus `CHECK ((scope = 'DEPARTMENT') = (department_id IS NOT NULL))`. The composite FK `fk_reviewer_grant_department` does not fire for NULL; confirm this.
   - Add an index on `(organization_id, scope, status)`.
   - The existing RLS policies (`reviewer_grant_self_read/admin_read/admin_insert/admin_update`) do not depend on department and need no change; verify.
2. **`shared_submission`:**
   - `ADD COLUMN review_rule text NOT NULL DEFAULT 'LEGACY'` with `CHECK (review_rule IN ('LEGACY','GRANT_SCOPE'))`. Adding the column back-fills existing rows with `'LEGACY'`.
   - Then `ALTER COLUMN review_rule SET DEFAULT 'GRANT_SCOPE'`, so every later insert uses the new rule without changing the insert in `repository.ts`.
   - Check that the snapshot-immutability trigger (`protect_flow2_submission_snapshot`, and any later replacement) still blocks updates of frozen columns. Add `review_rule` to the protected set if that trigger lists columns explicitly.
3. **`actor_has_reviewer_grant(uuid, uuid, text, text, text)`:** `CREATE OR REPLACE` with the **same signature**, so the roughly 15 RLS policies and triggers that call it keep working without being rewritten.
   - Change the department predicate to `(g.department_id = p_department_id OR g.scope = 'ORGANIZATION')`.
   - Keep the classification and level predicates.
   - This is deliberately broader than the product rule. The TypeScript policy (§3) is the precise gate, and every review read/decide path goes through it (`listAssignedReviews`, `getAssignedReview`, `decideReview` in `repository.ts`).
   - Write a short SQL comment explaining this, and record it in the decision record as known debt to tighten during schema contraction.
4. **Availability check:** add `organization_has_active_reviewer_grant(p_organization_id uuid) RETURNS boolean`, `LANGUAGE sql STABLE SECURITY DEFINER SET search_path = arden, pg_temp`.
   - It returns whether an active, currently valid `ORGANIZATION` grant exists, and only when the caller is an active member of that organization. Use `current_setting('arden.actor_id')` the way existing functions do.
   - It returns a boolean only, never identities or counts.
   - `REVOKE ALL … FROM PUBLIC; GRANT EXECUTE … TO arden_runtime`.
5. Do not modify Supabase-owned schemas.

## 3. API — `apps/api`

**`src/knowledge/policy.ts`:**
- Add `scope: "DEPARTMENT" | "ORGANIZATION"` to the grant type. `departmentId` becomes `string | null`.
- Add `reviewRule: "LEGACY" | "GRANT_SCOPE"` to the submission type, next to the existing `audienceBreadth`.
- Rewrite the non-admin branch of `canRespondToSubmission` into small, named pure helpers. Keep the existing actor, status, policy-version, self-review, validity and tag checks.
  - `LIMITED` breadth: `grant.scope === "DEPARTMENT" && grant.departmentId === submission.departmentId`.
  - `ORGANIZATION_WIDE` breadth: `grant.scope === "ORGANIZATION"`, or (`reviewRule === "LEGACY"` && a `DEPARTMENT` grant of the responsible department with level `SPECIALIST`/`SENIOR`).
  - Legacy classification checks (grant lists the classification; `RESTRICTED` needs `SPECIALIST`/`SENIOR`) stay as they are.
  - Anything other than an explicit `LIMITED` breadth stays fail-closed (organization-wide).
- Keep the Organization Admin branch unchanged.

**`src/db/repository.ts`:**
- `submissionSelect` / `SharedSubmissionRow`: select `s.review_rule`, and map it in `reviewAuthorizationFromRow`.
- `loadActorReviewerGrants`, `ReviewerGrantRow`, `mapReviewerGrant`, `listReviewerGrants`: select and map `scope`.
- `ReviewerGrantInput` / `ReviewerGrantRecord`: add `scope`; `departmentId: string | null`; `level` becomes optional on input (store `'STANDARD'` when omitted).
- `createReviewerGrant`:
  - For `DEPARTMENT`, keep the active-department check.
  - For `ORGANIZATION`, require `departmentId === null`.
  - Insert `scope`. Include `scope` in the audit `details_json`.
- `getKnowledgeOptions`: add `organizationReviewerAvailable: boolean` by calling the new SQL function.

**`src/app.ts`, `POST …/knowledge/reviewer-grants`:**
- Body adds `scope` (enum, default `DEPARTMENT`). `departmentId` is required when the scope is `DEPARTMENT` and forbidden (400) when it is `ORGANIZATION`. `level` is optional.
- Return `scope` in the response and the list.

**Tests — follow the existing style; positive and negative cases:**
- `src/knowledge/policy.test.ts`:
  - A department grant decides a limited snapshot and is denied an organization-wide one.
  - An organization grant decides an organization-wide snapshot, is denied a limited one, and is denied after expiry, on a tag mismatch, and on its own submission.
  - Legacy organization-wide: decided by an organization grant, or by a department Specialist/Senior; a department Standard is denied.
  - Legacy `RESTRICTED`: an organization grant is denied and a department Specialist is allowed.
  - Unknown breadth fails closed.
  - Organization Admin is unchanged.
- `src/knowledge/review-queue.test.ts` and `review-decision.test.ts`: update the fixtures; add an organization-grant queue case.
- `src/app.test.ts` (fake repository):
  - An organization-scope grant is created without a department.
  - Organization scope with a department → 400.
  - Department scope without a department → 400.
  - Options expose `organizationReviewerAvailable`.
- `src/db/repository.integration.test.ts` (real PostgreSQL; runs only with `ARDEN_TEST_DATABASE_URL` pointing to an `arden_test_*` database):
  - The migration applies.
  - An organization-grant holder sees organization-wide pending submissions in the queue and can decide them, but not department ones.
  - The availability function returns `false`, then `true`.
  - Legacy rows have `review_rule = 'LEGACY'` and new submissions have `GRANT_SCOPE`.
  - If no such database is available, say so explicitly in the report; do not claim database verification.

## 4. UI — `packages/ui`

- **`src/shared/api-client.ts`:** `ReviewerGrant` gains `scope` and `departmentId: string | null`. `createReviewerGrant` sends `scope` and omits `level`. `KnowledgeOptions` gains `organizationReviewerAvailable?: boolean` (optional, for older servers).
- **`src/organization/OrganizationAdminPage.tsx`** (Reviewer access tab):
  - New grant form: a scope choice "One department / Whole organization" (segmented control or radios, accessible). It hides the department select for organization scope. Remove the Level select.
  - `canGrant`, the scope preview text and the overlap warning account for scope.
  - Grant list: the "COVERS" column shows the department name or "Whole organization".
- **`src/organization/AdminDetailIslands.tsx`:** `grantCoverageLabel` is based on scope instead of level. The member detail grant summary shows "Whole organization" or the department name. Update `packages/ui/tests/adminDetailIslands.test.ts`.
- **`src/knowledge/ServerKnowledgeFeaturePage.tsx`** ("Before you submit"):
  - For organization-wide readers, show "Everyone in the organization can read it, so an organization reviewer decides."
  - When `organizationReviewerAvailable === false`, show a warning: "No organization reviewer yet. Ask an Org Admin to grant one."
  - Limited readers keep "A reviewer from {department} decides."
  - Reviews frozen facts: "Review level" becomes "Reviewed by": "Organization reviewer" or "{department} reviewer". Legacy `RESTRICTED` stays labelled as needing Specialist/Senior.
- Fix the copy that says "no one can approve their own submission" to say "no reviewer can approve their own submission" (0011).
- Follow `DESIGN.md`: island tokens, accessible labels, keyboard focus. Shared UI must work in web and desktop.

## 5. Documentation

- New `docs/decisions/0015-organization-wide-reviewer-grants.md` (status accepted, approval = repository user's request on 2026-10-26; the project lead confirms in the PR). It should record:
  - It supersedes the "Specialist/Senior of the responsible department" rule for organization-wide snapshots in 0013, and the product use of grant levels.
  - The rules, the transition, and the known debt (the broader SQL function; tighten it during schema contraction).
  - Evidence obtained vs not obtained.
- Update `docs/decisions/0013-audience-breadth-review-levels.md` with a superseded-in-part note linking 0015.
- Update `PRODUCT.md` (reviewer-level sentence), `DESIGN.md` (Administration and Knowledge descriptions), `docs/engineering/mainflow-2-workflow.md` (grant scoping) and `docs/engineering/security-and-data.md` (review authority).
- Update `docs/engineering/open-questions/review-authority-and-ownership.md` §2–§3 to mark these questions as resolved by 0015.

## 6. Verification (report exactly what ran)

```sh
pnpm --filter @arden/api typecheck
pnpm --filter @arden/api test
pnpm --filter @arden/ui typecheck
pnpm --filter @arden/ui test
pnpm --filter @arden/web build
pnpm --filter @arden/desktop typecheck
```

- Run the repository integration suite with `ARDEN_TEST_DATABASE_URL` pointing to an `arden_test_*` database when available. Otherwise report "not verified on PostgreSQL".
- Do not run migrations against any hosted slot, staging or production database.
- Deployment to the user's development slot (`pnpm dev:remote --slot <slot>`) is the user's step, after review.

## 7. Done when

- An Org Admin can create a "Whole organization" grant without a department. The holder sees and can decide organization-wide submissions from any department, but not department-limited ones.
- A department grant can no longer decide new organization-wide submissions. Legacy pending ones follow the transition rule.
- Authors see who will review and are warned when no organization reviewer exists.
- All checks in §6 pass. Docs are updated. Any check that could not run is named in the report.
