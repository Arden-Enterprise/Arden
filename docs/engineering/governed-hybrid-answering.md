# Governed hybrid answering (GA-v2)

Status: accepted implementation scope, 12 November 2026; not deployed.
Decision owner: requesting maintainer. Origin: maintainer-approved combined
authorization/Ask Arden implementation and hybrid-search request; record: Codex.
Baselines: Core staging `a07f575`, AI main `cc0b4d2`. F13/F14, ARD-52/57/58/59.

## Contract and acceptance

- GA1: lexical BM25 and dense Chroma retrieval rank only Core-allowed generations
  in the current organization. Deterministic reciprocal-rank fusion deduplicates
  exact chunks. Both branches are bounded; lexical work must not load a global
  corpus and filter after ranking. No new external retrieval service.
- GA2: Core retrieves, validates exact snapshot/hash/chunk/source spans against
  the canonical manifest, rechecks current permission, then submits that fixed
  evidence to a separate generation endpoint. The response identifies every used
  input, not only citations. Core rechecks all inputs before persistence/output,
  including insufficient-evidence answers and prior conversational context.
- GA3: generated citation IDs resolve only to supplied evidence. Excerpts must
  occur within the validated source text; PDF page/block identities remain exact.
  Canonical business Version/code/type/date replace technical revision labels
  where available. Legacy absent metadata stays explicitly unknown.
- GA4: conversations/turns/evidence references persist in Core, owner-private
  within the organization. Read and continuation revalidate every assistant
  turn's sources; any lost source withholds that entire answer/context. No raw
  chunk copies, shared admin history bypass, provider-hosted state or auto purge.
  Atomic persistence and request IDs prevent duplicate turns on retry; concurrent
  sends conflict rather than overwrite. Recent authorized context is bounded.
- GA5: currently applicable guidance is the default, explicitly confirmed by the
  maintainer. Upcoming/compare are explicit source scopes, never authorization
  overrides. Publishing a future-effective replacement does not make it today's
  rule. Choose the applicable version before reader filtering: a denied newer
  effective version must not fall back to an older accessible version. Expiration
  of the newest applicable version must not resurrect its predecessor.
- GA6: retain a release lineage from the current baseline forward. Pointer removal
  revokes the lineage; later republication starts another lineage. Do not infer
  old withdrawn history as a baseline. Version-specific citations can open an
  authorized applicable baseline or announced replacement without opening all
  historical versions. Original content and review/index activation stay immutable.
- GA7: fixed offline retrieval/authorization/evidence/conversation tests and a
  reproducible evaluation harness compare dense, lexical and hybrid results.
  Privacy-safe timings/counts contain no prompt/evidence/credential bodies.

## Compatibility and delivery

