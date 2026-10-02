# Arden: product and architecture blueprint

Status: proposed direction, 23 September 2026. This is a design, not an implementation or a claim that any feature already exists. Pilot desktop target: Windows first; Linux desktop follows later.

## 1. The decision

Arden is a **private organizational memory and work-context system**. A customer installs Arden Core on infrastructure it controls. People capture knowledge, connect existing work systems, navigate the relationships in a graph, and ask an AI assistant questions grounded in information they are actually allowed to see. Human review determines which Arden-authored material becomes official shared guidance.

The product is **self-hosted first**, with a desktop app and a web app. It is not fully offline-first in the first release: the server remains the authority for shared knowledge, permissions, indexing, review, and AI. The desktop app may safely cache recent permitted content and offline drafts, but full offline editing/synchronization is a later project. This distinction matters: local installation protects an organization from sending its data to Arden's cloud; offline-first is a separate, much harder synchronization guarantee.

One customer installation should be useful without Arden-operated infrastructure or mandatory telemetry. Customer-controlled model inference is a supported default, not an enterprise add-on. Arden Cloud can later provide an optional hosted installation and operations service; it should use the same core product and not force a rewrite.

## 2. What the product must do

### Three kinds of information

| Kind | Ownership and authority | How it enters Arden | Sharing rule |
| --- | --- | --- | --- |
| Personal knowledge | User-authored, private by default, not official | Notes, uploads, personal captures | User explicitly submits a **separate copy** for review. Private original stays private. |
| Shared Arden knowledge | Team, department, or organization content with versioned governance | Draft or contribution from an authorized member | Reviewed snapshot is approved, then explicitly published. Visibility and official status are separate. |
| External work context | Jira, GitHub, and other source-owned objects | Scoped connector sync or on-demand fetch | Inherits the connector's permitted audience and remains labeled external/unapproved. Promotion to Arden knowledge requires review. |

The home screen is a **permission-filtered graph**, not a decorative graph tab. A left rail opens Graph, My Work, Intake/Sources, Reviews, and Administration. Selecting a node opens a right-side Knowledge Pane with content, provenance, freshness, links, and actions. A full editor handles sustained writing. The floating Arden Agent can use an explicit context basket containing selected nodes, passages, or tasks; users can inspect what will be sent to the model.

Graph nodes include notes, published pages, external issues and pull requests, people/teams where policy permits, work briefs, and source files. Edges include `links_to`, `references`, `supports`, `supersedes`, `belongs_to_task`, and `derived_from`. The server must authorize **both endpoints and the edge itself** before returning graph data. There must be no hidden-node counts, labels, search suggestions, or graph layouts that reveal inaccessible information. Start with focused neighborhoods, filters, search, and an onboarding sample, not an unreadable whole-company hairball.

### Core journeys

1. **Capture → understand:** write a private note or upload a file; Arden extracts text, records source/version, indexes it, suggests links, and answers questions with citations.
2. **Contribute → govern:** copy selected private content into a shared draft; clean and preview it; submit an immutable snapshot; reviewer requests changes or approves; publisher promotes the approved snapshot; later revisions repeat this path.
3. **Work → context:** connect a Jira project and selected GitHub repositories; a task's Knowledge Pane shows relevant code changes, decisions, runbooks, and notes. A work brief records current context and sources without pretending to be official policy.
4. **Ask → verify:** AI retrieves only authorized and current material, distinguishes official/shared/external/personal sources, cites exact versions, and states uncertainty or conflict.
5. **Draft → act externally:** if authorized, Arden may prepare a Jira issue with a precise preview of text and destination. The user confirms. Arden records idempotency and reconciles uncertain outcomes before any retry.

AI is an assistant, not a publisher or autonomous administrator. It may propose links, summaries, edits, briefs, and tasks. It may never silently publish shared guidance or send content to Jira/GitHub.

## 3. Chosen stack

