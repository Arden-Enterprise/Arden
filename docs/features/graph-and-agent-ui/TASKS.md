# Tracer-Bullet Tasks: Knowledge Graph and Modular Agent UI — V1

- Status: **approved 2026-11-26; Waves 0–4 (`T-01a`–`T-10`) implemented and locally verified on integrated `Arden` `b4c6ef0` (`0075`–`0077`) and `Arden-AI` `5060291` (2026-11-27).** See the owning specifications for exact observed evidence and remaining authorized rollout gates.
- Master plan: [PLAN.md](PLAN.md)
- Owning specs: [CAPABILITY-MAP.md](CAPABILITY-MAP.md) · [SPEC-knowledge-graph.md](SPEC-knowledge-graph.md) · [SPEC-typed-chat-ui-blocks.md](SPEC-typed-chat-ui-blocks.md) · [SPEC-graph-agent-bridge.md](SPEC-graph-agent-bridge.md) · [ADR 0036](../../decisions/0036-knowledge-graph-and-modular-typed-ui-blocks.md) · [Flow 3 diagrams](../../product/flows/flow-3-graph-and-agent.md)
- Implementation discipline: TDD red-green-refactor per slice (`test-driven-development`), real PostgreSQL 17 `FORCE RLS` + ownership-handoff verification on DB slices, and two-axis review (`Standards + Spec`) per PR.

---

## Wave 0 — Prefactoring & Cross-Repo Foundations (4 Parallel Starting Tickets)

### T-01a: Prefactor Web/Electron shell routing, unified Company chat & shell dialog hosts
- **Module:** `graph-agent-bridge` (prefactor)
- **Blocked by:** None (can start immediately)
- **Estimated scope:** Medium (4–5 files)
- **What it delivers:** Users retain URL filter query parameters across Web reloads/Back/sign-in, share one live Company Ask Arden conversation across `AskArdenPage`, docked `AgentPanel`, and visits to `Private`, can invoke `ReportIssueDialog` from shell level, and can send platform-agnostic graph intents on Electron `file://` via `GraphIntentBus`.
- **Acceptance criteria:**
  - [ ] Web routing (`workspaceRoute.ts`, `ArdenShell.tsx`) preserves `/graph` query strings across route sync, Back/Forward, and sign-in return (`rememberReturnPath`).
  - [ ] Single hoisted Company `useArdenChat` instance in `ArdenShell` stays mounted across `AskArdenPage` ↔ `AgentPanel` transitions and across visits to `Private`.
  - [ ] Shell-level `ReportIssueDialog` host and in-memory `GraphIntentBus` work identically on Web and Electron (`routing === false`).
- **Verification:**
  - [ ] `pnpm --filter @arden/ui test` (shell routing, chat preservation, intent bus tests)
  - [ ] `pnpm -r typecheck && pnpm -r build`
- **Files likely touched:** `packages/ui/src/app/workspaceRoute.ts`, `packages/ui/src/app/ArdenShell.tsx`, `packages/ui/src/app/AgentPanel.tsx`, `packages/ui/src/graph/intent-bus.ts`, `packages/ui/tests/ardenShellBridge.test.tsx`.

### T-01b: Prefactor Electron non-blocking IPC lane & baseline AI/renewal request policy
- **Module:** `graph-agent-bridge` (prefactor)
- **Blocked by:** None (can start immediately)
- **Estimated scope:** Small (3–4 files)
- **What it delivers:** Desktop Electron 44 never freezes Graph or Reader navigation while a long-running Ask Arden call is in flight, enforces a main-owned `120_000 ms` timeout on `POST /ai/answers`, validates `POST /ai/answers` JSON bodies strictly, and allowlists renewal routes (`GET /knowledge/renewals`, `POST /knowledge/documents/:id/renewal`).
- **Acceptance criteria:**
  - [ ] Independent Desktop IPC lanes let reads proceed during `POST /ai/answers`. Queued requests and pending responses belong to the session that started them. Concurrent responses apply refreshed cookies only when their credential revision is current.
  - [ ] `desktopApiTimeout` returns `120_000` for `POST /ai/answers`; `apiRequestPolicy.ts` validates `POST /ai/answers` body shape (including optional `scopeFilter` up to 50 UUIDs, `<= 32 KB`) and allowlists renewal endpoints.
