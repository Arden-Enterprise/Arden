# Arden AI

Python service for Arden's permission-aware retrieval and generation pipeline.

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