| Layer | Choice | Why |
| --- | --- | --- |
| Codebase | TypeScript monorepo with `pnpm` workspaces | One language and shared domain, UI, API types, and permission rules. |
| Web | React + Vite + React Router + TanStack Query | The app is authenticated and highly interactive; server rendering/SEO bring little value. |
| Desktop | Electron + electron-vite using the same React feature packages | Faster parity between web and desktop than separate UI stacks. Narrow, typed preload APIs only. |
| Editor | BlockNote core, wrapped behind an Arden document interface | Good writing UX; keep stored document format versioned so the editor can be replaced. Check the license for any non-core components before adopting them. |
| Graph | Sigma.js + Graphology | WebGL rendering and graph utilities suited to interactive neighborhoods. The graph is a projection of canonical relationships, not the primary database. |
| API | Fastify + schema-validated HTTP API; SSE for initial notifications | A long-running, self-hosted API with explicit security boundaries and simple client contracts. |
| Identity | Better Auth + Drizzle adapter for accounts/sessions/invitations; Arden-owned authorization | Avoid rebuilding login. The organization's structure and document ACL cannot be delegated to an auth plugin. |
| Database | PostgreSQL + `pgvector`; Drizzle migrations | Relational integrity for governance and permissions, full-text search, embeddings, and one database system of record. |
| Jobs | `pg-boss` in a separate worker process | Durable ingestion, connector sync, embedding, and cleanup without Redis in the first installation. |
| Files | Protected local volume behind a storage interface | Fewer services initially; optional S3-compatible storage later. Backups must include the volume. |
| Private AI | Ollama runtime through an Arden model gateway; pluggable compatible private endpoint | Simple customer-controlled install and replaceable model backend. Separate chat and embedding model profiles. |
| Deployment | Versioned Docker Compose deployed by Coolify | Matches the Ubuntu 24.04 server and makes customer installation reproducible. |
| Tests | Vitest, API/integration tests against PostgreSQL, Playwright end-to-end | Permissions and review transitions need executable evidence. |

This deliberately **replaces the earlier Supabase-as-a-full-stack recommendation** while retaining PostgreSQL and Drizzle. Self-hosted Supabase is capable, but its Auth/Storage/Realtime/Studio/API services and operations are more than Arden needs to ship to every customer. Supabase also does not make schema changes magically appear in existing rows: SQL migrations still define and apply changes, and existing rows need defaults/backfills where appropriate. Better Auth, Arden's API, local file storage, and Postgres form a smaller install and a clearer server-side authorization boundary. Do not run both Supabase Auth and Better Auth.

Do not introduce a graph database, Elasticsearch, Kubernetes, Redis, or a separate vector service before measured needs justify them. PostgreSQL stores canonical entities and explicit edges; search indexes and graph views are derived projections. Start vector search with exact filtered queries. Consider HNSW only after corpus/latency measurements; approximate vector indexes can interact poorly with selective permission filters.

### Repository shape

```text
apps/
  web/             authenticated React application
  desktop/         Electron main, preload, renderer shell
  api/             Fastify API, authentication, authorization
  worker/          ingestion, sync, embeddings, maintenance
packages/
  ui/              shared components and themes
  domain/          types, workflow state machines, policies
  api-client/      typed client contracts
  db/              Drizzle schema and reviewed SQL migrations
  editor/          Arden document model and BlockNote adapter
  graph/           graph queries, layout, shared UI
  ai/              retrieval and model adapters
deploy/
  compose/         customer, staging, and local templates
docs/              install, backup, threat model, operations
```

The API is the only routine writer to Arden content; browser and desktop never connect directly to PostgreSQL. Worker operations use narrowly scoped service permissions and record their effects. Use one reviewed migration system, not schema push on production.

## 4. Trust and permissions

The trust boundary is the **customer installation**. Arden's company does not need access to its data. The customer controls host, backups, model endpoint, connectors, outbound network policy, and updates. Optional Jira/GitHub integrations still exchange data with those external providers, and confirmed outbound actions send the previewed content to the selected provider. However, this is not end-to-end encryption against the customer's own server/root/DB administrators: server-side search, review, and AI need plaintext processing. Do not market it as such.

Within an installation, model organization → departments → teams → users. Users can belong to multiple teams; each has a personal workspace **per organization**. A standalone personal-only account is an open product decision, not an assumed feature. Operational roles (instance admin, org admin, team manager, reviewer, publisher, member) and content permissions are distinct. Being a manager does **not** automatically grant read access to private notes. Only the owner, a deliberate share, or a narrowly defined administrative recovery mechanism can make private content available at the application layer. Customer infrastructure administrators are outside that guarantee.

