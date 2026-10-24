# Engineering rules

## Source of truth and architecture

Inspect actual manifests, lockfiles, source, tests, and deployment configuration. Read the applicable architecture/technology/operations guides when available; a blueprint or plan is not evidence of installed or shipped functionality. Report missing/conflicting sources rather than guessing.

Use explicit readable module boundaries:

- Separate domain policy/workflows from transport, UI, vendor adapters, storage, and model side effects.
- Keep browser/desktop renderer code away from database modules, connector credentials, server secrets, and unrestricted native APIs.
- The API and narrowly authorized workers own canonical writes. PostgreSQL/canonical storage holds truth; graph/search/AI caches are rebuildable derivatives.
- Share product behavior and feature UI across web/desktop. Keep genuine native differences behind small typed boundaries.
- Expose public package interfaces; avoid circular dependencies and imports into another package's private source.
- Introduce an abstraction for a real invariant or replacement boundary, not hypothetical future reuse. Remove dead code.

## Readability and reliability

Prefer clear names, strict types, explicit inputs/outputs, and straightforward control flow. Avoid catch-all utilities, hidden mutable globals, import-time side effects, unnecessary frameworks, and broad check suppressions.

Types do not validate HTTP, IPC, environment variables, stored JSON, files, or model output. Validate runtime inputs and return safe actionable errors.

Make resource ownership/cleanup explicit. Handle timeouts, cancellation, concurrency, retries, partial failures, and stale requests without swallowed errors or fabricated success.

Refactors preserve behavior/security contracts unless an intentional change is documented. Keep unrelated formatting, dependency upgrades, and cleanup outside the task.

## Dependencies and compatibility

Verify unfamiliar/version-sensitive APIs against primary documentation matching the installed version. Review maintenance, license, runtime/platform compatibility, and security implications; pin dependencies through the lockfile.

Keep schema/API changes compatible through rollout. Document migration, backfill, version negotiation, and recovery limits. Do not add competing auth/storage/graph services or operational infrastructure without a measured need and accepted ADR.

Follow [security](security.md), [verification](verification.md), and [quality metrics](../quality-metrics.md). An exception has a reason, impact, owner, and concrete follow-up; it does not waive privacy invariants.

## Architecture and module boundaries

- Existing application paths are `apps/web`, `apps/desktop`, and **`apps/api`**, with `packages/ui`. Use the actual `apps/api` name; do not create a duplicate `apps/server` from an outdated diagram.
- Future packages may include `domain`, `api-client`, `db`, `editor`, `graph`, and `ai`, with `apps/worker`. Create them when needed, not as empty speculative scaffolding.
- Browser/renderer -> typed HTTP API -> domain authorization/workflows -> storage. Clients MUST NOT import database code, server secrets, connector credentials, or unrestricted filesystem APIs.
- Domain policy and workflow code must be independent of React, Electron, and transport. Centralize authorization; do not maintain separate web/desktop/worker interpretations.
- The API is the routine content writer. Workers use explicit, narrow service capabilities and the same domain invariants; workers are not an unrestricted second API.
- PostgreSQL holds canonical records and edges. Search, embeddings, graph layouts, summaries, and caches are derived projections, not competing sources of truth.
- Keep public package entry points explicit. Do not import another package's private source through relative paths. Use `workspace:*` for workspace dependencies and avoid circular/server-to-client dependencies.
- Share features between web and desktop. Isolate genuine native differences behind a small typed adapter. Do not fork complete screens for each platform.
- External infrastructure and libraries sit behind interfaces when there is a real replacement boundary: model gateway, storage, connector, editor document format. Avoid abstraction for hypothetical use cases.

### Code quality, testability, and maintainability

These are required acceptance criteria for code changes, not optional cleanup after delivery. Read [code-quality.md](../code-quality.md) before implementing or refactoring:

- Keep modules, functions, components, and hooks cohesive with a clear responsibility. Split mixed responsibilities and excessive nesting; do not enforce arbitrary line limits or fragment simple code merely to satisfy a metric.
- Separate pure domain rules and transformations from HTTP, React rendering, Electron, database, filesystem, network, and model side effects. Inject real external boundaries so tests can control them without a framework-heavy dependency container.
- Use descriptive names, explicit typed inputs/outputs, validated boundaries, and visible dependencies. No hidden mutable globals, import-time connections, unexplained magic values, or broad type/check suppressions.
- Keep ownership and cleanup of resources explicit. Handle failure, cancellation, retries, stale requests, and concurrent updates deliberately; do not silently swallow failures or disguise them with fabricated success.
- Reuse shared policy and web/desktop behavior instead of copying them. Extract abstractions from real repeated invariants, not speculative future uses; avoid giant catch-all utilities and unnecessary generic frameworks.
- Add behavior-focused tests for new or changed logic and regression tests for defects. Cover meaningful negative/boundary cases; test real DB/native contracts where mocks cannot establish correctness.
- Make tests deterministic, isolated, independent of execution order, and safe to run repeatedly. Restore mocks/timers/environment and close resources even when assertions fail.
- Refactors preserve behavior and security contracts unless an intentional change is documented/tested. Prefer small incremental changes with characterization tests for existing behavior; do not rewrite unrelated code under a maintenance label.
- Review complexity, coupling, naming, test evidence, and operational consequences before calling a change done. Document a necessary exception/debt with reason, impact, and a concrete follow-up; never use debt notes to waive privacy safeguards.
- Do not claim the codebase is clean, fully covered, or production-ready solely because typecheck/test/build pass. Existing scaffold coverage and missing lint/format/UI/integration checks must remain explicit.
