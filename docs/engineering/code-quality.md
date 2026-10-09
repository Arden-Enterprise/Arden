# Clean code, testability, and maintainability

These standards apply to application code and tests alongside [AGENTS.md](../../AGENTS.md), [technology rules](technology-guide.md), and the applicable security/operations guides. A feature is not done merely because it works once: someone else must be able to understand it, test it, and change it safely. Prefer clear, appropriately small designs over cleverness or speculative frameworks.

## Current evidence and gaps

The API has a testable `buildApp` factory, Fastify Supabase Auth, organization bootstrap/admin/invitation and private-note request tests, a Supabase SDK adapter, PostgreSQL repository, SMTP adapter and protected file storage. Organization and invitation HTTP tests use synthetic providers/repositories; they do not prove PostgreSQL/RLS, real Supabase or SMTP behavior. The gated `repository.integration.test.ts` targets an already-migrated disposable PostgreSQL database named `arden_test_*`; it was not executable in the current environment because Docker Desktop was unavailable. Shared UI lives in `packages/ui/src/`: `app/` owns orchestration/identity/navigation, `shared/` owns reusable controls/hooks/API transport, and features live in `sign-in/`, `my-work/`, `personal-workspace/`, `organization/` and `knowledge/`. Sample-mode drafts remain preview-only; authenticated owner notes load from and save to the API, and API failure never falls back to sample data. A first connected live organization administration screen exists; the adjacent preview remains synthetic. The knowledge feature remains a preview. Pure preview models, API transport tests, and feature tests live in `packages/ui/tests/`; they do not implement server authorization. `useSearchShortcut` enables its keyboard listener only for the active search view. `useAutosizeTextarea` handles title content, font loading and width changes with observer cleanup, preventing clipped long titles in both editors. `styles.css` remains the stable public CSS entry point with foundation, shell, feature and responsive imports. Keep these responsibilities separate as real APIs replace samples.

The repository has strict TypeScript and typecheck/test/build scripts, plus API auth/note/org/invitation request tests, SMTP configuration/transport-option tests, local and hosted test-mode fence tests, note-file integrity checks, UI API transport tests, and the existing pure organization-validation, invitation/access, private-draft and knowledge-review regression tests. `organizationWorkflow.ts` accepts an explicit clock and IDs, separates invitations from pending memberships, and rejects invalid/terminal transitions without mutating inputs. The knowledge reducer keeps submitted review snapshots immutable and approval separate from publication. Test these contracts at the model boundary; browser checks cover visible navigation and controls. It does **not** yet have configured lint/format checks, rendered-component UI tests for the live administration/invitation forms, a completed real database/RLS migration run, live Supabase Auth tests, SMTP delivery tests, or automated end-to-end coverage. The remote SSH command has only had its read-only status operation verified; source upload, managed API start, browser integration, and remote DB behavior remain unverified. The live admin page also needs browser interaction and responsive visual checks. Keep this inventory current as implementation grows.

## Readable and cohesive code

- A module/component/function should have an explainable purpose. Separate unrelated responsibilities when changes in one area make another hard to understand or test. File size is a review signal, not an automatic failure or an excuse to split into dozens of trivial wrappers.
- Prefer explicit, ordinary control flow, guard clauses, and named intermediate values over deep nesting, nested ternaries, compressed one-liners, and clever side effects. Optimize for the next reader, not the fewest characters.
- Name concepts using the Arden domain: actor, organization, scope, knowledge version, publication, source revision, and context reference. Avoid ambiguous names such as `data`, `manager`, or `process` when a precise name is available.
- Follow surrounding TypeScript conventions: PascalCase for React components/types, camelCase for functions/hooks/variables, and consistent file names within a package. Name boolean predicates and domain states so their meaning is obvious; do not mechanically rename existing files in unrelated changes.
- Prefer explicit parameters over boolean-mode arguments or hidden module state. Named options are appropriate when parameters genuinely form configuration; do not replace a simple signature with an unbounded settings bag.
- Use narrow types and discriminated unions for meaningful states/results. Make invalid combinations difficult to construct. Validate untrusted values before converting them into domain types; a cast or non-null assertion is not validation.
- Centralize invariant constants and state definitions. Keep API/schema/domain types aligned; avoid stringly typed copies of permissions, publication states, and source kinds scattered across layers.
- Comments should explain non-obvious reasons, invariants, compatibility decisions, or measured tradeoffs. Do not narrate obvious syntax or leave misleading comments, commented-out old implementations, unexplained suppressions, or dead branches.
- Remove code made obsolete by the task when safe and verified. Do not turn a focused feature into a repository-wide cleanup or delete uncertain existing work.

