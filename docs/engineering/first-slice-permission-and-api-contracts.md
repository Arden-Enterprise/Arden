# First-slice permission, data, and API contract

Status: accepted for the synthetic-account/private-note implementation slice; broader org administration remains out of scope
Date: 2026-10-05
Scope: organization membership context and owner-private notes for the first backend slice

This document is the accepted contract for the first backend slice. It maps the team-agreed conceptual ERD/SQL onto verified identity, current membership/role authorization, and owner-private note operations. It describes the API and database boundary now implemented in source; the UI's org-admin and knowledge transitions remain sample previews and do not grant server authority.

The API has Supabase-backed Arden sign-in/sign-out endpoints, `/api/v1/me`, private draft routes, the initial reviewed PostgreSQL migration, and a protected file-backed note-storage adapter. Supabase Auth owns identities and sessions; Arden keeps organization and permission data in its domain PostgreSQL schema. A real-PostgreSQL/RLS integration test is gated by `ARDEN_TEST_DATABASE_URL`; this environment could not run it because Docker Desktop's database engine is unavailable. A live synthetic Supabase account and dedicated project are still required for provider verification. See [ADR 0002](../decisions/0002-first-slice-private-notes-contract.md) and active [ADR 0001](../decisions/0001-supabase-and-hybrid-development.md).

## Assessment of the supplied database and API drafts

The supplied `Arden_PostgreSQL_Schema.sql` describes the broader agreed product schema: user identity, organization/department hierarchy, role/policy tables, versioned drafts, review/publication, knowledge, vector chunks, AI responses/citations, and audit events. The team agreement makes it the design baseline; it does not by itself mean the file has been validated as a migration for every target database or that every feature must be implemented in the first slice.

Specific alignment gaps to resolve before using it:

- It defines `user_account.password_hash`; the first-slice migration omits that field because Supabase Auth owns password hashes. Arden's `user_account.user_id` stores the verified Supabase user UUID; the domain database does not access Supabase's internal Auth schema.
- The ERD and SQL model private work as `private_workspace` → `draft_document` → immutable `draft_version`. The first-slice API uses this model rather than introducing a parallel `private_notes` table. The user selected persistent file/object storage on Coolify for note bodies; `draft_version.source_uri` will resolve within the configured private storage boundary.
- It contains tenant-consistency triggers, but no `ENABLE ROW LEVEL SECURITY` or `CREATE POLICY` statements. Consistency triggers do not authorize a caller to read a row; application checks and the approved database defense-in-depth policy still need definition.
- It includes future policy, publication, AI, and vector records. Their existence in the agreed target schema does not mean their API behavior belongs in the first implementation slice.

The supplied `API-List.txt` is a broad endpoint inventory to implement feature by feature. Its generic document routes did not specify owner-private behavior, listing, or immutable versions; this contract now defines and implements that first slice. Its `/api/v1/health/*` paths still differ from the health routes present in the API.

The SQL can be used to initialize a clean, disposable local domain database after validating it against the agreed target version and reconciling the password column with the Supabase Auth boundary. For the first slice, implement only the workspace/draft/version paths and the permissions/contracts they need; defer API behavior for the other agreed schema areas. Never use local initialization as authorization to apply the SQL to the shared Coolify database.

## First-slice boundary

The first backend slice covers:

- A verified actor's organization membership context.
- One private workspace for each `(organization, owner)` pair.
- Create, list, read, and update operations for that owner's private notes.
- Runtime request validation, tenant and owner scoping, safe denial behavior, audit metadata, and concurrent-update detection.

It does not cover organization bootstrap, invitations, membership/role administration, departments, shared knowledge, contribution, review/publication, graph/search, AI retrieval, attachments, exports, note deletion, or private-data recovery. Those need their own authorization and lifecycle decisions. The UI's sign-in, organization setup, member administration, review, and handover screens remain previews until their server policies are designed and implemented.

## Terms and trusted request context

- **Actor**: the stable user subject from a verified authentication session. The browser never chooses the actor ID.
- **Organization**: the tenant boundary for this slice. An organization ID in a URL selects a requested scope; it grants no access by itself.
- **Membership**: the server-owned link between an actor and an organization, including status and role metadata.
- **Private workspace**: the owner's personal workspace within one organization. The agreed SQL makes it unique per `membership_id`.
- **Private draft/note**: the stable `draft_document` owned through its `private_workspace`; each saved content change creates an immutable `draft_version`. It is not shared Arden knowledge.
- **Request context**: a verified actor plus a requested organization whose membership is looked up by the server on every request. A UI-selected organization is a navigation choice, not a permission claim.

