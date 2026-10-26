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
| Shared Arden knowledge | Department-owned content with optional team/project attributes and a department or organization audience | Draft or contribution from an authorized member | Final approval triggers system publication of the exact snapshot. Visibility and official status are separate. |
| External work context | Jira, GitHub, and other source-owned objects | Scoped connector sync or on-demand fetch | Inherits the connector's permitted audience and remains labeled external/unapproved. Promotion to Arden knowledge requires review. |

The home screen is a **permission-filtered graph**, not a decorative graph tab. A left rail opens Graph, My Work, Intake/Sources, Reviews, and Administration. Selecting a node opens a right-side Knowledge Pane with content, provenance, freshness, links, and actions. A full editor handles sustained writing. The floating Arden Agent can use an explicit context basket containing selected nodes, passages, or tasks; users can inspect what will be sent to the model.

Graph nodes include notes, published pages, external issues and pull requests, people/departments where policy permits, work briefs, and source files. Edges include `links_to`, `references`, `supports`, `supersedes`, `belongs_to_task`, and `derived_from`. The server must authorize **both endpoints and the edge itself** before returning graph data. There must be no hidden-node counts, labels, search suggestions, or graph layouts that reveal inaccessible information. Start with focused neighborhoods, filters, search, and an onboarding sample, not an unreadable whole-company hairball.

### Core journeys

1. **Capture → understand:** write a private note or upload a file; Arden extracts text, records source/version, indexes it, suggests links, and answers questions with citations.
2. **Contribute → govern:** copy selected private content into a shared draft; clean and preview it; submit an immutable snapshot; reviewer approves or rejects; approval starts publication preparation and index-ready activation makes the snapshot current; later revisions repeat this path.
3. **Work → context:** connect a Jira project and selected GitHub repositories; a task's Knowledge Pane shows relevant code changes, decisions, runbooks, and notes. A work brief records current context and sources without pretending to be official policy.
4. **Ask → verify:** AI retrieves only authorized and current material, distinguishes official/shared/external/personal sources, cites exact versions, and states uncertainty or conflict.
5. **Draft → act externally:** if authorized, Arden may prepare a Jira issue with a precise preview of text and destination. The user confirms. Arden records idempotency and reconciles uncertain outcomes before any retry.

AI is an assistant, not a publisher or autonomous administrator. It may propose links, summaries, edits, briefs, and tasks. It may never silently publish shared guidance or send content to Jira/GitHub.

## 3. Chosen stack

| Layer | Choice | Why |
| --- | --- | --- |
| Codebase | TypeScript core monorepo plus separate Python 3.11 `Arden-AI` repository | Keep product/domain authorization cohesive while allowing the AI pipeline to use the strongest supported ecosystem and deploy independently. |
| Web | React + Vite + React Router + TanStack Query | The app is authenticated and highly interactive; server rendering/SEO bring little value. |
| Desktop | Electron + electron-vite using the same React feature packages | Faster parity between web and desktop than separate UI stacks. Narrow, typed preload APIs only. |
| Editor | BlockNote core, wrapped behind an Arden document interface | Good writing UX; keep stored document format versioned so the editor can be replaced. Check the license for any non-core components before adopting them. |
| Graph | Sigma.js + Graphology | WebGL rendering and graph utilities suited to interactive neighborhoods. The graph is a projection of canonical relationships, not the primary database. |
| API | Fastify + schema-validated HTTP API; Supabase Realtime for notifications | A long-running, self-hosted API with explicit security boundaries and simple client contracts. |
| Identity | Supabase Auth for accounts/sessions; Arden-owned organization and content authorization | Avoid rebuilding login. The organization's structure and document ACL cannot be delegated to the identity provider. |
| Database | PostgreSQL for canonical state; self-hosted ChromaDB for derived vectors | Keep governance and permissions transactional while scaling/rebuilding retrieval independently. |
| Jobs | Durable generation/outbox state in Arden core; separate Python AI worker | Retries cannot bypass core authorization or activate partial generations. |
| Files | Private Supabase Storage behind Arden's storage/authorization boundary | Supplied object APIs and scoped access; policies, revocation, and coordinated backups remain ours. |
| AI | OpenAI embeddings and generation through the private `Arden-AI` service; self-hosted Langfuse | Use one supported API stack for the demo while keeping prompts, retrieval and observability behind an internal service boundary. |
| Deployment | Versioned Docker Compose deployed by Coolify | Matches the Ubuntu 24.04 server and makes customer installation reproducible. |
| Tests | Vitest, API/integration tests against PostgreSQL, Playwright end-to-end | Permissions and review transitions need executable evidence. |

