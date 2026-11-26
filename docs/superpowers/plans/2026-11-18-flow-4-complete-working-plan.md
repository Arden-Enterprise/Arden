# Flow 4 · Complete working plan

**Cursor entry point, 2026-11-19** — Use the [validated feature handoff](../../features/knowledge-maintenance/HANDOFF.md) to start or resume execution. This plan records the earlier phases and approvals.

**Scope** — Finish and verify the whole confirmed Knowledge Maintenance flow, from the reader or reviewer entry point through version comparison, Flow 2 handoffs, bounded AI investigation, human resolution, and audit history. The staged execution guidance below replaces the first-slice launch prompt for a full-flow run.

**Status, 2026-11-18** — Product decisions Q1–Q23 confirmed. The manual slice has focused local test evidence. Full-flow implementation and runtime acceptance remain open, including implementation of the approved cutover for existing governance reports.

**Baselines** — Feature worktree `feat/knowledge-maintenance` at `c35737d`; starting staging `0eae5b8`; current remote staging inspected at `af28915`; current remote main `9fa3d34`. The new staging tip was inspected through GitHub. Reconfirm it before integrating. [Staging change set](https://github.com/Arden-Enterprise/Arden/compare/0eae5b8...af28915)

**Read in order** — [Flow 4 spec](../../product/flows/flow-4-maintenance.md), [sequence catalog](../../product/flows/flow-4-sequences.md), [glossary](../../../GLOSSARY.md), [report intake decision](../../decisions/0028-maintenance-report-intake.md), [original task details](2026-11-17-flow-4-maintenance-cursor.md), [Arden design skill](../../../.cursor/skills/arden-flow-design/SKILL.md), and the current repo rules.

## Paste into Cursor for the full run

```text
Open the Arden feature worktree for feat/knowledge-maintenance.
Read docs/superpowers/plans/2026-11-18-flow-4-complete-working-plan.md,
the linked spec, sequence catalog, glossary and Arden Flow Design skill.
Use this plan's start prompt and checkpoints for the full run.
Check the current staging revision and the Flow 2 governance changes first.
Resume the existing branch from the implemented manual slice. Follow
Phases 0–5 in order and continue past Milestone 1 after its checks pass.
Use the owner's recorded decisions to resolve the report overlap. If a
decision is still open, continue independent work and surface the exact
blocked paths. Report decisions or risks instead of inventing approval.
Load frontend-ui-engineering before implementing or modifying any Flow 4 UI.
Use Impeccable for visual direction and Save.design for component research.
Build with Arden's existing Island tokens and shared components.
Keep a checkpoint with exact revisions, checks and remaining acceptance
for each phase. Work within the owner's implementation and release scope.
```

## UI implementation guidance

Apply `frontend-ui-engineering` across the reader, reviewer, author, and admin surfaces. Reuse Arden's shared components and semantic tokens. Keep data fetching and permission decisions at their existing boundaries and give each screen a clear primary action. Cover keyboard and focus behavior, responsive layouts, and the applicable loading, empty, success, error, and access states. Use the project's existing verification commands and the checks for each phase below.

Use Impeccable's Operate guidance for the document-first Island design. Keep the reported version visible, use text labels on additions and removals, and keep the next case action close to the evidence. Consult Save.design through the Arden Flow Design skill for patterns that the existing Arden surfaces do not cover.

## Phase 0 · Reconcile the feature with current staging

**Why this comes first.** The local branch introduced migration `0036_maintenance_cases.sql` before staging acquired its own `0036` plus `0037` and `0038`. Staging also added a visible publication problem-report workflow and a scoped governance reader. A text merge alone cannot reconcile either overlap. [ADR 0023](https://github.com/Arden-Enterprise/Arden/blob/af28915/docs/decisions/0023-organization-admin-governance-access.md) · [ADR 0024](https://github.com/Arden-Enterprise/Arden/blob/af28915/docs/decisions/0024-admin-only-direct-withdrawal.md)

- [ ] Record the active worktree, exact feature head, staging head and migration inventory. Preserve the feature tip and existing worktrees. Use the project's approved integration method on a task-owned branch or worktree.
- [ ] Allocate the next free migration ordinal for the local, unpublished maintenance migration after the refreshed inventory. `0039` is a candidate against `af28915`. Check that the local migration has not been applied to a shared target before replacing its ordinal. Preserve all previously shared migration bytes, deployment inventory and routine-owner checks.
- [ ] Reconcile `apps/api/src/app.ts`, `apps/api/src/db/repository.ts`, migration release policy, `packages/ui/src/knowledge/ServerKnowledgeFeaturePage.tsx`, `PublicationGovernance.tsx`, and `apps/desktop/src/main/apiRequestPolicy.ts` with staging. Keep Flow 2's retry, governance, author request and Admin-only direct withdrawal paths. Use a distinct case route for the exact pinned evidence so the governance reader does not become general history access.
- [ ] Continue the one existing **Report a problem** action into version-pinned Maintenance intake at cutover. Validate that an updated client's request uses one write path and same-key replay. Map the `publication_report` lifecycle, ACL, duplicate rule, dismissal and withdrawal behavior before changing existing report handling. Preserve old report IDs, audit lineage and supported clients. Inspect existing records only through an authorized read path.
- [ ] **F4-00 / MA-10.** Carry eligible open reports forward as unassigned **Submitted** cases using the approved transition below. Preserve closed history and isolate unverifiable rows for authorized review. Coordinate the import with intake cutover so an in-flight or retried submission has one authoritative write path. After import, keep the original record visible under existing governance permissions and remove it from independent triage. Record how supported clients and existing report references behave after cutover.
- [ ] Seed synthetic open, closed, replaced-version, withdrawn-version and unverifiable reports. Verify classification, exact pins and original attribution, one-to-one retry behavior, queue and reporter visibility, authorized exceptions, and suppression of fresh-submission notifications. Verify existing closure history and Flow 2 authority. Exercise writes immediately before and after the legacy-to-Maintenance switch.
- [ ] Verify the combined migration chain on disposable PostgreSQL, from a clean install and from the staging-era baseline. Run under the real restricted runtime role after ownership transfer. Typecheck the merged UI and confirm the preservation of existing governance actions.

**Exit evidence.** One current migration inventory and one reader entry for new cases after cutover. Reconcile each fixture report to its imported case, retained closed history or visible authorized exception. Case projection and comparison work can proceed independently.

## Phase 1 · Finish and prove the manual path

**Resume from code already present.** The branch has version-pinned intake, one winning claim, Admin reassignment, **No change needed**, Home → My reports, Reviews → Maintenance, scoped history, and a desktop allowlist. The recorded checks used in-memory API tests and focused client checks. Inspect and extend those paths.

- [ ] **F4-01 / MA-01.** Keep exact-version identity and request-key replay, and complete the reader's optional page/passage input and the reviewer-started screen. Validate anchors against the exact source and separate a transport retry from an independent report. First prove intake with an allowed reader who is neither author nor reviewer. The local source resolver joins draft/submission tables that can be hidden under that reader's RLS; reuse authorized publication reads and a narrow server-owned resolver for needed route and source facts. Verify that this neither expands draft access nor leaks metadata.
- [ ] **F4-02 / MA-02.** Replace the Admin membership-ID input with an eligible-reviewer picker. Show the permitted current assignee after a claim race and route no-eligible/revoked-assignee cases to the authorized reassignment queue. The author can contribute context and cannot claim or close their own version. Reject reassignment after closure. Test recipient and reviewer lookup under actual actor-scoped RLS. Current direct `reviewer_grant` queries can miss other grantees. Resolve exact Department versus Organization scope from the publication and reuse canonical grant checks rather than broadening policy. Cover repeated matching grants and disabled participants using disposable database fixtures.
- [ ] **F4-02 to F4-07 / MA-03–04.** Fix projection together with its callers. The current minimal reporter view hides the timeline in React, while the history endpoint can still return public explanation text. Gate persisted data before serialization. A minimal reporter gets only case ID and status. Peers and a former assignee get only the allowed projection under their current grant. Fetch detail before history or handle both through the same current policy. Clear stale client data on actor and permission changes. Add denial tests at real API/RLS boundaries, including cached view and direct history reads.
- [ ] **F4-03 entry.** Show the pinned document safely in the case workspace, even before the version comparison panel. Render from case-authorized immutable PDF or text. Other surfaces keep their own read rules. Restore focus and scroll when the viewer returns.
- [ ] **F4-07 / MA-04.** Add unread case updates to **Home → My reports** and **Reviews → Maintenance**, opening the permitted case. Current code persists rows and lacks a client inbox. Use atomic database-enforced deduplication across event and audience entries, and revalidate access on list and open. This work covers Maintenance events. Flow 2 inspection notification scope follows its separate release decision.
- [ ] **F4-06, F4-07 / MA-06, MA-08.** Verify the no-change decision with separate reporter explanation and reviewer rationale. Confirm persistence, safe audit display, zero denied writes, and atomic claim plus history. Exercise signed-in web and genuine Electron using synthetic data. Record screenshots or interaction evidence for the reader, queue, case, and My reports. Verify the UI stays recognizably Arden.

**Exit demo.** A reader files IT Support Guide v3 and repeats the request. Two eligible reviewers race, one claims, and records **No change needed**. The reporter sees the safe outcome. An authorized reviewer sees the history. Re-run against a separate case for reassignment and revoked source permissions.

## Phase 2 · Compare versions in chronological order

**F4-03 / MA-05.** Build the exact-version history and comparison APIs and `VersionChanges` component from the original Task 4. Use the case-purpose grant for the pinned version only. Check each comparison version's own authority before fetching sources and again before returning results. Show authorized versions and the exact selected pair. Compute counts after applying visibility and omit titles and content of inaccessible versions.

- [ ] Add source resolver and read-only version timeline. Use canonical lineage/eligibility and preserve the active pair if a later authorized version arrives. Distinguish the currently applicable version from an upcoming publication.
- [ ] Implement and fixture-test bounded deterministic diffing. Show green **+ Added** and red **− Removed** plus textual labels, start at the reported passage when it maps, collapse unchanged text, and retain original page/section navigation. Use a clear manual comparison path for scans and oversized/unmappable text.
- [ ] Prove that v4 fixes the issue and v5 reintroduces it. Both sequential changes are visible even when v3 → v5 has an empty diff. Verify a hidden intermediate, source revocation during computation, and stale UI cleanup.

**Exit demo.** Compare v3 → v4 → v5 and the reported-to-current shortcut. The reviewer understands where the issue was fixed and where it came back.

## Phase 3 · Finish human decisions and Flow 2 handoffs

**F4-04, F4-05, F4-06 / MA-06, MA-09.** Implement the manual branches first. Keep the approved publication and case state machines separate.

- [ ] Add **Request more information**, a permitted reporter reply, and the authored case notice. Keep the case In Progress. Notify participants only for actions and progress that are meaningful.
- [ ] Add **Request update** and **Request withdrawal**, an eligible author action, and the exact link to the existing Flow 2 submission or request. If the original author is unavailable, surface the authorized ownership exception. Preserve existing author request paths and the Admin-only direct route defined by ADR 0024.
- [ ] Read authoritative publication outcome for the exact lineage. Support linking an already applicable replacement when the reviewer identifies how it addresses the report. Pending, rejected, superseded, failed, unrelated and upcoming outcomes leave the case open.
- [ ] Check the compatible closed-withdrawal behavior across both domains. ADR 0024 closes open publication problem reports on direct withdrawal. A Maintenance case continues to follow the approved human-confirmation rule. If the selected integration model links these records, record the Flow 2 outcome in the case while retaining an independent case resolution transition.
- [ ] During terminal confirmation, recheck reviewer authority, revision, live publication evidence, version and passage when available, and store the explanation and reviewer rationale atomically with history. Open a new related case on recurrence and preserve previous resolutions. Each linked case keeps its own owner, status, explanation and human-confirmed outcome. Verify that a link exposes only case information the viewer can access and that closing one case leaves its sibling's decision pending.

**Exit demo.** One case closes only after the applicable correction is verified, another after actual withdrawal and human confirmation. A rejected or stale request stays In Progress. Repeated publication failure and a recurrence produce accurate history.

## Phase 4 · Add one bounded AI analysis

**F4-04 / MA-07.** Implement the paired Core/Arden-AI Tasks 6 and 7 over exact evidence. The worker can return findings and citations, and reviewers own decisions.

- [ ] Inspect current Arden-AI main and caller contracts. Add versioned paired fixtures for authorized sources, malformed spans, insufficient evidence, transient provider failure, cancellation, and revocation after dispatch.
- [ ] Persist one active run per case. Recheck scope before dispatch and commit. Resolve the exact case/selected source versions through Core and fence results from a cancelled run, old worker, or replaced assignee. Keep raw prompts, document text, and provider errors out of logs and notifications.
- [ ] Add the reviewer's source selection and explicit **Analyze** action, result scope, version-specific findings, authorized citations, **Cancel**, **Retry**, and manual continuation. A later authorized version prompts compare or explicit rerun. Withhold dependent findings upon access loss.
- [ ] Verify the bounded run first with fake provider fixtures and disposable data. Then complete the approved provider and host verification, including service compatibility and error recovery. Follow paired repository integration guidance for the API/Core contract.

**Exit demo.** The reviewer runs analysis on two allowed versions, opens an exact citation, cancels and retries a separate run, and manually resolves a case even when analysis fails.

## Phase 5 · Whole-flow acceptance

- [ ] Run the focused tests named in the original plan plus the current repo's required checks. Verify additive migration compatibility, real PostgreSQL policy/concurrency, web and Electron with current user sessions. Record fixture data and observables for all acceptance IDs.
- [ ] Demo the full journey in one continuous role-based walkthrough: report → claim → compare → analyze or inspect manually → request correction → Flow 2 publication outcome → confirm → reporter progress and authorized audit.
- [ ] Cover the negative paths that would change a user's result: cross-organization access, author claim, racing claimers, revoked grant, restricted evidence, stale version/decision, delayed or failed publication, cancelled/late AI result, and separate case on recurrence.
- [ ] Update the owning product contract, flow diagram and step catalog with the actual feature refs and behavior. Record a dated Knowledge handoff and open evidence gaps. Give the owner an exact readiness report for local behavior, code review, integration and environment deployment.

| Acceptance | Evidence to capture | Phase |
| --- | --- | --- |
| MA-01 | Exact-version intake, replay and invalid-source denial | 1 |
| MA-02 | Independent claim/reassignment under real concurrency and current grants | 1 |
| MA-03 | Safe case, history and notification projections, including direct calls after revocation | 1, 2, 4 |
| MA-04 | State plus event atomicity, authorized timeline and notification read/open | 1, 3 |
| MA-05 | Authorized ordered version pair, visible additions/removals and manual fallback | 2 |
| MA-06 | Human decision and actual Flow 2 correction/withdrawal proof | 1, 3 |
| MA-07 | Bounded evidence, citation checks, cancellation and retry | 4 |
| MA-08 | Signed-in web and genuine Electron, keyboard, responsive Arden UI | 1–5 |
| MA-09 | New linked case and intact prior resolution | 3 |
| MA-10 | Existing report continuity, safe cutover and retry, preserved history, authorized queue and reporter visibility | 0–1 |

## Approved integration decisions

The owner confirmed Q20–Q23 on 2026-11-18. These decisions extend the previously confirmed Q1–Q19 and are reflected in the [spec](../../product/flows/flow-4-maintenance.md), [glossary](../../../GLOSSARY.md) and [diagrams](../../product/flows/flow-4-sequences.md).

| ID | Approved direction | Dependent work |
| --- | --- | --- |
| Q20 | Keep one **Report a problem** action. New submissions after cutover create version-pinned Maintenance cases. Preserve existing governance reports and audit history. | Phase 0 junction and Phase 1 intake |
| Q21 | Put unread case updates in **My reports** and **Reviews → Maintenance**, with authorized links to the case. | Phase 1 notification surface |
| Q22 | Links share context. Each case retains its own assignee, status and human-confirmed outcome. | Phase 3 related/recurring cases |
| Q23 | Carry eligible open governance reports forward once as unassigned **Submitted** cases. Retain original closed dispositions in governance history. | Phase 0 cutover and Phase 1 authorized visibility |

**Q23 · Existing report transition** — Preserve a one-to-one reference to the original report, its pinned published version, reporter, original text and timestamp. Keep the source record and audit trail intact. Make the import idempotent and record its provenance. Suppress new-submission notifications for imported reports. Route any open record whose pin or assignment scope cannot be verified to authorized review before importing it. Apply the approved human resolution rules if a publication has already been withdrawn.

The inspected governance schema preserves the original report facts and closure disposition. Native Maintenance resolution requires an assignee and reporter-facing decision. The normal case intake writes a fresh submission event and notifications, so the import needs a dedicated transition path. Confirm current source and reconcile the inventory in an authorized environment during implementation. [Governance report schema](https://github.com/Arden-Enterprise/Arden/blob/af28915231817aaf6efc67c8f534b627aa45b178/apps/api/migrations/0037_publication_governance.sql#L44-L82) · [Maintenance case constraints](../../../apps/api/migrations/0043_maintenance_cases.sql#L39) · [Case submission](../../../apps/api/src/maintenance/case-service.ts#L44)
