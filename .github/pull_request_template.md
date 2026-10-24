## Purpose and acceptance

Linked issue or decision:

User/operator outcome and acceptance criteria:

## Approach, design, and risk

What changed, and why? Link relevant designs or ADRs.

Which permissions, publication states, private data, integrations, APIs, migrations, or supported platforms are affected?

Rollout/recovery, limitations, and follow-up owners:

## Evidence

List exact checks run and results. Identify checks not run and why. Add sanitized UI screenshots/recording and keyboard/focus evidence where relevant.

## Scope and review coverage

- Intended base:
- Commits introduced against intended base:
- Total changed files / authored files:
- Added + deleted non-generated source lines:
- Generated/lockfile changes and moved documentation:
- Review-triggering push batches / completed AI runs per reviewer (or unknown):
- Enabled reviewers and verified size/context limits; review-eligible versus excluded files per tool:
- Diff bytes / applicable single-file or token/instruction limits (or unknown):
- Approved capacity status and any wait/alternative coverage; keep private balances and billing details out:
- Explanation above normal targets; named maintainer exception and coverage plan above routine ceilings, if applicable:

Apply the canonical PR size policy in `docs/engineering/rules/git-workflow.md`. Recompute counts after review fixes.

Record actual reviewer coverage; use not applicable for an integration that is not configured. A passing skipped/rate-limited check is not a review.

| Reviewer | State | Last reviewed commit | Skipped/unreviewed files and remaining findings |
| --- | --- | --- | --- |
| CodeRabbit | Pending / not applicable | | |
| Greptile | Pending / not applicable | | |
| Qodo | Pending / not applicable | | |
| Copilot / Bugbot / Gemini / other enabled reviewer (one row each) | Pending / not applicable | | |
| Human reviewer (optional) | Not requested / pending / completed | | |

## Review checklist

- [ ] The PR is focused; branch/title match project conventions.
- [ ] Authorized commits each contain a coherent unit of work.
- [ ] Acceptance criteria and relevant allowed/denied/stale cases are addressed.
- [ ] Authorization, private data, logging, and external confirmation were reviewed where relevant.
- [ ] Public files, examples, designs, and review artifacts contain no private values.
- [ ] Documentation, configuration, contracts, and migration notes match the change.
- [ ] The current code-quality acceptance checklist is met, or justified exceptions and missing evidence are explicit.
- [ ] Relevant UI states and accessibility were reviewed.
- [ ] Exact executed checks and missing evidence are stated honestly.
- [ ] AI findings were assessed and final-revision coverage/gaps recorded.
- [ ] Each requested reviewer fits known size/context limits and approved capacity; unknowns and exclusions are explicit.
- [ ] Before merge: required CI, conversations, actual GitHub protections, and merge authorization are satisfied; human PR review is optional.
