# Flow 4 Runtime Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Cursor is the implementation owner. Keep one orchestration workflow.

**Goal:** Make the approved Flow 4 journey usable through the signed-in Arden app from report and review through publication proof, independent resolution, and authorized history.

**Architecture:** Keep the existing Maintenance service, store, and case surface. Wire the shared React client to typed, permission-checked Core commands and reads, reuse Flow 2 for actual publication outcomes, and use Arden-AI as the bounded analysis provider. Prove each path with a disposable PostgreSQL ledger, real runtime roles, and signed-in web and Electron evidence.

**Tech Stack:** Arden React/TypeScript and Electron, Fastify, PostgreSQL 17, pnpm 11.19.0 on Node 24, and the paired Python/FastAPI Arden-AI service.

**Spec:** [Approved Flow 4 behavior](../../product/flows/flow-4-maintenance.md), [F4-00–F4-07 sequence catalog](../../product/flows/flow-4-sequences.md), [AC-01–AC-10](../../features/knowledge-maintenance/SPEC.md), and [V-01–V-11](../../features/knowledge-maintenance/VERIFICATION.md).

## Global Constraints

- Use the existing `feat/knowledge-maintenance` worktree and preserve the integrated staging baseline. Planning snapshot is Arden `d81b0624b2c67ae97291bb8d1b23c03716f597c6`, staging `af28915231817aaf6efc67c8f534b627aa45b178`, paired AI branch `ed2776ec3f1a8681160301039bc1c70efb3abc94`. Reconfirm before editing. Keep original SQL bytes and routine ownership and add forward migrations using the next verified free ordinal.
- Carry Q1–Q23 forward. Keep the exact reported version, canonical audience-specific reviewer authority, independent human resolution, and separate publication and analysis state. Keep reporter explanations separate from reviewer rationale. After source-access loss an active reporter sees case ID and status only. Drop dependent content on permission, organization, or actor change.
- Apply `frontend-ui-engineering` across Flow 4, Impeccable's Operate guidance, [Arden's Island system](../../../DESIGN.md), and the [Arden Flow Design skill](../../../.cursor/skills/arden-flow-design/SKILL.md). Use Save.design for generic read-only component references when Arden lacks a pattern. Keep document and exact version prominent. Use **+ Added** and **− Removed** labels with the existing semantic colors. Keep loading, empty, denied, stale, retry, focus, and narrow-screen states explicit.
- Use synthetic data and isolated storage and PostgreSQL. Do not use an existing SSH tunnel or shared database as a disposable target. Live providers, server work, commits, publication, merges and deployment follow the owner's authorization and current repository rules.
- Treat focused unit and component results as evidence at their own layer. Record exact observed outcomes in [Status](../../features/knowledge-maintenance/STATUS.md). Update the canonical step catalog and diagrams when behavior, permission, failures, call order or handoffs change.

## Review Focus

- A reporter loses access with details/history in flight. UI clears stale data and the API returns only the permitted minimal view. Task 1 and Task 3.
- An old-client request races import or repeats the same wording after a previous report closes. One active record owns the old-client request, with a legitimate fresh report governed by the approved compatibility decision. Task 2.
- A newer publication becomes available mid-comparison. The selected authorized pair stays fixed and the current shortcut resolves to applicable guidance. Task 4.
- The newest submission is unrelated to the case, pending, superseded or scheduled. It cannot supply closure proof. Task 5.
- A worker returns after cancellation, source revocation or reassignment. No result is committed or shown. Task 7.

## Execution decisions

The Flow 4 owner approved Q24–Q26 and confirmed this implementation plan on 2026-11-19. Tasks 1–8 map to T-11–T-18 in the [Cursor task index](../../features/knowledge-maintenance/TASKS.md).

| Question | Approved answer | Items affected |
| --- | --- | --- |
| Q24 · Older clients | Preserve current supported endpoint behavior with one open report per member/document. Return its existing duplicate response while open and permit a legitimate fresh submission after closure, even with identical wording. Keep keyed replay for the current client and resolve the writer boundary in the database. | Task 2 compatibility contract |
| Q25 · Closed governance history | Add a read-only **Closed** filter in the existing **Reported problems** surface. Keep original disposition and audit under existing authorized roles. | Task 2 retrieval and UI |
| Q26 · Verification gates | First prove the whole signed-in journey on isolated synthetic data with a controlled analysis adapter. Before full release readiness, verify the real Arden-AI endpoint and provider separately with approved synthetic evidence. | Tasks 7–8 verification order |