Supabase Auth is the identity and credential provider for the pilot. It owns password hashes and issues access/refresh tokens; Arden's Fastify BFF stores them in HttpOnly cookies for web and the encrypted desktop cookie jar. The API validates the current user with Supabase Auth and maps that UUID to `user_account.user_id`; it never accepts the actor from a client field. Arden performs account, organization, role, and content authorization in PostgreSQL/API policy. Arden does not expose public signup in this slice; project signup settings must be restricted until an approved invitation/bootstrap flow exists. Fastify tests use a synthetic adapter; the live Supabase integration test has not been run. Missing, invalid, revoked, or expired authentication yields no actor context; provider outage fails closed. Do not substitute a development header, body field, or sample identity in a hosted environment.

## Permission matrix

Every decision is default-deny. The role names below mirror the frontend preview vocabulary only; exact role catalog, assignment rules, department scope, and administrative capabilities remain unresolved. No role grants access to another actor's private notes.

| Actor and organization context | Own workspace / own note | Another actor's note in same organization | Note in another organization | Membership administration in this slice |
| --- | --- | --- | --- | --- |
| No verified session | Deny (`401`) | Deny (`401`) | Deny (`401`) | Deny (`401`) |
| Active member with a recognized membership context and role permitted for this feature | Create/list/read/update own notes, subject to workspace ownership | Deny as unavailable (`404`) | Deny as unavailable (`404`) | Not provided |
| Manager / Knowledge Reviewer | Only the member's own notes when the membership role is permitted for this feature | Deny as unavailable (`404`); manager status is not a private-note grant | Deny as unavailable (`404`) | Not provided |
| System Admin | Only the member's own notes when the membership role is permitted for this feature | Deny as unavailable (`404`); admin status is not a private-note grant | Deny as unavailable (`404`) | Not provided |
| No membership, pending assignment, suspended membership, unknown status, or unknown role | Deny note operations; organization is unavailable (`404`) | Deny as unavailable (`404`) | Deny as unavailable (`404`) | Not provided |
| Service, migration, or worker identity | No user-note access through this slice | Deny | Deny | Not provided |

The `GET /api/v1/me` endpoint may report the caller's own membership status so the UI can explain a pending or suspended state. Such reporting does not grant access to organization content. For private-draft routes, the membership must be active and recognized at request time.

## Accepted follow-on policy: role audiences for published content

The private-note slice above remains owner-only and does not implement shared-content audiences. Separately, the accepted product rule is that Org Admins create and assign organization-scoped custom roles. For a published item, at least one active role held by the member must match an audience role; that match permits viewing, authorized search, and submitting a separate contribution copy. It never exposes or edits the private original, and it does not publish the contributed copy. See [decision 0004](../decisions/0004-role-tagged-published-audiences.md). Role administration, published-content enforcement, RAG, and contribution workflows remain unimplemented.

### Required denial cases

The server must reject or safely hide at least these attempts:

1. Missing, expired, malformed, or revoked session.
2. A caller who supplies another `actorId` in a body, query, or header.
3. A guessed note ID owned by another member, even when the caller is a manager or System Admin.
4. A note ID paired with the wrong organization ID, including a note from an organization where the caller is also a member.
5. A non-member, pending, suspended, or unknown membership attempting note access.
6. A client-selected organization without a matching current membership.
7. A stale note version, missing update precondition, malformed payload, unknown writable field, empty update, or request exceeding agreed size limits.
8. A database failure or ambiguous identity lookup. Fail closed; do not return sample data or a fabricated success.

For note IDs and organization-scoped resources, use the same `404` response for missing and inaccessible records. Do not reveal titles, owners, counts, or existence through errors, timing-dependent follow-up data, logs returned to the client, or list pagination.

## First-slice mapping to the agreed data model

The ERD/SQL names below are the baseline. This section limits implementation to the first slice; it does not propose a second note schema.

