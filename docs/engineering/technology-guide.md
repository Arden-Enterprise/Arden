# Technology guide and implementation guardrails

Read with [AGENTS.md](../../AGENTS.md). This guide records technology-specific requirements, not a promise that the planned stack already exists. Manifests and `pnpm-lock.yaml` are authoritative for installed versions. Update this guide whenever an accepted stack/interface/support decision changes.

All implementation/testing work also follows [code-quality.md](code-quality.md). It defines cohesive module boundaries, dependency seams, behavior-focused tests, cleanup, refactoring, and quality acceptance; the sections below add stack-specific requirements.

## 1. Stack inventory

Inventory updated 5 October 2026:

| Area | Present in the scaffold | Target, not yet implemented |
| --- | --- | --- |
| Runtime/tooling | Node.js 24 CI; pnpm 11.19.0; TypeScript 5.9.3; pnpm workspaces | Same baseline, reviewed upgrades |
| Web/shared UI | React/react-dom 19.3.0; Vite 7.3.6; React plugin 5.2.0; typed fetch client for auth/private notes | React Router and TanStack Query |
| Desktop | Electron 44.4.3; electron-vite 5.0.0; shared React UI; narrow preload IPC backed by Electron safeStorage | Signed Windows installer/update flow |
| API | Fastify 5.12.5; `pg` 8.23.0; `tsx` 4.23.15; Supabase Auth via `@supabase/supabase-js` 2.117.2; BFF sign-in/sign-up/session/org-create/invitation/private-draft routes; ordered SQL migration runner | Organization admin list/role/department/member lifecycle routes, Supabase Realtime notifications |
| Data | Local `pgvector/pgvector:pg17` container; ordered SQL migrations 0001/0002; transaction-local actor/org/admin/invitation RLS context and non-bypass Arden runtime role; protected local note-object storage | Drizzle Kit migration authoring for future domain schema, full-text/vector search, Supabase Storage integration |
| Identity | Supabase Auth email/password through a server-only Fastify adapter; verified user UUID maps to `user_account.user_id`; Arden-owned organization bootstrap and hashed-token email invitation lifecycle; SMTP through Nodemailer 10.0.10. Fenced test adapters support loopback-only local sign-in and a no-login synthetic actor for the SSH-only Kiet Local `dev-2` slot | Recovery |
| Editor | React textarea-based session previews for private notes and shared knowledge | BlockNote core behind a versioned Arden document interface |
| Graph | Local decorative Figma SVGs; no graph view or authorized graph data | Sigma.js + Graphology on authorized API projections |
| Jobs | None | pg-boss in `apps/worker` |
| Storage | Protected local note-content volume via `LocalPrivateContentStorage`; opaque UUID `source_uri`, SHA-256 integrity check, production persistent mount required | Broader attachment/document storage; optional S3-compatible backend later |
| AI | Explicit prerecorded Ask Arden sample; no model request | Arden gateway to customer-controlled Ollama/compatible private endpoint |
| Tests | Vitest 5.0.1, Fastify auth/private-note tests, real-PostgreSQL repository/RLS test gated by `ARDEN_TEST_DATABASE_URL`, pure UI preview and API-client tests | Live Supabase Auth smoke, native Electron interaction, broader Playwright flows |
| Deployment | Local database Compose; Ubuntu/Windows CI | Ubuntu 24.04 + Coolify, versioned full application Compose, isolated staging/production |

The container image includes pgvector software; the scaffold does not yet create the extension or prove embedding queries work. The Electron build is not a packaged installer. No installed auth/schema/query/editor/graph/job library should be inferred from this target table.

## 2. Dependency and TypeScript discipline