- **Verification:**
  - [ ] `pnpm --filter @arden/desktop test` (`apiRequestPolicy.test.ts` + IPC concurrency test)
  - [ ] `pnpm --filter @arden/desktop build`
- **Files likely touched:** `apps/desktop/src/main/index.ts`, `apps/desktop/src/main/apiRequestPolicy.ts`, `apps/desktop/src/main/apiRequestPolicy.test.ts`, `apps/desktop/src/main/index.test.ts`.

### T-02: Domain contracts & ancestor-invariant `UiSurface` v1 validator (`@arden/domain`)
- **Module:** `knowledge-graph`, `typed-chat-ui-blocks` (shared domain seam)
- **Blocked by:** None (can start immediately)
- **Estimated scope:** Medium (5 files)
- **What it delivers:** Provides the single source-of-truth TypeScript types for `KnowledgeGraphPayload` (with ASCII `GraphTypeCode` & legacy nullables) and `BoundUiSurface` / `HydratedUiSurface` / `SurfaceAction` plus the deterministic handle-to-UUID validator guarding all structural, nesting, prototype-key, citation, and byte-size invariants (`F13-UI-AC1`).
- **Acceptance criteria:**
  - [ ] Accepts valid 0-based depth-4 compositions (`stack(0)→tabs(1)→split(2)→card(3)→governance_kv(4)`), translating opaque handles (`D1..D8`) to verified UUIDs and mirroring every referenced doc in `bindings.documents`.
  - [ ] Rejects cycles, DAG diamond reuse, `depth > 4`, `nodes > 32`, `compactBytes > 48_000`, ancestor-bypassed `card→stack→card` / `tabs→stack→tabs` / `split→stack→split` / `row→card→comparison_table`, prototype keys (`__proto__`, `constructor`), uncited `comparison_table` rows, LLM `"warning"|"gap"` callouts, raw HTML, and arbitrary URLs.
  - [ ] Accepts `prose.markdown` up to `12_000` chars and rectangular `1..12`-row tables; rejects `0`-row tables.
- **Verification:**
  - [ ] `pnpm --filter @arden/domain test` (exhaustive adversarial fuzz + unit suite)
  - [ ] `pnpm -r typecheck`
- **Files likely touched:** `packages/domain/src/knowledge-graph.ts`, `packages/domain/src/ui-surface.ts`, `packages/domain/src/index.ts`, `packages/domain/src/knowledge-graph.test.ts`, `packages/domain/src/ui-surface.test.ts`.

### T-03: `Arden-AI` additive `/v3/generations` with OpenAI `strict=True` array surfaces (`Arden-AI` repo)
- **Module:** `typed-chat-ui-blocks` (`Arden-AI`)
- **Blocked by:** None (can start immediately in `Arden-AI`)
- **Estimated scope:** Medium (5 files in `Arden-AI`)
- **What it delivers:** Deploys an additive `POST /v3/generations` endpoint (`answer-v3.schema.json`, `PUBLISHED_CHAT` only, leaving `/v2/retrievals` & `/v2/generations` 100% untouched) that accepts opaque `sourceCatalog` handles (`D1..D8`) and emits OpenAI `strict=True`-compatible array-encoded `AiSurfaceDraft` without ever failing text delivery on invalid surfaces (`F13-UI-AC2`).
- **Acceptance criteria:**
  - [ ] The generated provider schema uses OpenAI `method="json_schema", strict=True` with `additionalProperties: false`, all fields required, nullable `anyOf` and flat node arrays. The local schema fixture checks object nesting at most five levels. Answer and citation validation runs independently of surface parsing.
  - [ ] Returns `uiSurface: null, uiSurfaceStatus: "OMITTED_INSUFFICIENT"` on `INSUFFICIENT_EVIDENCE`, and strips malformed surfaces to `uiSurface: null, uiSurfaceStatus: "OMITTED_INVALID"` (never HTTP 502) while preserving complete standalone `answer` + verbatim `citations`.
  - [ ] Existing `/v2/generations` tests (Company, Reader Q&A, Private Q&A) pass unchanged.
- **Verification:**
  - [ ] `uv run pytest` (including `tests/test_ui_surface_v3.py` strict-schema & golden parity fixtures)
  - [ ] `uv run ruff check . && uv run mypy src`
