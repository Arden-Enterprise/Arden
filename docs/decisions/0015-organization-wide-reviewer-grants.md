# 0015: Organization-wide reviewer grants

Status: accepted
Date: 2026-10-26
Decision owner/approval: originally requested by the repository user on 2026-10-26; explicitly confirmed by the requesting maintainer on 2026-10-29 after comparison with main `be27d2c`, including disjoint grant scopes, Org Admin authority and legacy pending compatibility. No separate team consultation is claimed.
Implementation: implemented in this checkout; real-PostgreSQL migration and RLS evidence not yet obtained
Supersedes in part: [0013](0013-audience-breadth-review-levels.md), specifically the Specialist/Senior responsible-department rule for organization-wide snapshots and the product use of reviewer levels

## Context

Audience and review authority are separate. An `ORGANIZATION_ALL` audience means every active organization member may read the published snapshot, but it previously routed review to a Specialist or Senior grant in the author's responsible department. That made a department reviewer the final authority for an organization-wide release and exposed three reviewer levels in the product even though Specialist and Senior had identical behavior.

The responsible department remains the author's primary department under [0014](0014-author-owns-shared-drafts.md). This decision changes only which grant may decide a frozen submission.

## Decision

Reviewer grants have one of two disjoint scopes:

| Frozen readers | Ordinary reviewer authority |
| --- | --- |
| Department audience, or groups without `ORGANIZATION_ALL` | An active `DEPARTMENT` grant for the responsible department |
| Includes `ORGANIZATION_ALL` | An active `ORGANIZATION` grant |

- An Organization Admin may still decide any submission and may self-approve with `selfApproved` audit evidence, as accepted in [0011](0011-permission-aware-publication-and-semantic-documents.md).
- Group composition never changes who reviews: a group-only snapshot is reviewed by the responsible department even when the group spans several departments. The user confirmed this on 2026-10-29, rather than treating cross-department groups as organization-wide or adding a second review step.
- An `ORGANIZATION` grant does not review department/group-only submissions. A `DEPARTMENT` grant does not review new organization-wide submissions.
- One eligible reviewer decides. This change does not introduce a second approval step.
- Both grant scopes retain active membership, grant status, validity window, team/project tag matching and ordinary-reviewer self-review checks.
- New grants store the legacy level value `STANDARD`, but level is no longer a product choice. The column remains temporarily for legacy classification rules.
- The authoring UI warns when an organization-wide audience is selected and no currently valid organization grant exists. The availability response is boolean and never reveals reviewer identities or counts.

## Transition

Migration 0022 marks existing submissions `LEGACY` and defaults later submissions to `GRANT_SCOPE`.

- A legacy organization-wide submission may be decided by an Organization grant or by a Specialist/Senior Department grant for its responsible department.
- Legacy `CONFIDENTIAL` and `RESTRICTED` classification checks remain. In particular, a Standard Organization grant cannot decide a legacy `RESTRICTED` submission.
- New submissions use only the disjoint grant-scope rule above.

This preserves pending work without allowing a department grant to acquire authority over newly submitted organization-wide knowledge.

## Database boundary and known debt

`actor_has_reviewer_grant(uuid, uuid, text, text, text)` keeps its legacy signature because existing RLS policies and triggers call it. The database function therefore treats an Organization grant as a broad review prerequisite: its arguments do not include the frozen audience or `review_rule`, so it cannot enforce the disjoint product rule by itself. Queue, detail and decision repository paths apply the exact TypeScript policy before returning content or recording a decision.

This broader SQL gate is accepted temporary debt. During classification/level schema contraction, replace it with a database gate that receives or derives the frozen grant scope, then test every runtime path under `arden_runtime` before removing the TypeScript compatibility rule.

## Evidence and rollout

- **Obtained:** API policy, queue, decision and HTTP tests cover scope separation, legacy transition, validity/tags/self-review and Organization Admin behavior. UI tests cover scope-based grant labels. API/UI tests and typechecks, the web production build and desktop typecheck pass in this checkout.
- **Not obtained:** `ARDEN_TEST_DATABASE_URL` was unavailable, so migration 0022, the availability function and real RLS behavior are not verified on PostgreSQL. The integration suite contains the cases but remains skipped.
- Do not apply this migration to a hosted slot until it passes on a disposable `arden_test_*` database. Deployment remains a separate user-approved step.

## Consequences

- Organization-wide release authority can be delegated explicitly without giving that reviewer authority over department-only material.
- Reviewer administration becomes simpler: scope, optional tag filters and validity are visible; levels are hidden.
- The `level`, `classification` and `classifications` columns remain only for legacy compatibility and require a later contraction migration.

## References

- [0010: Audiences and system administration](0010-audiences-and-system-administration.md)
- [0011: Permission-aware publication lifecycle](0011-permission-aware-publication-and-semantic-documents.md)
- [0013: Audience-breadth review levels](0013-audience-breadth-review-levels.md)
- [0014: Author owns shared drafts](0014-author-owns-shared-drafts.md)
- `apps/api/migrations/0022_organization_reviewer_grants.sql`
- `apps/api/src/knowledge/policy.ts`
