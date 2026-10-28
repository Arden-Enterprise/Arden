# Project rules: index and ownership

This directory holds the canonical development rules for Arden. [AGENTS.md](../../../AGENTS.md) routes agents here; [CONTRIBUTING.md](../../../CONTRIBUTING.md) routes contributors here. These rules are project-scoped and contain no contributor-specific configuration.

## Modules

| Module | Owns | Read when |
| --- | --- | --- |
| [Current main context](main-context.md) | Main freshness, required current documentation, changes since the last inspection, checkout comparison and conflict handling | Before planning/acting on every task; resumed tasks with a changed baseline |
| [Product contract](product-contract.md) | Accepted product/trust boundaries and unresolved decisions | Every task |
| [Specifications](specifications.md) | Agreed brainstorm capture, originator/owner provenance, conflicting-spec decisions, coverage and resume checkpoints | Every task; planning or changing requirements |
| [Task workflow](task-workflow.md) | Scope, acceptance, decisions, Linear tracking and issue budget, task completion, PR offer | Every task |
| [Git workflow](git-workflow.md) | Branch/commit names, preservation, PR size, push batches | Every task; publishing |
| [Security and knowledge](security.md) | Content authority, access, private-data and external-action boundaries | Every task |
| [Pull requests](pull-requests.md) | Publication approval, preparation, review cycle, coverage, merge readiness | Every task; reviewing |
| [Engineering](engineering.md) | Architecture boundaries, readable code, dependencies, compatibility | Application code |
| [Design](design.md) | Research, flows, components, screen states, accessibility, design handoff | Product/UI/UX |
| [Verification](verification.md) | Evidence, appropriate checks, documentation and release acceptance | Changed behavior or docs |
| [Server operations](server-operations.md) | Project-local access resolution and authorized remote operations | Requested server work |
| [Knowledge maintenance](knowledge-maintenance.md) | Durable decisions, owning guides and synchronized implementation status | Lasting decisions or material implementation changes |

## Related references

- [Feature and flow index](../../product/README.md) maps visible scope to owning contracts, acceptance paths and unresolved integration gaps; it does not certify completeness.
- [Implementation status](../implementation-status.md) records current code/rollout boundaries; verify against source and operational evidence.
- [Quality metrics](../quality-metrics.md) owns metric definitions and thresholds.
- [AI reviewers](../ai-reviewers.md) owns dated vendor facts and limits.
- [Private files](../private-files.md) owns exclusion and secret-handling setup.
- [Server access](../server-access.md) owns contributor SSH onboarding.
- [Repository settings](../repository-settings.md) owns GitHub administrator setup.
- [Decision records and template](../../decisions/README.md) owns the decision-record format.

## Maintain the rules

1. Give each detailed rule one authoritative home. Entry points and tool adapters summarize or route; they must not invent competing policy.
2. Update the owning module when behavior or a lasting decision changes. Update affected links, reviewer context manifests, and public setup guidance together.
3. Record consequential tradeoffs in an ADR. Identify proposed, accepted, implemented, superseded, and deprecated states honestly.
4. Keep each module focused. Split by responsibility when needed, not merely by line count. Keep temporary logs, private incidents, customer examples, and chat transcripts out.
5. Recheck vendor references before relying on a limit or entitlement and when a tool reports changed behavior. Record the verification date and primary source; do not copy numeric vendor quotas into standing agent instructions.
6. Ask for a real decision when rules conflict with the authorized scope. Direct user instructions take precedence over repository guidance; explain material deviations.
7. Review relative links, naming/configuration consistency, privacy, and applicable evidence before publishing a rule change.

The responsible maintainer and reviewers own rule updates. Team handles, mandatory reviewer apps, and paid plans are selected through repository settings; this document does not invent them.
