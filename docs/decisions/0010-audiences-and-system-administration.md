# 0010: Audience access and Arden system administration

Status: partially superseded for Organization Admin review authority and review outcomes by [decision 0011](0011-permission-aware-publication-and-semantic-documents.md), and for classification routing, primary-department responsibility and reviewer scopes by [0013](0013-audience-breadth-review-levels.md), [0014](0014-author-owns-shared-drafts.md) and [0015](0015-organization-wide-reviewer-grants.md). Original text below is historical where superseded.
Date: 2026-10-20
Decision owner/approval: task owner explicitly approved the audience and Arden System Admin boundaries
Implementation: partial — canonical APIs and migration foundation implemented; database rehearsal and System Admin UI remain
Supersedes: [0004 role-tagged published audiences](0004-role-tagged-published-audiences.md), the custom-role audience portions of [0005 organization membership](0005-mainflow-1-organization-membership.md), and [0009 custom-role scopes](0009-custom-role-scope-and-owner-defaults.md)

## Context and requirement

The current implementation uses organization-local custom roles with one configurable permission,
`PUBLISHED_CONTENT_VIEW`, to represent published-content audiences. Search follows VIEW, private
access follows ownership, reviewer authority uses a separate grant, and organization administration
uses the protected Org Admin capability. The remaining custom-role abstraction therefore represents
a set of readers rather than a reusable authorization role and makes the product, API and schema
harder to explain.

Arden also needs a platform administrator belonging to the Arden operations team. This administrator
is outside every customer organization and must not become a content superuser.

## Options and tradeoffs

- Keep custom RBAC roles: preserves the current schema, but exposes a misleading permission editor
  with only one useful permission and continues to mix reader groups with administrative capability.
- Replace custom roles with audiences: models readership directly and keeps review, administration
  and ownership independent. It requires a forward data migration and client/API contract changes.
- Use only direct per-user grants: simple for one document but operationally expensive, difficult to
  audit at organization scale and prone to stale grants.

## Decision

### Organization authorization

- Active organization membership is the ordinary Member capability; no configurable Member role is
  required.
- Org Admin remains a protected organization capability. It manages members, departments, audience
  groups and reviewer grants, but does not implicitly read content or review submissions.
- Reviewer authority remains an explicit, revocable, department/classification/tag/time-scoped
  `reviewer_grant`. A reviewer may inspect an authorized immutable submission, but approval does not
  make the reviewer a reader of the resulting publication.
- Private content remains owner-only. No administrator, audience or reviewer grant opens a private
  original.

### Published-content audiences

- An audience answers only who may read a publication and its authorized derivatives. It grants no
  administration, review, edit or publication capability.
- V1 audience kinds are `ORGANIZATION_ALL`, `DEPARTMENT_ALL` and `GROUP`. Direct-member audiences are
  out of scope for V1.
- An audience group belongs to one organization, has no permission switches, and contains active
  organization memberships.
- A Department publication requires both an audience match and active membership in its target
  department. Audience groups never bypass the Department boundary.
- At Share/Prepare Submission time the author selects responsible department, publication scope,
  target department when applicable, classification and one or more audiences.
- An author may target only audiences they can currently read. Hidden audience groups are not listed.
- Submit freezes the audience identifiers with the immutable version/hash and policy metadata.
  Reviewers approve that exact snapshot or request revision; they do not silently edit its audience.
- Approval is blocked if the author is no longer eligible to target the audience or the audience is
  no longer enforceable.
- Read, search, graph, citation, AI/RAG and contribution-copy operations recheck the current audience.
  Membership, department or group revocation takes effect on subsequent requests.

### Arden System Admin

- The user-facing name is **Arden System Admin**; the code capability is `INSTANCE_ADMIN` to avoid
  confusing it with organization roles.
- An instance administrator belongs to the Arden operations team and has no organization membership
  by virtue of that capability.
- Instance administrators manage installation health/configuration, organization lifecycle, global
  account state, system audit and controlled Org Admin recovery.
- Instance administration never grants private or published content access, review, publication,
  search/RAG access, impersonation, audience membership or organization membership.
- The first instance administrator is provisioned through a controlled one-time bootstrap. Later
  administrators are granted by an active instance administrator. The last active administrator
  cannot be revoked.
- Emergency content recovery, if ever required, is a separate future break-glass decision and is not
  part of `INSTANCE_ADMIN`.

## Boundaries and consequences

The target model separates `system_administrator`, protected organization administration,
`reviewer_grant`, `audience`/`audience_group_membership`, and owner-private access. Generic custom-role
and configurable permission endpoints disappear. The existing role tables may remain only as a
temporary compatibility bridge during an expand/migrate/contract rollout; they are not the product
or API source of truth after cutover.

System administration uses a separate `/api/v1/system/*` boundary and a separate UI surface. An Org
Admin cannot call it. System administrators do not enter organization workspace selection unless
they independently receive an ordinary organization membership, which is outside the system-admin
capability.

## Verification and rollout

Follow the phased plan in
[audience and system administration implementation](../engineering/audience-system-admin-implementation.md).
Required evidence includes migration/backfill checks, author-target eligibility, hidden-group
non-enumeration, Department intersection, group/member revocation, reviewer-without-readership,
Org/System Admin non-bypass, cross-organization denial and last-instance-admin protection.

## Rules and documentation updates

- [Product](../../PRODUCT.md)
- [Architecture blueprint](../../ARDEN_BLUEPRINT.md)
- [Security and data rules](../engineering/security-and-data.md)
- [Mainflow 2 workflow](../engineering/mainflow-2-workflow.md)
