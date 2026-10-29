# Safe Release Migrations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Arden's GitHub-hosted release flow plan pending migrations per environment and apply only explicitly safe, checksummed migrations on the server before application activation.

**Architecture:** GitHub validates and builds one temporary release bundle. A signed read-only plan checks the candidate migration inventory against that environment's database ledger. After upload and archive validation, the root-owned release receiver starts one bounded container from the exact API image to apply eligible migrations on the private database network, then activates the app pair. Production independently checks its ledger and requires the same migration inventory and image to have passed staging.

**Tech Stack:** Node 24, pnpm 11.19.0, TypeScript, PostgreSQL, Python 3 standard library, GitHub Actions OIDC, existing SSH forced-command receiver and Coolify adapter.

**Spec:** `docs/superpowers/specs/2026-10-30-safe-release-migrations-design.md`

## Global Constraints

- Main baseline inspected: `be27d2c353ad3fc2bdd51660442e52b9df3ca7b3`; implementation branch starts at staging `6d562f3d4f4f7381d64b2b351f13003d8f816027`.
- Pending IDs come from each environment's own `public.arden_schema_migrations` ledger; PR diffs never choose hosted SQL.
- Database credentials stay in root-protected, per-environment server configuration; never add them to GitHub, app runtime, source, or logs.
- No public database port, API-startup migration, arbitrary SQL/requested shell command, retained GitHub artifact/cache, registry push, SQL down-migration, or automated restore.
- Only reviewed `expand` entries are eligible for automatic execution. Existing `0022` and `0023` remain operator-class unless separately reviewed and reclassified.
- Every migration stays serialized; its ID and checksum commit atomically with its SQL. An uncertain result stops for ledger reconciliation.
- Backup/restore readiness and legacy-checksum baseline must fail closed. Implementation does not change live databases or deploy staging/production.
- Preserve the existing release lock, OIDC identity/fencing, immutable image validation, Coolify resource boundaries, and all unrelated work.

## Files and responsibilities

- `apps/api/migrations/release-policy.json` — reviewed rollout class and checksum for every SQL migration.
- `apps/api/migrations/inventory.mjs` and `inventory.d.mts` — shared inventory validation, raw-byte hashing, ordering and fingerprint implementation for API and release client.
- `apps/api/src/db/migration-plan.ts` — pure pending/drift/policy decision from candidate entries and ledger rows.
- `apps/api/src/db/migrate.ts` — read-only plan and bounded apply-safe entry points; per-migration transaction and ledger update.
- `deploy/release/migration-ledger.sql` — versioned, idempotent control-ledger checksum-column extension for existing databases.
- `deploy/release/bootstrap_operator.py` — root-only one-time legacy checksum baseline; never part of the CI receiver protocol.
- `deploy/release/protocol.py`, `identity.py`, `entrypoint.py`, `receiver.py`, and `management.py` — exact request validation, signed plan, protected one-shot execution, receipts, and fail-closed recovery.
- `tools/releases/release.mjs` and `tools/releases/migrations.mjs` — release inventory binding, plan/upload/deploy ordering, and developer/CI inventory checks.
- `deploy/release/tests/*`, `apps/api/src/db/*test.ts`, and `tools/releases/*test.mjs` — pure planning, migration, identity, receiver, and failure regression evidence.
- `.github/workflows/ci.yml` and `tools/releases/smoke.mjs` — disposable database tests and the built-image migration boundary; no shared database credentials.
- `docs/decisions/0016-github-hosted-server-side-migrations.md`, `docs/decisions/README.md`, `docs/engineering/release-pipeline-design.md`, `docs/engineering/release-pipeline.md`, `docs/engineering/operations.md`, and `docs/engineering/implementation-status.md` — accepted decision, migration/release runbook, and truthful rollout status.

## Review Focus

1. Legacy databases have ID-only rows: baseline must match the protected active release, add checksums without running pending app SQL, and refuse unknown IDs or fingerprint mismatch. Pin in `deploy/release/tests/test_migration_baseline.py`.
2. A process can commit SQL and lose its SSH response: retry must reconcile the exact target ledger and skip only checksum-verified rows. Pin in `apps/api/src/db/migration-plan.test.ts` and `deploy/release/tests/test_receiver.py`.
3. A public PR can omit or forge policy entries, change old SQL, or classify a destructive migration as `expand`: inventory/base checks fail closed; classification remains an explicit review decision. Pin in `tools/releases/migration-inventory.test.mjs` and migration policy tests.
4. A request can be replayed, stale, wrong-branch, wrong-environment, or carry changed inventory/image data: OIDC, run fencing, exact manifest and receiver checks reject it before DB mutation. Pin in `deploy/release/tests/test_protocol.py`, `test_identity.py`, and `test_receiver.py`.
5. Backup readiness or the private migration connection can be absent, wrong, or fail partway: no app activation follows; safe partial ledger state is reported without SQL, credential, or row data. Pin in `deploy/release/tests/test_management.py` and `test_receiver.py`.

