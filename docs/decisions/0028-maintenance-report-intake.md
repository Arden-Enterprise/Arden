# 0028 · Maintenance report intake

Status — Accepted for the Flow 4 integration design on 2026-11-18.

Decision owner — Requesting Flow 4 owner. The owner approved Q20 and Q23 on 2026-11-18 after reviewing the existing report workflow and the proposed transition for open and closed records.

Origin — Staging `af28915` contains the reader's **Report a problem** action and the publication governance report lifecycle. The local Flow 4 branch at `c35737d` has version-pinned Maintenance intake. The cutover joins these paths.

## Decision

Keep **Report a problem** as the reader's single entry point. At the Maintenance cutover, new submissions from the updated reader create a Maintenance case pinned to the reported version. Same-request replay and independently submitted reports follow the Maintenance intake rules. This changes where future reader submissions are handled under ADR 0023.

At cutover, carry each eligible open governance report into one unassigned **Submitted** case. Preserve the original report reference, exact published version, reporter, text, timestamp, source record and audit history. Record import provenance and make the transition safe to retry. Imported work appears in the authorized Maintenance queue and reporter view without generating a fresh submission notification. Resolve any unverifiable version or routing facts through authorized review before import.

Keep closed reports in governance history with their original disposition. After import, Maintenance owns the case decision. Keep the original governance record available under its existing permissions and remove it from independent report triage. Flow 2 remains the authority for publication and direct withdrawal. An applied withdrawal may be relevant evidence for an imported case. Maintenance still requires human confirmation for resolution.

## 2026-11-19 compatibility and history decisions

The Flow 4 owner approved Q24 and Q25. Supported older clients keep the existing one-open-report rule per member and document. A duplicate while open returns the existing duplicate response. After closure, the same wording can be submitted as a new report when current permissions and version rules allow it. The updated client's keyed requests retain their own replay semantics.

Authorized governance users can retrieve retained closed reports through a read-only **Closed** filter in the existing **Reported problems** workspace. Preserve the original disposition and audit trail and apply the existing visibility rules. [Runtime plan](../superpowers/plans/2026-11-19-flow-4-runtime-integration.md)

## Why

A single reader action gives reporters a clear path. Carrying forward open work keeps it visible to reviewers, and preserving the source records and closed dispositions keeps historical decisions traceable. The transition needs a durable link between the old report and the new case, plus coordination between supported clients and the server during cutover.

Implementation status — Reconciled locally on staging `4df192d`. The existing staging ADR 0025 and migrations 0001–0042 retain their identities. Local verification covered the legacy compatibility race, post-closure reuse, a seeded staging upgrade and the signed-in case. The app uses the approved Maintenance-specific updates for case events and the existing global inbox for its original events. [Verification](../features/knowledge-maintenance/STATUS.md#combined-staging-rehearsal-2026-11-20)

[Prior governance intake](https://github.com/Arden-Enterprise/Arden/blob/af28915/docs/decisions/0023-organization-admin-governance-access.md) · [Direct withdrawal decision](https://github.com/Arden-Enterprise/Arden/blob/af28915/docs/decisions/0024-admin-only-direct-withdrawal.md) · [Flow 4 contract](../product/flows/flow-4-maintenance.md)
