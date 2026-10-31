# 0013: Derive review level from audience breadth instead of classification

Status: accepted
Date: 2026-10-25
Decision owner/approval: implementation was requested by the repository user on 2026-10-25. On 2026-10-29 the requesting maintainer explicitly approved adopting Khoi's audience-breadth, primary-department and disjoint reviewer-scope rules after comparison with inspected main `be27d2c`. Earlier brainstorm attribution is unchanged; separate team consultation was recommended but is not claimed.
Implementation: partial — interim phase 1a (server-side breadth rule, optional classification in the API, classification inputs removed from the UI). Phase 1b (database rule) and phase 2 (schema contraction) are not started.
Supersedes: [0008](0008-three-level-knowledge-classification.md); the classification parts of [0010](0010-audiences-and-system-administration.md) (reviewer grants scoped by classification; the author selecting a classification at Share/Prepare Submission)
Superseded in part by: [0015](0015-organization-wide-reviewer-grants.md), which replaces the Specialist/Senior responsible-department rule for organization-wide snapshots with a disjoint Organization grant and removes reviewer levels from the product UI. The old level and classification rules remain only for `LEGACY` submissions until schema contraction.

## Context and requirement

Decision 0008 introduced `INTERNAL`, `CONFIDENTIAL` and `RESTRICTED` so classification could influence reviewer eligibility. In the current implementation it does two things:

- The author picks the classification for their own draft (default `INTERNAL`), and it is frozen on the submission.
- A reviewer grant lists the classifications it covers, and `RESTRICTED` additionally requires a `SPECIALIST` or `SENIOR` grant (`apps/api/src/knowledge/policy.ts`, `actor_has_reviewer_grant` in migration `0010`).

The project lead considers this routing unsound. The author chooses the label that decides how strictly their own work is reviewed, so under-classifying lowers the review bar. Decision 0008 also states that classification never grants read access: who can read is already decided by the audience. In the Mainflow 2 redesign, authors find the extra classification choice confusing next to the reader picker.

## Options and tradeoffs

1. **Keep three-level classification (status quo).** It gives a reader-facing sensitivity label and an existing routing rule. However, it is self-declared, it duplicates the audience decision in the author's flow, and reviewer grants carry an extra dimension that admins must maintain.
2. **Reviewer confirms or overrides the classification.** This would fix self-declaration, but decision 0010 and the immutable-snapshot rule forbid reviewers from silently changing a frozen submission. It would need a re-submission loop and adds reviewer work without changing who can read.
3. **Derive the review level from audience breadth (proposed).** The server computes the required reviewer level from the frozen audience, which the author cannot mislabel, and it measures the actual blast radius of a publication. The cost: there is no sensitivity label for readers or for future data-handling policies, and the change touches schema, API and policy.
4. **Option 3 plus an optional display-only "Sensitive" flag.** This keeps a visible warning without routing. Deferred: there is no current consumer, and adding it later is cheap.

## Decision

Adopt option 3.

### Review level rule

The required reviewer level is computed by the server from the submission's frozen scope and audience:

| Frozen readers | Required reviewer |
| --- | --- |
| Department scope (readers limited to the responsible department) | Any active grant for the responsible department (`STANDARD`, `SPECIALIST` or `SENIOR`) |
| Organization scope with group audiences only | Any active grant for the responsible department |
| Any submission whose audiences include the organization-wide audience (`ORGANIZATION_ALL`) | A `SPECIALIST` or `SENIOR` grant for the responsible department |

- Groups decide who reads, never who reviews. A group that spans departments does not change the reviewing department.
- The other existing grant constraints still apply unchanged: department, team/project tags, validity window, active status and the self-review prohibition for ordinary reviewers.
- The required level is frozen on the submission when it is submitted (for audit and stable queues) and rechecked at decision time.
- Organization Admin keeps the authority accepted in [0011](0011-permission-aware-publication-and-semantic-documents.md): they may decide, and self-approve as final authority with `selfApproved` audit evidence. This record does not change that.

### Classification is removed

- Authors no longer choose a classification. Reviewer grants no longer list classifications.
- Reader-facing classification labels (Library, reader, review screens) are removed. Readers rely on the audience and the document's content.
- `PRIVATE` remains a personal access scope, as before, and is unaffected.

### Pending RESTRICTED submissions keep the old rule

