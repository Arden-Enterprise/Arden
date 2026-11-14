# Reader AI — next implementation slice

Status: RA-02/RA-03 backend, RA-04 Summary reader UI/adapters and RA-05 stateless
Ask this document are implemented locally; RA-05 verification is recorded below.
RA-04 browser, boundary and regression checks pass; genuine Electron interaction
and signed-in paired-service acceptance remain unverified. The maintainer explicitly
approved local RA-05 development with those two checks retained before release.
Paid/provider quality, integration and deployment are separate gates.
Staging-test refinement, 14 November: the maintainer subsequently requested a
paired staging rollout to perform signed-in E2E testing and explicitly approved
backup, isolated restore rehearsal and the forward-only operator migration 0032.
Unrun native, signed-in and provider-quality checks remain acceptance gaps, not
passed tests; this staging test deployment does not authorize production promotion
or additional paid evaluation. Migration 0032 renumbers only unpublished local SQL,
preserving staging's existing reviewer-grant migration 0031 and its checksum.
The staging integration is based on `5bd752c` (including PR #42), not the old
local `a07f575` checkout. Identity/password/invitation/draft changes are retained.
Native reader deadlines remain main-owned, while other routes keep PR #42's
validated renderer deadline; timers are cleared on success/failure. A dedicated
integration regression covers both contracts. The full 32-migration inventory
retains the original 0031 bytes and operator-only classification for 0032.
The maintainer requested continuation
after the basic citation fix on 14 November 2026. This follows the accepted
reader-on-request Summary, Ask this document and Explain selection behavior, not
an upload summary or another knowledge-management UI redesign. Track Reader AI in
ARD-79 under the existing ARD-52 grounded-assistant work; do not infer completion
from this plan.

Execution refinement, 14 November: the maintainer explicitly requested small,
sequential subtasks with verification before proceeding. The maintainer originated
the delivery constraint and owns the decision; Codex records the technical breakdown.
This does not approve publication, deployment, additional provider spend or a change
to the established reader policy. Starting local dependencies: Core staging
`a07f5757ba794c17b38bbbf6970c66df33abfb15`, fetched main
`9fa3d34a19a559318eff87b4487f2113e6ee5a49`; AI main
`cc0b4d2cf042be4d54c92abecd90f8ac7c1da3ec`, both with preserved uncommitted
governed-hybrid changes. Those dependencies are not yet a released baseline.

## Sequential subtasks and exit gates

RA-01 through RA-07 are delivery checkpoints within F13, not new report FR/UC IDs.
Maintain their actual completion in Linear and the dated handoff. Start one at a
time. Passing an earlier gate does not certify a later user-visible flow.

| Subtask | Reviewable result | Gate before the next subtask |
| --- | --- | --- |
| RA-01 — Scope and verification design | Source/caller inventory, ordered work, accepted boundaries and cross-layer test matrix in this document. No app code. | Inspect both repositories, reconcile existing policy, check links/status and record the remaining integration contracts. |
| RA-02 — Exact-version source contract and authorization | Additive paired reader-purpose schemas/fixtures; Core source resolution and complete canonical coverage validation before provider access. | Contract parity and disposable-runtime tests reject foreign organization/version, missing/forged chunks/hashes, stale membership and capability-only read bypass. Existing chat/index contracts remain compatible. |
| RA-03 — Summary backend | Bounded whole-text Summary generation, source provenance, deterministic quote checks and final authorization. No UI yet. | Fake-provider HTTP/application tests prove complete supported-source coverage, explicit size/text failure, malformed output handling and no result after revocation. Lock batch/token/output budgets before code; never silent top-k truncation. |
| RA-04 — Summary in the reader | On-request Summary, AI-generated label, citations, loading/error/Retry/Close and version-safe state in shared UI/adapters. | End-to-end reader-to-backend tests, web/desktop adapter checks and actual visual/interaction inspection; changing document/version or losing access cannot display the old result. Local gates precede Q&A; the maintainer's 14 November refinement retains genuine-native/signed-in paired checks before release. |
| RA-05 — Ask this document | Question/answer restricted to the open exact version with citations and insufficient-evidence behavior. | Adversarial and follow-up tests cannot import other documents, general chat history or knowledge from outside the supplied source; current access and source navigation are rechecked. |
| RA-06 — Explain selection | Server-resolved selected passage, explicitly bounded same-document context, grounded explanation and navigation. | Forged text/ranges, stale version, disjoint/unsupported PDF selection and revocation fail safely; no fallback to unrelated evidence. Verify supported PDF/text selection paths honestly. |
| RA-07 — Integrated acceptance and release preparation | Reproducible synthetic end-to-end matrix, quality review, regression evidence and paired rollout/recovery checklist. | No unresolved required acceptance cases; paid/provider and signed-in checks are separately authorized and reported. CI/PR/migration/deployment are distinct from local completion and retain their authorization gates. |

Per-subtask closeout: inspect the task-owned diff, run the applicable checks, map
every acceptance case to evidence or a remaining gap, and update Linear/Knowledge.
Do not start the next implementation slice while its prerequisite fails. Fix
regressions in that slice first; do not hide them by deferring required tests to
RA-07. In particular, authorization and citation validation accompany the first
backend slice, not a final security-hardening step. Report progress between slices;
ask again only for a material product/security choice or new external authority.

Historical RA-01 checkpoint: source inventory and acceptance planning were recorded and checked
locally. No Reader AI schema, endpoint, provider path, UI or cache is implemented.
The next implementation unit is RA-02 only. Its paired schema/purpose, supported
source assembly and concrete request limits were prerequisites for RA-03. The
RA-02 implementation/evidence below now supersedes that source-only planning gap.

## RA-02 source preparation contract (implementation specification)

Additive internal `POST /v1/reader-sources` accepts `contractVersion: 1`, purpose
`READER_SUMMARY`, request/publication IDs and the existing validated immutable
index-snapshot input. Core resolves every snapshot/job/source ID itself; client
text/URLs are not accepted. This operation recompiles the exact snapshot using the
existing compiler/chunker without calling a model, embedding or index store.

Return the complete canonical Markdown plus its hash/compiler/chunking identity
and all ordered manifest chunks with original text. Initial bounds: 200,000 Unicode
codepoints of canonical Markdown, 256 chunks, 16,000 codepoints per chunk and 400,000
aggregate chunk codepoints including overlaps. These are preparation safety limits,
not model-context guarantees. Each chunk has at most 100 source block IDs, using
the existing ASCII block-ID grammar (1–128 characters); the Core HTTP adapter bounds
the complete reader response at 8 MiB. Existing chat response limits stay unchanged.
Oversize/empty/unextractable sources fail explicitly;
RA-03 must additionally enforce token/call/output budgets before any provider call.

Core compares the returned canonical hash and exact ordered chunk inventory against
the stored ready manifest, verifies every chunk hash/range against returned Markdown,
and retains headings in the full text. Chunk overlap is valid; omission/reordering,
substitution, changed compiler identity or source hash is not. Older incompatible
compiler outputs are unavailable, never automatically re-indexed by this operation.

Resolve only the exact requested currently applicable or announced publication in
the existing `COMPARE` eligibility pool, under runtime RLS and current Target Readers.
This uses the pool as an eligibility check, not a request to compare/switch versions.
Expired/withdrawn/superseded ineligible evidence remains unavailable for AI; the human
file-reader path is not broadened or narrowed. Reauthorize before snapshot transfer
and after preparation. Do not expose this internal full-text payload through a public
browser endpoint. No shared DB migration, provider/runtime factory, cache or model
configuration is needed by RA-02.

### RA-02 local verification checkpoint

The internal source endpoint and paired schema/golden fixture, Core runtime-RLS
source store, source-preparation use case and bounded HTTP adapter are implemented.
No public browser route or model call is wired. Snapshot bytes are read with their
immutable hash, permission/identity is rechecked before transfer and after source
preparation, and Core compares full Markdown and ordered evidence to its stored
manifest. A changed compiler/chunker inventory fails closed instead of re-indexing.

- AI: 107 tests, Ruff and strict mypy (30 modules) pass. The 18 new source tests
  cover actual canonical compilation, more than eight sections, request/response
  validation, whole inventory, overlap, Unicode, explicit bounds and internal HTTP
  authorization without instantiating provider/indexing factories.
- Core: 33 focused reader/client tests pass; real disposable PostgreSQL verification
  passes all ten registered integration cases, including exact applicable/upcoming
  resolution, missing/foreign organizations, denied Org Admin, selected readers,
  superseded/expired/withdrawn sources and suspended membership. Runtime tests use
  the restricted DDL-owner setup with 23 trusted SECURITY DEFINER executors intact.
- Root typecheck/test/remote/build checks pass at the main verification checkpoint;
  focused API tests/typecheck cover the final reader-bound/adapter refinements.
  Existing jsdom canvas/scroll and bundle-size warnings are not browser acceptance.

No dependency/model change, shared migration/index/write or extra provider cost.
The guarded source store depends on the existing local GA-v2/0031 baseline; release
of that baseline remains separate. RA-03, not another source subsystem, consumes
this validated full-text result next and must define token/output/call bounds.

## RA-03 Summary backend — implementation specification

The maintainer authorized RA-03 implementation after the verified source gate.
Add authenticated internal `POST /v1/reader-summaries` with a validated RA-02 source,
and authenticated Core `POST /api/v1/organizations/:organizationId/knowledge/published/:publishedVersionId/summary`.
The browser request accepts only an optional UUID request ID, never content, prompts,
chunk IDs or a wider audience. Core prepares/reauthorizes that exact source before
dispatch and reauthorizes again before returning any output. No persistence/cache,
chat append, UI, indexing or permission write is introduced.

Plan every canonical codepoint before the first model call: contiguous primary
windows of at most 6,000 codepoints / 2,000 local `o200k_base` tokens, with up to 256
neighboring context codepoints on each side. At most eight windows; reject larger
plans before calling a model, never truncate. Each complete serialized prompt has
an 8,000-local-token envelope including a 2,000-token schema/framing reserve.
Local counts are guardrails, not an exact provider billing/context guarantee.

Each window yields at most three source-cited points, at most 350 codepoints each,
categorized as Key point, Step, Condition or Exception. Validate unique literal
quotes (whitespace-only recovery allowed) within both supplied source slices and
their original indexed chunks. Unknown evidence IDs, disjoint/changed quotations,
schema errors, refusal, timeout or incomplete output never become a partial success.
At most one identical-input output repair per window; no automatic transport retry.

The first implementation uses **deterministic synthesis**: collect all validated
points in document order, deduplicate only identical kind/text/citation records,
and retain their original citations. It adds no second free-form model rewrite that
could detach conditions/exceptions from evidence. This is a source-bound summary
outline, not a guarantee of semantic completeness or an approved document substitute.
No source window may be silently dropped, including one yielding no usable points.

Use the configured `gpt-6-luna` / high model unchanged, `store=false`, no tools or
provider conversation. Cap each call at 4,096 output tokens including reasoning,
45-second timeout, two concurrent windows and a 180-second whole-operation deadline.
Worst case: eight windows × two attempts = 16 calls and 65,536 output-token allowance;
this is a ceiling, not a per-request USD charge. Core transport timeout is 200 seconds
for Summary only; existing chat limits stay unchanged. Per Core process permit one
active Summary per actor/organization, at most eight total, with bounded expiry
bookkeeping. The 14 November reliability refinement below replaces the original
cross-document 60-second cooldown. This is not a distributed quota.

Core verifies echoed identities, contiguous full-source coverage, all supplied
chunk IDs (including uncited inputs), point bounds and original-source quotations.
Public results contain concise points and navigable exact-version citations, not
raw source/coverage/debug payloads. Revocation after dispatch withholds results;
already transmitted provider inputs cannot be recalled. Denied/missing stays 404;
unsupported size/text, busy/rate-limited and failed generation have safe distinct
responses. Paid quality/browser acceptance remains a separately authorized gate.

Official implementation references: [Responses output ceiling](https://developers.openai.com/api/reference/resources/responses/methods/create)
and [Structured Outputs content-error handling](https://developers.openai.com/api/docs/guides/structured-outputs).
Strict schema/quotes do not prove factual entailment. RA-03 tests use fake providers;
no new provider calls are authorized by this implementation task.

### RA-03 local implementation and exit evidence

The paired internal Summary route, bounded section planner/generator, deterministic
synthesis and Core public Summary broker/route are wired. Core admits generation
only after exact-source read authorization; it checks again before model dispatch
and before returning the result. Unknown browser fields are rejected. The complete
source never becomes a browser response, model output never supplies title/version/
page permissions, and Summary writes neither chat history nor metadata/index data.
Missing/denied remains 404 even if the actor has an existing generation cooldown.

The operation keeps the established model/effort, with Summary-only output/time
limits. Structured parser/quotation failures get at most one same-input repair;
transport errors do not retry. A failed window closes admission before releasing
its concurrency slot, cancels/awaits siblings and withholds the entire result.
Neighbor-only quotes cannot stand in for summarizing a primary passage. A recovered
quote must still satisfy the original-source length bound. Input coverage is not a
semantic-completeness or factual-entailment guarantee.

| RA-03 acceptance | Implemented boundary and observed evidence |
| --- | --- |
| RA-03-A — Supported whole source | AI multi-window Unicode/tail and concurrency tests cover contiguous text, headings in context and the entire chunk inventory; blank/oversize/token-heavy/overlap-heavy plans fail before model calls. No top-k retrieval. |
| RA-03-B — Grounded output | AI/Core tests reject changed, repeated, missing and unknown quotations/identities, partial coverage and missing inputs. Whitespace recovery returns raw text; Core independently checks literal unique spans and derives codepoint/page navigation. Paired Summary fixture and exported schema validate. |
| RA-03-C — Failures and bounded work | Fake-provider malformed output, parser repair, transport failure, timeout and sibling-cancellation tests pass. Core tests admission/cooldown/release, immutable validation input, unsupported/unavailable mapping and authenticated/no-store/closed-body HTTP. |
| RA-03-D — Final authorization | Core source tests and real disposable-runtime PostgreSQL Summary case withhold valid output after membership revocation during fake generation. Unchanged private chat history is verified. Existing temporal/reader/RLS cases also pass. |
| RA-03-E — Compatibility/handoff | Final AI suite: 129 passed, Ruff and strict mypy (33 modules). Core root typecheck/test/build: API 331 passed/26 gated skips, UI 221, Domain 9, desktop 10. Final API suite/typecheck/build after the strict-kind guard: 332 passed/26 gated skips. Focused source/Summary/client 81 passed at the preceding checkpoint; remote 16 passed. Eleven real PostgreSQL cases pass, including the new Summary case. No UI/browser/provider-quality claim. |

RA-03 uses the existing local GA-v2/0031 source baseline, not a new migration. For
an authorized future rollout, deploy the additive AI routes before the Core caller;
an old/missing AI route fails unavailable rather than falling back to chat. No new
environment variable, model, dependency, storage or index format is needed. Removing
this additive caller/route does not require data rollback; there is no Summary cache.
The process-local quota resets on process restart and does not coordinate replicas.

### Summary reliability refinement — accepted 14 November 2026

The maintainer approved the diagnosed reliability fixes after comparing the old
cross-document cooldown and immediate Retry behavior. This supersedes that admission
detail only, not source authorization, citation validation, model budgets or Q&A.

- Keep one active Summary per actor/organization and eight per Core process. Apply
  the 60-second dispatch cooldown to the exact actor/organization/publication, not
  other documents. Unsupported preflight does not consume generation cooldown.
- Join an in-flight request only for the same actor, organization and exact
  publication; independently revalidate its frozen source before each disclosure.
  Echo each caller's request ID. Discard the entry at settlement: no completed,
  shared or durable Summary cache, new DB job or provider-cancellation guarantee.
- Report cooldown, another active operation and capacity separately. Cooldown uses
  its remaining seconds; active/capacity provide a short retry suggestion, not a
  promise of completion. UI waits before enabling manual Retry; never auto-generate.
- Temporary missing/stale source, provider busy, timeout and invalid output have
  safe distinct codes. Unsupported text/size stays non-retryable; permission denial
  stays opaque. Older service failures retain a safe unavailable fallback.
- Emit bounded metadata only: operation/HTTP request ID, stage, safe code, duration
  and admission reason. No source text, prompt, token, raw exception or actor data.
  Bounded container retention must be enabled separately on an authorized rollout;
  local logging changes do not establish live observability.

Acceptance SR-1–SR-5 respectively covers per-document admission, same-source joining
and revocation, HTTP/client failure parity, manual countdown/Close/panel lifecycle,
and sanitized bounded diagnostics. Verify offline first; real provider/native and
authorized staging rollout remain separate gates. No model/dependency/DB change.

Next is **RA-04 only**: shared reader Summary control/panel and typed web/desktop
adapters, version-safe state, citations, concise AI label, loading/Retry/Close and
actual interaction checks. Fresh paid quality evaluation needs separate authority;
the completed retrieval experiment budget is not a Summary spending approval.
Validate browser/desktop and reverse-proxy read deadlines before enabling the UI;
the Core-to-AI timeout alone does not prove an end-to-end deployment deadline.
Multi-block citations retain their exact canonical range and a section anchor;
ambiguous multi-page mappings do not invent a specific page. Reader mapping must
respect those limits rather than highlight an unrelated first block/page.
No commit/push/PR, shared migration/index change or deployment occurred here.

## Boundary and delivery order

### RA-04 reader integration specification — 14 November

The maintainer authorized the next sequential slice after RA-03. Keep the existing
Island reader and add one Summary action to its viewer bar, with an inline expandable
panel above the source. Preserve document information, Back, download and the PDF/text
surface. No Library redesign or Summary generation at upload/open. Show Summary,
AI-generated, concise grouped points, source buttons, loading, checking access,
unsupported/denied/failure, manual Retry and visible Close. Escape closes the panel;
focus returns to Summary. Render generated strings as text, not model HTML/Markdown.

Bind ephemeral state to platform/organization/document/publication/content hash and
the active reader. Changing any identity, leaving the reader or closing discards it
and ignores late replies. No browser storage/history/cache. Validate public response
IDs, bounds and citations before display; do not trust a typed HTTP cast. Browser
and native use only the exact scoped Summary routes and fixed bounded deadlines.

Add bodyless authenticated GET on the publication's `summary/access` subresource,
using RA-02's existing runtime-RLS exact-source gate. It returns only document/version/
content-hash identity, calls no model and does not expose source payloads. Recheck
before revealing a completed panel after window focus/visibility return and before
source navigation. Withhold points during checks and after failed/denied checks;
known access loss also closes the human document in the parent. Revalidation failure
never starts another generation automatically. Unseen remote revocation cannot recall
content already delivered; no new notification/polling system is implied.

#### RA-04/05 refinement: switching panels is not Close (accepted 14 November 2026)

Originator and decision owner: requesting project maintainer; record author: implementation
agent. The maintainer explicitly approved retaining Summary and document Q&A when switching
between them during the same exact-version reader session, and authorized staging delivery.
This supersedes the earlier RA-05 switch-discards-question behavior, not explicit Close or
the reauthorization rules above. No teammate consultation is claimed.

- Summary and Q&A are mutually exclusive **visible panels**, with separate ephemeral results.
  Switching hides the other panel without discarding its question, result or in-flight request.
  Returning never automatically generates again; a retained result is withheld until the
  existing no-model access probe succeeds. An in-flight response completed while hidden is
  similarly withheld. Only the visible panel checks access on window return.
- Explicit Close/Escape (or toggling the already-open action off) cancels local waiting and
  discards that panel, leaving the other panel's hidden state intact. Context change, leaving
  the reader, inactive session and unmount still discard both. Retention is limited to this
  mounted reader, not localStorage, a multi-document cache or persisted history.
- Focus/visibility notifications for one suspension trigger one access check, even if focus
  arrives after a visible-event check has completed. Blur/return remains fail-closed; this
  refinement does not introduce a grace period for revoked readers or suppress checks at
  citation navigation. Failed checks never regenerate; denial closes the parent reader.

Acceptance: round trips call generation once per operation; delayed hidden responses do not
leak; explicit Close and context changes clear the intended state; denied/offline revalidation
withholds retained output; duplicate return events do not double-check. Regression cases live
in `packages/ui/tests/readerSummary.test.tsx` and `readerQuestion.test.tsx`.

Context reset must clear rendered state, not only the retained-result reference. Returning
from another version or an inactive reader to the original identity must not resurrect
the old result. The first explicit Summary click in the new session starts a fresh request;
mere context reactivation never generates automatically. Round-trip identity regressions
cover both active → inactive → active and version A → B → A.

Citation navigation stays in the open exact version, displays the original excerpt,
uses the trusted source block/section anchor and PDF page when unambiguous. Do not
claim precise PDF text highlighting with the browser-native PDF viewer; its supported
behavior is page navigation plus the cited-passage highlight above the source.
Client wait is bounded at 300 seconds (source preparation plus generation); native
main derives that deadline from the fixed route, not renderer-selected arbitrary
timeouts. Close invalidates local waiting and does not promise provider cancellation.

Acceptance RA-04-A: strict web/native adapters, closed request/response shapes and
allow-list/method/query/body confusion tests. RA-04-B: user-triggered panel, all
states, manual retry, Escape/focus, source navigation and safe text rendering tests.
RA-04-C: context switch/unmount/close and revalidation/denial/late-result tests.
RA-04-D: actual local component/layout/interaction inspection plus root regression;
report genuine Electron versus mocked bridge/browser evidence separately.

Freshness: Core main is unchanged at `9fa3d34`, but staging advanced to `5bd752c`
(identity/invitation/review PR #42). This dirty dependent feature checkout stays at
`a07f575` with prior work preserved; do not merge/reset it as a UI step. PR #42 adds
saved-draft history and generic invitation timeouts, not this published Summary.
The existing local GA-v2 migration 0031 now collides with staging's reviewer-grant
0031. Resolve numbering/checksums and paired integration before any release; no
migration, rebase, shared data/provider write or deployment is part of RA-04.

1. Summary of the exact published version currently open in the reader.
2. Ask this document, with no implicit retrieval from other documents.
3. Explain selection, resolving the selected source location server-side.

Text only. Scanned PDFs, diagrams and images remain a limitation; no OCR/vision
claim. Generated output neither edits the original nor approves/publishes it.
Upcoming published content may be read and summarized by an authorized reader;
do not silently replace the open version with Ask Arden's current-applicable default.

## Source ownership and initial gaps — historical RA-01 inventory

- `apps/api/src/app.ts` and `db/repository.ts:getPublishedKnowledge` own the current
  authorized published-reader path. Client document IDs/text are not proof of access.
- `db/repository.ts:listAuthorizedAiSources` and `answers/governed-answering.ts`
  own the existing manifest and pre/post-model checks. Their version-scope semantics
  are for Ask Arden, not a substitute for a reader-purpose source decision.
- `KnowledgeDocumentDetail` is rendered by `ServerKnowledgeFeaturePage` in the
  shared UI. Its metadata summary string is not an AI-generation integration.
- AI v2 currently accepts `PUBLISHED_CHAT` only and at most eight evidence chunks.
  A dedicated paired reader-purpose contract was required before wiring a route;
  RA-02–RA-05 below/above supersede these initial implementation gaps.
  Do not reuse top-k retrieval and label its output a full-document summary.

## Summary-first acceptance and implementation tasks

Core resolves the exact organization/publication/snapshot/generation and content
hash under the current actor. Require ready, complete text evidence. Authorization
must match the reader entitlement for that exact version, not merely Reviewer or
Org Admin capability. Missing and denied objects remain indistinguishable.

Enumerate the complete canonical text coverage for that version and validate every
chunk/span against its manifest before sending it to AI. A small source may use one
bounded call. Longer sources need bounded section batches followed by synthesis
with original-source provenance, or a clear unsupported-size response. Never drop
tail sections silently, claim image coverage, or use summaries as source quotes.
Resolve batching/token/output limits in the paired contract and test the boundaries
before enabling longer documents. Coverage does not guarantee semantic completeness.

Reuse deterministic literal-span recovery and the bounded output-repair policy.
All source evidence, including uncited inputs and intermediate derivations, remains
bound to the exact version. Revalidate current reader access/source availability
after model work and immediately before returning the result. Switching versions
or revocation must not deliver a stale result into the new reader context.

If caching is introduced, key by operation/version/hash/generation and generation
configuration, not document ID alone. Reauthorize every result read, including
cache hits; never treat a cache entry as a permission grant. Do not persist Summary
into uploaded metadata or automatically append it to the user's general chat.

Expose on-request generation with concise AI-generated labeling, original-source
navigation, loading, unavailable/unsupported, failure, Retry and Close/Cancel paths.
Dismissal must not claim that an in-flight provider call/cost has stopped. Coordinate
the minimal reader integration with the separate UI redesign rather than redesigning
the Library in this task.

Required tests: whole-document multi-section coverage and bounds; exact-version
switch; injected document instructions; no cross-document evidence; forged/stale
source IDs; access revoked before/after generation or on cache hit; unavailable
index/text; malformed output; source navigation; Retry/Close and shared web/desktop
adapter parity. Fake providers/disposable data are the default. Fresh paid evals,
shared DB/index writes, publication and deployment retain their separate gates.

## Cross-layer acceptance matrix

The matrix assigns early checks as well as final integration; it is not a passing
test report. Reuse F13 source/citation requirements rather than replacing them.

| Case | First required gate | Observable outcome |
| --- | --- | --- |
| Exact open version, including an authorized upcoming publication | RA-02, repeated RA-04 | Source/output identity matches the reader, not a silently selected current-applicable version. |
| Cross-organization, denied reader, suspended member or reviewer/admin without readership | RA-02, repeated RA-07 | No source text sent to model; missing/denied responses do not disclose metadata. |
| Missing/reordered/duplicated/forged chunks or changed snapshot/hash | RA-02 | Validate against authoritative ordered coverage, allow documented chunk overlap and reject incomplete or inconsistent evidence before generation. |
| Short versus long, multi-section text; absent text or unsupported size | RA-03 | All supported canonical text is processed; omitted text is not reported as a full summary; unsupported cases do not fabricate output. |
| PDF wrapping, Unicode, incorrect or ambiguous quotes | RA-03, repeated RA-07 | Citations resolve to exact original-source spans, or the result is withheld; no fuzzy semantic recovery. |
| Revocation/source unavailability during generation or cache access | RA-03, repeated RA-07 | Derived output is withheld and not exposed through retry/history/cache. No initial shared cache is required. |
| Concurrent requests, navigation or version switch | RA-04 | Late results are discarded from the wrong reader context; request state remains isolated. |
| Provider failure, malformed response, empty result and user dismissal | RA-03/RA-04 | Clear unavailable/error/Retry/Close behavior without automatic retry loops, fake success or an assertion that dismissal cancels provider cost. |
| Question unsupported by this document or prompt injection in its contents | RA-05 | Abstain or explain source limits; no cross-document/external-knowledge rescue or document-controlled actions. |
| Tampered selection or unsupported PDF-text mapping | RA-06 | Verify original source ranges; explain only supported selections, otherwise report unavailable. |
| Web/Windows parity, keyboard use, citation navigation and full regression | RA-04 through RA-07 | Shared supported behavior is actually exercised; mocked UI/build success is not live acceptance. |

## RA-04 local verification checkpoint — 14 November

Implementation: `KnowledgeDocumentDetail` / `ReaderSummaryPanel` /
`useReaderSummary`, called only from the published reader in
`ServerKnowledgeFeaturePage`. Typed `reader-summary-api` and closed runtime
`reader-summary-contracts` are shared by web/native. The native allow-list permits
only the exact generation/access routes and shapes; main owns their deadlines.
No new dependency, model, asset system, SQL or permission bypass is introduced.

The read-only access probe uses the same runtime-RLS source gate, current actor and
Target Readers as generation. It does not read storage, transfer source text, invoke
AI or consume Summary admission/cooldown. Its exact three-field result must match
the reader's document/publication/hash. Query/payload/identity confusion fails closed.

| Gate | Evidence and remaining scope |
| --- | --- |
| RA-04-A | 88 focused Core source/Summary/client cases, including real Fastify public responses round-tripped through the UI runtime parsers. Client web/native transport contract tests and 11 native-policy tests pass. No arbitrary native timeout or request body/query widening. |
| RA-04-B | 36 focused UI/adapter cases cover manual generation, loading/errors/unsupported, Retry/Close, Escape/focus, safe text and citation gating. Actual synthetic local browser inspection confirms these states and source navigation. |
| RA-04-C | Tests discard late generation/access results after context change, dismissal and unmount; ready results/citations are cleared on version change and withheld across blur/visibility return. Completion while blurred stays withheld until revalidation. Real disposable PostgreSQL verifies access identity, cross-organization denial and suspended membership during/after fake generation. |
| RA-04-D | Local shared component visually inspected at 1440×1000 and 1024×900; no horizontal overflow at 1024. Text source anchors gain the citation class. PDF object URL gets `#page=2`, with the original passage visible above it. Native PDF rendering was not visible in the in-app browser. Desktop bridge simulation and the Electron build pass, but genuine Electron interaction and signed-in paired-service end-to-end acceptance remain unverified. |

Final root regression: API 338 pass / 26 gated skips, UI 257 pass, Domain 9 pass,
desktop 11 pass; remote workflow 16 pass. Root typecheck and production API/web/
Electron builds pass after the final visibility regression. Typecheck includes the new UI tests and
development-only preview explicitly. A further separate real PostgreSQL run passes
all 11 cases, preserving 46 restricted-owner tables and 23 trusted definers. The
task-started disposable PostgreSQL and Vite processes were stopped afterward.
Existing pg@9, jsdom canvas/scroll and large-bundle warnings are not new pass claims.

Reproduce focused checks from the feature checkout:

```sh
pnpm --filter @arden/api exec vitest run src/reader-ai src/answers/ai-client.test.ts
pnpm --filter @arden/ui exec vitest run tests/readerSummary.test.tsx tests/readerSummaryApi.test.ts
pnpm --filter @arden/desktop test
```

The synthetic development page `apps/web/reader-summary-preview.html` uses the real
shared reader and adapters but explicit fixture transport, not a model or live API.
It is not a production build input or a fallback for the application. Start the web
Vite development server to inspect it; use Ready, Failure, Unsupported and Access
denied controls. Its desktop mode is labelled simulation, never native acceptance.

Remaining RA-04 release gate: exercise the intended signed-in paired backend and genuine
Electron reader before declaring cross-platform acceptance or releasing Reader AI.
Current native requests still share the existing serialized cookie/session queue;
Close abandons renderer waiting but does not cancel the underlying request or free
that queue immediately. Verify this navigation/sign-out latency in the native run;
do not bypass cookie serialization casually. Deployment proxy deadlines also require
separate verification before rollout. No provider-quality run, paid request, shared
DB/index write, commit/push/PR/merge or deployment occurred in this slice. Do not
claim instant remote revocation of already displayed text without a new access check.

## RA-05 specification — exact-document Q&A, 14 November

The maintainer approved local development while retaining RA-04's genuine-native
and signed-in paired tests before release. This explicitly supersedes only the
earlier development sequencing condition, not those tests, privacy rules or release
authority. No push/deployment, paid requests or shared DB/index writes are authorized.

POST `/api/v1/organizations/:organizationId/knowledge/published/:publishedVersionId/questions`
accepts only `{requestId, query}` (UUID, 1–4,000 nonblank characters). The current
actor and exact eligible publication are resolved through the same Reader source
gate, including authorized upcoming versions. Never substitute the current default,
take source/generation IDs or text from the client, or use general-chat history.

Reuse the existing two-stage hybrid v2 retrieval/generation with additive purpose
`READER_QUESTION`. Its retrieval allow-list contains exactly one Core-resolved
generation; history must be empty, hints belong to that generation. Generation
evidence must all share that generation/snapshot/hash, at most eight chunks and
64,000 characters. These constraints are independently enforced by Core and AI.
Core validates every input against the immutable manifest and reauthorizes before
generation and after it. Revalidate even an empty retrieval before returning an
insufficient result. Changes/revocation withhold output; no other-document fallback.

Reader requests reuse the configured Luna/high model but have a separate bounded
generation adapter: 4,096 output tokens including reasoning, 45 seconds/call, no
transport retries, at most one identical-input output repair. A 12,000-local-token
prompt envelope including a 2,000-token schema/framing reserve fails unsupported
before generation. AI retrieval/generation operations are bounded at 60/110 seconds;
Core waits 75/125 seconds, client/native 240 seconds. No claim these bounds establish
proxy/provider guarantees. Process-local admission: one actor/org request, eight
global active, ten-second dispatch cooldown, at most 1,000 expiring keys.

Public result: request/document/version IDs, `ANSWERED|INSUFFICIENT_EVIDENCE`, answer,
original-source citations. Return a fixed document-specific message for insufficient
evidence, never arbitrary unsupported model prose. ANSWERED needs citations with
unique literal source spans; whitespace-only recovery is allowed in AI, not fuzzy
matching. Grounding/entailment still require provider-quality evaluation; schema and
literal citations alone cannot prove every answer correct or injection-proof.
No tools, browser access, cross-source context, mutation, cache or conversation write.
Q&A uses bounded retrieved passages, not Summary's whole-text source-size envelope;
late-document citation offsets remain valid safe integers checked against the exact
manifest. The shared client does not silently impose Summary's 200,000 offset cap
on Q&A. This does not certify relevance/complete coverage of a large document.

The initial reader interaction is stateless: each question is standalone. Do not
silently import previous questions/answers (including pronoun-only follow-ups) as
evidence. Retry is explicit; dismissal/version switch abandons transient output and
must not imply provider cancellation. Source clicks and focus return use the shared
read-access probe. Keep the original document and existing Island styling; provide
Ask this document, question input, Answer, loading/unsupported/error/Retry and Close.

RA-05-A: strict paired purpose/contracts and bounded adapter tests. RA-05-B: Core
exact-generation/manifest, all-input authorization, denial/revocation and forged-
output tests, plus real disposable RLS checks. RA-05-C: shared client/UI state,
plain-text output, source navigation, Retry/Close/context and no-history tests.
RA-05-D: actual local interaction plus regression; genuine native/signed-in paired,
paid relevance/grounding and staging integration remain explicit release gates.

### RA-05 compatibility and verification checkpoint

Implementation: Core `reader-ai/question.ts` / `question-routes.ts`, the existing
v2 AI contracts/orchestrator and a bounded reader-purpose provider branch. The
source gate now exposes server-only exact resolution; it is not a browser endpoint
for raw records. Admission and original-source citation mapping are shared with
Summary. The shared UI uses `ReaderQuestionPanel`, strict `reader-question-api` and
the extracted `useReaderOperation` lifecycle also covered by Summary regressions.
Only one reader AI panel is open at a time. New questions are standalone and do
not silently send any earlier answer, query history or retrieved source text.

Service `answer-v2.schema.json` is regenerated for the additive purpose; unchanged
PUBLISHED_CHAT callers remain compatible. Deploy the compatible AI service before
enabling the separate Core question caller. An older service's rejection is not
permission to fall back to general chat. No migration/configuration/model/dependency
change is needed for this slice; the existing GA-v2 integration/migration conflict
must still be resolved separately before release.

Local evidence: Core source/Summary/question/client **121 focused cases** and shared
UI/adapters **58 focused cases** pass; AI **143 offline tests**, Ruff and mypy for
**34 modules** pass. Actual disposable Chroma with deterministic fake embeddings
checks organization/generation filtering for both purposes, not semantic relevance.
**12 separate real disposable PostgreSQL cases** pass, including Q&A revocation
during generation, denied reuse and unchanged chat history. Restricted DDL ownership
remains 46 tables / 23 trusted definers; task-owned DB process stopped afterward.

Core tests reject changed query, generation/snapshot/hash/manifest substitution,
foreign/forged evidence, missing used-inputs, malformed/coerced enums, bad/ambiguous
quotes and revocation even with empty retrieval/cooldown. UI verifies scoped
requests, safe text, insufficient status, permitted retries, context resets, shared
panel exclusivity, Close/Escape and bounded native waiting. AI verifies singleton
source/no-history contracts, prompt preflight before generation, fixed reader
budgets/source-only prompt and HTTP operation deadlines without real provider calls.

Structured output is one layer, not a correctness or permission proof. The
[official structured-output guidance](https://developers.openai.com/api/docs/guides/structured-outputs)
requires application handling for refusals/incomplete outputs and business rules;
[prompt-injection guidance](https://developers.openai.com/api/docs/guides/agent-builder-safety)
also does not guarantee prompt isolation. Keep source validation, access checks,
literal spans and later human/provider grounding evaluation independent of schema.
No perfect injection resistance, complete-document absence proof or factual
entailment is claimed from the fake-provider tests.

Final RA-05 local regression: root typecheck/test/build pass; final API-only rerun
after four HTTP boundary cases **371 pass / 27 gated skips**; UI **279**, Domain **9**,
native policy **12**, remote workflow **16**. Focused reader/source/Summary/question/
client **121**, UI/adapters **58** and the
separate real-DB **12** pass. All AI **143** tests, Ruff and mypy **34 modules** pass.
The extra skipped case in the ordinary API run is the new guarded real-DB Q&A test,
not a disabled check; it passed in the separate disposable database run.

Actual local reader inspection used labelled synthetic transport: ready/loading,
insufficient, failure/Retry, Close/Escape/focus, revoked source removal, text-block
highlight and PDF `#page=2` plus quote navigation. Web and desktop-bridge simulation
were exercised at 1440×1000 / 1024×900; no horizontal overflow at 1024. The in-app
native PDF surface remains blank, so no PDF rendering/text-selection acceptance.
An initial post-HMR click had no retained candidate; a full reload of the finalized
code restored the expected checking/navigation behavior and was used for evidence.
No simulation is relabelled as genuine Electron or signed-in paired acceptance.

RA-05-A/B/C and RA-05-D's local fixture/visual gate are verified. Genuine native,
signed-in paired, real provider/grounding quality, staging integration/migration
reconciliation, proxy timeouts and release remain open. No paid request, shared
data/index write, commit/push/PR/merge or deployment. RA-06 has not started.
