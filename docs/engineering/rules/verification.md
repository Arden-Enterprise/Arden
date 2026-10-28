# Verification and completion evidence

Choose checks that establish the changed behavior at its real boundary. Honor the user's requested verification scope and higher-priority execution constraints. Do not claim planned, skipped, unavailable, or simulated checks ran.

## Implementation includes verification

For requests to implement, change or fix Arden, the maintainer also requests relevant tests and other non-destructive verification within the authorized scope. This standing request applies to every coding agent/model; the user need not repeat "run tests" for each implementation task. Follow any narrower current user instruction and higher-priority execution constraint, and explain any required check they prevent.

Select checks by the changed behavior and risk. Follow the application/configuration checks below when applicable; use factual, link and format checks for documentation-only edits. Verification does not authorize production mutations, external writes, destructive tests or additional infrastructure. Those actions retain their existing [security](security.md) and [server-operation](server-operations.md) boundaries.

## Application behavior

- Include meaningful verification with the changed behavior, especially allowed/denied access, stale publication, revocation, concurrency, and failure cases when relevant.
- For a behavior fix, reproduce the failure and use a focused regression case where practical, then confirm the corrected behavior. If reproduction or regression coverage is unavailable, state what remains unverified.
- Database isolation requires the actual application/worker roles and a disposable real database where mocks cannot establish correctness.
- External actions need exact-confirmation, duplicate/retry, expired capability, and uncertain-outcome cases.
- UI needs applicable keyboard/focus, responsive, status/error, and interaction evidence. Native behavior needs desktop-specific checks; a build does not prove installation, signing, or updates.
- Checks are deterministic and isolated. Clean up resources, timers, mocks, and environment changes; confirm disposable targets before destructive operations.
- Do not weaken checks, fixtures, authorization, or CI to produce a green result.
- After relevant checks pass, repeat or expand them only for a concrete reason such as another edit, a failure or an unresolved concern. Avoid redundant runs and tests that merely restate the implementation.

Use current package scripts and selected tooling, not commands remembered from an old scaffold. The [quality metrics](../quality-metrics.md) define coverage and review thresholds. Name/build checks do not establish full product or security readiness.

## Documentation and configuration

Check relevant facts, relative links, examples, format/encoding, configuration syntax/schema where applicable, and rule/adapter consistency. Inspect public artifacts for private material. Documentation-only checks are not application tests.

Update affected setup, API, data-model, design, operations, migration/recovery, and consequential ADR documentation in the same change.

## Handoff and release

Before concluding, review the task-owned diff for regressions, accidental secrets and outdated guidance. Compare each acceptance criterion with observed evidence; report incomplete or blocked criteria explicitly. Keep **implemented**, **verified**, **published** and **deployed** distinct: a local edit, successful build or passing CI is not evidence that a live environment was updated. A deployment claim requires checking the authorized target.

Use the owning specification's acceptance IDs and complete applicable paths under [specifications](specifications.md). Link each criterion to implementation and obtained evidence; keep unknown/deferred paths explicit. For integration claims, verify the actual intended base/merge reachability rather than relying only on a PR's merged badge.

Report:

- What changed and why.
- Acceptance criteria met and any remaining decision.
- Exact checks executed and results.
- Checks not run and their practical limits.
- Migration/configuration/recovery requirements.
- PR/reviewer status and any missing coverage.

Use [pull requests](pull-requests.md) for latest-revision AI review coverage and optional human review. Release additionally needs supported installation/upgrade/recovery evidence, known limitations, operational ownership, and versioned release notes. Once a public API is declared, follow Semantic Versioning and explain compatibility changes.

[Semantic Versioning](https://semver.org/spec/v2.0.0.html)

## Existing checks and definition of done

For application/config/dependency changes, run applicable focused tests and normally:

```sh
pnpm typecheck
pnpm test
pnpm build
```

- Use the pinned package manager. CI uses `pnpm install --frozen-lockfile` and checks on Windows and Ubuntu; do not introduce Unix-only developer/CI scripts.
- Root recursive scripts only run scripts packages define. Current green checks are **not** evidence of UI, permission, live-database, installer, or end-to-end coverage.
- API tests should use `buildApp`/Fastify injection where appropriate; database rules need real disposable PostgreSQL tests, not only mocks.
- New security-sensitive behavior needs positive and negative authorization cases, tenant isolation, revocation, and failure-path tests. A happy-path screenshot is insufficient.
- New/changed application logic must meet the [code-quality acceptance checklist](../code-quality.md#acceptance-checklist), including appropriate tests or an explicit justified limitation. No unexplained quality exceptions may be hidden by a green build.
- Shared UI needs browser visual/interaction checks; Electron/native behavior needs desktop checks. `pnpm build` is not installer/signing/update verification.
- Docs-only work needs factual consistency, working relative links, and clean Markdown; application tests are optional unless behavior/config also changed.
- Never run destructive tests against real customer/staging/production data. Confirm disposable targets before resets or migrations.
- If checks cannot run, record the exact limitation and what was not verified. Do not claim complete/security-ready based on intention.
