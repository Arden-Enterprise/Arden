# Spec: `typed-chat-ui-blocks` (`F13` / `F14`) — V1

- Spec revision/date: `v1-accepted` (reconciled and approved) / 2026-11-26
- Decision state: **accepted** ([ADR 0036](../../decisions/0036-knowledge-graph-and-modular-typed-ui-blocks.md); local implementation and verification in progress)
- Originator: requesting project maintainer
- Decision owner: requesting project maintainer
- Record author: coding agent
- Approval: maintainer approved architecture, reconciled `v1` spec, and `120_000 ms` Desktop AI timeout on 2026-11-26
- Intended audience: public-safe repository specification
- Source/code baseline and affected repositories: originally specified against `Arden` `origin/staging` `fa4d6fe` and `Arden-AI` `origin/main` `af90033`; integrated on 2026-11-27 onto `Arden` `staging` `b4c6ef0` (`apps/api/migrations/0075_ai_turn_ui_surface.sql`, `apps/api/src/answers/*`, `packages/ui/src/ask-arden/*`) and `Arden-AI` `main` `5060291` (`schemas/answer-v3.schema.json`, `src/arden_ai/infrastructure/answering.py`)
- Related Linear issues: `ARD-52`, `ARD-59`
- Parent Capability Map: [CAPABILITY-MAP.md](CAPABILITY-MAP.md) (`typed-chat-ui-blocks`)
- Extends: [ADR 0021](../../decisions/0021-governed-hybrid-answering.md), [ADR 0030](../../decisions/0030-published-date-ai-sources.md), [governed-hybrid-answering.md](../../engineering/governed-hybrid-answering.md)

---

## 1. Objective

Enable Company Ask Arden (`AgentPanel` and `AskArdenPage`) to return **modular, composable Typed UI Blocks (`UiSurface` v1)** inspired by Google A2UI's flat adjacency architecture—letting structured answers nest layout containers, Core-hydrated governance/document blocks, cited comparison tables, and allowlisted non-mutating actions—while guaranteeing:
- **Zero breakage to `/v2/generations`** (Reader Q&A, Private Note Q&A, and un-upgraded Core callers stay untouched via an additive **`Arden-AI /v3/generations`** endpoint);
- **OpenAI `strict=True` structured-output compatibility** via opaque `sourceCatalog` handles (`D1..D8`) and flat array node encoding;
- **Core as the sole authorization, grounding, DB hydration, and 4-path turn-level fail-closed revocation firewall** (`load`, `replay`, `context`, `append`), with batched conversation-level hydration keeping Electron 44 safely within response size budgets.

---

## 2. Deep-Module Architecture & Seams (`codebase-design`)

| Module | Seam | Narrow Interface | Hidden Implementation Depth |
| --- | --- | --- | --- |
| `UiSurfaceValidator` (`packages/domain/src/ui-surface.ts`) | Shared boundary validator (Core + UI + tests; owns all `UiSurface` & `SurfaceAction` types) | `normalizeAndValidateSurface(rawArrayNodes, rootId, handleMap, citationCount): Result<BoundUiSurface, SurfaceValidationError>` & `validateStoredBoundSurface(stored): Result<BoundUiSurface, SurfaceValidationError>` | Translates opaque LLM handles (`D1..D8`, `DEPT1..`, `C1..`) to verified UUIDs, verifies strict acyclic tree (`0`-based `maxDepth <= 4`, `maxNodes <= 32`, compact `byteLength <= 48_000`), enforces **ancestor-invariant** container nesting bans, rejects prototype-pollution keys (`__proto__`, `constructor`, etc.), requires exact `bindings` mirror of every referenced `publishedVersionId`/`documentId`, enforces row-level citations on `comparison_table`, and restricts LLM `callout` tones to `"info" \| "conflict"`. |
| `UiSurfaceHydrator` (`apps/api/src/answers/ui-surface-hydrator.ts`) | Core answering orchestrator ↔ PostgreSQL read layer | `hydrateConversationSurfaces(user, orgId, turns): Promise<ConversationHydrationBundle>` & `synthesizeFallbackSurface(answer, citations, evidenceDocs): BoundUiSurface` | Batch-hydrates all bound `publishedVersionId`s across an entire conversation in 1 SQL query + 1 `list_publication_author_names(uuid[])` call using `publication_expiration_date()`, role-scoped nullable `openMaintenanceCaseCount` (`0060`/Admin only), `openTarget`, capability flags (`canReportIssue`, `canOpenMaintenance`, `canRenew`), Core-computed `metric_strip` over exact current-turn `bindings.publishedVersionIds`, and live dual-endpoint `lineage_tree` (gracefully empty if `0076` is absent). |
| `UiSurfaceRenderer` (`packages/ui/src/ask-arden/surface/`) | React chat surface ↔ Host action & citation dispatcher | `<UiSurfaceRenderer surface={boundSurface} hydratedDocs={hydratedDocuments} turnHydration={turnHydration} citations={citations} onAction={dispatchAction} onOpenCitation={showSources} />` | Pure recursive renderer over `Object.hasOwn(nodes, id)` using CSS `@container (max-width: 439px)` (zero `ResizeObserver` thrashing), existing zero-dependency `layoutCitedAnswer` (`CitedAnswer.tsx`) for `prose` (zero `innerHTML`, zero external Markdown dependency), WCAG 2.2 AA `tabs`/`section`/`table`, and Apple/Emil micro-interactions. |

