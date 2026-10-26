# FEATURE_ID: Feature name

- Spec revision/date: REVISION / YYYY-MM-DD
- Decision state: proposed | accepted | superseded
- Originator: ACTUAL_ORIGINATOR_OR_UNKNOWN
- Decision owner: ACCOUNTABLE_OWNER_OR_UNKNOWN
- Record author: AUTHOR
- Approval: ACTUAL_APPROVER_DATE_AND_EVIDENCE_OR_NOT_APPROVED
- Intended audience: PUBLIC_SAFE_OR_APPROVED_PRIVATE_RECORD
- Source/code baseline and affected repositories: EXACT_REVISIONS
- Related Linear issue: EXISTING_ISSUE_OR_NOT_PRIORITIZED
- Supersedes / superseded by: REFERENCES_OR_NONE

## Goal, scope and decisions

State the user outcome, in/out of scope and the decisions actually accepted. Label proposals and unresolved alternatives. Link owning ADR/API/design contracts instead of copying them. Private rationale/attribution stays in approved Knowledge; public records use safe pointers.

## Actors, dependencies and paths

Identify actors/capabilities, data ownership, prerequisites and cross-repository interfaces. Describe entry, steps, result and recovery for each path. Cover UI, API, storage, authorization and supported platforms where relevant. State why a path is not applicable rather than silently omitting it.

## Acceptance and evidence

| ID | Observable requirement, including relevant failure/denial cases | Implementation reference | Evidence actually obtained | Remaining/owner |
| --- | --- | --- | --- | --- |
| FEATURE_ID-AC1 | REQUIRED_RESULT | NOT_IMPLEMENTED_OR_REFERENCE | NOT_RUN_OR_EXACT_RESULT | OWNER_AND_GAP_OR_NONE |

Include applicable loading/empty/error, denied/revoked, stale/conflict, retry/cancellation, keyboard/responsive/native, migration/recovery and integration cases. Do not manufacture tests for irrelevant states or mark unavailable evidence passed.

## Delivery and change history

Record planned/partial/implemented/verified states separately, with exact PR/base/merge and authorized deployment evidence when obtained. Keep rejected alternatives, approved scope changes, unresolved conflicts and supersession links. Recheck concurrent changes before finalization. See the [specification rule](../../engineering/rules/specifications.md).
