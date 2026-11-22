# Flow 4 architecture

## Current design baseline

The reconciled local candidate on staging `4df192d` wires the reader report, reviewer queue and case actions, exact-version comparison, analysis, Flow 2 proof, links and authorized history through shared web and Electron UI. The staged migration prefix is 0001–0042. Maintenance follows at 0043–0060, beginning with [case schema 0043](../../../apps/api/migrations/0043_maintenance_cases.sql). Case events, notices and access remain Core concerns. Arden-AI v2 accepts bounded source evidence for the opt-in provider. Read the [observed runtime evidence](STATUS.md#combined-staging-rehearsal-2026-11-20) before using the historical notes below.

## Historical implementation baseline — observed facts

| Boundary | Observed at runtime baseline `d81b062` |
| --- | --- |
| Core | [Routes](../../../apps/api/src/maintenance/routes.ts), [case service](../../../apps/api/src/maintenance/case-service.ts), [store](../../../apps/api/src/maintenance/case-store.ts) and [policy](../../../apps/api/src/maintenance/policy.ts) serve the manual commands and case history. Later routes exist for messages, compare, publication confirmation, links and analysis. Stored publication text, exact publication proof and safe result reads need integration work. |
| Database | The integrated branch reserves 0036–0038 for staging. Maintenance 0039 in the original feature checkout and forward migrations through 0045 supply the local schema inventory. Upgrade, actor-grant and runtime ledger evidence is pending. [Release policy](../../../apps/api/migrations/release-policy.json) |
| Shared UI | The [Knowledge page](../../../packages/ui/src/knowledge/ServerKnowledgeFeaturePage.tsx) connects the manual path. The shared Maintenance UI (`packages/ui/src/maintenance/`, added by the stacked UI PR) includes components for later features that still need live case data and actions. The [desktop allowlist](../../../apps/desktop/src/main/apiRequestPolicy.ts) needs to match the individual route contracts. |
| Arden-AI | The paired branch at `ed2776e` defines a Maintenance request/response fixture. Core still uses a controlled fake in the local slices. The worker, served contract and cited evidence path are planned. [AI main baseline](https://github.com/Arden-Enterprise/Arden-AI/tree/e56a89bb429b8580d0e4c8c6171ff191bbce004d/src/arden_ai/contracts) |

## Proposed design

Core owns case authorization, exact source resolution, commands, transactions, history, the inbox and safe projections. Use the existing Maintenance service and store seams. Keep the UI driven by authorized data and commands. Reuse Flow 2 publication facts and submission/request routes. For analysis, Core schedules and fences work, passes a finite manifest and selected source text to Arden-AI, then validates and projects the returned evidence. [Sequenced architecture](../../product/flows/flow-4-sequences.md)

## Interfaces and data contracts

- **Core browser and desktop API.** The current base is `/api/v1/organizations/:organizationId/knowledge/maintenance`. Keep current manual callers compatible. Read proposed messages, decisions, comparison, publication-link, history and analysis shapes in the [owning contract](../../product/flows/flow-4-maintenance.md#proposed-implementation-contracts). Existing `POST /cases/:caseId/decisions` resolves the no-change case. Define additive semantics and compatibility before broadening that command. Validate schemas, use no-store for sensitive responses, return a common unavailable response for unknown and inaccessible resources, and use stale or conflict responses only when safe to disclose.
- **Persistence.** Keep the case key, organization, immutable document/version reference and anchor, reporter, responsible scope, historical author, assignee, first claim and revision. Add typed same-organization links, messages and bounded run records as needed. Case actions update state, event and applicable notification effects in one transaction. Use revision checks and durable command, import and event-recipient keys. Ensure tenant and lineage coherence for references.
- **History.** Preserve existing event records and per-case ordering. The spec proposes a typed association with `audit_event`. The branch uses `maintenance_case_event`. Choose the least disruptive append-only design compatible with current audit consumers. Review with the owner before changing audit ownership, retention or permissions.
- **Version comparison.** Resolve the primary snapshot through case scope and each extra version through its own access checks. Normalize layout-only differences, preserve meaningful content, bound work, keep exact pair and source anchors, and recheck before return. Do not expose hidden intermediates through IDs, counts or cache behavior.
- **Analysis contract — PROPOSED.** Use a versioned, strict request and response with finite source, text and time bounds. Keep the case, selected ordered versions, anchor context, run identity and fence explicit. Return source-bound findings, gaps and optional suggested next step. Core checks spans and provenance, rejects invalid results, and rechecks assignment and access before dispatch, commit and read. One active run per case, with durable leasing, cancel and explicit retry. Provider/configuration failures leave the manual path available. The service gets the selected evidence and no Core business database credential or decision authority. [Service boundary decision](../../decisions/0012-separate-python-ai-service-and-chromadb.md)

## Cross-cutting design

- **Permissions and concurrency.** Reuse the canonical audience-specific reviewer checks and actor-scoped database transactions. The current store's draft/submission joins and reviewer lookups need proof under a non-author runtime actor. Apply the same projection before serializing history or notifications. The branch's minimal reporter UI and API history currently differ. Handle concurrent intake replay, claim, reassignment, cancellation and closure at the write boundary.
- **Cutover.** Treat the staging ledger as immutable. Use a resumable, tenant-scoped one-to-one mapping, preserving the old report and audit. Record import provenance without producing a fresh submission event or alert. Resolve closure-versus-import races under one authoritative triage path. Coordinate old and new writers at the switch. Keep exact pins even when the document has a replacement.
- **Two withdrawal paths.** Direct Admin withdrawal can close all open legacy reports for a document, including older pins. An approved author request can leave legacy report rows open. Preserve both Flow 2 behaviors and keep the Maintenance case's terminal decision separate. Verify the actual Flow 2 outcome and affected version, not the legacy report's closure text. [Direct withdrawal](https://github.com/Arden-Enterprise/Arden/blob/af28915/docs/decisions/0024-admin-only-direct-withdrawal.md) · [Author request application](https://github.com/Arden-Enterprise/Arden/blob/af28915/apps/api/migrations/0035_apply_publication_change_requests.sql#L58-L67)

## Decisions and alternatives

- Keep one report action and transfer eligible open work once. Two live record lifecycles would leave the same report independently actionable. Closed history retains its original disposition. [Accepted intake ADR](../../decisions/0028-maintenance-report-intake.md)
- Keep human case decisions separate from publication and AI. Publication state supplies proof, AI supplies evidence, and the assigned independent reviewer decides. [Approved journey](../../product/flows/flow-4-maintenance.md#f4-05-and-f4-06--decide-hand-off-and-close)

## Risks requiring a repository check or decision

| Item | Affected work and resolution |
| --- | --- |
| **Migration ledger — UNVERIFIED at runtime** | T-11/T-12. Verify the 0039–0045 chain on clean and staging-prefix disposable ledgers. Verify the actual environment and its ledger before any shared rollout. An unexpected feature-only 0036 entry needs the reviewed operator procedure. |
| **Legacy client compatibility — Q24 approved** | Runtime plan Task 2. Preserve one open report per member/document, the existing duplicate response while open, and fresh allowed reports after closure, even with the same wording. Verify requests spanning cutover under one authoritative writer. |
| **Historical visibility and mapped records — Q25 approved** | Runtime plan Task 2. Use a read-only Closed filter in the existing Reported problems workspace under current governance permissions. Reconcile mapped source rows with later direct withdrawal while preserving dispositions, Flow 2 authority and independent Maintenance resolution. |
| **Case audit storage — engineering check** | T-11/T-13. Reuse the current case event table and verify its ordering and audience filtering against runtime consumers. Use the repository's decision-change process if audit ownership, retention or permissions need to change. |
| **Paired analysis schema and limits — PROPOSED** | T-17. Recheck the paired refs and choose a compatible versioned schema, finite bounds and binding to authorized sources. Provider, retention or trust-boundary changes and any live provider run require their applicable approval. |
