# Spec: `knowledge-graph` (`F12`) — V1

- Spec revision/date: `v1-accepted` (reconciled and approved) / 2026-11-26
- Decision state: **accepted** ([ADR 0036](../../decisions/0036-knowledge-graph-and-modular-typed-ui-blocks.md); local implementation and verification in progress)
- Originator: requesting project maintainer
- Decision owner: requesting project maintainer
- Record author: coding agent
- Approval: maintainer approved architecture, reconciled `v1` spec, and published-only link-editor placement on 2026-11-26
- Intended audience: public-safe repository specification
- Source/code baseline and affected repositories: originally specified against `Arden` `origin/staging` `fa4d6fe` (`0001`–`0070`); integrated on 2026-11-27 onto `Arden` `staging` `b4c6ef0` (migrations `0001`–`0074`, adding `0076`–`0077`)
- Related Linear issue: `ARD-50`
- Parent Capability Map: [CAPABILITY-MAP.md](CAPABILITY-MAP.md) (`knowledge-graph`)
- Supersedes / superseded by: supersedes `Sigma.js + Graphology` in [technology-guide.md](../../engineering/technology-guide.md#9-xyflowreact-d3-hierarchy-and-elkjs); supersedes unpublished-draft `document_relationship` RLS in `0027_document_category_relationships.sql`; resolves `G4` in [docs/product/README.md](../../product/README.md)

---

## 1. Objective

Deliver an authorized, read-only, tree-first **Knowledge Graph** (`/graph`) for published Company knowledge that operationalizes **ISO/IEC 38505-1:2026** (Clauses 7 & 8: 11 governance principles and *Engage stakeholders – Evaluate – Direct – Monitor*) with deep filtering and full WCAG 2.2 AA Outline parity across Web and Windows Electron 44:

- **For Readers:** Explore current authorized Company publications via the default **Accountability View** (`Organization → Owner Department → Controlled Document Type [5 values + Uncategorized legacy] → Published Documents`) or the **Collections View** (`Organization → Organization Collections + Unassigned`, keeping `Shared [Department / Selected Members / Legacy Audience]` visibly separated per [ADR 0026](../../decisions/0026-flat-organization-collection-placement.md)), toggle explicit dual-endpoint-authorized cross-document links (`REFERENCES`, `RELATED`, `SUPERSEDES`), filter interactively, and open exact document versions.
- **For Accountable Stewards (Authors, Disjoint Responsible Reviewers per `0060`/`ADR 0015`, Org Admins):** Opt into **Governance Monitor Mode** to inspect expiry risk (`Expiring ≤ 30d`), authorized open maintenance cases (strictly scoped per `0043`/`0060` & `ADR 0023` §5), unassigned Organization-wide documents, and optionally expired publications awaiting renewal/withdrawal—routing each role to its valid `openTarget` (`READER`, `RESPONSIBLE_VIEW`, `ADMIN_INSPECTION`, or `MY_CONTRIBUTIONS`) without hitting `410 DOCUMENT_EXPIRED` or `404` dead ends.
- **For Authors & Org Admins (with read access to both endpoints):** Declare and remove governed `document_relationship` links between published documents with atomic idempotency (`409 IDEMPOTENCY_CONFLICT`), cycle/dedupe protection, and consequential-only auditing (`ADR 0035`).

---

## 2. Tech Stack & Dependencies

- **Existing Core/Client Stack:** TypeScript `5.9.3`, React `19.3.0`, Vite `7.3.6`, Fastify `5.12.5`, PostgreSQL 17 (`FORCE RLS`, `arden_runtime`), Electron `44.4.3` (`electron-vite 5.0.0`, `script-src 'self'` CSP).
- **New UI Dependencies (`packages/ui/package.json`, Ask-First lockfile + `pnpm audit` gate):**
  - `@xyflow/react` (MIT) — lazy-loaded on `/graph` route; DOM/SVG viewport, pan/zoom, custom React Island nodes, edge routing, keyboard focus hooks.
  - `d3-hierarchy` + `@types/d3-hierarchy` (ISC) — synchronous deterministic left-to-right collapsible tidy tree layout (default).
  - `elkjs` (EPL-2.0) — dynamically imported on demand (`elkjs/lib/elk.bundled.js`) **only** when cross-document links are toggled ON; runs in-thread (zero `blob:` Web Worker violation under Electron `script-src 'self'` CSP) with an automatic threshold (`<= 250` visible nodes AND `<= 500` visible edges; above that threshold, render cross-links as crisp bezier overlays over the `d3-hierarchy` tree so the main thread never freezes). Exact gzipped bundle sizes are measured during Phase 4 build verification.

---

## 3. Deep-Module Architecture & Seams (`codebase-design`)

| Module | Seam | Narrow Interface | Hidden Implementation Depth |
| --- | --- | --- | --- |
| `GraphProjectionService` (`apps/api/src/graph/`) | Core HTTP route ↔ PostgreSQL repository | `getGraph(actor, orgId, query): Promise<KnowledgeGraphPayload>` | Loads capabilities, readable or Monitor documents, and optional relationships inside one `withActor` transaction. Ordinary (`monitor=false`) requests run a lightweight capability check and materialized RLS projection without invoking `list_graph_monitor_documents(...)`; Monitor requests run `list_graph_monitor_documents(...)` once (with `open_case_counts` guarded for accountable roles) for scoped `openTarget` and nullable case counts. Returns a deterministic page with the authorized focus target and the 500-document and 1,000-edge caps. |
| `DocumentRelationshipService` (`apps/api/src/graph/`) | Core HTTP route ↔ PostgreSQL repository | `createRelationship(actor, orgId, sourceDocId, input, idempotencyKey)` / `removeRelationship(actor, orgId, sourceDocId, relationshipId, idempotencyKey)` | Enforces Author/Org-Admin authority (re-derived in DB from `role_assignment`), dual-endpoint read access on create, source-read access on remove (preventing undeletable ghost edges), advisory-locked `SUPERSEDES` acyclicity & symmetric `RELATED` dedupe, append-only `document_relationship_idempotency` ledger (`409 IDEMPOTENCY_CONFLICT`), uniform `404 RESOURCE_NOT_AVAILABLE`, and `ADR 0035` audit events. |
| `GraphLayoutEngine` (`packages/ui/src/graph/layout.ts`) | Pure domain layout seam (UI ↔ `@xyflow/react` + Outline) | `computeGraphLayout(payload, viewMode, collapsedBranchIds, clientFilters, crossLinksOn): Promise<LayoutResult>` | Pure, side-effect-free transformation producing positioned React Flow nodes/edges (`d3-hierarchy` or bounded `elk.bundled.js`), dimmed/isolated filter states, AND the identical flattened accessible `OutlineNode[]` treegrid array. Zero React or DOM dependency—100% unit-testable. |

---

## 4. Data Model, RLS & Migration Contract

### 4.1 Forward operator migrations (`0076_graph_document_relationships.sql` & `0077_graph_monitor_projection.sql`)

Migration headers MUST begin with `SET search_path TO arden, public;`. Register both migration hashes in `apps/api/migrations/release-policy.json` and register every new `SECURITY DEFINER` function in the exact inventory inside `deploy/release/security-definer-owner-repair.sql` (`57` → `62` trusted `arden` routines, preserving the three isolated `arden_system` routines; never list functions inside `release-policy.json`).

#### 1. Replace `0027` permissive `document_relationship` policies (closes B1 bypass)
`0076` MUST explicitly **drop** all three permissive `0027` policies before creating replacements so PostgreSQL cannot OR-combine legacy draft policies:
```sql
DROP POLICY document_relationship_author_read ON document_relationship;
DROP POLICY document_relationship_author_insert ON document_relationship;
DROP POLICY document_relationship_author_delete ON document_relationship;
```
*(Reconciling existing test `apps/api/src/target-readers/target-readers.integration.test.ts:417–434`: because `document_relationship` now governs published Company knowledge links rather than unpublished draft-to-draft links, update that test fixture in the same PR so `source` and `target` are published before linking, while keeping cross-org, self-link, and outsider-denial assertions intact and adding dual-endpoint restricted/expired/ghost-cleanup RLS cases.)*

#### 2. Canonical readability predicate & `document_relationship` RLS
Reuse one canonical `STABLE` SQL helper `current_readable_document_ids()` (matching `eligible_ai_publications()`'s exact `cp.valid_from <= now()`, `cp.valid_until IS NULL OR cp.valid_until > now()`, `pv.published_at <= now()`, `kb.organization_id = cp.organization_id`, `d.status = 'ACTIVE'`, `publication_expiration_date(pv.published_version_id, pv.management)` inclusive UTC check, and `Target Readers` / legacy `audience_reader_memberships` checks—without requiring `pv.index_status = 'INDEXED'` so newly published non-indexed documents still appear in the Graph; expiry hiding stays inside the projection helper per `ADR 0032:67`, never altering `published_knowledge_version` RLS itself!):

- **`SELECT` policy (`document_relationship_dual_reader_select`):**
  ```sql
  CREATE POLICY document_relationship_dual_reader_select
  ON document_relationship FOR SELECT TO arden_runtime
  USING (
    organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
    AND source_document_id IN (SELECT current_readable_document_ids())
    AND target_document_id IN (SELECT current_readable_document_ids())
  );
  ```
  - **Zero-leak guarantee:** Both endpoints must be currently readable and unexpired to the actor. Monitor Mode does **not** widen `document_relationship` `SELECT` to expose edges between restricted expired documents without an `ADR 0023` inspection.
- **`INSERT` policy (`document_relationship_governed_insert`):**
  - `organization_id = current_org`
  - `created_by_membership_id` MUST equal the caller's active `organization_membership.membership_id` (prevents creator spoofing!)
  - Caller is either the active author of `source_document_id` OR an active Organization Admin (re-derived directly from `role_assignment` + `organization_role` in DB—NEVER trusting `arden.org_admin` GUC per `ADR 0023:144–145`!)
  - **Both** `source_document_id` AND `target_document_id` MUST be in `current_readable_document_ids()` (prevents Org Admins or Authors from probing unreadable restricted target UUIDs!).
- **`DELETE` policy (`document_relationship_governed_delete`):**
  - `organization_id = current_org`
  - Caller is active author of `source_document_id` (current or expired published source) OR active Organization Admin (re-derived in DB) **who can read `source_document_id`** (`actor_in_reader_selection` / `audience_reader_memberships`, blocking non-reader Org Admins from deleting or probing restricted `SELECTED_MEMBERS`/`DEPARTMENT` sources without an `ADR 0023` inspection) — **intentionally NOT requiring `target_document_id` to remain readable** so stale ghost edges whose target later expired or narrowed Target Readers can always be removed cleanly by the source owner or source-reading Admin!
- **Concurrency, `SUPERSEDES` acyclicity, & symmetric `RELATED` deduplication trigger:**
  - `BEFORE INSERT` trigger acquires an org-scoped transaction advisory lock `pg_advisory_xact_lock(hashtext('arden:doc_rel:' || NEW.organization_id::text))`.
  - If `NEW.relationship_type = 'RELATED'` and reverse row `(NEW.target_document_id, NEW.source_document_id, 'RELATED')` already exists, raise unique conflict (`23505`, mapped to `409 RELATIONSHIP_EXISTS` or idempotent replay).
  - If `NEW.relationship_type = 'SUPERSEDES'`, run a recursive CTE checking whether `NEW.target_document_id` can already reach `NEW.source_document_id` via `SUPERSEDES`; if so, reject (`409 RELATIONSHIP_CYCLE`).
  - Document explicitly: `document_relationship.relationship_type = 'SUPERSEDES'` is an **informational cross-document lineage link** between distinct logical documents; it does NOT alter Flow 2 version replacement pointers, Home visibility, or AI source eligibility.

#### 3. Append-only idempotency ledger (`document_relationship_idempotency`)
Modeled directly on `maintenance_idempotency` (`0043_maintenance_cases.sql:92–104`), with **NO cascading delete** from `document_relationship` so `POST .../remove` replays survive row deletion:
- Columns: `(organization_id, actor_membership_id, idempotency_key, operation ['CREATE'|'REMOVE'], request_hash text, status_code smallint, response_json jsonb, created_at timestamptz)`, PK `(organization_id, actor_membership_id, idempotency_key)`, `FORCE RLS` scoped to active org & actor membership.
- Reusing an `Idempotency-Key` with a different `request_hash` returns **`409 IDEMPOTENCY_CONFLICT`** (matching Arden's existing convention in `app.ts:985`, never `422`).
- Note on cascade deletes: `shared_draft` deletion is not exposed for published documents (`ON DELETE CASCADE` applies only to test/operator teardown), so all runtime link removals pass through `DocumentRelationshipService.removeRelationship` and write `DOCUMENT_RELATIONSHIP_DELETED`.

#### 4. Reviewed `SECURITY DEFINER` Monitor Projection (`list_graph_monitor_documents`)
Because `publication_expiration_date()` (`0068:59`) is `SECURITY INVOKER` over `FORCE RLS` table `publication_validity_renewal` and `published_knowledge_version` RLS excludes restricted publications from non-reader Admins/Reviewers, Monitor Mode uses one reviewed `STABLE SECURITY DEFINER` routine `list_graph_monitor_documents(p_include_expired boolean)` (owned by `postgres`, `SET search_path = arden, pg_temp`, `REVOKE ALL FROM PUBLIC`, `GRANT EXECUTE TO arden_runtime`, registered in `deploy/release/security-definer-owner-repair.sql`):
- Computes exact actor accountability across **all** current AND expired publications (so an Author whose only published doc just expired STILL gets `canUseMonitorMode: true` and can open Monitor Mode to renew it!).
- Returns metadata-only rows for:
  1. Publications the actor can read normally (`openTarget = 'READER'` if unexpired; `'MY_CONTRIBUTIONS'` if actor is Author & expired),
  2. Unexpired or (when `p_include_expired = true`) expired publications the actor authored (`openTarget = 'MY_CONTRIBUTIONS'` when expired),
  3. Unexpired or expired publications covered by the actor's **disjoint active reviewer grant** using `0060`'s `maintenance_reviewer_eligible` + `dep.status = 'ACTIVE'` (`openTarget = 'RESPONSIBLE_VIEW'` when restricted or expired),
  4. Unexpired or expired publications in the org when the actor is an active Organization Admin (re-derived from `role_assignment`; `openTarget = 'ADMIN_INSPECTION'` when restricted or expired, preserving `ADR 0023`).
- Hydrates `authorDisplayName` via `list_publication_author_names(uuid[])` (`0068:550`) and effective expiry via `publication_expiration_date(...)` internally under trusted execution.
- Computes **`openMaintenanceCaseCount: number | null`**:
  - Counts ONLY Flow 4 `maintenance_case` rows in `SUBMITTED` or `IN_PROGRESS` states pinned to the document's **current** `published_version_id` (excluding legacy unimported `publication_report` rows).
  - Returns an integer (`>= 0`) **ONLY** when the caller is an active Org Admin OR a disjoint eligible non-author reviewer for that document (`0060` `maintenance_reviewer_eligible`).
  - Returns **`null`** for ordinary readers AND for Authors on their own documents (matching `0043`/`0060` and `ADR 0023` §5: *"Other readers do not see reports"* — never showing misleading `"0 open cases"` and never leaking confidential report existence!).

#### 5. Audit Event Vocabulary (`ADR 0035`)
Add `DOCUMENT_RELATIONSHIP_CREATED` and `DOCUMENT_RELATIONSHIP_DELETED` storing `{ relationshipId, sourceDocumentId, targetDocumentId, relationshipType }` only—**never titles, excerpts, or user emails**. Routine read-only Graph viewing, filtering, and Monitor browsing are not audited.

---

## 5. API & TypeScript Interface Contract (`api-and-interface-design`)

### 5.1 Endpoints (Identical Across Web and Electron)

| Method & Path | Purpose | Preconditions / Idempotency | Error Codes |
| --- | --- | --- | --- |
| `GET /api/v1/organizations/:organizationId/knowledge/graph` | Fetch authorized graph nodes, hierarchy metadata, bounded dual-endpoint edges, and Monitor capabilities | `Cache-Control: no-store`; active org membership | `400`, `401`, `404`, `503` |
| `POST /api/v1/organizations/:organizationId/knowledge/documents/:documentId/relationships` | Declare explicit directional relationship from `:documentId` to `targetDocumentId` | Required `Idempotency-Key` (UUID); active Author or Org Admin AND dual-endpoint readable; uniform `404` on missing or unreadable target | `400`, `401`, `404`, `409`, `503` |
| `POST /api/v1/organizations/:organizationId/knowledge/documents/:documentId/relationships/:relationshipId/remove` | Remove explicit relationship (`{}` body) | Required `Idempotency-Key` (UUID); active Author or Org Admin with source read/ownership; uniform `404` on missing/unauthorized | `400`, `401`, `404`, `409`, `503` |

*(Desktop Electron allowlist: `apps/desktop/src/main/apiRequestPolicy.ts` explicitly permits `GET .../knowledge/graph` in BOTH the route union AND the global query-string allowlist at line 333, and explicitly permits `idempotencyKey` on these two new relationship `POST` routes.)*

### 5.2 Two-Tier Filtering & Query Parameters (`GET .../knowledge/graph`)

To keep **dim non-matching siblings** genuinely working on normal-sized orgs (`<= 500` docs) while remaining bounded on large orgs (`> 500` docs):
- **When `truncation.truncated === false` (default <= 500 docs):** Client fetches the full authorized mode slice (`view`, `monitor`, `includeExpired`, `includeLinks`, `relationshipTypes`) and evaluates interactive visual facets (`q`, `ownerDepartmentId`, `typeCode`, `collectionId`, `readerScope`, `validity`, `onlyOpenCases`, `onlyUnassignedOrg`) **client-side**, dimming non-matching siblings (`opacity: 0.28`) and collapsing empty branches (with a 1-click **"Isolate matching"** toggle).
- **When `truncation.truncated === true` (> 500 docs):** Interactive facet changes automatically re-query the server with those same filter params (switching cleanly to Isolate Mode with a subtle `"Showing first 500 matching documents"` banner) so large orgs can reach any document.
- Core includes an authorized `focusDocumentId` even when it is beyond `limit`. Canvas and Outline reveal the focus target and its ancestors while retaining active facets. Match counts continue to describe the facets.
- The document and edge limits bound the returned payload. The reader query materializes the protected current pointers and corresponding versions before joining metadata and checks expiry once per version. Core applies facets and the document limit to the authorized projection.

```ts
export type GraphViewMode = "accountability" | "collections";
export type GraphTypeCode =
  | "POLICY_AND_STANDARD"
  | "PROCEDURE"
  | "GUIDE"
  | "REFERENCE"
  | "LESSONS_LEARNED"
  | "UNCATEGORIZED"; // ASCII query codes prevent '&' URL encoding breakage on "Policy & Standard"

export type GraphReaderScope = "ORGANIZATION" | "DEPARTMENT" | "SELECTED_MEMBERS" | "LEGACY_AUDIENCE";
export type GraphValidityFilter = "CURRENT" | "EXPIRING_SOON" | "EXPIRED";
export type DocumentRelationshipType = "REFERENCES" | "RELATED" | "SUPERSEDES";
export type GraphOpenTarget = "READER" | "RESPONSIBLE_VIEW" | "ADMIN_INSPECTION" | "MY_CONTRIBUTIONS";

export interface KnowledgeGraphQuery {
  view?: GraphViewMode;                        // default: "accountability"
  q?: string;                                  // max 120 chars (server narrowing when truncated)
  ownerDepartmentId?: string;                  // uuid (explicitly Owner Department, never reader dept)
  typeCode?: GraphTypeCode;                    // ASCII enum key
  collectionId?: string;                       // uuid or "UNASSIGNED"
  readerScope?: GraphReaderScope;
  validity?: GraphValidityFilter;              // "EXPIRED" effective only when monitor=true & eligible
  includeLinks?: boolean;                      // default: false
  relationshipTypes?: string;                  // comma-separated allowlist string, e.g. "REFERENCES,SUPERSEDES"
  monitor?: boolean;                           // default: false; server verifies accountable role
  onlyOpenCases?: boolean;                     // requires monitor=true
  onlyUnassignedOrg?: boolean;                 // requires monitor=true
  includeExpired?: boolean;                    // requires monitor=true
  focusDocumentId?: string;                    // uuid; guaranteed inclusion if authorized
  limit?: number;                              // integer 1..500, default 500
}
```

### 5.3 Response Contract (`KnowledgeGraphPayload`)

```ts
export type DocumentId = string & { readonly __brand: "DocumentId" };
export type PublishedVersionId = string & { readonly __brand: "PublishedVersionId" };

export interface KnowledgeGraphPayload {
  schemaVersion: 1;
  organization: { id: string; name: string };
  capabilities: {
    canUseMonitorMode: boolean;                // derived across current + expired owned/reviewed/admin docs
    canIncludeExpired: boolean;                // same accountable gate (ADR 0032)
    canManageRelationships: boolean;           // active Org Admin or Author of >= 1 published doc
  };
  appliedMode: {
    view: GraphViewMode;
    monitorActive: boolean;
    includeExpiredActive: boolean;
    includeLinksActive: boolean;
  };
  truncation: {
    limit: number;                             // actual applied limit (1..500)
    returnedCount: number;                     // strictly count of returned authorized documents
    truncated: boolean;                        // true iff > limit authorized docs matched (never reveals total org size)
    relationshipsLimit: 1000;
    relationshipsTruncated: boolean;           // protects Electron 1 MiB response budget
  };
  departments: Array<{ id: string; name: string }>; // ONLY departments with >= 1 returned authorized doc
  collections: Array<{
    id: string;
    name: string;
    allowedTypes: KnowledgeType[] | null;      // nullable per ADR 0026:43 (legacy unconfigured)
  }>;                                          // ONLY active Org Collections with >= 1 returned authorized doc (prevents ADR 0032 expired leak!)
  documents: GraphDocumentNode[];              // deterministic sort: publishedAt DESC, documentId ASC
  relationships: GraphRelationshipEdge[];      // populated only when includeLinks=true; dual-endpoint readable; max 1,000
}

export interface GraphDocumentNode {
  documentId: DocumentId;
  publishedVersionId: PublishedVersionId;
  title: string;
  type: KnowledgeType | null;                  // nullable for legacy publications (ADR 0026:80); rendered under "Uncategorized (legacy)"
  version: string;                             // business version label, or "Version unavailable"
  ownerDepartmentId: string;
  ownerDepartmentName: string;
  authorDisplayName: string | null;            // active member display name via list_publication_author_names(), else null ("—")
  publishedAt: string;                         // ISO-8601 UTC
  validUntil: string | null;                   // effective YYYY-MM-DD UTC inclusive via publication_expiration_date()
  validityStatus: "Current" | "Expiring soon" | "Expired";
  daysUntilExpiry: number | null;              // non-negative integer; 0 when Expired (matching knowledge-metadata.ts:41)
  readerScope: GraphReaderScope;               // NEVER includes selected member identities
  collectionId: string | null;                 // non-null ONLY when readerScope === "ORGANIZATION" (ADR 0026)
  openTarget: GraphOpenTarget;                 // READER | RESPONSIBLE_VIEW | ADMIN_INSPECTION | MY_CONTRIBUTIONS
  canEditRelationships: boolean;               // active Author or Org Admin AND currently readable
  canRenew: boolean;                           // true when ADR 0032 B3 renewal eligibility holds (Author, 7d/expired Reviewer, or Admin)
  monitorSignals: {                            // present ONLY when monitorActive === true
    openMaintenanceCaseCount: number | null;   // integer >= 0 ONLY for Org Admin or 0060 disjoint reviewer; null for others/Authors
    isUnassignedOrgDoc: boolean;               // readerScope === "ORGANIZATION" && collectionId === null
    requiresAuditedInspection: boolean;        // true when openTarget === "ADMIN_INSPECTION" (ADR 0023)
  } | null;
}

export interface GraphRelationshipEdge {
  relationshipId: string;
  sourceDocumentId: DocumentId;
  targetDocumentId: DocumentId;
  relationshipType: DocumentRelationshipType;
  createdAt: string;
}
```

---

## 6. UI, Interaction, Motion & Accessibility Contract (`$apple-design` + `$ask-emil` + `DESIGN.md`)

### 6.1 Navigation, Routing & Layout
- **Sidebar entry (`G4`):** Add `Graph` (`/graph`) under `WORK` in `AppSidebar.tsx`, keeping `Home` as default landing (`ADR 0022`). Add `"View in Graph"` action in Home row menu and Reader info panel.
- **Cross-platform routing (`Web` + `Electron file://`):**
  - On Web (`routing === true`), extend `workspaceRoute.ts` and `ArdenShell.tsx` (`parseWorkspacePath`, `rememberReturnPath`, `handleHistoryNavigation`) to preserve `/graph` URL query strings (`?view=...&typeCode=...&focusDocumentId=...`) across reload, Back/Forward, and sign-in return.
  - On Electron (`routing === false`), persist the identical `GraphFilterState` in memory inside `ArdenShell` and accept navigation/focus intents via `GraphIntentBus` (defined in `SPEC-graph-agent-bridge.md`) so every deep-link and `graph_action` works identically on Desktop.
- **Visual tokens (`DESIGN.md`):** Strict Arden Island graphite surfaces, single violet accent reserved for active selection, Context Basket highlight, focus rings, and AI entry points; status chips (amber `Expiring ≤ 30d`, rose `Expired` / `N open cases`) always pair icon + text label. Zero gradients or glowing edges.
- **Node Card Anatomy:** Fixed-width Island card (`248px` doc node, `208px` branch node) with single-line truncated title (full title in instant tooltip + Inspector), Type badge (`Uncategorized` if `null`), Version, Scope icon, and optional Monitor badges (omitting maintenance badge completely when `openMaintenanceCaseCount === null`).

### 6.2 Motion Specification (Binding Rules)

| Interaction | Frequency | Motion Behavior | Curve / Duration | Reduced Motion Fallback |
| --- | --- | --- | --- | --- |
| Keyboard node navigation (`↑↓←→`/`Tab`), `Cmd/Ctrl+K` jump, filter chip toggle, Outline row selection, Context Basket pin badge update | 100+/day | **Zero animation (`0ms`)** | `0ms` | `0ms` |
| Button press feedback (`:active`) | Frequent | Tactile press scale on pointer-down | `transform: scale(0.97)`, `120ms cubic-bezier(0.23, 1, 0.32, 1)` | Opacity/color shift only |
| Floating node action toolbar & Filter popovers | Occasional | **Origin-aware** (`transform-origin` anchored to trigger), enter from `scale(0.95) + opacity: 0` | Enter `160ms cubic-bezier(0.23, 1, 0.32, 1)`; Exit `125ms` | `150ms` opacity cross-fade |
| Node tooltips | Occasional | Initial `300ms` delay, then `data-instant` (`0ms`) across adjacent tooltips | `125ms` first, `0ms` subsequent | `0ms` |
| React Flow camera glide (`fitView`, `focus_nodes`) | Occasional | Smooth interpolation, **immediately interruptible** on pointer-down/wheel/pinch/arrow key | `280ms` ease-out | Instant jump (`0ms`) |
| Hover highlight | Frequent | Gated behind `@media (hover: hover) and (pointer: fine)` | `140ms ease` border/bg | Same |

- Translucent floating chrome (`backdrop-filter: blur(16px)`) MUST include `@media (prefers-reduced-transparency: reduce)` solid surface fallback and `@media (prefers-contrast: more)` high-contrast borders.

### 6.3 Outline (Treegrid) View & Responsive Parity (`F12-AC1` / `F12-AC2`)
- **Canvas ↔ Outline switcher** shares identical filter state, selection, Context Basket pins, and Monitor Mode.
- **ARIA contract:** `role="treegrid"` with roving `tabindex`, `ArrowUp`/`ArrowDown` movement, `ArrowRight`/`ArrowLeft` expand/collapse, `Enter` to open via `openTarget`, `P` to pin/unpin in Context Basket, `Escape` to restore focus.
- **Responsive breakpoint:** Below `768px`, `/graph` defaults to **Outline View**.
- **Truncated / Empty / Loading / Error states:** Deterministic Island skeletons while loading; plain-language empty state + `"Clear filters"` (never synthetic fallback nodes); amber truncation banner when `truncation.truncated === true` (and clear `"Partial branch counts while filtered"` indicator when truncated) or `relationshipsTruncated === true`; inline retry on failure preserving filters.

---

## 7. Project Structure & Testing Strategy

```text
apps/api/
  migrations/0076_graph_document_relationships.sql       # Operator-class, SET search_path, replaces 0027 policies
  migrations/0077_graph_monitor_projection.sql           # Operator-class, reviewed SECURITY DEFINER list_graph_monitor_documents
  migrations/release-policy.json                         # Register 0075–0077 SHA-256 checksums (77 total)
  src/graph/
    graph-service.ts                                     # GraphProjectionService + PgGraphStore (materialized RLS reads)
    relationship-service.ts                              # DocumentRelationshipService + idempotency + ADR 0035 audit
    graph-routes.ts                                      # Fastify routes + Ajv schemas
    graph-service.test.ts / relationship-service.test.ts # Unit tests (fake repo)
    graph.integration.test.ts                            # Real PostgreSQL 17 FORCE RLS + ownership handoff (incl. 505-doc scale)
  src/target-readers/target-readers.integration.test.ts  # Updated 0027 draft-link test fixture to published docs
deploy/release/
  security-definer-owner-repair.sql                      # Register list_graph_monitor_documents in exact inventory
apps/desktop/src/main/
  apiRequestPolicy.ts / apiRequestPolicy.test.ts         # GET /knowledge/graph (+ query allowlist line 333) & relationship POSTs
packages/domain/src/
  knowledge-graph.ts                                     # Branded types, ASCII GraphTypeCode map, payload contracts
packages/ui/src/
  app/{workspaceRoute.ts,ArdenShell.tsx}                 # Preserve /graph query params on Web; GraphIntentBus on Electron
  graph/{GraphPage,GraphCanvas,GraphOutlineView,GraphFilterBar,GraphRelationshipDialog}.tsx
  graph/{layout.ts,layout.test.ts,GraphPage.test.tsx}
```

---

## 8. Acceptance & Evidence Matrix

| ID | Observable requirement (including denial, failure, legacy data, scale, and platform cases) | Implementation reference | Evidence actually obtained | Remaining / owner |
| --- | --- | --- | --- | --- |
| `F12-KG-AC1` | Accountability View renders `Org → Owner Dept → Controlled Type (5 + Uncategorized legacy) → Current Published Docs`; Collections View renders only non-empty Org Collections + Unassigned (never leaking empty expired-only collections per `ADR 0032` A2) while keeping `Shared (Department / Selected Members / Legacy Audience)` separate (`ADR 0026`). Private Notes & direct shares (`ADR 0034`) never appear. | [Projection](../../../apps/api/src/graph/graph-service.ts) and [Graph](../../../packages/ui/src/graph/GraphPage.tsx) | **PASS (local integrated `b4c6ef0`):** Post-ownership PostgreSQL 17 suite (`778` passed, `1` live-Supabase skip) verified reader, cross-tenant, expired-only collection, Private Note, and direct-share denial; `@arden/ui` (`689` passed) verified Accountability/Collections views; signed-in Chromium & native Windows Electron 44 verified empty Graph, ordinary reader, Admin, and non-Admin Responsible Reviewer views. | Authorized PR/merge and live staging walkthrough. |
| `F12-KG-AC2` | Real PostgreSQL `FORCE RLS` (post-ownership handoff) proves `0027` permissive policies are dropped: `document_relationship` `SELECT` returns rows ONLY when both endpoints are currently readable & unexpired; `INSERT` rejects unreadable targets with uniform `404 RESOURCE_NOT_AVAILABLE` and binds `created_by_membership_id` to actor; `DELETE` allows source Authors (own current/expired source) and source-reading Org Admins to clean up ghost edges whose target expired/restricted while rejecting non-reader Org Admins on restricted sources with uniform `404`; concurrent `SUPERSEDES` cycles and duplicate reverse `RELATED` edges return `409`. | [0076](../../../apps/api/migrations/0076_graph_document_relationships.sql) and [relationship service](../../../apps/api/src/graph/relationship-service.ts) | **PASS (local integrated `b4c6ef0`):** Post-ownership PostgreSQL 17 suite (`graph.integration.test.ts`, `target-readers.integration.test.ts`, `relationship-service.test.ts`) verified `0027` policy removal, dual-endpoint reads, uniform `404` target protection, creator binding, ghost-edge cleanup, non-reader Org Admin `DELETE` denial (`404`), and concurrent cycle/dedupe `409`s; migration inventory (`77` entries, fingerprint `8e43889008a8a2444c9a4241e21e4fd2df43b019a1069299b900dfb22747e391`) passed. | Authorized staging backup, rehearsal, and apply of `0076`. |
| `F12-KG-AC3` | Relationship mutations use atomic idempotency and ID-only audit rows. A create replay requires current source authority and both endpoints to remain readable. A remove replay returns the original acknowledgement. | [Relationship service](../../../apps/api/src/graph/relationship-service.ts) | **PASS (local integrated `b4c6ef0`):** Post-ownership PostgreSQL 17 + unit tests verified create/remove idempotency replays, `409 IDEMPOTENCY_CONFLICT`, ID-only `ADR 0035` audit rows, and create-replay reauthorization after access/authority loss; UI dialog preserves `Idempotency-Key` across transient retry and cancels cleanly on unmount. | Authorized staging backup, rehearsal, and apply of `0076`. |
| `F12-KG-AC4` | Non-accountable readers sending `monitor=true` / `includeExpired=true` receive `monitorActive: false` and zero expired docs. Accountable roles (including an Author whose only published doc just expired) receive `list_graph_monitor_documents` rows with accurate renewed `publication_expiration_date()`, role-scoped `openMaintenanceCaseCount` (`null` for ordinary readers & Authors, integer for Org Admin & `0060` disjoint reviewers, with `open_case_counts` guarded from scanning `maintenance_case` for non-accountable actors), uncapped `canRenew` eligibility beyond 1,000 docs, and valid `openTarget` routing (`READER`, `RESPONSIBLE_VIEW`, `ADMIN_INSPECTION`, `MY_CONTRIBUTIONS`). | [0077](../../../apps/api/migrations/0077_graph_monitor_projection.sql) and [Graph](../../../packages/ui/src/graph/GraphPage.tsx) | **PASS (local integrated `b4c6ef0`):** Post-ownership PostgreSQL 17 (`graph.integration.test.ts` + `ui-surface.integration.test.ts` 1,005-doc uncapped `canRenew` check) + `test_schema_recovery.py` (`62` trusted `arden` routines + `3` isolated `arden_system` routines) verified Monitor denial, renewed dates, uncapped `canRenew`, and nullable case counts; signed-in Chromium + native Windows Electron 44 verified ordinary reader denial and non-Admin Responsible Reviewer Monitor Mode, expired Responsible View, and human-confirmed handoffs. | Authorized staging rehearsal/apply of `0077` preserving `62` trusted routine owners + live staging walkthrough. |
| `F12-KG-AC5` | Server enforces `500` doc + `1,000` edge caps (`truncated` / `relationshipsTruncated`) inside a single-transaction snapshot, guarantees `focusDocumentId` inclusion above cap, dims siblings client-side when non-truncated and filters server-side when truncated, encodes ASCII `typeCode` safely (`POLICY_AND_STANDARD`), and preserves Web URL query params + Electron in-memory state across reload/navigation. | [Projection](../../../apps/api/src/graph/graph-service.ts) and [graph query state](../../../packages/ui/src/graph/query-state.ts) | **PASS (local integrated `b4c6ef0`):** With single-transaction `loadGraphBundle` and materialized RLS reads in `PgGraphStore`, `graph.integration.test.ts` passed all 5 real-PG tests in `21.2s` (the `505`-document cap, focus-beyond-500, and scoped AI case finished in `16.95s`); UI tests verified focus path visibility, once-per-`focusNonce` camera glide without snap-back, explicit deselect clearing `focusDocumentId`, auto-collapsed branch expand override, filtered branch pin scoping, `Cmd/Ctrl+K` jump, and `isolate_branch` facet clearing. | Live staging timing check on larger orgs after deployment. |
| `F12-KG-AC6` | Outline Treegrid provides keyboard parity below 768px and makes Canvas's visible cross-links available to readers. Craft verification covers the 500-document and 1,000-edge caps, long and untyped rows, motion and reduced motion. Desktop loads ELK lazily under its CSP and within the 250-node and 500-edge threshold. | [Outline](../../../packages/ui/src/graph/GraphOutlineView.tsx), [layout](../../../packages/ui/src/graph/layout.ts) and [IPC](../../../apps/desktop/src/main/apiRequestPolicy.ts) | **PASS (local integrated `b4c6ef0`):** UI suite (`689` passed) verified Treegrid keyboard/Escape focus restoration, layout thresholds, and reader cross-link disclosure; signed-in Chromium verified `390px` Outline default, `320px` reflow, `1` & `500` docs + `1,000` edges with zero ELK download above threshold, `300ms`/`125ms`/`0ms`-warmup/Escape/WCAG-1.4.13 tooltips, `160ms`/`125ms` toolbar + mobile animation, and reduced-motion fallbacks; native Windows Electron 44 verified lazy ELK under CSP. Lazy chunk sizes: Web `GraphPage` `303.27 kB` (`101.89 kB` gz), `elk.bundled` `1,476.85 kB` (`450.29 kB` gz); Desktop `GraphPage` `549.89 kB`, `elk.bundled` `3,354.76 kB`. | Packaged installer smoke check and live staging walkthrough. |

---

## 9. Out of Scope (Deferred to V2) & Open Questions

- **Deferred:** Saved custom user node coordinates, Private Notes graph, external Jira/GitHub nodes (`F16`), automated AI-inferred relationship edges, and an organization-wide `audit_event` UI viewer (`ADR 0035`).
- **Resolved confirmation (2026-11-26):** `GraphRelationshipDialog` is placed strictly on published documents (Document Detail / Reader Info Panel and Graph node floating toolbar), not inside the unpublished draft form.
- **Open Questions:** None.
