# Knowledge organization restructuring

Owner: product/engineering maintainers. Tracking: ARD-77.
Accepted direction: requesting maintainer, 19 November 2026, following the
Organization/private/shared and flat-Collection comparison. Recorded by Codex.
Baseline: staging `af28915231817aaf6efc67c8f534b627aa45b178`, fetched main
`9fa3d34a19a559318eff87b4487f2113e6ee5a49`.

This is a phased implementation handoff, not a completed migration or a new
private-drive feature. Keep Home. Naming and layout are deferred. Target Readers
remains the readership authority; the owner's department is responsibility, not
an access grant. Private originals remain private when a copy is contributed.

## Phases and gates

| Phase | Bounded outcome | Checkpoint |
| --- | --- | --- |
| KM2-P1 | Existing document/data mapping and explicit authorized publication list scopes. Preserve default readers and AI. | Implemented locally; tests/evidence below. No migration or Home changes. |
| KM2-P2 | Topic-free contribution through immutable review, preparation and correct publication/readership. | Implemented/tested locally, evidence below; legacy data reconciliation remains a separate prerequisite to rollout. |
| KM2-P3 | Flat, optional post-publication Collections for Organization-wide knowledge. | P3A tested locally. P3B one-folder/Admin placement, Allowed types and version/Archive rules explicitly approved; incremental implementation in progress. |
| KM2-P4 | Connect the flows to Home and complete web/Windows acceptance and authorized data/release work. | P4A Home implemented/tested locally, evidence below. Live/native/release gates remain separate. |

Each phase needs a report, its actual tests, screenshot evidence with an explicit
boundary, and a resume checkpoint. Backend test-report screenshots are not UI,
PostgreSQL, provider or native acceptance. Live schema/backfill/release work needs
separate backup/rehearsal/target authority; do not reset the corpus or reindex it
merely because the reading views changed.

## P4A accepted implementation slice — 19 November

The maintainer explicitly requests Phase4 after P3B.3. Keep Home and Island assets;
connect Organization common knowledge, Shared with me and My Contributions without
changing readership or publication. Organization includes overview, complete common
register and optional Collections/Unassigned; folder placement never removes an
item from the common register. Scope/filter/search/count state is separate from
Shared with me. A Private notes entry opens the existing owner-private workspace,
respecting its capability and retaining its controller/drafts; no private-PDF drive
or private contents/counts in published results. Naming is functional, not a new
brand/navigation approval.

Use explicit scoped API lists, defensively reject scope-mismatched responses, and
preserve currently readable legacy publications without recorded Target Readers
in an explicitly separate Other documents view using the compatible default list.
Do not classify them from department, filename or selected member count. Source
loading/failure/revocation/context changes must not leak one bucket into another;
outage is not a valid empty result. Reader Back retains the originating view and
filters. AI/citation selection still uses its existing authorized exact-version
path, independently of the current Home view. No corpus mutation or new migration.

Acceptance IDs: F11-KM2/KM3/KM6 plus KM2-P4A-1 (source segregation/legacy), -2
(overview/master/Collection/Unassigned), -3 (private/contribution exits and reader
return), -4 (loading/outage/late results/keyboard/responsive), -5 (local tests and
labelled screenshots). Genuine Electron, combined signed-in E2E, reviewed live
mapping, protected restore/cutover and physical contraction are remaining P4 gates,
not permissions inferred from this implementation request.

