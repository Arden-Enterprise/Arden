# Git workflow

## Branches, titles, commits and preservation

Branch names MUST say what kind of work they contain and what it changes:

```text
feat/knowledge-graph
fix/desktop-sign-in
docs/repository-rules
refactor/content-policy
test/source-revocation
ci/windows-build
```

- Allowed types: `feat`, `fix`, `docs`, `refactor`, `perf`, `test`, `chore`, `build`, `ci`, `release`, `hotfix`, `security`, `revert`.
- Default format: `<type>/<short-kebab-case-description>`; optional issue number belongs in the description, e.g. `fix/123-upload-limit`.
- Use lowercase, meaningful, bounded names. Do not use `new-branch`, `changes`, `work`, `final`, a bare date, or a person's name as the whole description.
- Do not prefix a branch with a tool, agent, or person's name (including `codex/`). The branch identifies the kind and subject of work, not who or what created it.
- `release/<semver>` is the version-only exception. `hotfix/` is for urgent production defects, not ordinary feature work.
- One branch per coherent change, normally based on current `main`. Do not create a permanent `develop` or use branch names as security/deployment isolation.
- Do not rename or switch away from someone else's working branch merely to satisfy naming. Inspect status and ask if their work would be disturbed. An unborn/initial repository may need explicit bootstrap handling.
- Commit each completed, independently reviewable unit of work separately when committing is authorized. Keep related code, documentation, and verification together; preserve unrelated changes and avoid broken intermediate commits. Inspect the proposed diff before committing.
- Use conventional commit subjects: `<type>(optional-scope): concise summary`. A breaking change must explain compatibility and migration consequences.
- Inspect status/diff before edits and before staging. Preserve unrelated tracked and untracked work. Stage explicit task-owned paths; do not sweep a dirty workspace with `git add .`.
- Do not reset, clean, discard, stash, amend others' commits, force-push, delete branches/volumes, or rewrite shared history without specific authorization.
- Commit, push, PR creation, merge, and deployment are distinct actions. Do not infer authorization for publication from a request to edit, explain, diagnose, or review.
- `main` is the integration/release source; normal changes go through reviewed PRs. Bootstrap/emergency exceptions require explicit authorization. Remote protection settings and branch-name checks are not created merely by this document.

PR titles use Conventional Commits: `type(optional-scope)!: summary`, where the summary is at least eight characters and the complete title is at most 100 characters. Allowed types are the branch work types above. Normal branch descriptions contain at least two kebab-case words, with a maximum of 80 characters for the complete branch name; `release/<semver>` is the version exception. The automated check accepts only `type/description` and `release/semver` for contributor branches; it rejects tool/agent prefixes. Dependabot pull requests from the actual `dependabot[bot]` account on `dependabot/` branches remain exempt from naming checks.

The naming check validates syntax, types, lengths, the listed generic descriptions and bare ISO dates. Agent reviewers and optional human reviewers must still enforce descriptive meaning, including person-only names; passing the check is not approval of a name's meaning.

## Reviewable PR size

Use these initial Arden review limits for the complete PR against its intended base:

| Measure | Normal target | Routine review ceiling |
| --- | --- | --- |
| Commits introduced | 10 or fewer coherent commits | 100 commits |
| Authored files changed | 25 or fewer | Count toward the total-file ceiling |
| Total files changed | Report all files, including generated, lockfiles, renames, and deletions | 100 files |
| Added plus deleted non-generated source lines | 400 or fewer | Explain a larger atomic change; no separate line ceiling |

These are local review policies, not universal CodeRabbit, Greptile, Qodo, Copilot, Bugbot, or Gemini limits. The source-line target agrees with the [quality scorecard](../quality-metrics.md). Apply the reviewer capacity checks below in addition to these targets; a local ceiling is never permission to exceed a vendor limit.

Above a normal target, split independent concerns or explain why the larger atomic change is safer in the PR. Above either ceiling, split the work before routine automated review, or obtain a named maintainer's documented exception with the reason, affected files, and an alternative coverage plan before publication. Do not create artificial file fragments, broken PR chains, or silently excluded files to satisfy a count.

A PR holds one coherent outcome. Keep each commit a meaningful unit; do not pad or collapse commits merely to meet a target. Rewriting published history still requires specific authorization. Vendor review events, file limits, and merge-method limits are different quantities; the [reviewer reference](../ai-reviewers.md) explains them.

Record the metrics when marking ready and after review fixes. Count commits reachable from the PR head but absent from the intended base, and count files/source lines in the merge-base diff. For example, substitute verified refs for BASE_REF and HEAD_REF:

```sh
git rev-list --count BASE_REF..HEAD_REF
git diff --name-only BASE_REF...HEAD_REF
git diff --numstat BASE_REF...HEAD_REF
```

Classify authored source, documentation, and generated/lockfile changes explicitly; do not treat raw numstat totals as source lines. Report review-triggering push batches and completed AI review runs where observable; use unknown when unavailable. Follow the [scorecard](../quality-metrics.md) for monthly trends.

## Fit the enabled reviewers

Before the initial review and each follow-up batch, use the dated [vendor reference](../ai-reviewers.md) and current approved account/settings evidence. Check only reviewers enabled and authorized for this repository; the reference is not a requirement to buy or install them all.

- **Files and commits:** Stay within Arden's ceilings and each enabled tool's verified lower cap. Use that vendor's counting basis, including path exclusions where applicable. Report total files, review-eligible files per tool, and excluded/unreviewed files separately. Never remove necessary changes or hide files just to obtain a passing review.
- **Diff and context:** Check applicable diff-byte, single-file, token, and instruction limits. Count the whole submitted context, not only changed source lines. Use a matching tokenizer when an exact token cap applies; character counts and line counts are not exact token counts. Identify truncated rules/content and unsupported files. Unknown limits remain unknown, not unlimited.
- **Runs and budgets:** Check the actual entitlement, trigger settings, charged identity, remaining capacity, reset window, review tier, and approved spend before requesting a run. Aim for one initial run per reviewer, then one run per prepared related-fix batch. Account for automatic runs before issuing manual duplicates. Keep private balances and billing details in approved private storage; report only safe capacity/coverage status publicly.
- **Exceptions:** A maintainer can accept a larger Arden review packet but cannot override a vendor cap or unavailable quota. Split the reviewable work, wait for capacity, or document authorized alternative review coverage. Do not silently buy overflow, switch identities, or declare skipped work reviewed.

Arden's total-file ceiling leaves room below many published limits, including the lowest documented CodeRabbit OSS tier. It does not prove compatibility with a tool whose cap is unpublished, configurable, or account-specific. The PR records the reviewer-specific fit check and final-revision coverage.

## Push in review batches

Keep coherent local commits, then push one batch when the change is ready for feedback. After review, group related fixes and push another reviewable batch.

Wait for an in-progress review before an avoidable new push. A critical corrective change may require an immediate push; explain that the earlier review no longer covers the current revision.

Avoid one push or full re-review per comment/typo. Do not squash or distort useful commit history merely to reduce a presumed commit quota. Do not create duplicate PRs or change identities to evade quotas.

Use the contributor's own approved identity; never share tokens or impersonate another developer. Prefer squash merge for integration after approved review, while preserving the reviewed topic-branch history.

[Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/)
