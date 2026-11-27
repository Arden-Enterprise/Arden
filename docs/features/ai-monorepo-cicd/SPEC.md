# Spec: Arden-AI Monorepo Consolidation & Automated CI/CD — V1

**Status:** Accepted for V1 (Phase 1 implemented on `feat/consolidate-arden-ai-monorepo`; Phases 2–3 planned)
**Date:** 2026-11-27
**ADR:** [0037 — Consolidate Python AI service into Arden monorepo with isolated release pipeline](../../decisions/0037-monorepo-ai-service-and-release-pipeline.md)
**Implementation Plan:** [PLAN.md](PLAN.md)

## Objective

Consolidate the Python AI service (`Arden-Enterprise/Arden-AI` `d534c7f`) into `Arden` under `services/ai/` and build automated CI and staging/production CD while preserving:
- Zero regression to Core Web/API/Desktop builds, `dev:remote`, and Core's `Deploy verified app release` (`api + web`) pipeline.
- 100% of [ADR 0012](../../decisions/0012-separate-python-ai-service-and-chromadb.md) runtime isolation: separate non-root `read_only` Python container, zero Arden PostgreSQL credentials or DB network reachability, separate digest-pinned ChromaDB container/volume per environment, and Core hotfix independence when AI is unchanged.
- Arden's release security invariants: free public GitHub runners only, zero persistent Actions caches or external Docker registry, short-lived OIDC proofs bound to exact workflow/ref/commit/request digest, Trivy `HIGH,CRITICAL` runner gate, and zero compilers/downloads on the shared server.

## Project Structure & Commands

- `services/ai/` — Python 3.11 + `uv` AI service (intentionally outside `pnpm-workspace.yaml`, Core `deploy/release/Dockerfile.dockerignore`, and `tools/remote/source.mjs`).
- `services/ai/Dockerfile` & `services/ai/Dockerfile.dockerignore` — multi-stage digest-pinned runtime (`USER 1000:1000`, `HOME=/tmp`, `ANONYMIZED_TELEMETRY=FALSE`, pre-baked `TIKTOKEN_CACHE_DIR=/app/.tiktoken-cache`, no `uv` or `curl` in runtime, distinct `io.arden.release.ai_managed="1"` label) with strict allowlist ignore file.
- `services/ai/schemas/parity-manifest.json` — tracked Core↔AI golden fixture pairs and ChromaDB version pin (`1.5.9`).
- `tools/releases/ai-contract-parity.mjs`, `ai-contract-parity.test.mjs`, `ai-build.mjs`, `ai-smoke.mjs` — parity verification, Trivy scan, and `--network none --read-only` offline `tiktoken` + HTTP `401`/redacted `422` smoke tests.
- Phase 2 (planned): `deploy/release-ai/`, `tools/releases/ai-release.mjs`, and isolated reusable `.github/workflows/release-ai.yml` (`job_workflow_ref` pinned, distinct OIDC audience, dedicated AI Coolify bridge & token prefix, shared host lock).

```powershell
# AI unit/lint/typecheck
cd services/ai && uv sync --frozen && uv run pytest -q && uv run ruff check . && uv run mypy

# AI contract parity & hardening checks
node tools/releases/ai-contract-parity.mjs
node --test tools/releases/ai-contract-parity.test.mjs
```

## Key Invariants & Boundaries

- **Always:** Run `pytest`, `ruff`, `mypy`, parity/Chroma-pin checks, Trivy `HIGH,CRITICAL`, and offline/read-only smoke tests; keep `enable-cache: false` and `UV_NO_CACHE=1` on CI runners; keep AI contracts additive/backward-compatible with deployed Core.
- **Ask first:** Archiving `Arden-Enterprise/Arden-AI`; production server provisioning or Core `production.json` template changes; enabling `vars.ARDEN_AI_RELEASE_ENABLED=true` on `production`; narrowing Core's `HEAD^{tree}` (V1.1).
- **Never:** Share staging ChromaDB or secrets with production; attach `arden-ai` to Core's PostgreSQL network; run `uv sync`/`pytest` inside a job holding `id-token: write`; fail open when deploy secrets are missing.

## Acceptance Criteria

1. **Phase 1:** `services/ai/` imports `d534c7f` with history and `(Arden-Enterprise/Arden-AI#N)` references; passes `pytest`, `ruff`, `mypy`, `ai-contract-parity`, Trivy `HIGH,CRITICAL`, and `--network none --read-only` smoke in CI (`ai-check`, `contents: read`); zero Core regressions.
2. **Phase 2:** Dedicated AI release receiver & reusable `.github/workflows/release-ai.yml` deploy staging `arden-ai` ahead of Core when AI changes, skip cleanly on Core-only pushes (preserving Core hotfix availability if AI receiver is down), and pass unit + Linux root-privilege tests.
3. **Phase 3:** Isolated production `chromadb` (digest-pinned), `arden-ai` (using `ARDEN_AI_OPENAI_API_KEY`, two private networks: `prod-core-ai` + `prod-ai-chroma`), and Core `arden_indexer` (`ARDEN_INDEX_DATABASE_URL`) provisioned; dual read-only preflight prevents promoting production AI ahead of a blocked Core promotion; `Arden-Enterprise/Arden-AI` archived read-only after verification.

## Out of Scope (Deferred to V1.1+)

- Narrowing Core's `tree = git rev-parse HEAD^{tree}` to exclude `services/ai/` and `docs/` (accepted V1 trade-off so Core's live receiver stays untouched during Phases 1–2).
- Reducing Python image size (`chromadb` transitive deps) or adding self-hosted Langfuse instrumentation.
- Hosted `dev-1`..`dev-4` AI containers or `dev:remote` Python hot-reload.
