# 0037: Consolidate Python AI service into Arden monorepo with isolated release pipeline

Status: accepted
Date: 2026-11-27
Decision owner/approval: requesting project maintainer / Flow 4 owner (explicitly approved after Q1-Q13 design review and dual-model adversarial review)
Brainstorm originator / record author: requesting maintainer; authored with Antigravity
Approval evidence and exact source/spec revision: approved on 2026-11-27 against `Arden` `staging` `06e2ae0d`, `Arden` `main` `b4fcd49` (tree `fa4d6fe`), and `Arden-AI` `main` `d534c7f`; see [V1 specification](../features/ai-monorepo-cicd/SPEC.md)
Implementation: partial — Phase 1 (monorepo import into `services/ai/`, hardened Debian 13 multi-stage Dockerfile, allowlist `.dockerignore`, unprivileged Python CI, Trivy scan, offline smoke, and contract-parity checks) merged into `staging` at `9ca26ac2` (PR #106); Phase 2 pipeline code (`deploy/release-ai/`, dedicated Coolify AI bridge + token helper, `tools/releases/ai-{identity,release}.mjs`, reusable `.github/workflows/release-ai.yml`, and CI wiring) implemented on `feat/ai-isolated-release-pipeline`; Phase 2 operator server install/staging AI cutover and Phase 3 (isolated production AI + ChromaDB provisioning, `main` promotion, and read-only archival of `Arden-Enterprise/Arden-AI`) remain pending in [PLAN.md](../features/ai-monorepo-cicd/PLAN.md).
Supersedes / superseded by: supersedes only the separate-Git-repository and manual-AI-deployment portions of [0012: Separate Python AI service and ChromaDB retrieval index](0012-separate-python-ai-service-and-chromadb.md); retains all ADR 0012 runtime, database, network, and ChromaDB isolation invariants intact.

## Context and requirement

Maintaining `Arden` (TypeScript Core) and `Arden-AI` (Python 3.11 RAG/AI service) in two Git repositories added coordination overhead on every cross-service contract change (`v3/generations`, `v2/maintenance-analyses`, `v1/submission-reviews`), allowed contract fixtures to drift, left `Arden-AI` without GitHub Actions CI, and required manual operator deployments to staging while production had no AI service.

At the same time, Core's verified release receiver (`deploy/release/`) is schema-locked to the `arden-api` + `arden-web` pair (`~560 MB` combined, `512 MiB` archive limit), whereas the Python AI image is `~1.59 GB` and must remain strictly runtime-isolated from PostgreSQL and Core availability.

## Options and tradeoffs

1. **Keep two repositories and add CI/CD to `Arden-AI`:** minimal receiver churn, but keeps dual-PR contract drift and split branch models (`staging`/`main` vs `main`-only).
2. **Merge `Arden-AI` into Core's 2-image release tarball (schema v3):** atomic single bundle, but forces `~700-900 MB` image uploads on every UI edit, rewrites Core's live receiver, and couples Core hotfixes to Python image CVEs.
3. **Merge `Arden-AI` into `Arden/services/ai/` with path-filtered unprivileged Python CI and a sibling isolated AI release pipeline:** single repository and unified `staging` -> `main` workflow, zero bloat to Core builds or `dev:remote`, preserved OIDC/Trivy/non-root security boundaries, and zero changes to Core's live `api + web` receiver.

## Decision

Adopt Option 3:

- Consolidate `Arden-AI` (`d534c7f`) into `Arden/services/ai/` preserving commit history (rewriting `(#N)` PR references to `(Arden-Enterprise/Arden-AI#N)` so unrelated Arden PRs are not auto-linked) and archive `Arden-Enterprise/Arden-AI` read-only with a pointer README after Phase 2/3 verification.
- Keep `services/ai/` outside `pnpm-workspace.yaml` (`apps/*`, `packages/*`), Core's `deploy/release/Dockerfile.dockerignore`, and `tools/remote/source.mjs` (`dev:remote`).
- Retain 100% of ADR 0012's runtime isolation: separate hardened non-root (`USER 1000:1000`), `read_only`-compatible Python container (multi-stage digest-pinned Debian 13 `trixie` runtime without `uv`, `curl`, or base `pip`/`setuptools`/`wheel`, pre-baked `tiktoken` cache, disabled Chroma telemetry), zero Arden PostgreSQL credentials or network reachability, separate digest-pinned ChromaDB container/volume per environment, and Core hotfix independence on Core-only pushes.
- Run Python CI (`pytest`, `ruff`, `mypy`, contract parity, Docker build + Trivy `--ignore-unfixed` `HIGH,CRITICAL` and secret scan + offline `--network none --read-only` smoke) in an unprivileged `ai-check` job (`permissions: contents: read`, zero persistent caches). Using `--ignore-unfixed` gates every secret and every fixable OS/Python CVE (and fails closed the day upstream publishes a patch for unfixed Debian `will_not_fix` entries or `chromadb 1.5.9` server-only advisories, while `services/ai` runs strictly as an HTTP client).
- Isolate AI deployment OIDC proofs (Phase 2/3) inside a dedicated reusable `.github/workflows/release-ai.yml` (`job_workflow_ref` pinned, distinct OIDC audience, dedicated AI Coolify bridge & token prefix, shared host lock, explicit `vars.ARDEN_AI_RELEASE_ENABLED` fail-closed gate, read-only dual preflight on `main`).
- Provision isolated production `arden-ai`, `chromadb`, and Core `arden_indexer` (`ARDEN_INDEX_DATABASE_URL`) in Phase 3 before enabling production AI promotion.

## Boundaries and consequences

- Core remains the sole authority for users, AccessPolicy, PostgreSQL migrations, and atomic publication activation.
- AI-only pushes still update `HEAD^{tree}` and trigger a Core build in V1 (explicitly accepted trade-off to keep Core's live receiver untouched during initial consolidation; scoping Core `core_tree` is deferred to V1.1).
- AI contracts must remain additive/backward-compatible so a succeeded AI rollout stays safely live if Core pauses on an `operator` SQL migration.
- Unmerged feature branches in `Arden-Enterprise/Arden-AI` (such as telemetry updates) can be ported onto `services/ai/` in follow-up PRs; `services/ai/schemas/parity-manifest.json` explicitly tracks any pending fixture parity fields.

## Verification and rollout

- **Phase 1 (this branch):** `services/ai` `pytest`, `ruff`, `mypy`, `node tools/releases/ai-contract-parity.mjs`, `node --test tools/releases/ai-contract-parity.test.mjs`, Core `pnpm typecheck`/`test`/`build`/`test:remote`, `migrations:check`, and GitHub Actions `ai-check` (Trivy `HIGH,CRITICAL` + offline `tiktoken` + read-only HTTP `401`/redacted `422` smoke).
- **Phase 2 (planned):** isolated AI receiver unit + Linux root-privilege tests, dedicated Coolify AI bridge, journaled staging AI JSON compose cutover, and first OIDC-verified staging AI release.
- **Phase 3 (planned):** isolated production `chromadb` + `arden-ai` + Core `arden_indexer`, dual-preflight `staging -> main` promotion, and read-only archival of `Arden-Enterprise/Arden-AI`.

## Rules and documentation updates

- [Root AGENTS.md](../../AGENTS.md)
- [Nested services/ai/AGENTS.md](../../services/ai/AGENTS.md)
- [Technology guide](../engineering/technology-guide.md)
- [Implementation status](../engineering/implementation-status.md)
- [Staging and production release guide](../engineering/release-pipeline.md)
- [ADR index](README.md)
- [V1 Specification](../features/ai-monorepo-cicd/SPEC.md) and [Phased Plan](../features/ai-monorepo-cicd/PLAN.md)

## References

- [0012: Separate Python AI service and ChromaDB retrieval index](0012-separate-python-ai-service-and-chromadb.md)
- [Staging and production release guide](../engineering/release-pipeline.md)
- [Development, deployment, and operations rules](../engineering/operations.md)