- **Files likely touched (`Arden-AI`):** `schemas/answer-v3.schema.json`, `src/arden_ai/contracts/governed_v3.py`, `src/arden_ai/presentation/api.py`, `src/arden_ai/infrastructure/answering.py`, `tests/test_ui_surface_v3.py`.

### Checkpoint CP-1: After Wave 0 (`T-01a`, `T-01b`, `T-02`, `T-03`)
- [ ] `Arden`: `pnpm -r typecheck && pnpm -r test && pnpm -r build` green
- [ ] `Arden-AI`: `uv run pytest && uv run ruff check . && uv run mypy src` green
- [ ] Review Ask-First npm dependency approval (`@xyflow/react`, `d3-hierarchy`, `elkjs` + `pnpm audit`) before `T-04b`

---

## Wave 1 — Core Module Vertical Tracer Bullets (Parallel: `knowledge-graph` ∥ `typed-chat-ui-blocks`)

### T-04a: Authorized Knowledge Graph API projection (`GET /knowledge/graph`) & Desktop IPC
- **Module:** `knowledge-graph`
- **Blocked by:** `T-01b`, `T-02`
- **Estimated scope:** Medium (5 files)
- **What it delivers:** Real server-authorized `GET /api/v1/organizations/:orgId/knowledge/graph` returning Accountability & Collections data for current readable publications (`500`-doc cap + `focusDocumentId` guaranteed inclusion, legacy nullable `type` & `allowedTypes`, non-empty Org Collections only preventing `ADR 0032` expired leaks, zero Private Notes / direct shares), wired into Electron `apiRequestPolicy.ts` (route union + global query-string allowlist).
- **Acceptance criteria:**
  - [ ] Real PostgreSQL `FORCE RLS` tests prove unselected readers, cross-org actors, expired docs, and Private/direct-share items return zero nodes, zero hidden counts, and zero empty expired-only Org Collections (`F12-KG-AC1`, `F12-KG-AC5`).
  - [ ] `focusDocumentId` is guaranteed included even when total authorized docs `> 500`; deterministic sort `published_at DESC, document_id ASC`; ASCII `typeCode` filters `"Policy & Standard"` cleanly.
  - [ ] Desktop `apiRequestPolicy.ts` validates all query params and passes negative/positive unit tests.
- **Verification:**
  - [ ] `pnpm --filter @arden/api test` (unit + real-PG `graph.integration.test.ts`)
  - [ ] `pnpm --filter @arden/desktop test`
- **Files likely touched:** `apps/api/src/graph/graph-service.ts`, `apps/api/src/graph/graph-routes.ts`, `apps/api/src/app.ts`, `apps/api/src/graph/graph.integration.test.ts`, `apps/desktop/src/main/apiRequestPolicy.ts`.

### T-04b: `/graph` Island Canvas (`@xyflow/react` + `d3-hierarchy`), two-tier filters & Outline Treegrid
- **Module:** `knowledge-graph`
- **Blocked by:** `T-01a`, `T-04a` *(plus Ask-First approval for `@xyflow/react` & `d3-hierarchy`)*
- **Estimated scope:** Medium (6 files)
- **What it delivers:** Live `/graph` workspace in the `WORK` sidebar (keeping `Home` default per `ADR 0022`) plus `"View in Graph"` deep-links from Home/Reader: lazy-loaded `@xyflow/react` Island tree (`d3-hierarchy`), Accountability ↔ Collections view switcher, two-tier deep filters (client dim-siblings when non-truncated; server re-query when truncated), WCAG 2.2 AA `role="treegrid"` Outline view (`< 768px` default), and Apple/Emil motion rules (`0ms` keyboard, `280ms` interruptible `fitView`, `160ms`/`125ms` origin-aware floating toolbar).
- **Acceptance criteria:**
  - [ ] Renders Accountability (`Org → Owner Dept → Type [5 + Uncategorized] → Docs`) and Collections (`Org Collections + Unassigned`, separate `Shared`) with honest loading/empty/truncated/error states (`F12-KG-AC1`, `F12-KG-AC5`, `F12-KG-AC6`).
  - [ ] An authorized focus target and its ancestors remain visible in both renderers when active facets would hide the target. Facet counts still reflect actual matches.
  - [ ] Pure `GraphLayoutEngine` drives both React Flow canvas and `role="treegrid"` Outline with full keyboard navigation (`Arrow`, `Enter`, `P`, `Escape`), focus restoration, and `< 768px` Outline default.
