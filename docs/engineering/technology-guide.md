# Technology guide and implementation guardrails

Read with [AGENTS.md](../../AGENTS.md). This guide records technology-specific requirements, not a promise that the planned stack already exists. Manifests and `pnpm-lock.yaml` are authoritative for installed versions. Update this guide whenever an accepted stack/interface/support decision changes.

All implementation/testing work also follows [code-quality.md](code-quality.md). It defines cohesive module boundaries, dependency seams, behavior-focused tests, cleanup, refactoring, and quality acceptance; the sections below add stack-specific requirements.

## 1. Stack inventory

Initial inventory, 2 October 2026:

| Area | Present in the scaffold | Target, not yet implemented |
| --- | --- | --- |
| Runtime/tooling | Node.js 24 CI; pnpm 11.19.0; TypeScript 5.9.3; pnpm workspaces | Same baseline, reviewed upgrades |
| Web/shared UI | React/react-dom 19.3.0; Vite 7.3.6; React plugin 5.2.0 | React Router and TanStack Query |
| Desktop | Electron 44.4.3; electron-vite 5.0.0; shared React UI | Typed preload/native adapters, secure cache/auth, signed Windows installer/update flow |
| API | Fastify 5.12.5; `pg` 8.23.0; `tsx` 4.23.15 | Validated domain routes/contracts, Supabase identity/events |
| Data | Local `pgvector/pgvector:pg17` container; database health query | Canonical PostgreSQL schema, extension/migrations, Drizzle, full-text/vector search |
| Identity | None | Supabase Auth; Arden-owned authorization |
| Editor | None | BlockNote core behind a versioned Arden document interface |
| Graph | Custom SVG illustrative network and local interactions | Sigma.js + Graphology on authorized API projections |
| Jobs | None | pg-boss in `apps/worker` |
| Storage | No content storage implementation | Private Supabase Storage behind Arden's storage/policy interface |
| AI | None | Arden gateway to customer-controlled Ollama/compatible private endpoint |
| Tests | Vitest 5.0.1, two API health tests; Node hosted-development workflow tests; Linux Python protocol/ownership/maintenance fixtures with mocked Docker; typecheck/build scripts | Real PostgreSQL integration/policy tests, UI tests, Playwright web/desktop flows |
| Deployment | Local PostgreSQL Compose; hosted API/database bootstrap and local frontend/SSH commands; Ubuntu/Windows CI | Supported isolated Supabase, Coolify release integration, immutable staging/production |

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
- The scaffold has no configured preload. Add a separately built, minimal typed preload when a feature actually needs it; do not expose `ipcRenderer`, `require`, raw shell/filesystem methods, or a general command channel.
- Validate IPC payloads, calling frame/origin, authenticated actor, operation scope, file paths, and resource limits. A renderer-supplied path/URL is not trusted because it came from Arden's UI.
- Main/native capabilities must return only necessary data. Do not return arbitrary filesystem contents, full credentials, or unrestricted handles to the renderer. Browser UI must continue working without Electron globals.
- Use a strict production CSP and exact approved Core origins. The scaffold's localhost HTTP/WebSocket allowances are for development, not a production policy. Do not add wildcard network access or `unsafe-eval` to silence an integration error.
- Prefer a reviewed custom application protocol for production assets; the current local-file loader is scaffold behavior, not the final security design. Validate navigation/URL components structurally, not with a string-prefix check. Never pass unvalidated URLs to `shell.openExternal`.
- Desktop talks to the same API and permission model as web. A native download, cache, deep link, or file picker cannot bypass server authorization.
- Design the customer Core URL/sign-in trust boundary explicitly. Prefer system-browser sign-in where available, validate callback state/redirects, and use the OS-protected secret store where feasible. Do not implement renderer-localStorage tokens as a shortcut.
- Test Windows behavior, bundled production assets, native dependencies, main/preload/renderer builds, shutdown, missing Core, and unsupported client versions. Linux packaging is not implicitly supported by an Ubuntu CI build.
- Signing, installers, updates, cache encryption/revocation, and version negotiation are future implementation work. Do not advertise them because `electron-vite build` succeeds.

