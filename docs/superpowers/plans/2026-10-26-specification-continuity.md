# Specification continuity implementation plan

> For agentic workers: use the project's applicable execution workflow and read both the specification rule and this plan. Preserve the existing authorized execution context; this plan grants no publication, merge or deployment permission.

**Goal:** Make accepted brainstorm decisions durable, expose feature/flow coverage and prevent silent replacement of conflicting accepted specifications.

**Architecture:** One owning specification-rule module routes a feature index, focused area coverage documents and reusable templates. Entry points in Arden and Arden-AI route to it; approved internal attribution and handoffs remain in Knowledge. Existing conflicting feature-branch contracts are recorded as unresolved, not merged or selected by this documentation task.

**Tech stack:** Markdown documentation and existing Git/Linear workflows; no new automated checks, credentials, dependencies or application code.

**Spec:** [Accepted specifications and decision changes](../../engineering/rules/specifications.md), implementing the owner's 26 October request and previously approved index/checkpoint/evidence outline.

## Global constraints

- Preserve unrelated deployment drafts and prior policy/Knowledge/AI edits.
- Do not invent brainstorm authors, approval or completion; retain original rationale and supersession.
- An informed explicit replacement decision gates dependent changes; already sufficient approval is reused. Original-owner consultation does not create an unavailable-author veto or mandatory human PR review.
- Public content contains no private corpus, credentials or live server metadata. Publication, merge and deployment remain separate authorized actions.

## Review focus

- Another teammate asks for a conflicting behavior: comparison and informed decision precede dependent edits.
- Originator is unknown/unavailable: disclose the gap and use accountable owner/authorized maintainer resolution.
- The user already approved the exact compared change: do not ask again; record the approval.
- A branch PR says merged: verify intended-main reachability before calling it integrated.
- A workflow has one finished screen but missing permission/failure/native paths: report partial coverage instead of Done.

## Tasks

- [x] Add the owning rule and templates for feature specs, comparisons and resume checkpoints; review the five cases above.
- [x] Build an initial indexed coverage map from inspected main, branch and AI evidence; name unresolved contradictions and unverified scope.
- [x] Route agent/contributor/design/verification/PR/ADR guidance to the rule without duplicating it or changing application behavior.
- [x] Update Knowledge provenance, historical-context warnings, topic/index/handoff and templates; add Arden-AI routing.
- [x] Check task-owned links, identifiers, provenance/privacy, scope/preservation and whitespace. Documentation checks are not application tests.
- [ ] Record final evidence/publication limits in ARD-63 and offer publication once the last documentation check is complete. No publication has been authorized/performed.

No task here authorizes choosing a conflicting Flow 3 product contract, integrating the unmerged branch, deploying it or representing this seed inventory as a complete import of every conversation.