Keep proceeding with independent planning and tasks when a decision only blocks one slice. Use existing vocabulary from the [glossary](../../../GLOSSARY.md). A closed legacy report is a governance record. A resolved Maintenance case has an independent human decision.

## Source map and starting point

| Area | Files and seam | Observed gap |
| --- | --- | --- |
| Case UI | `packages/ui/src/knowledge/ServerKnowledgeFeaturePage.tsx`, `packages/ui/src/maintenance/MaintenanceCaseScreen.tsx`, `maintenance-client.ts`, `VersionChanges.tsx`, `Findings.tsx`, `CaseHistory.tsx` | Production mounts pass the manual actions and history. Compare, message, link, publication confirmation and analysis are absent from the client. |
| Core and PostgreSQL | `apps/api/src/maintenance/{routes,contracts,case-service,case-store,policy}.ts`, `apps/api/src/db/repository.ts`, `apps/api/src/app.ts` | Routes exist for several actions. Text store returns null, publication proof chooses latest submission, import has no production caller, and history/role policies need runtime proof. |
| Electron | `apps/desktop/src/main/apiRequestPolicy.ts`, `apiRequestPolicy.test.ts` | Existing blanket Maintenance POST rule requires a body and idempotency key, including the read-only compare call. Match the actual route contracts and verify the same workflow on both platforms. |
| Service | Arden-AI `src/arden_ai/contracts/maintenance_analysis.py`, `src/arden_ai/presentation/api.py`, `tests/test_maintenance_analysis.py` | The paired fixture has case/version IDs and summaries. It needs exact source manifests and validated spans. Core calls a local fake. There is no served maintenance analysis endpoint or durable worker path at this baseline. |
| Evidence | `apps/api/src/db/repository.integration.test.ts`, `.github/workflows/ci.yml`, `apps/api/migrations/0039_maintenance_cases.sql` through `0045_maintenance_analysis_runs.sql` | Migration inventory, unit suites, and UI components were checked earlier. Combined ledger, RLS, signed-in hosts, and provider remain pending. |

Use the focused test commands from the package's [verification plan](../../features/knowledge-maintenance/VERIFICATION.md). The exact commands below assume installed project dependencies and run from the owning repo root. Capture the task diff and checkpoints. Commit only when authorized.

---

### Task 1 · Establish an isolated runtime and prove the wired path

**Files:** Extend `apps/api/src/db/repository.integration.test.ts` or create `apps/api/src/maintenance/maintenance.integration.test.ts` using the existing harness. Use `apps/api/src/maintenance/{case-store,contracts,policy,case-service,routes}.ts` for demonstrated runtime gaps. Update `packages/ui/src/maintenance/MaintenanceCaseScreen.tsx` and `maintenance-client.ts` for the reassignment picker. Add a forward migration and update `apps/api/migrations/release-policy.json` if runtime policy needs a schema change.

**Interfaces:** Keep `createCase(userId, organizationId, input: IntakeInput, requestKey): Promise<CaseProjection>`, `claimCase(userId, organizationId, caseId, expectedRevision, commandKey): Promise<CaseProjection>`, and `listHistory(userId, organizationId, caseId, cursor): Promise<HistoryPage>`. Use a narrow actor-scoped metadata read. An Admin-only candidate read supplies eligible `{membershipId, displayName}` choices for the existing `reassignCase` command. Core rechecks the selected member before writing.