## Boundaries that make code testable

- Keep policy, state transitions, selection/filtering, normalization, and other deterministic transformations pure where practical. Given explicit inputs, they should produce outputs without opening a DB, reading environment, starting a timer, or performing network calls.
- Wire real adapters at composition/startup boundaries. Pass the needed repository/model/storage/clock/ID-generation capability to code that uses it; avoid passing a universal service container or `Fastify` instance through domain logic.
- Use dependency injection at actual nondeterministic/external seams, not for every primitive/helper. Functions and small typed interfaces are sufficient unless a demonstrated need justifies more tooling.
- Imports must not automatically start listeners, pools, workers, inference, or scheduled jobs. Keep construction distinct from startup and expose explicit shutdown/disposal ownership.
- Parse/validate environment configuration once at the appropriate startup boundary and pass typed config onward. Do not make tests depend on scattered `process.env` reads or on the developer's machine settings.
- Keep public interfaces stable and narrow. Clients do not depend on raw database rows, private library objects, or platform globals; domain code does not depend on React/Electron/HTTP.
- Use shared web/desktop feature components and policy modules. Isolate platform capabilities behind adapters; a browser unit test should not need a live Electron main process just to test a content rule.
- Separate sample fixtures from production acquisition behavior. Demo fallback must not make failed real requests look successful; sample content stays clearly identified and isolated.

## React and API decomposition

- Build feature views from focused components and hooks with clear ownership of state and effects. Rendering, graph algorithms, sample fixtures, native capabilities, data loading, and business policy need not live in one component.
- Derive state from authoritative inputs where possible instead of maintaining synchronized copies. Keep effect dependencies honest; do not suppress hook rules to hide stale closures or races.
- Extract a hook when it owns a coherent React lifecycle/state concern, not merely to move arbitrary code out of a long file. Pure graph/search helpers should remain ordinary testable functions.
- Keep HTTP handlers thin enough that validation, authentication, authorization, domain operation, and response mapping are visible. Domain decisions must not be duplicated across route handlers, UI buttons, and workers.
- Prefer explicit domain errors/results mapped to safe HTTP/UI behavior. Avoid catch-all exceptions that silently return success, generic retry loops around every action, or returning internal error details.
- Preserve the existing API factory approach and close test instances in guaranteed cleanup. New UI/domain modules should be tested at their own boundaries, not only through the entire shell.

## Reliability and resource ownership

- Every pool, file handle, stream, subscription, renderer instance, timer, worker, and abortable request has an explicit owner and cleanup path. Cleanup must still run on errors, cancellation, assertion failure, unmount, and shutdown.
- Await promises when completion affects correctness. Intentional background work needs explicit failure reporting, cancellation/lifetime ownership, and a suitable durable job mechanism when required; no unhandled fire-and-forget mutations.
- Define behavior for timeout, partial success, stale response, version conflict, cancellation, retry, and redelivery. Never assume "timeout means nothing happened" or retry a side effect without idempotency/reconciliation.
- Keep mutations/transactions and audit/scheduling effects consistent. Bound concurrency and work size; consider permission changes while a delayed operation is running.
- Do not add memoization, concurrency, indexing, or caching merely to look sophisticated. Measure a need, preserve contracts, and test invalidation/cleanup when introducing them.
- Log enough safe metadata to diagnose failure without leaking private payloads or secrets. Error swallowing and verbose private-content logging are both unacceptable shortcuts.

## Test design

