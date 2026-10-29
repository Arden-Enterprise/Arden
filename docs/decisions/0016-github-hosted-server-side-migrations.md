# 0016: Run approved expand migrations through the release receiver

Status: accepted
Date: 2026-10-30
Decision owner/approval: project lead; approved in the project conversation on 2026-10-30
Brainstorm originator / record author: project lead raised the deployment failure and requested an automated migration runner; Codex developed and recorded the design
Approval evidence and exact source/spec revision: the project lead approved the written design at `docs/superpowers/specs/2026-10-30-safe-release-migrations-design.md` and authorized its implementation on 2026-10-30
Implementation: partial, local feature branch only; GitHub publication, private server setup, staging and production verification are pending
Supersedes / superseded by: supersedes only the release-design restriction against all automatic SQL; other migration, recovery, identity and deployment decisions remain in force

## Context and requirement

The existing release workflow builds and scans immutable web/API images on free public GitHub runners, then asks a restricted receiver on the server to activate the app. A release previously failed while transferring/deploying; its HTTP readiness endpoint alone could not prove whether the intended release was running. The project needs a repeatable way to select and run safe database changes without exposing PostgreSQL or its credentials to GitHub.

Migration selection must reflect the target database's actual ledger and the exact candidate image. A PR file list is not evidence that a migration is pending on staging or production. Existing migration `0018_flow3_contract_and_test_content_reset.sql` is destructive and remains an operator-only migration; it must never run as an automatic release migration.

## Options and tradeoffs

1. Connect GitHub runners directly to each PostgreSQL database. This is easy to script, but puts database credentials and a network path in GitHub and increases the impact of a compromised workflow. Rejected.
2. Run migrations during API startup. This mixes schema authority into the runtime identity, can race between replicas, and couples app boot failure to database state. Rejected.
3. Reuse the existing authenticated, forced-command release receiver to run a fixed migration mode from the verified candidate API image on the server's private database network. This keeps credentials server-side and adds a bounded operation to an existing trust boundary. Selected.

## Decision

- Each numbered SQL migration has an immutable checksum and an explicit rollout class in the checked-in migration policy. New or unclassified migrations do not become automatic by default. Only reviewed `expand` migrations are eligible; `operator` migrations require a separate reviewed cutover and authorization.
- PR checks validate the inventory, immutability and SQL safety rules and use disposable PostgreSQL only. Pull requests and forks never receive deployment identity or migration access.
- At release time the runner sends a signed, candidate-bound, read-only plan before staging upload. The receiver reports only allowlisted status and migration IDs. After upload validation, the receiver recomputes the plan under the shared release lock from the exact candidate image and that environment's private ledger. The earlier read-only response never authorizes SQL by itself.
- The receiver runs eligible SQL with a fixed, one-shot, resource-limited process and a distinct non-superuser migration login on the private database network. It uses a PostgreSQL advisory lock and per-migration transactions, records each applied checksum, and emits no SQL, row data, raw database error or credential to GitHub.
- Each environment has a protected checksum baseline and current backup/restore-readiness evidence before automatic SQL is allowed. Readiness is target-specific and fails closed when absent, stale or inconsistent. A Coolify snapshot alone is not proof of a tested restore.
- Staging must complete the migration and application release successfully before production can plan the same source-tree inventory. Production reuses the verified staging image pair; it independently plans against the production ledger and requires the staging migration receipt.
- A blocked, unknown or uncertain result leaves the current app in place and prevents activation. Already committed compatible `expand` migrations remain recorded and are reconciled from the ledger on a later authorized attempt. There is no automatic SQL rollback or database restore. App rollback is allowed only when compatibility with the forward schema is proven.
- GitHub receives neither migration credentials nor retained build images/artifacts/cache. Build and verification work remains on temporary standard public-repository runners; SQL runs only on the server.

## Boundaries and consequences

Automatic migration is deliberately narrower than automatic deployment. It excludes destructive, reset, contract-breaking and compatibility-unknown SQL; any migration can be held at `operator` until reviewed. The fixed receiver operation and the DB login must not be repurposed for shell access, arbitrary SQL, arbitrary images, networks, mounts or targets.

This decision does not approve a live migration, reset, credential change, Coolify change or deployment. The initial server configuration must be reviewed and installed per environment, including separate least-privilege migration logins, verified checksummed baselines, current backup evidence and a tested restore within the documented readiness window. No public/private connection values or credentials belong in this record.

If the one-time baseline or backup/restore prerequisite is not ready, releases requiring SQL stop safely. This can delay deployment until an operator completes the prerequisite; it does not authorize bypassing the gate.

## Verification and rollout

Required evidence is recorded separately from this accepted policy:

- Inventory and SQL classification checks; disposable fresh-install and supported-upgrade tests.
- Receiver tests for signed identity, target separation, locks, safe statuses, drift, missing backup/baseline, partial commit, timeout/uncertain outcomes and activation recovery.
- Built-image smoke against temporary PostgreSQL, using a restricted migration role; verify plan, apply, checksum ledger and idempotent no-op.
- GitHub staging run and live identity/readiness/denial checks; only then production promotion and equivalent checks.

Local Windows verification on 2026-10-30 passed typecheck, unit/request tests, remote-workflow tests, production builds, 35 release-client/inventory tests and 99 release-receiver tests (8 platform skips). The current workstation has no Docker CLI, so built-image/database smoke and Linux-only hosted maintenance tests were not run locally. GitHub CI, publication, private server setup and live deployments remain pending.

## Rules and documentation updates

- [Safe migration design](../superpowers/specs/2026-10-30-safe-release-migrations-design.md)
- [Release design](../engineering/release-pipeline-design.md)
- [Release guide](../engineering/release-pipeline.md)
- [Operations guide](../engineering/operations.md)
- [Implementation status](../engineering/implementation-status.md)

## References

- Repository implementation: `apps/api/src/db/migrate.ts`, `apps/api/src/db/migration-plan.ts`, `apps/api/migrations/release-policy.json`, `deploy/release/management.py`, and `deploy/release/receiver.py`.
- [PostgreSQL transaction and advisory-lock documentation](https://www.postgresql.org/docs/current/explicit-locking.html)
- [GitHub Actions OIDC documentation](https://docs.github.com/en/actions/concepts/security/openid-connect)