P4A local verification: root1007 pass/one provider-gated skip with isolated real
PostgreSQL enabled, UI441 (including21 Home cases), remote16, workspace typecheck
and web/API/Electron builds pass. Seven screenshots and observed browser paths are
in [P4A evidence](../evidence/2026-11-19-knowledge-organization/README.md#km2-p4a--home-composition).
Browser fixtures are synthetic, not authenticated DB/native acceptance. No new SQL,
dependency/model, provider call, live data change or Git/release publication.

## Existing entity and identity mapping

| Responsibility | Existing source | Identity / rule |
| --- | --- | --- |
| Owner-private original | `private_workspace`, `draft_document`, `draft_version` | Owner-only note/version. Never folded into a published list or AI context by this phase. |
| Contribution lineage | `shared_draft` | Stable `shared_draft_id`, returned as `draftId` on a publication. Reuse this existing lineage for subsequent design; do not create another Document entity merely to rename it. |
| Saved working content | `shared_draft_version` | A saved content revision, not the business Version label. |
| Review candidate | `shared_submission` | Immutable submitted content/metadata/readers. Later draft edits do not rewrite approval. |
| Published evidence | `published_knowledge_version` | `published_version_id`, returned as `id`; exact reader/citation identity, distinct from `draftId`. |
| Reader-visible current pointer | `knowledge_current_publication` | Existing eligibility and RLS/query rules select current content. Scope filtering does not select a different version or activate anything. |
| Approved readers | `reader_selection` / `selected_reader` | Organization, Department or Selected members. Neither responsible department, author status, Admin status nor Collection placement replaces this check. |
| Business metadata | `management` on draft, submission and publication | Canonical Type/Version and legacy Topic values, distinct from PDF text and technical revision numbers. |
| Existing Collection links | `knowledge_collection_document` | Pins exact `published_version_id` and permits multiple links. Not silently converted to a new logical-document FK/cardinality in Phase 1. |

Source: migrations 0001/0006/0010/0024/0030 and
`apps/api/src/db/repository.ts`, especially the published selector/mapper,
`updateKnowledgeDraft`, `listPublishedKnowledge` and `getPublishedKnowledge`.
This phase maps existing objects; it does not certify all live rows or change SQL.

## KM2-P1: publication list contract

`GET /api/v1/organizations/:organizationId/knowledge/published` accepts optional
`scope`, strictly one of:

| Scope | Result after existing current actor authorization |
| --- | --- |
| omitted / `ALL_READABLE` | Existing permitted publications, including the legacy audience-backed path. Unchanged response shape. |
| `ORGANIZATION` | Only an explicit approved `targetReaders.mode = ORGANIZATION`. A department-owned organization-wide document belongs here. |
| `SHARED` | Only approved Department/Selected members publications the actor can actually read. Not every publication owned by the actor's department. |

Unknown, empty and duplicate scope values are invalid. No `PRIVATE` scope exists
on this published-only endpoint. Scope is a narrowing view, never a grant.
Authentication, membership, RLS/current-pointer eligibility and API `canRead`
remain authoritative. No caching entitlement, Admin bypass, source URI or
selected-member identity exposure is added. Response remains `Cache-Control: no-store`.

Publications without Target Readers remain in the compatible default only. Do not
infer organization-wide sharing from a null selection, a filename, the owner's
department or a selected set that happens to contain everyone. Later Home changes
must reconcile this inventory before dropping the default legacy view.

The shared client adds an optional third `scope` argument. Existing calls remain
unchanged, including current Home. Electron permits exactly one valid scope query
only on the bodyless published-list GET; it rejects unrelated keys/routes/methods.
The new client option requires this backend version; compatibility with an older
server ignoring unknown query keys is not established. Do not enable scoped Home
views against an older backend without capability/version handling.

Ask Arden and Reader AI are unchanged. Their authorized-source/selected-version
paths are not narrowed to Organization because a Home reading view is narrowed.
No model call, embedding, reindex, schema migration or data mutation is necessary
for Phase 1.

### Metadata trace and limitation

Migration 0030 adds nullable `management` columns without populating old
publications. Its trigger copies draft metadata to submission, then publication;
it does not extract Type/Version from PDF text or filenames. Repository
`mapPublishedKnowledge` preserves `row.management`; the list route preserves it
and `KnowledgeLibraryBrowse` renders absent Type/Version as a dash. Type counts
use `management.type`, not title prefixes. Draft metadata edits do not backfill
immutable published metadata.

This source path explains how legacy null metadata reaches the register, and a
regression confirms scope filtering preserves null instead of inventing metadata.
It does **not** establish which storage values caused each missing field in the
previous signed-in staging observation. Exact row-level inventory/backfill is
still pending; do not report a live DB diagnosis or repair from this source trace.

## Verification and remaining acceptance

### KM2-P2: Topic-free contribution

The new contribution form has Type, business Version, optional Valid until,
conditional update Change Note and explicit Target Readers, but no Topic or
Collection selector. Submit no longer requires a loaded/active Topic catalog.
Existing empty-draft saving, owner-department synchronization, content/readership
requirements, revision conflict and pending-submission checks remain. The Island
styles and Back/Cancel controls are retained without a navigation redesign.

The API accepts metadata with Topic omitted or null. For older clients it also
accepts a syntactically valid legacy `topicId`, but a new metadata save normalizes
it to null and drops the old display label. Invalid supplied values still fail
validation. Saving/submitting no longer consults the Topic catalog. The server
still validates Type/Version/dates and update Change Note; it does not permit
Collection placement through author input.

Compatibility is deliberately incremental: a draft not resaved can retain its old
Topic value, including an inactive catalog reference. It can submit without a
forced extra save. Its immutable snapshot retains the legacy reference/display
label; subsequent draft saves clear only the mutable working metadata. Previously
submitted/published objects are never rewritten. Existing nullable/generated FK
and snapshot-copy triggers already support Topic-free metadata, so no new SQL,
schema-version change or operator migration is necessary for this slice. Catalog
administration and old Home Topic browsing remain until their later UI slice.

Real PostgreSQL cases exercise new Topic-free Organization/Department/Selected
submission, approval, preparation and atomic worker activation after the existing
38 migrations and DDL ownership handoff. They retain actual runtime reader denial,
including an Admin excluded from a Selected publication, and legacy snapshot
immutability. The existing private-copy and revocation suites also run. Activation
uses synthetic manifests, not a real AI provider/indexing pipeline. Web component
checks cover Topic/catalog independence, readiness and save payloads; native
Electron and authenticated staging E2E remain release gates.

The earlier 26/27 missing displayed Type/Version finding is **not repaired** here.
Before rollout, inventory each exact publication/lineage and its stored metadata,
identify an authoritative business source, prepare a proposed Type/Version/date
mapping with evidence, review conflicts with the owner, and separately authorize
an appropriate forward repair/republication. Do not infer labels from a filename,
update immutable snapshots in place or reset/reindex the corpus. The inventory
and approved mapping are open work, not a claim of a completed live diagnosis.

Local Phase 2 checks and screenshots: [Phase 2 evidence](../evidence/2026-11-19-knowledge-organization/README.md#km2-p2--topic-free-contribution).

### KM2-P3A: Organization-only Collection boundary

The maintainer requests Phase 3. Its previously accepted Organization-only
contents rule can be implemented independently of the still-open folder data
model. Catalog reads and writes now reuse the explicit Organization scope
predicate in addition to existing current-publication and actor reader checks.
A Department/Selected source is ineligible even when its curator is a permitted
reader or Org Admin. Unknown/null legacy reader modes are not inferred as common
knowledge. Creation and catalog writes remain Org Admin only.

The existing Collection picker offers only explicit Organization publications,
with truthful empty/no-search-result feedback. Search and Cancel/Keep working/
Discard remain available. A checkbox sizing correction prevents the general text
input width from separating the checkbox from its title; existing styles/assets
and navigation are otherwise retained. This is not the final folder layout.

Pre-existing restricted links are omitted from returned document IDs and derived
counts; folders with only ineligible links are not discovery results, even for
an Admin who may read those documents elsewhere. An approved readership change
to Department removes the source from subsequent Collection responses without
changing the actor's normal document access. The existing internal links remain
untouched and are preserved during edits. This is a read/write guard, not an
approved detach/backfill/move strategy. No schema/RLS/function owner changes.

At the P3A checkpoint three product decisions were pending; the later accepted
P3B section below supersedes that status. Existing
exact-publication/multiple-link data is **not** silently migrated. Author upload,
Target Readers, Home projections and AI retrieval are unchanged by this slice.
The full Phase 3 is therefore partial, not complete or release-ready.

Evidence: [P3A report and component screenshot](../evidence/2026-11-19-knowledge-organization/README.md#km2-p3a--organization-only-collection-boundary).

### KM2-P3B: accepted folder governance, 19 November

The requesting maintainer explicitly approves the three pending choices. One
logical document has zero or one Collection, with Org Admin alone adding/moving/
removing after publication. Name and nonempty Allowed types (the five existing
controlled Types) are required; Description is optional. Placement never changes
Type/readers. Valid new publications follow the logical document's placement;
scope/Type ineligibility detaches it. Archive detaches contents to Unassigned,
without deleting documents/history or withdrawing publication. These choices
supersede the earlier pending status, not the independent publication contract.

Implement/test in bounded substeps. First add forward-only schema/constraints and
reconciliation, preserving old exact-publication links for explicit inventory
rather than silently choosing a folder for conflicting legacy data. API/UI wiring
and concurrent move acceptance follow the schema checkpoint; do not describe a
schema-only unit as a complete management workflow. No staging migration/release
is authorized by these product decisions.

The maintainer then explicitly approves the API → legacy conversion → safe cleanup
sequence. [P3B.2 contract/runbook](collection-legacy-transition.md) owns the local
implementation, required reviewed mapping, intentional old-client rejection and
remaining Topic/schema contraction/UI/live-release boundaries.

#### P3B.1 database checkpoint

Operator migration 0039 adds controlled `allowed_types` (NULL means legacy
unconfigured), `knowledge_collection_placement` keyed by existing `shared_draft_id`,
same-organization FKs, active Organization/Type validation and reconciliation.
Unassigned rows retain monotonic server revisions; no runtime DELETE grant.
The trigger-only trusted validator preserves postgres ownership and has no
runtime EXECUTE, avoiding broader publication-table grants. Reviewed definer
inventory becomes 33; real workflow tests run after DDL handoff.

Archive/Type narrowing, approved reader restriction, withdrawal/current-pointer
changes and actual worker activation reconcile eligibility. A compatible activated
version retains location; an incompatible replacement clears it without rewriting
three-version history. Concurrent expected-revision moves have one winner. Tests
also reject Member/foreign/unpublished/restricted/invalid-Type placement.

This schema foundation is **local only**. Old exact-publication links are neither
copied nor deleted; old API/UI still use them. No claimed management feature until
P3B.2 connects atomic CAS placement and required Allowed types, resolves legacy
compatibility, audits mutations and returns safe conflicts. Inventory old links
and obtain reviewed destinations rather than choosing one silently. P3B.3 then
adds UI/empty/stale/confirmation/E2E paths without adding an Author picker.

Actual checks and screenshot: [P3B.1 evidence](../evidence/2026-11-19-knowledge-organization/README.md#km2-p3b1--flat-folder-database-foundation).
No API/UI/native/staging/provider or full restore acceptance follows from schema
tests. No old migration edit, corpus reset/reindex, push/PR/merge or deployment.

#### P3B.3 UI acceptance (implemented locally, release acceptance pending)

Continue the approved flat-folder contract with separate Collection configuration
and one-document placement. Admin management shows Unassigned and folder contents;
configuration requires Name/Allowed types and never posts document IDs. Moving a
document loads its logical-document revision, offers only active compatible folders
or Unassigned, and uses conditional PATCH. Conflict/uncertain outcomes require a
fresh read before another write. Archive confirms detachment without withdrawal.
Keep visible Cancel/Back, unsaved-change protection, keyboard access, and concise
loading/empty/error feedback. Remove retired Topic browsing controls, not historical
metadata or database tables. Actual component/browser evidence must identify local
fixtures separately from authenticated live/native acceptance. No release authority.

Local shared UI now uses the separate config/placement adapters. The manager
shows Unassigned/folder contents, explicit legacy setup state and archived shells.
The old bulk picker and live Topic browsing controls are removed. Current normal
Home at this historical checkpoint still lists all readable documents; P4A now
connects the accepted scope projections locally. Native/authenticated combined E2E, live reviewed mapping, physical
contraction and release remain separate. See [P3B.3 evidence](../evidence/2026-11-19-knowledge-organization/README.md#km2-p3b3--collection-management-ui).

### Staging transition checkpoint — 20 November 2026

The maintainer authorizes protected backup/restore, operator migrations 0039 and
0040 and staging release for the accepted KM2 slices. Exactly 30 hash-matched
PDFs receive verified missing Type/Version and retained ARD identity in missing
snapshot fields; files/readers/index/history and four other publications remain
outside the repair. ADR0025 records this bounded immutable-metadata exception.
Corrected real restored-copy rehearsal passes; final CI/live apply/deploy remain
separate. Old Collection archive/mapping is still unanswered; no destination or
physical deletion is inferred. See the current evidence report for actual scope,
negative tests, timestamp rollback discovery and native acceptance limits.

### KM2-P1 historical checkpoint

Phase 1 adds pure domain, Fastify request, shared web/desktop client and Electron
allowlist tests. Cases cover scope partitioning, misleading owner department,
mixed/legacy corpus, metadata preservation, denied/currently changed readers,
suspended/cross-organization actors, sign-in, invalid/duplicate queries, compatible
default behavior and no provider invocation.

Current evidence: [Phase 1 report](../evidence/2026-11-19-knowledge-organization/README.md).
No real PostgreSQL test, native Electron launch, staging E2E or deployment is
claimed by this source/API-only phase. Current default UI is unchanged.
F11-KM1/KM3/AC1 reader-scope behavior is partially covered, not the complete broader
F03/F07-F11 workflow. Later phases must preserve metadata freezing, selected-reader
privacy, exact citations, withdrawal rules, file integrity and supported platforms.