Use explicit authorization functions such as `canReadContent(actor, object, version)` and `canPublish(actor, scope, approvedSnapshot)` in one domain package, exercised from every API, background job, search result, citation, graph response, download, AI context builder, and event stream. PostgreSQL row-level security is a defense-in-depth control on sensitive tables using a non-bypass application role; avoid relying on RLS alone, and test service/worker roles separately. Versioned policy tests should enumerate role, scope, source, and action combinations.

For external systems, a connector's broad token is **not** blanket permission for all Arden users. V1 should support two safe modes: (1) per-user personal connection, visible only to that user; (2) explicitly scoped shared connection to selected repositories/projects and an Arden audience that is no broader than the source's allowed audience. If source permissions cannot be mapped with confidence, show the item only to the connecting user/admin until it is deliberately contributed through review. Treat source revocation, deletion, or permission change as a synchronous visibility block first; purge/reindex derivatives asynchronously. Embeddings, snippets, titles, graph edges, cached summaries, citations, and AI history are derivatives too.

Uploads must enforce size/type limits, content-type verification, safe extraction, malware scanning policy, and per-tenant quotas. Connector tokens and model credentials live in server-side secrets, not client bundles or document rows. Encrypt transport; use customer-managed disk/volume encryption where required. Audit log login, permission changes, review/publish decisions, connector configuration, content exports, and external writes without logging full private prompts or document text by default.

## 5. Canonical data and workflows

Core tables/entities:

| Group | Records |
| --- | --- |
| Identity and scope | `user`, `session`, `organization`, `department`, `team`, memberships, invitations, content grants |
| Knowledge | `knowledge_item`, `knowledge_version`, `draft`, `attachment`, `publication`, `review_request`, `review_decision` |
| External intake | `source_connection`, `source_scope`, `source_object`, `source_revision`, `sync_cursor`, `intake_event` |
| Discovery | `content_chunk`, `embedding`, `graph_edge`, `search_document`, `source_citation` |
| Work and AI | `work_brief`, `ai_run`, `ai_context_ref`, `external_action`, `audit_event` |

Every object has a stable ID and owning organization. Versions are immutable once submitted or published. A shared item's *visible publication* is a pointer to an approved snapshot, not the mutable draft row. State transition:

```text
private original ──explicit copy──▶ shared draft
shared draft ──submit snapshot──▶ in review
in review ──changes requested──▶ new draft
in review ──reject───────────────▶ closed
in review ──approve──────────────▶ approved snapshot
approved snapshot ──publish──────▶ current publication
current publication ──revise─────▶ new shared draft
current publication ──archive/revoke──▶ hidden/tombstone
```

Approval is bound to a content hash/version and scope. Any edit after approval invalidates that approval. Publishing requires separate authorization, even if the same person may hold both reviewer and publisher roles under the customer's policy. External source objects are not silently rewritten into official Arden knowledge. A contribution copy preserves provenance internally, but shared viewers must not gain a backdoor link to a private original.

## 6. Ingestion, search, and AI

Pipeline:

```text
note/file/Jira/GitHub → scope + source ID → raw revision → safe extraction
  → normalized document + provenance → policy classification
  → chunks + full-text index + embeddings → suggested graph links
  → query-time authorization and freshness checks → UI/AI
```

Begin with Markdown, plain text, DOCX, and text-based PDF. Display a clear unsupported/needs-OCR state for scans instead of pretending they were indexed. Keep source ID, revision/hash, fetch time, extraction version, model/embedding version, and indexing status. Jobs are retryable and idempotent; unchanged sources do not get re-embedded. Connector setup allows selected Jira projects and GitHub repositories, minimal scopes, initial backfill limits, webhook where practical, and scheduled reconciliation. The Intake screen surfaces failures, staleness, conflicts, and promotion suggestions; it does not require a human to approve every synchronized object.

Search uses PostgreSQL full-text plus vector similarity. Authorized candidates are selected *before* snippets/answers are returned, and a final authorization check runs before response emission. Model-generated citations are not trusted by themselves; the server maps citation IDs to retrieved, authorized versions. Results and answers label **official published**, **shared draft**, **external source**, and **private note** distinctly. Freshness and conflicting sources must be visible.

