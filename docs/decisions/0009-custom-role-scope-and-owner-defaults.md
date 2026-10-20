# 0009: Custom-role scopes and owner-private defaults

Status: superseded
Date: 2026-10-14
Decision owner/approval: branch owner, explicit Phase 0 approval
Implementation: partial; policy migrations and configurable API/UI implemented, Flow 2 matching remains
Supersedes / superseded by: supersedes custom-role contribution/private permissions and inherited scope assumptions in earlier slice documents; superseded by [0010 audience access and Arden system administration](0010-audiences-and-system-administration.md)

## Decision

- V1 configurable permissions contain only `PUBLISHED_CONTENT_VIEW`. Search follows VIEW.
  No configurable SEARCH, contribution, private, reviewer, publisher or administration permission.
- Roles belong to an organization. Assignments have Organization or one Department scope.
  Scopes do not inherit in either direction. Department readership additionally requires
  active membership in the target active department. A matching audience role must supply active VIEW.
- Private capability depends on active account/organization/membership plus ownership, not on
  a custom role. Administration never overrides ownership. Legacy private permission rows may
  remain, but do not control the owner boundary after the matching API deployment.
- Sharing one's saved private version is a member default. The accepted target Share workflow
  creates an immutable review snapshot, not an editable shared workspace. Share changes,
  stable document lineage and per-document published version numbers remain integration work.
- Reviewer grants remain department/classification-scoped. Final approval publishes automatically.
  Author proposes classification; an authorized information owner/reviewer confirms it.
- No custom DENY, AI, export or management permissions are enabled.
- `ALL_MEMBERS` is a server-managed Organization audience, not a configurable role. Active
  organization membership is its only grant. It has no assignments, is hidden from role
  administration, cannot target Department publications, and never opens private content.

## Migration and verification

`0011_custom_role_policy_foundation` adds role configuration version, replaces the three
owner-private RLS policies, and changes publication audience checks to exact scopes.
It refuses databases with current publications until reviewed scope/audience backfill exists.
It does not delete or rewrite existing grants, assignments, snapshots or publications.

`0012_all_members_organization_audience` creates one reserved organization-local audience marker
with VIEW for each organization and for future organization bootstrap. It updates audience
validation and publication reads so an active member can read an Organization publication tagged
`ALL_MEMBERS` without an assignment. Exact custom/default-role assignment remains mandatory for
all Department publications. The marker cannot be configured or assigned.

The user-approved shared development database was backed up and 0011 committed through Coolify
using the existing schema owner. The initial non-owner attempt rolled back. No new DB was created;
authentication/container configuration and pre-existing unsaved Coolify changes were untouched.
Backup archive listing was readable; a full restore has not been rehearsed.

Migration 0012 was later committed to the same `arden-hk` development database with the schema
owner. Verification found one active marker and VIEW grant for its one Organization, with zero
marker assignments. A PostgreSQL-user attempt was denied before mutation and rolled back.

The rollback-only [SQL rehearsal](../../tools/roles/policy-rehearsal.sql) passed on the real runtime role:
owner without assignments inserts/reads private workspace and draft; another member cannot
read them even with administration context; ALL_MEMBERS grants only active Organization members;
neither assignment scope inherits; removing VIEW denies access.
Fixtures rolled back with zero rehearsal users and the original organization count.
This is not complete RLS, live auth/API/UI or end-to-end evidence.

## Rollout and remaining work

API-private default SQL and the server-managed custom-role API/UI are implemented locally but not
deployed to the hosted backend. The UI exposes only VIEW, exact assignment scope, optimistic
configuration versions, deactivation and revocation; private/Share/reviewer capabilities remain
outside the configurable catalog. Old hosted API checks can still deny valid owners until updated.
The shared hosted API/database target is aligned with the database that received migration 0011.
The feature branch must still be synchronized to that API before live testing; operational
identifiers stay in the private access profile.
Any checkout running migrations against this DB must include 0011; an older checkout will
intentionally fail its unknown-migration safeguard. Share the migration file and coordinate numbering.

Before full Flow 2 acceptance, coordinate with the Flow 2 owner to match Share metadata,
the implemented ALL_MEMBERS audience contract, immutable submission creation, stable document
identity, version numbering and misclassification containment.
Do not use default Department roles to simulate an Organization-wide audience.