Python `langchain-community` was sunset and archived; do not introduce it or move
RAG into Core to satisfy a library name. Retain standalone LangChain integrations,
add small pure BM25/RRF functions and inspect their actual installed APIs.
[Official sunset notice](https://github.com/langchain-ai/langchain-community/issues/674).
No broad dependency upgrade, image/OCR feature, upload Summary, Reader/Reviewer
assistant, Maintenance agent or private/hybrid-source expansion is included here.

Additive v2 retrieve/generate contracts deploy before the matching Core caller;
Core must fail closed rather than silently use the old one-call answer endpoint.
New SQL is operator-reviewed and rehearsed locally; no applied SQL/checksum is
rewritten. This scope does not authorize a shared migration, provider call, Git
publication or deployment. Public and private handoffs record actual checks and
remaining acceptance separately.

## Implementation and verification map — 13 November

This checkout implements the contract; it is not published/deployed.

| Acceptance | Implementation / executable evidence |
| --- | --- |
| GA1 | AI BM25/RRF, filtered Chroma, exact-source bounded section-neighbor expansion; provider-free and disposable Chroma tests |
| GA2/3 | Core staged orchestration and strict parsers; pre-model revocation, uncited/insufficient-output revocation, forged spans/hashes, paired golden-contract tests |
| GA4 | Core conversation store and owner RLS in 0032; real concurrent writers, mid-transaction rollback, owner/admin isolation, replay/unavailable-history and UI tests |
| GA5/6 | 0032 eligibility and pointer-lineage trigger; actual approve/index/activate tests for future replacement, current baseline, denied replacement, expiry, withdrawal and new epoch |
| GA7 | Offline ranking harness, controlled synthetic fixture and safe retrieval telemetry; no real provider/corpus relevance claim |

Offsets use Unicode codepoints. Business-date selection uses UTC dates; missing
legacy Effective Date falls back to Published Date for selection only, never an
invented display field. Expiration Date is inclusive through that UTC day.
Responses are non-streaming. Invalid model-output repair is at most one attempt
against identical authorized inputs; transport retries are separate. Stop waiting
dismisses the local wait, not provider work or cost.

Actual PostgreSQL tests also run after the standard ownership handoff: DDL moves
to a non-bypass/non-login role while 23 reviewed SECURITY DEFINER functions retain
their trusted executor. Never transfer those functions or weaken FORCE RLS to make
verification pass. Local tests use disposable synthetic data, not shared databases.

## Rollout and recovery boundary

1. Review both repositories and operator migration 0032/function ACLs. Deploy the
   additive AI v2 implementation first. Old Core can continue using v1 during this
   phase; new Core intentionally fails closed against an old service.
2. With separate operator authorization, back up/restore-rehearse the target DB,
   then apply 0032 using the trusted operator executor. New internal capabilities
   and FORCE-RLS tables make this operator-only, not automatic expand SQL. Verify
   inventory/checksums and trusted-function ownership before app rollout.
3. Deploy matching Core/web/desktop. Verify current/upcoming/compare, exact
   citations, private history and revocation using authorized synthetic actors.
   Browser/real-provider acceptance is separate from local checks. Existing current
   manifests already contain the raw-content hashes/source maps; this change alone
   needs no corpus re-index.
4. Do not drop history/lineage or rewrite the ledger for app rollback. Keep backups.
   Reverting Core to one-call answering loses the new pre-model/all-input gates
   and requires an explicit security decision; disable answering while recovering
   rather than silently selecting v1. Ordinary publication is provider-independent.

Legacy business metadata is not inferred/backfilled. Reader/Reviewer AI,
Maintenance, personal/hybrid-source purposes, OCR and live relevance benchmarks
remain separate work. Exact quotes check integrity, not deterministic entailment.

## Evaluation continuation — accepted 13 November

The maintainer requested empirical evaluation before deciding on a reranker.
This authorizes local evaluation preparation, not integration or shared release.
Provider usage and model-download scope are confirmed separately. Keep the existing
model/effort, application dependencies and staging data unchanged.

- EVAL1: freeze source-grounded questions, reference passages, source hashes and
  annotation provenance before observing rankings; distinguish repeated paraphrases
  from independent cases and retain annotation corrections transparently.
- EVAL2: compare lexical, semantic, RRF and the actual bounded context selection;
  an isolated reranker experiment must use the same candidate pool and generator.
  Measure nDCG@5, MRR@5, candidate recall and required-source coverage in context.
- EVAL3: grow the candidate pool with clearly labeled, genuinely confusing
  distractors. Do not count duplicated correct passages as irrelevant or call
  synthetic-growth observations production-scale proof.
- EVAL4: separate relevance from membership/version authorization. Exercise
  allowed/denied sources, revoked history, exact citation integrity and abstention;
  a learned relevance score never overrides those deterministic rules.
- EVAL5: grade answer support, completeness, source correctness and unsupported
  claims against references; report failed/truncated executions separately from
  quality scores. Automated judges need calibration/human review, not self-approval.
- EVAL6: report paired improvements/regressions and uncertainty, language slices,
  model/revision/settings, bounds, latency and actual provider usage. Recommend
  integration only from measured benefit; mixed/insufficient evidence stays
  inconclusive. No new SRS quality/latency guarantee or reranker rollout is implied.

### Isolated evaluation checkpoint — 13 November

The bounded provider comparison executed against the local feature implementation,
not a deployed-service acceptance test. Hybrid/RRF and an isolated pinned CPU
reranker were compared on frozen short-document sources and controlled synthetic
confusion. Reranking improved target-source ordering, with per-query regressions;
authored source annotations are not exhaustive relevance judgments or production
scale proof. Independent human review remains pending.

Live generation exposed a separate delivery blocker: the model frequently joins
PDF whitespace in purported verbatim quotations, so the unchanged exact raw-source
gate withholds the answer even after the existing same-input retry. Relevance
gains must not be represented as successful answer delivery. Keep the gate and
Core authorization/manifest checks intact; verifiable citation-span recovery was
the next proposed fix at this checkpoint, implemented locally as recorded below.
No app dependency/model change,
reranker integration, shared index write or rollout followed from this experiment.

### Citation alignment refinement — accepted 14 November

The maintainer approved a basic citation-flow fix before the next AI Todo.
Keep the v2 wire schema, canonical text/hashes, reader checks and exact Core span
verification unchanged. This is a source-recovery implementation detail, not a
new permission rule or authority to run providers/deploy.

- CQ-1: prefer a unique literal quote in the cited authorized chunk. Otherwise
  collapse whitespace only for lookup, require one contiguous unambiguous match,
  and return the corresponding **original** substring, never normalized source.
- CQ-2: reject changed wording, negation, case/punctuation, omitted intervening
  text, ambiguous repetitions, empty quotes and spans exceeding the existing bound.
  Never search another chunk/version to make a citation pass.
- CQ-3: validate response/input identities first; preserve all used-evidence IDs,
  hashes, original source offsets and Core's pre/post authorization/manifest gates.
  Failed recovery uses only the existing bounded identical-input retry.
- CQ-4: cover Unicode/codepoint offsets, real PDF wraps, HTTP response serialization
  and forgery/ambiguity cases. Replay retained benchmark outputs offline, reporting
  it as post-processing replay, not a new provider or semantic-accuracy measurement.
- CQ-5: record remaining failures and the next Reader AI scope separately. No
  reranker integration, schema migration, re-index, model change or upload Summary.

Local verification checkpoint: AI 89 tests, Ruff and strict mypy pass; Core's paired
generation/authorization tests pass (20 cases). An offline replay of 240 retained
model candidates/configuration rows reduces withholding from 199 to 3. Every
accepted quote is checked again as an original-source substring. This is not a
fresh provider run, an answer-accuracy score, or live acceptance. Remaining growth
RRF cases include non-whitespace quote differences; one recorded repair has a
schema validation failure. Keep them withheld rather than broaden recovery.
No provider calls, dependency/model changes, shared writes or release occurred.

Next ordered slice: [Reader AI](reader-ai.md), starting with full-version Summary
before document-scoped Q&A and selection explanation. This citation checkpoint
does not implement those capabilities or authorize a shared migration/deployment.
