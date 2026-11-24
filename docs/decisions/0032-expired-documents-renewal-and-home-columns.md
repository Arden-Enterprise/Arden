# 0032: Expired documents, reviewed renewal and the Home document columns

Status: accepted
Date: 2026-11-24
Decision owner/approval: project maintainer (repository user), approved in the project conversation on 2026-11-24 after the alternatives (automatic withdrawal at expiry, Admin direct renewal, keeping expired documents listed with an Expired status, and the existing Home column set) were discussed. Team consultation: not recorded.
Brainstorm originator / record author: project maintainer; record written by Claude (coding agent) from the agreed rules.
Approval evidence and exact source revision: maintainer approval in that conversation, against `origin/staging` `adcfac5`.
Implementation: partial, branch `feat/expired-document-visibility` only (migration `0066_expired_document_renewal.sql`, API and UI); not merged, released or deployed. Evidence is listed under Verification.
Amended by: [0033](0033-reviewer-self-approval.md) (renewal decision order, B2/B4; edited in place because 0032 is unmerged).
Supersedes / superseded by: supersedes [0022](0022-home-start-page-and-reader-validity.md) item 4 (one status vocabulary shown on Home) and the Home column list in 0022; extends [0024](0024-admin-only-direct-withdrawal.md) (withdrawal of expired documents) and [0025](0025-in-app-notifications.md) (two new in-app notice types). Expiry stays inclusive through its UTC day as in [0030](0030-published-date-ai-sources.md). Everything else in those records stays in force.

## Context and requirement

Under 0022 an expired publication stayed on Home with an Expired chip, and readers could still open and download it; only Company AI excluded it (0030). There was no way to extend a Valid until without a new content version, nobody was reminded before expiry, and Home showed VERSION and STATUS columns that readers rarely need while omitting the author.

## Options and tradeoffs

- **Automatic withdrawal at expiry.** Simple for readers, but it closes reports, loses the current pointer and needs a new content review to come back. Rejected.
- **Keep listing expired documents with an Expired status (0022).** Readers keep finding stale guidance. Rejected.
- **Hide expired documents from readers, keep them current for responsible people, and renew through review (accepted).** Needs a new request type, a validity record and reminders, but changes no content, readers, owner or history.
- **Admin direct renewal.** Faster, but extends validity without a second person. Rejected (B5).

## Decision

### A. Expired visibility (expiry = effective Valid until, inclusive through its UTC day)

1. An expired publication is **not** withdrawn automatically. Current pointer, versions, history and open reports stay; no withdrawal audit is written.
2. Ordinary readers no longer see it: it leaves Home (Discover, All documents), search, collection listings and the Home counts. Company and Reader AI already exclude it (0030) and now use the renewed date.
3. Opening an old link or bookmark as an ordinary reader shows "This document expired on <date>. Contact <owner department>." instead of the content or download (API `410 DOCUMENT_EXPIRED`).
4. The author, reviewers holding a matching grant for the responsible department (0013/0015 scope) and Organization Admins still see it, in Administration → Documents and the author's My Contributions, with an Expired status and the actions **Renew** and **Withdraw**. Withdraw keeps 0024: Admin direct withdrawal with a reason; the author uses the withdrawal-request path.
5. A renewal makes the document visible again only after it is approved.

### B. Renewal authority

1. Renewal is a publication change request of type `RENEWAL` beside `READER_CHANGE` and `WITHDRAWAL`. It carries a new Valid until (or no expiry) and a short reason, and changes **only** validity: not content, readers or owner. The frozen snapshot metadata is never rewritten; the approved date is recorded for that published version.
2. It is reviewed like the other requests (same routing, 0013/0015). Decision order (amended 2026-11-24, see [0033](0033-reviewer-self-approval.md)):
   - Asked by the author: a matching reviewer or an Organization Admin decides, including self-approval when the author holds a matching grant.
   - Asked on behalf of an **active** author: the author may approve or reject it without a reviewer grant. For 3 days after the request, or until the document expires if earlier, only the author may decide; afterwards matching reviewers and Organization Admins (including the requester) may. An author rejection is final.
   - Asked on behalf of an author who is **not active**: matching reviewers and Organization Admins decide at once; the requester may approve their own request.
3. Who may submit: the author at any time. From 7 days before expiry (and after expiry), when no renewal is pending, reviewers with a matching grant for the responsible department and Organization Admins may also submit on the author's behalf. If the author's membership is no longer active, that right applies immediately.
4. When someone other than the author renews, the active author gets an in-app notice saying who and why that opens My Contributions, where they approve or reject it. Audit records the requester and whether it was on behalf of the author.
5. Admins do **not** get a direct (unreviewed) renewal.

