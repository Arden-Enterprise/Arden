# 0010: Audience access and Arden system administration

Status: partially superseded for reader group management by [decision 0039](0039-remove-reader-group-management.md), for Organization Admin review authority and review outcomes by [decision 0011](0011-permission-aware-publication-and-semantic-documents.md), for Organization Admin governance access (metadata catalog, audited inspection, direct withdrawal) by [0023](0023-organization-admin-governance-access.md), for classification routing, primary-department responsibility and reviewer scopes by [0013](0013-audience-breadth-review-levels.md), [0014](0014-author-owns-shared-drafts.md) and [0015](0015-organization-wide-reviewer-grants.md), and for System Admin scope/capabilities by the 2026-11-23, 2026-11-26 and 2026-11-27 refinements below. Original text below is historical where superseded.
Date: 2026-10-20
Decision owner/approval: task owner explicitly approved the audience and Arden System Admin boundaries
Implementation: partial — System Console, isolated System Admin identity, APIs and migrations 0071–0074 are implemented on `feat/system-console-least-privilege`; a disposable-PostgreSQL role/RLS integration test ran on 2026-11-27. Shared-target rehearsal, rollout and deployment remain unverified
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

The original installation-administration bullets in this section are historical where they grant
organization lifecycle, global account state, installation configuration or general support
capabilities. The following accepted refinement is the current contract.

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

#### Least-privilege refinement (2026-11-23)

Decision provenance: the requesting user explicitly approved the implementation plan in the current
Arden task on 2026-11-23. The requester is the decision owner and brainstorm originator for this
refinement; exact identity is not included in this public record. The implementation contributor
prepared this record after inspecting staging checkout `d47ddc5abe136bae38c7d662135af555f175f10f` and fetched main
`9fa3d34a19a559318eff87b4487f2113e6ee5a49`. This approval explicitly refines the two superseded points above while retaining
the existing audience, review, ownership and no-content-bypass contracts.

- A System Admin is a dedicated, verified Arden profile with no organization membership. Profile
  registration creates no organization or admin capability.
- `INSTANCE_ADMIN` permits read-only System Console reports. `MANAGE_SYSTEM_ADMINS` is a separate
  capability for listing, granting, revoking and changing that capability. New grants default to
  monitoring-only. The Console has no admin-grant UI.
- Every protected request rechecks current Arden account status, current system-administrator status,
  current manager capability where required, and the absence of all organization memberships. Token
  claims and UI state do not authorize these requests.
- System Admins can view organization status and approved aggregate reports only. They cannot create,
  edit, suspend or reactivate organizations; manage global account state; access configuration,
  tenant content, raw tenant data, private originals, review, publication, impersonation or service
  controls.
- Granting/activating System Admin and creating organization membership serialize on one database
  lock. Database triggers enforce the no-membership invariant for account activation, System Admin
  lifecycle changes and membership writes. All manager changes are audited; the last active
  administrator and last active manager are protected.
- *Superseded by the 2026-11-26/27 refinements:* a one-time operator bootstrap selected an active
  eligible account and established the first manager; later grants used the manager-only API.
  First-Time Setup on the isolated identity now replaces this bootstrap.
- **First-time setup & isolated identity refinement (2026-11-26):** Approved directly by the
  requesting maintainer for open-source self-hosted operation. System Admin credentials and audit
  events are stored in a dedicated PostgreSQL schema (`arden_system`) accessed only through a
  dedicated non-bypass role (`arden_system_auth`), completely separate from Supabase Auth and
  `arden.user_account` (`arden_runtime` receives zero privileges on `arden_system`). Initial
  provisioning uses a First-Time Setup UI (`POST /api/v1/system/setup`) protected by two layers:
  (1) a PostgreSQL advisory-locked check closing setup permanently once any active manager exists,
  and (2) a one-time operator setup token (`ARDEN_SYSTEM_SETUP_TOKEN` or a startup-generated token
  printed once to the API console) preventing unauthorized takeover before setup completes. On a
  fresh installation with no organizations, Arden opens First-Time Setup automatically; on an
  already-running development/staging installation with existing organizations, operators can still
  initialize the first System Admin via `/system/setup` without disrupting active members. System
  Admin sign-in (`/api/v1/system/auth/*`) uses a dedicated HMAC-signed HttpOnly session cookie
  non-interchangeable with ordinary user sessions.
