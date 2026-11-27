# Security, privacy, and data rules

These are application design and implementation requirements. The current backend also implements organization bootstrap, Org Admin-checked department/custom-role/member administration APIs, and hashed-token invitation create/resend/revoke/accept behind Supabase Auth and configurable SMTP. The new database flows have synthetic HTTP tests. Migrations 0003/0004/0005 and a rollback-only organization-bootstrap transaction were verified on Kiet Local `arden_dev_2`; the `/api/v1/me` membership read succeeds there. Invitation acceptance RLS was verified via rehearsal under `arden_runtime`. Live Supabase, SMTP delivery, and broader RLS paths remain unverified. Recovery, complete user lifecycle/last-admin handling, publication governance, live Coolify release deployment, and production security release evidence remain incomplete. Read [AGENTS.md](../../AGENTS.md), [the blueprint](../../ARDEN_BLUEPRINT.md), and the relevant [technology rules](technology-guide.md).

## 1. Trust model and truthful guarantees

- The customer controls the installation, infrastructure, database, backups, connectors, model endpoint, outbound network policy, and updates. Arden-operated services are optional, not a hidden prerequisite.
- Application privacy protects against unauthorized application users. Customer host/root/database administrators and any separately accepted recovery mechanism are different trust actors; server-side plaintext processing is not E2EE against them.
- Self-hosting does not automatically eliminate all egress. Model downloads, external connectors, remote embeds, updates, telemetry, crash reports, package registries, and optional providers need documented data flows and customer-controlled policy.
- Never claim an air gap, zero telemetry, offline revocation, secure deletion from backups, HA, compliance certification, or a performance/security guarantee without supporting implementation and verification.
- An already disclosed/exported answer cannot be recalled by server revocation. Revocation must prevent subsequent authorized access/processing, while cache expiry/retention/export behavior is explicitly documented.
- Threat-model changes before implementation if a feature adds a trust actor, network destination, native capability, persistence layer, recovery path, or broader audience. Record accepted decisions and corresponding tests.

## 2. Identity, organization scope, and authorization

