# Audience and System Admin implementation and migration plan

Accepted contract: [decision 0010](../decisions/0010-audiences-and-system-administration.md).

Implementation status (2026-10-20): Phases 0-3 and the Phase 4 authorization/bootstrap/API foundation are implemented in application code and additive migration 0017. The separate System Administration UI remains pending until the database/RLS denial rehearsal passes. Typecheck and synthetic API/UI/desktop tests pass. PostgreSQL migration/RLS rehearsal is pending because Docker/PostgreSQL was unavailable. Phase 5 intentionally remains a later contraction after a verified compatibility window; legacy role-backed columns and shadow writes are not part of the public product/API contract.

## Safety and rollout rules

- Use forward-only migrations. Migrations 0001-0016 have reached a shared development database and
  must not be edited.
- Use expand -> backfill -> verify -> switch reads/writes -> contract. Do not drop legacy role data in
  the same release that first introduces audiences.
- Preserve immutable submission/publication snapshots and current audience behavior during backfill.
- Default-deny unknown audience kinds, missing targets, inactive memberships and cross-organization
  references.
- Do not deploy or run the migration on a shared target without a separately authorized backup,
  target verification and reviewed migration-owner procedure.

## Phase 0 - Contract and inventory

Deliverables:

- Accept decision 0010 and mark decisions 0004/0009 audience-role rules as superseded.
- Inventory every custom-role, `PUBLISHED_CONTENT_VIEW`, audience-role ID, role assignment, API, UI,
  desktop allowlist and test dependency.
- Record the migration compatibility boundary and denial matrix.

Exit criteria:

- No unresolved meaning for Member, Org Admin, Reviewer Grant, Audience or Instance Admin.
- The implementation inventory is complete by repository text search.

## Phase 1 - Additive canonical schema

Add:

- `system_administrator` for installation-level `INSTANCE_ADMIN` capability and lifecycle audit data.
- `audience` with `ORGANIZATION_ALL`, `DEPARTMENT_ALL` and `GROUP` kinds.
- `audience_group_membership` for explicit group membership.
- Stable organization/department managed audiences created during organization/department bootstrap.
- An explicit compatibility mapping from legacy organization-local audience roles to audiences.

Backfill:

- `ALL_MEMBERS` -> `ORGANIZATION_ALL`.
- Department default audience roles -> the corresponding `DEPARTMENT_ALL` audience.
- Other active organization-local VIEW roles -> `GROUP` audiences.
- Active role assignments -> audience-group memberships after tenant and membership validation.

Phase 1 is additive: old publication/submission audience IDs remain readable while the new canonical
records are verified. Ambiguous or cross-tenant legacy records fail migration rather than being
silently broadened.

Exit criteria:

- Clean install and populated upgrade succeed on a disposable PostgreSQL database.
- Backfill counts, tenant ownership, managed audience uniqueness and group membership are verified.
- No user-visible contract has switched yet.

## Phase 2 - Central audience policy and knowledge contracts

- Replace role/permission-based domain types with audience types.
- Rename client/server fields from `audienceRoleIds`/`audienceRoles` to `audienceIds`/`audiences`.
- Authoring options return only managed audiences and groups the current author can target.
- Submission and approval recheck author target eligibility and current audience enforceability.
- Publication read policy applies organization membership, Department intersection and group
  membership without role permissions.
- Search/RAG remain unimplemented, but their documented contract inherits the same check.

Exit criteria:

- Unit/request/database tests cover any-match readership, hidden groups, author eligibility,
  Department intersection, revocation, non-bypass and immutable audience snapshots.

## Phase 3 - Audience administration API and UI

- Replace `/roles`, `/permissions` and role-assignment APIs with `/audience-groups` and explicit group
  membership routes.
- Replace Roles & Permissions UI with Audience Groups. Remove the permission toggle and assignment
  scope selector; publication scope supplies the organization/department boundary.
- Update member details and authoring UI terminology.
- Keep a bounded compatibility response only when required by a supported old desktop client; record
  and remove it in Phase 5.

Exit criteria:

- Org Admin can create/update/deactivate groups and add/remove eligible members.
- Ordinary members and cross-organization actors receive non-enumerating denials.
- Web and desktop use the same contracts and route allowlist.

## Phase 4 - Instance administration foundation

- Add central `INSTANCE_ADMIN` authorization independent of organization context.
- Implement controlled first-admin bootstrap without a permanent unauthenticated endpoint.
- Add `/api/v1/system/*` read/mutation contracts for administrator lifecycle and organization/account
  operational state, starting with the smallest required set.
- Enforce no content joins, no impersonation, last-admin protection and system audit.
- Build the separate System Administration surface after API denial tests pass.

Exit criteria:

- Instance admins can perform approved operational actions but cannot read organization content.
- Org Admin and ordinary sessions cannot enumerate or mutate system administration.

## Phase 5 - Contract legacy RBAC storage

- Stop dual writes and remove compatibility mappings after all supported clients use audience APIs.
- Remove organization-local content roles, configurable content permissions and unused role
  assignments/access scopes.
- Retain only the smallest protected organization-admin representation, or migrate it to an explicit
  `organization_administrator` table if still role-backed.
- Remove obsolete code, tests, docs and desktop allowlist entries.

Exit criteria:

- Repository search finds no product/runtime use of Custom Role or `PUBLISHED_CONTENT_VIEW`.
- Clean install and populated upgrade pass; restore/rollback consequences are documented.

## Verification matrix

At minimum verify:

1. Active organization member reads `ORGANIZATION_ALL`; suspended/left member cannot.
2. `DEPARTMENT_ALL` requires active membership in the exact target department.
3. Group publication requires active group membership; removal revokes the next request.
4. Department + group requires both conditions.
5. Authors cannot enumerate or target a group they cannot currently read.
6. Leaving a target audience blocks approval of a pending submission.
7. Reviewer grant permits the exact review snapshot but not the resulting publication.
8. Org Admin and Instance Admin do not bypass private or published audience policy.
9. Cross-organization audience IDs fail closed without leaking names or existence.
10. The last active Instance Admin cannot be revoked.

