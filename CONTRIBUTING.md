# Contributing to Arden

Read [AGENTS.md](AGENTS.md) first. It is the repository-wide rules entry point, not an optional agent-only note. Detailed guides cover [code quality/testability](docs/engineering/code-quality.md), [technologies](docs/engineering/technology-guide.md), [security/data](docs/engineering/security-and-data.md), and [operations](docs/engineering/operations.md).

## Branch convention

Use `<type>/<specific-kebab-case-description>`. The type must match the purpose:

| Type | Purpose | Example |
| --- | --- | --- |
| `feat` | New user-facing capability | `feat/private-notes` |
| `fix` | Correct a defect | `fix/graph-selection` |
| `docs` | Documentation/rules only | `docs/developer-setup` |
| `refactor` | Restructure without intended behavior change | `refactor/policy-functions` |
| `perf` | Measurable performance improvement | `perf/authorized-search` |
| `test` | Tests or fixtures | `test/publication-versions` |
| `chore` | Maintenance not covered by another type | `chore/dependency-review` |
| `build` | Build system/package tooling | `build/desktop-packaging` |
| `ci` | CI automation | `ci/branch-validation` |
| `release` | Prepare a specific release | `release/0.1.0` |
| `hotfix` | Urgent production correction | `hotfix/session-revocation` |

An issue number may lead the description (`fix/123-upload-limit`). Use plain `feat/` and `fix/` by default. If an execution tool explicitly requires a namespace, `codex/feat/private-notes` is allowed; the work type is still mandatory. Avoid generic names such as `updates`, `task`, `final`, or `new-branch`.

Start a coherent change from current `main` after inspecting existing work. Do not switch/rename a user's branch or discard/stash changes automatically. For an initial repository with no commit, handle bootstrap explicitly rather than pretending a remote base exists. Do not push directly to `main` except for an explicitly authorized bootstrap/emergency procedure.

## Local development

Use Node.js 24 and the root `packageManager` version (currently pnpm 11.19.0). Docker Desktop on Windows or Docker Engine with Compose provides the local database.

```sh
pnpm install
pnpm db:up
pnpm dev
```

Run `pnpm dev:desktop` in another terminal for the Windows desktop shell. Web is `127.0.0.1:5180`, desktop development renderer is `127.0.0.1:5181`, API is `127.0.0.1:3001`, and PostgreSQL is `127.0.0.1:5433`. Web proxies `/api` to the API. The native renderer is bundled locally in a build.

`pnpm db:down` stops the stack without requesting volume deletion. Never add `-v` as routine cleanup. The Compose credentials are local-only. The current API uses shell environment variables and development defaults; copying `.env.example` does not by itself implement automatic API `.env` loading.

Use synthetic seed data and separate local credentials/volumes. Follow [operations.md](docs/engineering/operations.md) for multiple checkouts, isolation, production configuration, and backup obligations. The current Compose file is not a complete production application.

## Changes and commits

- Keep a change focused, preserve unrelated work, and stage explicit owned files. Review the diff and any new files before committing.
- Use conventional subjects: `feat(graph): add scope filters`, `fix(api): reject invalid upload sizes`, or `docs: clarify private AI deployment`.
- Do not manufacture features to fill architectural diagrams. Planned libraries require an actual implementation need and compatibility/license review.
- Update manifests and lockfile together for intentional dependency changes. Do not hand-edit the lockfile, switch package managers, or regenerate it merely for a docs/UI change.
- Add regression tests for fixed behavior; never disable a failing check or remove a negative security case simply to pass CI.
- Meet the [code-quality acceptance checklist](docs/engineering/code-quality.md#acceptance-checklist): cohesive modules, explicit dependencies, testable domain logic, deterministic tests, resource cleanup, and justified/documented exceptions. Keep refactors incremental and avoid unnecessary abstraction or unrelated rewrites.
- Keep lasting decisions and new prevention rules in the correct documentation in the same change. Use [decision records](docs/decisions/README.md) for material tradeoffs.
- Do not include secrets, customer data, full private prompts, build outputs, local databases, credential files, or unrelated generated artifacts.
- Commit/push/PR/merge/deploy only when that action is authorized. Do not rewrite shared history or force-push without specific direction.

## Verification

For code/config/dependency changes, run relevant focused tests and the root checks:

```sh
pnpm typecheck
pnpm test
pnpm build
```

CI performs a frozen-lockfile install and these checks on Ubuntu and Windows. Passing them currently proves scaffold checks only: web/UI have no test scripts yet, API tests are health-route tests, and installer/end-to-end/security coverage is not implemented. Add the relevant evidence as features grow.

UI changes also need actual web/desktop visual and interaction checks where applicable. Database changes need disposable PostgreSQL migration/constraint/authorization tests. Security and governance changes need denial/revocation/exact-version tests. Docs-only changes need links and consistency checks; do not imply application tests ran when they did not.

## Pull requests and review

Describe the purpose, changed behavior, tests actually run, and risks. Include screenshots for visual changes, migration/compatibility steps for data or contract changes, and configuration/data-flow details for infrastructure/security changes. Mark irrelevant checklist items as not applicable rather than asserting they were tested.

Review specifically for:

- Meaningful branch and commit names, scope, and preservation of existing work.
- Clear responsibilities, readable names/types/control flow, narrow testable boundaries, regression evidence, resource ownership, and explicit technical debt.
- User-visible truthfulness: sample/planned versus real functionality.
- Organization isolation, private originals, source audiences, revocation, derived-data leaks, and exact-version publication.
- Web/desktop parity, keyboard access, failure states, and native trust boundaries.
- Version-matched APIs, dependency/license risks, config/secrets, migrations, reproducible deployment, and restoration.
- Updated rules/docs and explicit unresolved decisions or unverified checks.

Intended `main` protections are reviewed PRs, required CI checks on both OS jobs, resolved review conversations, and restricted force-push/deletion. Security-sensitive changes should receive a reviewer familiar with the affected boundary. These are policy requirements; a maintainer must separately configure/verify GitHub protections. This documentation does not configure remote settings or add mechanical branch-name enforcement.

## Private configuration and public documentation

This repository is public. Follow the [private files guide](docs/engineering/private-files.md) before adding configuration, operational notes, or data files. Keep private or security-critical values in excluded local files or approved secret storage, and document setup with placeholders. Check exclusions and existing tracking before committing; never force-add private files. Share actual values through an approved private channel.

For authorized server work, follow the [private server setup guide](docs/engineering/server-access.md). Keep connection profiles in local Git metadata and personal SSH configuration.