- **Verification:**
  - [ ] `pnpm --filter @arden/ui test` (`layout.test.ts` + `GraphPage.test.tsx`)
  - [ ] `pnpm -r build` (verify `/graph` chunk is lazy-loaded, not in `Home` initial bundle)
- **Files likely touched:** `packages/ui/src/graph/layout.ts`, `packages/ui/src/graph/GraphPage.tsx`, `packages/ui/src/graph/GraphCanvas.tsx`, `packages/ui/src/graph/GraphOutlineView.tsx`, `packages/ui/src/graph/GraphFilterBar.tsx`, `packages/ui/src/app/AppSidebar.tsx` (+ tests).

### T-05a: Core `/v3/generations` adapter, `0075` migration, batched hydration & 4-path revocation
- **Module:** `typed-chat-ui-blocks`
- **Blocked by:** `T-01b`, `T-02`, `T-03`
- **Estimated scope:** Medium (6 files)
- **What it delivers:** Operator migration `0075_ai_turn_ui_surface.sql` (`SET search_path`, `ui_surface <= 64 KB`, `scope_filter_hash`, `ai_turn_surface_binding` `FORCE RLS`), Core `/v3/generations` client passing opaque `sourceCatalog` handles with deterministic fallback (`<= 12_000`-char `prose`), batched conversation hydration (`publication_expiration_date()`, `list_publication_author_names()`, role-scoped `openMaintenanceCaseCount`, deduplicated `hydratedDocuments` + cursor paging `?limit=20&beforeSequence=` + Electron `2 MiB` ceiling), and 4-path turn-level fail-closed revocation (`load`, `replay`, `context`, `append`).
- **Acceptance criteria:**
  - [ ] Real PostgreSQL tests prove `0075` apply/checksums (`pnpm migrations:check`), `48 KB` compact / `64 KB` `jsonb::text` headroom, graceful legacy `NULL` & corrupt-row degradation, and 4-path revocation withholding entire turns when any evidence or `ai_turn_surface_binding` loses access/expires/supersedes (`F14-UI-AC1`, `F14-UI-AC2`).
  - [ ] Both chat views fetch earlier whole turns with `beforeSequence`, preserving order, the current thread and live hydration. Core emits pages at or below 2 MiB. It checks evidence and bindings again after hydration in history, replay and new answers.
  - [ ] Missing or invalid `uiSurface` from `Arden-AI` never fails a turn (`F13-UI-AC3`); `INSUFFICIENT_EVIDENCE` always emits Core gap callout; `lineage_tree` hydrates gracefully empty if `0076` isn't present yet.
- **Verification:**
  - [ ] `pnpm migrations:check && pnpm --filter @arden/api test` (including `governed.integration.verification.ts`)
  - [ ] `pnpm --filter @arden/desktop test` (paginated conversation route + `2 MiB` response limit)
- **Files likely touched:** `apps/api/migrations/0075_ai_turn_ui_surface.sql`, `apps/api/migrations/release-policy.json`, `apps/api/src/answers/ui-surface-hydrator.ts`, `apps/api/src/answers/governed-answering.ts`, `apps/api/src/answers/conversation-store.ts`, `apps/api/src/answers/ai-client.ts` (+ tests).

### T-05b: Recursive `UiSurfaceRenderer` (6 containers + 7 leaves + 4 actions) & `@container` CSS
- **Module:** `typed-chat-ui-blocks`
- **Blocked by:** `T-01a`, `T-02`, `T-05a`
- **Estimated scope:** Medium (5–6 files)
- **What it delivers:** Renders live modular `HydratedUiSurface` blocks inside both docked/floating `AgentPanel` and full `AskArdenPage` using pure CSS `@container (max-width: 439px)` responsive `split`/`row` collapse, Arden's zero-dependency `layoutCitedAnswer` (`CitedAnswer.tsx`) for `prose`, Island styling, accessible keyboard `tabs`/`section`/`table`, citation chip focus restoration, and `prompt_chip` prefill-only composer actions (`F13-UI-AC4`).
- **Acceptance criteria:**
  - [ ] Renders all 6 containers, 7 leaves, and 4 actions cleanly at `320px`, `440px`, and `720px` container widths with zero `innerHTML` and zero `ResizeObserver` thrashing.
  - [ ] Quarantines `document_item.highlightNote` visually from Core-hydrated metadata; omits maintenance badges when `openMaintenanceCaseCount === null`; degrades legacy `uiSurface: null` turns to `<CitedAnswer />`.
