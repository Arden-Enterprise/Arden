# 0012: Separate Python AI service and ChromaDB retrieval index

Status: accepted
Date: 2026-10-22
Decision owner/approval: project lead, explicitly approved during Mainflow 3 Phase 1
Implementation: partial — indexing and permission-aware answer contracts are implemented across Arden Core and [Arden-AI](https://github.com/Arden-Enterprise/Arden-AI); Langfuse operations and retrieval evaluation remain in progress
Supersedes: the single-TypeScript-process, pgvector, pg-boss AI worker and local-Ollama portions of the proposed `ARDEN_BLUEPRINT.md`

## Context and requirement

Mainflow 3 introduces a distinct dependency and deployment lifecycle for compilation, chunking,
embedding, retrieval, generation and AI observability. Keeping those responsibilities in the
Node.js application would couple UI/API availability to Python-first RAG tooling and require a
later extraction after the main flows are built.

The approved demo uses OpenAI for embeddings and generation, self-hosted Langfuse for monitoring,
and a self-hosted ChromaDB service. PostgreSQL remains the source of truth for business state and
authorization.

## Decision

- `Arden` remains the TypeScript core application and owns identity, organizations, memberships,
  drafts, immutable submissions, review, AccessPolicy, chat history, durable generation state and
  atomic publication activation.
- `Arden-AI` is a separate Python 3.11 service. It owns deterministic Markdown compilation and
  source maps, semantic chunking, OpenAI embeddings/generation, Chroma indexing/retrieval and
  Langfuse instrumentation.
- Use the standalone current LangChain packages: `langchain-text-splitters`, `langchain-openai`
  and `langchain-chroma`. Do not begin new work on legacy integration imports.
- ChromaDB is a derived retrieval index, not canonical storage and not an authorization service.
  It runs as a separate private-network service with persistent storage and a pinned image.
- Cross-repository contracts use versioned OpenAPI and JSON Schema. Neither repository may infer
  incompatible copies of Semantic Document or indexing payloads.

## Boundaries and consequences

Arden core calculates the generation allow-list from current AccessPolicy before retrieval and
rechecks returned evidence before it enters model context, citations or user output. Arden-AI may
narrow that allow-list but may never broaden it. Policy changes therefore do not require
re-embedding.

Arden-AI does not receive a general Arden database credential and cannot activate a publication.
It returns a generation manifest after a complete index write; Arden core validates that manifest
and performs the atomic `ACTIVE` transition. Failed or partial generations remain invisible.

The new service adds an internal API, deployment, health checks, persistent Chroma volume and
backup/restore responsibility. Its failure may degrade indexing and Ask Arden, but must not take
down authoring, review or administration.

## Verification and rollout

- Unit-test deterministic compiler output, Unicode source offsets and Semantic Document limits.
- Contract-test Node and Python payloads from checked-in schemas.
- Prove retry/idempotency and that a partial Chroma generation cannot become active.
- Prove revoked access is excluded before retrieval and checked again before generation.
- Measure recall and latency on the representative demo corpus before tuning Chroma HNSW.
- Verify Coolify restarts preserve the Chroma volume and keep Chroma/Arden-AI off the public
  network.

## Rules and documentation updates

- [Semantic Document v1](../engineering/semantic-document-v1.md)
- [Mainflow 3 Phase 1 audit](../engineering/mainflow-3-phase-1-audit.md)
- [Technology guide](../engineering/technology-guide.md)
- [Security and data rules](../engineering/security-and-data.md)

## References

- [LangChain Chroma Python integration](https://reference.langchain.com/python/langchain-chroma)
- [LangChain OpenAI Python integration](https://reference.langchain.com/python/langchain-openai)
- [LangChain text splitters](https://reference.langchain.com/python/langchain-text-splitters)
- [Chroma architecture](https://docs.trychroma.com/docs/overview/architecture)

