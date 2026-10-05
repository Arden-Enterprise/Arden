# 0002: First-slice organization and private-note contract

Status: accepted
Date: 2026-10-05
Decision owner/approval: implementation task owner confirmed the first-slice scope and key data/auth boundaries
Implementation: partial — Supabase Auth session integration, private-note storage, initial SQL migration, and web/desktop API integration exist; real PostgreSQL and live Supabase verification remain outstanding

Identity amendment: a temporary Better Auth amendment recorded in decision 0003 was superseded when the user relayed the leader's restored Supabase direction. Follow [decision 0001](0001-supabase-and-hybrid-development.md) for the current identity implementation. The API/session and owner-private note scope remains accepted.
Supersedes / superseded by: none

## Context and requirement

The first-slice task covers authenticated organization context and owner-private note create/list/read/update APIs. The task owner confirmed the team's SQL as the logical target schema, membership role checks, synthetic accounts for actual sign-in tests, `HttpOnly` web cookies, secure desktop storage, and a protected persistent file/object volume for saved note bodies. The leader's current Supabase direction is recorded in [decision 0001](0001-supabase-and-hybrid-development.md). The SQL covers more than this first slice; admin/invitation and shared knowledge behavior remain out of scope.

The product requires personal knowledge to remain private by default. Managers do not automatically gain access to private notes. Existing product/security direction also requires organization-bound identities, server-side authorization on every request, non-enumerating denials, audit metadata, and exact handling of update conflicts.

## Options and tradeoffs

1. **Ship the UI preview state as if it were server policy.** Fast to wire, but it would turn demo roles and transitions into unreviewed production authorization and still would not authenticate actors.
2. **Start with the agreed `private_workspace` → `draft_document` → `draft_version` model.** Implement a small end-to-end owner-private draft contract and make ownership boundaries testable. It depends on verified identity/membership context, while org bootstrap, invites, role administration, recovery, and retention remain outside scope.
3. **Build the entire Mainflow 1 backend at once.** Covers more screens but combines identity/bootstrap, invitations, administrative role rules, private data, review, and other unresolved policies; substantially increases migration and authorization risk.

## Decision

Adopt option 2 for the first backend contract:

- Require a verified actor and active membership in the requested organization for private-draft access.
- Use the agreed one-private-workspace-per-membership uniqueness rule; create it lazily with the first saved draft if team bootstrap permits.
- Allow an active member to create/list/read/update only their own drafts. Manager/reviewer and System Admin labels do not confer another member's private workspace access.
- Scope every draft lookup through organization membership and workspace ownership. Return a non-enumerating `404` for missing and inaccessible resources.
- Treat `draft_version` rows as immutable; a content update creates a new version and advances the draft's current version under optimistic concurrency (`ETag`/`If-Match`).
- Audit successful create/update metadata without recording private content. Defer delete, sharing, contribution, review/publication, AI, attachments, and administrative recovery behavior.
- Use Supabase Auth behind the Arden API, HttpOnly cookies for web and secure desktop storage; use preconfigured synthetic accounts for actual sign-in/session tests. The implementation uses a Fastify BFF because the clients are rich SPAs.
- Store note bodies as immutable files/objects in protected persistent storage on Coolify; use opaque server-generated `source_uri`, `text/plain`, and a SHA-256 hash in `draft_version`.

The team-agreed schema is the logical baseline for this slice. Supabase Auth owns credentials; the domain migration omits `user_account.password_hash` and stores the verified Supabase user UUID in `user_account.user_id` without assuming access to Supabase's internal Auth schema. Membership role checks and workspace ownership are both required; administrators do not gain another user's private notes. The API contract uses non-enumerating `404` denials, immutable versions, and `ETag`/`If-Match` conflicts. See the [contract design](../engineering/first-slice-permission-and-api-contracts.md) for the matrix, ERD mapping, request/response shapes, rejection cases, and remaining implementation limits.

## Boundaries and consequences

- Supabase Auth supplies the verified actor subject and owns password credentials; the browser cannot select an actor identity. Arden must not store or verify a duplicate password hash. The domain database stores the external Supabase UUID link only.
- The organization ID in a route is an untrusted selector and must be checked against the current membership on every request.
- Supabase Auth remains the accepted identity direction in the [architecture blueprint](../../ARDEN_BLUEPRINT.md). The API BFF adapter is implemented; live Supabase verification remains outstanding. The temporary Better Auth implementation is retained only as superseded history in decision 0003.
- PostgreSQL remains canonical metadata storage. The first implementation migration omits `user_account.password_hash`, adds the private-workspace read/write permission catalog, RLS policies, and a non-bypass `arden_runtime` role. It does not create or access Supabase-managed Auth tables. The migration is not applied to the developer/hosted database in this work.
- Do not add a parallel password store. Supabase Auth owns password credentials and supplies the verified subject.
- Synthetic pilot accounts must exercise the actual Supabase sign-in/session boundary. Private drafts are server-side on Coolify, with note bodies in protected persistent file/object storage.
- Web sessions use HttpOnly cookies. Desktop tokens use the approved secure native storage path; renderer `localStorage` is not used.
- The existing private-data recovery, retention, and standalone personal-space questions remain open; no admin bypass or cascading deletion is implied.

## Verification and rollout

Fastify request tests and storage/API-client tests cover a synthetic Supabase adapter. A gated live Supabase test exists but requires a dedicated project/account. A gated real-PostgreSQL repository/RLS integration test is implemented, but it was skipped because Docker Desktop's PostgreSQL engine was unavailable. The initial migration has not been applied to any database here. Live Supabase account verification, browser interaction checks, migration/RLS execution, and the Coolify mount/backup procedure remain outstanding.

## Rules and documentation updates

- Detailed proposal: [first-slice permission and API contracts](../engineering/first-slice-permission-and-api-contracts.md)
- Existing authoritative requirements: [security and data rules](../engineering/security-and-data.md), [technology guide](../engineering/technology-guide.md), [product](../../PRODUCT.md), and [architecture blueprint](../../ARDEN_BLUEPRINT.md)

## References

- [PostgreSQL 17 row security](https://www.postgresql.org/docs/17/ddl-rowsecurity.html)
- [HTTP `If-Match`, RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html#name-if-match)
- [HTTP 428, RFC 6585](https://www.rfc-editor.org/rfc/rfc6585.html#section-3)