The accepted architecture uses Supabase PostgreSQL, Auth, Storage, and Realtime with Fastify domain APIs and reviewed Drizzle/SQL migrations. Supabase supplies identity and supporting data services; it does not replace Arden's organization authorization, privacy policy, governance, or reviewed domain migrations. Keep service-role keys server-side, and authorize direct database, Storage, and Realtime access with policies equivalent to Arden's API rules. Do not run Better Auth alongside Supabase Auth. See [decision 0001](docs/decisions/0001-supabase-and-hybrid-development.md) and the [technology guide](docs/engineering/technology-guide.md).

Do not introduce a graph database, Elasticsearch, Kubernetes or Redis before measured needs justify them. PostgreSQL stores canonical entities, permissions and explicit edges. ChromaDB stores only derived retrieval records and receives a generation allow-list already computed from PostgreSQL AccessPolicy. Approximate ranking is never evidence of authorization; Arden core rechecks evidence before model context or output.

### Repository shape

```text
apps/
  web/             authenticated React application
  desktop/         Electron main, preload, renderer shell
  api/             Fastify API, authentication, authorization
  worker/          core durable orchestration and maintenance
packages/
  ui/              shared components and themes
  domain/          types, workflow state machines, policies
  api-client/      typed client contracts
  db/              Drizzle schema and reviewed SQL migrations
  editor/          Arden document model and BlockNote adapter
  graph/           graph queries, layout, shared UI
deploy/
  compose/         customer, staging, and local templates
docs/              install, backup, threat model, operations
```

The sibling `Arden-AI` repository contains the Python compiler, chunking, OpenAI, ChromaDB and
Langfuse adapters. It exposes versioned internal contracts and has no authority to activate a
publication or broaden an AccessPolicy allow-list.

The API is the only routine writer to Arden content; browser and desktop never connect directly to PostgreSQL. Worker operations use narrowly scoped service permissions and record their effects. Use one reviewed migration system, not schema push on production.

## 4. Trust and permissions

The trust boundary is the **customer installation**. Arden's company does not need access to its data. The customer controls host, backups, model endpoint, connectors, outbound network policy, and updates. Optional Jira/GitHub integrations still exchange data with those external providers, and confirmed outbound actions send the previewed content to the selected provider. However, this is not end-to-end encryption against the customer's own server/root/DB administrators: server-side search, review, and AI need plaintext processing. Do not market it as such.

Within an installation, the required hierarchy is organization → departments, with users assigned to departments. Team and project are optional document attributes, not mandatory entities or permission-inheritance levels. Each user has a personal workspace **per organization**. A standalone personal-only account is an open product decision, not an assumed feature. Operational roles (instance admin, org admin, department manager, reviewer, member) and content permissions are distinct. Being a manager does **not** automatically grant read access to private notes. Only the owner, a deliberate share, or a narrowly defined administrative recovery mechanism can make private content available at the application layer. Customer infrastructure administrators are outside that guarantee.

Org Admins manage organization members, departments, and audience groups. Published content targets one or more canonical audiences: `ORGANIZATION_ALL`, `DEPARTMENT_ALL`, or `GROUP`. An active member may read when one current audience matches; the same grant permits authorized search and a separate contribution copy, but never administration, review, source editing, or publishing. Authors may target only audiences they currently belong to in the selected scope. Org Admin and ReviewerGrant status are not implicit readership. Private originals remain owner-only. Arden System Admin is installation-scoped, outside organizations, and has no content or impersonation access. See [decision 0010](docs/decisions/0010-audiences-and-system-administration.md).

Use explicit authorization functions such as `canReadContent(actor, object, version)` and `canPublish(actor, scope, approvedSnapshot)` in one domain package, exercised from every API, background job, search result, citation, graph response, download, AI context builder, and event stream. PostgreSQL row-level security is a defense-in-depth control on sensitive tables using a non-bypass application role; avoid relying on RLS alone, and test service/worker roles separately. Versioned policy tests should enumerate role, scope, source, and action combinations.