### C. Notifications (in-app, 0025)

At 30 days before expiry the author is reminded; at 7 days, if no renewal is pending, matching reviewers of the responsible department are reminded too; if the author is inactive those reviewers are reminded from 30 days. One notice per recipient, published version, Valid until and threshold, so nothing is duplicated and a renewed date can be reminded again. 0025 has no scheduler, so Core runs an idempotent database routine hourly; reminders are also safe to compute again after downtime because each key is unique. Reminders are not written for documents that already expired.

### D. Departed authors

Published content stays published, the author's private originals stay private, and attribution and history are unchanged. Ownership transfer to another member is **out of scope** (future work). Deleting a department that still owns current publications is refused with the number of documents that need handling (`409 DEPARTMENT_OWNS_PUBLICATIONS`).

### E. Home document table (reader view)

- Columns: DOCUMENT · TYPE · OWNER (department) · AUTHOR · UPDATED. VERSION and STATUS leave the reader tables (Discover, All documents).
- AUTHOR is the author's display name while their membership is active, otherwise "—". Reviewer identities are never shown. Member identity check: 0022 forbids member identities only in the **Readers** description and hides the **reviewer**; 0025 already shows a sharer's display name to recipients; no accepted record keeps the author's name from readers. The name is returned only for publications the caller may read now, never with an email.
- UPDATED is the published date of the latest current version (not the first publication), in the shared date format ("Nov 12, 2026").
- Column headers sort; the default is UPDATED, newest first.
- Expiring soon (30 days or less): a small amber clock icon next to the title with the accessible label "Expires in N days · <date>". Other rows show nothing.
- My Contributions keeps a Status column (Current, Expires in N days, Expired, Withdrawn and the pending states) with Renew on expiring and expired rows.
- Administration → Documents keeps the full status and adds the filters "Expiring soon" and "Expired".
- The reader keeps Version and Valid until in its information panel; Valid until turns amber with "Expires in N days" at 30 days or less.
- Narrow and phone layouts may drop AUTHOR first.

## Boundaries and consequences

- Data: `shared_submission` gains `renewal_expiration_date`, `on_behalf_of_author` and `author_decides_until` (the author's priority window, fixed when an on-behalf request is created); `publication_validity_renewal` records an approved date per published version (a newer content version uses its own Valid until). `arden_notification` gains `PUBLICATION_EXPIRING` and `PUBLICATION_RENEWAL_ON_BEHALF` with `expires_on` and `request_reason`.
- Authority is re-derived in reviewed `SECURITY DEFINER` routines from the actor context and existing routine owners are kept. Under 0033 the review-decision insert policy no longer excludes the submitter (a matching grant or Admin is still required), and an active author may read renewal requests made on their behalf; no other RLS policy changes. Reader hiding is applied in the reader projection; publication RLS itself is unchanged, so responsible views, governance, maintenance and notifications keep working.
- An expired document is no longer "readable" for the Admin governance catalog, so an Admin opens it through the audited inspection (0023) rather than the reader.
- Operators apply 0066 as the trusted superuser (operator-class) after backup and rehearsal; old Core cannot use the new request type but is not broken by the added columns.

## Verification and rollout

Planned and obtained evidence is recorded in the branch PR; at the time of writing: API unit tests (fake repository) and real-PostgreSQL integration cases for reader hiding, AI exclusion, author/reviewer/Admin state, on-behalf routing, the 7-day and inactive-author windows, the author's decision window and final rejection, reviewer self-approval (0033), reminder idempotency and the department guard; UI tests for the Home columns, sort and expiring icon. Ownership-handoff rehearsal, signed-in web/desktop acceptance and staging rollout remain separate milestones.

## Rules and documentation updates

- [Operations](../engineering/operations.md) (migration 0066 rollout note)
- [Mainflow 2 workflow](../engineering/mainflow-2-workflow.md) migration table
- [DESIGN.md](../../DESIGN.md) Home table and reader validity
- [Owner repair inventory](../../deploy/release/security-definer-owner-repair.sql)

## References

Decisions [0013](0013-audience-breadth-review-levels.md), [0014](0014-author-owns-shared-drafts.md), [0015](0015-organization-wide-reviewer-grants.md), [0022](0022-home-start-page-and-reader-validity.md), [0023](0023-organization-admin-governance-access.md), [0024](0024-admin-only-direct-withdrawal.md), [0025](0025-in-app-notifications.md), [0030](0030-published-date-ai-sources.md).
