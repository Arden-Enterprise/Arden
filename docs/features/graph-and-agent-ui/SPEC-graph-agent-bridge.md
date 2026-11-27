# Spec: `graph-agent-bridge` (`F12-AC3` / Bidirectional Integration) — V1

- Spec revision/date: `v1-accepted` (reconciled and approved) / 2026-11-26
- Decision state: **accepted** ([ADR 0036](../../decisions/0036-knowledge-graph-and-modular-typed-ui-blocks.md); local implementation and verification in progress)
- Originator: requesting project maintainer
- Decision owner: requesting project maintainer
- Record author: coding agent
- Approval: maintainer approved architecture, reconciled `v1` spec, compact branch-summary basket chips, and `120_000 ms` Desktop AI timeout on 2026-11-26
- Intended audience: public-safe repository specification
- Source/code baseline and affected repositories: originally specified against `Arden` `origin/staging` `fa4d6fe`; integrated on 2026-11-27 onto `Arden` `staging` `b4c6ef0` (`apps/api/src/answers/*`, `apps/desktop/src/main/{apiRequestPolicy,desktopApi,requestScheduler,index}.ts`, `packages/ui/src/app/{ArdenShell,AgentPanel,workspaceRoute}.tsx`, `packages/ui/src/ask-arden/useArdenChat.ts`)
- Related Linear issues: `ARD-50`, `ARD-52`, `ARD-59`
- Parent Capability Map: [CAPABILITY-MAP.md](CAPABILITY-MAP.md) (`graph-agent-bridge`)
- Depends on: [SPEC-knowledge-graph.md](SPEC-knowledge-graph.md), [SPEC-typed-chat-ui-blocks.md](SPEC-typed-chat-ui-blocks.md)

---

## 1. Objective

Connect the **Knowledge Graph** (`knowledge-graph`) and **Modular Ask Arden Chat** (`typed-chat-ui-blocks`) into one seamless, zero-leak, human-in-the-loop workspace across Web and Windows Electron 44:

1. **Graph → Agent (Explicit Context Basket, `F12-AC3`):** Let users select individual documents or non-truncated branches into a transparent **Context Basket** (max **50 currently authorized documents**) that visibly travels into the docked `AgentPanel` and strictly narrows Ask Arden retrieval via SQL-pushed intersection (never triggering the 500-doc budget crash, never leaking out-of-scope docs through `sourceHints` or `context.history`).
2. **Agent → Graph (Platform-Agnostic Bidirectional Actions):** Dispatch `graph_action` buttons from any `UiSurface` through a shared in-memory `GraphIntentBus` (synced with Web URL query strings and working identically on Electron `file://` without URL routing) while preserving the single shared Company conversation thread across `AskArdenPage`, `/graph`, and `AgentPanel`.
3. **Agent / Graph → Flow 2, Flow 3 & Flow 4 Handoffs:** Route `open_reader` (using `{ documentId, publishedVersionId, blockId?, page? }` + `openTarget`) and `workflow_handoff` (`report_issue`, `open_maintenance_case`, `open_renewal`) strictly into existing human-confirmed dialogs/views—including a shell-level `ReportIssueDialog` host and non-Admin Responsible Reviewer on-behalf renewal support.
4. **Non-Blocking Desktop & State Preservation (`F12-AC1`):** Separate AI generation calls from Graph/Reader reads in Electron's IPC queue so Ask Arden never freezes Graph interaction, and preserve Graph viewport, filters, Context Basket, and chat transcript across `AgentPanel` dock/float/resize (`F13-RESIZE`) and Private workspace visits.

---

## 2. Deep-Module Architecture & Seams (`codebase-design`)

