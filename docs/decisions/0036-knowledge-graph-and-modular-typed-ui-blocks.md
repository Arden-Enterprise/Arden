# 0036: Knowledge Graph (`@xyflow/react`) and Modular Composable Typed UI Blocks

Status: accepted — specification `v1-accepted` approved 2026-11-26; local implementation available
Date: 2026-11-26
Decision owner/approval: requesting project maintainer (explicitly approved all 12 architecture/scope decisions across rounds 1–2 and approved the reconciled `v1` specification package plus the 3 final confirmations on 2026-11-26).
Brainstorm originator / record author: requesting project maintainer (tree-graph UX, ISO/IEC 38505-1:2026 governance alignment, A2UI-inspired modular block composability); record drafted and reconciled by coding agent.
Approval evidence and exact source/spec revision: maintainer approval of design rounds 1–2 (12 decisions) and final approval of reconciled `v1` specs + 3 operational confirmations (asynchronous PR consultation on Sigma.js replacement, `120_000 ms` main-owned Desktop `/ai/answers` timeout, published-only `GraphRelationshipDialog` + compact branch-summary basket chips) on 2026-11-26 against `Arden` `origin/staging` `fa4d6fe` and `Arden-AI` `origin/main` `af90033`.
Implementation: local integration branches (`Arden` `feat/graph-agent-v1-integration` on `staging` `b4c6ef0` adding migrations `0075`–`0077`; `Arden-AI` `feat/ui-surface-v3-integration` on `main` `5060291`). The [feature specifications](../features/graph-and-agent-ui/CAPABILITY-MAP.md) record observed verification and rollout gates.
Supersedes / superseded by: supersedes `Sigma.js + Graphology` in [technology-guide.md](../engineering/technology-guide.md#9-xyflowreact-d3-hierarchy-and-elkjs), [ARDEN_BLUEPRINT.md](../../ARDEN_BLUEPRINT.md) Section 3, and [implementation-status.md](../engineering/implementation-status.md); supersedes unpublished-draft `document_relationship` author-only RLS in migration `0027_document_category_relationships.sql`; resolves navigation gap `G4` in [docs/product/README.md](../product/README.md) while preserving [ADR 0022](0022-home-start-page-and-reader-validity.md) (`Home` as default landing page); extends [ADR 0021](0021-governed-hybrid-answering.md) / [ADR 0030](0030-published-date-ai-sources.md) with an additive `/v3/generations` surface endpoint and optional `scopeFilter` (without restoring retired `versionScope` modes or weakening Core authorization).

## Context and requirement

Arden requires two tightly coupled capabilities under `F12` (Graph and context, `ARD-50`) and `F13`/`F14` (Grounded agent and conversation history, `ARD-52`/`ARD-59`):

1. **Interactive Knowledge Graph (`F12`):** An enterprise tree-first knowledge map with deep multi-facet filtering, clear **ISO/IEC 38505-1:2026** (aligned with ISO/IEC 38500:2024 and ISO 37000) governance visibility across Clauses 7–8 (**11 governance principles** and **Engage stakeholders – Evaluate – Direct – Monitor**), explicit governed cross-document links, and a keyboard/screen-reader Outline alternative.
2. **Modular Interactive Agent Chat (`F13`/`F14`):** Rich, composable UI blocks inside the docked/floating `AgentPanel` and full `AskArdenPage` so structured answers can nest cards, tabs, collapsible sections, 2-up comparisons, governance accountability tables, document rows, and allowlisted graph/reader/maintenance actions—providing A2UI-style composability without surrendering Core authorization, deterministic PostgreSQL metadata hydration, OpenAI strict structured-output compatibility, or Electron 44 CSP/IPC stability.

Inspecting `origin/staging` (`fa4d6fe`) and `Arden-AI` (`af90033`) established six concrete baseline constraints:
- Live Arden removed Topics ([ADR 0027](0027-remove-knowledge-topics.md)), retired legacy Categories from submissions ([ADR 0020](0020-knowledge-management-catalog.md)), standardized on 5 controlled `KnowledgeType` values (while legacy publications may still hold `type: null` and legacy collections `allowedTypes: null`), and restricted Collections to single-level Organization-wide folders ([ADR 0026](0026-flat-organization-collection-placement.md)).
- `document_relationship` (`0027_document_category_relationships.sql`) currently has permissive author-only RLS (`document_relationship_author_read/insert/delete`) scoped to unpublished `shared_draft`s with no check on `target_document_id`. Adding new permissive policies without replacing `0027` would OR-combine them and leak targets.
- `GovernedAnswering` (`apps/api/src/answers/governed-answering.ts`) enforces strict exact-key-set parsing on `/v2/generations` (`governed-contracts.ts`), while `Arden-AI` uses `extra="forbid"` Pydantic models and OpenAI `with_structured_output(..., method="json_schema", strict=True)` (which forbids dynamic-key `Record<string, ...>` maps and `oneOf`). Therefore, `/v2/generations` cannot be mutated in place without breaking existing callers; an additive **`/v3/generations`** endpoint is required.
- `apps/desktop` (`Electron 44.4.3`) runs without URL routing (`file://`), uses a strict `script-src 'self'` CSP (blocking `blob:` Web Workers), serializes IPC calls through `requestQueue`, and enforces a `1 MiB` response ceiling on standard API routes.
- Maintenance case visibility (`0043`/`0060`, [ADR 0023](0023-organization-admin-governance-access.md) §5) hides reports from ordinary readers and excludes authors from reviewing cases on their own versions.
- Expired document reads (`app.ts:2055`) return `410 DOCUMENT_EXPIRED` for all callers including Authors and Reviewers, while audited inspection (`0037`) is Org-Admin-only and responsible-view (`0037`) is Responsible-Reviewer-only.

## Options and tradeoffs

### 1. Graph rendering stack

| Option | Tradeoffs | Decision |
| --- | --- | --- |
| **Sigma.js + Graphology (previous baseline)** | WebGL canvas optimized for 10k+ network hairballs; poor fit for interactive React Island cards, collapsible tree hierarchies, DOM accessibility, and WebGL-free Electron stability. | **Superseded** — see [DECISION-CHANGE-SIGMA-TO-XYFLOW.md](../features/graph-and-agent-ui/DECISION-CHANGE-SIGMA-TO-XYFLOW.md). |
| **Cytoscape.js + cytoscape-elk** | Strong graph algorithms, but canvas-rendered nodes fight Arden's React Island design system and require overlay hacks for interactive toolbars. | Rejected. |
| **`@xyflow/react` + `d3-hierarchy` / lazy `elkjs`** | MIT/ISC/EPL-2.0; real React Island node components, instant `d3-hierarchy` collapsible tree layout, on-demand lazy-loaded `elk.bundled.js` for bounded cross-link layered routing (no `blob:` Worker CSP violation), native keyboard/focus hooks, capped server-side at 500 docs + 1,000 edges. | **Accepted.** |

### 2. Agent interactive UI protocol & cross-repo wire evolution

| Option | Tradeoffs | Decision |
| --- | --- | --- |
| **Google `@a2ui/react` direct adoption** | Pre-1.0 package churn, streaming-first transport assumption fighting Electron JSON IPC, generic catalogs still needing a Core hydration/revocation firewall. | Rejected for direct dependency. |
| **Mutate `/v2/generations` in place** | Breaks existing Core (`parseGenerationResponse` exact key-set) and existing `Arden-AI` (`extra="forbid"`); lacks `publishedVersionId`/`documentId` handles in `Evidence`. | Rejected (caught in adversarial review). |
| **Arden-owned Flat Adjacency `UiSurface` v1 over additive `/v3/generations`** | Leaves `/v2/retrievals` and `/v2/generations` untouched for Reader/Private Q&A and older Core; passes opaque `sourceCatalog` handles (`D1..D8`) so the LLM never touches raw UUIDs; uses an OpenAI `strict=True`-compatible array of typed nodes normalized by Core into a flat adjacency map (`maxDepth: 4`, `maxNodes: 32`); enforces Core DB hydration, turn-level fail-closed revocation, and deterministic fallback. | **Accepted.** |

### 3. Navigation placement (`G4`)

| Option | Tradeoffs | Decision |
| --- | --- | --- |
| **Replace `Home` with `Graph` as default start page** | Supersedes [ADR 0022](0022-home-start-page-and-reader-validity.md) and slows daily table-scanning readers. | Rejected. |
| **Dedicated `/graph` route in `WORK` sidebar + `"View in Graph"` deep-links** | Keeps `Home` (`ADR 0022`) as default landing while giving Knowledge Graph a full-bleed workspace beside the dockable `AgentPanel`. | **Accepted.** |

## Decision

1. **Graph stack and route (`F12`, `G4`):** Adopt `@xyflow/react` + `d3-hierarchy` (primary tree) + lazy on-demand `elkjs/lib/elk.bundled.js` (bounded layered cross-links) on `/graph` in the `WORK` sidebar, preserving `Home` (`ADR 0022`) as default landing and adding `"View in Graph"` deep-links.
2. **ISO/IEC 38505-1:2026 hierarchy and Monitor Mode:**
   - Default **Accountability View:** `Organization → Owner Department → Controlled Document Type (5 values + Uncategorized legacy) → Published Documents`.
   - Alternate **Collections View:** `Organization → Organization Collection (+ Unassigned) → Organization-wide Documents`, with `Shared (Department / Selected Members / Legacy Audience)` rendered separately per [ADR 0026](0026-flat-organization-collection-placement.md).
   - Default to **Current Authorized Knowledge** for all roles ([ADR 0032](0032-expired-documents-renewal-and-home-columns.md)).
   - Provide an opt-in **Governance Monitor Mode** backed by a reviewed `SECURITY DEFINER` projection (`list_graph_monitor_documents`, registered in `deploy/release/security-definer-owner-repair.sql`) gated strictly to Accountable Roles (Authors for own current/expired docs, Responsible Reviewers via disjoint `0060` grants, Org Admins for metadata-only oversight) surfacing `Expiring ≤ 30d`, authorized `Open Maintenance Cases` (`null` when caller lacks `0043`/`0060` visibility), `Unassigned Org Doc`, optional `Expired` toggle, and an explicit discriminated `openTarget` (`READER | RESPONSIBLE_VIEW | ADMIN_INSPECTION | MY_CONTRIBUTIONS`).
   - Exclude Private Notes and unreviewed direct shares ([ADR 0034](0034-share-button-direct-share-and-private-pdf.md)) strictly from the Company Knowledge Graph.
3. **Governed `document_relationship` edges (`V1`):** Replace `0027`'s three permissive author-only draft policies (`DROP POLICY`) with strict published-document policies: dual-endpoint readable `SELECT`, Author/Org-Admin-with-dual-read `INSERT` (re-deriving Org Admin from `role_assignment` in DB and binding `created_by_membership_id` to actor membership), Author (own current/expired published source) or Org-Admin-with-source-read `DELETE` (preventing undeletable ghost edges when targets expire/restrict while blocking non-reader Org Admins from probing/deleting restricted sources), advisory-locked `SUPERSEDES` acyclicity & symmetric `RELATED` deduplication, append-only `document_relationship_idempotency` ledger (`409 IDEMPOTENCY_CONFLICT`), uniform `404 RESOURCE_NOT_AVAILABLE` on missing/unreadable targets, `POST .../relationships` and `POST .../remove` routes, and `DOCUMENT_RELATIONSHIP_CREATED` / `DOCUMENT_RELATIONSHIP_DELETED` audit events (`ADR 0035`).
4. **Modular Composable `UiSurface` v1 over additive `/v3/generations`:**
   - Represent Core/UI surfaces as a **Flat Adjacency `UiSurface`** (`{ schemaVersion: 1, rootId, nodes, bindings }`) strictly bounded to an acyclic tree with **0-based `maxDepth <= 4`**, `maxNodes <= 32`, compact payload `<= 48_000` bytes (with Postgres `<= 65_536` `jsonb::text` check), ancestor-invariant container bans, and prototype-key denylist.
   - Lock V1 primitives to **6 Containers** (`stack`, `row`, `card`, `section`, `tabs`, `split`), **7 Leaves** (`prose`, `document_item`, `governance_kv`, `comparison_table`, `callout`, `metric_strip`, `lineage_tree`), and **4 Allowlisted Actions** (`graph_action`, `open_reader`, `workflow_handoff`, `prompt_chip` — prefill+focus only).
   - Add **`Arden-AI /v3/generations`** (`answer-v3.schema.json`, `PUBLISHED_CHAT` only) accepting opaque `sourceCatalog` handles (`D1..D8`) and emitting OpenAI `strict=True`-compatible array-encoded surface nodes; invalid LLM surfaces degrade safely inside both `Arden-AI` and Core to deterministic fallback without failing text delivery; `INSUFFICIENT_EVIDENCE` rejects LLM surfaces and renders Core's deterministic gap callout.
   - Persist validated unhydrated `BoundUiSurface` in `ai_conversation_turn.ui_surface` alongside `scope_filter_hash` and normalized **`ai_turn_surface_binding`** rows (`FORCE RLS`). Revalidate exact evidence and bindings across history load, answer replay, context and append. Recheck again after live hydration before returning history, replay or a new answer. Both chat views page earlier turns through the owner-private API. Core bounds each page, including deduplicated `hydratedDocuments`, to 2 MiB (`F14-UI-AC1` and `F14-UI-AC2`).
5. **Context Basket (`F12-AC3`), Unified Shell Chat, & Scale Caps:** Pin up to **50 authorized documents** pushed down into SQL `listAuthorizedAiSources(..., scopeDocumentIds)` before `LIMIT 501`, scoping `sourceHints` and `context.history` identically. Unify Company `useArdenChat` at `ArdenShell`, support platform-agnostic `GraphIntentBus` for Web + Electron, separate AI calls from Graph/Reader reads in Electron's IPC queue, and cap Graph payloads at **500 docs** + **1,000 relationships**.
6. **V2 Deferrals:** SSE progressive `UiSurface` streaming (and Electron streaming IPC), automated multi-hop AI blast-radius simulation, Private Notes graph, external connector nodes (`F16`/`F17`), and Web nginx CSP rollout (tracked as separate hardening).

## Boundaries and consequences

- **Data & policy ownership:** Arden Core (`apps/api` + PostgreSQL `FORCE RLS`) remains the sole owner of access checks, dual-endpoint edge filtering, governance hydration, conversation persistence, and revocation rechecks. `Arden-AI` never receives DB credentials or raw PostgreSQL UUIDs for surface construction.
- Operator migrations 0075–0077 have recorded hashes and expand the trusted `arden` owner repair inventory from 57 to 63 routines. The three isolated `arden_system` routines retain their bootstrap owner. The relationship fixture uses published endpoints. [Plan](../features/graph-and-agent-ui/PLAN.md)
- Electron main enforces route and body allowlists, a 120-second Ask Arden deadline and the 2 MiB conversation-detail limit. The concurrent UI and AI lanes discard requests and results from prior sessions and serialize credential changes. [Desktop policy](../../apps/desktop/src/main/apiRequestPolicy.ts) · [Session delivery](../../apps/desktop/src/main/desktopApi.ts)
- **Audit boundary ([ADR 0035](0035-audit-only-consequential-actions.md)):** Audit only `DOCUMENT_RELATIONSHIP_CREATED` and `DOCUMENT_RELATIONSHIP_DELETED` (IDs + type only).
- **Private team knowledge parity:** Synchronize a sanitized decision record and daily worklog to the team's private knowledge repository when this branch is authorized for publication/merge.

## Verification and rollout

- The 2026-11-27 integrated branches (`Arden` `e711bdd` + `0075`–`0077`; `Arden-AI` `75d11d1`) passed two-axis (`Standards` + `Spec`) review, pre-merge Tier 1 + PR review hardening, and full local verification: `pnpm migrations:check` (`77` entries, fingerprint `611e5a74c5f01f1e3e992eb66b083f7f619143e92dfae86930e04d9028f2e6fb`), `pnpm -r typecheck`, `pnpm -r build`, `pnpm test:remote` (`16/16`), `@arden/domain` (`53/53`), `@arden/desktop` (`45/45`), `@arden/ui` (`694/694`), post-ownership PostgreSQL 17 `@arden/api` (`63` trusted `arden` routines + `3` isolated `arden_system` routines), `Arden-AI` (`230` pytest + `ruff` + `mypy` + synthetic live strict-schema acceptance), and signed-in Chromium + native Windows Electron 44 walkthroughs covering empty Graph, stress (`500` docs / `1,000` edges), tooltips/motion, `23`-turn history cursor, role-scoped governance handoffs, and native account switching. [Graph evidence](../features/graph-and-agent-ui/SPEC-knowledge-graph.md#8-acceptance--evidence-matrix) · [Typed UI evidence](../features/graph-and-agent-ui/SPEC-typed-chat-ui-blocks.md#7-acceptance--evidence-matrix) · [Bridge evidence](../features/graph-and-agent-ui/SPEC-graph-agent-bridge.md#6-acceptance--evidence-matrix)
- Remaining gates require separate authorization: commit/push/PR review, deploying additive `Arden-AI /v3/generations` to staging, staging DB backup + rehearsal + apply of `0075`–`0077` preserving the `63` trusted routine owners, Core staging rollout, packaged Windows Electron check, and live staging walkthrough.
- **Rollout order:** Deploy additive `Arden-AI /v3/generations` first (zero impact on `/v2/generations` callers) → rehearse and apply operator migrations with backup & ownership-repair inventory check → deploy matching `Arden` API/Web/Desktop (`ARDEN_AI_UI_SURFACE_V3=false` keeps Core generation on v2 if needed).

## Rules and documentation updates

- [GLOSSARY.md](../../GLOSSARY.md) — added canonical Knowledge Graph and Modular Agent UI domain language.
- [DECISION-CHANGE-SIGMA-TO-XYFLOW.md](../features/graph-and-agent-ui/DECISION-CHANGE-SIGMA-TO-XYFLOW.md) — formal Sigma.js replacement record.
- [technology-guide.md](../engineering/technology-guide.md) (Sections 1 & 9), [ARDEN_BLUEPRINT.md](../../ARDEN_BLUEPRINT.md) (Section 3), and [implementation-status.md](../engineering/implementation-status.md) — updated live graph stack references to `@xyflow/react + d3-hierarchy / elkjs` (`ADR 0036`, planned).
- [CAPABILITY-MAP.md](../features/graph-and-agent-ui/CAPABILITY-MAP.md) & per-module specs (`SPEC-knowledge-graph.md`, `SPEC-typed-chat-ui-blocks.md`, `SPEC-graph-agent-bridge.md`).
- [Flow 3 Graph & Agent diagrams](../product/flows/flow-3-graph-and-agent.md) and [flows/README.md](../product/flows/README.md).

## References

- ISO/IEC 38505-1:2026 (*Information technology — Governance of data — Part 1: Application of ISO/IEC 38500 to the governance of data*), <https://www.iso.org/standard/87195.html>; aligned with ISO/IEC 38500:2024 and ISO 37000:2021
- Existing Arden decisions: [0020](0020-knowledge-management-catalog.md), [0021](0021-governed-hybrid-answering.md), [0022](0022-home-start-page-and-reader-validity.md), [0023](0023-organization-admin-governance-access.md), [0026](0026-flat-organization-collection-placement.md), [0027](0027-remove-knowledge-topics.md), [0030](0030-published-date-ai-sources.md), [0032](0032-expired-documents-renewal-and-home-columns.md), [0034](0034-share-button-direct-share-and-private-pdf.md), [0035](0035-audit-only-consequential-actions.md)
- OWASP Top 10 for LLM Applications (2025): <https://genai.owasp.org/llm-top-10/>
- OpenAI Structured Outputs (`strict: true`): <https://platform.openai.com/docs/guides/structured-outputs>
- React Flow (`@xyflow/react`): <https://reactflow.dev/>; `d3-hierarchy`: <https://d3js.org/d3-hierarchy>; `elkjs`: <https://github.com/kieler/elkjs>
