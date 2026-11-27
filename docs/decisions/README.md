# Lasting decisions and rules maintenance

[0027: Remove knowledge Topics](0027-remove-knowledge-topics.md) retires Topic schema,
authoring/API fields and source context after the flat Collection contract in0026.
Frozen historical JSON remains untouched. Source integration and live operator
approval/rehearsal are separate gates.

Durable product, architecture, security, technology, and operational decisions belong in the repository, not only in chat. Read [AGENTS.md](../../AGENTS.md), especially its rules-maintenance section.

## What needs a decision record

Use a record for a material tradeoff: changing a stack component, adding a service/provider, changing the trust/data boundary, choosing source audience mapping or recovery policy, defining offline/sync behavior, changing canonical formats/API support, accepting a commercial license, or establishing deployment/retention/support guarantees.

Routine fixes and patch-level upgrades need appropriate rules/docs and regression evidence but do not require a long architecture essay. A recurring mistake needs an actionable prevention rule in the owning guide; use a decision record if its prevention changes architecture or policy.

## Placement and naming

Create `NNNN-short-kebab-case-title.md` here with the next available four-digit number. Check existing records before allocating a number. Never reuse a number or silently rewrite an accepted decision to hide history; add a superseding record when the underlying decision changes.

Existing direction and numbered records must be inspected on the actual baseline, including referenced in-flight records before allocating a conflicting number. Do not manufacture past approval dates or claim that a proposed blueprint is a completed implementation. The [specification rule](../engineering/rules/specifications.md) owns agreed-brainstorm capture and the comparison/confirmation boundary for replacing accepted decisions.

## Template

```markdown
# NNNN: Short decision title

Status: proposed | accepted | deprecated | superseded
Date: YYYY-MM-DD
Decision owner/approval: person or role; do not invent approval
Brainstorm originator / record author: distinguish actual attribution; unknown stays explicit
Approval evidence and exact source/spec revision: reference or not approved
Implementation: not started | partial | implemented (link evidence)
Supersedes / superseded by: record link, if applicable

## Context and requirement

What prompted the decision? What existing constraint or user requirement matters?

## Options and tradeoffs

What viable options were considered? Include cost, maintenance, privacy,
compatibility, deployment, performance, and licensing implications as relevant.

## Decision

What exactly is accepted, and what remains out of scope or unresolved?

## Boundaries and consequences

Who owns data/policy? Which services/providers/clients receive what information?
What changes to formats, API, configuration, migrations, supported versions,
backup/restore, and customer operation follow?

## Verification and rollout

What tests/measurements demonstrate the decision works? What are the failure
and recovery paths? Record planned evidence separately from evidence obtained.

## Rules and documentation updates

Link the authoritative instructions, product/design/architecture docs, setup,
and operational runbooks changed alongside this decision.

## References

Version-matched official docs, repository code/tests, and authorized decisions.
```

## Status and synchronization

[0010](0010-audiences-and-system-administration.md) remains the audience and authorization source;
its System Admin scope was explicitly refined on 2026-11-23 to a no-membership, read-only
System Console with separate `MANAGE_SYSTEM_ADMINS` authority. PostgreSQL rehearsal and rollout
remain pending for the implementation branch.

[0026: Flat Organization Collection placement](0026-flat-organization-collection-placement.md)
records the accepted one-folder/Admin/Allowed types/version/Archive rules.
P3B.1 is a local schema checkpoint only; new API/UI and legacy mapping remain.

[0024: Admin-only direct withdrawal](0024-admin-only-direct-withdrawal.md) refines
0023: reviewers keep scoped view/report handling but cannot withdraw directly.
Inspection notifications are explicitly deferred for this release; audit remains.
Implementation is on PR #52 only until actual integration/release is verified.

[0025: Durable in-app notifications with Realtime hints](0025-in-app-notifications.md)
accepts the F21 implementation scope while retaining 0024's inspection-notification
deferral. Code and migration are branch-only until full PostgreSQL, Realtime and
staging evidence is obtained; no rollout is implied.

The Flow 4 owner approved the [Maintenance report intake decision](0028-maintenance-report-intake.md) on 18 November 2026. It covers intake cutover, transition of open reports and preservation of closed report history.

The Home start page and reader validity rules are [0022: Home start page and reader
validity](0022-home-start-page-and-reader-validity.md), accepted on 15 November 2026;
implementation is on branch `feat/home-reader-information` only.

The governed-answering refinement is [0021: hybrid answering and applicable-version
sources](0021-governed-hybrid-answering.md), accepted implementation scope with
paired local verification. Publication/deployment and real-provider acceptance
remain separate; consult its GA-v2 contract rather than inferring release status.