---

### Task 1: Build the checked-in migration inventory and policy

**Files:**
- Create: `apps/api/migrations/release-policy.json`
- Create: `apps/api/migrations/inventory.mjs`
- Create: `apps/api/migrations/inventory.d.mts`
- Create: `tools/releases/migrations.mjs`
- Create: `tools/releases/migration-inventory.test.mjs`
- Modify: `tools/releases/release.mjs`
- Modify: `tools/releases/release.test.mjs`
- Modify: `.github/workflows/ci.yml`
- Modify: `package.json`

**Interfaces:**
- `loadMigrationInventory(migrationDirectory, policyPath)` returns ordered `{ id, filename, sha256, rollout }[]`; accepts only exact numbered SQL filenames, valid lowercase SHA-256 digests, unique IDs, a complete one-to-one policy mapping, and rollout values `expand` or `operator`.
- `fingerprintMigrationInventory(entries)` returns the stable SHA-256 fingerprint over canonical JSON entries.
- `tools/releases/migrations.mjs check --base <sha>` verifies inventory, rejects edits/removals to SQL files present in the base revision, and rejects known destructive SQL constructs in `expand` entries; `refresh` updates only checksums for IDs already registered and fails if an unregistered migration exists. Registration requires the author to choose a rollout class explicitly.
- Existing `release.mjs metadata()` consumes the shared module and includes the complete inventory in the signed release manifest; the image label retains its aggregate fingerprint.

- [x] Step 1: Add inventory and policy fixtures covering missing/extra entries, duplicate IDs, malformed hashes, invalid rollout values, raw-byte hashing, deterministic ordering, immutable base history, and destructive constructs blocked for `expand` entries.
- [x] Step 2: Run `node --test tools/releases/migration-inventory.test.mjs`; observed the expected missing-implementation assertion before adding the loader.
- [x] Step 3: Implement the manifest and shared `.mjs` loader. Register all current staging migrations with their exact SHA-256; keep all existing migrations `operator` by default, including `0022` and `0023`. Add the base-history and conservative destructive-SQL checks plus `check` and `refresh` CLI without automatic class changes.
- [x] Step 4: Update release metadata/fingerprint to use the shared loader and extend release tests for manifest-to-image identity. Add CI invocation for migration inventory checks.
- [x] Step 5: Run `node --test tools/releases/migration-inventory.test.mjs tools/releases/release.test.mjs`; all 21 tests passed.
- [ ] Step 6: Inspect and commit only Task 1 files as `feat(release): validate migration inventory`.

### Task 2: Add checksum-aware migration planning and the legacy baseline

**Files:**
- Create: `apps/api/src/db/migration-plan.ts`
- Create: `apps/api/src/db/migration-plan.test.ts`
- Create: `apps/api/src/db/migration-command.test.ts`
- Create: `deploy/release/migration-ledger.sql`
- Create: `deploy/release/tests/test_migration_baseline.py`
- Modify: `apps/api/src/db/migrate.ts`
- Modify: `apps/api/package.json`
- Modify: `apps/api/src/db/repository.integration.test.ts` only if its ledger fixture needs the new column
- Modify: `deploy/release/bootstrap.py` for cross-platform baseline validation and SQL-boundary helpers
- Modify: `deploy/release/bootstrap_operator.py`
- Modify: `deploy/release/tests/test_bootstrap.py`

**Interfaces:**
- `planMigrations(inventory, ledgerRows)` returns `{ status, pending }` or a typed fail-closed status for checksum baseline required, unknown applied ID, changed/missing checksum, malformed ledger, or operator-class pending migration.
- Migrator CLI modes are `--plan` (read-only JSON), `--apply-safe` (apply only pending `expand` rows), and a local disposable-database mode for the existing full-chain CI/test command. Production without an explicit mode refuses to run.
- The root-only baseline operation verifies the exact approved active migration fingerprint and applied IDs, applies only the versioned checksum-ledger DDL from `deploy/release/migration-ledger.sql`, then backfills checksums for already-applied IDs from that active image. It never runs pending migration SQL and stores a protected baseline receipt.

