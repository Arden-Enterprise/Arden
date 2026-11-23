# Audience and System Admin implementation and migration plan

Accepted contract: [decision 0010](../decisions/0010-audiences-and-system-administration.md).

Implementation status (2026-11-23): Phases 0-3 and the 0017 audience foundation remain as previously recorded. The approved least-privilege System Admin refinement adds dedicated account registration, a one-time first-manager bootstrap, manager-only lifecycle APIs, narrow report aggregates, AI telemetry and the shared web/desktop System Console in migration 0062. Application implementation and unit/request tests are local to `feat/system-console-least-privilege`; PostgreSQL migration, runtime-role, concurrency and live provider rehearsals remain pending. The current migration/operator inventory must include 0062 before any deployment. Phase 5 remains separate; legacy audience-role compatibility is not changed by this work.

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

Decision 0010 was refined by the requesting user on 2026-11-23. The current Phase 4 deliverable is
the limited read-only monitoring Console and separately protected manager API, not general
organization/account lifecycle, installation configuration or service control.

- `INSTANCE_ADMIN` authorizes read-only reports; `MANAGE_SYSTEM_ADMINS` separately gates administrator
  listing, grant, revoke and manager-capability changes. New grants are monitoring-only.
- Allow a verified Auth session to register its Arden profile without organization membership or
  admin privilege. No-workspace onboarding can finish without creating an organization. A one-time
  operator command assigns both capabilities to the selected first admin; subsequent assignments
  use the manager-only API.
- Recheck active Arden account, current capability, and absence of all memberships on every request.
  Serialize grant/activation and membership creation; enforce the invariant in API and PostgreSQL.
- Provide only aggregate Overview, organization status/details, five reports and sanitized health.
  Do not expose content reads, raw document/user data, organization mutation or service controls.
- Protect the last active admin and last manager; audit grant, revoke and manager changes.
- Coordinate Core and Arden-AI usage contract v1, idempotent provider event writes, versioned price
  book, answer feedback and Flow 4 maintenance analysis telemetry.
- Build one read-only System Console for web and desktop with 7/30/90/custom date selection and
  maximum 50-row pagination.

Exit criteria:

- A monitor can read only the approved report surface; only managers can call admin-lifecycle APIs.
- Org Admin and ordinary sessions cannot enumerate or mutate system administration.
- No active System Admin has an organization membership, including through concurrent create/accept
  flows. The last active admin and manager remain protected.
- Runtime-role PostgreSQL tests establish the actual SELECT/write boundary; synthetic tests alone do
  not complete this phase.

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
