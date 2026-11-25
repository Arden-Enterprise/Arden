# 0033: Reviewers with a matching grant may decide their own submissions

Status: accepted
Date: 2026-11-24
Decision owner/approval: project maintainer, explicitly approved in the project conversation on 2026-11-24 after the segregation-of-duties trade-off (ISO 9001 approver definition versus ISO/IEC 27001 Annex A control 5.3) was explained. Team consultation: not recorded.
Brainstorm originator / record author: project maintainer; record written by Claude (coding agent).
Approval evidence and exact source revision: maintainer approval in that conversation, against branch `feat/expired-document-visibility` at `90e436a` (base `origin/staging` `adcfac5`).
Implementation: branch `feat/expired-document-visibility` only (amended migration `0068_expired_document_renewal.sql`, API, UI, tests); not merged, released or deployed.
Supersedes / superseded by: supersedes the rule that an ordinary reviewer "cannot self-review" / "never decides their own submission" in [0011](0011-permission-aware-publication-and-semantic-documents.md), [0015](0015-organization-wide-reviewer-grants.md), [Mainflow 2 workflow §1 and §3](../engineering/mainflow-2-workflow.md) and F05-AC2 in [identity and access](../product/identity-and-access.md). Grant scopes (0013–0015), legacy frozen rules and Organization Admin authority are unchanged. Amends the renewal decision order in [0032](0032-expired-documents-renewal-and-home-columns.md).

## Context and requirement

Small organizations often have one reviewer per department, who also writes that department's documents. Under 0011/0015 their own submissions could only be decided by an Organization Admin, which turned Admins into a bottleneck for routine documents.

## Options and tradeoffs

- **Keep the four-eyes rule for reviewers.** Satisfies ISO/IEC 27001 control 5.3 (segregation of duties) most directly, but blocks small teams. Rejected.
- **Allow reviewer self-decision with a matching current grant (accepted).** ISO 9001 lets the organization define who approves documented information, so this is acceptable there. Under ISO/IEC 27001 control 5.3 an auditor may record a finding; the organization accepts that risk. Audit keeps the evidence.
- **Allow it only with a visible "self-approved" label.** Considered; rejected by the maintainer to keep the review UI uniform.

## Decision

1. A reviewer whose **current** grant matches a submission may see and decide their own submission exactly like any other: a Department grant for the responsible department for department- and group-only snapshots, an Organization grant for organization-wide snapshots, and the unchanged frozen rules for legacy submissions. This applies to every request type: `CONTENT`, `READER_CHANGE`, `WITHDRAWAL` and `RENEWAL`.
2. A reviewer without a matching grant (wrong scope, other department, expired or inactive grant) is still refused, for their own submissions too.
3. There is no UI label or marker for a self-decision.
4. Audit still records `selfApproved: true` for any self-decision, by a reviewer or an Organization Admin. It is never shown in the UI.
5. Organization Admin authority is unchanged: an Admin may decide everything, including their own submissions.
6. Accepted consequence: a document authored by a reviewer can be published without a second person. This is acceptable under ISO 9001 and may be an ISO/IEC 27001 control 5.3 audit finding.

### Renewal decision order (amends 0032 B)

- A renewal the **author** asked for is decided by a matching reviewer or an Organization Admin as usual, including self-approval when the author holds a matching grant.
- A renewal asked **on behalf of an active author** (by a reviewer or Admin): the author may approve or reject it without any reviewer grant. For 3 days after the request, or until the document expires if that comes first, **only** the author may decide. After that window, matching reviewers and Organization Admins (including the requester) may decide. An author rejection closes the request (`REJECTED`) and cannot be overridden.
- A renewal asked on behalf of an author who is **not active**: matching reviewers and Organization Admins decide immediately; the requester may approve their own request.

## Boundaries and consequences

- Database: migration 0068 (amended in place; never published or applied to a shared database) removes the submitter exclusion from `validate_review_decision`, the review-decision insert policy, `review_submission_authors` and `submission_proposed_reader_directory`; the grant check stays. `shared_submission.author_decides_until` fixes the author's window when an on-behalf request is created; the validator refuses other deciders during it (SQLSTATE `AR032`, API `409 AUTHOR_DECISION_WINDOW`). The author's own decision runs only through the reviewed routine `decide_on_behalf_renewal`, which needs no reviewer grant; an author may read renewal requests made on their behalf.
- Reviewer queues list the reviewer's own submissions when the grant matches.
- Maintenance case review (Flow 4, `maintenance_reviewer_eligible`) and the responsible reviewer's read-only view keep excluding the author; they are not review decisions on submissions and are out of scope here.

## Verification and rollout

Unit tests cover reviewer self-approval with Department and Organization grants, wrong-scope refusal and unchanged Admin authority. Real-PostgreSQL cases cover self-approval of a content submission with an Organization grant and refusal with only a Department grant, author approval and final rejection of an on-behalf renewal, reviewer refusal during the window (API and direct SQL) and success after it or at once for an expired document or inactive author, requester self-approval after the window, and `selfApproved` audit. Ownership-handoff rehearsal, signed-in acceptance and staging rollout remain separate milestones.

## References

Decisions [0011](0011-permission-aware-publication-and-semantic-documents.md), [0013](0013-audience-breadth-review-levels.md), [0015](0015-organization-wide-reviewer-grants.md), [0032](0032-expired-documents-renewal-and-home-columns.md); ISO 9001:2015 clause 7.5.2 (review and approval of documented information); ISO/IEC 27001:2022 Annex A control 5.3 (segregation of duties).
