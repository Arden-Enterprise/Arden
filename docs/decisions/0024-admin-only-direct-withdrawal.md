# 0024: Admin-only direct withdrawal and inspection-notification release scope

Status: accepted
Date: 2026-11-17
Decision owner/approval: project maintainer, explicitly choosing Admin-only direct withdrawal and accepting inspection without notifications for this release after the alternatives and consequences were presented.
Brainstorm originator: project maintainers; record author: coding agent.
Source revision: PR #52 at `3e0c6f4989030741bbb99588bf6e182912d0ec58`, targeting staging `0eae5b82457e9d7b812a5388a68512c9f7d545d4`.
Implementation: forward 0038, API/UI and regression tests in PR #52; local typecheck/tests/build pass, exact-head CI pending. Merge, target-specific operator migration and deployment are separate gates.
Supersedes: [0023](0023-organization-admin-governance-access.md) only for direct-withdrawal authority; confirms the absence of inspection notifications as an explicit release deferral, not their permanent removal.
Feature/acceptance references: F05/F10, Flow 2 T6.3, GWD-01–04 below.

## Decision and consequences

- Only a currently active Organization Admin may directly withdraw a current publication in that organization. A reason, confirmation and audit remain mandatory.
- A responsible reviewer without Organization Admin authority cannot withdraw directly, even with a matching Department or Organization reviewer grant. Their scoped read-only view and report list/dismissal remain available.
- An author without Organization Admin authority keeps the existing withdrawal-request/review path. Approval of that request is not the new direct-withdrawal endpoint and is unchanged by this decision.
- A reviewer who is also Organization Admin acts as Admin; withdrawal provenance must say `ORGANIZATION_ADMIN`.
- Withdrawal still removes the current pointer, closes open reports, preserves version/history and refuses withdrawal while a newer approved version is preparing. Re-publication still needs new submission/review.
- Inspection retains reason, current-role checks, server-managed lifetime and pre-disclosure audit. This release does not send an inspection notification. Responsible people are not automatically alerted; audit persistence must not be described as notification delivery. Notification delivery remains deferred work, with no new channel, deadline or silent-investigation mode promised here.

This narrows the direct takedown capability and centralizes emergency action with Admins. It does not broaden readership, Library or AI access, expose private originals, or remove existing report/review capabilities. The accountable maintainer resolves the earlier scope conflict; no separate teammate consultation is claimed.

## Implementation and rollout contract

Preserve published migration history. Forward operator migration
`0038_admin_only_direct_withdrawal.sql` replaces the guarded direct-withdrawal
routine without changing its signature, trusted owner or runtime EXECUTE ACL.
The runtime remains subject to the existing actor/organization rules; no BYPASSRLS
grant or RLS relaxation is introduced. Keep historical `REVIEWER` provenance
readable rather than rewriting old records.

Apply/rehearse the complete chain only in disposable verification until separately
authorized for a named staging target. Adding the migration to a PR is not live
migration approval. The UI capability controls are advisory; the database routine
enforces the decision for direct API/SQL callers.

## Acceptance

| ID | Required evidence |
| --- | --- |
| GWD-01 | Matching Department and Organization reviewers are refused direct withdrawal; pointer, reports and audit remain unchanged. Responsible view still works. |
| GWD-02 | Same-organization Admin succeeds with reason/audit and Admin provenance, including an Admin who also holds the matching reviewer grant. Missing reason, repeat, foreign organization and non-Admin remain refused. |
| GWD-03 | Reviewer reports offer View/Dismiss but not Withdraw; Admin Documents/reports retain reasoned Withdraw. |
| GWD-04 | Fresh/full-chain and post-ownership database verification cover 0038; old migration bytes stay unchanged. No inspection notification is claimed or sent by this release. |

Signed-in full-stack/native acceptance and target-specific backup/rehearsal/apply
remain release evidence, not consequences inferred from unit tests or CI alone.