| Module | Seam | Narrow Interface | Hidden Implementation Depth |
| --- | --- | --- | --- |
| `ScopeFilterPolicy` (`apps/api/src/answers/governed-answering.ts` + `db/repository.ts`) | `POST /ai/answers` boundary ↔ SQL retrieval & history context | `canonicalScopeHash(scopeFilter)` & `listAuthorizedAiSources(user, orgId, genIds?, chunkIds?, scopeDocumentIds?)` | Pushes `scopeFilter.documentIds` (`1..50` unique UUIDs) into SQL `AND pv.shared_draft_id = ANY($...::uuid[])` BEFORE `LIMIT 501`, filters `sourceHints` and `context.history` strictly to `scopedBefore`, persists `scope_filter_hash` for replay validation (`409 CONVERSATION_CONFLICT`), and isolates empty-intersection turns from prior `context.references`. |
| `GraphContextBasketStore` (`packages/ui/src/graph/context-basket.ts`) | Shell state seam (`ArdenShell` ↔ `GraphPage` ↔ `AgentPanel`) | `pinDocuments(items)`, `pinBranch(branchRef, docs, isTruncated)`, `unpin(docId)`, `clear()`, `reconcileUnfiltered(visibleDocIds)`, `toScopeFilter()` | Deduplicates pinned docs (`{ documentId, title, ownerDepartmentName }`), enforces hard 50-doc cap without silent partial truncation (refuses branch pins while Graph is truncated), resets automatically on org switch or sign-out, stays hidden/ignored in `Private` workspace, and performs non-oracle reconciliation only against unfiltered, non-truncated Graph snapshots. |
| `GraphIntentBus & SurfaceActionDispatcher` (`packages/ui/src/ask-arden/surface/dispatch.ts`) | `UiSurfaceRenderer` ↔ `ArdenShell` / `GraphPage` / Shell Dialog Hosts | `dispatchSurfaceAction(action: SurfaceAction, env: SurfaceActionEnv): void` | Routes all 4 action primitives uniformly on Web and Electron `file://`: updates `GraphIntentBus` + navigates to `/graph` with docked `AgentPanel` open and shared Company thread preserved, opens Reader/Inspection/Responsible-View/My-Contributions by `openTarget`, opens shell-hosted `ReportIssueDialog` / Maintenance / Renewal flows, or prefills+focuses composer on `prompt_chip`. |

---

## 3. API, Scope Narrowing, & Desktop IPC Contract (`api-and-interface-design`)

### 3.1 Additive Extension to `POST /api/v1/organizations/:organizationId/ai/answers`

```ts
export interface AnswerScopeFilter {
  documentIds: string[]; // 1..50 unique UUIDs (logical shared_draft_id)
}

export interface AskAnswerRequestBody {
  query: string;                      // 1..4000 chars
  conversationId?: string;            // uuid
  requestId?: string;                 // uuid (idempotency key per turn)
  expectedRevision?: number;          // integer 0..1_000_000
  scopeFilter?: AnswerScopeFilter;    // optional additive narrowing filter
}
```

- **Fastify Ajv Schema:** `additionalProperties: false` on root body and `scopeFilter`; `scopeFilter.documentIds` array `minItems: 1`, `maxItems: 50`, `uniqueItems: true`, UUID pattern.
- **Canonical Scope Hash & Replay Safety (`ADR 0030` additive extension):**
  - Compute `scopeFilterHash = scopeFilter ? sha256(sortedUnique(scopeFilter.documentIds).join(",")) : null`.
  - Persist `scope_filter_hash` on `ai_conversation_turn` (migration `0075`). Replaying an identical `requestId` with a different `scopeFilterHash` returns **`409 CONVERSATION_CONFLICT`** from the answer route.
  - **Client retry key fix (`useArdenChat.ts:151`):** Key `retryRequest` on `(conversationId, query, scopeFilterHash)` so modifying the Context Basket before retrying a failed question generates a fresh `requestId` instead of triggering a spurious `409`.
  - *(Governance provenance note: this extends [ADR 0030](../../decisions/0030-published-date-ai-sources.md) additively for explicit Context Basket document narrowing; retired `versionScope` temporal modes remain permanently removed.)*

### 3.2 Core SQL-Pushed Intersection Semantics (`GovernedAnswering.answer()`)

1. **SQL Pushdown (prevents 501-doc org crash):** Pass `input.scopeFilter?.documentIds` directly into `repository.listAuthorizedAiSources(user, organization, undefined, undefined, scopeDocumentIds)` adding `AND pv.shared_draft_id = ANY($...::uuid[])` **before** `LIMIT 501`.
2. **Zero existence oracle:** Never query unmatched UUIDs in `scopeFilter.documentIds` and never return per-ID denied/missing errors.
3. **Scoped `sourceHints` & `context.history` (closes M3 leaks):**
   - Pass `scopedBefore` into **both** `allowedGenerationIds` AND `sourceHints` (so `Arden-AI` never rejects mismatched `sourceHints` or receives out-of-scope document titles).
   - With an active `scopeFilter`, Core forwards a prior turn only when it has evidence, every evidence version and surface binding belongs to the current scoped set, and the turn still passes live access checks.