- [x] Step 1: Add pure planner and explicit-command tests for pending selection, no pending work, operator-class blocking, missing/extra IDs, null checksum, checksum mismatch, ID ordering, a checksum-proven partially applied chain, and local target/mode guards.
- [x] Step 2: Run `pnpm --filter @arden/api exec vitest run src/db/migration-plan.test.ts`; observed missing planner and command boundaries before implementation.
- [x] Step 3: Implement the pure planner and migrator modes. Acquire the existing advisory lock, compare checksums, apply each safe migration transactionally, and insert its checksum in the same transaction. Emit only bounded structured status, never SQL or raw database errors.
- [x] Step 4: Add the idempotent ledger DDL and root-only baseline operation. Keep pure validation/statement construction in cross-platform `bootstrap.py`. Test approved-fingerprint success, idempotent repeat, wrong target/source refusal, unknown row refusal, and that the baseline statement set only alters the control ledger and updates checksums for already-applied IDs.
- [x] Step 5: Run the planner/command tests, the migration baseline tests, API typecheck/tests, bootstrap tests and Python syntax checks; all passed.
- [x] Step 6: Inspect and commit only Task 2 files as `feat(api): track migration checksums` (`5638ff4`).

### Task 3: Extend the release receiver with signed planning and one-shot execution

**Files:**
- Modify: `deploy/release/protocol.py`
- Modify: `deploy/release/identity.py`
- Modify: `deploy/release/entrypoint.py`
- Modify: `deploy/release/archive.py`
- Modify: `deploy/release/receiver.py`
- Modify: `deploy/release/management.py`
- Modify: `deploy/release/bootstrap.py`
- Modify: `deploy/release/bootstrap_operator.py`
- Modify: `deploy/release/tests/test_protocol.py`
- Modify: `deploy/release/tests/test_identity.py`
- Modify: `deploy/release/tests/test_archive.py`
- Modify: `deploy/release/tests/test_management.py`
- Modify: `deploy/release/tests/test_bootstrap.py`
- Modify: `deploy/release/tests/test_receiver.py`
- Modify: `deploy/release/tests/test_privilege.py`

**Interfaces:**
- A new signed `plan-migrations` request is bound to the forced environment, source tree, and exact candidate migration inventory. It is read-only and reports allowlisted status/IDs only. Production resolves the candidate from its recent authenticated staging state; it never needs a runner-supplied image ID or a retained artifact.
- Bump the strict release-manifest schema to carry the canonical per-migration inventory; retain read compatibility for existing schema-1 active release/baseline state so the first new-format staging release can recover and compare safely.
- `ReleaseEngine.deploy()` and production `promote()` recompute the plan under the shared release lock after validated image upload/lookup; the earlier plan response is never authority to skip the fresh check.
- `CoolifyManager.apply_migrations(manifest)` invokes a fixed command in the exact API image with a root-protected, per-environment env file, fixed DB network, read-only root, no added capabilities, bounded CPU/memory/pids/time, and no caller-selected command, URL, network, image, mount, or path.
- Protected server config includes only validated paths/identifiers and a backup-readiness source; secret values remain in the root-protected server-only env file. Missing readiness or connection config fails before app activation.

- [x] Step 1: Add protocol and identity tests for valid staging/production plan requests and rejection of wrong branch, environment, operation fields, stale run, malformed manifest, and absent OIDC proof.
- [x] Step 2: Run `python3 -m unittest deploy.release.tests.test_protocol deploy.release.tests.test_identity -v`; observed expected missing-request implementation failures before adding validation.
- [x] Step 3: Implement exact plan request validation and receiver dispatch. Return safe statuses for no pending, eligible pending, operator required, drift, backup not ready, and baseline required. Resolve production planning against the same recent authenticated staging artifact later used by promotion.
- [x] Step 4: Add management command tests verifying exact image, env-file, private network, limits, no arbitrary arguments, and secret-safe errors. Add receiver cases for no-migration deploy, successful migration then activation, migration failure without app replacement, partial success, lost response reconciliation, production staging receipt requirement, exact production-plan artifact resolution, and app rollback compatibility.
- [x] Step 5: Implement locked execution, durable migration receipts, sanitized migration-blocked responses, and failure recovery. Update preflight to use ledger/checksum results instead of bypassing the old fingerprint gate; retain the old gate until the verified checksum baseline is present.
- [x] Step 6: Run `python3 -m unittest discover -s deploy/release/tests -v`; existing release/security tests and new receiver migration tests passed (99 tests, 8 platform-specific skips).
- [x] Step 7: Inspect and commit only Task 3 files as `feat(release): run safe migrations server-side` (`df12aa5`).

### Task 4: Order GitHub release steps and test the built-image boundary

**Files:**
- Modify: `tools/releases/release.mjs`
- Modify: `tools/releases/release.test.mjs`
- Modify: `tools/releases/identity.mjs`
- Modify: `.github/workflows/ci.yml`
- Modify: `tools/releases/smoke.mjs`
- Modify: `deploy/release/Dockerfile` only if the shared migration inventory files are absent from the production API image