The accepted contract is [decision 0010](../decisions/0010-audiences-and-system-administration.md). Owner-private access is fixed and owner-only. Published readership uses canonical managed organization/department audiences or explicit audience groups. Audience membership never grants administration, review, edit, or publish authority. ReviewerGrant is checked separately. A dedicated Arden System Admin has no organization membership or content bypass: `INSTANCE_ADMIN` grants read-only aggregate reports, while `MANAGE_SYSTEM_ADMINS` separately grants audited System Admin lifecycle access. Recheck current active account, current capability and no-membership state on each protected request; do not use token/UI state as authority. See the [F06 contract](../product/identity-and-access.md#f06-installation-administration).

Manual local Mainflow 1 testing may use the dedicated local adapter in `apps/api/src/auth/local-flow1-test.ts` only when startup verifies a loopback API, loopback PostgreSQL database named `arden_test_*`, synthetic `@example.test` identities, no Supabase configuration, and non-production mode. It supplies test authentication only; it is not identity proof and must never be exposed through a tunnel or pointed at shared/Coolify data. Its invitation mail sink never sends email. A no-login actor is automatically selected only for the dedicated Kiet Local `dev-2` API/database (`NODE_ENV=development`, PostgreSQL `postgres/arden_dev_2`, no Supabase config). Anyone with that slot's SSH access can act as the fixed synthetic Org Admin; therefore this mode is not authentication and must never be exposed through a public domain. Keep the API port loopback-bound behind the assigned SSH tunnel. Test writes persist. Without SMTP settings invitations are saved with no delivery; configuring all six SMTP settings enables real outbound invitation email in dev-2. Treat this as an external write: send only to intended test recipients and use a team-controlled sender account. The invite URL points to the developer's local frontend and is not reachable by invitees on other devices. No project-wide test-mode variable is used.

- Default deny. Authenticate requests and derive actor/organization scope from verified server context; validate requested organization membership rather than trusting client fields.
- Stable IDs, obscure URLs, hiding a button, filtering in the renderer, and a broad connector token are not access controls.
- Operational roles and content permissions are separate. Managers/admin UI roles must not implicitly grant read access to another user's personal workspace. Each personal workspace belongs to its user **within an organization**.
- Central domain functions determine actor + scope + object/version + action. Use them consistently from HTTP, jobs, events, search, graph, citation resolution, file download/export, AI, and native-cache access.
- Published Arden content may use `ORGANIZATION_ALL`, a matching `DEPARTMENT_ALL`, or an explicit `GROUP`. A verified active member with any one matching audience may view, search, and submit a separate contribution copy. Org Admin, ReviewerGrant, and System Admin are not implicit content grants.
- Test grants, membership removal, role changes, revoked/expired sessions, multiple organization memberships, and attempted cross-organization references. Unknown policy/source audience fails closed.
- Privileged workers/migration accounts do not replace end-user authorization. Use narrow service capabilities and explicitly trace the initiating actor where a task acts for someone.
- The notification dispatcher uses a separate non-bypass login that can `SET ROLE arden_notification_worker`; that role sees only notification envelopes and can update only outbox delivery-state columns. It has no grants on submissions, drafts, user content, or API session tables. Inbox reads and mark-read operations use `arden_runtime` with the current actor and organization context. Keep this boundary in the real-database worker test.
- RLS is defense in depth, not the sole policy layer. Test real runtime roles and pooled tenant context; development DB superuser success proves neither production denial nor RLS correctness.
- Cross-actor `SECURITY INVOKER` triggers and write policies must derive tenant ownership from an explicit organization column on the protected resource or from the currently authorized actor. Do not validate a reviewer action by joining the submitter's RLS-hidden membership, and do not create circular policy dependencies such as current-publication write -> published-version read -> current-publication read. Exercise the complete write under `arden_runtime`, including deferred constraints, because isolated statement or owner-role checks miss these failures.
- An Org Admin directory or reviewer-target lookup that joins `organization_membership` to `user_account` needs a separately scoped profile-read policy: the self-read policy alone silently drops other members. Migration 0015 allows profile reads only while the API's verified Org Admin transaction context is active and only for profiles with a membership in that transaction's organization. Keep ordinary member reads self-only, and test both tenant isolation and the actual reviewer-grant path under `arden_runtime`; do not disable RLS or expose a cross-organization directory.
- Denied/missing object responses should follow a deliberate non-enumerating contract. Never disclose forbidden names, paths, existence, counts, or source errors just to make debugging easier.
- Administration, recovery, export, grants, connector settings, invitations, review/publish, and external actions need auditable actor/scope/decision metadata. Audit access itself is permission-controlled.
- The System Console uses one approved aggregate SQL entry point and no runtime `SELECT` grants on content tables. Keep its report fields allowlisted, tenant data anonymous/aggregate, AI price/usage incomplete when evidence is missing, and health details sanitized. System Admin grant/membership writes must serialize and retain the database invariant; test the actual `arden_runtime` role and concurrency before release.
- Invitation bearer tokens are generated with cryptographic randomness, stored only as SHA-256 hashes, excluded from API responses/logs, and accepted once before expiry. For a valid pending token, the invite landing page reports only whether that invitation's address has an account and routes to sign-in or registration ([decision 0038](../decisions/0038-invitation-account-routing-and-direct-setup.md)); without the server account capability it keeps the shared entry screen. Registration through the invitation creates a confirmed account for the invited address only, never confirms an existing account, and shares the sign-in failure throttle. Acceptance requires a verified Supabase email equal to the normalized invite address, then creates membership, its one primary department, and that department's default role in one database transaction. SMTP failure never reports successful delivery; admins can resend with a newly rotated token or revoke a pending invite. The transaction/RLS behavior requires disposable PostgreSQL verification before deployment.
- Invitation SMTP credentials remain server-side. Use implicit TLS for SMTP `secure=true`; when `secure=false`, require STARTTLS and fail closed if encryption cannot be negotiated. Keep debug/protocol logging disabled so invitation content and credentials do not enter ordinary logs.

The organization, session-context, and owner-private note contract for the first backend slice is accepted and partially implemented. SQL authorization has a gated real-PostgreSQL test that has not run in this environment; API request tests use a synthetic Supabase adapter rather than a live project. See [first-slice permission and API contracts](first-slice-permission-and-api-contracts.md), [decision 0002](../decisions/0002-first-slice-private-notes-contract.md), and the active [Supabase decision 0001](../decisions/0001-supabase-and-hybrid-development.md).

### Database ownership is an execution contract

Local operator migration 0040 adds the trigger-only trusted
`validate_collection_placement` routine, bringing the reviewed inventory to 34
after migration0039's notification executor.
It locks Collection/current-pointer eligibility without runtime UPDATE grants on
publication tables. Preserve its postgres owner and lack of runtime/PUBLIC EXECUTE;
the pure eligibility helper and reconciliation remain invoker-context. Real
post-handoff tests cover this split; API/UI and live rollout are still pending.
See [0026](../decisions/0026-flat-organization-collection-placement.md).

The release migration login owns Arden DDL and its migration ledger; it is not the
internal executor of reviewed `SECURITY DEFINER` functions. Preserve those functions'
existing trusted `postgres` execution identity. Moving them to a non-bypass owner
while their input tables use FORCE RLS and runtime-only policies silently changes
validation and worker behavior. Never bulk-transfer routines as ordinary ownership
housekeeping. The migration-role probe must reject that broken ownership split.

Views have their own execution context: retaining a trusted function owner does
not make an owner-context view read as that function. The private
`governance_current_publication` view uses `security_invoker` so its guarded
SECURITY DEFINER callers retain the intended execution identity after view
ownership transfer. The runtime has no direct view privilege. `security_barrier`
alone does not provide this property; keep table RLS and existing entry-point
authorization intact.

Do not change FORCE RLS, actor/organization transaction settings, internal function
owners, reviewer/audience gates or indexing execution privileges independently.
Review them together and run the real runtime/worker workflow suite after the full
schema ownership handoff. A synthetic ownership probe, readiness endpoint or green
build does not prove submit/review/indexing still works. Changes to trusted function
bodies/owners require an explicitly reviewed operator operation, not an automatic
`expand` migration under the restricted DDL login.

The operator-only `deploy/release/security-definer-owner-repair.sql` restores the
known pre-transfer function owners after an exact-target backup and rehearsal. It
does not modify data, policies, EXECUTE grants, actor roles or function bodies.
Never repair this regression by granting BYPASSRLS to API users or letting Org Admin
read another user's private drafts/notes. These restrictions apply to every
contributor and agent, not to one named tool.

## 3. Knowledge ownership and governance

- Personal originals remain private. Sharing/contributing is explicit, with a preview of copied text/files, audience, and authority. A separate copy is not an implicit live mirror.
- The first shared-draft API permits only an authenticated author to copy an owned private-note version into a separate protected object. It does not expose the private source ID/URI to shared readers, grant audience access, or submit the copy for review. See [Group 1 create contract](mainflow-2-group-1-create.md).
- The web/desktop client offers this action only for a saved owner-private version in the selected organization. The client sends that version ID and a UUID idempotency key, never a claimed actor or audience. An ambiguous result is retried with the same key; the server remains the authorization authority. The returned shared draft is held only in the current UI session and cleared on organization switch or sign-out, separate from all synthetic knowledge samples. No client button may treat it as submitted, reviewed, or published.
- Prevent private back-links through provenance, attachments, mentions, derived summaries, citations, graph edges, or review history. Shared readers receive only provenance they are permitted to inspect.
- Distinguish personal notes, shared drafts, official publications, external source objects, and work briefs in data and UI. External sync does not confer official approval.
- Check a reviewer's current authority against the frozen readers, responsible department, team/project attribute filters, review rule and submitted version at decision time. New organization-wide snapshots require an `ORGANIZATION` grant; department and group-only snapshots require a `DEPARTMENT` grant for the responsible department. These scopes are disjoint and do not inherit. Deny ordinary reviewer self-approval; Organization Admin is the explicit final-authority exception and every such decision records `selfApproved: true`. One eligible reviewer may approve; assignment to a request does not itself confer broader access to personal originals or other content.
- Preserve transition rules per immutable submission. A `LEGACY` organization-wide submission may also use the prior responsible-department Specialist/Senior grant, and legacy `CONFIDENTIAL` / `RESTRICTED` classification checks remain; a new `GRANT_SCOPE` submission uses only the disjoint scope rule. The legacy-signature database eligibility function is a broad RLS prerequisite and must never replace the exact server policy. If an intended audience cannot be safely enforced, deny approval and publication. Widening audience after submission requires a new snapshot and review.
- Bind review/approval to an immutable content version/hash **and** intended scope. Store reviewer, decision, timestamp, and relevant policy version. Editing approved content requires another review cycle.
- Final approval moves the exact approved snapshot to publication preparation. It does not change the current pointer. Only complete indexing followed by atomic activation makes that version visible to search/RAG. There is no manual publisher role. Keep review, preparation and activation separately auditable; a mutable draft cannot become visible through a generic update endpoint.
- Enforce transitions transactionally and reject stale version/conflicting approvals. Archival, unpublishing, and revocation must have explicit visibility semantics and audit evidence.
- Who may recover private content remains a separate decision; do not create an undocumented bypass while implementing convenience tools.
- Organization Admin content access is governed by [decision 0023](../decisions/0023-organization-admin-governance-access.md):
  - The catalog shows metadata only.
  - Content outside the Admin's readership opens only through an audited inspection: a required reason, one published version, 15 minutes idle or 2 hours maximum, and the role rechecked on every request.
  - Authority comes from the current role and grant tables inside the reviewed routines of migration 0037, never from the app's `arden.org_admin` setting.
  - Record the audit event before serving content; if recording fails, refuse access.
  - Inspection and the responsible-reviewer view are never Library, search, Ask Arden or citation sources.
  - Under [decision 0024](../decisions/0024-admin-only-direct-withdrawal.md) and forward operator 0038, only a current Organization Admin may withdraw directly; a matching reviewer grant or client Admin setting is insufficient. Reason/audit and author-visible Admin provenance remain mandatory. Responsible-reviewer read/report handling and approval of author withdrawal requests are unchanged.
  - This release explicitly defers inspection notifications. Audit records are not automatic alerts; the deferral does not permanently remove the notification requirement.

## In-app notification boundary (decision 0025)

- PostgreSQL is the inbox/read-state source of truth. Trigger-written notifications and outbox rows commit with the corresponding submission, decision, activation/failure, approved reader change, primary-department or reviewer-grant event. The dispatcher can read only notification routing columns and sends `{ notificationId }` over private Realtime Broadcast; share names/titles and other message data stay Core-only.
- `DOCUMENT_SHARED_PERSONAL` or `DOCUMENT_SHARED_GROUP` is created only after an approved `READER_CHANGE` updates an existing publication's reader selection; publication activation is a separate `PUBLICATION_ACTIVE` event. `SELECTED_MEMBERS` maps to personal; `DEPARTMENT` and `ORGANIZATION` map to group. Fan-out includes only active recipients allowed by both the publication's frozen audience and approved Target Readers, excluding the requester. The message may contain the sharer's display name and publication title, but no body/excerpt. Core rechecks the current publication through the caller's RLS context before returning those details or a target; a notification never grants or preserves readership.
- Review-request fan-out follows current Organization Admin, disjoint Department/Organization grant, classification/tag/level, active membership and frozen legacy rules. A notification does not preserve reviewer access. Core checks current authorization when listing and opening the item; inaccessible items have no title/body/target disclosure.
- Reader credentials are Core-issued, kept in memory, scoped to an exact environment/organization/membership topic and expire after 120 seconds. The notification reader role has Realtime SELECT for Broadcast only; it cannot insert, read `arden` tables or use another topic. The separate outbox sender role can insert Broadcast only and cannot select. Neither role receives direct Arden database grants.
- Realtime authorization may be cached on an already connected socket until its short JWT expires. Such messages contain only opaque IDs; Core denies subsequent inbox data and target reads after permission loss. On organization change, sign-out, expired session or desktop window shutdown, close the channel and clear scoped UI state.
- Notification rows cascade with hard deletion of the organization or recipient membership. Preserve notification/outbox consistency in backups and restore, then enforce current membership state; an older backup must not recreate active access. No inspection alert is added, consistent with decision 0024.

## 4. Derived data, search, graph, and revocation

- Every derivative carries a traceable source/version/organization and appropriate audience: chunk, embedding, full-text entry, graph edge, label/layout, summary, citation, notification, cached page, AI history, and export.
- Authorize candidates before exposing snippets/counts/answers and recheck before response emission or delayed action. Never retrieve all private content then hide it in React or trust the model not to quote it.
- For role-audience RAG, constrain the retrieval candidate set by current membership and the any-matching-role rule before text/vector retrieval and model-context construction. Recheck the publication version and audience before emitting results, citations, or contribution actions. Private originals are excluded from organization-wide search.
- Graph edges require access to both endpoints and the edge itself. Unauthorized nodes must not affect visible cluster labels, degree counts, ranking explanations, sample previews, or layouts that disclose their existence.
- Source deletion, source permission loss, membership removal, unpublishing, and grant revocation block visibility synchronously. Asynchronous purge/reindex may follow, but stale projections cannot remain readable during cleanup.
- Cancel or revalidate pending jobs, subscriptions, downloads, and AI runs after a policy change. Prevent old tasks from recreating visibility or an obsolete index.
- Scope caches to user/organization/Core and permission validity. Clear them on logout/switch/revocation; do not serve sensitive responses from shared/public HTTP caches.
- A publication citation resolves to the exact approved version. An inaccessible, deleted, or stale source gets safe missing/stale feedback, not an unauthorized reconstruction from embeddings/history.
- Deletion and retention include derivatives, files, histories, logs, replicas/backups where policy requires. Keep legal/backup retention and restoration consequences explicit; do not promise erasure from an immutable backup without a design.

## 5. Files, extraction, rendering, and storage

- Validate actual file type/content and size, not only filename/MIME. Use bounded parsers, time/memory limits, quotas, safe extraction, and a defined malware/quarantine policy.
- Treat DOCX/archives and PDFs as hostile inputs. Defend against traversal/symlink escapes, decompression bombs, parser bugs, executable/macro payloads, and active/external content. Extractors should run with minimal privileges/network access.
- The accepted target uses private Supabase Storage buckets behind Arden's API/storage policy; it is not implemented yet. Bucket policies, scoped signed URLs, and current authorization must preserve private originals and revocation. Do not expose a public bucket/upload directory or use user-supplied absolute paths as storage keys. Keep service-role keys server-only; they bypass ordinary policy checks.
- Downloads, export jobs, previews, and signed URLs need current authorization and scoped expiration. Sanitize filenames/content disposition; do not log credentialed download URLs.
- Mark unsupported/scanned content honestly. OCR/cloud extraction is not an invisible fallback for a private upload.
- Sanitize rendered imported HTML/Markdown/editor content; validate URL schemes and embeds. Remote images/embeds can disclose IP/referrer/context, so use an explicit customer privacy policy instead of fetching them silently.
- Keep file/database consistency across failure and deletion. Handle abandoned uploads safely; never let cleanup delete a broad directory based on an unvalidated key.

## 6. Connectors and outbound actions

- V1 connectors are either personal to the connecting user or deliberately shared to selected source scopes with an Arden audience no broader than source permissions.
- When source permissions cannot be mapped reliably, restrict visibility to the connecting user or an explicitly authorized connector administrator under reviewed policy. Being an org manager alone is not sufficient to read a source/private item.
- Choose minimum token scopes and selected repositories/projects. Keep tokens server-side, rotate/revoke them, separate sandbox and production connections, and never use a service token as user authorization.
- Verify webhook authenticity/replay bounds. Treat every source field as untrusted content; validate URLs, pagination, redirects, timeouts, response sizes, and audience changes.
- Customer-configurable endpoints/fetches need SSRF controls: permitted destinations/protocols, resolution/redirect review, and protection for metadata/loopback/internal services except explicitly configured private services. "Private endpoint" does not mean unrestricted network access.
- External data remains source-owned/labeled, with revision/freshness and sync failures visible. Reconcile deletions/permission changes; an outage cannot silently expand audience.
- AI may draft a proposed action. Server policy authorizes the exact operation/destination and checks the current actor. The user previews content/audience/destination and explicitly confirms before data leaves.
- Bind confirmation to action content/version/destination/actor, with expiry and concurrency protection. A later edit or permission change invalidates it.
- Persist an idempotency/action record before performing a supported write, then reconcile uncertain outcomes. A timeout is not proof of failure; do not retry a Jira create blindly.
- No AI-initiated publishing, permission administration, GitHub writing, or arbitrary MCP/tool connector system is assumed in pilot scope. System publication following final human approval is part of Mainflow 2.

## 7. AI and private inference

- The gateway builds context from authorized current versions, selected excerpts, and necessary metadata only. A model has no direct database access, connector token, broad filesystem capability, or general network tool authority.
- User context selection is inspectable, but selected items still require server authorization. Do not feed inaccessible attachments/history because they are indirectly referenced by an allowed node.
- F22 writing actions accept client-supplied selected text without server retrieval. Core cannot attest whether that text came from a private note, so it requires active organization membership and the existing organization AI opt-in for every request, rechecks membership after inference, validates the bounded result, and logs no text. The editor applies suggestions only after an explicit user action; Explain has no edit path. See [F22](../product/writing-actions.md).
- Reviewer AI requires its own organization opt-in and exact pending-review authorization before content leaves Core. Arden-AI compiles the one frozen submission locally and sends bounded text to the configured provider. The application displays excerpts resolved from that source. It keeps review assistance out of the published index and does not persist the result. See [Reviewer AI](reviewer-ai.md).
- Distinguish official/shared/external/personal evidence, preserve exact-version citations, and show missing/conflicting/stale evidence and uncertainty. The model cannot certify an answer as official.
- Resolve and validate citations server-side against the retrieved evidence set. Reject invented IDs/URLs and revoked versions; do not make clickable unauthorized links because the model emitted them.
- Retrieved text is data, even when it says "ignore previous instructions", requests secrets, or appears to be a tool/system message. Never promote it to system instructions or authority.
- Validate generated structures and proposed tool arguments; use explicit capability allowlists, resource limits, and human confirmation for side effects. Prompt wording is not the security boundary.
- Customer private inference is the default. Disable cloud features, restrict network access, verify logs/config, and test egress; model acquisition/updating must be distinct from inference data processing.
- External provider enablement needs administrator opt-in, visible provider/destination/data-flow policy, and tenant-scoped configuration. No automatic private-to-cloud fallback during outages.
- Do not send private prompts, retrieved documents, or model outputs to ordinary telemetry, crash reporters, debug logs, third-party evals, or developer accounts. Any approved content capture requires consent/scope/retention/access controls.
- Test injection, insufficient evidence, unauthorized references, revocation mid-run, streaming cancellation, model outage, resource exhaustion, and provider changes. Previously streamed text cannot be undone; stop further emission promptly when authorization is no longer valid.

## 8. Desktop, browser, sessions, and offline behavior

- Keep renderer/browser unprivileged and use a narrow typed IPC/native boundary. Validate sender and inputs; native adapters are not a substitute for server policy.
- Do not store long-lived auth secrets in renderer localStorage or unencrypted files. Choose protected OS storage for desktop and secure session/cookie behavior for web; document the threat model and recovery behavior.
- Arden's API checks a signed, token-bound absolute 24-hour deadline on every protected request for both password and Google sign-in. A refresh keeps the original deadline; missing or invalid timebox markers fail closed. The key stays in API runtime secrets and is identical across replicas. Browser/desktop UI expiry clears in-memory private context, while the API remains authoritative even if a client clock or timer is altered.
- Validate configurable Core URLs and sign-in callbacks. Do not accept arbitrary redirects, open external schemes blindly, disable certificate validation, or grant wildcard origins for convenience.
- Offline support is future limited personal-draft/cache behavior, not complete shared sync. Distinguish saved-to-server, saved-locally, pending, failed, and conflict states without silent loss/overwrites.
- Cache protection, expiration, shared-content reauthorization, revocation when offline, device compromise, logout cleanup, and key lifecycle require accepted decisions before shipping caching. Do not claim immediate remote wipe on an offline device.
- Shared permissions, governance, external writes, and server AI require server authority. A disconnected desktop cannot publish because it had an earlier role or cached approval.
- Updates/deep links/file handlers are additional trust boundaries. Validate sources/payloads, verify artifact signatures, and permit customer-controlled/manual updates without hidden call-home.

## 9. Secrets, logging, audit, and incident evidence

- Secrets include DB/auth/model/connector credentials, signing keys, backup encryption keys, session cookies, authorization headers, and credentialed URLs. Keep them out of Git, bundles, screenshots, fixtures, PR text, ordinary logs, and model inputs.
- Store server secrets in environment/approved secret management; validate required production config and fail closed. Development defaults must never silently become production credentials.
- Redact application/request logging and crash diagnostics before adding sensitive routes. Default Fastify logging is not proof that a future payload/header configuration is safe.
- Audit only consequential actions ([decision 0035](../decisions/0035-audit-only-consequential-actions.md)): access, official knowledge, organization structure, exceptional privileges and actions that cannot be undone; not routine owner-only private-note edits. Audit metadata should record actor, organization, action, target/version, decision, timestamp, and correlation/idempotency reference, not full document/prompt content by default.
- Restrict audit access, define retention and integrity controls, and avoid editable ordinary-user audit records. Document stronger tamper-evidence requirements if adopted; do not claim them before implementation.
- Use synthetic test fixtures and sanitized, approved diagnostics. Suspected leaks require containment and a regression rule/test; do not copy exposed secrets into an issue or rotate customer credentials without authorized coordination.

## 10. Required security release evidence

A real release must prove, not only document:

1. Another member/manager without a grant cannot discover a private original, title, attachment, embedding, edge, snippet, summary, or AI history.
2. Cross-organization IDs, pooled DB context, events, jobs, caches, and native paths do not cross audiences.
3. Revocation/deletion/membership removal immediately prevents subsequent graph/search/download/AI exposure even before derivative cleanup.
4. Official answers/publications use the exact approved snapshot; post-approval edits cannot bypass review.
5. Connector tokens cannot reveal source objects to a broader Arden audience; unmapped source permissions fail closed.
6. External actions require exact preview/confirmation/capability and do not duplicate effects after uncertain outcomes.
7. Customer installation/upgrade/backup/restore/private inference work without unapproved Arden egress; production networking/secrets and desktop boundaries are checked.
8. Outages, incompatible clients, denied access, failed extraction, and unsynced drafts fail safely and truthfully.

Add concrete tests and threat-model/decision updates as each boundary is implemented. Documentation and a green scaffold build are not substitutes for these gates.
