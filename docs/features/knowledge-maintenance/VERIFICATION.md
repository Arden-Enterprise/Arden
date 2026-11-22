# Flow 4 verification plan

## Baseline and environment

- Run from the intended Arden worktree and inspect the actual [root scripts](../../../package.json), [API scripts](../../../apps/api/package.json) and [database CI job](../../../.github/workflows/ci.yml). Use the pinned package manager. Use isolated workspace dependencies and synthetic identities and documents.
- Use a disposable PostgreSQL 17 database with the required extensions. Rehearse a clean combined chain and a staging-era upgrade with fixtures. Run the ownership handoff from the CI job in that environment before testing real actor policies. The [integration harness](../../../apps/api/src/db/repository.integration.test.ts) requires an `arden_test_*` database for `ARDEN_TEST_DATABASE_URL`. Review migration commands and target settings before executing them. Use the reviewed disposable CI flow if this machine lacks required services.
- Known Arden commands are `pnpm migrations:check`, `pnpm --filter @arden/api db:migrate`, `pnpm --filter @arden/api test`, `pnpm --filter @arden/ui test`, `pnpm --filter @arden/desktop test`, `pnpm typecheck`, `pnpm test`, `pnpm test:remote`, and `pnpm build`. Use the migrate command only with an explicitly selected disposable database and the [release procedure](../../engineering/release-pipeline.md). Focus on the current maintenance, repository, UI and desktop fixtures, then run affected checks in the reconciled branch.
- Use `pnpm dev` and `pnpm dev:desktop` with appropriate local sign-in setup for the host walkthrough. Record actual signed-in observations with synthetic data. The frontend's startup alone provides no case evidence. For paired service changes, inspect Arden-AI's actual manifests before `uv run pytest -q`, `uv run ruff check .` and `uv run mypy`.