- For each new behavior, identify the observable contract and the layer that owns it. Write tests for outcomes, allowed/denied transitions, and invariants rather than private helper call counts or a specific implementation structure.
- For a defect, add a reproducing regression case before the fix when practical; establish that it detects the original defect. For a refactor, add characterization tests where behavior lacks protection, then preserve observable outcomes.
- Cover representative success, invalid input, boundary, denial, empty/missing data, dependency failure, conflict, and cancellation/retry cases when relevant. Security-sensitive behavior additionally follows the full privacy/revocation gates.
- Use unit tests for pure domain rules; Fastify injection for request contracts; real disposable PostgreSQL for constraints, RLS, transactions, migrations, pgvector, and queue behavior; browser/desktop interaction tests for user/platform journeys. A mock cannot prove a real SQL policy or native security boundary.
- Test adapters against their actual contracts, including failure responses. Prefer small realistic fakes at external boundaries; do not mock the policy being tested or duplicate its implementation inside expected results.
- Keep fixtures minimal, named, synthetic, and scoped to an isolated test. Use factories for meaningful variation without hiding the essential input/expected outcome in a giant generic fixture builder.
- Control clocks, randomness, IDs, model/network responses, and scheduling where determinism matters. Do not require private tokens, the public Internet, an expensive live model, or production data in ordinary unit/CI runs.
- Tests must run independently and in any order. Avoid mutable shared fixtures, hidden cross-test DB state, fixed ports without ownership, and reliance on a developer's environment/timezone.
- Guarantee cleanup using lifecycle hooks or `try/finally`. Restore mocks/timers/env changes, cancel subscriptions, close apps/pools, and remove only verified disposable test resources even when an assertion fails.
- Await observable conditions with bounded timeouts instead of arbitrary sleeps. Fix the cause of flakiness; do not hide it with excessive retries or disabled/skipped tests without a recorded reason and resolution plan.
- Name tests by behavior and make failure messages/expected results useful. Review snapshots; do not accept wholesale snapshot updates without verifying semantics. A screenshot/snapshot alone cannot establish authorization or data integrity.
- Coverage is a signal for untested paths, not a substitute for correctness. Do not impose a universal 100% target or pad trivial tests for a score; critical policy/workflow/error paths need explicit evidence, and any numerical threshold must be intentionally configured/documented.

## Safe refactoring and ongoing maintenance

- Keep refactors incremental and behavior-preserving unless a behavior change is explicitly in scope. Establish focused tests, move one responsibility at a time, and run relevant checks after meaningful steps.
- Preserve security, document formats, API/desktop compatibility, audit effects, ordering, and resource lifetimes. "Internal cleanup" can still change these contracts and needs corresponding tests.
- Prefer a small amount of intentional local duplication to a premature incorrect abstraction. Share repeated policy/invariants immediately, but generalize UI/adapters only when their real common behavior is understood.
- Avoid new services/dependencies, universal base classes, plugins, generic repositories, or config systems without demonstrated value. Do not introduce circular imports, layer violations, or catch-all `utils` dumping grounds.
- Document intentional technical debt with location, reason, impact/risk, acceptance criteria, and a concrete follow-up. A linked issue is preferable when issue management is available and authorized; otherwise use a clear local note. Never use debt to excuse an access leak or silent data loss.
- Keep tooling consistent with the installed stack. Lint/format tooling is not configured today; introducing it requires an actual pinned setup, package scripts/CI checks, compatibility review, and a scoped rollout. Do not claim a nonexistent `pnpm lint` or mass-format unrelated changes.
- Update rules and decision/setup guides when conventions, boundaries, tooling, or debt status change. Future contributors should not have to infer a newly accepted pattern from one implementation.

## Acceptance checklist

Before calling an application-code change done, the author/reviewer must be able to answer:

1. Is each changed module's responsibility clear, and can its inputs, outputs, dependencies, and side effects be understood locally?
2. Are domain rules separated from transport/platform/infrastructure, with narrow boundaries that can be tested without the entire installation?
3. Are names/types/control flow clear, without hidden shared state, unexplained suppressions, dead code, or unnecessary abstractions?
4. Are changed behavior and important negative/failure/boundary paths covered at the right layer, with a useful regression case for a fixed defect?
5. Are tests deterministic, independently runnable, and guaranteed to clean up resources?
6. Are failure, cancellation, retry/idempotency, concurrent updates, permission changes, and compatibility consequences handled where applicable?
7. Do focused tests and applicable typecheck/test/build plus UI/DB/native checks pass, with unavailable checks and remaining gaps accurately reported?
8. Are relevant rules/docs updated and any necessary exception/debt explicit, justified, and accompanied by a concrete follow-up?

An applicable unanswered item is a gap to resolve or explicitly document, not something to conceal behind a green build. Documentation-only changes do not require fabricated code/test evidence.
