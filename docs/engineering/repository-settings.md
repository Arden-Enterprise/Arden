# GitHub settings needed to enforce these rules

Files in this repository provide guidance and a PR naming check. GitHub repository settings are also required for merge protection. A maintainer should verify the following against the current repository, then record who owns the settings. This guide does not assert that remote protections are configured.

1. Create a ruleset targeting `main`: require a pull request, resolved review conversations, and passing status checks. Human approval is optional: do not make approving reviews, code-owner approval, or approval from someone other than the latest pusher required merge gates. Block force pushes and branch deletion. Use the `PR conventions / naming` check after it has run at least once. Require the existing CI matrix checks on Ubuntu and Windows, which run type checks, application tests, remote-development tests and builds; select the exact check names from a completed run. Require additional checks only when they exist and are applicable. Existing GitHub requirements remain enforceable until a maintainer changes them through an authorized settings update.
2. Prefer squash merging and delete merged topic branches. Limit bypass rights and document every emergency bypass with an issue and follow-up review.
3. Enable secret scanning and push protection, Dependabot alerts/security updates, and code scanning where available for this repository and plan. Review dependency changes in PRs. Do not mark an unavailable feature as active.
4. Name responsible code owners once the team and its GitHub handles are confirmed. Add a `CODEOWNERS` file then; do not invent owners now.
5. Establish a private security-reporting route and release owner before publishing a `SECURITY.md` or external release. Define who can rotate credentials, deploy, roll back, and respond to incidents.

GitHub documents [rulesets and their review/status requirements](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets) and [security features](https://docs.github.com/en/code-security/tutorials/secure-your-organization/protect-against-threats). Availability varies by repository visibility and plan.

## AI reviewer setup

The [PR module](rules/pull-requests.md) owns the review workflow. The dated [reviewer reference](ai-reviewers.md) owns vendor limits and eligibility. A maintainer should:

1. Verify each app is installed for this repository, code review is enabled, and the account's actual free/OSS/paid entitlement. Obtain approval before installing an app, sharing additional context, or activating paid usage.
2. Confirm branch, author, path, label, and draft filters; choose when initial and follow-up reviews run. Prefer one useful review per prepared push batch. Record a manual trigger route where required.
   Record the verified vendor/version or hosted product, applicable file/commit/diff/context caps and counting basis, instruction loading/scope, quota window, and approved tier/spend policy. Unknown fields stay explicit. Keep account balances and billing details in approved private storage; publish only safe configuration and review status.
3. Set an explicitly approved spending limit and review tier. Do not enable usage pricing/flex or higher tiers silently. Record an owner for capacity and billing; no credentials belong in these files.
4. Validate that the reviewer loads the canonical modules through its adapter:

   | Reviewer | Repository context adapter |
   | --- | --- |
   | CodeRabbit | [.coderabbit.yaml](../../.coderabbit.yaml) |
   | Greptile | [.greptile/files.json](../../.greptile/files.json) |
   | GitHub Copilot | [.github/copilot-instructions.md](../../.github/copilot-instructions.md) and root [AGENTS.md](../../AGENTS.md) |
   | Qodo, if enabled | Root [AGENTS.md](../../AGENTS.md) and verified repository-scoped Review Standards; see the [reference](ai-reviewers.md#qodo-hosted-code-review) |
   | Bugbot / Gemini / another reviewer, if enabled | Its currently supported rule/context setup, verified against the [reference](ai-reviewers.md); no integration is implied by this table |

   A Markdown link does not prove a vendor imports the linked policy. Qodo's supported filenames and folder scoping must be checked; generic modules under docs may not become repository-wide rules. An authorized maintainer maps applicable canonical standards to repository scope and verifies their activation. Bugbot requires its supported project/team rule setup. Do not invent config fields or silently enable paid automation.
5. Use an authorized representative PR to check actual context, review completion, head revision, and skipped files. Record unverified integrations as pending. A config file or green skipped check is insufficient.
6. Require meaningful CI and evaluation of findings; human PR review is optional. Record partial/unavailable AI coverage honestly. An AI score, bot approval, or a check that passes on quota exhaustion is insufficient evidence on its own; apply the PR module's readiness and authorization rules without introducing a mandatory human reviewer.
7. Recheck vendor facts and adapter schemas at least quarterly and when plans/settings change. Update the reference and owning module together when workflow changes.

Actual enabled settings and responsible owners must be recorded by a maintainer in the team's approved location. These instructions do not assert that integrations, paid allowances, or branch protections are currently active.
