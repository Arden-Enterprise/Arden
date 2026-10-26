# Keep project knowledge complete and current

**Every accepted lasting decision and every material implementation change MUST update the relevant repository knowledge in the same change.** Do not leave it only in chat, a commit message, or someone's memory.

Follow [specifications](specifications.md) for recording agreed brainstorm outcomes, originator/decision-owner provenance, conflicting accepted decisions, requirement coverage and resume checkpoints. Update the relevant [feature index](../../product/README.md) entry and owning specification; keep one authoritative contract instead of separate contradictory summaries.

- Update `AGENTS.md` for cross-repository workflow, safety, architecture boundaries, or required reading.
- Update the technology guide for adopted/removed libraries, versions/support changes, interfaces, package locations, and technology-specific pitfalls.
- Update the code-quality guide for accepted implementation/test conventions, recurring maintainability mistakes, quality tooling, or documented quality debt and its resolution.
- Update security rules/threat-model decisions for permissions, data flows, secrets, AI providers, caching, exports, connectors, retention, or encryption changes.
- Update operations rules for scripts/ports/environment variables, Compose, deployments, migration procedures, signing, backup/restore, and support requirements.
- Update `PRODUCT.md` / `ARDEN_BLUEPRINT.md` for product/scope/architecture decisions; update `DESIGN.md` and relevant design metadata for approved visual changes.
- Record material tradeoffs in a decision record. Distinguish **proposed**, **accepted**, **implemented**, **deprecated**, and **superseded**; never upgrade status without evidence.
- When fixing a recurring mistake, add a general, actionable prevention rule in the owning guide and a regression test where possible. Record the rule's reason; do not dump private incidents, customer secrets, transient logs, or every chat line into instructions.
- Keep one authoritative home for each detailed rule and link to it. Update or remove stale duplicates and mark superseded decisions explicitly. Keep commands and examples runnable for the actual repository.
- For a new technology/capability, document purpose, owner/boundary, exact version source, config/secrets, failure behavior, security implications, tests, deployment/migration consequences, license constraints, and official references before calling it complete.
- Recheck this ruleset during PR review and release preparation. If guidance is missing or conflicting, report the gap and resolve it as part of the task rather than quietly inventing policy.

No written ruleset can pre-enumerate every future case. When a case is not covered, apply the invariants, consult version-matched primary documentation, seek decisions for material tradeoffs, and add the accepted rule so the next contributor has it.

Update the [implementation inventory](../implementation-status.md) when a capability or rollout boundary changes. Keep private Knowledge-repository records in that repository under its own instructions; public application docs must not import private operational details.
