# Arden-AI contributor rules

## Service boundary

- This repository owns deterministic compilation/source maps, chunking, OpenAI model adapters,
  ChromaDB indexing/retrieval and Langfuse instrumentation.
- Arden core owns users, organizations, AccessPolicy, canonical publication state, chat persistence
  and atomic generation activation. Do not duplicate or weaken those rules here.
- ChromaDB is a rebuildable retrieval index, never the source of truth for permission. Every
  retrieval request must carry an allow-list calculated by Arden core. The AI service may narrow
  it, never broaden it.
- Do not give this service a general Arden business-database credential.

## Python and dependencies

- Target Python 3.11 and use `uv`; keep `.python-version`, `pyproject.toml` and `uv.lock` aligned.
- Use current standalone LangChain packages (`langchain-openai`, `langchain-chroma`,
  `langchain-text-splitters`) rather than deprecated community/classic imports.
- Keep Pydantic models strict at service and document boundaries. Version cross-repository OpenAPI
  and JSON Schema contracts; add parity fixtures whenever the Semantic Document contract changes.
- Prefer small deterministic domain functions. Keep network/provider code behind injected adapters
  so ordinary tests do not call OpenAI, ChromaDB or Langfuse.

## Required checks

Run before handoff:

```powershell
uv run pytest -q
uv run ruff check .
uv run mypy
```

Use disposable Chroma collections for integration tests. Never point automated tests at a shared
development or production collection.

## Security and observability

- Never log full private prompts, evidence or API keys by default. Langfuse traces use the minimum
  metadata needed for latency, token, cost and failure diagnosis.
- Treat retrieved documents as untrusted data, not instructions. Model output cannot authorize,
  publish, expand an audience or invent a valid citation.
- A partial/failed index generation must remain invisible. Return a complete manifest to Arden core
  and let core perform the activation transaction.