The model gateway receives only the query plus selected, authorized excerpts and source metadata. It holds no direct DB credential and no general connector token. Ollama is installed on the customer's private network with cloud features disabled for strict-private mode; a firewall/egress test is still required. The model/profile can be configured for CPU, local GPU, or a separate customer GPU host. A CPU-only server may support modest embeddings and slow/small chat models, but **does not guarantee acceptable multi-user AI performance**. The installer should run a benchmark and present supported capacity tiers rather than silently choosing a weak model. An external provider is opt-in with an exact data-flow warning and no automatic failover from private to cloud.

External documents are untrusted input: they can contain prompt-injection text. Retrieval must not grant the model tool authority; any outgoing action needs a server-side capability check, human preview/confirmation, and an audit event. Never use retrieved text as a system instruction.

## 7. Desktop, web, and updates

Both clients share feature packages and call the same API. The first desktop installer targets Windows; Linux desktop packaging is a later release, while the web app remains available in supported browsers. Desktop adds native file picking, optional tray/deep links, secure local drafts/cache, and a configurable Arden Core URL. Sign-in uses a system-browser flow where available; avoid embedding a broad privileged browser. Electron renderer has Node integration off, context isolation on, sandbox on, strict CSP, and a minimal preload interface. Store tokens in the operating system's protected credential store if feasible, not localStorage.

The server remains the authority. Offline desktop behavior in V1: open recent **already cached and still-valid** personal content, edit a personal draft, queue it for later upload, and clearly mark it unsynced. Shared material, permissions, review actions, external writes, AI, and cross-device conflict resolution require the server. On reconnect, re-check permission before showing cached shared content; encrypted cache and expiry/remote wipe behavior require a threat-model decision. A later full offline-first phase needs a real sync protocol, conflict semantics, revocation rules, and tests across multiple devices.

Desktop binaries should be versioned and signed for supported operating systems. Provide a customer-controlled update feed or manual installers for disconnected environments. The API advertises a supported client-version range so an old desktop binary fails gracefully rather than corrupting data. No mandatory call-home for licensing or updates.

## 8. Installation and environments

Customer installation on Ubuntu 24.04/Coolify: one Git-based or versioned-image Docker Compose application containing `web`, `api`, `worker`, `postgres` with pgvector, and optional `ollama` (or a configured private model host). Only the reverse proxy exposes web/API; PostgreSQL, worker, and model ports stay private. Persistent volumes hold PostgreSQL, attachments, and model files. Coolify handles deployment and TLS; it does **not** replace a tested application-data backup. The installer needs a setup wizard/CLI for domain, first administrator, storage, private-AI endpoint, capacity check, and backup destination.

**Pilot allocation chosen by the team:** 4 vCPU, 12 GB RAM, and the existing 100 GB disk for the application/Coolify host. Developers run locally; staging is started only when needed; private AI runs on a separate customer-controlled machine. This is a starting capacity target, not a production guarantee. Store backups off-server and measure CPU, memory, disk, indexing lag, and response times before increasing load or promising customer capacity.

Each developer has a local Compose stack with isolated database, files, connector sandbox credentials, and seed data. A developer may run the web/API/worker on the host for hot reload while PostgreSQL and Ollama remain in containers. Tests use disposable databases. Staging and production are **separate Coolify projects/stacks with separate PostgreSQL volumes, secrets, connector credentials, model settings, and domains**. Do not copy real production content into staging without approved sanitization. Deploy an immutable image digest to staging, run migration/restore/security smoke tests, then promote the *same digest* to production. Run migrations once, forward-only with tested rollback/restore plan. Prefer expand/migrate/contract changes to keep desktop compatibility.

Backups cover database **and** attachments, connector configuration/secrets, and encryption-key recovery; model weights can usually be redownloaded unless air-gapped. Encrypt off-host backups, test restoration on staging, and define target RPO/RTO before selling production reliability. Add health checks, queue depth, connector sync lag, failed jobs, disk capacity, model latency, and audit/security alerts. A single Coolify host is a valid pilot, not high availability. For a company requiring HA, design separate database/storage/compute and operational support later.

## 9. Delivery sequence

Treat the existing approximately 14-week academic window as a **pilot demonstration**, not as a production-hardening claim. Keep a continuous end-to-end vertical slice. If schedule slips, cut breadth rather than privacy controls.