- **Isolated-only identity and hardening refinement (2026-11-27):** Approved by the requesting
  maintainer in the current Arden task, after reviewing the PR #96 AI and maintainer review findings
  and an explicit choice between the options below. The requester is the decision owner; the
  findings came from automated reviewers and the PR review; exact identities are not recorded here.
  Implementation was prepared by the implementation contributor on `feat/system-console-least-privilege`.
  - *Isolated only, not a bridge.* A System Admin exists only in `arden_system.administrator`.
    Member (Supabase) sessions never open the Console or any `/api/v1/system/*` route, and `/me`
    reports no System Admin capability. Legacy `arden.system_administrator` rows neither grant Console
    access nor close setup; they are kept and retain the database no-membership guard. Setup closes
    permanently once any isolated administrator row exists, even a revoked one. The
    `system-admin:bootstrap` command is retired. `MANAGE_SYSTEM_ADMINS` list/grant/revoke/capability
    APIs operate on isolated administrators. A grant creates a monitoring-only administrator with an
    initial password. Private Notes feedback analytics move into the Console as a read-only
    `INSTANCE_ADMIN` report. The Console report routine is executable only by `arden_system_auth`.
  - *Dedicated database login.* The API reaches `arden_system` only through
    `ARDEN_SYSTEM_AUTH_DATABASE_URL`, a login that is a member of `arden_system_auth` alone. Without
    it, production System Admin routes fail closed with 503, and member traffic never touches the role.
  - *Setup token.* Production requires an operator-supplied `ARDEN_SYSTEM_SETUP_TOKEN` of at least
    32 characters and never prints a generated token; development may still print one. Errors do not
    name the variable.
  - *Sessions and throttling.* System Admin sessions are server-side rows, so sign-out and revocation
    take effect on the next request. The cookie only names its session. Setup and sign-in attempts are
    throttled in a table shared by all API replicas. Password hashing uses scrypt N=32768, with a
    per-process cap on concurrent hashing.
  - *Usage telemetry is rollout-tolerant and best-effort.* A missing or malformed Arden-AI usage
    envelope, or an empty one from an operation that always calls a provider, is recorded as one
    deterministic incomplete-usage row, never as zero cost. A failed telemetry write is logged and
    never fails the user's answer, summary, analysis or index activation. Core therefore runs against
    an Arden-AI release without the usage envelope. Each answer rating has one source: chat ratings on
    the saved turn, Reader question ratings in `ai_answer_feedback`.
  - *Alternatives considered:* a legacy/isolated bridge with synchronized rows (rejected: conflicts
    with the 2026-11-26 isolation and doubles the identity model); strict Core/Arden-AI lockstep
    (rejected: deployment order would break every AI path); printing a generated token in
    production (rejected: container logs are not a secret channel); in-memory per-process throttling
    and stateless cookies (rejected: replicas and sign-out would not be enforced).
- System Console queries return explicit aggregates and anonymous quality references. They do not
  expose tenant content fields, individual names, prompts, answers, document text, raw document IDs
  or error text. Health reports return sanitized status/latency and queue counts only.
- AI usage and cost are estimates from a versioned service contract and price book. Missing usage or
  price data is incomplete, never a zero-cost assertion. Feedback is a minimal positive/negative
  marker; Flow 4 maintenance cases are the canonical document-error source.

Implementation evidence: see [F06 acceptance coverage](../product/identity-and-access.md#f06-installation-administration),
migrations [0071](../../apps/api/migrations/0071_system_console_least_privilege.sql),
[0072](../../apps/api/migrations/0072_system_admin_isolated_identity.sql),
[0073](../../apps/api/migrations/0073_grant_draft_version_size_update.sql) and
[0074](../../apps/api/migrations/0074_system_admin_isolated_lifecycle.sql), and the paired
Arden-AI contract changes. Synthetic application tests do not replace PostgreSQL runtime-role,
concurrency, migration, live provider, web browser or native desktop acceptance.

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
