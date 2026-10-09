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

Manual local Mainflow 1 testing may use the dedicated local adapter in `apps/api/src/auth/local-flow1-test.ts` only when startup verifies a loopback API, loopback PostgreSQL database named `arden_test_*`, synthetic `@example.test` identities, no Supabase configuration, and non-production mode. It supplies test authentication only; it is not identity proof and must never be exposed through a tunnel or pointed at shared/Coolify data. Its invitation mail sink never sends email. A no-login actor is automatically selected only for the dedicated Kiet Local `dev-2` API/database (`NODE_ENV=development`, PostgreSQL `postgres/arden_dev_2`, no Supabase config). Anyone with that slot's SSH access can act as the fixed synthetic Org Admin; therefore this mode is not authentication and must never be exposed through a public domain. Keep the API port loopback-bound behind the assigned SSH tunnel. Test writes persist. Without SMTP settings invitations are saved with no delivery; configuring all six SMTP settings enables real outbound invitation email in dev-2. Treat this as an external write: send only to intended test recipients and use a team-controlled sender account. The invite URL points to the developer's local frontend and is not reachable by invitees on other devices. No project-wide test-mode variable is used.

- Default deny. Authenticate requests and derive actor/organization scope from verified server context; validate requested organization membership rather than trusting client fields.
- Stable IDs, obscure URLs, hiding a button, filtering in the renderer, and a broad connector token are not access controls.
- Operational roles and content permissions are separate. Managers/admin UI roles must not implicitly grant read access to another user's personal workspace. Each personal workspace belongs to its user **within an organization**.
- Central domain functions determine actor + scope + object/version + action. Use them consistently from HTTP, jobs, events, search, graph, citation resolution, file download/export, AI, and native-cache access.
- Published Arden content may use organization-scoped custom-role audiences. A verified active member with at least one matching assigned role may view, search, and submit a separate contribution copy of the published version. Apply this rule on the server; Org Admin capability is not an implicit content grant. See [decision 0004](../decisions/0004-role-tagged-published-audiences.md).
- Test grants, membership removal, role changes, revoked/expired sessions, multiple organization memberships, and attempted cross-organization references. Unknown policy/source audience fails closed.
- Privileged workers/migration accounts do not replace end-user authorization. Use narrow service capabilities and explicitly trace the initiating actor where a task acts for someone.
- RLS is defense in depth, not the sole policy layer. Test real runtime roles and pooled tenant context; development DB superuser success proves neither production denial nor RLS correctness.
- Denied/missing object responses should follow a deliberate non-enumerating contract. Never disclose forbidden names, paths, existence, counts, or source errors just to make debugging easier.
- Administration, recovery, export, grants, connector settings, invitations, review/publish, and external actions need auditable actor/scope/decision metadata. Audit access itself is permission-controlled.
- Invitation bearer tokens are generated with cryptographic randomness, stored only as SHA-256 hashes, excluded from API responses/logs, and accepted once before expiry. The invite landing page does not query account existence; account setup and sign-in share the same invitation entry screen. Acceptance requires a verified Supabase email equal to the normalized invite address, then creates membership, its one primary department, and that department's default role in one database transaction. SMTP failure never reports successful delivery; admins can resend with a newly rotated token or revoke a pending invite. The transaction/RLS behavior requires disposable PostgreSQL verification before deployment.
- Invitation SMTP credentials remain server-side. Use implicit TLS for SMTP `secure=true`; when `secure=false`, require STARTTLS and fail closed if encryption cannot be negotiated. Keep debug/protocol logging disabled so invitation content and credentials do not enter ordinary logs.

The organization, session-context, and owner-private note contract for the first backend slice is accepted and partially implemented. SQL authorization has a gated real-PostgreSQL test that has not run in this environment; API request tests use a synthetic Supabase adapter rather than a live project. See [first-slice permission and API contracts](first-slice-permission-and-api-contracts.md), [decision 0002](../decisions/0002-first-slice-private-notes-contract.md), and the active [Supabase decision 0001](../decisions/0001-supabase-and-hybrid-development.md).

## 3. Knowledge ownership and governance

- Personal originals remain private. Sharing/contributing is explicit, with a preview of copied text/files, audience, and authority. A separate copy is not an implicit live mirror.
- Prevent private back-links through provenance, attachments, mentions, derived summaries, citations, graph edges, or review history. Shared readers receive only provenance they are permitted to inspect.
- Distinguish personal notes, shared drafts, official publications, external source objects, and work briefs in data and UI. External sync does not confer official approval.
- Bind review/approval to an immutable content version/hash **and** intended scope. Store reviewer, decision, timestamp, and relevant policy version. Editing approved content requires another review cycle.
- Publication is a separate authorized transition pointing at the approved snapshot. A mutable draft cannot accidentally become the visible publication through a generic update endpoint.
- Enforce transitions transactionally and reject stale version/conflicting approvals. Archival, unpublishing, and revocation must have explicit visibility semantics and audit evidence.
- Whether reviewer and publisher may be the same person, and who may recover private content, remains a decision; do not create an undocumented bypass while implementing convenience tools.

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
- No autonomous publishing, permission administration, GitHub writing, or arbitrary MCP/tool connector system is assumed in pilot scope.

## 7. AI and private inference

- The gateway builds context from authorized current versions, selected excerpts, and necessary metadata only. A model has no direct database access, connector token, broad filesystem capability, or general network tool authority.
- User context selection is inspectable, but selected items still require server authorization. Do not feed inaccessible attachments/history because they are indirectly referenced by an allowed node.
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
- Validate configurable Core URLs and sign-in callbacks. Do not accept arbitrary redirects, open external schemes blindly, disable certificate validation, or grant wildcard origins for convenience.
- Offline support is future limited personal-draft/cache behavior, not complete shared sync. Distinguish saved-to-server, saved-locally, pending, failed, and conflict states without silent loss/overwrites.
- Cache protection, expiration, shared-content reauthorization, revocation when offline, device compromise, logout cleanup, and key lifecycle require accepted decisions before shipping caching. Do not claim immediate remote wipe on an offline device.
- Shared permissions, governance, external writes, and server AI require server authority. A disconnected desktop cannot publish because it had an earlier role or cached approval.
- Updates/deep links/file handlers are additional trust boundaries. Validate sources/payloads, verify artifact signatures, and permit customer-controlled/manual updates without hidden call-home.

## 9. Secrets, logging, audit, and incident evidence

- Secrets include DB/auth/model/connector credentials, signing keys, backup encryption keys, session cookies, authorization headers, and credentialed URLs. Keep them out of Git, bundles, screenshots, fixtures, PR text, ordinary logs, and model inputs.
- Store server secrets in environment/approved secret management; validate required production config and fail closed. Development defaults must never silently become production credentials.
- Redact application/request logging and crash diagnostics before adding sensitive routes. Default Fastify logging is not proof that a future payload/header configuration is safe.
- Audit metadata should record actor, organization, action, target/version, decision, timestamp, and correlation/idempotency reference, not full document/prompt content by default.
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