| Agreed record | Relevant SQL fields/constraints | First-slice use |
| --- | --- | --- |
| `user_account` | `user_id`, profile/status fields | Stores the verified Supabase Auth user UUID as an external identity link. No cross-service Auth schema foreign key or duplicate password hash. Arden checks this account's active status and derives actor ID from the verified Supabase session. |
| `organization` | `organization_id`, name/slug/status | Tenant root. Setup/creation policy remains outside the private-note endpoints. |
| `organization_membership` | `membership_id`, `organization_id`, `user_id`, status; unique `(organization_id, user_id)` | Resolve the current actor's organization membership on every request. Only an active membership may access that organization's private workspace. |
| `private_workspace` | `workspace_id`, `membership_id`, name/status; unique `membership_id` | One private workspace per membership, matching the ERD. Manager/admin role does not grant another membership's workspace. |
| `draft_document` | `draft_id`, `workspace_id`, title/description/status, `current_version_no` | Private note's stable identity and mutable metadata. Every lookup is scoped through its workspace and owner membership. |
| `draft_version` | `draft_version_id`, `draft_id`, `version_no`, `source_uri`, `mime_type`, `content_hash`, creator membership; unique `(draft_id, version_no)` | Immutable saved content snapshot. An update creates a new version and advances `current_version_no`; it does not overwrite an earlier snapshot. `source_uri` is an opaque API-generated object reference; note text is stored on a protected persistent Coolify volume as `text/plain`, with SHA-256 integrity verification. |
| `audit_event` | Organization, actor membership, event type/time, target and details fields | Successful create/update records actor, organization, action, target/version, decision, timestamp, and request correlation metadata. Do not record note content in audit details or ordinary logs. |

Use the existing composite constraints/triggers in the SQL as integrity rules, and verify their behavior on PostgreSQL 17. They are not substitutes for request authorization. The current SQL targets PostgreSQL 15+; repository local Compose uses PostgreSQL 17 with pgvector.

Private drafts are server-side and hosted on Coolify, not stored only in each user's browser/device. The selected content backend is persistent file/object storage behind the API. The implementation will use the protected local-volume storage direction in the blueprint; `source_uri` is an opaque server-generated storage key and never a client-supplied path. Writes must ensure the immutable object is durable before the API acknowledges the matching database version. Configure a persistent mount and storage root; never write note bodies into an image layer or web static root. The UI preview edits plain text; use `text/plain` and the SHA-256 content hash. Proposed size limits remain explicit implementation bounds.

Current API implementation bounds: title at most 200 Unicode code points, body at most 100,000 UTF-8 bytes, JSON request at most 128 KiB, list `limit` defaults to 50 and accepts 1–100, and cursor at most 1 KiB. NUL characters and invalid types are rejected. A blank/whitespace title normalizes to `Untitled private note`. These are operational request limits and can be revised before the API is deployed to real users.

### Data integrity and lookup rules

- Resolve every note through both the requested `organization_id` and a workspace owned by the authenticated actor. Do not fetch by note ID and filter in application memory afterward.
- Use restrictive foreign keys for organization/workspace relationships. Do not cascade-delete an organization or membership into private data until retention, departure, recovery, and backup behavior are decided.
- A private workspace is organization-scoped. Whether users may keep standalone workspaces outside an organization remains open in the blueprint.
- `membership_id`, `organization_id`, IDs, versions, and audit actor are server-controlled. Update requests cannot change them. Resolve the owner by joining `private_workspace.membership_id` to `organization_membership.user_id` and require that `user_id` to match the verified actor.
- Apply explicit SQL column lists and parameterized queries. Runtime application roles must not be superusers or `BYPASSRLS`; row-level security is defense in depth and must be tested with the real non-bypass role and pooled-connection context. Application authorization remains mandatory.
- Note create/update and its audit metadata commit in one transaction. Failed writes produce no successful audit event. Denial/security diagnostics use safe metadata and do not expose private content.
- There is no delete endpoint in this slice. Do not implement hard delete, soft delete, retention, or recovery by implication.

## API contract

Use JSON over the existing Fastify API prefix. All routes require a verified session except liveness/readiness health routes. Runtime schemas and the shared web/desktop client implement the response and validation contract below.

### `GET /api/v1/me`

Returns only the authenticated actor and that actor's organization memberships. It is not a general directory endpoint and does not accept an actor ID.

```json
{
  "actor": { "id": "<actor-id>" },
  "memberships": [
    {
      "organization": { "id": "<organization-id>", "name": "Example" },
      "status": "active",
      "roleCode": "employee"
    }
  ]
}
```

Return `401 UNAUTHENTICATED` when the session is absent or invalid. Omit organizations for which no membership record exists. This response may include the caller's own pending/suspended memberships for status display, but note endpoints still require an active membership. Clients may select one returned organization; every subsequent request revalidates it.

### Private draft/note resources

All note routes include the organization in the path. The server derives the actor from the verified session and authorizes active membership plus workspace ownership on each operation.