**Interfaces:**
- `release.mjs deploy` sends the signed, candidate-bound read-only plan before transfer. Staging then uploads/validates the temporary archive and the receiver's `deploy` recomputes the plan under lock, runs eligible migrations and activates. Production planning/promotion resolves the already verified staging manifest and applies production-specific checks without rebuilding or reuploading a different artifact.
- Workflow order is CI and disposable PostgreSQL tests, candidate bundle, read-only environment plan, complete temporary upload validation, migration, app activation, public/internal verification, then temporary runner cleanup.

- [x] Step 1: Add release-client tests for exact plan-before-upload ordering, current-head fencing at every mutating operation, production image reuse, and no migration request from PR/fork jobs.
- [x] Step 2: Run `node --test tools/releases/release.test.mjs tools/releases/identity.test.mjs`; the new sequencing tests failed before implementation and passed afterward.
- [x] Step 3: Implement the client/workflow sequence and add CI database checks for fresh full-chain install and idempotency on a disposable runner; the built-image test covers safe plan/apply/no-op on temporary PostgreSQL.
- [x] Step 4: Extend built-image smoke to run the production CLI against a disposable database, verify applied checksums and a no-op retry, then start the API with its restricted runtime role. Keep all Docker resources job-owned and temporary.
- [ ] Step 5: Hosted Docker/image smoke remains unverified locally because this workstation has no Docker CLI. Run `node tools/releases/release.mjs check-bundle` on GitHub's temporary hosted runner after publication. The relevant local release-client tests pass.
- [x] Step 6: Inspect and commit only Task 4 files as `ci: run database migration checks before release` (`3b66768`, local only).

### Task 5: Record the accepted architecture and operations handoff

**Files:**
- Create: `docs/superpowers/plans/2026-10-30-safe-release-migrations.md`
- Create: `docs/decisions/0016-github-hosted-server-side-migrations.md`
- Modify: `docs/decisions/README.md`
- Modify: `docs/engineering/release-pipeline-design.md`
- Modify: `docs/engineering/release-pipeline.md`
- Modify: `docs/engineering/operations.md`
- Modify: `docs/engineering/implementation-status.md`
- Modify: `docs/superpowers/specs/2026-10-30-safe-release-migrations-design.md`

- [x] Step 1: Add ADR 0016 with the approved options, migration trust boundary, staging-first compatibility rule, backup prerequisite, checksum baseline, failure behavior, and implementation status.
- [x] Step 2: Update release and operations docs to remove the superseded “no automatic SQL capability” instruction only where the approved safe runner applies; keep destructive migration, backup/restore, operator authorization, and no-live-deployment boundaries explicit.
- [x] Step 3: Document policy registration, disposable migration checks, per-environment pending selection, one-time baseline and private setup, error statuses, and recovery. State that `0022`/`0023` remain operator-class unless reviewed.
- [x] Step 4: Verify all relative Markdown links from changed docs, consistency of commands/status claims against code, absence of private values, and exact branch/commit/acceptance status.
- [x] Step 5: Inspect and commit only Task 5 files as `docs: document safe release migrations` (local only).

## Final verification

- [x] No package manifests or lockfile changed, so `pnpm install --frozen-lockfile` was not needed.
- [x] `pnpm typecheck`, `pnpm test`, `pnpm test:remote`, and `pnpm build` passed.
- [x] The migration inventory and client suite passed: 45 tests across inventory, release sequencing, transport, identity, and PR conventions.
- [x] `deploy/release/tests` passed: 99 tests, 8 platform skips. `deploy/hosted/tests` requires Linux (`fcntl`); this Windows workstation cannot collect it, so the Linux CI job remains its verification path.
- [ ] Disposable PostgreSQL CI migration/RLS/restore checks and the release built-image smoke are not locally runnable because Docker is absent. The workflow executes them on temporary Ubuntu runners after publication. Never point them at Coolify or a shared environment.
- [x] Inspected the final diff, 23-entry migration inventory, relative documentation links and private-value patterns. The local branch has 5 commits over `origin/staging`, 39 changed files, 3,641 total additions/154 deletions, and 3,197 added/137 deleted non-documentation source lines. This exceeds Arden's normal 25-file and 400-source-line targets but stays below its 100-file/100-commit ceilings; a future PR must explain the end-to-end security boundary and coherent task commits. Report implementation, verification, publication and deployment separately.
- [ ] Do not push, request paid reviews, merge, run a live migration, or deploy without the separate authorization required by Arden's rules.
