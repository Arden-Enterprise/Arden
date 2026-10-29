# Safe database migrations in the release pipeline

Status: detailed design approved and implementation authorized by the project lead on 2026-10-30; implementation is partial on local branch `feat/release-migration-runner` and has not been published or activated.

Decision owner / brainstorm originator: project lead. Record author: coding agent at the project lead's request. Approval evidence: the project lead approved the high-level restricted server-side migration-runner approach and later approved this written design on 2026-10-30.

Baseline inspected: `main` at `be27d2c353ad3fc2bdd51660442e52b9df3ca7b3`; `staging` at `6d562f3d4f4f7381d64b2b351f13003d8f816027`. Design branch starts at the inspected staging revision. No live database was queried or changed for this design.

Related task: [ARD-73](https://linear.app/ardenknowledge/issue/ARD-73/add-safe-server-side-database-migrations-to-release-cicd), linked to completed pipeline work ARD-65.

## Intent and why

Arden's GitHub-hosted release pipeline currently checks migrations against one protected, fixed inventory fingerprint and stops when the candidate changes it. It does not apply SQL. The owner wants migration execution to be part of the automated release path without sending database credentials to GitHub or exposing PostgreSQL publicly.

The release design will therefore allow a narrowly scoped, server-side one-shot migration operation. The exact migration image is built and checked on the existing free public GitHub runner. A signed workflow request asks the protected release receiver to inspect and, when eligible, apply migrations to the selected private environment before replacing its app containers.

## Goals

- Run normal SQL migration checks on pull requests against disposable PostgreSQL, with no shared-environment access from PR jobs.
- Determine pending work independently for staging and production from each database's migration ledger and the exact SQL inventory inside the candidate release image.
- Detect changes or removals to already-applied migration files by checksum and stop on unknown, missing, or inconsistent history.
- Automatically apply only migrations explicitly classified as backward-compatible, after applicable target, compatibility, backup, locking, and resource checks pass.
- Keep the current app running while eligible migrations run; activate the candidate app only after all required migrations succeed.
- Promote the same tested artifact to production. A migration must have succeeded and passed staging verification before production may apply that same migration.
- Keep database credentials on the server, separate from the API runtime identity and GitHub. Do not add a public database port or retained GitHub image/artifact/cache storage.
- Fail closed with safe, actionable status codes. Preserve partial migration progress so a later authorized attempt can reconcile from the ledger.

## Non-goals and anti-goals

- No migration at API or worker startup, client-side SQL, `drizzle-kit push`, arbitrary SQL supplied by GitHub, or database connection from a GitHub-hosted runner.
- No automatic destructive, data-resetting, contract-breaking, or compatibility-unknown migration. Those use a separate reviewed operator cutover with its own informed authorization and recovery plan.
- No SQL down-migration or automatic database restore after an application rollback. Application rollback is permitted only while the forward schema remains compatible; restoring data is a separate authorized recovery action.
- No changes to staging or production data, migration ledgers, credentials, Coolify resources, or server configuration as part of implementing this code design.

## Approaches considered

1. **Connect a GitHub runner directly to PostgreSQL.** This is straightforward to orchestrate, but requires a database credential and network path in GitHub, weakens the private-network boundary, and increases the impact of a compromised workflow. Rejected.
2. **Use the existing restricted release receiver for a fixed server-side migration operation.** GitHub builds and signs the exact candidate; the receiver verifies that identity and runs the migration entry point from that candidate API image on the approved private database network, with a server-only migration credential. This reuses Arden's current deployment boundary and keeps SQL access private. Selected.
3. **Run migrations when the API starts.** This can race across replicas, mixes schema authority into the restricted runtime identity, and makes a failed app rollout harder to reason about. Rejected.

## Migration selection and integrity

PR file changes are useful for review and disposable upgrade tests, but they are not the list of SQL to execute. For a given environment, the release receiver asks the exact candidate migration runner to compare:

1. The candidate's ordered migration inventory: migration ID, exact file checksum, and rollout classification.
2. That environment's `public.arden_schema_migrations` ledger, including the recorded checksum for every applied migration.

The pending list is the candidate migrations absent from that environment's ledger. The runner must also verify that every applied ID still exists in the candidate with the same checksum, IDs are unique and ordered, and the ledger does not contain an unknown migration. Any mismatch stops before SQL or app activation. Staging and production calculate separate pending lists; neither environment's state is inferred from a PR diff, a branch name, or the other environment's ledger.

Add a versioned, checked-in migration policy manifest that pairs every SQL file with its ID, SHA-256 over its exact bytes, and rollout class. `.gitattributes` pins migration SQL to LF so Windows and Linux checkouts preserve the same bytes without weakening the checksum's ability to detect a source change. A release build fingerprints this manifest and SQL inventory together; the API image and signed release request bind the fingerprint to the exact source tree and image. PR CI rejects missing/extra manifest entries, duplicate IDs, malformed hashes, edits or removals to migration files already present in the PR base, and an unclassified new migration. The hosted plan checks environment-specific applied IDs and checksums; a PR job has no database access and cannot infer that state.

The initial rollout class is one of:

- `expand`: explicitly reviewed as backward-compatible with the currently deployed app, safe to run before its matching app release, and eligible for automatic execution after every runtime gate passes.
- `operator`: compatibility, data impact, runtime, or lock behavior needs an explicitly planned and authorized cutover. It is never run by the automatic operation.

Classifying a migration `expand` is a reviewed decision, not an automated proof. CI can enforce completeness, checksums, policy fields, the known destructive-operation denylist, and version-specific migration rehearsals; it must not claim static SQL analysis proves arbitrary PostgreSQL SQL is harmless. Ambiguous SQL remains `operator`.

Existing database ledger rows currently contain migration IDs and timestamps, not per-file checksums. Before automatic mode is enabled for either environment, a separate operator-only baseline step must compare that environment's actual ledger with the exact already-approved active release inventory and add matching checksums without executing migration SQL. It must stop on any unexplained ID, source mismatch, or uncertain live target. The baseline records its source release and operator evidence; it is not silently inferred by the new CI workflow.

The inspected staging source has migrations `0022` and `0023`, beyond main's documented `0021` baseline. They remain `operator` until individually reviewed and explicitly reclassified; implementing automation must not apply them implicitly. The target's live ledger must be re-read during the later authorized bootstrap because this design inspection did not access the database.

## Release sequence

### Pull request

1. Run existing checks and disposable PostgreSQL tests. Apply the full migration chain to a clean database and exercise the existing constraints/RLS suite.
2. Rehearse a supported upgrade path from the current release schema to the candidate, including failure and retry behavior where fixtures support it.
3. Validate migration-policy completeness, hashes, ordering, supported rollout class, immutable migration history relative to the PR base, and known forbidden destructive statements. The PR job has no staging/production SSH identity, OIDC environment, or database credential.
4. No shared database or Coolify service changes during PR checks.

### Push to `staging`

1. After required CI and image checks pass, the runner creates the existing temporary release bundle. No persistent GitHub artifact or cache is introduced.
2. A signed, environment-bound `plan-migrations` request reaches the fixed staging receiver. Using the candidate manifest, it checks the exact workflow identity, current branch head, candidate tree/inventory, release lock, staging target, recent health, disk/resources, verified backup readiness, migration baseline/checksums, and policy. This is read-only and can stop an ineligible release before transfer. If a previous authenticated migration attempt left a durable pending record, the plan reports `RECOVERY_REQUIRED`; the workflow must use the separate signed reconciliation operation and request a fresh plan before upload.
3. When the plan is eligible, upload the bundle to protected temporary server storage. The receiver validates the complete archive, image identities and migration fingerprint against the signed request. An incomplete or mismatched upload stops here; no SQL has run and no app has been replaced.
4. If no migrations are pending, continue to app activation. If all pending migrations are `expand`, invoke one fixed one-shot command using the validated candidate API image, a root-only staging migration credential and the approved private database network. The operation accepts no caller-provided SQL, command, URL, container, network, path, or target identifier.
5. Apply migrations in ID order, one transaction per migration, using the existing migration advisory lock and a bounded connection, lock timeout, statement timeout, memory and CPU budget. Record a checksum with the migration ID in the same transaction. No migration is started if another release or migration owns the environment lock.
6. Only after the candidate inventory is satisfied does the receiver update the staging web/API image pair. Verify actual image identity, readiness, public HTTPS and anonymous API denial before recording a successful staging release.
7. On a failed migration, leave the app pair unchanged and the workflow red. Earlier committed `expand` migrations remain recorded. A later, newer signed workflow first receives `RECOVERY_REQUIRED`, then invokes a separate authenticated reconciliation operation. The receiver stops or confirms stopped only the named container from the recorded attempt, then attempts and immediately releases the same PostgreSQL advisory lock with a bounded probe. It verifies the prior app and re-reads the target ledger under the release lock only after that probe confirms the migration lock is free. The same probe runs after each migration command and before its ledger reconciliation. It clears pending state only when the container, lock, app and database outcome are understood; the workflow then requests a fresh read-only plan and runs only still-pending eligible migrations. Never blindly repeat SQL whose outcome is uncertain. If the lock is held or any container/database result cannot be established, stop for operator reconciliation.

### Promotion to `main` / production

1. Require the same tested source tree, migration inventory and image pair to have a successful staging release and migration receipt. Rebuilds or mismatched migration checksums cannot substitute for that evidence; reuse the image already validated on the server rather than uploading a different build.
2. Independently plan against the production ledger and verify production's own backup readiness, target, compatibility and locks. Run only pending `expand` migrations whose exact IDs/checksums were successfully applied and verified in staging.
3. Keep the currently deployed production app running until all required migrations succeed, then promote the same tested image pair and verify exact identities, readiness, HTTPS and anonymous denial.
4. Any missing staging receipt, schema drift, unverified legacy checksum, `operator` migration, backup failure, or uncertain operation halts before application activation. A failure never causes automatic SQL rollback or database restore.

## Trust, resource, and operational boundaries

- Reuse the existing OIDC request signature and environment-forced SSH receiver. Add only fixed protocol operations with exact fields and fail-closed validation. PR/fork jobs cannot invoke mutating operations.
- Store one migration credential per environment in protected server-only configuration, separate from GitHub secrets and the app's runtime database login. The one-shot process receives it only for the bounded invocation; never log the URL, password, SQL text, row data, or raw database exception. Verify the exact least-privilege migration role/grants before activation.
- Execute from the immutable, already scanned API image, with no source checkout, package installation, privileged container mode, extra host mounts, or Docker socket in the container. The root-owned receiver fixes the database network and all runtime limits from its protected environment config.
- Hold the receiver's shared release lock across state changes. The migration runner holds PostgreSQL's advisory lock around its ledger check and SQL; a separate bounded probe acquires and releases that lock to prove it is free before reconciliation. Bound runtime and output. Use the actual safe operation statuses (`NO_PENDING`, `READY`, `APPLIED`, `REQUIRES_OPERATOR`, `DRIFT`, `BACKUP_NOT_READY`, `RECOVERY_REQUIRED`, `RECONCILED`, `OUTCOME_UNKNOWN`) without SQL or secrets.
- The current docs say the release pipeline does not provide verified database backups/restores. Automatic migration remains disabled per environment until that environment has an approved backup/restore readiness record and the receiver can fail closed when it is missing. Do not invent RPO/RTO or silently treat a Coolify snapshot as a tested restore.
- Keep the existing pre-migration fingerprint check as a legacy baseline gate until the per-migration ledger checksums and protected baseline are established. Remove/replace it only in the same verified cutover that proves the new comparison path; never simply bypass it.

## Failure and recovery behavior

| Condition | Required behavior |
| --- | --- |
| Candidate ledger differs, applied SQL checksum changed/missing, or unknown row exists | Stop before SQL and app activation; report `DRIFT`; operator reconciles with a reviewed fix-forward plan. |
| Pending migration is `operator` or unclassified | Stop before SQL and app activation; report IDs and safe reason; prepare a separate cutover plan and authorization. |
| Backup/restore readiness absent or stale under the approved policy | Stop before SQL and app activation; do not treat a backup request as success. |
| Migration fails before commit | Roll back that transaction, leave its ledger row absent, retain any prior committed compatible `expand` rows, keep app unchanged, and report failure. |
| Runner disconnects or times out | Stop or confirm stopped the exact named attempt container, then prove the PostgreSQL advisory lock is free before querying the target ledger under the release lock. Clear pending state and resume only from verified state; if the lock, container or database state remains uncertain, require operator reconciliation. |
| All migrations succeed but app activation fails | Keep the database at the forward schema; restore the prior app pair only when its compatibility with all applied `expand` migrations is proven. Do not issue SQL down-migrations. |
| Production lacks a matching successful staging migration receipt | Stop before production SQL and app activation. |

## Acceptance criteria

- `MIG-01`: PR CI validates policy/inventory/checksums and runs disposable clean-install and supported upgrade migration checks with no shared-environment secrets.
- `MIG-02`: The exact candidate release image and OIDC identity are bound to every migration plan and execution.
- `MIG-03`: Pending IDs are calculated from each target's own ledger; PR diffs only trigger review/tests and never determine hosted execution.
- `MIG-04`: Applied migration edits, removals, unknown IDs, checksum gaps and invalid ordering fail closed.
- `MIG-05`: Only explicitly reviewed `expand` migrations run automatically; `operator`/unclassified migrations stop the release before app replacement.
- `MIG-06`: A root-restricted one-shot container uses environment-specific private network/credential and fixed command/limits; GitHub and app runtime never receive the migration URL.
- `MIG-07`: Migrations are serialized, recorded by ID/checksum transactionally, and a safely retried attempt skips only proven-applied work.
- `MIG-08`: Staging verifies the migration and application before production can apply the same migration and promote the same image pair.
- `MIG-09`: Missing backup readiness, target mismatch, schema drift, failed migration, or uncertain result blocks deployment without arbitrary retries, SQL rollback, or data reset.
- `MIG-10`: Existing receiver authentication, release fencing, resource separation, immutable artifact flow, and temporary-only GitHub build storage remain intact.
- `MIG-11`: Operations and release guides explain the checksum baseline, migration classification, failure recovery, one-time private setup and what remains unconfigured; no secret values enter public docs/logs.
- `MIG-12`: Implementation, verification, GitHub publication, live configuration, staging deployment and production deployment are reported separately.

## Implementation resolution and remaining rollout

- The canonical policy is `apps/api/migrations/release-policy.json`; the candidate inventory and checksum are bound into release metadata and the signed request. The migration ledger carries per-ID checksums.
- The one-time checksum baseline is the explicit root-only `baseline-migrations <environment>` operator operation. It records the currently active exact image/ledger state; it does not apply pending SQL.
- Server migration URLs remain in root-only per-environment env files. A separate non-superuser migration login is checked against the exact private DB target, and a protected backup-readiness receipt must be fresh and tied to the selected environment/network/database.
- Tasks 1–3 implement policy/inventory, planner/CLI, and receiver execution/reconciliation. Task 4 adds release-client ordering and a disposable built-image smoke. Task 5 records the decision and operator handoff. Local automated checks passed as listed in [Decision 0016](../../decisions/0016-github-hosted-server-side-migrations.md); the Docker/PostgreSQL image smoke and Linux-only hosted maintenance tests have not run on this Windows workstation.
- Live enablement still requires server-side URLs/roles, exact checksum baselines, tested backup/restore evidence for staging and production, a successful published staging workflow and verification, and a separately verified production promotion. No live migration or deployment is authorized by this design approval alone.

## Related current contracts and evidence

- [Current main context](../../engineering/rules/main-context.md)
- [Operations](../../engineering/operations.md), especially migration compatibility and backup/restore requirements
- [Release pipeline design](../../engineering/release-pipeline-design.md)
- [Release pipeline guide](../../engineering/release-pipeline.md)
- [Decision 0001: Supabase and hybrid development](../../decisions/0001-supabase-and-hybrid-development.md)
- [GitHub Actions OIDC](https://docs.github.com/en/actions/reference/security/oidc)

The original main-branch release design said that its CI credential had no automatic SQL capability. [Decision 0016](../../decisions/0016-github-hosted-server-side-migrations.md) supersedes that single constraint only for the fixed, server-side, checksum-verified, explicitly classified `expand` operation described here. All other target, backup, compatibility, privacy, artifact, and authorization constraints remain in force.