| Method and path | Success | Contract |
| --- | --- | --- |
| `POST /api/v1/organizations/{organizationId}/private-workspace/drafts` | `201 Created` | Proposed JSON body is `{ "title": string, "body": string }`; reject unknown fields. Store the body through the approved private-content storage boundary, then create the `draft_document` and initial immutable `draft_version` transactionally. The owner membership comes from the session. Return draft representation, `Location`, and an ETag for the initial version. |
| `GET /api/v1/organizations/{organizationId}/private-workspace/drafts?limit=&cursor=` | `200 OK` | `limit` defaults to 50 and is 1–100; cursor is optional, opaque, and at most 1 KiB. List only the caller's drafts, ordered by `(updated_at DESC, draft_id DESC)`. Return `{ items, nextCursor }`; no global or organization-wide total. |
| `GET /api/v1/organizations/{organizationId}/private-workspace/drafts/{draftId}` | `200 OK` | Return only a `draft_document` in the requested organization whose workspace belongs to the caller. Include the current immutable version metadata and ETag. |
| `PATCH /api/v1/organizations/{organizationId}/private-workspace/drafts/{draftId}` | `200 OK` | Require `If-Match` for `current_version_no`. Create a new immutable `draft_version`, advance `current_version_no`, update mutable draft metadata, and append metadata audit event in one transaction. Return the new current version and ETag. |

The private-draft representation is:

```json
{
  "id": "<draft-uuid>",
  "organizationId": "<organization-uuid>",
  "title": "Untitled private note",
  "body": "Private text",
  "currentVersion": {
    "id": "<draft-version-uuid>",
    "version": 1,
    "mimeType": "text/plain",
    "contentHash": "<content-hash>"
  },
  "version": 1,
  "createdAt": "2026-10-05T09:00:00Z",
  "updatedAt": "2026-10-05T09:00:00Z"
}
```

Timestamps are RFC 3339 UTC strings; IDs are UUIDs. The response omits owner identity because the caller is always the owner. POST/PATCH use JSON. `body` is read only after authorization through the private-content storage boundary. The authenticated actor, workspace ID, version, timestamps, and organization ownership are never writable request fields.

`PATCH` is a partial update to editable draft metadata and content: omitted fields retain their values. A request with no writable field, unknown fields, invalid types, or content over the implemented limit is rejected. Each successful save creates a new `draft_version`; it never edits an existing version. Blank/whitespace title normalization follows the implementation bounds above.