The current release migration policy is [0016: run approved expand migrations through the release receiver](0016-github-hosted-server-side-migrations.md). It is accepted, but implementation evidence and rollout are tracked separately from the decision.

- Follow [current main context](../engineering/rules/main-context.md) at task start. Check each relevant decision's status and superseding record on fetched main before relying on older chats or branch documents. A later accepted replacement governs the default intended architecture; verify its actual implementation separately.
- **Proposed** is an option, not authority to replace the accepted stack or promise a feature.
- **Accepted** requires an actual authorized decision. It may still be unimplemented; track implementation/evidence separately.
- Replacing a conflicting accepted decision requires the specification rule's current/proposed comparison, consequences, original-owner/team consultation recommendation and explicit informed resolution. Record the actual approver/authority and supersession; reuse sufficient existing approval rather than requesting it again.
- **Implemented** describes code/config/test evidence, not just a merged plan. Claims of release readiness still require the applicable gates.
- **Deprecated/superseded** retains history and links the replacement. Remove or update stale live instructions at the same time.
- Update cross-repository rules in `AGENTS.md`; detailed technology, security, operations, product, and design decisions belong in their owning guides. Link rather than duplicating extensive rules.
- When a user's accepted decision affects multiple areas, update **all affected** sources in the same change. Do not fix only the first document that mentions it.
- Keep examples, ports, commands, versions, package paths, implementation status, tests, and configuration accurate. If an old document disagrees with source, identify the discrepancy and resolve it explicitly.
- Capture reusable constraints and rationale, not secrets, customer content, transient logs, or an unfiltered transcript. Review privacy of referenced screenshots/output too.
- When documentation gaps remain, name them in the handoff/PR and obtain a decision where necessary; do not quietly promote an assumption into policy.

Current Company AI version selection: [0030 — Published-date AI sources](0030-published-date-ai-sources.md) supersedes the temporal parts of 0021.

Expired documents and Home columns: [0032 — Expired documents, reviewed renewal and the Home document columns](0032-expired-documents-renewal-and-home-columns.md) (accepted 24 November 2026) supersedes 0022 item 4 and its Home column list and extends 0024/0025. Implementation is on branch `feat/expired-document-visibility` only.

Reviewer self-approval: [0033 — Reviewers with a matching grant may decide their own submissions](0033-reviewer-self-approval.md) (accepted 24 November 2026) supersedes the reviewer self-review ban in 0011/0015 and amends the 0032 renewal decision order. Branch `feat/expired-document-visibility` only.

Share button and direct sharing: [0034 — One Share button, unreviewed direct sharing with individuals and private PDF items](0034-share-button-direct-share-and-private-pdf.md) (accepted 26 November 2026) allows explicitly selected members to read a private item and lets Private store PDF files.

Audit policy: [0035 — Audit only consequential actions](0035-audit-only-consequential-actions.md) (accepted 26 November 2026) supersedes the audit line of 0002. Permanent deletion and changes to share access are audited.

Knowledge Graph and Modular Agent UI: [0036 — Knowledge Graph (`@xyflow/react`) and Modular Composable Typed UI Blocks](0036-knowledge-graph-and-modular-typed-ui-blocks.md) (accepted 26 November 2026; specification approved, implementation not started) supersedes Sigma.js in `technology-guide.md` Section 9, resolves navigation gap `G4` while keeping Home default (`0022`), and defines the A2UI-inspired Flat Adjacency `UiSurface` v1 contract over `/v3/generations` and ISO/IEC 38505-1:2026 Monitor Mode.

AI Service Monorepo Consolidation and Isolated Release Pipeline: [0037 — Consolidate Python AI service into Arden monorepo with isolated release pipeline](0037-monorepo-ai-service-and-release-pipeline.md) (accepted 27 November 2026; Phase 1 implemented on branch `feat/consolidate-arden-ai-monorepo`, Phases 2–3 planned) supersedes only the separate-Git-repository and manual-AI-deploy portions of [0012](0012-separate-python-ai-service-and-chromadb.md) while keeping all runtime, PostgreSQL, network, and ChromaDB isolation invariants intact under `services/ai/`.

Invitation entry: [0038 — Invitation account routing and direct account setup](0038-invitation-account-routing-and-direct-setup.md) (accepted 27 November 2026) supersedes 0005's invitation-page account nonenumeration and Supabase-only confirmation, and narrowly relaxes 0001's service-role prohibition for a server-only invitation account capability.
Reader groups: [0039 — Remove reader group management](0039-remove-reader-group-management.md) (accepted 28 November 2026) supersedes 0010's Org Admin-managed `GROUP` audiences. Target Readers (organization, department, selected members) are unchanged; legacy group-based reads stay frozen until a separate cleanup decision.