Consult [Electron's security checklist](https://www.electronjs.org/docs/latest/tutorial/security) and electron-vite documentation matching installed majors before changing process boundaries or packaging.

## 5. Fastify, HTTP contracts, and notifications

- Keep construction/testability separate from process startup: extend the existing `buildApp` pattern. Centralize config validation, dependencies, policy services, and shutdown; avoid opening a pool/listener merely by importing a testable module.
- Validate body, query, parameters, relevant headers, and response shape. Reject unsupported content types and oversize input. Type annotations alone are not validators.
- Schemas are trusted application code: do not compile schemas supplied by users or imported documents. Authentication, database lookup, and authorization belong in appropriate hooks/services, not asynchronous schema validation. See [Fastify validation/serialization](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/).
- Derive identity and authorized organization from the session and server policy. Never accept an arbitrary body `userId`/`organizationId` as authority.
- Apply authentication, object/version/scope authorization, domain transition checks, and bounded resource use before mutations. Validate response fields to prevent accidental secret/private-column exposure.
- Use parameterized queries, transactions for related canonical changes, concurrency/version checks, and idempotency for retried creates/actions. Keep external network calls outside long-running database transactions.
- Normalize errors into safe client codes/messages and correlation IDs. Preserve diagnostics in redacted logs; do not expose stack traces, SQL, connector responses containing secrets, or inaccessible object existence.
- Configure cookie/CSRF protections, exact allowed origins, proxy trust, timeouts, rate limits, upload quotas, and TLS deliberately. Do not enable wildcard credentialed CORS or trust forwarded headers from arbitrary clients.
- Liveness remains cheap and independent of database readiness. Readiness checks required dependencies with bounded time and generic output; do not turn public health endpoints into configuration disclosure.
- Supabase Realtime is the planned notification service, not implemented now. Authorize subscriptions and each event with current Arden permissions, limit/expire connections, handle reconnect/duplicates, and release resources on disconnect. Payloads must not leak forbidden titles/content.
- Review channel authentication, policies, and revocation for both clients. Do not put long-lived secrets in public URLs. Reauthorize when membership/session changes; replay/delivery must not cross tenant scopes.
- Document compatibility before changing contracts used by installed desktop versions. Additive changes are preferred; introduce a version/deprecation strategy deliberately rather than breaking older binaries silently.

## 6. Supabase Auth and Arden authorization

- Supabase Auth is planned for identities/sessions; it replaces Better Auth. Do not run two auth stacks. The custom Arden login UI is separate from the service.
- Validate actual SDK/service versions, redirects/trusted origins, session verification/revocation, cookies/tokens, invitations, SMTP/recovery, and reverse proxy before integration. Service-role keys stay server-only.
- Supabase owns supported internal service schemas; Arden owns reviewed domain SQL migrations. Do not treat auth tables as the domain model or let independent schema tools mutate Arden tables.
- Identities/JWTs are not content ACLs. Arden policy owns organization membership, team scope, grants, review/publication, source audiences, downloads, graph/search, and AI. Direct SDK reads, Storage, and Realtime must enforce equivalent restrictions.
- Invitations and role changes need server checks for target organization, actor capability, escalation, expiration, audit, and session/cache invalidation. Test expired/revoked sessions and multi-organization users.
- Sign-in/bootstrap/recovery must not create a permanent universal bypass. Open private-data recovery and reviewer/publisher separation decisions require explicit policy before implementation.

References: [Supabase Auth](https://supabase.com/docs/guides/auth), [self-hosting](https://supabase.com/docs/guides/self-hosting), [decision 0001](../decisions/0001-supabase-and-hybrid-development.md).

## 7. PostgreSQL, pgvector, Drizzle, and search

- PostgreSQL is the canonical system of record for organization-scoped content, immutable versions, permissions, publications, source revisions, explicit edges, and audit metadata. An SVG/Graphology object, embedding, or client cache is not canonical storage.
- Use constraints, foreign keys, unique keys, indexes, and transactions to enforce invariants as well as domain checks. Make organization ownership explicit and prevent cross-organization references. IDs are identifiers, not access controls.
- Separate migration/owner, application, and worker roles. The local Compose user/password is development-only; it is not the least-privilege production role design.
- Apply RLS as defense in depth on sensitive tables. PostgreSQL superusers/`BYPASSRLS` always bypass it and owners normally do; use non-bypass/non-owner runtime roles and review `FORCE ROW LEVEL SECURITY` where appropriate. Test the actual roles and policies. See [PostgreSQL 17 row security](https://www.postgresql.org/docs/17/ddl-rowsecurity.html).
- If request scope is carried in PostgreSQL session settings, set it transaction-locally and test connection-pool reuse. Never let one request's tenant/actor context leak to the next connection borrower.
- Use bound parameters for values; identifiers/order options must come from validated allowlists. Bound text length, result count, pagination, and expensive query work. Do not dump broad rows and filter permissions in React.
- Drizzle schema is planned, with generated **reviewed SQL migrations**. Updating a TypeScript schema does not apply a database change or populate existing rows. Specify defaults, nullable transitions, backfills, and validation explicitly.
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
