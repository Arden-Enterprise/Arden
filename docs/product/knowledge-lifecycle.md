# Knowledge lifecycle coverage

Read the [feature index](README.md), especially G1/G3. Sources: current main [Flow 2](../engineering/mainflow-2-workflow.md), [automatic-publication decision](../decisions/0007-automatic-publication-after-final-approval.md), [classification decision](../decisions/0008-three-level-knowledge-classification.md), [audience decision](../decisions/0010-audiences-and-system-administration.md) and the index's pinned branch Flow 3/ADR 0011/0013 references.

Provenance: the public records identify project lead/task-owner decisions; exact original individuals are not established here. Product/engineering decision owners must reconcile conflicting contracts; delivery ownership remains in ARD-27 and its existing child work. Acceptance rows below expose coverage to establish, not observed passing behavior or new approval of a branch contract.

29 October 2026 reconciliation: inspected main `be27d2c` includes ADR 0011/0012. The requesting maintainer explicitly confirmed ADR 0013–0015 for this integration after comparison with main. References below to branch-only contracts and G1/G3 are historical: the selected contract is Semantic Document v1, mutable author drafts, immutable snapshots, Approve/Reject, preparation then index-ready atomic activation, primary-department responsibility and disjoint reader-derived reviewer scopes. This decision does not establish full-path acceptance or authorize resetting populated data.

## F07 Creation and contribution

Paths: start a new shared draft, or save a private note and explicitly contribute a separate copy → responsible department/audience metadata → saved working content. Private originals remain owner-only in both main and branch plans.

| Acceptance ID | Complete path to verify | Evidence / remaining |
| --- | --- | --- |
| F07-AC1 | Active authorized authors create/reopen their own drafts and provide valid organization, responsibility and audience metadata; guessed IDs cannot expose another author's draft. | Main API/UI slices exist; actual-role evidence remains required. |
| F07-AC2 | Only the private-note owner can create a contribution copy of the selected saved version; original body, ownership and visibility remain unchanged. | Verify both objects and their storage/authorization independently. |
| F07-AC3 | Idempotent creation/retry, invalid metadata, revoked membership and failed content storage have explicit results without duplicate/orphaned records. | Include API, storage and database failure boundaries in affected implementation. |

## F08 Content versions and import

Paths: author/edit → persist a version → select exact snapshot → derive processing text/source references; accepted file import follows its separately specified input limits and failure behavior. ARD-29/ARD-32/ARD-54 cover related work.

| Acceptance ID | Complete path to verify | Evidence / remaining |
| --- | --- | --- |
| F08-AC1 | The selected canonical format validates at runtime, preserves stable version/source identities and rejects unsupported or unsafe content. | Main and branch formats differ; Semantic Document v1/ADR 0011 are branch-only in the inspected core baseline. |
| F08-AC2 | Editing never mutates immutable submitted/published content; optimistic conflicts and failed saves preserve the last valid version. | Draft mutability while reviewing is a G1 decision, not an implementation convenience. |
| F08-AC3 | Accepted import types, size/error handling, source provenance and deterministic source mapping are specified and checked; extraction/PDF support does not imply OCR or arbitrary-file support. | Broad ingestion scope is not certified; define the accepted slice before implementation. |

## F09 Submission and review

Paths: complete metadata → freeze selected content/metadata/hash → assigned/scoped reviewer opens immutable submission → accepted decision → author sees outcome/history. Rejection, cancellation, revised submission and duplicate decisions need the selected contract. ARD-34/ARD-35/ARD-37/ARD-38/ARD-43 cover related work.

| Acceptance ID | Complete path to verify | Evidence / remaining |
| --- | --- | --- |
| F09-AC1 | Submission binds exact content/version/hash, audience, responsibility and policy; stale or duplicate submission and parallel decision requests cannot alter the frozen snapshot. | Main slices exist; G1 governs mutable-draft/open-candidate behavior for later integration. |
| F09-AC2 | Reviewer queue/detail/decisions recheck current authority, self-review policy and enforceable audience, without exposing another author's original. | G1/G3 affect self-approval and required review level; approval provenance must be resolved first. |
| F09-AC3 | Every accepted outcome has correct author feedback, audit and next-step behavior. Reasons, cancellation authority, re-submission and required review stages follow the selected specification. | Main has Approve/Request Revision/Reject; branch has Approve/Reject and candidate cancellation. Neither can be silently dropped or combined. |

## F10 Publication and activation

Paths: final approved immutable snapshot → consistent publication preparation/activation → current published read → later approved replacement; withdrawal/republish where accepted. ARD-39/ARD-41/ARD-55 own related pipeline work.

| Acceptance ID | Complete path to verify | Evidence / remaining |
| --- | --- | --- |
| F10-AC1 | Current effective publication references exactly the approved content/policy and has separate review/publication audit evidence; no partial or unapproved version becomes visible. | G1: main publishes in the approval transaction; branch prepares/indexes before atomic activation. Resolve before dependent changes. |
| F10-AC2 | Storage/index/provider failure, duplicate event, worker restart and competing generations preserve consistent state and idempotent retries. The old active version remains usable where the selected contract requires it. | Index/worker integration is not established by main's publication endpoint. |
| F10-AC3 | Published reading, search, RAG and history apply the same current-access/version policy; unpublish/revoke/re-publish and historical citation behavior match the accepted contract. | Branch removal of temporal validity and republish authority require explicit integration reconciliation. |

## Completion boundary

Closing one backend or UI slice does not close F07-F10 as a complete workflow. The chosen flow must run from authoring through reader-visible authorized publication, with failure/denial/concurrency evidence and required migration rehearsal. Keep accepted decision, source implementation, merged main and target deployment states separate. Use the [resume template](templates/resume-checkpoint.md) for remaining criteria.