The accepted first-slice organization, membership, session, and owner-private note boundary is documented in [the first-slice permission and API contract](docs/engineering/first-slice-permission-and-api-contracts.md) and [decision 0002](docs/decisions/0002-first-slice-private-notes-contract.md). Its implementation and verification status are recorded separately; this acceptance does not extend to organization bootstrap, invitations, or role administration.

For external systems, a connector's broad token is **not** blanket permission for all Arden users. V1 should support two safe modes: (1) per-user personal connection, visible only to that user; (2) explicitly scoped shared connection to selected repositories/projects and an Arden audience that is no broader than the source's allowed audience. If source permissions cannot be mapped with confidence, show the item only to the connecting user/admin until it is deliberately contributed through review. Treat source revocation, deletion, or permission change as a synchronous visibility block first; purge/reindex derivatives asynchronously. Embeddings, snippets, titles, graph edges, cached summaries, citations, and AI history are derivatives too.

Uploads must enforce size/type limits, content-type verification, safe extraction, malware scanning policy, and per-tenant quotas. Connector tokens and model credentials live in server-side secrets, not client bundles or document rows. Encrypt transport; use customer-managed disk/volume encryption where required. Audit log login, permission changes, review/publish decisions, connector configuration, content exports, and external writes without logging full private prompts or document text by default.

## 5. Canonical data and workflows

Core tables/entities:

| Group | Records |
| --- | --- |
| Identity and scope | `user`, `session`, `organization`, `department`, memberships, invitations, content grants; optional team/project document attributes |
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
in review ──final approve────────▶ system publishes approved snapshot ──▶ current publication
current publication ──revise─────▶ new shared draft
current publication ──archive/revoke──▶ hidden/tombstone
```

Approval is bound to a content hash/version and scope. The working draft may continue changing, but those edits never alter the reviewed snapshot. Final approval moves that exact snapshot to `PREPARING`; only a complete index generation followed by atomic activation makes it current. There is no publisher role or manual Publish action. Review, preparation and activation remain distinct audit events. External source objects are not silently rewritten into official Arden knowledge. A contribution copy preserves provenance internally, but shared viewers must not gain a backdoor link to a private original.

### Proposed governance review policy

The organization defines a review policy before accepting submissions: who owns each knowledge area, which reviewer grants cover the frozen reader scope and optional team/project attribute filters, the intended publication audience, and when escalation or periodic re-review is needed. Department and Organization reviewer grants are disjoint: a Department grant covers department/group-only snapshots owned by that department, while an Organization grant covers snapshots read by everyone in the organization. Neither scope inherits the other. A reviewer with a tag-filtered grant does not automatically approve every narrower team/project category. This is Arden's proposed operational interpretation of [ISO/IEC 38505-1:2026](https://www.iso.org/standard/87195.html) data-governance guidance, not a review sequence or reviewer count mandated by that standard. See [decision 0015](docs/decisions/0015-organization-wide-reviewer-grants.md).

Authors no longer choose a classification or reviewer level. New submissions use one reviewer with the grant scope derived from their frozen readers. Legacy `INTERNAL`, `CONFIDENTIAL` and `RESTRICTED` submissions retain the rules under which they were submitted; legacy Restricted still requires a Specialist or Senior grant until schema contraction. Additional review steps apply only under a future explicit organization policy. No classification adds a human Publish action. If the intended audience cannot be safely enforced, approval must be denied; the author may submit a new snapshot after rejection.

Submission fixes the content, metadata, classification, owner, intended audience and version/hash for review. An eligible assigned reviewer checks quality, evidence, currency, ownership and release scope; ordinary reviewers cannot approve their own version. Organization Admin is the final authority and may self-approve with explicit audit evidence. Authority is checked again at decision time. The reviewer records approval or a reasoned rejection. A rejected author may continue editing and submit a new snapshot. All required decisions cover the same snapshot and scope.

The server moves exactly the finally approved snapshot into publication preparation and records the decision and policy version. A failed compiler/index generation must not expose a partial or unapproved version. Only a complete generation may atomically replace the current-publication pointer; search and AI therefore observe the same active authorized version. A revised version repeats review while the existing publication remains current, and loss of current access blocks search and AI use immediately.

## 6. Ingestion, search, and AI

Pipeline:

```text
note/file/Jira/GitHub → scope + source ID → raw revision → safe extraction
  → normalized document + provenance → policy classification
  → chunks + full-text index + embeddings → suggested graph links
  → query-time authorization and freshness checks → UI/AI
