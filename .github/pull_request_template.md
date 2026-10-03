## Purpose

What requirement or defect does this change address? Link the issue/decision if applicable.

## Changes

Describe actual behavior changes. Distinguish implemented features from sample data or planned work.

## Verification

List commands/checks actually run and their results. State any unavailable checks. Include screenshots for UI changes.

## Risks and operations

Describe applicable permission/data-flow changes, migrations/backfills, API/desktop compatibility, environment/secrets changes, rollout and recovery steps. Write "Not applicable" when appropriate.

## Review checklist

- [ ] Branch name uses a meaningful work type and description (`feat/`, `fix/`, `docs/`, etc.).
- [ ] Scope is focused; unrelated work and private data are not included.
- [ ] Changed code has clear responsibilities, readable names/types, and narrow testable dependencies; unnecessary abstraction and hidden state are avoided.
- [ ] Tests are deterministic and clean up resources even on failure; relevant quality exceptions/debt have a reason and concrete follow-up (or are not applicable).
- [ ] Applicable regression, negative authorization, and failure-path tests are covered, or gaps are explained.
- [ ] Applicable web/desktop and accessibility behavior is verified, or gaps are explained.
- [ ] Dependencies/APIs/configuration are compatible with the repository's versions.
- [ ] Relevant rules, product/architecture/design docs, setup instructions, and decision records are updated (or explicitly not applicable).
- [ ] Planned/unverified capabilities are not presented as shipped or production-ready.

## Private configuration review

- [ ] Private files are excluded and untracked; public examples, documentation, and PR artifacts contain no private values.

## Commit scope review

- [ ] Each commit contains one coherent unit of work with a descriptive Conventional Commit subject.