- [ ] Record exact heads, available local tools, and approved disposable target. Follow the [database CI job](../../../.github/workflows/ci.yml) for PostgreSQL 17 extensions, full-chain migration, repeat no-op, and `tools/verification/migration-owner.py --full-schema` under its documented disposable setup. Verify target identity and prefix before an upgrade replay. If the machine lacks local PostgreSQL/Docker, use the existing disposable CI procedure when available and authorized. Mark the database gate pending until it runs.
- [ ] Add **authorized non-author report, one winner, and revoked history**: a reader can report synthetic IT Support Guide v3, competing eligible reviewers claim once, wrong-scope and author attempts leave state unchanged, and minimal readers receive no history or explanation. Verify reassignment denies the former assignee, pagination with filtered entries stays usable, and failed transactions leave no case/event/notification fragments.
- [ ] Run `pnpm --filter @arden/api test` against the explicitly configured `arden_test_*` database. Confirm the Maintenance integration cases execute under actual runtime ownership and RLS. Record failures or skipped cases by name.
- [ ] Repair demonstrated failures using canonical scope and safe projections. Use PostgreSQL uniqueness plus valid conflict recovery for concurrent same-key replay. Validate the submitted page/passage against the exact source when supplied. Connect the eligible-reviewer picker and retest actual role paths.
- [ ] Open signed-in sessions with an allowed reader, independent reviewer and Admin. Use `pnpm dev` and `pnpm dev:desktop` with the existing loopback synthetic sign-in mode where applicable. Follow its [database and synthetic account requirements](../../engineering/operations.md#2-ports-environment-and-configuration). Submit, find the same case, claim, reassign, close **No change needed**, and see permitted history. Capture the role, evidence and step IDs. Covers **V-01–V-04** and the manual part of **V-08**.

### Task 2 · Complete report cutover and retained history

**Files:** `apps/api/src/app.ts`, `apps/api/src/maintenance/{case-service,case-store}.ts`, `apps/api/src/db/repository.ts`, `packages/ui/src/knowledge/PublicationGovernance.tsx`, `packages/ui/src/shared/api-client.ts`, `apps/desktop/src/main/apiRequestPolicy.ts`. Test in the Task 1 integration harness plus `packages/ui/tests/publicationGovernance.test.tsx`.

**Interfaces:** Existing legacy `POST /published/:publishedVersionId/reports` consumes `{message}` and reports `201 {id}` or `409 ALREADY_REPORTED`. Existing `LegacyReport` import shape is a service input. The trusted caller supplies verified server-read rows scoped by organization. Preserve open, closed, and held outcomes, original reference and audit. The closed history read returns a paged, authorized legacy projection with original disposition and allows no triage action.

- [ ] Add **legacy retry, mapped report and closed disposition**: use a seeded staging-era ledger and real legacy rows. Import twice and race import with dismiss/withdraw. Assert exactly one case per eligible source, original pin/time/text, no submission alert, preserved held rows, and no second actionable governance triage for mapped rows. A legacy duplicate while open returns 409. The same wording after closure with valid current evidence creates a new case.
- [ ] Run `pnpm --filter @arden/api test` on the disposable staging-era upgrade; expect the import/cutover tests to fail until a real caller and write boundary exist.
- [ ] Connect import to an authorized, resumable operator path that reads and verifies source rows and decides status at the commit boundary. Persist a unique mapping and original audit atomically. Preserve existing old-client response and single-writer behavior per Q24. The legacy content-derived key must allow a new currently eligible submission after closure. Make legacy list/count/dismiss respect the same mapping and keep direct Flow 2 withdrawal semantics. Provide the permission-checked closed history read and UI per Q25.
- [ ] Rerun the PostgreSQL suite and `pnpm --filter @arden/ui test tests/publicationGovernance.test.tsx`. Demonstrate an unassigned imported case in both queue and allowed reporter view, an unchanged closed disposition, and an authorized exception. Cover **V-10** and the relevant **V-03** checks.

### Task 3 · Connect case actions, questions, replies, and unread history

**Files:** `packages/ui/src/maintenance/maintenance-client.ts`, new `packages/ui/src/maintenance/useMaintenanceCase.ts`, `MaintenanceCaseScreen.tsx`, `CaseHistory.tsx`, `packages/ui/src/knowledge/ServerKnowledgeFeaturePage.tsx`, `apps/api/src/maintenance/{routes,case-service,contracts,policy}.ts`, and desktop allowlist. Add `packages/ui/tests/maintenanceCaseActions.test.tsx`, reusing existing UI test tooling.

**Interfaces:** Add `postMaintenanceMessage(platform: Platform, organizationId: string, caseId: string, input: { expectedRevision: number; message: string }, idempotencyKey: string): Promise<MaintenanceCase>` over existing `POST /cases/:caseId/messages`. Derive allowed actions from Core's projection. Use one case hook for reviewer and reporter mounts and scope its reads and command results by organization, case, and current actor. Reuse existing case/history/list shapes and stable event IDs.

- [ ] Add **real case container issues question and shows reply**: mount the same hook or page that production uses with a fake transport at the API boundary. An eligible reviewer sends a question, refreshes history, leaves the case **In Progress**, and the reporter can reply and produce an unread update. Include a subsequent different message on the same case to catch notification dedup collisions, and prove stale replies, grant/source loss and out-of-order case loads cannot show old data.
- [ ] Run `pnpm --filter @arden/ui test tests/maintenanceCaseActions.test.tsx` and `pnpm --filter @arden/api test`; expect missing action/wrong projection failures before wiring.
- [ ] Wire reviewer ask and permitted reporter reply using server-derived capability, expected revision and idempotency key. Preserve unsent text on retry, clear it after confirmed success, reload case/history and unread lists under current authority, and deduplicate by actual event and recipient. Protect author handoff updates under their narrow projection. Check both production mounts.
- [ ] Rerun the focused checks and `pnpm --filter @arden/desktop test`. Capture a signed-in reviewer question, reporter reply and safe histories. Covers **V-03**, **V-04**, and information-loop portion of **V-06**.

### Task 4 · Make exact-source reading and chronological comparison real

**Files:** `apps/api/src/maintenance/{contracts,case-store,case-service,routes,diff}.ts`, `apps/api/src/db/repository.ts`, `apps/api/src/app.ts`, `packages/ui/src/maintenance/{maintenance-client,useMaintenanceCase}.ts`, `packages/ui/src/maintenance/{VersionChanges,MaintenanceCaseScreen}.tsx`, and `apps/desktop/src/main/apiRequestPolicy.ts`. Extend `apps/api/src/maintenance/routes.test.ts`, the Task 1 harness, `packages/ui/tests/versionChanges.test.tsx`, and `apps/desktop/src/main/apiRequestPolicy.test.ts`.

**Interfaces:** Proposed scoped `GET /cases/:caseId/versions` returns readable `{ items: { publishedVersionId, label, publishedAt, applicability }[], currentPublishedVersionId: string | null, nextCursor: string | null }`. Proposed `GET /cases/:caseId/versions/:publishedVersionId` opens the permitted exact original. Keep existing `compareCase(userId, organizationId, caseId, fromVersionId, toVersionId)` and `POST /compare` with `{fromPublishedVersionId,toPublishedVersionId}`. Reuse the existing comparison union with exact IDs and add typed source anchors for the exact pair. Apply separate desktop validation for a read-only compare POST.

- [ ] Add **v3 to v4 fix, v4 to v5 recurrence**: seed immutable published body content at the proper storage boundary. Assert the two chronological pairs and their labeled changes, applicable-current jump eligibility, original anchors, no hidden ids/counts and no view of denied pairs. Change current while a pair is selected and revoke access while a read is in flight. Include empty, identical, scanned and oversized content.
- [ ] Run `pnpm --filter @arden/api test`, `pnpm --filter @arden/ui test tests/versionChanges.test.tsx` and `pnpm --filter @arden/desktop test`. Expect failing production-store and page transport assertions at the baseline.
- [ ] Replace the null body read with a scoped metadata resolver and the existing hash-checked content storage path. Bind scope to the case, allow extra sources only with their own exact authority, and recheck current actor and exact hash before returning. Keep private locator/metadata out of responses. Bound diff input and time before invoking the existing algorithm. A permitted unavailable original offers a manual path. Denied versions remain undisclosed.
- [ ] Connect version timeline, next/previous, applicable-current shortcut, unified diff, keyboard expansion and original views to both clients. Keep the existing pair until the reviewer chooses another authorized pair. Retest API/store/UI/IPC and capture a real compare with persisted content. Covers **V-03**, **V-05**, and the comparison part of **V-08**.

### Task 5 · Connect Flow 2 handoff and exact publication proof

**Files:** `apps/api/src/maintenance/{contracts,case-store,case-service,routes}.ts`, `apps/api/src/db/repository.ts`, `packages/ui/src/maintenance/{maintenance-client,useMaintenanceCase,MaintenanceCaseScreen}.*`, `packages/ui/src/knowledge/{ServerKnowledgeFeaturePage,PublicationChangeDialog}.tsx`, and desktop policy. Extend the Task 1 harness and `packages/ui/tests/maintenanceCaseActions.test.tsx`.

**Interfaces:** Keep existing **No change needed** via `POST /decisions`. Add case-scoped `POST /publication-link` with expected revision and selected evidence, a discriminated reference to an exact Flow 2 request/submission or an already applicable same-document published version. Add a safe proof projection with pending/applicable/ineligible state and its permitted reference. Extend `POST /publication-confirmation` additively with that reference and retain separate explanation/rationale. Keep author mutations in the existing Flow 2 routes.

- [ ] Add **only linked, applicable proof closes**. A reviewer requests a correction or withdrawal, and the author sees the eligible action. An unrelated or same-document older active submission, rejected, preparing, upcoming, superseded or raced evidence leaves the case in progress. A linked replacement that is currently applicable, an already applicable selected fix, or actual withdrawal against the right version can close after confirmation. Check direct Admin and reviewed author withdrawal facts separately.
- [ ] Run `pnpm --filter @arden/api test` with PostgreSQL and `pnpm --filter @arden/ui test tests/maintenanceCaseActions.test.tsx`; expect the wrong-proof regression to fail on the current newest-submission query.
- [ ] Persist the case-to-Flow 2 reference and reason. Query authoritative pointer, applicability and applied request/event against organization, lineage, affected version and expected action. The reviewed withdrawal request remains at publication state `NONE` while its target content moves to `WITHDRAWN`. Direct Admin withdrawal uses the exact-version publication audit. Recheck proof, case revision and reviewer authority before writing the terminal event. Use the current Flow 2 concurrency boundary. Keep the reporter explanation and reviewer evidence in separate authorized projections.
- [ ] Wire author link, case progress and explicit human confirmation. Show an authorized assignment exception when the author cannot act. Rerun API/UI/IPC checks and capture a signed-in update and withdrawal plus the pending/denied path. Covers **V-06** and the relevant **V-03–V-04** checks.

### Task 6 · Surface related cases and prove independent resolution

**Files:** `apps/api/src/maintenance/{contracts,case-service,case-store,routes}.ts`, `packages/ui/src/maintenance/{maintenance-client,useMaintenanceCase,MaintenanceCaseScreen}.*`, and the two production mounts. Extend the Task 1 harness and `packages/ui/tests/maintenanceCaseActions.test.tsx`.

**Interfaces:** Keep `POST /cases/:caseId/links` with `{relatedCaseId}` and command key. Expose an authorized `GET /cases/:caseId/links` or equivalent narrow case projection with safe case summaries. Filter both ends server-side before serialization. Link navigation opens a fresh authorized case detail.

- [ ] Add **recurrence links visible cases and preserves prior decision**: create a new report on v5 after v3 resolves, link as the assigned reviewer, reload and open the permitted sibling, then close only one case. Test foreign, hidden and otherwise ineligible linkage and no exposure of hidden link counts.
- [ ] Run `pnpm --filter @arden/api test` and `pnpm --filter @arden/ui test tests/maintenanceCaseActions.test.tsx`; expect the authorized related-case read and live navigation assertions to fail before wiring.
- [ ] Connect the link command and sanitized read. Show related cases as separate navigable items with their own status. Do not treat a link as publication proof or write to the sibling's lifecycle.
- [ ] Rerun focused checks and `pnpm --filter @arden/desktop test`. Capture separate role-safe histories and independent closure. Covers **V-03** and **V-09**.

### Task 7 · Make analysis durable and connect Findings

**Files:** Core `apps/api/src/maintenance/{analysis,case-store,case-service,contracts,routes}.ts`, existing Core worker startup and paired client seam, new additive run migration plus release policy, `packages/ui/src/maintenance/{maintenance-client,useMaintenanceCase,Findings,MaintenanceCaseScreen}.*`, and `apps/desktop/src/main/apiRequestPolicy.ts`. Arden-AI `src/arden_ai/contracts/maintenance_analysis.py`, `src/arden_ai/contracts/export_schemas.py`, `src/arden_ai/presentation/api.py`, and `tests/test_maintenance_analysis.py` plus paired fixtures.

**Interfaces:** Existing `POST /cases/:caseId/analysis` consumes `{versionIds}` with one to four exact IDs and a key. Evolve the response additively toward `{runId,state,findings}`. Add safe status/read by run ID and cancel a named run, preserving API callers as required. The paired service contract carries immutable ordered sources with version, hash, bounded text and stable source anchors. Findings name the source and exact span. A Core worker leases and fences a single durable run. Test adapter and real adapter implement the same contract.

- [ ] Add **controlled analysis end to end, stale result withheld**. Create, open queued/running state, poll, cancel, retry via a new attempt, and open a verified citation. Race two starts. Expire a lease, revoke source access, or replace the assignee before completion. Assert no invalid/late result, no fake success outside explicit fixture configuration, and safe retry/manual continuation.
- [ ] Run `pnpm --filter @arden/api test`, `pnpm --filter @arden/ui test tests/findings.test.tsx tests/maintenanceCaseActions.test.tsx`, and in Arden-AI `uv run pytest -q tests/test_maintenance_analysis.py` after using its reviewed dependency workflow. Expect missing Core run/worker/transport assertions or report the environment blocker.
- [ ] Add a real bounded worker and typed adapter. Persist selected source identities, attempt and lease fence, run status, and validated findings against one run. Recheck assignment, source access and fence before dispatch, commit and read. Update the same run through cancellation; keep prior results scoped to their original sources. Enforce versioned contract parity and validate spans before returning findings. Allow a controlled test adapter only in the explicit local fixture wiring. Keep raw source and prompts out of logs and audit.
- [ ] Wire evidence selection, start, status, cancel, retry and **Open citation** in the real case screen. Refresh statuses without applying a late response to a different case. Retest full transport on web and Electron. Use the real Core-to-Arden-AI HTTP contract with a controlled provider adapter for the first full journey, then exercise the configured live provider in a separately authorized synthetic check. Covers **V-07**, plus related **V-03**, **V-04** and **V-08**.

### Task 8 · Run the signed-in journey and return evidence

**Files:** `docs/features/knowledge-maintenance/STATUS.md`, `docs/product/flows/flow-4-sequences.md`, owning feature docs and the dated private handoff. Modify code only in slices with a named failing acceptance.

**Interfaces:** Use [V-01–V-11](../../features/knowledge-maintenance/VERIFICATION.md). Return explicit evidence per AC ID and environment. Use the glossary terms for case, publication outcome, and analysis run separately.

- [ ] Confirm the clean and staging-era disposable upgrades, second-run no-op, fixture cohort and actual role policy evidence. Run the root `pnpm migrations:check`, `pnpm typecheck`, `pnpm test`, `pnpm test:remote`, `pnpm build`, and paired AI checks for the integrated heads. Report exact commands and any skipped suites.
- [ ] With synthetic signed-in users, walk reader report → claim → chronological compare → question/reply or controlled analysis → author action → actual publication proof → human confirmation → reporter update and role-safe history. Include import, recurrence, revocation, wrong scope and retry cases. Repeat on genuine Electron, including matching IPC restrictions and responsive/focus checks. This is the first whole-journey gate.
- [ ] Record a separate real-provider result with synthetic authorized evidence before reporting release readiness. Capture tested contract revisions and actual source authorization. If the provider or target isn't authorized or available, record that gate as pending with the first walkthrough outcome intact.
- [ ] Reconcile each changed F4 step ID, its implementation state, failure paths and evidence. Record exact heads, commands, screenshots or trace paths, remaining gaps and the next owner. Report the local proof and release state separately. Cover **V-11** and all **AC-01–AC-10**.

## Cursor resume prompt

```text
Open the existing Arden feat/knowledge-maintenance worktree.
Read docs/features/knowledge-maintenance/HANDOFF.md and
docs/superpowers/plans/2026-11-19-flow-4-runtime-integration.md.
Use the approved Q1–Q26 scope. Start with Task 1 and preserve the baseline.
Run a disposable PostgreSQL and signed-in manual proof, then wire and verify
the missing paths task by task. Use frontend-ui-engineering and Arden's
shared Island UI. Capture actual acceptance in STATUS.md and the sequence
catalog. Report synthetic signed-in proof and live provider proof separately.
Follow repository authorization for commits, shared environments and releases.
```
