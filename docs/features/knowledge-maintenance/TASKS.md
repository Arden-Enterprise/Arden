# Flow 4 execution tasks

One implementation owner coordinates the Arden worktree and the later Arden-AI slice. Start at T-11 and follow the linked runtime plan. Keep checkpoints by task and proof. Preserve the original T-01–T-10 entries as the first local pass. [Earlier chronology and suggested commit order](../../superpowers/plans/2026-11-17-flow-4-maintenance-cursor.md#three-week-history-and-commit-order)

## UI workflow for all slices

Load `frontend-ui-engineering` for any UI work. Use Impeccable's Operate guidance for the document-first layout. Read [Arden's design system](../../../DESIGN.md) and the [Arden Flow Design skill](../../../.cursor/skills/arden-flow-design/SKILL.md). Use Save.design for read-only component research when a local pattern is missing. Use generic queries and translate useful patterns into existing components and semantic tokens. Record a short screen contract with its step IDs, primary action, permissions, states and responsive rules.

Reuse the Island workspace, shared reader, existing dialog/toast primitives, table and status styles. Keep title and exact version visible, and give the document the main reading area. Show the next action alongside it. Stack the panes on small screens. Use green and coral with **+ Added** and **− Removed** labels. Preserve predictable keyboard and focus behavior, and distinguish loading, empty, unavailable, error, stale and permission states. Keep display components separate from data fetching and permission decisions. Use the acceptance matrix for web and Electron.

## T-11 — Prove the manual path on the real stack