---

## 3. Formal `UiSurface` v1 Wire Contract & Self-Contained Type Definitions (`api-and-interface-design`)

### 3.1 Clean Separation: AI Wire Shape vs Stored `BoundUiSurface` vs Conversation Hydration

1. **`AiSurfaceDraft` (emitted by `Arden-AI /v3/generations` under OpenAI `strict=True`):**
   - Uses an **array** `nodes: AiSurfaceNode[]` (NOT `Record<NodeId, ...>` and NOT `oneOf`!) with `additionalProperties: false` and all properties listed in `required` (optional values as `anyOf: [T, null]`), keeping JSON Schema nesting `<= 3` levels and compact property count well within OpenAI's strict-schema ceiling.
   - References documents, departments, and collections **only by Core-supplied opaque handles** (`docRef: "D1".."D8"`, `deptRef: "DEPT1"..`, `collectionRef: "C1"..`) and 1-based `citationIndexes` (`1..citations.length`). **Zero raw PostgreSQL UUIDs are ever passed to or accepted from the LLM.**
2. **`BoundUiSurface` (normalized by Core & persisted in `ai_conversation_turn.ui_surface`):**
   - Flat adjacency map `{ schemaVersion: 1, rootId, nodes, bindings }` containing ONLY verified UUIDs resolved from the turn's evidence `sourceCatalog` handles, grounded text, and allowlisted action descriptors. **Contains zero duplicated governance metadata, zero raw chunk text, and zero LLM-authored metric counts.**
   - Compact serialized byte length `<= 48_000` bytes (guaranteeing headroom beneath PostgreSQL's `<= 65_536` `octet_length(ui_surface::text)` pretty-printed check).
3. **Conversation-Level Batched Hydration (`ConversationView` & `AnswerResponse`):**
   - To prevent 50-turn conversations from exceeding Electron's `1 MiB` response budget and to eliminate N+1 queries, document metadata is deduplicated **once per response** in `hydratedDocuments: Record<PublishedVersionId, HydratedDocumentSummary>`, while per-turn `turnHydration` holds only compact `{ metrics: Record<NodeId, MetricTile[]>, lineages: Record<NodeId, LineagePreview> }`.

```ts
export type NodeId = string; // /^[a-zA-Z0-9_-]{1,32}$/ AND NOT in PROTOTYPE_DENYLIST

export const PROTOTYPE_DENYLIST = new Set([
  "__proto__", "constructor", "prototype", "toString", "valueOf",
  "hasOwnProperty", "isPrototypeOf", "propertyIsEnumerable",
  "toLocaleString", "__defineGetter__", "__defineSetter__",
  "__lookupGetter__", "__lookupSetter__",
]);

export type GovernanceFieldKey =
  | "ownerDepartment"
  | "authorDisplayName"
  | "type"
  | "version"
  | "publishedAt"
  | "validUntil"
  | "validityStatus"
  | "readerScope"
  | "collectionName"
  | "openMaintenanceCaseCount";

export type MetricKey =
  | "MATCHED_DOCS"
  | "EXPIRING_SOON_DOCS"
  | "OPEN_MAINTENANCE_CASES"
  | "DISTINCT_OWNER_DEPTS";

export interface HydratedDocumentSummary {
  documentId: string;
  publishedVersionId: string;
  title: string;
  type: KnowledgeType | null;
  version: string;
  ownerDepartmentId: string;
  ownerDepartmentName: string;
  authorDisplayName: string | null;            // via list_publication_author_names(); null -> "—"
  publishedAt: string;
  validUntil: string | null;                   // via publication_expiration_date()
  validityStatus: "Current" | "Expiring soon" | "Expired";
  daysUntilExpiry: number | null;
  readerScope: "ORGANIZATION" | "DEPARTMENT" | "SELECTED_MEMBERS" | "LEGACY_AUDIENCE";
  collectionName: string | null;
  openMaintenanceCaseCount: number | null;     // integer ONLY for Org Admin or 0060 disjoint reviewer; null otherwise (ADR 0023 §5)
  openTarget: "READER" | "RESPONSIBLE_VIEW" | "ADMIN_INSPECTION" | "MY_CONTRIBUTIONS";
  canReportIssue: boolean;
  canOpenMaintenance: boolean;
  canRenew: boolean;
}

export interface MetricTile {
  key: MetricKey;
  label: string;
  value: number;                               // strictly Core-computed over turn's bindings.publishedVersionIds
  tone: "neutral" | "warning" | "attention";
}

export interface LineagePreview {
  rootDocumentId: string;
  edges: Array<{
    relationshipId: string;
    direction: "OUTGOING" | "INCOMING";
    relationshipType: "REFERENCES" | "RELATED" | "SUPERSEDES";
    peerDocumentId: string;
    peerPublishedVersionId: string;
    peerTitle: string;
    peerType: KnowledgeType | null;
  }>;                                          // max 8 live dual-endpoint-authorized edges; [] if none or 0076 absent
}

export type GraphActionPayload =
  | { op: "focus_nodes"; documentIds: string[] }                                // 1..8 bound evidence documentIds
  | { op: "apply_filter"; ownerDepartmentId?: string; typeCode?: GraphTypeCode; collectionId?: string; readerScope?: GraphReaderScope; validity?: "CURRENT" | "EXPIRING_SOON" }
  | { op: "isolate_branch"; branchKind: "department" | "collection" | "type"; branchId: string }
  | { op: "toggle_links"; enabled: boolean; relationshipTypes?: Array<"REFERENCES" | "RELATED" | "SUPERSEDES"> }
  | { op: "pin_to_context"; documentIds: string[] };                            // 1..8 bound evidence documentIds

export type SurfaceAction =
  | { kind: "graph_action"; label: string; action: GraphActionPayload }
  | { kind: "open_reader"; label: string; documentId: string; publishedVersionId: string; blockId?: string; page?: number }
  | { kind: "workflow_handoff"; label: string; handoff: "report_issue" | "open_maintenance_case" | "open_renewal"; documentId: string; publishedVersionId: string }
  | { kind: "prompt_chip"; label: string; prompt: string };                     // prefill + focus composer ONLY (never auto-submit)

export interface BoundUiSurface {
  schemaVersion: 1;
  rootId: NodeId;                              // root node kind MUST be "stack" or "card"
  nodes: Record<NodeId, BoundUiNode>;          // 1..32 entries; strict tree; 0-based maxDepth <= 4; <= 48_000 compact bytes
  bindings: {
    documents: Array<{ documentId: string; publishedVersionId: string }>;       // exact deduplicated set of all referenced docs (1..8, subset of turn evidence)
    citationIndexes: number[];                 // deduplicated 1-based indexes into turn.citations (0..12)
  };
}
```

### 3.2 Complete V1 Primitive Catalog (6 Containers + 7 Leaves + 4 Actions)

#### Containers (6 — nestable via `childIds` / slots)
1. **`stack`:** `{ kind: "stack"; gap?: "sm" | "md"; childIds: NodeId[] }` (`1..12` children)
2. **`row`:** `{ kind: "row"; columns?: 2 | 3; childIds: NodeId[] }` (`1..6` children; 2/3 columns via CSS `@container`, collapsing cleanly at `< 440px`)
3. **`card`:** `{ kind: "card"; title?: string (<=120); subtitle?: string (<=160); tone?: "default" | "subtle"; bodyIds: NodeId[] (1..8); footerIds?: NodeId[] (0..4) }`
4. **`section`:** `{ kind: "section"; title: string (<=120); defaultOpen?: boolean; childIds: NodeId[] (1..8) }`
5. **`tabs`:** `{ kind: "tabs"; defaultTabId: string; tabs: Array<{ id: string (<=32, unique); label: string (<=40); childIds: NodeId[] (1..6) }> }` (`2..4` tabs; `defaultTabId` MUST match one `tabs[].id`; entering a tab panel counts as +1 tree depth)
6. **`split`:** `{ kind: "split"; leftTitle?: string (<=80); leftId: NodeId; rightTitle?: string (<=80); rightId: NodeId }` (collapses vertically via CSS `@container (max-width: 439px)`)

#### Leaves / Domain Data Blocks (7 — terminal nodes, zero children)
1. **`prose`:** `{ kind: "prose"; markdown: string (1..12_000); citationIndexes?: number[] }` — matches `ai_conversation_turn.answer` `12_000` max so fallback never truncates or fails! Rendered via Arden's existing zero-dependency `layoutCitedAnswer` (`CitedAnswer.tsx`); inline `[n]` markers MUST be in `1..citations.length`; raw HTML and Markdown links render as inert plain text.
2. **`document_item`:** `{ kind: "document_item"; documentId: string; publishedVersionId: string; highlightNote?: string (<=120) }` — `highlightNote` is visually quarantined as secondary AI note, distinct from Core-hydrated title/dept/type/version/expiry/scope badges.
3. **`governance_kv`:** `{ kind: "governance_kv"; documentId: string; publishedVersionId: string; fields?: GovernanceFieldKey[] (deduped) }` — Core-hydrated ISO/IEC 38505-1:2026 accountability grid; omits `openMaintenanceCaseCount` whenever `null`.
4. **`comparison_table`:** `{ kind: "comparison_table"; caption?: string (<=120); columns: string[] (2..5, each <=60); rows: Array<{ cells: Array<{ text: string (<=280); citationIndexes?: number[] (<=4) }> }> (1..12 rows) }` — strictly rectangular (`row.cells.length === columns.length`) AND **every row MUST cite at least one verified `citationIndex`** (prevents uncited fabricated tables!).
5. **`callout`:** `{ kind: "callout"; tone: "info" | "warning" | "gap" | "conflict"; title: string (<=120); body: string (<=800); citationIndexes?: number[] (<=6) }` — **LLM may emit ONLY `"info"` or `"conflict"` (with mandatory `citationIndexes.length >= 1`)**; `"warning"` and `"gap"` tones are reserved exclusively for **Core-synthesized** governance/abstention banners (closes H1 warning spoofing!).
6. **`metric_strip`:** `{ kind: "metric_strip"; metricKeys: MetricKey[] (1..4, deduped) }` — **Core-computed ONLY** over the turn's exact `bindings.documents` (guaranteed identical live vs reload!); `OPEN_MAINTENANCE_CASES` tile is omitted if the actor lacks `0060`/Admin maintenance visibility.
7. **`lineage_tree`:** `{ kind: "lineage_tree"; rootDocumentId: string; rootPublishedVersionId: string }` — live 1-hop dual-endpoint-authorized neighbor preview hydrated at render/load time (max 8 edges; neighbors are NOT persisted in `ui_surface` JSONB so neighbor revocation never over-revokes an unrelated turn!).

#### Allowlisted Actions (4 — terminal primitives; zero raw URLs, scripts, or write mutations)
- `graph_action` (`label <= 48`), `open_reader` (`label <= 48`, `page` integer `1..100_000`, `blockId <= 128`), `workflow_handoff` (`label <= 48`; Core hydrator strips any handoff whose capability flag `canReportIssue`/`canOpenMaintenance`/`canRenew` is `false` for the current actor!), `prompt_chip` (`label <= 60`, `prompt <= 400`; **prefills + focuses composer ONLY**, never auto-submits!).

### 3.3 Ancestor-Invariant Composition Grammar (Enforced Over Full Subtrees)

- **Depth convention:** **0-based edge depth** (`root` = `0`, direct child = `1`, `maxDepth <= 4`; `tabs` tab panel counts as +1 level so `stack(0) → tabs(1) → split(2) → card(3) → governance_kv(4)` is valid at depth `4`).
- **Root constraint:** `nodes[rootId].kind` MUST be `"stack"` or `"card"`.
- **Tree uniqueness:** Every node in `nodes` must be reachable from `rootId` by **exactly one** path (zero orphans, zero cycles, zero DAG diamond reuse).
- **Ancestor-invariant bans (apply to ALL descendants at any depth, closing H8):**
  - No `card` anywhere inside a `card` subtree.
  - No `section` anywhere inside a `section` subtree.
  - No `tabs` anywhere inside a `tabs`, `section`, `row`, or `split` subtree.
  - No `split` anywhere inside a `split` or `row` subtree.
  - No `row` or `comparison_table` anywhere inside a `row` subtree; no `comparison_table` anywhere inside a `split` subtree.
  - `card.footerIds` accepts **Action primitives ONLY** (`graph_action`, `open_reader`, `workflow_handoff`, `prompt_chip`).

---

## 4. Additive `Arden-AI /v3/generations` Contract & 4-Path Revocation Firewall

### 4.1 Additive `/v3/generations` (`Arden-AI/schemas/answer-v3.schema.json`) — Zero `/v2` Breakage

To respect `Arden-AI`'s `extra="forbid"` models and Core's exact-key-set `parseGenerationResponse()` (`governed-contracts.ts:29–33`):
- **`/v2/retrievals` and `/v2/generations` stay 100% unchanged** (protecting Reader Q&A, Private Note Q&A, and any older Core release).
- **`Arden-AI` adds `/v3/generations` (`contractVersion: 3`, `purpose: "PUBLISHED_CHAT"` ONLY):**
  - **Request (`GenerationV3Request`):** Same fields as `GenerationRequest` PLUS `sourceCatalog: SourceCatalogEntry[]` (`1..8` entries mapping opaque handles `D1..D8`, `DEPT1..`, `C1..` to titles/types/departments/scopes—zero raw UUIDs!) and `uiSurfaceMode: "AUTO" | "DISABLED"`.
  - **Response (`GenerationV3Response`):** `{ contractVersion: 3, requestId, status, answer, citations, usedEvidence, uiSurface: AiSurfaceDraft | null, uiSurfaceStatus: "GENERATED" | "OMITTED_INSUFFICIENT" | "OMITTED_INVALID" | "DISABLED" }`.
  - **Mandatory `answer` completeness:** `answer` MUST remain the complete, standalone, citation-grounded plain-text response (so copy-answer and multi-turn `history` never lose table/card content).
  - **Non-failing surface generation inside `Arden-AI`:** If `status === "INSUFFICIENT_EVIDENCE"`, `Arden-AI` sets `uiSurface: null, uiSurfaceStatus: "OMITTED_INSUFFICIENT"`. If the LLM produces a structurally invalid surface, `Arden-AI` catches the surface validation error independently and returns the valid text `answer` + `citations` with `uiSurface: null, uiSurfaceStatus: "OMITTED_INVALID"` (never HTTP 502!).
  - **Non-failing fallback inside `Arden` Core:** `HttpAskArdenClient.generateV3()` validates core answer/citations strictly while passing raw `uiSurface: unknown` to `GovernedAnswering.answer()`. If `uiSurface` is `null`, invalid, or exceeds `48_000` bytes (or if Core falls back to `/v2/generations` when `ARDEN_AI_UI_SURFACE_V3` flag is off), Core logs a privacy-safe fallback reason counter and builds `synthesizeFallbackSurface(answer, citations, evidenceDocs)` (`stack([prose(answer), card(document_items + open_reader/graph_action footer)])` — or `stack([callout(tone: "gap")])` on `INSUFFICIENT_EVIDENCE`). Chat delivery NEVER fails due to UI surface validation.

### 4.2 Database migration (`0075_ai_turn_ui_surface.sql`)

```sql
SET search_path TO arden, public;

ALTER TABLE ai_conversation_turn
  ADD COLUMN ui_surface jsonb NULL,
  ADD COLUMN scope_filter_hash text NULL
    CONSTRAINT ck_ai_turn_scope_filter_hash CHECK (
      scope_filter_hash IS NULL OR scope_filter_hash ~ '^[a-f0-9]{64}$'
    ),
  ADD CONSTRAINT ck_ai_turn_ui_surface_shape CHECK (
    ui_surface IS NULL OR (
      jsonb_typeof(ui_surface) = 'object'
      AND ui_surface->'schemaVersion' = '1'::jsonb
      AND jsonb_typeof(ui_surface->'rootId') = 'string'
      AND jsonb_typeof(ui_surface->'nodes') = 'object'
      AND jsonb_typeof(ui_surface->'bindings') = 'object'
      AND jsonb_typeof(ui_surface->'bindings'->'documents') = 'array'
      AND jsonb_typeof(ui_surface->'bindings'->'citationIndexes') = 'array'
      AND octet_length(ui_surface::text) <= 65536
    )
  );

CREATE TABLE ai_turn_surface_binding (
  turn_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  document_id uuid NOT NULL,
  published_version_id uuid NOT NULL,
  PRIMARY KEY (turn_id, published_version_id),
  FOREIGN KEY (turn_id, organization_id)
    REFERENCES ai_conversation_turn(turn_id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY (document_id, organization_id)
    REFERENCES shared_draft(shared_draft_id, organization_id) ON DELETE RESTRICT,
  FOREIGN KEY (published_version_id)
    REFERENCES published_knowledge_version(published_version_id) ON DELETE RESTRICT
);

ALTER TABLE ai_turn_surface_binding ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_turn_surface_binding FORCE ROW LEVEL SECURITY;

CREATE POLICY ai_turn_surface_binding_owner_select
  ON ai_turn_surface_binding FOR SELECT TO arden_runtime
  USING (EXISTS (
    SELECT 1 FROM ai_conversation_turn t
    WHERE t.turn_id = ai_turn_surface_binding.turn_id
      AND t.organization_id = ai_turn_surface_binding.organization_id
  ));

CREATE POLICY ai_turn_surface_binding_owner_insert
  ON ai_turn_surface_binding FOR INSERT TO arden_runtime
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM ai_conversation_turn t
      WHERE t.turn_id = ai_turn_surface_binding.turn_id
        AND t.organization_id = ai_turn_surface_binding.organization_id
    )
    AND published_version_id IN (SELECT eligible_ai_publications())
  );

GRANT SELECT, INSERT ON ai_turn_surface_binding TO arden_runtime;
```

- Register `0075_ai_turn_ui_surface.sql` in `apps/api/migrations/release-policy.json`.
- Existing turns have `ui_surface = NULL` and `scope_filter_hash = NULL` and keep rendering via `<CitedAnswer />`.

### 4.3 4-Path Turn-Level Fail-Closed Revocation (`F14-AC2`) & Conversation Paging

Every document referenced in `BoundUiSurface` MUST be a subset of the turn's verified evidence and mirrored into `ai_turn_surface_binding`. Revocation is enforced uniformly across **all four Core paths**:
1. **`PgConversationStore.append()` (in-transaction):** Re-checks every `turn.evidence` row AND inserts `ai_turn_surface_binding` rows (DB RLS verifies `published_version_id IN (SELECT eligible_ai_publications())` atomically!).
2. **`GovernedAnswering.load()` (conversation reload):**
   - Both chat views request earlier turns with `beforeSequence` set to the oldest visible turn's sequence when `hasMore` is true. Core defaults to 20 turns, accepts up to 50, and retains the newest whole turns that fit within **2,097,152 UTF-8 bytes (2 MiB)**, including deduplicated summaries. Any omitted turns remain available through the next cursor.
   - Batch-checks every turn's `ai_turn_evidence` AND `ai_turn_surface_binding` via a dedicated `publishedVersionIds`-keyed availability check (`eligible_ai_publications()` + `canRead`, unaffected by the 500-doc full-org limit!).
   - If **any** evidence chunk or surface binding is revoked, expired, withdrawn, or superseded: return `status: "UNAVAILABLE"`, `answer: "This answer is no longer available."`, `citations: []`, `uiSurface: null`, `turnHydration: null`.
   - If a stored `ui_surface` row fails `validateStoredBoundSurface` (corrupted/schema mismatch), degrade safely to `uiSurface: null` (legacy `<CitedAnswer />`) rather than failing the whole conversation load.
   - Batch-hydrate live metadata once across all surviving turns (`1` SQL query + `1` `list_publication_author_names(uuid[])` call).
3. **`GovernedAnswering.answer()` replay path (`requestId` match):** Verifies `replay.question === input.query`, `replay.scopeFilterHash === currentScopeHash`, `replay.sequence === input.expectedRevision + 1`, AND revalidates BOTH `replay.evidence` and `replay.surfaceBindings`, then returns **hydrated** `HydratedUiSurface` (never raw unhydrated JSONB!).
4. **`GovernedAnswering.context()` (multi-turn history builder):** Revalidates BOTH `turn.evidence` and `turn.surfaceBindings`; any turn withheld on reload is also excluded from `history` sent to `Arden-AI`.

---

## 5. Visual Polish, Responsiveness & Accessibility (`$apple-design` + `$ask-emil` + `DESIGN.md`)

- **Island Aesthetic:** Neutral graphite surfaces, `1px solid var(--border-subtle)`, `font-variant-numeric: tabular-nums` in `metric_strip` and `comparison_table`, zero AI gradients or glows.
- **Pure CSS Container Queries (zero `ResizeObserver` thrashing):**
  - `AgentPanel` and `AskArdenPage` message wrappers set `container-type: inline-size`.
  - `split` switches from 2 columns to 1 vertical stack via `@container (max-width: 439px)`.
  - `row` honors `columns: 2 | 3` at `>= 560px`, drops to 2 columns at `440px–559px`, and stacks to 1 column at `< 440px`.
  - `comparison_table` wraps inside an accessible horizontal scroll frame with subtle scroll-edge fade masks when wider than the panel.
- **Motion Rules (Emil + Apple):**
  - `tabs` switching and `prompt_chip` prefill: **instant (`0ms`)**.
  - `section` disclosure chevron: `160ms cubic-bezier(0.23, 1, 0.32, 1)` transform rotation (`0ms` under `prefers-reduced-motion`).
  - Action buttons: `:active { transform: scale(0.97) }` (`120ms`); hover gated behind `@media (hover: hover) and (pointer: fine)`.
- **Accessibility (WCAG 2.2 AA):** `tabs` implements WAI-ARIA `tablist`/`tab`/`tabpanel` (`ArrowLeft`/`ArrowRight`/`Home`/`End`); `section` uses `<button aria-expanded aria-controls>`; `comparison_table` uses semantic `<table>`, `<caption>`, `<th scope="col">`; citation chips invoke `onOpenCitation(citation, opener)` preserving focus restoration.

---

## 6. Project Structure & Testing Strategy

```text
Arden/
  packages/domain/src/
    ui-surface.ts / ui-surface.test.ts                   # Complete types, handle-to-UUID validator, ancestor/prototype fuzz tests
  apps/api/
    migrations/0075_ai_turn_ui_surface.sql               # SET search_path, ui_surface, scope_filter_hash, ai_turn_surface_binding
    migrations/release-policy.json                       # Register 0075 SHA-256
    src/answers/
      ui-surface-hydrator.ts / ui-surface-hydrator.test.ts
      governed-contracts.ts / ai-client.ts               # /v3/generations client leaving /v2 untouched
      governed-answering.ts / governed-answering.test.ts # 4-path revocation, fallback, batched hydration
      conversation-store.ts / routes.ts                  # Cursor paging (?limit=&beforeSequence=), bindings persistence
      governed.integration.verification.ts               # Real PG revocation, reload freshness, 48KB/64KB checks
  packages/ui/src/ask-arden/surface/
    UiSurfaceRenderer.tsx                                # Recursive renderer + @container CSS + CitedAnswer reuse
    containers/{Stack,Row,Card,Section,Tabs,Split}Block.tsx
    leaves/{Prose,DocumentItem,GovernanceKv,ComparisonTable,Callout,MetricStrip,LineageTree}Block.tsx
    actions/ActionBar.tsx                                # Allowlisted non-mutating action buttons
    UiSurfaceRenderer.test.tsx                           # Ancestor nesting, @container collapse, a11y, XSS, citation focus tests
Arden-AI/
  schemas/answer-v3.schema.json                          # Additive /v3/generations contract (sourceCatalog + array nodes)
  src/arden_ai/contracts/governed_v3.py                  # Pydantic v2 models (OpenAI strict=True compliant)
  src/arden_ai/presentation/api.py                       # POST /v3/generations route (v2 untouched)
  src/arden_ai/infrastructure/answering.py               # OpenAI strict=True array-node emission + non-502 surface fallback
  tests/test_ui_surface_v3.py                            # Strict JSON Schema compilation + paired fixture parity tests
```

---

## 7. Acceptance & Evidence Matrix

| ID | Observable requirement (including adversarial, OpenAI strict-schema, revocation, fallback, and Electron budget cases) | Implementation reference | Evidence actually obtained | Remaining / owner |
| --- | --- | --- | --- | --- |
| `F13-UI-AC1` | `UiSurfaceValidator` accepts valid nested trees (`stack(0) → tabs(1) → split(2) → card(3) → governance_kv(4)`), translates opaque `D1..D8` handles to verified UUIDs, and rejects cycles, DAG diamond reuse, `depth > 4`, `nodes > 32`, `compactBytes > 48_000`, ancestor-bypassed `card→stack→card` / `tabs→stack→tabs` / `split→stack→split`, prototype keys (`__proto__`, `constructor`), uncited `comparison_table` rows, LLM `"warning"|"gap"` callouts, raw HTML, and arbitrary URLs. | [Validator](../../../packages/domain/src/ui-surface.ts) | **PASS (local integrated `b4c6ef0`):** `@arden/domain` (`53` passed across `6` files) verified structural, depth, node-cap, byte-cap, ancestor-ban, prototype-key, citation, and malformed-input cases. | Authorized PR/merge. |
| `F13-UI-AC2` | Arden-AI requests a strict flat-node schema for v3 and validates the answer and citations separately. An invalid surface degrades to `OMITTED_INVALID`. Insufficient evidence uses `uiSurface: null`. The Reader, Private and legacy Company v2 contract stays compatible. | Arden-AI versioned `/v3/generations` and exported schema (`5060291` integration branch) | **PASS (local integrated `5060291`):** `Arden-AI` passed `229` pytest tests, `ruff check .`, and `mypy --python-version 3.13 src` (`42` files) including strict-schema compilation, malformed surface stripping, and `/v2/generations` compatibility; a synthetic live OpenAI strict-schema request also succeeded returning 5 surface nodes and 2 citations. | Deploy additive `Arden-AI /v3/generations` to staging before switching Core. |
| `F13-UI-AC3` | Core deterministically hydrates `document_item`, `governance_kv`, `metric_strip` (computed strictly over current turn's `bindings.documents`), and live `lineage_tree` (gracefully empty if `0076` absent) using `publication_expiration_date()`, `list_publication_author_names()`, and uncapped targeted `canRenew` checks; maps real `ownerDepartmentId` (`DEPT1..DEPT8`) without colliding with legacy null-department rows (reserved unmapped `DEPT999`), hides `openMaintenanceCaseCount` (`null`) for ordinary readers/Authors, strips unauthorized `workflow_handoff` actions, validates `ARDEN_AI_UI_SURFACE_V3` strictly as a boolean at startup, and falls back to `synthesizeFallbackSurface` (supporting full `12_000`-char `answer`s!) whenever `uiSurface` is absent or invalid. | [Hydrator](../../../apps/api/src/answers/ui-surface-hydrator.ts), [renewal eligibility](../../../apps/api/src/knowledge/renewal-eligibility.ts), and [answer service](../../../apps/api/src/answers/governed-answering.ts) | **PASS (local integrated `b4c6ef0`):** Post-ownership PostgreSQL 17 suite (`778` passed, `1` live-Supabase skip) verified fallback synthesis, exact-version hydration, `DEPT1..DEPT8`/`DEPT999` handle mapping, uncapped `canRenew` on `1,005` seeded publications, lineage visibility, role-scoped maintenance counts, and strict boolean startup validation of `ARDEN_AI_UI_SURFACE_V3`. | Paired staging rollout (`Arden-AI` first, then `Arden`). |
| `F14-UI-AC1` | Migration `0075` stores validated surfaces and exact-version bindings under `FORCE RLS`. Legacy and corrupted surfaces use the cited-answer fallback. Both chat views can load earlier turns in order, and each hydrated page fits within 2 MiB. | [0075](../../../apps/api/migrations/0075_ai_turn_ui_surface.sql) · [Answer service](../../../apps/api/src/answers/governed-answering.ts) · [Shared chat](../../../packages/ui/src/ask-arden/useArdenChat.ts) | **PASS (local integrated `b4c6ef0`):** Post-ownership PostgreSQL 17 verified `0075` persistence and `FORCE RLS`; API tests checked 50-turn multibyte byte-budget paging; signed-in Chromium and native Windows Electron 44 both verified `23`-turn saved conversation cursor continuity (`Load earlier messages` over IPC and HTTP). | Authorized staging apply of `0075` + live staging check. |
| `F14-UI-AC2` | Losing any exact evidence or surface binding withholds the whole turn and excludes it from follow-up context. Load, replay and a new answer recheck access after hydration. Authorized turns return live renewal and case counts. | [Answer service](../../../apps/api/src/answers/governed-answering.ts) and [conversation store](../../../apps/api/src/answers/conversation-store.ts) | **PASS (local integrated `b4c6ef0`):** Post-ownership PostgreSQL 17 (`ui-surface.integration.test.ts`, `governed.integration.verification.ts`, `governed-answering.test.ts`) verified load, replay, context-history exclusion, append denial, and post-hydration delivery-time rechecks. | Live staging revocation smoke check after deployment. |
| `F13-UI-AC4` | `UiSurfaceRenderer` passes `/break-ui` at `320px`, `440px`, and `720px` `@container` widths (`split` collapse `< 440px`, wide `comparison_table` scroll, `1`-row & `12`-row tables, `120`-char titles, `12_000`-char prose via `layoutCitedAnswer`, `prompt_chip` prefill-only, keyboard `tabs`/`section` + citation focus restoration, zero `innerHTML`). | [Renderer](../../../packages/ui/src/ask-arden/surface/UiSurfaceRenderer.tsx) and [responsive styles](../../../packages/ui/src/styles/ui-surface.css) | **PASS (local integrated `b4c6ef0`):** `@arden/ui` (`689` passed) verified block rendering, input-only `prompt_chip`, citations, and fallback; signed-in Chromium and native Windows Electron 44 verified `1`-col split at `320px` and `2`-col at `440px`/`720px`, plus `12,000`-char prose and `12`-row comparison table reflow at `320px`. | Live staging walkthrough after deployment. |

---

## 8. Out of Scope (Deferred to V2) & Open Questions

- **Deferred:** SSE progressive `UiSurface` patch streaming, interactive chat form mutations, Private Note modular surfaces (Private Q&A stays on `/v2/generations`).
- **Resolved confirmation (2026-11-26):** `POST /ai/answers` receives a main-owned **`120_000 ms`** deadline in `apps/desktop/src/main/apiRequestPolicy.ts` (matching `Arden-AI`'s `120s` OpenAI timeout).
- **Open Questions:** None.
