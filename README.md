# Arden AI

Read [AGENTS.md](AGENTS.md) before contributing. Code changes use the shared [three-repository workflow](https://github.com/Arden-Enterprise/Arden/blob/main/docs/engineering/team-knowledge.md): current Knowledge context, paired contract inspection, a private handoff for the latest PR heads, and finalization after merge. This is a contributor/agent rule with no new automated Knowledge checks.

Python service for Arden's permission-aware retrieval and generation pipeline.

Feature scope and Core/service dependencies are mapped in Arden's [feature index](https://github.com/Arden-Enterprise/Arden/blob/main/docs/product/README.md). Use the shared [specification rule](https://github.com/Arden-Enterprise/Arden/blob/main/docs/engineering/rules/specifications.md) for accepted brainstorm records, conflicting decisions and per-criterion completion. Verify the actual integrated revision; branch-only or locally prepared documentation is not automatically available on main.

## Ownership boundary

Arden AI owns deterministic document compilation, chunking, embeddings, Chroma retrieval,
context assembly, answer generation and Langfuse telemetry. The Arden core API remains the
source of truth for identity, organization membership, AccessPolicy, review state, chat history
and atomic publication activation. ChromaDB is a retrieval index, never an authorization source.

## Submission review

`POST /v1/submission-reviews` is a service-authenticated, additive v1 endpoint for BM04 F-06.
Core authorizes the reviewer and sends the exact frozen submission. Arden-AI checks the hash
and extracts readable text. The model receives only that text and selects passage IDs, which
Arden-AI resolves into excerpts. The reviewer receives a summary and optional checks and still
decides whether to approve or reject. See the [request and response schema](schemas/submission-review-v1.schema.json).

## Local development

The project targets Python 3.11 and uses `uv` for dependency and environment management.

```powershell
uv sync
uv run pytest
uv run ruff check .
uv run mypy
uv run uvicorn arden_ai.main:app --reload --port 8080
```

Health endpoints are available at `/health/live` and `/health/ready`.

## Architecture

The service follows a layered dependency direction. Infrastructure implements application ports;
domain code never imports FastAPI, ChromaDB, OpenAI or settings.

```text
src/arden_ai/
├── presentation/    # HTTP routes, authentication and response mapping
├── application/     # use cases, orchestration and provider ports
├── domain/          # semantic document, deterministic compiler and chunking
├── infrastructure/  # environment settings, OpenAI and Chroma adapters
├── contracts/       # versioned cross-repository request/response models
└── main.py          # composition root and ASGI entrypoint
```

Dependencies flow inward: `presentation -> application -> domain`. Infrastructure is selected only
by the composition root and implements protocols declared by the application layer.

Arden core submits approved immutable snapshots to `POST /v1/index-generations` using an
`Authorization: Bearer <ARDEN_AI_SERVICE_TOKEN>` header. The endpoint returns a candidate index
manifest only after every chunk has been embedded and acknowledged by ChromaDB. Arden core remains
responsible for validating that manifest and atomically activating the generation.

The governed caller uses separate retrieval and generation operations. Core calls
`POST /v2/retrievals` with its organization/generation allow-list, bounded authorized
dialogue and canonical labels. AI combines filtered Chroma semantic search and
BM25 using deterministic RRF. Core validates raw text/hash/spans against its
immutable manifest and rechecks access **before** calling `POST /v2/generations`
with the fixed evidence. Generation uses strict structured output, temporary E
identifiers and exact quotations. Core rechecks every input, including uncited and
conversational evidence, persists the private turn atomically and then returns it.
The old `/v1/answers` remains for deployment compatibility; new Core never falls back.

Company Ask Arden can use `POST /v3/generations` for `PUBLISHED_CHAT`. Core sends
verified evidence and a bounded catalog with opaque document handles. The service
returns a standalone answer, exact citations and an optional typed UI surface.
The provider adapter validates the answer and citations independently of the
surface. If surface validation fails, the answer and citations remain available with
`uiSurfaceStatus: OMITTED_INVALID`. Core validates the binding, rechecks access
and hydrates the UI. Retrieval and other generation purposes continue on v2.
[Versioned answer contract](schemas/answer-v3.schema.json)

Reader AI source preparation is additive at `POST /v1/reader-sources`, protected by
the same service authentication. Purpose `READER_SUMMARY` carries Core's exact
immutable snapshot and publication identity. It recompiles the canonical text and
all ordered chunks without an embedding, LLM or index write, returning the full
Markdown and manifest evidence for Core to compare against its stored ready manifest.
It is not a Summary generation endpoint and never selects another publication.
Limits: 200,000 canonical codepoints, 256 chunks, 16,000 codepoints per chunk and
400,000 aggregate chunk codepoints including overlap; unsupported input fails rather
than truncating to chat's top eight. See `reader-source-v1.schema.json` and the paired
`reader-source-v1.json` fixture. Core reauthorizes before transfer and result return.

Reader Summary generation is a separate additive `POST /v1/reader-summaries`, taking
the validated exact-source envelope, not a browser prompt or a retrieval allow-list.
It plans the entire canonical text before model calls: at most eight primary windows
of 6,000 codepoints / 2,000 local `o200k_base` tokens, with 256 neighboring codepoints
on each side. Each serialized prompt has an 8,000-local-token ceiling including a
2,000-token schema/framing reserve. Unsupported whole text/overlap fails explicitly;
no tail or evidence is silently truncated. The tokenizer encoding must be available;
failure never falls back to an uncounted model call.

Summary failures now return a closed `detail.code` envelope on HTTP 502: `TIMEOUT`,
`PROVIDER_BUSY`, `PROVIDER_AUTH`, `INVALID_OUTPUT`, or `UNAVAILABLE`. Task-group
failures are categorized without exposing provider messages. HTTP 422 remains the
unsupported/preflight response, with no generation calls. Core understands both
this additive envelope and the older generic failure; successful schemas are unchanged.
Failure logs contain only operation ID, stage, safe code and elapsed milliseconds.
The image disables automatic access logs. On an authorized staging rollout, enable
bounded container retention (for example json-file, max-size 1m/max-file 2); a
runtime with logging disabled still cannot retain these events. No paid call,
new dependency, model, index or DB change is required by this correction.

The existing configured model/effort is unchanged. Summary alone limits output to
4,096 tokens including reasoning per call, 45 seconds per call, two concurrent windows
and a 180-second operation deadline. Schema/quote errors have one identical-input
repair, transport errors no automatic retry; a failed window cancels/awaits siblings.
At most 16 calls are possible, not an implied USD cost or spending approval.

Each window proposes one to three short source-cited points. Unique whitespace-only
quote recovery must match both the supplied slice and the original chunk, with a
primary-passage citation required. Deterministic synthesis retains all validated
points in document order and removes only identical duplicates. No second model
rewrite, cross-document context, OCR, image understanding, tools, history, cache or
index writes. Core independently checks echoed source identity, full coverage/all
inputs and raw quotes, reauthorizes again, and derives public citation navigation.
Strict schema/quotes do not prove semantic completeness or entailment. See
`reader-summary-v1.schema.json` and the paired synthetic Summary fixture. Backend is
verified locally with fake providers; reader UI and fresh paid quality checks remain
separate steps. Deploy this additive AI endpoint before an authorized Core rollout.

### Reader questions — RA-05 local implementation

The existing v2 operations also accept `purpose: READER_QUESTION`. Core resolves
the exact open publication/generation; retrieval requires exactly one generation,
no dialogue and no hint outside that allow-list. Generation requires empty history
and one generation/snapshot/hash across all evidence. Reuse filtered hybrid retrieval,
never global search followed by an access filter or general conversation context.
Core checks all evidence against its immutable manifest and reauthorizes before
generation and after it; this service cannot grant business access or store turns.

Reader generation uses the unchanged configured Luna/high model with a separate
4,096-output-token cap (including reasoning), 45-second call timeout and no transport
retry. One same-input output repair remains; the whole reader retrieval/generation
operations are bounded at 60/110 seconds. Before generation, a 12,000-local-token
prompt envelope (including 2,000 schema/framing reserve) fails unsupported if exceeded.
Counts are local safety guards, not billing/context guarantees. Prompt labels/text
are JSON data, no external tools or history. Core replaces insufficient model prose
with fixed document-specific copy and independently validates source/citation identity.

No new endpoint, provider/model/dependency, business DB access, cache/index write or
upload summary. `answer-v2.schema.json` includes the additive purpose; deploy this
compatible service before a separately authorized Core caller rollout. Existing chat
behavior is unchanged. Offline scope/filter/timeout/schema tests do not certify
grounding quality, injection-proof behavior or signed-in/native acceptance.

For v2 generation, a unique literal quote is preferred. If only whitespace differs
(for example PDF line wrapping), the service requires a unique contiguous match
inside the cited input chunk and returns the **original source substring**. It does
not rewrite canonical text/hashes, search another chunk, or accept changed wording,
punctuation, case, ambiguous repetitions or disjoint passages. The recovered result
is schema-validated again, including the existing quote-length bound. Failure keeps
the existing single same-input repair attempt; Core's exact-span and authorization
checks remain unchanged. Quote integrity does not establish factual entailment.

No `langchain-community`/classic dependency is added: that Python package is archived
([official notice](https://github.com/langchain-ai/langchain-community/issues/674)).
Existing standalone integrations remain. Core alone selects current/upcoming/compare
publications and enforces Target Readers. AI receives no general business DB
credential. Responses API storage is disabled; conversations live in Core.

### Retrieval bounds and evaluation

Each request ranks only permitted chunks: semantic top 24, lexical corpus at most
10,000 chunks / 8 million characters, lexical top 24, RRF constant 60. Final context
has at most eight chunks / 64,000 characters. At most two slots expand to nearby
text in the exact same generation/snapshot/parent section (512-character proximity).
A single network-branch failure is labeled SEMANTIC or LEXICAL, not HYBRID. Both
failing, malformed identities or an oversized corpus fail closed. There is no global
lexical cache. Larger deployments need a reviewed indexed lexical adapter, not
silent truncation or post-ranking ACL filters.

```powershell
uv run python tools/evaluate_retrieval.py tests/fixtures/retrieval-rankings.synthetic.json
```

The ten-case fixture supplies controlled complementary rankings. Metrics validate
the harness/fusion, **not production relevance or model quality**. Use independently
judged observations from the real corpus for a live benchmark. Ordinary tests call
no OpenAI provider; disposable in-process Chroma uses deterministic fake embeddings
to check filters/APIs only. Exact quotes/schema validation do not prove every claim
is entailed. Retrieval logs contain request ID, mode, counts and timing, not bodies.

Versioned cross-repository schemas are checked into `schemas/`. Regenerate them after an intentional
contract change with:

```powershell
uv run arden-ai-export-schemas
```

### Selection writing actions

The authenticated internal `POST /v1/writing-actions` endpoint handles `IMPROVE`, `REFORMAT`
and `EXPLAIN` using the existing configured OpenAI chat model. A future Core caller must supply only
the selected text, or explicit page context when nothing is selected. The service returns a bounded proposed
replacement, a concise no-change message, or a chat-only explanation; it never edits a document.
Page-context explanations include an exact short source quote, checked against the supplied text.
Reformat output is checked against source wording and protected links/code. The v1 schema and
synthetic fixture are in `schemas/writing-v1.schema.json` and `tests/fixtures/writing-v1.json`.
No new dependency, model configuration, storage, index or migration is required. Provider
failures return safe codes. This change does not add a Core or UI caller. Deploy this additive endpoint before an authorized Core caller rollout;
ordinary tests use fake providers and do not establish live writing quality.

The current chunker derives deterministic section boundaries from Arden's source map, then uses
LangChain's token-aware `RecursiveCharacterTextSplitter` inside each section. Default child chunks
target 600 tokens with 60-token overlap; section breadcrumbs are included in embedding text while
raw Markdown offsets remain exact for citations.

`POST /v1/submission-reviews` accepts review contracts 1 and 2. Contract 1 returns a single source
per point for older Core releases. Contract 2 returns the primary citation and up to three
additional excerpts resolved from the same immutable submitted snapshot. The provider selects
existing passage IDs. Arden-AI rejects invalid selections and resolves each valid ID to its original
source text and page. Reviewer AI extracts pending submissions directly and uses one structured
generation. Publication chunking and embeddings do not participate in that request.

## Pipeline boundary

1. Arden core creates a durable indexing generation for an approved immutable snapshot.
2. Arden AI compiles the Semantic Document, chunks it, embeds it and writes the candidate
   generation to ChromaDB.
3. Arden AI returns an index manifest; Arden core validates it and atomically activates the
   generation.
4. For retrieval, Arden core calculates allowed generation IDs from the current AccessPolicy.
   Arden AI applies that allow-list as a Chroma filter. Arden core rechecks returned evidence
   before it can enter model context or citations.

Indexing remains v1; staged answering uses v2. OpenAPI/JSON Schema describe both.
Both repositories validate the same `governed-v2.json` golden fixture. No endpoint
may broaden Core's allow-list.