```

Begin with Markdown, plain text, DOCX, and text-based PDF. Display a clear unsupported/needs-OCR state for scans instead of pretending they were indexed. Keep source ID, revision/hash, fetch time, extraction version, model/embedding version, and indexing status. Jobs are retryable and idempotent; unchanged sources do not get re-embedded. Connector setup allows selected Jira projects and GitHub repositories, minimal scopes, initial backfill limits, webhook where practical, and scheduled reconciliation. The Intake screen surfaces failures, staleness, conflicts, and promotion suggestions; it does not require a human to approve every synchronized object.

Search uses PostgreSQL for canonical filters/full-text state and ChromaDB for vector retrieval. Authorized generation IDs are selected *before* vector retrieval, and a final core authorization check runs before model context or response emission. Model-generated citations are not trusted by themselves; the server maps citation IDs to retrieved, authorized versions. Results and answers label **official published**, **shared draft**, **external source**, and **private note** distinctly. Freshness and conflicting sources must be visible.

For published Arden content, retrieval uses the current actor's verified active membership plus managed-audience eligibility or active audience-group membership; any one matching audience is sufficient. Private originals never enter shared-organization retrieval. Membership, department, or audience-group revocation must block subsequent retrieval and contribution actions before derivative cleanup completes.

The AI gateway receives only the query plus selected, authorized excerpts and source metadata. It
holds no direct business-database credential and no general connector token. The demo uses OpenAI
for embeddings and generation; this external data flow must be configured explicitly and must not
silently receive unauthorized or unnecessary content. ChromaDB and Langfuse remain on the private
network. Provider changes and any future local-model mode require a reviewed capability, privacy
and quality decision; there is no automatic fallback.

External documents are untrusted input: they can contain prompt-injection text. Retrieval must not grant the model tool authority; any outgoing action needs a server-side capability check, human preview/confirmation, and an audit event. Never use retrieved text as a system instruction.

## 7. Desktop, web, and updates

Both clients share feature packages and call the same API. The first desktop installer targets Windows; Linux desktop packaging is a later release, while the web app remains available in supported browsers. Desktop adds native file picking, optional tray/deep links, secure local drafts/cache, and a configurable Arden Core URL. Sign-in uses a system-browser flow where available; avoid embedding a broad privileged browser. Electron renderer has Node integration off, context isolation on, sandbox on, strict CSP, and a minimal preload interface. Store tokens in the operating system's protected credential store if feasible, not localStorage.

The server remains the authority. Offline desktop behavior in V1: open recent **already cached and still-valid** personal content, edit a personal draft, queue it for later upload, and clearly mark it unsynced. Shared material, permissions, review actions, external writes, AI, and cross-device conflict resolution require the server. On reconnect, re-check permission before showing cached shared content; encrypted cache and expiry/remote wipe behavior require a threat-model decision. A later full offline-first phase needs a real sync protocol, conflict semantics, revocation rules, and tests across multiple devices.

Desktop binaries should be versioned and signed for supported operating systems. Provide a customer-controlled update feed or manual installers for disconnected environments. The API advertises a supported client-version range so an old desktop binary fails gracefully rather than corrupting data. No mandatory call-home for licensing or updates.

## 8. Installation and environments

Customer installation on Ubuntu 24.04/Coolify targets versioned services for `web`, `api`,
`Arden-AI`, ChromaDB, Langfuse and Supabase PostgreSQL/Auth/Storage/Realtime. Only the reverse
proxy exposes approved application endpoints; database, worker, Chroma and observability ports
stay private. Protected persistent storage holds PostgreSQL, Chroma indexes and attachments.
Coolify handles deployment/TLS; it does **not** replace coordinated application-data backup.
The installer still needs domain, initial administrator, storage, OpenAI, capacity and backup
setup. This full installation is not implemented by the development bootstrap.

The latest development layout uses local frontends and four hosted API/database slots.
Development may share PostgreSQL compute with separate databases/login roles; staging and
production require separate instances, volumes, collections and secrets. The previous 4 vCPU/12
GB pilot target is not a verified allocation. Measure CPU, memory, disk and realistic vector load
before expanding; four logical databases are not four Supabase projects. See [the implementation
guide](docs/engineering/remote-development.md).

Each developer has a local stack with isolated database, Chroma collection, files, connector
sandbox credentials, and seed data. A developer may run the web/API/AI service on the host for hot
reload while PostgreSQL and ChromaDB remain in containers. Tests use disposable databases and
collections. Staging and production are **separate Coolify projects/stacks with separate
PostgreSQL/Chroma volumes, secrets, connector credentials, model settings, and domains**. Do not
copy real production content into staging without approved sanitization. Deploy immutable image
digests to staging, run migration/restore/security smoke tests, then promote the same digests to
production. Run migrations once, forward-only with tested rollback/restore plan. Prefer
expand/migrate/contract changes to keep desktop compatibility.

Backups cover database **and** attachments, connector configuration/secrets, and encryption-key recovery; model weights can usually be redownloaded unless air-gapped. Encrypt off-host backups, test restoration on staging, and define target RPO/RTO before selling production reliability. Add health checks, queue depth, connector sync lag, failed jobs, disk capacity, model latency, and audit/security alerts. A single Coolify host is a valid pilot, not high availability. For a company requiring HA, design separate database/storage/compute and operational support later.

## 9. Delivery sequence

Treat the existing approximately 14-week academic window as a **pilot demonstration**, not as a production-hardening claim. Keep a continuous end-to-end vertical slice. If schedule slips, cut breadth rather than privacy controls.

| Window | Build and acceptance gate |
| --- | --- |
| Weeks 1–2 | Repo, Compose, CI, domain model, auth, organization/department membership, threat model. A fresh developer can start locally with seed data. |
| Weeks 3–4 | Shared web/desktop shell, personal notes/files, versioned storage, graph home with manual links. Personal data does not leak to another member. |
| Weeks 5–6 | Shared draft/review/approval/publication states, audit events, access tests, right-side Knowledge Pane. Editing an approved version invalidates approval. |
| Weeks 7–8 | Extraction, full-text search, embeddings, local AI gateway, cited Q&A. AI refuses or marks missing evidence; revocation removes results. |
| Weeks 9–10 | Jira read integration and My Work/brief; GitHub read integration for selected repos/PRs. Source provenance and staleness visible. |
| Weeks 11–12 | Link suggestions, useful graph filters/neighborhoods, intake failures, installer flow, staging environment and restore test. |
| Weeks 13–14 | Security regression, Windows desktop packaging, workload/AI benchmark, user testing, documentation, demo rehearsal. One thin Jira-create flow only if all earlier gates are green. |

Pilot scope deliberately excludes real-time co-editing, full offline sync, browser extension, arbitrary MCP connectors, AI-initiated publication, GitHub writing, OCR, SAML/SCIM, fine-tuning, and multi-node HA. These are later phases, not implicit V1 promises.

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
3. Who can perform administrative recovery of private data.
4. Required backup RPO/RTO, retention/deletion policy, and whether air-gapped installation is a contractual requirement from day one.
5. Whether standalone personal spaces outside an organization are in scope.
6. Which specific Jira/GitHub editions and authentication modes the pilot must support.

## Sources for technology decisions

- [Vite guide](https://vite.dev/guide/), [Fastify TypeScript](https://fastify.dev/docs/latest/Reference/TypeScript/), [Electron security](https://www.electronjs.org/docs/latest/tutorial/security/)
- [Supabase Auth](https://supabase.com/docs/guides/auth), [Supabase Storage access control](https://supabase.com/docs/guides/storage/security/access-control), [Supabase Realtime authorization](https://supabase.com/docs/guides/realtime/authorization), [Drizzle migrations](https://orm.drizzle.team/docs/drizzle-kit-generate)
- [PostgreSQL row security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html), [Chroma architecture](https://docs.trychroma.com/docs/overview/architecture)
- [BlockNote collaboration](https://www.blocknotejs.org/docs/features/collaboration), [Sigma.js documentation](https://www.sigmajs.org/docs/)
- [Coolify Docker Compose deployment](https://coolify.io/docs/applications/builds/docker-compose)
- [OpenAI API documentation](https://platform.openai.com/docs), [GitHub App permissions](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app), [Jira issue API](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/)