Submissions that are `PENDING_REVIEW` when the change ships are evaluated under the rule they were submitted with:

- A pending `RESTRICTED` submission still requires an active grant that lists `RESTRICTED` with level `SPECIALIST` or `SENIOR`.
- A pending `INTERNAL` or `CONFIDENTIAL` submission still requires a grant that lists its classification.

No pending submission may become reviewable by a lower level than when it was submitted. The rule is carried by the existing per-submission `policy_version`: version 1 means the classification rule, and version 2 means the audience-breadth rule. Each submission is evaluated with the rule of its own frozen version. The current equality check against a single effective policy version must change accordingly, so version 1 submissions are not blocked. Already published versions are unaffected: visibility depends only on audience and the active pointer.

### Out of scope / unresolved

- Organization-specific extra review steps (for example two reviewers for organization-wide security procedures) remain unresolved, as in 0008.
- Whether a future display-only sensitivity flag is needed for AI provider opt-in, export or DLP policy. Until a consumer exists, none is added.
- Restricting the responsible department to the author's own active departments is a separate proposal and not decided here. Today the server accepts any active department.

## Boundaries and consequences

- **Policy owner:** the API (`apps/api/src/knowledge/policy.ts`) and the database eligibility function remain the single authority. Clients only display the derived requirement; they never compute eligibility.
- **Data:**
  - The `classification` columns on `shared_draft`, `shared_submission` and `published_knowledge_version`, and `reviewer_grant.classifications`, become unused, then removed.
  - Draft and submission idempotency hashes currently include the classification (`repository.ts`). Phase 1 keeps a constant value so retries still hash identically. Phase 2 must change the hash inputs together with the column removal.
- **API:**
  - The classification enum fields in draft, submission, grant and option schemas are deprecated in phase 1 (accepted and ignored, or fixed to `INTERNAL`), then removed in phase 2.
  - Phase 2 is a breaking change for any external client. There is no known external client: web and desktop share `packages/ui`.
- **AI service:** this repository does not send classification to indexing. The sibling `Arden-AI` repository was not inspected and must be checked for classification use before phase 2.
- **Admin effect:** grants become simpler (department, level, tags, validity). Organizations that relied on `RESTRICTED` to force senior review must instead narrow the audience, or accept that only organization-wide audiences force `SPECIALIST`/`SENIOR`.

## Verification and rollout

### Phase 1a — interim, implemented on 2026-10-25 (no migration)

The database still enforces the classification rule: `actor_has_reviewer_grant` in the RLS policies and triggers, and the `policy_version = 1` check constraint. Raising the policy version or changing that function needs a migration, and no disposable PostgreSQL was available to rehearse one. Phase 1a therefore only adds restrictions and never relaxes one:

- **Policy:** `canRespondToSubmission` (`apps/api/src/knowledge/policy.ts`) keeps every existing check, including the grant's classification list and the `RESTRICTED` level rule.
  - It adds the breadth rule: an organization-wide submission needs a `SPECIALIST` or `SENIOR` grant.
  - Only an explicit `LIMITED` breadth avoids the elevated requirement, so missing facts fail closed.
  - Organization Admin authority from 0011 is unchanged.
- **Breadth:** the shared submission query computes `organization_wide` as Organization scope plus an `ORGANIZATION_ALL` audience in the frozen audience list.
  - That kind is valid only at Organization scope, and `audience_member_read` shows it to every active member, so it is detected even when a reviewer cannot see the snapshot's group audiences.
  - The queue, the detail and the decision paths all use this value.
- **API:** `classification` is optional on draft creation (copy from a private note, new text and PDF) and defaults to `INTERNAL`.
  - `classifications` is optional on reviewer-grant creation and defaults to all three, so a new grant is never narrowed by classification.
  - Supplied values are still validated against the enum.
- **UI:**
  - The classification controls are removed from New shared draft, Before you submit, Contribute a copy and the New grant form. Before you submit states the derived reviewer requirement.
  - The grant list shows what each level covers.
  - The Reviews frozen facts show the review level.
  - Classification chips remain only where legacy content already carries `CONFIDENTIAL` or `RESTRICTED`.
