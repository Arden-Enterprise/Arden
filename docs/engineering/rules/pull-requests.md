# Pull requests and review

## Prepare, then offer publication

A completed coherent change should have a PR so configured AI reviewers can inspect it before integration. Human PR review is optional. Follow the [completion offer](task-workflow.md#completion-and-the-pr-offer): prepare the reviewable result before asking. Respect an existing approval or a choice to keep the work local.

Before publication:

1. Check acceptance criteria, relevant evidence, privacy, task-owned filenames, and the diff against the intended base.
2. Identify any unrelated local changes/deletions and keep them out of commits/PRs. Use coherent [commits and review batches](git-workflow.md).
3. Prepare the title/body using the PR template. Include purpose, linked issue/decision, behavior, designs/screenshots where relevant, risk, exact checks, configuration/migration/recovery, commit count, authored/total file counts, source-line changes, review batches/runs, and coverage. Apply the [size targets and ceilings](git-workflow.md#reviewable-pr-size); recompute after review fixes.
4. Prefer updating an existing PR for the same coherent work instead of opening duplicates. A separate task gets a separate focused PR; stacked dependencies must name their base and merge order.
5. If complete, open ready for review. If explicitly requested before completion, use a draft and list remaining criteria. Drafts may skip AI review until marked ready.
6. Creating/updating a PR does not authorize merge or deployment. Do not enable paid usage, buy plans, alter review budgets, or change branch protection without appropriate authorization.

## Request useful AI review

Read the dated [AI reviewer reference](../ai-reviewers.md). Complete the [reviewer capacity checks](git-workflow.md#fit-the-enabled-reviewers): verify installed/enabled apps, actual entitlement, branch/path/draft filters, size/context limits, and available approved capacity. Repository visibility alone does not prove free review or an active integration. Record known caps, unknown limits, and coverage gaps without publishing private billing details.

If review requests are authorized:

- Allow the configured automatic initial review to run once.
- If no review starts, inspect the reason and issue one appropriate manual request to the enabled reviewer. Some small public repositories require this.
- After a review completes, assess findings, implement valid related fixes, and push one batch.
- Re-request only when automatic review is absent or paused and relevant changes need inspection. Prefer incremental review; reserve full review for changed base/scope or missing full coverage.
- Do not repeatedly trigger reviews, push cosmetic edits, reopen PRs, change identities, or buy overflow to evade a limit. Record the limit and next useful action.
- Request only supported/configured reviewers. Missing integration or quota is a setup/coverage gap, not permission to install an app or publish private context.

## Validate coverage of the final change

Track each reviewer's state, last reviewed commit, excluded/unreviewed files, and unresolved findings. Compare this with the PR's current head and intended base. A review on older code is stale for affected new changes.

A passing check can mean skipped or rate-limited work. A summary is not necessarily a substantive code review. Read the review result, not only its green badge.

Use these states: completed, partial, pending, skipped, rate-limited, unavailable. Mark bots not configured as not applicable rather than passed. Never treat quota failure, unsupported files, or unavailable reviewers as complete coverage.

If AI coverage is partial/unavailable, identify the affected files and coverage gaps, assess known findings, and provide applicable verification evidence. Partial, stale, skipped, rate-limited, or unavailable AI review does not by itself require human review or block an otherwise ready, authorized merge. Record the limitations in the PR and handoff; never declare missing review passed. Do not bypass actual GitHub requirements or leave required defects unresolved. Generated/lockfile changes still need relevant dependency/build evidence even when an AI tool omits them.

## Handle findings and merge readiness

- Evaluate every material finding against the actual code; do not blindly apply AI suggestions or dismiss a valid issue because another bot disagrees.
- Fix real defects and add applicable evidence. Explain intentional behavior/false positives with safe evidence. Track a justified deferred concern with an owner and follow-up.
- Keep discussions factual and free of private data. Replies/tags are external messages and must be authorized.
- Before merge, resolve required conversations, satisfy actual CI/branch protection, recheck the final revision, and record findings, verification, and reviewer coverage gaps.
- Human PR review is optional. Once merge is authorized and readiness requirements are satisfied, agents may merge without independent human approval or a human-review waiver. Do not add a mandatory human-review gate because an AI reviewer is unavailable.
- Bot auto-approval or a high score does not establish correctness or replace executed verification.
- Merge only when separately authorized; use the approved integration method. Maintain [repository settings](../repository-settings.md) rather than relying on a document to enforce GitHub protection.

Report the PR link, actual checks/reviewer coverage, remaining risks, and next required decision. A completed implementation can await review; it is not automatically ready to merge.
