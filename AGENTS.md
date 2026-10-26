# Arden-AI contributor rules

## Repository context and coordinated delivery

- Follow Arden's [specification rule](https://github.com/Arden-Enterprise/Arden/blob/main/docs/engineering/rules/specifications.md) and [feature/flow index](https://github.com/Arden-Enterprise/Arden/blob/main/docs/product/README.md), inspecting their actual approved checkout/revision. Record agreed brainstorm outcomes, originator/decision-owner provenance, paired service/Core acceptance IDs and a usable resume checkpoint. Before replacing a conflicting accepted contract, present the current/proposed comparison and consequences, recommend original-owner/team input, and obtain an explicit informed decision. Preserve unknown attribution and reuse sufficient prior approval. If shared guidance is not yet integrated/available, report the gap rather than assuming it is on main. This adds no automated check or mandatory human PR review.
- Locate Arden core and the approved private team Knowledge checkout using project-local onboarding/metadata, preserving existing work. Read Knowledge's relevant index/topics, then current main contracts, changes and source in affected repositories. Report inspected revisions, missing access and material conflicts; do not assume the latest chat describes implementation.
- Follow the [shared repository workflow](https://github.com/Arden-Enterprise/Arden/blob/main/docs/engineering/team-knowledge.md) and [knowledge maintenance policy](https://github.com/Arden-Enterprise/Arden/blob/main/docs/engineering/rules/knowledge-maintenance.md). Inspect the caller and service together for API/schema changes. Resolve provider/authorization/data-flow conflicts explicitly before dependent work.
- Every coherent code/config/schema change needs a task-level private Knowledge record explaining what changed, why, exact PR heads, actual checks, compatibility and remaining work. Update this repository's owning public docs/contracts alongside implementation and Knowledge's topic/index/handoff alongside its record.
- Public PRs include a safe handoff summary and task reference. Inspect the prepared Knowledge update against the latest paired heads before authorized code merge. After code merges, finalize and merge Knowledge with actual merge SHAs. Plans may merge early as planned/in progress. Pending finalization keeps the task unfinished.
- Keep private Knowledge URLs, paths, contents and credentials out of public source/reviews. Perform and report this contributor/agent procedure directly; it installs no automated Knowledge checks. This policy does not authorize publication, merge, paid usage, deployment or a change of AI architecture.

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