- **Pending legacy submissions:** the TypeScript policy and the database both still apply the classification rule, so a pending `RESTRICTED` or `CONFIDENTIAL` submission keeps its old requirement. The breadth rule can only add a requirement; it never removes one.
- **Effective rule:** an action needs both the database and the TypeScript rule. An existing grant that does not list `INTERNAL` therefore still cannot review new `INTERNAL` submissions until it is replaced or phase 1b ships.
- **Evidence obtained:**
  - API unit tests: Standard allowed for limited breadth; Standard denied and Specialist/Senior allowed for organization-wide; unknown breadth fails closed; legacy `RESTRICTED` and `CONFIDENTIAL` still require their grant coverage and level; Organization Admin unchanged; no self-review.
  - HTTP tests: drafts and grants are created without a classification, with `INTERNAL` and all-levels defaults, and an invalid value is rejected.
  - UI client test for an omitted classification.
  - **Not obtained:** the `organization_wide` SQL expression runs only against real PostgreSQL. The repository integration suite skips without `ARDEN_TEST_DATABASE_URL`, so it is unverified until it runs on a disposable `arden_test_*` database.

### Phase 1b — database rule (not started)

- **UI (remaining):** remove the legacy classification chips from Library, reader, My Contributions and Reviews once no current publication carries a non-`INTERNAL` value.
- **API (done in 1a):** write `INTERNAL` for new drafts and all levels for new grants.
- **API and database (remaining):**
  - Add a migration that allows `policy_version = 2` and freezes the required level on the submission.
  - Bump new submissions to `policy_version = 2`.
  - Freeze the required level on the submission, and evaluate eligibility per policy version: server policy, `actor_has_reviewer_grant` and the review-queue query.
- **Tests (planned):**
  - **Allowed:** a Standard reviewer for a department or group-only submission; a Specialist/Senior reviewer for an organization-wide one.
  - **Denied:** a Standard reviewer for an organization-wide submission; a wrong department; tag mismatch; an expired grant; ordinary self-review.
  - **Legacy:** a pending version 1 `RESTRICTED` submission still denies a Standard grant and allows Specialist/Senior.
  - **Admin:** Organization Admin behaviour is unchanged from 0011.
  - **Database:** real disposable PostgreSQL tests for the eligibility function and RLS, not only mocks.

### Phase 2 — schema contraction

- Do this only after no version 1 submissions remain pending (decided, withdrawn, or explicitly re-submitted by their authors).
- Add a migration that drops the classification columns, their check constraints and the `classifications` grant column, and updates triggers, functions and idempotency hashes.
- Rehearse it on a disposable database for both a clean install and a populated upgrade before any shared slot.
- Remove the deprecated API fields.

### Recovery

- Phase 1 is reversible: the columns still exist and the old rule remains in code for version 1.
- Phase 2 is not reversible without a backup; take one before applying it on any shared environment.

The phase descriptions above retain the earlier implementation checkpoints. The audience-breadth replacement is now explicitly confirmed; its final grant-scope rule is owned by decision 0015. Acceptance does not establish live migration or deployment.

## Rules and documentation updates (on acceptance)

- [PRODUCT.md](../../PRODUCT.md): replace the three accepted classification levels with the audience-breadth review rule.
- [ARDEN_BLUEPRINT.md](../../ARDEN_BLUEPRINT.md): update the review-policy and classification paragraphs and the "policy classification" pipeline step.
- [AGENTS.md](../../AGENTS.md) §2 item 5: updated on 2026-10-29 at the user's request to state the ownership and audience-breadth review rules (0014, 0015). Legacy classification values are described as stored data only.
- Mark [0008](0008-three-level-knowledge-classification.md) superseded and annotate the classification lines of [0010](0010-audiences-and-system-administration.md).
- [DESIGN.md](../../DESIGN.md): remove classification controls and chips from Knowledge, Reviews and Administration descriptions.
- [Security and data rules](../engineering/security-and-data.md) and the [operations guide](../engineering/operations.md): record the policy-version rule and the phase 2 migration procedure.

## References

- [0008: Three levels of knowledge classification](0008-three-level-knowledge-classification.md)
- [0010: Audiences and system administration](0010-audiences-and-system-administration.md)
- [0011: Permission-aware publication lifecycle](0011-permission-aware-publication-and-semantic-documents.md)
- `apps/api/src/knowledge/policy.ts` — current reviewer eligibility, including the `RESTRICTED` level rule
- `apps/api/migrations/0010_mainflow_2_submission_review.sql` — classification columns and `actor_has_reviewer_grant`
- `apps/api/src/db/repository.ts` — idempotency hashes that include the classification
