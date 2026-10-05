# Lasting decisions and rules maintenance

Durable product, architecture, security, technology, and operational decisions belong in the repository, not only in chat. Read [AGENTS.md](../../AGENTS.md), especially its rules-maintenance section.

## What needs a decision record

Use a record for a material tradeoff: changing a stack component, adding a service/provider, changing the trust/data boundary, choosing source audience mapping or recovery policy, defining offline/sync behavior, changing canonical formats/API support, accepting a commercial license, or establishing deployment/retention/support guarantees.

Routine fixes and patch-level upgrades need appropriate rules/docs and regression evidence but do not require a long architecture essay. A recurring mistake needs an actionable prevention rule in the owning guide; use a decision record if its prevention changes architecture or policy.

## Placement and naming

Create `NNNN-short-kebab-case-title.md` here with the next available four-digit number. Check existing records before allocating a number. Never reuse a number or silently rewrite an accepted decision to hide history; add a superseding record when the underlying decision changes.

There are no numbered records at this guide's creation. Existing direction lives in `ARDEN_BLUEPRINT.md`, `PRODUCT.md`, and `DESIGN.md`; do not manufacture past approval dates or claim that a proposed blueprint is a completed implementation.

## Template

```markdown
# NNNN: Short decision title

Status: proposed | accepted | deprecated | superseded
Date: YYYY-MM-DD
Decision owner/approval: person or role; do not invent approval
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

- Follow [current main context](../engineering/rules/main-context.md) at task start. Check each relevant decision's status and superseding record on fetched main before relying on older chats or branch documents. A later accepted replacement governs the default intended architecture; verify its actual implementation separately.
- **Proposed** is an option, not authority to replace the accepted stack or promise a feature.
- **Accepted** requires an actual authorized decision. It may still be unimplemented; track implementation/evidence separately.
- **Implemented** describes code/config/test evidence, not just a merged plan. Claims of release readiness still require the applicable gates.
- **Deprecated/superseded** retains history and links the replacement. Remove or update stale live instructions at the same time.
- Update cross-repository rules in `AGENTS.md`; detailed technology, security, operations, product, and design decisions belong in their owning guides. Link rather than duplicating extensive rules.
- When a user's accepted decision affects multiple areas, update **all affected** sources in the same change. Do not fix only the first document that mentions it.
- Keep examples, ports, commands, versions, package paths, implementation status, tests, and configuration accurate. If an old document disagrees with source, identify the discrepancy and resolve it explicitly.
- Capture reusable constraints and rationale, not secrets, customer content, transient logs, or an unfiltered transcript. Review privacy of referenced screenshots/output too.
- When documentation gaps remain, name them in the handoff/PR and obtain a decision where necessary; do not quietly promote an assumption into policy.