With disposable PostgreSQL, prove report, claim, reassignment, **No change needed** and authorized history in signed-in hosts. Covers AC-01–AC-04 and the manual AC-08 checks through V-01–V-04 and V-08. [Runtime Task 1](../../superpowers/plans/2026-11-19-flow-4-runtime-integration.md#task-1--establish-an-isolated-runtime-and-prove-the-wired-path)

## T-12 — Rehearse legacy import and closed history

After T-11's isolated database baseline, prove one writer, durable import, the older-client duplicate rule and read-only **Closed** history under Q24–Q25. Covers AC-03 and AC-10 through V-03 and V-10. [Runtime Task 2](../../superpowers/plans/2026-11-19-flow-4-runtime-integration.md#task-2--complete-report-cutover-and-retained-history)

## T-13 — Connect case conversation and unread history

After T-11's actor and projection checks, connect questions, replies and safe history in both case mounts. Covers AC-03, AC-04 and the conversation portion of AC-06 through V-03, V-04 and V-06. [Runtime Task 3](../../superpowers/plans/2026-11-19-flow-4-runtime-integration.md#task-3--connect-case-actions-questions-replies-and-unread-history)

## T-14 — Compare stored versions

After T-11 and the shared case setup in T-13, prove exact-version reading, chronological changes and fallback through web and Electron. Covers AC-03, AC-05 and AC-08 through V-03, V-05 and V-08. [Runtime Task 4](../../superpowers/plans/2026-11-19-flow-4-runtime-integration.md#task-4--make-exact-source-reading-and-chronological-comparison-real)

## T-15 — Link and confirm the actual publication outcome

After T-13 and T-14, prove the exact Flow 2 correction or withdrawal and its independent human confirmation. Covers AC-03, AC-04 and AC-06 through V-03, V-04 and V-06. [Runtime Task 5](../../superpowers/plans/2026-11-19-flow-4-runtime-integration.md#task-5--connect-flow-2-handoff-and-exact-publication-proof)

## T-16 — Connect recurrence and related cases

After T-13 and T-15, link a new report to a resolved case and prove both cases retain their own outcomes. Covers AC-03 and AC-09 through V-03 and V-09. [Runtime Task 6](../../superpowers/plans/2026-11-19-flow-4-runtime-integration.md#task-6--surface-related-cases-and-prove-independent-resolution)

## T-17 — Run bounded analysis through the case screen

After T-14's exact-source path, prove durable analysis, exact citations, cancellation, retry and late-result denial using the paired contract and controlled adapter. Cover AC-03, AC-04, AC-07 and AC-08 through V-03, V-04, V-07 and V-08. [Runtime Task 7](../../superpowers/plans/2026-11-19-flow-4-runtime-integration.md#task-7--make-analysis-durable-and-connect-findings)

## T-18 — Verify and return the whole journey

After T-11–T-17, capture signed-in browser and Electron acceptance with synthetic data. Track the separately authorized live provider result as its own release gate. Return evidence for AC-01–AC-10 through V-01–V-11. [Runtime Task 8](../../superpowers/plans/2026-11-19-flow-4-runtime-integration.md#task-8--run-the-signed-in-journey-and-return-evidence)

## Earlier local implementation pass

The following entries describe the original slice intentions. Read [Status](STATUS.md) for what those slices actually proved.

## T-01 — Reconcile the working baseline

- **Blocked by** — None for inspection and local disposable preparation. Shared migration disposition depends on verified target ledgers.
- **Outcome** — Cursor can explain both report paths, identify the exact integration base and demonstrate the overlap in the inventory. Produces a safe local candidate and a reviewable plan for any ledger exception.
- **Start here** — Record `git status --short --branch` and `git rev-parse HEAD`. Check current main and staging refs, compare migration manifests, inspect the two report paths and the existing maintenance checks. Preserve the dirty worktree. Follow the repository's integration method on a task-owned branch or worktree when authorized. Preserve staging SQL bytes, migration policy and routine ownership. The feature's conflicting migration may receive the next free ID only once the shared ledger condition is established. Resolve conflict pairs in the API registration, repository, shared knowledge UI and desktop allowlist. Prepare clean and staging-era disposable PostgreSQL verification.
- **Accept and prove** — AC-06, AC-10 through V-06 preservation checks and V-10 baseline checks.

## T-02 — Prove the first human case and role projections

- **Blocked by** — T-01 local baseline. The existing local manual path can be investigated while a cutover decision is pending.
- **Outcome** — An allowed reader reports the exact version and sees a case ID. An eligible non-author reviewer claims it. An Admin can resolve an assignment exception.
- **Work** — Finish page or passage capture and scoped **Start review**. Prove command replay and independent reports against PostgreSQL, including concurrent retries. Reuse canonical Department versus Organization policies and a narrow exact-source resolver where caller RLS hides the necessary routing facts. Complete claim race recovery, grant loss and the eligible-reviewer picker. Fix list, detail and history projection together so minimal reporter visibility is enforced before serialization. Clear stale client state. Show the pinned source only through case-authorized reading.
- **Accept and prove** — AC-01, AC-02, AC-03 through V-01, V-02, V-03.

## T-03 — Carry forward legacy reports and switch intake

- **Blocked by** — T-01 and T-02. Implement the affected compatibility paths after the pending cutover decisions in [Architecture](ARCHITECTURE.md#risks-requiring-a-repository-check-or-decision) are resolved.
- **Outcome** — One reader action goes to Maintenance after local cutover. Existing open work, legacy history and assignment exceptions reconcile without duplicate cases or import alerts.
- **Work** — Use one writer boundary for old/new calls and a durable import mapping. Exercise before/after requests, retries, changed payload and closure races. Preserve source records and audit through an authorized history read path. Keep mapped records out of independent legacy triage. Preserve direct Admin and reviewed author withdrawal behavior. Keep eligible imports pinned to the old version with an accurate provenance event. Close out manifest, role/ownership, access and upgrade evidence.
- **Accept and prove** — AC-03, AC-10 through V-03, V-10.

## T-04 — Make progress and audit history visible

- **Blocked by** — T-02. T-03 import cases join this slice when its contract is ready.
- **Outcome** — **My reports** and **Reviews → Maintenance** show authorized unread updates. Reporter and reviewer histories visibly differ by permission.
- **Work** — Finish event and inbox reads, stable pagination, audience filtering and permission-checked links. Keep logical event/recipient deduplication under real runtime roles. Record safe explanations and show clear empty, loading and unavailable states. Exercise read/open after grant or source changes and clear previously rendered data. Match the [audit sequence](../../product/flows/flow-4-sequences.md#audit-storage-and-display-sequence).
- **Accept and prove** — AC-03, AC-04, AC-08 through V-03, V-04, V-08.

## T-05 — Compare exact versions in chronological order

- **Blocked by** — T-02 exact-source reading and projections.
- **Outcome** — Start at v3, see the fix in v4 and spot a recurrence in v5. Jump to the applicable current version and open either exact source.
- **Work** — Implement the case timeline and deterministic diff with stable anchors, bounded text, labeled changes, collapsed context and a manual original view. Check both source grants at fetch, compute and response. Keep the active pair stable when a newer version appears. Exercise hidden intermediates, upcoming versions, revocation and scan-only sources. Use a unified diff on mobile and appropriate optional side-by-side originals on desktop.
- **Accept and prove** — AC-03, AC-05, AC-08 through V-03, V-05, V-08.

## T-06 — Complete the manual decision and information loop

- **Blocked by** — T-02 and T-04.
- **Outcome** — A reviewer asks a question, sees an allowed reply and resolves **No change needed** with a safe explanation.
- **Work** — Add participant-scoped messages, actionable updates and separate reporter explanation/reviewer rationale. Keep the case in progress during information gathering. Recheck authority and revision before the human decision. Persist state and events atomically.
- **Accept and prove** — AC-03, AC-04, AC-06 through V-03, V-04, V-06.

## T-07 — Link Flow 2 and confirm an actual outcome

- **Blocked by** — T-01, T-05, T-06.
- **Outcome** — An author submits the linked request in **My Contributions**. The case stays open while publication is pending, then a reviewer verifies and confirms the actual correction or withdrawal. An already applicable exact same-document fix is also usable.
- **Work** — Add update and withdrawal remedies, exact Flow 2 links, authorized ownership exception when the author cannot act, and publication proof with a current revision check at closure. Preserve index-ready activation and applicability, including legacy scheduled versions. Show and exercise unavailable, pending, rejected, failed, upcoming or superseded evidence.
- **Accept and prove** — AC-03, AC-04, AC-06 through V-03, V-04, V-06.

## T-08 — Link recurrence without reopening prior work

- **Blocked by** — T-05 and T-07.
- **Outcome** — A new report about v5 links to the previous resolved case. Recipients see authorized context and each case has its own decision.
- **Work** — Add typed, permission-checked link handling and a reviewer-facing relationship display. Verify independent owner, status, history and explanations for both cases, including shared applicable Flow 2 evidence.
- **Accept and prove** — AC-03, AC-09 through V-03, V-09.

## T-09 — Add one bounded AI investigation

- **Blocked by** — T-05 and T-07. Confirm paired service contract and environment before a live provider check.
- **Outcome** — A reviewer selects the exact evidence, starts one analysis, opens a validated citation, and can cancel, retry or continue manually.
- **Work** — Inspect both repos and agree on a strict, versioned caller/service contract with paired fixtures and finite bounds. Connect the Core run, lease, attempt and assignment/access fences to Arden-AI. Keep canceled, stale, unauthorized or invalid output out of committed findings. Add evidence selection, queue/running/result/error UI and explicit rerun. Test first with fake providers and synthetic documents.
- **Accept and prove** — AC-03, AC-04, AC-07, AC-08 through V-03, V-04, V-07, V-08.

## T-10 — Prove the full journey and return evidence

- **Blocked by** — T-03 through T-09.
- **Outcome** — One signed-in walkthrough demonstrates report, claim, compare, investigate, publication handoff, human confirmation, reporter update and reviewer audit, with a separate recurrence. Existing Flow 2 behavior also has evidence.
- **Work** — Run required project checks, real PostgreSQL and signed-in browser and Electron scenarios. Record approved fixture setup, safe screenshots and actual results by acceptance ID. Reconcile each changed flow step and diagram with source and tests. Leave [Status](STATUS.md) ready for the planner and coordinate the existing repository handoff procedure.
- **Accept and prove** — AC-01 through AC-10 through V-11 and the referenced V-01 through V-10 evidence.
