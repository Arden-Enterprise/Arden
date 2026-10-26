# Accepted specifications and decision changes

This module owns specification capture, conflicting decisions, requirement coverage and agent continuity for Arden work, including affected Arden-AI contracts. Follow the user's actual authorization and higher-priority instructions first. The [feature index](../../product/README.md) routes to specifications; it is not a second task tracker or proof of implementation.

## Record what was actually agreed

An explicitly agreed brainstorm outcome that changes a feature, user path, interface, permission, architecture or delivery requirement MUST become a durable specification before dependent implementation proceeds. Update the existing owning specification rather than creating competing copies. Scale the record to the change: a small accepted adjustment can be a short section; a material tradeoff also needs an [ADR](../../decisions/README.md). Do not turn every suggestion into an accepted requirement or a Linear issue.

Use the [feature template](../../product/templates/feature-spec.md). Record:

- Stable feature/requirement IDs, goal, in/out of scope, affected actors and complete applicable user paths.
- The brainstorm originator, accountable decision owner, author of the record, date and actual approval evidence. These are different roles. A Git committer, assignee or document author is not automatically the original decision maker. Say `unknown; confirmation needed` when provenance is missing; do not reconstruct private transcripts or invent agreement.
- Exact specification revision, relevant code/branch/PR references, affected repositories and dependencies. Record where the requirement is integrated separately from where it was proposed or approved.
- Decision state (`proposed`, `accepted`, `superseded`) separately from delivery evidence (planned, partial, implemented, verified, merged, deployed). Link a superseding decision and retain the previous rationale.
- Observable acceptance cases, relevant UI/API/data/permission/platform/failure paths, evidence obtained, remaining work and unresolved questions. An intentionally omitted case needs a reason; silence is not completion.

Preserve the approved audience. Public specifications contain public-safe behavior and provenance only; private attribution/rationale belongs in the approved Knowledge record. A public role label may route to private owner details without exposing them. Do not publish names, private discussion links or text merely to fill a template.

Before ending a material decision session, save the agreed summary, update the owning index/Knowledge topic and identify any pending publication. If writing or access is blocked, preserve a sanitized local summary and report the gap. Do not claim that an unrecorded chat or unpushed file is shared team context.

## Check for collisions before changing an accepted contract

Read current main using [main context](main-context.md), then the relevant feature IDs, accepted ADRs, design/API/schema contracts, Knowledge context and related Linear work. Inspect referenced in-flight proposals or paired repository contracts when they affect this task. An agent cannot assume access to another person's unshared conversation; identify unavailable context.

A conflict includes changing an accepted behavior, deleting/deferring a required path, changing an interface or security boundary, or choosing between contradictory accepted records. A newer timestamp, different chat/model/user, implementation shortcut or merge into another feature branch does not resolve it. Do not combine conflicting requirements into an undocumented compromise.

A bug fix that restores the accepted contract, or an implementation detail that preserves it, does not replace the requirement and does not need a new product decision. Verify that distinction rather than asking for confirmation on every edit.

**Pause dependent edits, migrations, merges or deployment until there is an explicit informed decision.** Independent work and a clearly labelled proposal may continue. Prepare the [decision-change comparison](../../product/templates/decision-change.md) and show:

1. Current decision, feature/spec IDs, exact revision, rationale and original originator/decision owner, or the attribution gap.
2. Proposed replacement and why it is needed; side-by-side behavior, benefits, costs and tradeoffs.
3. Affected user paths, data/permissions, APIs, repositories, compatibility, existing work, tests and migration/recovery obligations; identify unknown impact.
4. Your recommendation and whether the original owner or team should be consulted. Record whether consultation occurred, was deferred, or remains unknown. Never claim someone agreed because they authored an earlier brainstorm.
5. The specific decision required, using a prompt such as:

> Are you sure you want to replace [current decision/spec and revision] with [proposed decision]? The reason is [reason]. The comparison and impact are [summary]. The earlier brainstorm came from [originator, or unknown], with [decision owner, or unknown] accountable. I recommend asking that person or the team for input. Should we keep the current decision, consult them first, or approve this replacement?

Ask through the available user-input channel. Wait for an answer; elapsed time is not approval. Do not contact another person or send a message without authorization. A consultation recommendation is not proof of contact or approval.

The accountable owner or an explicitly authorized project maintainer may resolve the decision. An unavailable original author does not have a permanent veto; record who resolved it, their authority, why consultation was unnecessary/unavailable and the chosen tradeoff. If authority is unclear, ask rather than appointing yourself. This is a requirement-change decision, not mandatory human PR review.

Do not ask again when the user has already explicitly approved this exact replacement after seeing its comparison and material consequences; cite that approval. A general request to improve/refactor or a generic approval of unrelated work does not approve a conflicting requirement change. Direct current user instructions retain their governing priority; record their scope without inventing additional approval.

After resolution, update all affected specs/ADRs/designs/contracts and the Knowledge record together, mark supersession explicitly, and adjust acceptance criteria and remaining work. Do not silently reinterpret an older requirement or erase its history. Grammar, formatting and factual status corrections that do not change an accepted requirement need no new product decision.

## Keep parallel work and resumption safe

- Record the specification revision used and preserve other contributors' proposed or unfinished work. Before finalizing a change, recheck affected specifications and paired code heads for concurrent edits. If the governing requirement changed, compare and reconcile it; an old approval does not cover new material consequences.
- Keep one current specification per feature. Use the same ID for a refinement; use a new ID only for a distinct capability. Link dependent proposals instead of copying their full contract. Existing Linear issues own assignment/scheduling; specs own requirements and their evidence.
- Save a [resume checkpoint](../../product/templates/resume-checkpoint.md) at task start, meaningful progress/decision changes and before a handoff or interruption when possible. Prefer the existing Knowledge topic/handoff or related issue. Store private setup in excluded local files. Do not create a checkpoint per command or duplicate the whole backlog.
- A new/resuming agent reads the approved spec, decisions, checkpoint and current source; it verifies freshness and authorization rather than trusting a previous completion claim. Checkpoints cannot grant authority.

## Complete a flow with evidence

Map each in-scope acceptance ID to the relevant implementation and actual evidence. Include applicable success, empty, failure, denied/revoked, stale, concurrency, retry/cancellation, responsive and supported-platform cases. A UI control, isolated endpoint, mock, passing build or one happy path does not establish completion of an entire workflow. Record blocked/deferred criteria with an owner; changing scope uses the decision boundary above.

Report document/decision approval separately from code, verification, integration and deployment. Record actual intended base and merge commit; verify the delivered artifact is reachable from the intended integration branch before claiming it reached main. A PR marked merged into a feature branch does not prove main contains it. Finalize the Knowledge record against the actual merged revisions; publication and deployment remain separately authorized.

This is a contributor/agent procedure. It adds no automated status check, branch protection, credential requirement or guarantee that an agent cannot ignore instructions. Do not describe a written confirmation rule as a technical enforcement mechanism.
