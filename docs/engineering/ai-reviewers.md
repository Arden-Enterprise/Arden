# AI reviewers: limits and setup reference

Research snapshot: **2026-10-02**. Rechecked **2026-10-24**: CodeRabbit plans/rate limits/configuration schema, Greptile file-reference schema and Qodo review triggers. Other vendor facts below retain the earlier snapshot date. Limits, eligibility, defaults, and billing can change. Recheck the linked sources before changing integration settings or relying on an allowance. The account dashboard and applicable contract determine actual entitlement.

Standing workflow lives in [PR rules](rules/pull-requests.md) and [Git rules](rules/git-workflow.md). Local targets/ceilings and the [reviewer fit check](rules/git-workflow.md#fit-the-enabled-reviewers) work together; no vendor guarantees complete analysis merely because a PR meets Arden's counts.

## CodeRabbit

| Plan | PR allowance per developer/hour | Files per review |
| --- | --- | --- |
| Free | 1; PR summaries only | 150 |
| OSS | 1–10; also scoped by repository | 100–300 |
| Essentials | 5 | 150 |
| Team | 8 | 300 |
| Advanced | 10 | 300 |
| Enterprise | 12 baseline; contract may differ | 300 |

OSS capacity varies with community/popularity. Files are counted after path exclusions. Grandfathered Pro+ subscribers retain 10/hour. Public repositories below 10 stars require a manual trigger. Eligible usage pricing supports at most 300 files; it does not remove that ceiling. [Official plans and limits](https://docs.coderabbit.ai/management/plans)

Review runs consume allowance. Three local commits in one push can cost one review; three separate pushes can cost three. Opening, incremental pushes, manual requests, rebases, reopening, or marking ready can trigger runs depending on configuration. Rolling/fair-use limits can reduce capacity. A superseded running review can consume allowance without delivering feedback. Default automatic review pauses after five reviewed commits; this is not a maximum PR commit count. A rate-limited check can pass even though no review ran. [Review counting and limits](https://docs.coderabbit.ai/management/rate-limits)

Manual commands, only when authorized: `@coderabbitai review` for new changes; `@coderabbitai full review` for full coverage; `@coderabbitai rate limit` to inspect capacity. Check the actual review comment and revision.

The repository's [.coderabbit.yaml](../../.coderabbit.yaml) supplies guideline paths through `knowledge_base.code_guidelines.filePatterns`. Verify schema spelling against the [configuration reference](https://docs.coderabbit.ai/reference/configuration) and [live schema](https://coderabbit.ai/integrations/schema.v2.json).

## Greptile

Starter includes one active developer and 50 credits/month. Pro includes 50 credits/seat/month. Base, Plus, and Apex reviews consume 1, 3, and 10 credits respectively. Free OSS access requires approval for a qualifying non-commercial MIT/Apache project; public visibility alone is insufficient. Do not choose a project license just to obtain a reviewer benefit. [Official pricing and OSS eligibility](https://www.greptile.com/pricing)

Billing counts completed reviews, not PRs, and charges the PR author. Manual requests or enabled opening/push/rebase events can consume more credits. Flex usage can incur charges; an owner can set its limit to $0 to disable paid overflow. Budget changes require authorization. [Billing and review counting](https://www.greptile.com/docs/code-review-bot/billing-seats)

The current schema says older saved review/auto-approval file limits no longer apply. No universal numeric changed-file or commit cap was found in the reviewed documentation; this is not evidence of unlimited practical capacity. Large reviews can time out or be incomplete. [Configuration reference](https://www.greptile.com/docs/code-review/greptile-config-reference), [troubleshooting](https://www.greptile.com/docs/troubleshooting/common-issues)

[.greptile/files.json](../../.greptile/files.json) lists canonical guideline files; each path is relative to the repository root. It supplies context and does not install the app or select a billing tier. Default `autoReview` is opening events; inspect actual settings before expecting push reviews. An authorized `@greptileai` comment can request review. [Developer essentials](https://www.greptile.com/docs/code-review/developer-essentials)

## Qodo hosted code review

Current hosted pricing offers a 14-day trial, no permanent general free tier, and approved OSS access. Paid usage draws from pooled credits; PR size/complexity changes consumption. Published packs include 2,500, 5,000, and 20,000 credits. Approximate reviews/month in marketing are estimates, not fixed review quotas. The page advertises no review/repository count or rate cap, but credits, spending caps, and actual entitlement still govern availability. Overage can continue until the customer-set cap; do not activate paid overage without approval. [Current pricing](https://www.qodo.ai/pricing/)

No universal numeric changed-file/commit cap was found in the reviewed current hosted pricing and workflow docs; this does not establish unlimited context or full-file coverage. Opening/reopening/marking ready triggers review by default; every-push review is optional. An authorized `/agentic_review` comment requests a run. Older PR-Agent/self-hosted model settings are not verified hosted-product limits. [Current triggers](https://docs.qodo.ai/code-review/use-qodo-in-prs), [review overview](https://docs.qodo.ai/code-review/overview)

Qodo imports supported rule files such as AGENTS.md; folder location controls scope. Check actual imported/active rules and repository-wide applicability rather than assuming linked Markdown modules are loaded. Approved imports can activate standards, so perform them only within authorized setup. [File import and scope](https://docs.qodo.ai/governance/rule-enforcement/building-review-standards)

## GitHub Copilot code review

Availability requires a paid plan or organization-enabled coverage. Usage involves token-based AI credits and GitHub Actions minutes for agentic context gathering. Review normally runs once; further push reviews require configuration or a new request. Some files, including dependency manifests, logs, and SVGs, are excluded. No universal numeric file/commit cap was found in this reference. [Official code-review documentation](https://docs.github.com/en/copilot/concepts/agents/code-review)

The short [.github/copilot-instructions.md](../../.github/copilot-instructions.md) points to Arden's shared modules. Check supported context loading and actual coverage. Copilot findings/approval do not replace executed verification; human PR review is optional under Arden's PR policy.

## Cursor Bugbot

Current Bugbot uses usage-based billing; old seat/free allowances may not describe the account. It can run on updates, once per PR, or by mention; default incremental review covers changes since its previous run. Verify final coverage when subsequent updates are skipped.

Each included rule is truncated at 30,000 characters; combined rules are capped at 100,000, with some omitted above that cap. These are instruction limits, not changed-file caps. No universal numeric file/commit cap was found in this reference.

For the Enterprise review-trigger API, the documented limit is 30 requests/minute/team; dry runs have an additional 10/minute/team limit and still incur billing. These API limits are not a stated quota for ordinary PR comments.

The supported project context is .cursor/BUGBOT.md; .cursor/rules/*.mdc does not govern Bugbot. An authorized verbose review can expose which rules were truncated/omitted. Repository trigger YAML reads from the default branch rather than the PR head. [Current Bugbot documentation](https://cursor.com/docs/bugbot)

## Gemini Code Assist on GitHub: Google Cloud edition

The current Google Cloud documentation describes the GitHub app preview with at least 100 PR reviews/day per installation. Actual capacity varies with codebase/model calls, and is separate from IDE/CLI quotas. This is not a per-PR commit or file limit, and must not be applied to a different consumer/product entitlement. No universal numeric file/commit cap was found on this quota page. [Current Cloud quota documentation](https://docs.cloud.google.com/gemini/docs/quotas)

Verify edition, installation quota, trigger behavior, supported context, and actual result before relying on this reviewer.

## GitHub platform limits are separate

GitHub caps displayed PR diffs at 300 files and 20,000 lines or 1 MB raw diff. Compare/PR commit listings show up to 250 commits; the Commits tab has a separate 10,000 limit. Rebase-and-merge supports at most 100 commits. These are display/merge limits, not AI-review capacity. [Repository limits](https://docs.github.com/en/repositories/creating-and-managing-repositories/repository-limits)

## Maintainer setup and periodic review

Use [repository settings](repository-settings.md) to verify installation, eligibility, policy context, trigger filters, and an approved spending limit. Context files alone do not activate an integration or prove a successful review.

Apply Arden's local packet ceilings together with each enabled tool's counting basis and lower verified limits. Check size/context separately from run quotas and billing. A provider's “unlimited reviews” wording does not prove unlimited diff/context, free usage, or complete coverage. Keep unknown caps and actual skipped/truncated files explicit.

The maintainer responsible for review tooling rechecks this reference when adding/changing a reviewer, after a vendor plan/default/schema change, and at least quarterly. Record the date and changed source-backed facts here; keep durable workflow in the rule modules. Add other reviewers only with primary documentation, an approved integration, and a coverage/budget owner.
