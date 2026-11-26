# Graph, agent and work-context coverage

Read the [feature index](README.md), especially G1/G2/G4. Sources: [blueprint journeys](../../ARDEN_BLUEPRINT.md#core-journeys), [current design](../../DESIGN.md), main technology/status guides, ARD-50/ARD-52 through ARD-61, the pinned branch ADR 0011/0012 and [Arden-AI at the inspected revision](https://github.com/Arden-Enterprise/Arden-AI/blob/405023927b0256122989da3339e89027934086e5/README.md).

Provenance: ARD-50 records the project lead's graph/chat request and UI ownership; public ADR 0012 records project-lead approval of a separate AI service on a branch. Exact historical individuals beyond recorded evidence are not inferred. Blueprint-only future scope remains proposed, not a new commitment. Delivery owners remain in existing Linear work. The following cases describe evidence to obtain, not a passing implementation report.

## F11 Library and search

### Knowledge organization restructuring (KM2, 19 November 2026)

At the requesting maintainer's explicit direction, keep Home, defer naming and
implement in independently tested/evidenced phases. The accepted target removes
Topic from the new contribution flow; Collections are single-level folders,
created only by Org Admin, containing only Organization-wide published knowledge.
Authors do not choose a Collection during contribution. The common register is
all Organization-wide knowledge, including unassigned documents, not all documents
the current actor can read. Private originals and Department/Selected readership
remain separate. These target rules supersede the corresponding Topic/curated
mixed-readership directions in KM-v1/ADR 0020, not legacy frozen snapshots.

Phase 1 adds an optional authorized publication-list scope with default
compatibility. Phase 2 locally retires Topic from contribution fields, readiness
and API/repository requirements: new saves clear the legacy reference, while
untouched old drafts and frozen snapshots remain compatible. Required Type,
Version, explicit readers and update Change Note remain; Valid until stays
optional under the current form contract. Home/catalog browsing, Collection
storage and AI paths are not restructured yet. Phase 3A locally restricts
Collection list/write/picker contents to explicit Organization publications even
when an Admin can read narrower sources; existing restricted links are hidden,
not silently migrated/deleted. The maintainer subsequently explicitly accepts
zero/one Collection per logical document, Admin-only post-publication placement,
required Name/Allowed types and optional Description. Eligible new versions keep
placement; narrower readership/incompatible Type detaches it. Archive returns
documents to Unassigned without deletion or withdrawal. See [0025](../decisions/0026-flat-organization-collection-placement.md)
and the [phased contract](../engineering/knowledge-organization-phases.md).
P3B.1 adds local schema/constraints/reconciliation only; management API/UI and
legacy mapping are not delivered yet. Naming/layout and release remain separate.
Legacy data is not reclassified or deleted.

P3B.2 now locally implements the separate configuration/placement API and explicit
legacy conversion rehearsal; see [the owning contract](../engineering/collection-legacy-transition.md).
Only converted synthetic associations are removed in tests. Management UI,
approved live mapping and physical Topic/schema contraction remain unfinished.
Old bulk-picker requests are refused, not silently adapted. No live rollout.

P3B.3 supersedes that UI-pending checkpoint locally. F11-KM2/KM3/KM6 now have
separate controlled-Type configuration and one-document conditional placement UI,
Unassigned/folder views, Archive/Cancel/dirty discard and stale/uncertain-result
recovery. Topic browse/filter controls are retired without rewriting provenance.
Production component/client browser checks use labelled synthetic HTTP fixtures;
real DB and HTTP authorization checks remain separately verified layers, not a
combined authenticated or native E2E claim. [Evidence](../evidence/2026-11-19-knowledge-organization/README.md#km2-p3b3--collection-management-ui).

P4A locally connects Home to independent Organization/Shared scopes. Organization
includes assigned and unassigned common documents; Collections never organize
restricted sources. Shared distinguishes Department and Selected readers without
disclosing selected identities. Readable legacy sources without recorded sharing
remain under Other documents until reviewed mapping. Private notes opens the
existing owner-only workspace, not a new private-file upload surface. Contributions
stay separate. Source failure is not an empty result; stale/denied sources and late
responses are handled without new content authorization or AI retrieval rules.
Per-source filters/search, reader return/focus and keyboard navigation are covered.
See [P4A evidence](../evidence/2026-11-19-knowledge-organization/README.md#km2-p4a--home-composition).
Live mapping, physical contraction and signed-in/native release acceptance remain
unfinished. These local checkpoints are not deployment receipts.

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
Discover contains search, Type groups, optional curated Collections and newly
published documents. All documents is a searchable register with Type and
Owner Department filters. Topics were removed by [ADR0027](../decisions/0027-remove-knowledge-topics.md) (18 November 2026). Returning from a reader preserves the Library selection.
Use original Arden artwork for collection covers, not reference-company assets.

Required **at submission**, not draft save: Title, Type,
Content (editor or text-extractable PDF), business Version and
explicit Target Readers. Types: Policy & Standard, Procedure, Guide, Reference,
Lessons Learned. Expiration Date is optional and inclusive through that UTC calendar day.
An update to previously published knowledge requires a Change Note. Business
Version is not the technical save revision. Document Code is retired
([ADR 0021](../decisions/0021-reader-email-search-and-no-document-code.md), 14 November 2026): documents are
identified by title, version and link, and the explicit Target Readers picker finds members by name or email.
Owner Department follows the author's primary department. Author, Published Date,
Last Updated and current-version identity are system-owned. Published Date means
availability; there is no separate Effective Date input or upcoming-publication
AI mode ([ADR0030](../decisions/0030-published-date-ai-sources.md)). Reader validity
is Current / Expiring soon / Expired, separate from submission/preparation states. Do not introduce a separate
Superseded reader status.

Remove Classification, Team/Project permission tags, redundant Category/Location/
Handbook Type, upload Summary, Keywords and Review Cycle from the standardized
form. Preserve frozen review provenance and existing authorization behind the UI.
Collections are optional reading bundles, not upload requirements or access grants.
Org Admin alone creates/manages Collections. Curators may add only documents they can currently read. Every
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

The [Company/Personal context contract](../engineering/knowledge-source-contexts.md)
records the 24 November refinement. Ask Arden uses permitted Company publications.
In Private, the right sidebar answers from the saved note currently open and resets
when the note or its revision changes. PDF imports participate via the text already
saved in the note. Private questions require organization opt-in for the configured
inference destination.

Path: user asks with explicit permitted context → Core calculates allowed versions → retrieval → permitted evidence/context → generation → validated answer/citations with final access recheck. ARD-52 is the umbrella; later branch ADR 0012 changes its older architecture wording.

| Acceptance ID | Complete path to verify | Evidence / remaining |
| --- | --- | --- |
| F13-AC1 | Indexing and retrieval apply Core-owned organization/version allow-lists, exclude incomplete generations and never broaden access in the AI service. | Arden-AI service/source exists; paired Core integration and G1/G2 remain unverified here. |
| F13-AC2 | Answers cite exact permitted versions/source blocks, validate structured references and clearly report missing/conflicting evidence; forged citations and injected document instructions grant no authority. | Source tests are not a complete integrated browser-to-provider acceptance result. |
| F13-AC3 | Provider timeout, partial batch, revoked access and observability outage fail safely; external-provider consent/data-flow policy is explicitly reconciled with current Core before changing it. | ADR 0012 is branch-only; do not silently override main's private-inference boundary. |

Reader-on-request Summary, Ask this document and Explain selection are the next
ordered slice after the local citation correction. See the [Reader AI implementation
plan](../engineering/reader-ai.md) for exact-version/coverage/source ownership and
verification requirements. Exact-source preparation and Summary backend are locally
implemented/verified through RA-03. RA-04 adds the Summary reader UI/adapters locally,
with browser and boundary tests; genuine Electron and signed-in paired-service
acceptance remain mandatory before release under the maintainer's sequencing
refinement. RA-05 stateless exact-document Q&A is implemented locally through the
purpose-restricted hybrid path and reader UI; source identity and current access
are rechecked. Selection explanation is not delivered. No general-chat history is
imported into reader Q&A; no live-provider/release acceptance is implied.

### F13-RESIZE Resizable Ask Arden side panel

- Spec revision/date: 1 / 2026-11-24. Originator and decision owner: requesting project maintainer, who asked whether the
  user can resize Ask Arden, reviewed the proposed behavior and said to build it, together with more room between the
  notification bell and the docked panel. Record author: coding agent. Decision state: the feature is **accepted**; the
  limits below are *agent choices*, **proposed — confirmation needed**. Branch `feat/resizable-ask-panel` from `staging`;
  not merged or deployed.
- Scope: while Ask Arden is docked beside the page, its left edge is a splitter. Dragging it changes the panel's width
  and the page narrows or widens beside it. With the keyboard the splitter is focusable (`role="separator"` with its
  current, minimum and maximum width); Left widens and Right narrows by 16 px, Home and End go to the narrowest and
  widest; a double-click returns to the default (360 px, 340 px below 1200 px of window width). The chosen width is
  remembered in this browser only (local storage); when storage is unavailable the default is used. The floating panel
  and the phone sheet are unchanged and have no splitter. With the panel docked the top bar keeps 20 px between the
  notification bell and the panel.
- *Agent choices:* minimum 320 px; maximum 720 px and never so wide that the page has less than 520 px (the width that
  already decides docking versus floating). A saved width wider than the current room is shown at the widest allowed
  and recovers when the window grows. No API, database or dependency change.

| Acceptance ID | Complete path to verify | Evidence / remaining |
| --- | --- | --- |
| F13-RESIZE-AC1 | Dragging the docked panel's edge changes its width within the limits; the page narrows beside it; the width survives a reload in the same browser; double-click restores the default. | Unit tests for limits and storage; UI tests for the splitter. Signed-in browser check not yet run. |
| F13-RESIZE-AC2 | The splitter works by keyboard (Left/Right/Home/End), announces its value, and is absent when the panel floats or is a phone sheet. | UI tests. Screen-reader check not run. |
| F13-RESIZE-AC3 | With the panel docked, the notification bell keeps visible space from the panel edge. | CSS only; not checked in the signed-in app. |

## F14 Conversation history

The maintainer-approved combined F13/F14 implementation is specified by
[GA-v2](../engineering/governed-hybrid-answering.md), including hybrid retrieval,
staged evidence authorization, current-publication selection and owner-private
history. It is in progress, not a deployment receipt. ADR 0021 records the explicit
current-publication default; ADR0030 retires its temporal modes and lineage.

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