- **Verification:**
  - [ ] `pnpm --filter @arden/ui test` (`UiSurfaceRenderer.test.tsx`)
  - [ ] `pnpm -r build`
- **Files likely touched:** `packages/ui/src/ask-arden/surface/UiSurfaceRenderer.tsx`, `containers.tsx`, `leaves.tsx`, `ActionBar.tsx`, `packages/ui/src/ask-arden/ChatMessages.tsx`, `packages/ui/src/styles/ui-surface.css` (+ tests).

### Checkpoint CP-2: After Wave 1 (`T-04a`, `T-04b`, `T-05a`, `T-05b`)
- [ ] Both independent modules (`knowledge-graph` core tree + `typed-chat-ui-blocks` full modular chat) run end-to-end on real PostgreSQL 17, Web, and Electron 44
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build && pnpm migrations:check` green

---

## Wave 2 — ISO/IEC 38505-1:2026 Governance Depth (`knowledge-graph` Completion)

### T-06: Dual-endpoint `document_relationship` RLS (`0076`), link API/UI & lazy `elk.bundled.js` cross-links
- **Module:** `knowledge-graph` (+ activates live `lineage_tree` in `typed-chat-ui-blocks`)
- **Blocked by:** `T-04a`, `T-04b` *(plus Ask-First approval for `elkjs` & migration `0076`)*
- **Estimated scope:** Medium (6 files)
- **What it delivers:** Replaces `0027`'s permissive author policies (`DROP POLICY`) with strict dual-endpoint published reader RLS, Author/Org-Admin dual-read create & source-read ghost-cleanup delete, advisory-locked `SUPERSEDES` acyclicity & symmetric `RELATED` dedupe, append-only `document_relationship_idempotency` (`409 IDEMPOTENCY_CONFLICT`), uniform `404 RESOURCE_NOT_AVAILABLE`, `ADR 0035` audit events, published-only `GraphRelationshipDialog` (Reader Info Panel + Graph floating toolbar), `1_000`-edge cap, and lazy on-demand `elk.bundled.js` (`<= 250n/500e` threshold) (`F12-KG-AC2`, `F12-KG-AC3`).
- Read-only users can disclose the same visible, filtered cross-links in Outline as in Canvas. A create replay checks current source authority and both endpoints before returning the stored edge.
- **Acceptance criteria:**
  - [ ] Real PostgreSQL `FORCE RLS` (post-ownership handoff) proves `0027` policies are gone, half-authorized/expired/withdrawn edges return `0` rows, `INSERT` rejects unreadable targets with uniform `404`, `DELETE` cleans up ghost edges when targets restrict/expire, concurrent `SUPERSEDES` cycles and duplicate reverse `RELATED` return `409`, and `ADR 0035` audit logs store IDs + type only.
  - [ ] `target-readers.integration.test.ts:417–434` updated to published fixtures and passing; Electron `apiRequestPolicy.ts` enforces `Idempotency-Key` on `POST .../relationships` and `POST .../remove`; lazy `elk.bundled.js` runs under Electron `script-src 'self'` CSP without `blob:` workers.
- **Verification:**
  - [ ] `pnpm migrations:check && pnpm --filter @arden/api test && pnpm --filter @arden/desktop test && pnpm --filter @arden/ui test`
  - [ ] `pnpm -r build` (record exact `elk.bundled.js` lazy chunk size)
- **Files likely touched:** `apps/api/migrations/0076_graph_document_relationships.sql`, `apps/api/migrations/release-policy.json`, `apps/api/src/graph/relationship-service.ts`, `apps/api/src/target-readers/target-readers.integration.test.ts`, `packages/ui/src/graph/GraphRelationshipDialog.tsx`, `packages/ui/src/graph/layout.ts` (+ Electron IPC & tests).

### T-07: ISO/IEC 38505-1:2026 Governance Monitor Mode (`0077`), `0060` maintenance counts & `openTarget` routing
- **Module:** `knowledge-graph`
- **Blocked by:** `T-04a`, `T-04b`, `T-06` *(sequential migration numbering after `0075`/`0076`)*
- **Estimated scope:** Medium (5 files)
- **What it delivers:** Reviewed `SECURITY DEFINER` `list_graph_monitor_documents(...)` (registered in `deploy/release/security-definer-owner-repair.sql`), role-gated Monitor Mode toggle & badges (`Expiring ≤ 30d`, `Unassigned Org Doc`, `Include Expired`, nullable `openMaintenanceCaseCount` strictly scoped to Org Admin & `0060` disjoint reviewers), and complete `openTarget` routing (`READER`, `RESPONSIBLE_VIEW`, `ADMIN_INSPECTION`, `MY_CONTRIBUTIONS`) for Authors (including expired-only authors), Responsible Reviewers, and Org Admins (`F12-KG-AC4`).
- **Acceptance criteria:**
  - [ ] Real PostgreSQL tests (post-ownership handoff + `security-definer-owner-repair.sql` exact routine-count assertion) prove ordinary readers cannot activate Monitor Mode or see expired docs, Authors see expired own docs (`openTarget: MY_CONTRIBUTIONS`, `openMaintenanceCaseCount: null`), Responsible Reviewers see scoped docs (`openTarget: RESPONSIBLE_VIEW`, `0060` case count), and Org Admins see metadata-only restricted/expired docs (`openTarget: ADMIN_INSPECTION`).
  - [ ] Renewed dates resolve accurately via `publication_expiration_date()` inside Monitor Mode.
- **Verification:**
  - [ ] `pnpm migrations:check && pnpm --filter @arden/api test && pnpm --filter @arden/ui test`
- **Files likely touched:** `apps/api/migrations/0077_graph_monitor_projection.sql`, `apps/api/migrations/release-policy.json`, `deploy/release/security-definer-owner-repair.sql`, `apps/api/src/graph/graph-service.ts`, `packages/ui/src/graph/GraphFilterBar.tsx` (+ tests).

### Checkpoint CP-3: After Wave 2 (`T-06`, `T-07`)
- [ ] Full ISO/IEC 38505-1:2026 Knowledge Graph (Accountability, Collections, Cross-Links, Monitor Mode, Outline) verified on real PG after ownership handoff

---

## Wave 3 — Bidirectional Bridge (`graph-agent-bridge`)

### T-08: Graph Context Basket & SQL-pushed `scopeFilter` narrowing + `scope_filter_hash` replay guard
- **Module:** `graph-agent-bridge`
- **Blocked by:** `T-04b`, `T-05a`
- **Estimated scope:** Medium (5–6 files)
- **What it delivers:** Users pin documents or non-truncated branches into a transparent Context Basket (`Engineering · 8 docs` summary chips above composer; hard 50-doc cap; hidden in `Private`; cleared on org switch; non-oracle reconciliation on unfiltered non-truncated refresh) that pushes `scopeFilter.documentIds` into SQL `listAuthorizedAiSources` before `LIMIT 501`, narrows `sourceHints` and `context.history`, isolates empty intersections, and enforces `scope_filter_hash` replay `409 CONVERSATION_CONFLICT` with updated `useArdenChat` retry keying (`F12-BR-AC1`, `F12-BR-AC2`).
- **Acceptance criteria:**
  - [ ] Real PostgreSQL test on a `> 500`-document synthetic org proves SQL-pushed `scopeFilter` succeeds without hitting `LIMIT 501`, narrows `sourceHints` and `context.history`, persists `evidence: []` on empty intersection, and returns `409` on mismatched `requestId` + `scope_filter_hash`.
  - [ ] Modifying the basket before retrying a failed prompt generates a fresh `requestId`; branch pin is cleanly refused while `truncated === true` or `> 50` docs.
- **Verification:**
  - [ ] `pnpm --filter @arden/api test && pnpm --filter @arden/ui test && pnpm --filter @arden/desktop test`
- **Files likely touched:** `apps/api/src/db/repository.ts`, `apps/api/src/answers/routes.ts`, `apps/api/src/answers/governed-answering.ts`, `packages/ui/src/graph/context-basket.ts`, `packages/ui/src/ask-arden/useArdenChat.ts`, `packages/ui/src/app/AgentPanel.tsx` (+ tests).

### T-09: Bidirectional `graph_action` execution, `pin_to_context` Undo toast & Flow 2/3/4 handoffs
- **Module:** `graph-agent-bridge`
- **Blocked by:** `T-05b`, `T-06`, `T-07`, `T-08`
- **Estimated scope:** Medium (5 files)
- **What it delivers:** `SurfaceActionDispatcher` sends the four navigation operations via `GraphIntentBus`. `pin_to_context` updates the Context Basket in place and offers Undo. The shared Company thread survives Graph navigation. Reader and workflow actions route via `openTarget` and the shell dialog hosts, with exact publication and permission checks for responsible view and renewal. Resize coverage verifies Graph viewport preservation (`F12-BR-AC3`–`AC5`).
- **Acceptance criteria:**
  - [ ] All 4 `SurfaceAction` primitives dispatch identically on Web and Electron with zero autonomous write mutations.
  - [ ] Opening, closing, floating, or dragging the `F13-RESIZE` splitter (`320px`–`720px`) preserves Graph zoom, pan, selection, filters, Context Basket, and chat thread.
- **Verification:**
  - [ ] `pnpm --filter @arden/ui test` (`dispatch.test.ts` + `ArdenShell.test.tsx`)
  - [ ] `pnpm -r typecheck && pnpm -r build`
- **Files likely touched:** `packages/ui/src/ask-arden/surface/dispatch.ts`, `packages/ui/src/ask-arden/surface/dispatch.test.ts`, `packages/ui/src/knowledge/knowledgeCitation.ts`, `packages/ui/src/app/ArdenShell.tsx`, `packages/ui/src/graph/GraphPage.tsx`.

### Checkpoint CP-4: After Wave 3 (`T-08`, `T-09`)
- [ ] Full bidirectional Graph ↔ Agent ↔ Flow 2/3/4 journey works end-to-end on Web and Windows Electron 44

---

## Wave 4 — Craft QA, Full-Stack Verification & Documentation Sync

### T-10: Craft QA (`/break-ui`, `/review-animations`), full-stack PG/Web/Electron evidence & Flow/Knowledge sync
- **Module:** Cross-cutting QA & Delivery
- **Blocked by:** `T-09`
- **Estimated scope:** Medium (verification harness + evidence/doc reconciliation)
- **What it delivers:** Stress-tests every surface with worst-case data (`/break-ui`: 120-char titles, legacy `type: null`, `0`/`500` docs, `1_000` edges, `320px`/`440px`/`720px` `@container` panels, `12_000`-char fallback prose, mid-session revocation), audits every transition against Apple/Emil standards (`/review-animations`), runs the full real-PostgreSQL post-ownership-handoff chain (`0001`–`0077`) + Web & Windows Electron 44 signed-in walkthrough, updates actual evidence in the 3 module specs and [flow-3-graph-and-agent.md](../../product/flows/flow-3-graph-and-agent.md), and prepares the paired team-knowledge handoff for authorized publication.
- **Acceptance criteria:**
  - [ ] `/break-ui` and `/review-animations` report zero unresolved layout, accessibility, reduced-motion, or motion-timing defects.
  - [ ] All acceptance IDs (`F12-KG-AC1..6`, `F13-UI-AC1..4`, `F14-UI-AC1..2`, `F12-BR-AC1..6`) carry observed pass evidence (`PASS` with exact command/ref, never invented passes).
  - [ ] Two-axis `/code-review` (`Standards + Spec`) passed; paired team-knowledge record prepared alongside PR.
- **Verification:**
  - [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build && pnpm migrations:check && pnpm test:remote`
  - [ ] Real PG `0001`–`0077` ownership-handoff suite + Web & Windows Electron 44 signed-in walkthrough
- **Files likely touched:** `docs/features/graph-and-agent-ui/{SPEC-knowledge-graph,SPEC-typed-chat-ui-blocks,SPEC-graph-agent-bridge}.md`, `docs/product/flows/flow-3-graph-and-agent.md`, plus targeted polish fixes surfaced by `/break-ui` & `/review-animations`.