The 20 November follow-up used a fresh local cluster and rehearsed the CI ownership
transfer after all 54 feature-branch migrations. The runtime tests used a restricted login
with `ARDEN_MAINTENANCE_TEST_RUNTIME_URL` and a fixture owner with
`ARDEN_MIGRATION_DATABASE_URL` on the same disposable `arden_test_flow4_*` database.
Review the [latest evidence](STATUS.md#codex-follow-up-2026-11-20) before repeating it.
The new operator-class migrations and the current staging chain still require a combined
upgrade rehearsal.

## Behavioral checks

Each entry is a planned check. Capture the actual revisions, command and result, fixture and observable proof in [Status](STATUS.md).

### V-01 → AC-01 exact intake

Open v3 as a non-author reader. Report a valid passage. Assert v3 identity and one event and case for two concurrent identical requests. Reuse the key with different text, then submit with an independent key. Exercise a reviewer-started case, stale UI after v4 becomes current, denied anchors and foreign organization refs. Capture returned projection, persisted counts and the reader confirmation.

### V-02 → AC-02 assignment

Race two eligible reviewers and confirm one winning claim and a refreshed loser view. Include author, wrong scope, revoked grant, no eligible reviewer and already closed cases. Admin reassigns with a reason and eligible target. Confirm the previous assignee cannot act. Capture actual runtime-role state, events and authorized queue states.

### V-03 → AC-03 permissions

Use the same case across reporter, inactive member, eligible peer, assigned reviewer, author, Admin and foreign tenant. Revoke source or grant during the session. Assert safe list/detail/history/notification/compare/analysis responses and cleared UI after actor changes. For an active reporter with lost source access assert case ID and status only, even on direct history. Capture response keys and rendered status using synthetic data.

### V-04 → AC-04 history and unread updates

Submit, route, claim, reassign, exchange messages and resolve. Assert one committed state change and ordered events per action, stable pagination including timestamp ties, safe audience filtering, and deduplicated notifications to intended recipients. Simulate a transaction failure and verify atomicity. Read and open an unread item before and after permission revocation. Capture event IDs, permitted inbox states and rollback outcomes.

### V-05 → AC-05 version changes

Use synthetic v3, v4 and v5 where v4 corrects a line and v5 restores it. Step through both pairs, jump to applicable current, open exact sources, and expand unchanged context by keyboard. Exercise future applicability, hidden intermediate, active-pair stability, revocation before response and scan/oversize fallback. Capture exact visible version pair, text labels and anchors, and safe API results.

### V-06 → AC-06 Flow 2 and human confirmation

Preserve staging governance and publication behavior first. Request more detail, reply and resolve one case with **No change needed**. Request a replacement and a withdrawal on separate cases. Show pending, failed, denied, rejected, wrong-document, stale and upcoming paths. Compare approved author withdrawal and Admin direct withdrawal. Prove actual applied withdrawal or an applicable same-document fix is required at human confirmation. Capture case and publication evidence, closing revision and the reporter explanation separately from rationale.

### V-07 → AC-07 bounded analysis

Through paired fixtures and a fake provider, verify source ordering, limits, response schema, citations and approved scope. Race starts and cancel or revoke while a worker holds a lease. Try retry, expired or replaced worker, malformed/out-of-bounds spans and provider failure. Confirm manual continuation, original run scope and explicit rerun after newer evidence. Capture per-run states, stale result denial and an exact authorized citation opened in the UI.

### V-08 → AC-08 signed-in web and Electron

Walk Home, Reader, My reports, Reviews and the case workspace on both platforms. Check keyboard navigation, focus trap/restore, meaningful announcement, long labels, labeled status/diff tokens, reduced motion and small layout. Cover useful loading, empty, error, conflict and revoked states. Use the [design system's viewport matrix](../../../DESIGN.md#accessibility-and-verification). Record platform, dimensions, role, observed action and safe screenshots.

### V-09 → AC-09 recurrence

Resolve a case with a distinct explanation. Report a recurrence on a later version and link it as an authorized reviewer. Close one case while the other keeps its own assignee, status and timeline. Verify denied endpoints and previews for inaccessible linked cases. Capture independent outcomes and unchanged prior history.

### V-10 → AC-10 migration and report cutover

1. Compare both manifests and the intended ledger prefix. Exercise fresh and staging-era disposable databases and show a second migration run is a no-op. Verify immutable staging SQL, policy hash and post-ownership runtime behavior.
2. Seed current and superseded open pins, a report left open by approved author withdrawal, already closed reports, and unverifiable rows. Reconcile each source to its exact imported case, unchanged closed disposition or visible authorized exception. Assert original reference, reporter, text, date, version and audit, one import provenance event, and zero fresh-submission alerts.
3. Race concurrent importers, interrupted commit, stale dismiss and direct withdrawal against import. Test the old-client duplicate response across the switch, a legitimate repeat with the same wording after closure, and new same-key replay. Preserve direct publication withdrawal and a separate Maintenance decision. Verify the authorized **Closed** filter with no triage actions and check imported queue/report projections.

### V-11 → AC-01 through AC-10 whole journey

Walk one case from v3 reader report through claim, chronological compare, analysis with a controlled adapter, author action, applicable publication proof, human resolution, reporter update and authorized audit. Use signed-in web and Electron with synthetic data. Demonstrate a separate recurrence and the cutover path. Attach the individual V-01–V-10 results and exact heads. Track the later real provider check separately before reporting release readiness. Mark missing host, permission, migration or provider evidence as pending.

## Release checks

Repeat relevant checks from the reconciled heads. Use staging and paired Core/AI compatibility evidence only when available from authorized environments. Keep schema rollout and feature activation decisions distinct. For any later authorized rollout, record actual target ledger, verified backup/restore or recovery procedure, rollback compatibility and accepted old-client behavior before switching writers. Preserve immutable migration history and report dispositions. Follow the repository release rules and record remaining release approvals separately.
