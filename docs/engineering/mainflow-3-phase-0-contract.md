# Mainflow 3 Phase 0 contract

Status: closed on 2026-10-21. This document is the implementation boundary for Phase 1; it is not evidence that every later pipeline stage already exists.

## Actors and authority

- The author owns only their working draft and their submission history. They cannot read another author's draft.
- An ordinary reviewer may inspect and decide only pending snapshots covered by a current `ReviewerGrant`, and cannot review their own snapshot.
- Organization Admin is the organization's final authority: they may inspect every submission and decide any pending snapshot, including their own. A self-approval audit event must contain `selfApproved: true`.
- System Admin observes platform health, traces and cost through Langfuse. That operational role grants no organization-content access.

## State machines

The working draft has immutable versions but remains mutable while review is open. Submit freezes one exact version and creates at most one open release candidate per draft.

```text
working draft --submit--> PENDING_REVIEW --reject--> REJECTED
                                      \--approve--> APPROVED/PREPARING
PENDING_REVIEW --author or Org Admin cancel--> WITHDRAWN (API meaning: cancelled)
APPROVED/PREPARING --pipeline succeeds--> APPROVED/ACTIVE
APPROVED/PREPARING --pipeline fails--> APPROVED/FAILED --retry--> APPROVED/PREPARING
```

Only atomic activation may replace `knowledge_current_publication`. Search and RAG read that same active pointer under the same current AccessPolicy. `PREPARING`, `FAILED`, rejected and withdrawn snapshots are unavailable to both. Mainflow 3 has no human Publisher role and no request-revision decision.

## Error taxonomy

| Condition | Stable API meaning |
| --- | --- |
| Missing/foreign resource or unauthorized actor | `RESOURCE_NOT_AVAILABLE` / 404, without revealing existence |
| Missing `If-Match` | `PRECONDITION_REQUIRED` / 428 |
| Stale working version or closed candidate | `VERSION_CONFLICT` / 409 or `PRECONDITION_FAILED` / 412 |
| A pending candidate already exists | `OPEN_RELEASE_CANDIDATE_EXISTS` / 409 |
| Snapshot ID/hash differs from the frozen candidate | `STALE_SNAPSHOT` / 409 |
| Reject has no reason | `COMMENT_REQUIRED` / 400 |
| Audience/policy is no longer enforceable | `AUDIENCE_NOT_ENFORCEABLE` / 409 |
| Unsupported or invalid Semantic Document | `INVALID_DOCUMENT` / 400 |
| Publication pipeline failure | candidate becomes `FAILED`; active pointer remains unchanged |

Existing endpoints may still map some stable meanings through the common safe-error envelope until the later API cleanup task; they must not weaken authorization or expose resource existence.

## Acceptance matrix

| Scenario | Required result |
| --- | --- |
| Author edits while review is pending | New working version; submitted snapshot/hash unchanged |
| Concurrent second submit | Exactly one pending candidate; loser receives conflict |
| Ordinary reviewer self-review | Denied and not present in queue |
| Organization Admin self-approval | Allowed; `selfApproved: true` audit evidence |
| Reject | Candidate closes; no publication/index activation |
| Approve | Candidate is `PREPARING`; no current pointer change |
| Index/embedding partially fails | Candidate is not searchable; previous active version remains active |
| Complete generation activates | Current pointer and generation become visible atomically |
| AccessPolicy changes | Search and RAG immediately converge on the same current authorization result |
| Author changes department later | Draft ownership/history remains; current access is determined only by policy, not authorship memory |

## Phase boundary

Phase 1 steps 0–2 close this contract, audit Flow 2 against it, remove disposable legacy content and establish Semantic Document v1. Snapshot/compiler, index generations, policy enforcement, retrieval and answer generation are subsequent Phase 1 tasks.