The recommended ETag is a quoted monotonic version (for example, `"7"`). Missing `If-Match` returns `428 PRECONDITION_REQUIRED`; a stale precondition returns `412 VERSION_CONFLICT` without overwriting the newer value. The client then fetches the latest note and asks the user to reconcile. Do not automatically retry a stale update. This follows HTTP conditional request semantics ([RFC 9110, `If-Match`](https://www.rfc-editor.org/rfc/rfc9110.html#name-if-match); [RFC 6585, 428](https://www.rfc-editor.org/rfc/rfc6585.html#section-3)).

### Error envelope

Use a stable safe envelope, with no SQL, stack trace, hidden resource name, email, or note content:

```json
{
  "error": {
    "code": "VERSION_CONFLICT",
    "message": "This note changed. Reload it before saving again.",
    "requestId": "<correlation-id>"
  }
}
```

| Status | Code | Meaning |
| --- | --- | --- |
| `400` | `INVALID_REQUEST` | Malformed JSON, invalid ID/query, unknown property, empty patch, or schema validation failure. |
| `401` | `UNAUTHENTICATED` | No valid verified session. |
| `404` | `RESOURCE_NOT_AVAILABLE` | Organization, membership scope, workspace, or note is missing or inaccessible; intentionally non-enumerating. |
| `412` | `VERSION_CONFLICT` | `If-Match` is stale; no write occurred. |
| `413` | `REQUEST_TOO_LARGE` | Request exceeds the agreed transport/content limit. |
| `428` | `PRECONDITION_REQUIRED` | Update omitted the required `If-Match`. |
| `500` | `INTERNAL_ERROR` | Unexpected failure; safe message plus request ID only. |

Malformed entity tags return `400 INVALID_REQUEST`. Do not return `403` for a guessed private-note ID if doing so would reveal that the note exists. Create is not idempotent in this slice; clients must not automatically retry an uncertain POST. Reconcile by listing the caller's notes before offering a retry. If that UX is inadequate, add an actor- and organization-scoped idempotency record in a later change.

## Session, transaction, and audit invariants

For each request, construct the context in this order:

1. Verify the session using the configured auth adapter; derive the stable actor ID from that verified result.
2. Parse the requested organization ID as untrusted input.
3. Load the membership for `(organization_id, actor_id)` using a tenant-bound query. Require an allowed status and recognized context; otherwise deny.
4. For draft operations, join `draft_document` through `private_workspace` and `organization_membership`; require the membership's `user_id` to match the verified actor and the requested organization.
5. Perform the operation transactionally. Recheck the membership/ownership predicates in the data operation so a delayed or concurrent request cannot rely only on a stale UI decision.
6. On create/update, write an audit row containing actor, organization, action, target, outcome, timestamp, and request correlation ID. Do not log note payloads, authorization headers, cookies, or credentialed URLs.

The same policy must later be called by every new route, job, event, search, graph, export, citation, and AI context path that can expose notes. Those surfaces are explicitly outside this slice and must not become alternate access paths.

## Remaining decisions and operational verification

1. **Identity/bootstrap:** Supabase Auth sign-in/session validation through the Fastify BFF, `HttpOnly` web cookies, and desktop safeStorage are implemented. Arden does not expose sign-up; a live test still needs a preconfigured synthetic Supabase user in a dedicated project and matching Arden profile/membership fixtures. The first organization and first System Admin bootstrap mechanism remains open; there is no unauthenticated bootstrap route or account-provisioning UI in this slice.
2. **Membership lifecycle:** feature access requires an allowed membership role plus workspace ownership for private notes. The accepted full role catalog, meaning of `pending_assignment`, who may assign/suspend/restore members, and what happens to notes after suspension, departure, account deletion, or organization closure remain open.
3. **Private-data recovery and retention:** whether any customer administrator may recover private notes, retention/deletion schedule, backup restoration behavior, and audit retention. Until decided, no administrator or manager bypass is defined.
4. **Personal spaces:** organization-only workspaces for the slice; standalone personal-only accounts remain unresolved.
5. **Content format/storage and validation:** accepted and implemented for plain-text notes using a protected persistent volume, opaque server-generated `source_uri`, and SHA-256 hash. The current request limits are recorded above; production still needs an actual Coolify mount and backup/restore exercise.
6. **Conflict UX:** confirmation of ETag/`If-Match` behavior and how the UI presents simultaneous edits.
7. **Database enforcement:** reviewed domain SQL migration and non-bypass `arden_runtime` role mechanism are implemented. Supabase Auth-owned schemas remain outside Arden migrations. Production requires the API database login to have membership in `arden_runtime` and a separate privileged migration connection. Real PostgreSQL/RLS verification remains unrun; `ARDEN_TEST_DATABASE_URL` must point to a disposable, already-migrated `arden_test_*` database. Drizzle Kit domain schema authoring remains planned.
8. **Initial organization/member API:** authenticated organization creation, first Org Admin/department-default-role setup, Org Admin-scoped department/custom-role/member administration, generic Supabase sign-up, and hashed-token SMTP invitation create/resend/revoke/accept routes have been added after the original private-note slice. A basic live administration screen uses these routes. They currently have synthetic Fastify request tests; migration 0002 and RLS behavior have not been verified against PostgreSQL. Member status/exit and Org Admin succession/last-admin lifecycle remain outstanding.

The out-of-scope items remain unresolved and are not enabled by the sample UI or this implementation. Do not expand the current API to cover them until their server policies are accepted and tested.

## Verification required when implemented

- Fastify injection cases for every success, validation, unauthenticated, inactive-membership, cross-organization, cross-owner, unknown-field, oversized-body, missing-precondition, and stale-version result.
- Pure policy tests showing that employee, manager/reviewer, and System Admin each reach only their own notes; changing a role does not broaden note visibility.
- Disposable PostgreSQL tests for composite tenant constraints, concurrent conditional updates, transaction/audit atomicity, RLS with the real non-bypass runtime role, and pooled request-context cleanup.
- Tests for database outage and transaction failure that prove no fabricated success and no partial note/audit write.
- When the UI is connected, browser interaction tests for empty/list/error/save/conflict states and identity/organization switching; sample data must not be used as a fallback for API failure.

The API tests cover HTTP behavior using a synthetic Supabase provider and in-memory repository; they do not prove live account provisioning or PostgreSQL RLS behavior. The protected-file storage and web/desktop API-client tests use isolated synthetic data. No live Supabase Auth session, real PostgreSQL migration/RLS, Coolify deployment, or browser/desktop end-to-end test has run in this environment.

## References

- [Arden security and data rules](security-and-data.md)
- [Arden technology guide](technology-guide.md)
- [Arden architecture blueprint](../../ARDEN_BLUEPRINT.md)
- [Frontend Mainflow 1 preview handoff](mainflow-1-preview.md)
- [PostgreSQL 17 constraints](https://www.postgresql.org/docs/17/ddl-constraints.html)
- [PostgreSQL 17 row security](https://www.postgresql.org/docs/17/ddl-rowsecurity.html)
- [HTTP `If-Match` semantics, RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html#name-if-match)
- [HTTP 428, RFC 6585](https://www.rfc-editor.org/rfc/rfc6585.html#section-3)