- Use pnpm workspaces and the root `packageManager`; do not introduce npm/yarn/bun lockfiles or a second dependency graph. Node.js 24 is the tested baseline even though the current engine range is broader.
- Check the relevant manifests and lockfile before choosing an API. Use official docs for that major/version; check peer dependencies and Electron's bundled runtime, not only host Node compatibility.
- Add a dependency to the package that uses it. Keep tooling in `devDependencies`, runtime needs in `dependencies`, and React compatibility in shared UI peers. Use `workspace:*` for internal packages.
- Update the lockfile with pnpm for intentional manifest changes. Review unexpected resolutions, duplicate React versions, native binaries, transitive security issues, and install-script changes.
- `pnpm-workspace.yaml` currently permits builds only for Electron and esbuild. Review an individual dependency before changing `allowBuilds`; never blanket-enable lifecycle scripts.
- Preserve strict TypeScript, unused checks, and isolated modules. Use `unknown` plus validation at boundaries, typed domain errors, and exhaustive state handling. Assertions require actual invariants, not convenience.
- Source/module conventions must work with each build target. The API's emitted Node ESM imports use `.js`; do not change them to extensionless imports just because the renderer bundler accepts that.
- Keep runtime schemas and client contracts aligned; avoid manually maintained incompatible copies. Do not choose an additional validation framework without evaluating Fastify integration and recording the choice.
- Prefer small explicit interfaces and composition. Do not add a framework, state store, code generator, monorepo orchestrator, or service before demonstrating a need.
- Review software/model licenses for redistribution, notices, commercial/non-core restrictions, and customer deployment. A package being downloadable is not permission for every intended use.

## 3. React, Vite, routing, and client state

