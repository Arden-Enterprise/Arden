# Implementation Plan: Arden-AI Monorepo Consolidation & Automated CI/CD

**Source Spec:** [SPEC.md](SPEC.md)
**ADR:** [0037-monorepo-ai-service-and-release-pipeline.md](../../decisions/0037-monorepo-ai-service-and-release-pipeline.md)

## Phase Status

| Phase | Scope | Status |
| --- | --- | --- |
| **Phase 1** | History-preserving import into `services/ai/` (`d534c7f`), hardened multi-stage `Dockerfile` + allowlist `Dockerfile.dockerignore`, `settings.py` `"staging"` support, unprivileged `ai-check` CI (pytest/ruff/mypy/Trivy/offline smoke), contract parity + Chroma pin checks, ADR 0037 | **Implemented on `feat/consolidate-arden-ai-monorepo`** (PR 1 -> `staging`) |
| **Phase 2** | Isolated AI release receiver (`deploy/release-ai/`), dedicated AI Coolify bridge & token prefix, shared host lock, reusable `.github/workflows/release-ai.yml` with `job_workflow_ref` pinning, qualified `UP_TO_DATE` `ai_tree` reconciliation, journaled staging JSON compose cutover | **Planned** (PR 2 -> `staging` + operator install) |
| **Phase 3** | Isolated production `chromadb` (digest-pinned) + `arden-ai` (`ARDEN_AI_OPENAI_API_KEY`, 2 private networks) + Core `arden_indexer` (`ARDEN_INDEX_DATABASE_URL`), production AI receiver bootstrap, dual read-only preflight on `main`, verified `staging -> main` promotion, read-only archival of `Arden-Enterprise/Arden-AI` | **Planned** |

## Task Checklist

### Phase 1 (Zero Server Risk)
- [x] **1.1** History-preserving import of `Arden-AI` `d534c7f` into `services/ai/` with `(#N)` -> `(Arden-Enterprise/Arden-AI#N)` rewrite.
- [x] **1.2** Harden `services/ai/Dockerfile` (multi-stage digest-pinned, `USER 1000:1000`, `HOME=/tmp`, `ANONYMIZED_TELEMETRY=FALSE`, pre-baked `TIKTOKEN_CACHE_DIR`, no `uv`/`curl`, `io.arden.release.ai_managed="1"`), replace `.dockerignore` with strict allowlist `Dockerfile.dockerignore`, remove obsolete nested PR template, update `services/ai/AGENTS.md`, and add `"staging"` to `settings.py` with unit tests.
- [x] **1.3** Add `services/ai/schemas/parity-manifest.json`, `tools/releases/ai-contract-parity.{mjs,test.mjs}`, `tools/releases/ai-build.mjs`, `tools/releases/ai-smoke.mjs`, and unprivileged `ai-check` job in `.github/workflows/ci.yml` (`enable-cache: false`, `UV_NO_CACHE=1`, shallow-safe path detection).
- [x] **1.4** Add ADR 0037, update `docs/decisions/README.md`, root `AGENTS.md`, and save `docs/features/ai-monorepo-cicd/{SPEC,PLAN}.md`.
- [ ] **Checkpoint 1:** PR 1 green in GitHub Actions (including real Linux Trivy `HIGH,CRITICAL` + offline `tiktoken` smoke), merged to `staging` via **explicit merge commit** (not squash).

### Phase 2 (Staging Automated AI CD)
- [ ] **2.1** Implement `deploy/release-ai/` receiver + Windows/Linux `sudo` privilege test suite (single-image manifest, `MAX_ARCHIVE=1024 MiB`, `MAX_EXPANDED=2560 MiB`, `MAX_MEMBERS=512`, `compresslevel=3`, `360s` timeouts, monotonic `highest`, `assertCurrentHead`, shared host lock).
- [ ] **2.2** Implement dedicated Coolify AI bridge (`arden-ai` only, `arden-release-ai-local-*` token prefix), operator token helper, and `tools/releases/ai-release.{mjs,test.mjs}`.
- [ ] **2.3** Add reusable `.github/workflows/release-ai.yml` (`job_workflow_ref` pinned, `vars.ARDEN_AI_RELEASE_ENABLED` fail-closed gate, `needs: [check, ai-check]`, zero host `uv sync`/`pytest` under `id-token: write`, `always()`-safe Core `needs` guard).
- [ ] **2.4** Operator install on staging host, journaled staging `arden-ai` JSON compose cutover, Coolify-upgrade runbook update, and verified first OIDC staging AI deploy (`force_ai_deploy=true`).
- [ ] **Checkpoint 2:** AI-only staging PR auto-deploys AI; Core-only staging PR skips AI cleanly without contacting AI SSH.

### Phase 3 (Isolated Production AI + Repo Archival)
- [ ] **3.1** Provision isolated production `chromadb` (digest-pinned `1.5.9@sha256:...`, dedicated volume, `prod-ai-chroma` network) and production `arden-ai` (`prod-core-ai` + `prod-ai-chroma` only, zero Postgres reachability, `ARDEN_AI_OPENAI_API_KEY`).
- [ ] **3.2** Provision production Core `arden_indexer` (`ARDEN_INDEX_DATABASE_URL`), `ARDEN_AI_URL`, bearer token, `ARDEN_MAINTENANCE_ANALYSIS_ADAPTER=http-provider`, external `prod-core-ai` network synced into protected production Core template, bootstrap production AI receiver, and enable `vars.ARDEN_AI_RELEASE_ENABLED=true` on `production`.
- [ ] **3.3** Execute dual-preflight `staging -> main` promotion PR (explicit merge commit), verify live production AI + Core, add pointer README and archive `Arden-Enterprise/Arden-AI` read-only after teammate check.
- [ ] **Checkpoint 3:** Both environments verified; historical links preserved.

## Risk & Rollback Summary

- **Trivy CVE failure on 126 Python packages:** Caught automatically by PR 1's `ai-check` on GitHub's Linux runner before anything merges to `staging`.
- **AI deploy failure mid-rollout:** Core deploy is blocked; previous `arden-ai` stays running; operator rollback uses retained `previous` AI image.
- **Core blocked (`REQUIRES_OPERATOR`) on `main`:** Prevented from stranding production AI ahead of Core via read-only dual preflight before mutating either service.
- **Unmerged teammate branches in `Arden-AI`:** Teammates port directly onto `services/ai/` in `Arden`; `Arden-Enterprise/Arden-AI` stays readable/archived as permanent reference.
