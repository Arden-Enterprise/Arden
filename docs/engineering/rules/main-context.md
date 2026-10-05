# Read current main before acting

This module owns the task-start freshness procedure. Read it with the repository [AGENTS.md](../../../AGENTS.md) and [CONTRIBUTING.md](../../../CONTRIBUTING.md). It applies to coding agents and contributors working on Arden.

## When to refresh

Before planning, giving project architecture advice, editing, reviewing, publishing, or operating the server for a new task or chat, check current main and read the documents below. On resuming a task, refresh again if the main baseline may have changed. One fetch/read per unchanged task baseline is sufficient; do not fetch before every command.

Previous conversations, remembered stack choices, cached summaries and an old local branch are not evidence of the current architecture. This procedure does not authorize publication, merge, deployment or access changes; follow the user's actual authorization and higher-priority instructions.

## 1. Fetch without disturbing work

Inspect the intended application's Git root, branch, status and approved remote first. Run these commands inside the Arden checkout:

```sh
git rev-parse --show-toplevel
git status --short
git branch --show-current
git remote get-url origin
git fetch origin main
git rev-parse HEAD origin/main
```

Confirm that `origin` is the approved Arden application repository before fetching; do not invent or change a remote to make the command succeed. The final command reports the checkout commit followed by the fetched main commit. Record both. Fetch updates remote-tracking references, not working files or the current branch.

Do not automatically pull, switch a busy branch, reset, clean, stash, overwrite local edits or rebase existing work. Read the fetched documents with `git show` when the checkout differs. A clean, explicitly authorized update may use a fast-forward; a new implementation branch normally starts from the inspected main. Preserve intentional work on an older release or dependent branch and identify its compatibility differences.

## 2. Read the current contract

Read these from the fetched main revision, even when local copies exist:

- [AGENTS.md](../../../AGENTS.md), [CONTRIBUTING.md](../../../CONTRIBUTING.md), and this module.
- [Technology guide](../technology-guide.md), [decision guidance](../../decisions/README.md), and every accepted decision relevant to the task. For stack, identity and database work, include [decision 0001](../../decisions/0001-supabase-and-hybrid-development.md); check whether a later accepted record supersedes it.
- Task-specific product, blueprint, design, security, operations and setup documents required by those entry points. Read applicable local/nested `AGENTS.md` files for affected paths as well.

For example, these commands read main without replacing a dirty checkout:

```sh
git show origin/main:AGENTS.md
git show origin/main:CONTRIBUTING.md
git show origin/main:docs/engineering/technology-guide.md
git show origin/main:docs/decisions/README.md
git show origin/main:docs/decisions/0001-supabase-and-hybrid-development.md
```

Use the same recorded main SHA throughout this inspection. If the reference changes during the task, review the affected changes again. Inspect manifests, lockfile, source and configuration in the actual target checkout separately: an accepted plan does not prove its libraries or behavior are implemented. For example, a superseded Better Auth proposal must not silently replace the accepted Supabase Auth direction.

## 3. Read changes and resolve differences

When a previous reviewed main SHA is known, compare it to fetched main. Replace `LAST_REVIEWED_MAIN` below with that verified commit:

```sh
git diff --name-status LAST_REVIEWED_MAIN..origin/main -- AGENTS.md CONTRIBUTING.md PRODUCT.md ARDEN_BLUEPRINT.md DESIGN.md docs
```

Read the changed task-relevant documents and patches, plus affected source/config changes. If no previous SHA is available, read the current required documents in full and inspect recent history with `git log -n 10 --oneline origin/main -- AGENTS.md CONTRIBUTING.md docs`; this history sample does not replace reading the current contract.

Compare those contracts with the working branch's committed changes and uncommitted edits. Follow the current accepted direction by default; earlier or superseded documents remain historical context. A new proposal or newer timestamp alone is not an accepted replacement. Higher-priority instructions and explicit user decisions take precedence. Name material conflicts and resolve them before dependent implementation or consequential operations; do not silently choose a stack or overwrite work to remove a disagreement.

## 4. Report the evidence and limitations

In the task update/handoff, record the working branch/HEAD, fetched main SHA, documents/decisions and relevant changes read, plus any material conflict. This can be brief; do not paste private connection details, credentials or raw private evidence. A previous inspected SHA may also be kept in local Git metadata for the next comparison; do not make personal bookkeeping a tracked project file.

If fetch or a required document is unavailable, say that freshness was not verified and identify the last verified revision/date. Continue independent work supported by available context. Pause dependent architecture changes or consequential operations when missing context could change the decision; request the missing context without guessing or describing stale information as current.

After this rule is integrated, teammates must fetch and safely update their checkouts to receive its local agent instructions. Existing chat context does not automatically refresh when a rule is pushed.