- Shared product UI lives in `packages/ui` and future feature packages. App entry points should be composition/platform adapters, not independent copies of the product.
- Living Archive assets are local: exported Figma SVGs and variable Sora/DM Sans TTFs with their OFL notices in `src/assets/fonts`. Preserve the font license files on redistribution. No runtime font-service request is needed. The accepted visual contract lives in [DESIGN.md](../../DESIGN.md).
- The Electron renderer sets Vite `assetsInlineLimit: 0`: imported SVGs must remain local file assets because its existing self-only image CSP blocks inlined `data:` images. Check the built renderer, not only web development, after asset changes. Do not broaden script/network CSP to make an asset render.
- Pure session transitions live in `organization/organizationWorkflow.ts` and `knowledge/knowledgePreviewModel.ts`; the shell owns preview identities, organization state and private drafts. [Mainflow 1 preview](mainflow-1-preview.md) distinguishes these demonstrations from future server contracts. Never promote a demo identity selector or a client readiness check into production authentication/authorization.
- React render must be pure. Keep hooks unconditional; use stable domain IDs as list keys. Clean up effects, requests, subscriptions, graph instances, and timers on replacement/unmount, including development remounts.
- Keep transient interaction state local. Use the planned TanStack Query for remote server state and React Router for navigation when those features are added. Do not duplicate a server cache in another global store without a demonstrated requirement.
- Define query keys with organization, identity/permission scope, object/version, and relevant filters. Clear/cancel scoped queries on logout, account/organization switch, revocation, and Core URL change. Never reuse one user's result as another user's placeholder.
- Explicitly choose query freshness, retry, reconnect/focus behavior, and invalidation. Do not blindly retry authorization failures or side-effecting mutations. A long stale time is not a permission grant; security data must remain revocable. See [TanStack's defaults](https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults).
- Do not persist sensitive query caches or tokens in browser storage by default. Offline content requires an accepted cache/threat-model design, not a query-persistence plugin switch.
- Vite dev ports are loopback-only and strict: web 5180, desktop renderer 5181. `/api` proxy is a development convenience, not a production reverse proxy or auth boundary.
- `VITE_*` values are exposed to bundled client code. Only public configuration belongs there; API/database/model/connector secrets do not. Vite build-time replacement is not server runtime configuration. See [Vite environment rules](https://vite.dev/guide/env-and-mode).
- A future same-image staging/production promotion needs an explicit public runtime-configuration mechanism for varying client settings. Do not rebuild a differently configured artifact while claiming it is the identical promoted digest.
- Handle loading, empty, error, offline, no-access, stale-source, and unsaved-change states honestly. Do not return sample data as a fallback for a failed real API request.
- Render imported text safely. Do not bypass escaping with unsanitized HTML. Review editor/Markdown links, embeds, remote images, and downloaded filenames as untrusted input.
- Preserve keyboard access, focus management, semantic labels, reduced motion, and an accessible graph list/detail alternative. Test long names, zoom, narrow windows, and the design breakpoints rather than only one screenshot.

## 4. Electron and electron-vite

- The main process is privileged; the renderer is not. Keep `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, and `webSecurity: true`. Permission requests, new windows, and navigation remain denied unless a narrow feature explicitly permits them.
- The desktop now has a separately built, minimal typed preload for secure session persistence and Core URL retrieval. It uses a narrow allowlist with main-frame checks; do not expose `ipcRenderer`, `require`, raw shell/filesystem methods, or a general command channel.
- Validate IPC payloads, calling frame/origin, authenticated actor, operation scope, file paths, and resource limits. A renderer-supplied path/URL is not trusted because it came from Arden's UI.
- Main/native capabilities must return only necessary data. Do not return arbitrary filesystem contents, full credentials, or unrestricted handles to the renderer. Browser UI must continue working without Electron globals.
- Use a strict production CSP and exact approved Core origins. The scaffold's localhost HTTP/WebSocket allowances are for development, not a production policy. Do not add wildcard network access or `unsafe-eval` to silence an integration error.
- Prefer a reviewed custom application protocol for production assets; the current local-file loader is scaffold behavior, not the final security design. Validate navigation/URL components structurally, not with a string-prefix check. Never pass unvalidated URLs to `shell.openExternal`.
- Desktop talks to the same API and permission model as web. A native download, cache, deep link, or file picker cannot bypass server authorization.
- Design the customer Core URL/sign-in trust boundary explicitly. Prefer system-browser sign-in where available, validate callback state/redirects, and use the OS-protected secret store where feasible. Do not implement renderer-localStorage tokens as a shortcut.
- Test Windows behavior, bundled production assets, native dependencies, main/preload/renderer builds, shutdown, missing Core, and unsupported client versions. Linux packaging is not implicitly supported by an Ubuntu CI build.
- Signing, installers, updates, cache encryption/revocation, and version negotiation are future implementation work. Do not advertise them because `electron-vite build` succeeds.

Consult [Electron's security checklist](https://www.electronjs.org/docs/latest/tutorial/security) and electron-vite documentation matching installed majors before changing process boundaries or packaging.

## 5. Fastify, HTTP contracts, and Supabase Realtime

- Keep construction/testability separate from process startup: extend the existing `buildApp` pattern. Centralize config validation, dependencies, policy services, and shutdown; avoid opening a pool/listener merely by importing a testable module.
- Validate body, query, parameters, relevant headers, and response shape. Reject unsupported content types and oversize input. Type annotations alone are not validators.
- Schemas are trusted application code: do not compile schemas supplied by users or imported documents. Authentication, database lookup, and authorization belong in appropriate hooks/services, not asynchronous schema validation. See [Fastify validation/serialization](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/).
- Derive identity and authorized organization from the session and server policy. Never accept an arbitrary body `userId`/`organizationId` as authority.
- Apply authentication, object/version/scope authorization, domain transition checks, and bounded resource use before mutations. Validate response fields to prevent accidental secret/private-column exposure.
- Use parameterized queries, transactions for related canonical changes, concurrency/version checks, and idempotency for retried creates/actions. Keep external network calls outside long-running database transactions.
- Normalize errors into safe client codes/messages and correlation IDs. Preserve diagnostics in redacted logs; do not expose stack traces, SQL, connector responses containing secrets, or inaccessible object existence.
- Configure cookie/CSRF protections, exact allowed origins, proxy trust, timeouts, rate limits, upload quotas, and TLS deliberately. Do not enable wildcard credentialed CORS or trust forwarded headers from arbitrary clients.
- Liveness remains cheap and independent of database readiness. Readiness checks required dependencies with bounded time and generic output; do not turn public health endpoints into configuration disclosure.
- Supabase Realtime is the planned notification transport, not implemented now. Authorize each subscription and event against current Arden policy, limit/expire connections, handle reconnect and duplicate delivery, and release resources on disconnect. Notification payloads must not leak forbidden titles/content.
- Review Realtime authentication and channel policies for both clients. Reauthorize when membership/session changes; event replay must not cross tenant scopes. Keep session secrets out of public URLs.
- Document compatibility before changing contracts used by installed desktop versions. Additive changes are preferred; introduce a version/deprecation strategy deliberately rather than breaking older binaries silently.

## 6. Supabase Auth and Arden authorization

- `apps/api/src/auth/local-flow1-test.ts` is a test-only exception for manual local organization/department/invitation checks before the team's Supabase project is ready. It accepts only configured synthetic `@example.test` users and in-memory sessions. Startup rejects production, any Supabase config, non-loopback API/database hosts, and databases not named `arden_test_*`. Never deploy or expose this mode, connect it through an SSH tunnel, or use real identities/data. Invitation delivery is a no-op sink and the UI labels it as not sent.

- Supabase Auth is the identity/session provider. `apps/api/src/auth/provider.ts` uses `@supabase/supabase-js` 2.117.2 with persistence and auto-refresh disabled; credentials and tokens are handled only in the API process. Sign-up always returns the same generic confirmation response and never indicates whether the email already had an account. Never install a parallel Better Auth stack.
- Fastify owns `/api/v1/auth/sign-in` and `/api/v1/auth/sign-out`. It exchanges email/password with Supabase and stores the access/refresh pair in `HttpOnly`, `SameSite=Lax` cookies; production cookies use `Secure` and `__Host-` names. Exact configured web origins are required on cookie-authenticated mutations.
- This is a BFF session boundary for the rich client: the renderer never receives the Supabase token pair. The API validates access tokens with Supabase `getUser` on protected requests and refreshes expired sessions through Supabase Auth. Treat provider/network outages separately from invalid credentials; fail closed without clearing a valid session on transient failure.
- Keep Supabase publishable/anon keys in API runtime configuration for this design. A service-role/secret key is not required and must never be placed in a client bundle. Email/password sign-up remains controlled by Supabase project settings; a verified user does not gain Arden organization access by signing in.
- A Supabase Auth user UUID maps to `arden.user_account.user_id`; domain PostgreSQL stores the profile and Arden membership without duplicating password hashes or assuming access to Supabase's internal `auth` schema. Every domain route then checks Arden account status, membership, role, scope, and object ownership. Auth-provider metadata/groups do not replace Arden policy.
- Invitation records store a SHA-256 token hash, never the bearer token. The generic `/invite/<token>` page offers sign-in or account setup without looking up account existence; accept requires a verified Supabase email matching the invitation, and is single-use/expiry-checked in a PostgreSQL transaction. SMTP uses Nodemailer 10.0.10; all `SMTP_*` settings are server-only and must be supplied together. Port 465 uses implicit TLS; other supported SMTP setups require STARTTLS, with bounded connection timeouts. SMTP auth currently uses username/password credentials; Gmail OAuth2 is not wired. Gmail and Mailjet can use the generic transport through runtime configuration; SMTP delivery has not been live-tested in this checkout.
- Desktop session cookies are stored encrypted with Electron `safeStorage`. A narrow main-process IPC bridge injects cookies into an allowlisted set of API requests and returns data/headers without exposing cookies to the renderer. Keep context isolation, sandbox, and `webSecurity` enabled; require a trusted `ARDEN_CORE_URL` HTTPS origin in production.
- The domain migration creates only the non-bypass `arden_runtime` role. Supabase Auth owns credential/session data; Arden's PostgreSQL repository uses transaction-local `arden_runtime`. Apply domain migrations with a separate privileged migration connection.
- Invitations and role changes need server checks for target organization, actor capability, escalation, expiration, audit, and session/cache invalidation. Test expired/revoked sessions and multi-organization users.
- Sign-in/bootstrap/recovery must not create a permanent universal bypass. Open private-data recovery and reviewer/publisher separation decisions require explicit policy before implementation.

References: [Supabase Auth](https://supabase.com/docs/guides/auth), [server-side auth/session guidance](https://supabase.com/docs/guides/auth/server-side), [Supabase `signInWithPassword`](https://supabase.com/docs/reference/javascript/auth-signinwithpassword), [Supabase `signUp`](https://supabase.com/docs/reference/javascript/auth-signup), [Supabase `getUser`](https://supabase.com/docs/reference/javascript/auth-getuser), [Supabase `refreshSession`](https://supabase.com/docs/reference/javascript/auth-refreshsession), [Nodemailer SMTP transport](https://nodemailer.com/smtp), [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage), [Electron contextBridge](https://www.electronjs.org/docs/latest/api/context-bridge), [electron-vite preload discovery](https://electron-vite.org/guide/dev).

## 7. PostgreSQL, pgvector, Drizzle, and search

- PostgreSQL is the canonical system of record for organization-scoped content, immutable versions, permissions, publications, source revisions, explicit edges, and audit metadata. An SVG/Graphology object, embedding, or client cache is not canonical storage.
- Use constraints, foreign keys, unique keys, indexes, and transactions to enforce invariants as well as domain checks. Make organization ownership explicit and prevent cross-organization references. IDs are identifiers, not access controls.
- Separate migration/owner, application, and worker roles. The local Compose user/password is development-only; it is not the least-privilege production role design.
- Apply RLS as defense in depth on sensitive tables. PostgreSQL superusers/`BYPASSRLS` always bypass it and owners normally do; use non-bypass/non-owner runtime roles and review `FORCE ROW LEVEL SECURITY` where appropriate. Test the actual roles and policies. See [PostgreSQL 17 row security](https://www.postgresql.org/docs/17/ddl-rowsecurity.html).
- If request scope is carried in PostgreSQL session settings, set it transaction-locally and test connection-pool reuse. Never let one request's tenant/actor context leak to the next connection borrower.
- Use bound parameters for values; identifiers/order options must come from validated allowlists. Bound text length, result count, pagination, and expensive query work. Do not dump broad rows and filter permissions in React.
- Supabase Auth owns its internal auth schema; Arden's reviewed SQL migrations manage only the domain schema and do not create or modify Supabase-owned tables. Drizzle Kit authoring for broader domain schema remains planned. The ordered runner records `public.arden_schema_migrations`; migrations are not applied at API startup. Organization bootstrap/administration and invitation acceptance create Arden membership/role assignments transactionally after validating the Supabase session.
- The API wraps every repository operation in a transaction, switches locally to `arden_runtime`, sets actor/organization transaction-local settings, and restores connection role/settings at commit/rollback. Keep a separate privileged migration connection.
- Private note text is written to a protected local directory behind `PrivateContentStorage` before a corresponding database version is acknowledged. Its opaque `source_uri` and SHA-256 hash are canonical metadata; production must mount `ARDEN_PRIVATE_STORAGE_ROOT` persistently outside the image and static web root. A Coolify Compose/storage/backup deployment is not included.
- Do not use schema push as the shared staging/production workflow. Keep schema, migration SQL/metadata, backfill plan, tests, and application compatibility in one change. Never edit already-applied migration history to hide a new change.
- Run migrations once per deployment with serialization/locking, not on every API/worker replica startup. Use expand -> backfill/migrate -> contract and keep older desktop/API compatibility until the support window allows removal.
- Test fresh installation and upgrades from a populated prior schema with realistic denied-access cases. Record lock/runtime impact, disk requirements, restoration plan, and unsupported downgrade behavior.
- Explicitly provision/test the pgvector extension. Record embedding provider/model/version/dimension/chunking and source revision. Never compare incompatible vectors or overwrite the old corpus midway through a model migration.
- Start with exact similarity search on authorized candidates plus PostgreSQL full-text. Add HNSW/other approximate indexing only with measured recall/latency and selective authorization-filter tests. Do not treat ANN output ordering as proof of permission or complete recall.
- Authorize before returning titles/snippets/ranking details and recheck before response/model context. Preserve exact source/version citations and freshness; never label a newer draft as an approved publication.
- Avoid N+1/unbounded neighborhood/export/search queries. Use measured plans and representative sanitized workloads; no performance shortcut may relax organization or private-data isolation.

References: [Drizzle migration workflows](https://orm.drizzle.team/docs/migrations), [pgvector](https://github.com/pgvector/pgvector).

## 8. BlockNote and canonical documents

- Adopt BlockNote core only when editing is implemented. Confirm installed version, schema APIs, export/import behavior, and commercial/non-core licensing. Real-time collaboration is outside pilot scope.
- Store a versioned Arden document format behind an editor adapter. Preserve stable block/content references needed for citations and version history. Do not make rendered HTML or one library's live objects the sole durable representation.
- Validate stored/imported document JSON. Make format migrations explicit and reversible where feasible; retain source fidelity/provenance and export capability.
- Separate autosaved private/shared drafts from immutable submitted/published snapshots. Show save failure/conflict/unsynced state; never let an editor mutate an approved version in place.
- Sanitize imported HTML/Markdown, links, embeds, pasted files, and rendering. Attachment reads go through authorization; unsafe remote embeds must not silently fetch organizational/user context or execute content.
- Test document round trips, long content, unsupported blocks, attachments, migrations, keyboard behavior, and editor replacement boundaries.

Reference: [BlockNote documentation](https://www.blocknotejs.org/docs).

## 9. Sigma.js and Graphology

- Sigma renders and Graphology manages a **derived client projection**. PostgreSQL/API own entities, canonical edges, permissions, and version provenance.
- Preserve the current sample graph until a real authorized slice is implemented. Do not describe the existing SVG renderer as Sigma or add Sigma only to satisfy a stack list.
- Request bounded authorized neighborhoods with scope/search/filter/pagination. Do not download the entire organizational graph and hide forbidden nodes locally.
- Server authorization covers both endpoints and the edge. Layout, degree/counts, labels, suggestions, and cluster metadata must be computed only from permitted information.
- Isolate layout computation, keep camera/selection state intentionally, and measure representative graph sizes. Use workers for heavy layout when justified; prevent layout/network work from blocking interaction.
- Own the Sigma instance in a lifecycle boundary; dispose it and listeners/workers on replacement/unmount. Do not recreate the entire renderer on every React update or mutate a shared graph unsafely during rendering.
- Provide accessible lists/details and keyboard search/selection because a WebGL canvas alone is not a usable document browser for everyone. Match `DESIGN.md` neutral shape/status grammar and reduced motion.
- Test selection, search, fit/pan/zoom, empty/disconnected graphs, revoked nodes, long labels, resize, low-end/GPU-limited environments, and web/desktop parity. Do not assume WebGL availability or fixed sample coordinates establish production scalability.

References: [Sigma documentation](https://www.sigmajs.org/docs/), [Graphology documentation](https://graphology.github.io/).

## 10. pg-boss, files, and connector processing

- Run planned pg-boss work in a separate worker process, not request-blocking extraction/inference in the API. Keep queue/schema compatibility and the PostgreSQL version requirements verified for the adopted release.
- Design for redelivery/retry: use stable idempotency keys, deduplication/unique constraints, bounded attempts/backoff/timeouts, and observable terminal failures. Never promise exactly-once external effects from a queue guarantee alone.
- Make the canonical write and job scheduling reliable through a verified shared transaction or outbox/reconciliation design. Do not acknowledge saved/indexed content when a failure silently lost its ingestion work.
- Revalidate current source revision, organization, permissions, approval state, and cancellation before side effects. Stale jobs must not republish, restore revoked sources, or overwrite a newer extraction/embedding.
- Use small validated job payloads with IDs/version references, not secrets or unrestricted snapshots. Limit worker privileges and concurrency; stop/drain safely during deployment.
- Store attachments in private Supabase Storage behind Arden's policy/storage interface, outside public/static roots. Validate content, keys, quotas, extraction limits, and scanning policy. Prevent public bucket exposure, traversal, symlink escapes, decompression bombs, and unsafe parser execution. Storage is not implemented yet.
- Track files and DB references consistently across retry/failure/deletion. Downloads/exports require authorization; temporary URLs must be narrowly scoped/expiring and not leak through logs.
- V1 input scope: Markdown/plain text, DOCX, and text PDFs. Scans get an explicit unsupported/OCR-needed status; OCR is not secretly implemented by sending files to a cloud service.
- Connector sync records source ID/revision/hash, audience, timestamps, extractor/model versions, cursors, and failures. Preserve provenance; unchanged content should not be reprocessed unnecessarily.
- Bound initial backfills, page sizes, API rate use, retries, and concurrency. Verify webhook signatures/replay handling; reconcile missed webhooks. Tokens stay server-side and minimally scoped.
- Source permission uncertainty fails closed. An external-write timeout enters an uncertain/reconciliation state; do not blindly recreate the Jira issue.

References: [pg-boss](https://github.com/timgit/pg-boss), [GitHub App permissions](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app), [Jira issue API](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/).

## 11. Ollama and the Arden model gateway

- All inference/retrieval goes through a server gateway; clients and models do not receive database/connector credentials. Use explicit chat and embedding profiles, capability checks, context limits, timeouts, concurrency, and cancellation.
- Only send authorized query/context and necessary provenance. Keep user-selected context inspectable; citations resolve server-side to retrieved exact versions, not model-invented IDs/URLs.
- Strict-private mode requires local models, cloud-disabled Ollama (currently `OLLAMA_NO_CLOUD=1` or its documented equivalent), restart/config verification, private networking, and an egress test. Disabling cloud features alone is not a complete firewall or air-gap implementation. See [Ollama FAQ](https://docs.ollama.com/faq).
- Do not expose Ollama directly to public/client networks. Protect a remote private model endpoint with appropriate network/auth/TLS controls and verify what a compatible endpoint actually supports.
- No automatic cloud fallback. Changing provider/model endpoint is an audited administrative data-flow decision; external processing needs explicit opt-in and a preview/warning of what leaves the installation.
- Treat retrieved content and model answers as untrusted. Structured output is validated; model text cannot call arbitrary tools, expand its audience, publish, or authorize external actions.
- Record model/profile/version and evidence references without routinely logging full private prompts. Re-embedding after model/chunking changes requires versioned corpus migration and readiness state.
- CPU/GPU capacity is measured, not assumed. Benchmark customer hardware and representative concurrency; disclose unsupported/slow profiles. The pilot application host is not a guaranteed multi-user inference host.
- Test missing evidence, contradictory/stale sources, denied access, revocation during a run, malicious retrieved instructions, timeout, cancellation, unsupported endpoint capabilities, and no-network/private mode.

## 12. Tests and documentation obligations

- Vitest unit tests cover deterministic policy/state/adapter behavior. Fastify injection covers HTTP contracts and denial cases; real disposable PostgreSQL covers constraints/RLS/transactions/migrations/pgvector/jobs.
- Planned Playwright coverage should exercise core web and Windows desktop journeys, using isolated synthetic users/organizations and deterministic fixtures. Do not rely on a live external connector or costly model for ordinary CI tests; add separately gated real integration smoke tests.
- Fake adapters must preserve failure/permission contracts rather than always succeed. Keep tests repeatable, with bounded retries and no fixed sleeps masking races.
- Test the same user across organizations, different users/roles, private/shared/external sources, versions, grant/revoke transitions, and delayed work. Add a regression case when fixing a leak or duplicate write.
- Document commands only when scripts exist, and note environment/dependency requirements. Do not list nonexistent `pnpm lint`, migrations, seeds, E2E, installer, or deploy scripts as runnable today.
- Technology adoption is incomplete until its version source, setup/configuration, boundary, license, security/failure behavior, verification, and operational consequences are documented and tested to the task's scope.