| Window | Build and acceptance gate |
| --- | --- |
| Weeks 1–2 | Repo, Compose, CI, domain model, auth, org/team membership, threat model. A fresh developer can start locally with seed data. |
| Weeks 3–4 | Shared web/desktop shell, personal notes/files, versioned storage, graph home with manual links. Personal data does not leak to another member. |
| Weeks 5–6 | Shared draft/review/approval/publication states, audit events, access tests, right-side Knowledge Pane. Editing an approved version invalidates approval. |
| Weeks 7–8 | Extraction, full-text search, embeddings, local AI gateway, cited Q&A. AI refuses or marks missing evidence; revocation removes results. |
| Weeks 9–10 | Jira read integration and My Work/brief; GitHub read integration for selected repos/PRs. Source provenance and staleness visible. |
| Weeks 11–12 | Link suggestions, useful graph filters/neighborhoods, intake failures, installer flow, staging environment and restore test. |
| Weeks 13–14 | Security regression, Windows desktop packaging, workload/AI benchmark, user testing, documentation, demo rehearsal. One thin Jira-create flow only if all earlier gates are green. |

Pilot scope deliberately excludes real-time co-editing, full offline sync, browser extension, arbitrary MCP connectors, automatic publication, GitHub writing, OCR, SAML/SCIM, fine-tuning, and multi-node HA. These are later phases, not implicit V1 promises.

After the pilot, the first sellable self-hosted release needs security review, packaging/signing, install/upgrade/rollback tests, documented support matrix, rate limits and quotas, hardening of connector permission mapping, audited backup/restore, observability, license review for distributed models/dependencies, and a license/update mechanism that works without mandatory egress. Optional hosted Arden Cloud follows only after the single-customer product is operationally sound.

## 10. Release gates and unresolved choices

Do not declare a release ready until these tests pass:

- A private note, its title, embedding, graph edge, and AI-derived summary are invisible to another member and a manager without a grant.
- Unpublishing, source revocation, source deletion, and membership removal stop search/graph/AI access immediately; slow cleanup does not keep data visible.
- A published answer cites the exact approved version; newer unapproved edits cannot appear as official guidance.
- An inaccessible Jira/GitHub object cannot be exposed by a connector token, related node, citation, cached snippet, or model prompt.
- A Jira-create timeout does not produce duplicate issues; outbound text and destination are visible before confirmation.
- A customer can install, back up, restore, upgrade, and run private AI without Arden-operated services or unapproved egress.
- Desktop and web handle incompatible server/client versions and server outage without silent data loss.

Decisions to make with the team/customer before implementation locks them in:

1. Minimum AI hardware/capacity target and supported Windows versions for the pilot.
2. Whether pilot connectors are personal-only or whether the customer can supply a reliable source-to-Arden group mapping for shared sync.
3. Whether reviewer and publisher may be the same person, and who can perform administrative recovery of private data.
4. Required backup RPO/RTO, retention/deletion policy, and whether air-gapped installation is a contractual requirement from day one.
5. Whether standalone personal spaces outside an organization are in scope.
6. Which specific Jira/GitHub editions and authentication modes the pilot must support.

## Sources for technology decisions

- [Vite guide](https://vite.dev/guide/), [Fastify TypeScript](https://fastify.dev/docs/latest/Reference/TypeScript/), [Electron security](https://www.electronjs.org/docs/latest/tutorial/security/)
- [Better Auth Drizzle adapter](https://better-auth.com/docs/adapters/drizzle), [Better Auth organization plugin](https://better-auth.com/docs/plugins/organization), [Drizzle migrations](https://orm.drizzle.team/docs/drizzle-kit-generate)
- [PostgreSQL row security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html), [pgvector](https://github.com/pgvector/pgvector), [pg-boss](https://github.com/timgit/pg-boss)
- [BlockNote collaboration](https://www.blocknotejs.org/docs/features/collaboration), [Sigma.js documentation](https://www.sigmajs.org/docs/)
- [Coolify Docker Compose deployment](https://coolify.io/docs/applications/builds/docker-compose), [Supabase self-hosting responsibilities](https://supabase.com/docs/guides/self-hosting)
- [Ollama cloud/private mode](https://docs.ollama.com/cloud), [GitHub App permissions](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app), [Jira issue API](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/)
