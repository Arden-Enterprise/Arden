# Arden AI

Read [AGENTS.md](AGENTS.md) before contributing. Code changes use the shared [three-repository workflow](https://github.com/Arden-Enterprise/Arden/blob/main/docs/engineering/team-knowledge.md): current Knowledge context, paired contract inspection, a private handoff for the latest PR heads, and finalization after merge. This is a contributor/agent rule with no new automated Knowledge checks.

Python service for Arden's permission-aware retrieval and generation pipeline.

Feature scope and Core/service dependencies are mapped in Arden's [feature index](https://github.com/Arden-Enterprise/Arden/blob/main/docs/product/README.md). Use the shared [specification rule](https://github.com/Arden-Enterprise/Arden/blob/main/docs/engineering/rules/specifications.md) for accepted brainstorm records, conflicting decisions and per-criterion completion. Verify the actual integrated revision; branch-only or locally prepared documentation is not automatically available on main.

## Ownership boundary

Arden AI owns deterministic document compilation, chunking, embeddings, Chroma retrieval,
context assembly, answer generation and Langfuse telemetry. The Arden core API remains the
source of truth for identity, organization membership, AccessPolicy, review state, chat history
and atomic publication activation. ChromaDB is a retrieval index, never an authorization source.

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

Arden core calls `POST /v1/answers` with the authenticated actor's current generation allow-list.
The service applies both organization and generation filters in Chroma, generates a grounded
answer with OpenAI structured output, and returns evidence identities for a final Core-side access
recheck before anything reaches the UI.

Versioned cross-repository schemas are checked into `schemas/`. Regenerate them after an intentional
contract change with:

```powershell
uv run arden-ai-export-schemas
```

The current chunker derives deterministic section boundaries from Arden's source map, then uses
LangChain's token-aware `RecursiveCharacterTextSplitter` inside each section. Default child chunks
target 600 tokens with 60-token overlap; section breadcrumbs are included in embedding text while
raw Markdown offsets remain exact for citations.

## Pipeline boundary

1. Arden core creates a durable indexing generation for an approved immutable snapshot.
2. Arden AI compiles the Semantic Document, chunks it, embeds it and writes the candidate
   generation to ChromaDB.
3. Arden AI returns an index manifest; Arden core validates it and atomically activates the
   generation.
4. For retrieval, Arden core calculates allowed generation IDs from the current AccessPolicy.
   Arden AI applies that allow-list as a Chroma filter. Arden core rechecks returned evidence
   before it can enter model context or citations.

The cross-repository indexing and retrieval APIs will be versioned under `/v1` and described by
OpenAPI. No AI endpoint may broaden an allow-list supplied by Arden core.