4. **Empty intersection isolation:** If `scopedBefore.length === 0`, skip `Arden-AI`, set `allReferences = []` (NOT prior `context.references`!), persist `status: "INSUFFICIENT_EVIDENCE"` with `evidence: []` and Core's deterministic `callout(tone: "gap")` surface (`"None of the selected documents are currently eligible for Ask Arden in this scope."`).
5. **Private Notes isolation ([knowledge-source-contexts.md](../../engineering/knowledge-source-contexts.md)):** In `/private`, `AgentPanel` displays the open Private note context and hides/ignores the Company Context Basket (`scopeFilter` is never sent to `askPrivateNote`).

### 3.3 Desktop Electron 44 IPC Allowlist & Concurrency (`apps/desktop/src/main/`)

1. **`apiRequestPolicy.ts` (with paired negative/positive tests in `apiRequestPolicy.test.ts`):**
   - Add `GET /api/v1/organizations/:orgId/knowledge/graph` to BOTH the route union AND the global query-string allowlist (`apiRequestPolicy.ts:333`) with strict per-param validation (`view`, `q <= 120`, `ownerDepartmentId`, `typeCode`, `collectionId`, `readerScope`, `validity`, `includeLinks`, `relationshipTypes`, `monitor`, `onlyOpenCases`, `onlyUnassignedOrg`, `includeExpired`, `focusDocumentId`, `limit 1..500`).
   - Add `POST .../knowledge/documents/:docId/relationships` and `POST .../knowledge/documents/:docId/relationships/:relId/remove` requiring UUID `idempotencyKey` and strict JSON bodies.
   - Add strict JSON body validator on `POST .../ai/answers` (currently unvalidated at `apiRequestPolicy.ts:240`) validating `query`, `conversationId?`, `requestId?`, `expectedRevision?`, and optional `scopeFilter.documentIds` (`1..50` UUIDs, max body `<= 32 KB`).
   - Allowlist `GET .../ai/conversations/:conversationId` optional cursor query params (`limit`, `beforeSequence`) and bump `desktopApiResponseLimit` for conversation detail loads to **`2_097_152` bytes (2 MiB)**.
   - Allowlist renewal routes (`GET .../knowledge/renewals` and `POST .../knowledge/documents/:docId/renewal`) required by `workflow_handoff: open_renewal`.
   - Set explicit main-owned `desktopApiTimeout` of `120_000 ms` on `POST .../ai/answers` (matching `Arden-AI`'s 120s timeout; replaces current unbounded `undefined` timeout).
2. **Non-blocking IPC lane (`apps/desktop/src/main/index.ts:15, 36–38, 274–278`):**
   - Extend `canPassWaitingRequests(request)` (or separate `aiRequestQueue` from `interactiveRequestQueue`, keeping `withJarLock` cookie-jar serialization intact) so a 15–60s `POST /ai/answers` request NEVER head-of-line blocks `GET /knowledge/graph`, Reader opens, or relationship mutations on Electron!

---

## 4. Shell Integration, Bidirectional Actions & Handoffs (`$apple-design` + `$ask-emil`)

### 4.1 Unified Company Chat & Context Basket UX
- **Shared `useArdenChat` hoisted to `ArdenShell`:** Lift the Company `useArdenChat` hook to `ArdenShell` so `AskArdenPage` and docked `AgentPanel` share the exact same live conversation, `messages`, `revision`, and `sources` panel. Navigating from `AskArdenPage` to `/graph` via a `graph_action` automatically opens docked `AgentPanel` on that exact live thread.
- **Preserve Company thread across Private visits (`AgentPanel.tsx:28–30`):** Keep the Company chat state mounted/retained inside `ArdenShell` when switching to `/private` (only the Private sidebar uses its own transient note chat per [knowledge-source-contexts.md](../../engineering/knowledge-source-contexts.md)); returning to `/graph` or `Home` restores the Company thread intact.
- **Context Basket visibility & anti-oracle safety:**
  - Composer displays an explicit Context Basket pill bar (`Scoped to 3 documents · Clear`) with expandable chips showing exact titles and owner departments (or branch summary chip `Engineering · 8 docs` while still sending explicit `documentIds[]` on the wire).
  - **Truncated-branch guard:** If `truncation.truncated === true`, `Pin branch` refuses partial silent pinning and prompts the user to narrow filters first (`"Narrow filters so this branch is fully loaded (<= 50 docs) before pinning"`). If a fully loaded branch contains `> 50` docs, refuse cleanly with clear count notice (`"Context Basket holds up to 50 documents"`).
  - **Non-oracle stale reconciliation:** Reconcile basket IDs ONLY when an unfiltered, non-truncated `GET /knowledge/graph` completes (pruning disappeared items calmly with `"1 selected item is no longer available and was removed"`). Never inspect or return dropped IDs from `POST /ai/answers` (zero send-time existence oracle!).

### 4.2 `graph_action` Execution via `GraphIntentBus` (Web + Electron Parity)

| `action.op` | Payload | Behavior on `/graph` | Behavior from `Home` / `AskArdenPage` / `Reader` |
| --- | --- | --- | --- |
| `focus_nodes` | `{ documentIds: string[] }` (`1..8` bound docs) | Selects targets, expands collapsed ancestors, triggers interruptible `280ms` `fitView` (and requests `focusDocumentId` if truncated). | Dispatches intent on `GraphIntentBus`, navigates to `/graph` (syncing URL on Web), opens docked `AgentPanel` on active thread. |
| `apply_filter` | `{ ownerDepartmentId?, typeCode?, collectionId?, readerScope?, validity? }` | Applies facet filters (`0ms`), dims non-matching siblings (or re-queries if truncated). *(Note: Monitor-only flags like `onlyOpenCases` are intentionally excluded from LLM `graph_action` to prevent non-accountable role leakage.)* | Dispatches intent on `GraphIntentBus`, navigates to `/graph`, keeps `AgentPanel` docked. |
| `isolate_branch` | `{ branchKind: "department" \| "collection" \| "type"; branchId: string }` | Activates Isolate Mode on that branch + interruptible `280ms` `fitView`. | Dispatches intent on `GraphIntentBus`, navigates to `/graph`, keeps `AgentPanel` docked. |
| `toggle_links` | `{ enabled: boolean; relationshipTypes? }` | Toggles cross-link layer (lazy-loading `elk.bundled.js` if enabled). | Dispatches intent on `GraphIntentBus`, navigates to `/graph`, keeps `AgentPanel` docked. |
| `pin_to_context` | `{ documentIds: string[] }` (`1..8` bound docs) | Resolves title & owner dept from conversation's `hydratedDocuments`, adds to Context Basket (`0ms`, respecting 50-doc cap), and displays a visible confirmation toast (`"Scoped Ask Arden to 2 documents · Undo"`) so prompt-injected chips can never silently steer scope. | Same immediate basket update + confirmation toast + Undo (user can keep asking scoped follow-ups from any Company screen). |

### 4.3 Human-Confirmed Workflow Handoffs (Zero Autonomous Writes)
- **`open_reader` (`{ documentId, publishedVersionId, blockId?, page? }`):**
  - Looks up `hydratedDocuments[publishedVersionId].openTarget`:
    - `READER`: Opens Reader at exact `publishedVersionId` using an extended `KnowledgeReaderTarget` carrying optional `blockId`/`page` anchor highlight (matching Reader's existing citation scroll behavior).
    - `ADMIN_INSPECTION`: Routes to `ADR 0023` audited inspection gate for `documentId`.
    - `RESPONSIBLE_VIEW`: Routes to `GET /knowledge/documents/:documentId/responsible-view`.
    - `MY_CONTRIBUTIONS`: Opens `My Contributions` focused on `documentId`.
- **`workflow_handoff` (`{ handoff, documentId, publishedVersionId }`):**
  - `report_issue`: Opens a **shell-level `ReportIssueDialog` host** (lifted out of `ServerKnowledgeFeaturePage` into `ArdenShell`) pre-pinned to `{ documentId, publishedVersionId }` so users can file Flow 4 reports directly from `/graph` or `AgentPanel` with human confirmation.
  - `open_maintenance_case` (shown ONLY when `canOpenMaintenance === true`): Navigates to `/reviews/maintenance` passing `documentId` via an in-memory maintenance-focus intent (highlighting matching cases in the existing `scope=queue` list without requiring an unbuilt server filter param).
  - `open_renewal` (shown ONLY when `canRenew === true`): Opens the existing Renewal request dialog (`POST /knowledge/documents/:documentId/renewal`) directly from a shell-level host (or routes Authors to `My Contributions`, Admins to `Administration → Documents`, and **non-Admin Responsible Reviewers** directly to the on-behalf renewal dialog per `ADR 0032` B3 so no eligible reviewer hits a dead end!).

### 4.4 `AgentPanel` State Preservation (`F12-AC1`)
- `GraphPage` preserves React Flow viewport `(x, y, zoom)`, selected node, and active filter state across `AgentPanel` open/close/dock/float/resize (`F13-RESIZE`, `320px`–`720px`) via CSS flex resizing without unmounting `<ReactFlow />`.

---

## 5. Project Structure & Testing Strategy

```text
apps/api/src/
  db/repository.ts                                       # Push scopeDocumentIds into listAuthorizedAiSources SQL before LIMIT 501
  answers/{routes,governed-answering,conversation-store}.ts
  answers/governed-answering.test.ts                     # SQL-pushed scopeFilter, scoped sourceHints/history, empty-scope isolation, replay 409
apps/desktop/src/main/
  apiRequestPolicy.ts / apiRequestPolicy.test.ts         # Graph, relationships, scopeFilter, renewal, paged conversations, 120s AI timeout
  index.ts / index.test.ts                               # Non-blocking concurrent read/AI IPC lane
packages/ui/src/
  graph/{context-basket.ts,context-basket.test.tsx,intent-bus.ts}
  ask-arden/surface/{dispatch.ts,dispatch.test.ts}       # All 4 actions, pin confirmation + Undo, openTarget & shell dialog handoffs
  app/{ArdenShell.tsx,AgentPanel.tsx,ArdenShell.test.tsx}# Shared Company useArdenChat, Private preservation, F12-AC1 viewport preservation
```

---

## 6. Acceptance & Evidence Matrix

| ID | Observable requirement (including SQL pushdown, non-oracle reconciliation, Electron concurrency, and thread preservation) | Implementation reference | Evidence actually obtained | Remaining / owner |
| --- | --- | --- | --- | --- |
| `F12-BR-AC1` | Context Basket shows exact selected items as Arden Island pill chips above composer (with instant branch expansion, per-document removal, and dismissable stale/limit notices), refuses branch pins while truncated or `> 50` docs (no silent partial truncation), pins only filtered active docs when filters are active, reconciles stale pins only on unfiltered non-truncated Graph refresh (zero send-time existence oracle), clears on org switch/sign-out, and is hidden/ignored in `Private`. | [Context Basket](../../../packages/ui/src/graph/context-basket.ts), [Composer](../../../packages/ui/src/ask-arden/ChatComposer.tsx), and [Graph](../../../packages/ui/src/graph/GraphPage.tsx) | **PASS (local integrated `b4c6ef0`):** `@arden/ui` (`689` passed, including dedicated `context-basket.test.tsx`) verified Island chips, branch cap refusal, filtered branch pinning, dismissable notices, Undo, and Private isolation; signed-in Chromium and native Windows Electron 44 verified keyboard pinning, scoped send, and signed-in mid-session access loss + calm basket reconciliation. | Live staging walkthrough after deployment. |
| `F12-BR-AC2` | Real PostgreSQL test on a `> 500`-document org proves `scopeFilter.documentIds` is pushed into SQL before `LIMIT 501` (no `503` budget crash), narrows both `allowedGenerationIds` and `sourceHints`, filters `context.history` to in-scope turns, isolates empty-intersection turns from prior `context.references`, and returns `409 CONVERSATION_CONFLICT` when `requestId` is replayed with a different `scope_filter_hash` (while editing the basket before retrying generates a new `requestId` in `useArdenChat`). | [Answer route](../../../apps/api/src/answers/routes.ts), [repository](../../../apps/api/src/db/repository.ts) and [chat](../../../packages/ui/src/ask-arden/useArdenChat.ts) | **PASS (local integrated `b4c6ef0`):** Post-ownership PostgreSQL 17 (`graph.integration.test.ts` 505-publication case + `governed-answering.test.ts` + `ui-surface.integration.test.ts`) verified SQL-pushed narrowing, scoped hints/history, empty-intersection isolation, and `409` replay conflict; UI tests verified fresh retry key on basket change. | Paired staging rollout. |
| `F12-BR-AC3` | Graph navigation actions use `GraphIntentBus` on Web and Electron. An action from `AskArdenPage` opens Graph with the docked panel and the same Company conversation. `pin_to_context` updates the basket and shows a visible auto-dismissing Undo toast on both `/ask` and Graph/shell views. | [Action dispatcher](../../../packages/ui/src/ask-arden/surface/dispatch.ts), [Ask Arden](../../../packages/ui/src/ask-arden/AskArdenPage.tsx), and [shell](../../../packages/ui/src/app/ArdenShell.tsx) | **PASS (local integrated `b4c6ef0`):** `@arden/ui` (`689` passed) verified Web/Desktop thread preservation, `isolate_branch` facet clearing, visible `/ask` Undo toast + auto-dismiss timers, and `focus_nodes` without redundant refetch; signed-in Chromium and native Windows Electron 44 verified answer-to-Graph navigation and focus. | Live staging walkthrough after deployment. |
| `F12-BR-AC4` | `open_reader` dispatches via `openTarget` (`READER` with `blockId`/`page` anchor including page-only PDF scroll without an empty `<mark>` banner, `ADMIN_INSPECTION`, `RESPONSIBLE_VIEW`, `MY_CONTRIBUTIONS`); `workflow_handoff` opens shell-hosted human-confirmed `ReportIssueDialog`, Maintenance focus, or `Renewal` dialog (including non-Admin Responsible Reviewers per `ADR 0032` B3) with zero direct server mutations. | [Action dispatcher](../../../packages/ui/src/ask-arden/surface/dispatch.ts), [PDF reader](../../../packages/ui/src/knowledge/PdfReader.tsx), [governance dialog](../../../packages/ui/src/knowledge/GovernanceActionDialog.tsx), [queue](../../../packages/ui/src/maintenance/MaintenanceQueue.tsx), and [maintenance policy](../../../apps/api/src/maintenance/policy.ts) | **PASS (local integrated `b4c6ef0`):** Fixed `projectCase` in `apps/api/src/maintenance/policy.ts` to expose `documentId` on `kind: "queue"` rows only when `canReadDocument` is true (keeping unreadable rows redacted); `@arden/ui` verified page-only PDF scroll (guarded against resize re-scroll) and clean `Page N` banner; signed-in Chromium AND native Windows Electron 44 verified Admin exact-publication report, non-Admin Responsible Reviewer expired Responsible View, human-confirmed Renewal and Report cancel (zero DB writes), and focused `"Selected document"` Maintenance queue. | Live staging walkthrough after deployment. |
| `F12-BR-AC5` | Opening, closing, floating, or resizing `AgentPanel` (`320px`–`720px`) tracks the pointer at `0ms` without CSS transition lag while preserving Graph zoom, pan, selected node, filters, Context Basket, and chat transcript (`F12-AC1`); visiting `/private` and returning preserves the Company conversation thread. | [Shell](../../../packages/ui/src/app/ArdenShell.tsx), [resize handle](../../../packages/ui/src/app/AskPanelResizeHandle.tsx), and [Agent Panel](../../../packages/ui/src/app/AgentPanel.tsx) | **PASS (local integrated `b4c6ef0`):** `@arden/ui` verified `.is-context-resizing` disabling shell/panel width transitions during active pointer drag; signed-in Chromium verified pointer resize, floating panel, `Escape` focus restoration, and stable Graph camera; native Windows Electron 44 verified keyboard resize preserving viewport; shell tests verified Company thread preservation across Graph and Private. | Live staging walkthrough after deployment. |
| `F12-BR-AC6` | Electron validates Graph queries, mutation bodies and idempotency keys, routes renewal and Ask Arden calls, and applies the 2 MiB history limit and 120-second AI deadline. Graph reads can proceed during an AI request. A session change invalidates older queued work and actively aborts prior-epoch in-flight requests so `aiLock` releases immediately. | [IPC allowlist](../../../apps/desktop/src/main/apiRequestPolicy.test.ts) and [session and scheduler tests](../../../apps/desktop/src/main/index.test.ts) | **PASS (local integrated `b4c6ef0`):** `@arden/desktop` passed `45/45` tests (`4` suites) covering allowlist validation, concurrent read/AI lanes, session-change invalidation and immediate `AbortController` cancellation on stalled AI requests, conditional cookie replacement, and 2 MiB bounded reads; native Windows Electron 44 verified live Graph, lazy ELK, 23-turn IPC history paging, reviewer handoffs, and account switching clearing Monitor mode and previous chat. | Packaged Windows installer verification against staging. |

---

## 7. Out of Scope (Deferred to V2) & Open Questions

- **Deferred:** Persisting Context Basket across browser restarts in Postgres, multi-hop AI blast-radius triggers, Private Note graph pinning.
- **Resolved confirmation (2026-11-26):** Pinned branches render as compact summary chips in the Context Basket UI (e.g., `Engineering · 8 docs`) while transmitting explicit `documentIds[]` on the wire.
- **Open Questions:** None.
