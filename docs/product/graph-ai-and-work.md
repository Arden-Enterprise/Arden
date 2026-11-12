# Graph, agent and work-context coverage

Read the [feature index](README.md), especially G1/G2/G4. Sources: [blueprint journeys](../../ARDEN_BLUEPRINT.md#core-journeys), [current design](../../DESIGN.md), main technology/status guides, ARD-50/ARD-52 through ARD-61, the pinned branch ADR 0011/0012 and [Arden-AI at the inspected revision](https://github.com/Arden-Enterprise/Arden-AI/blob/405023927b0256122989da3339e89027934086e5/README.md).

Provenance: ARD-50 records the project lead's graph/chat request and UI ownership; public ADR 0012 records project-lead approval of a separate AI service on a branch. Exact historical individuals beyond recorded evidence are not inferred. Blueprint-only future scope remains proposed, not a new commitment. Delivery owners remain in existing Linear work. The following cases describe evidence to obtain, not a passing implementation report.

## F11 Library and search

### Knowledge management refinement (KM-v1, accepted 12 November 2026)

Decision owner: requesting project maintainer. Origin: maintainer's QMS-informed
Library review and approved interactive reference. Recorded by Codex. The maintainer
explicitly approved applying the reference and subsequently confirmed Org Admin
catalog ownership. Private attribution/discussion remains in Knowledge. Baseline:
Core staging `0e25b71`, main `9fa3d34`; delivery branch `feat/knowledge-management`,
tracking ARD-77. Acceptance is not deployment evidence.

Delivery checkpoint: the maintainer has not accepted the implemented UI and has
handed its revision to the UI owner. The metadata, catalog and authorization
contract below remains accepted. Current screen composition and generated cover
art are candidates, not approved final visuals; F11-KM6 visual acceptance remains
open. This branch is a source handoff, not a staging release.

Keep Arden's Island shell, typography, icons and violet/graphite palette. Library
has Discover, All documents and My Contributions; Reviews remains separate.
Discover contains search, business Topics, optional curated Collections and newly
published documents. All documents is a searchable register with Type, Topic and
Owner Department filters. Returning from a reader preserves the Library selection.
Use original Arden artwork for collection covers, not reference-company assets.

Required **at submission**, not draft save: Title, Type, one primary Topic,
Content (editor or text-extractable PDF), business Version, Effective Date and
explicit Target Readers. Types: Policy & Standard, Procedure, Guide, Reference,
Lessons Learned. Expiration Date is optional and cannot precede Effective Date.
An update to previously published knowledge requires a Change Note. Business
Version is not the technical save revision. Document Code is generated once per
logical document, independent of Type/department, and stays stable across versions.
Owner Department follows the author's primary department. Author, Published Date,
Last Updated and current-version identity are system-owned. Published Date means
availability; Effective Date means applicability. An upcoming Effective Date alone
does not prevent authorized reading. Applicability is Upcoming / Effective /
Expired, separate from submission/preparation states. Do not introduce a separate
Superseded reader status.

Remove Classification, Team/Project permission tags, redundant Category/Location/
Handbook Type, upload Summary, Keywords and Review Cycle from the standardized
form. Preserve frozen review provenance and existing authorization behind the UI.
Collections are optional reading bundles, not upload requirements or access grants.
Org Admin alone creates/manages Topics and Collections; authors select existing
active Topics. Curators may add only documents they can currently read. Every
collection read, count, cover, title and document projection must be filtered by
current reader authorization; the admin role is not a content-read bypass.

Legacy pending snapshots keep their frozen contract. Do not infer canonical
metadata from PDF names or silently broaden old readers. Legacy publications stay
readable under existing rules until a separately authorized metadata backfill.
No staging reset/re-index, production changes, new AI capability, OCR or image
understanding is part of this implementation. Temporal AI version selection is
separate from the human-readable applicability dates.

| Acceptance ID | Observable case | Delivery evidence |
| --- | --- | --- |
| F11-KM1 | Discover/register use real authorized documents; filters, counts, New/Updated and Back work without mock fallback. | Local UI/pure filtering tests; browser Collection → register → reader → Back. No staging backfill/deploy. |
| F11-KM2 | Admin manages catalog; non-admin and cross-organization writes fail; stale edits conflict without overwrite. | Real runtime PostgreSQL catalog tests, HTTP/precondition tests, post-ownership rerun. |
| F11-KM3 | Collection curation rejects unreadable sources; revocation removes content and derived discovery/counts. | Real active Org Admin denied curation of a real restricted publication; membership/retired-pointer checks. |
| F11-KM4 | Incomplete drafts save; submit requires normalized metadata and explicit readers; date/change-note validation is clear. | Domain/API/real DB cases; browser form. PDF replacement shares the existing optimistic revision path. |
| F11-KM5 | Metadata/code are frozen with review and publication; later draft/catalog edits do not rewrite an approved version. | Actual submit → approve → index activation, pending edits and SQL immutability denial; current Topic label frozen at submit. |
| F11-KM6 | Shared web/desktop UI preserves style, accessible loading/empty/error/cancel paths; original assets are actually consumed. | UI interaction tests and web/desktop builds; local browser art/filter/reader/dirty-Cancel checks. Native runtime not certified. |

Local implementation/verification notes and the separately authorized migration,
backfill and release boundary: [Knowledge management rollout](../engineering/knowledge-management.md).

Path: permitted reader opens current published library → searches/filters → selects a result → reads the correct source/version or sees an understandable empty/denied/error state.

| Acceptance ID | Complete path to verify | Evidence / remaining |
| --- | --- | --- |
| F11-AC1 | List/detail/search return only current eligible content with provenance; hidden titles, snippets, totals and suggestions do not leak. | Main published-list/detail slices exist; complete search/index integration is not established. |
| F11-AC2 | Search and agent retrieval use the selected current-publication policy, including immediate access revalidation after revocation. | Depends on F04/F10 and G1/G2. |
| F11-AC3 | Empty/error/stale/outage states, accessible filtering and exact-version navigation work without synthetic fallback pretending to be live results. | Link real UI/API evidence for the implemented slice. |

## F12 Graph and context

Path requested in ARD-50: left navigation → dominant central graph → search/pan/zoom/fit/select → selected-item details → optional right-hand agent panel/context selection. Current graph remains planned; My Work is the current implemented entry screen.

| Acceptance ID | Complete path to verify | Evidence / remaining |
| --- | --- | --- |
| F12-AC1 | Accepted wireframes cover chat closed/open, selected item and narrow screen; opening/closing chat preserves position, zoom, selection and conversation. | ARD-50 records scope; versioned accepted graph/chat design and default landing decision remain. |
| F12-AC2 | Graph controls/details have keyboard and list alternatives, focus restoration, responsive layout and loading/empty/error/unavailable states on supported web/Windows clients. | A canvas mockup or static sample is not live graph acceptance. |
| F12-AC3 | Both endpoints and edges are authorized; explicit context-basket additions/removals show what will be sent and never reveal hidden content/counts/layout hints. | Depends on graph API and F04/F13; client hiding is insufficient. |

## F13 Grounded agent

Path: user asks with explicit permitted context → Core calculates allowed versions → retrieval → permitted evidence/context → generation → validated answer/citations with final access recheck. ARD-52 is the umbrella; later branch ADR 0012 changes its older architecture wording.

| Acceptance ID | Complete path to verify | Evidence / remaining |
| --- | --- | --- |
| F13-AC1 | Indexing and retrieval apply Core-owned organization/version allow-lists, exclude incomplete generations and never broaden access in the AI service. | Arden-AI service/source exists; paired Core integration and G1/G2 remain unverified here. |
| F13-AC2 | Answers cite exact permitted versions/source blocks, validate structured references and clearly report missing/conflicting evidence; forged citations and injected document instructions grant no authority. | Source tests are not a complete integrated browser-to-provider acceptance result. |
| F13-AC3 | Provider timeout, partial batch, revoked access and observability outage fail safely; external-provider consent/data-flow policy is explicitly reconciled with current Core before changing it. | ADR 0012 is branch-only; do not silently override main's private-inference boundary. |

## F14 Conversation history

Path: start conversation → exchange grounded messages → reopen history → revalidate changed access/version availability → continue or show unavailable evidence. Related work: ARD-59.

| Acceptance ID | Complete path to verify | Evidence / remaining |
| --- | --- | --- |
| F14-AC1 | Core persists only authorized actor/organization conversation state; another member cannot access history through guessed IDs. | Planned; integrated implementation not established by this audit. |
| F14-AC2 | Current access revalidates stored messages/evidence; revoked material cannot leak through old messages, citations or context reuse. | Needs an accepted retention/deletion and redaction contract. |
| F14-AC3 | Retry/cancel, interrupted streaming, lost session and web/desktop resumption have explicit consistent outcomes. | Specify supported behavior rather than inferring it from a chat component. |

## F15 Work context and handover

Path: open My Work → inspect permitted tasks/context → create/read a work brief or transfer responsibility → recipient receives/acknowledges where accepted. Main has labelled session previews; live persistence/notifications and exact task scope are not established.

| Acceptance ID | Complete path to verify | Evidence / remaining |
| --- | --- | --- |
| F15-AC1 | Each queue/count/brief declares whether it is live, sample or unavailable and preserves source provenance and current permissions. | Current design owns layout; do not present sample activity as server work. |
| F15-AC2 | Accepted handover ownership/receipt rules cover inactive recipients, changed access, duplicates and failed delivery. | Detailed production contract/provenance remains incomplete; obtain it before implementing that promise. |
| F15-AC3 | Selected task/context survives supported navigation without exposing unrelated private notes or claiming official policy status. | Live connectors and storage are separate dependencies. |

## F16 External sources

Proposed blueprint path: connect a scoped Jira/GitHub source → select authorized objects → ingest/version → display source ownership/freshness → resync/revoke. Connector editions, authentication and source-to-Arden audience mapping remain open decisions.

| Acceptance ID | Complete path to verify | Evidence / remaining |
| --- | --- | --- |
| F16-AC1 | The selected connector/authentication and source-audience mapping are accepted; one token never grants every Arden user access to its objects. | Proposed roadmap; no live connector implementation certified. |
| F16-AC2 | Pagination, rate limiting, invalid credentials, partial sync, changed source access/deletion and retries have explicit safe behavior and provenance. | Specify and test the selected supported source slice. |
| F16-AC3 | Revocation removes read/search/graph/agent access immediately, independently of asynchronous cleanup; external context is not silently promoted to official Arden knowledge. | Requires full consumer-path evidence. |

## F17 External actions

Conditional later pilot path: prepare a Jira action → show exact content/destination → user confirms → execute once → reconcile uncertain outcome. GitHub writing and arbitrary external actions are not implicit V1 scope.

| Acceptance ID | Complete path to verify | Evidence / remaining |
| --- | --- | --- |
| F17-AC1 | The action is explicitly selected/authorized and the user sees exact destination and payload before confirmation. | Conditional proposed scope; no implementation claim. |
| F17-AC2 | Expired confirmation, changed payload/destination and denied source permissions prevent execution. | Do not treat AI output or a connector token as authorization. |
| F17-AC3 | Timeout/duplicate retry is reconciled using the selected idempotency/outcome design; cancellation and audit are legible. | Obtain external-effect evidence only within authorized disposable scope. |
