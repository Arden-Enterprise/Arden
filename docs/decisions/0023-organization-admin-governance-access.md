# 0023: Organization Admin governance catalog, audited inspection, direct withdrawal and problem reports

Status: accepted
Date: 2026-11-16
Decision owner/approval: project maintainer. In an agent session on 2026-11-16 the maintainer was shown option C below, the comparison and its consequences, refined it, and answered "theo đề xuất" ("as proposed") to the explicit choice to approve this replacement, keep decision 0010 unchanged, or consult the team first.
Brainstorm originator / record author: the project maintainer raised and refined the questions; record drafted by the coding agent. The original owner of decision 0010 is recorded there only as "task owner"; that person was not consulted, and the maintainer chose to proceed.
Approval evidence and exact source/spec revision: maintainer approval in the session above, against `origin/staging` 7a133af with decisions 0010, 0011 and 0013–0015 and the Flow 2 workflow (T6.3) as the baseline.
Implementation: published in PR #52, not merged or deployed. Migration `0037_publication_governance.sql`, API routes and screens have disposable-CI evidence below, not staging-copy rehearsal. Integration still requires explicit withdrawal/notification policy reconciliation and target-specific operator migration approval.
Supersedes / superseded by: refines [0010](0010-audiences-and-system-administration.md) ("Org Admin … does not implicitly read content") and [0011](0011-permission-aware-publication-and-semantic-documents.md) (Organization Admin unpublish).

## Context and requirement

Flow 2 T6.3 asks for an Organization Admin emergency path: unpublish a document, cancel a pending
submission, retry a failed preparation. Decision 0011 allows Organization Admin to unpublish, but
decision 0010 gives Organization Admin no implicit content read, so an Admin cannot find, verify or
withdraw a publication whose Target Readers exclude them.

Practice in controlled-document management (for example ISO 9001 §7.5) and in enterprise suites
separates three things:

- **Governance metadata.** Administrators see that a controlled document exists, who owns it and its
  state, without reading it.
- **Exceptional access.** Content is opened only for a stated business reason, scoped to one item,
  recorded and visible to the responsible people. Logging deters misuse but does not prevent it (NIST
  SP 800-53 AC-6(9) logs the use of privileged functions; it is not a preventive control).
- **Takedown authority.** It belongs to the people responsible for the content.

## Options and tradeoffs

| Option | Benefit | Cost |
| --- | --- | --- |
| A. Keep 0010 as is (Admin acts only on documents they can read) | No new visibility; no migration | Admin cannot withdraw a harmful document outside their readership |
| B. Admin reads every current publication | Simple; fits small companies where the owner is Admin | "Selected members" stops meaning only those members; Ask Arden could answer from any document; one compromised Admin account exposes everything |
| **C. Governance catalog + audited, scoped inspection + responsible-reviewer view and withdrawal (accepted)** | Governance and emergency withdrawal without making Admin a default reader; Library and Ask Arden unchanged | New SECURITY DEFINER paths, inspection sessions and audit; an Admin can still read a document they give a reason for, and logging only deters |

Prior approval before an inspection was rejected for now. It delays the emergency case, fails with one
Admin or no responsible reviewer, and Arden has no compliance role.

## Decision

### 1. Governance catalog (Administration → Documents)

- An Organization Admin sees every current publication in their organization:
  - title and responsible department;
  - version and publication date;
  - sharing kind: Everyone / the department / "Selected members";
  - the number of open problem reports.
- It shows **no** reader count, **no** reader names and no content. Drafts, pending submissions and private notes are never listed.
- Title and sharing kind are administration metadata, not information for every member.

### 2. Administrative inspection

- An Admin who is **not** already a reader opens one current publication by giving a reason (1–1000
  characters). An Admin who is already a reader reads it in the Library; no inspection is needed.
- The server keeps the inspection, bound to the Admin's membership, the organization, the document and the
  published version.
- An inspection ends after **15 minutes without use** or **2 hours** in total, or when another version
  becomes current.
- Every request rechecks the signed-in session, active membership and the current Organization Admin
  role. Using the inspection id does not replace those checks.
- Moving between PDF pages or panels needs no new reason and shows no repeated access check.
- **Audit before access.** The server validates authority and records the audit event successfully before
  it returns content or grants inspection access. If either step fails, access is refused.
- The system records that access was granted; it cannot prove what the Admin actually read.
- Within an inspection the Admin sees the reader names, so an exposure incident can be assessed.
- The Admin is not added to Target Readers. The document does not enter their Library, search, Ask Arden
  or citations.
- Audit events cannot be changed or deleted through the application. Database owners still can; this is
  not a guarantee against them.
- Opening a submission in Reviews as its eligible reviewer is ordinary review, not an inspection.

### 3. Responsible reviewer view

- The responsible reviewer has the **current** reviewer grant for the publication's scope:
  - an Organization grant for an organization-wide publication;
  - otherwise a Department grant for its responsible department (0015).

  This is not necessarily the person who approved it.
- They may open the current publication read-only from Reviews (for example from a problem report).
- This needs no reason: reviewing content in their scope is already their role. It does not make them a
  reader, and the document does not enter their Library or Ask Arden.
- Authors use their own requests (T6.1) instead.

### 4. Direct withdrawal

| Actor | Permission |
| --- | --- |
| Member or author without governance authority | Report a problem; the author can also request withdrawal (T6.1) |
| Responsible reviewer | Withdraw directly, reason required |
| Reviewer outside the scope | Nothing because of the reviewer label |
| Organization Admin | Withdraw any current publication in the organization, reason required |
| AI | Never withdraws |

- **Flow:** Withdraw publication → reason → confirm. The effect is the same as an approved `WITHDRAWAL`
  request (0035): the document leaves the Library, search and Ask Arden.
- **Recorded:** who withdrew, when, which version and the reason. Open reports for the document are
  closed.
- **Kept:** versions and history. Copies people already downloaded cannot be recalled.
- **Author view:** My Contributions shows "Withdrawn by a reviewer/an administrator" and the reason.
- **Republishing** needs a new content submission and review. There is no silent Undo.
- **Refused** while a newer approved version is still being prepared.

### 5. Problem reports

- A member who can read the current publication can report a problem (1–1000 characters). Each member can
  have one open report per document.
- The responsible reviewers see the open reports, with the reporter's name, in Reviews. Organization
  Admins see all of them, in Administration → Documents.
- Other readers do not see reports.
- A report is dismissed or closed by the withdrawal.

### 6. Who sees a document's readers

| Who | Sharing kind | Count | Names |
| --- | --- | --- | --- |
| Author | yes | yes | yes |
| Reviewer, while reviewing that submission | yes | yes | yes |
| Responsible reviewer view | yes | no | no |
| Reader | no | no | no |
| Org Admin, catalog | yes | no | no |
| Org Admin, inspection | yes | yes | yes |

### Notifications

No notification channel exists, and none is added now. Inspections, withdrawals and reports are recorded
in audit and in the report list, and the responsible people check them there.

### Out of scope

- **Organization Admin cancel of another member's pending submission.** Reviewers reject and authors
  withdraw.
- **Ownership transfer when an author leaves.**
- **Investigations where the responsible department is itself the subject.** There is no silent
  inspection mode.
- **Approval-before-access workflows.**
- **An audit viewer screen.** Events are recorded; a screen to read them is future work.

## Boundaries and consequences

- **Data (migration 0037):**
  - `governance_inspection` and `publication_report` tables.
  - Withdrawal provenance columns on `shared_submission`.
  - Seven reviewed SECURITY DEFINER routines, 32 in total.
  - Authority is re-derived from current role and grant tables inside each routine; the app's
    `arden.org_admin` setting is not trusted.
  - The runtime reads neither table directly. Members insert reports through an RLS policy that requires
    them to read the current publication.
- **API and UI:**
  - Administration → Documents for the catalog and inspection.
  - Reported problems above Reviews.
  - "Report a problem" in the document reader.
  - The withdrawal reason in My Contributions.
  - The desktop main process allowlists each route in its exact shape.
- **AI:** Arden-AI AccessPolicy is unchanged. Inspection and responsible views are not answering sources.
- **Risk:** the Organization Admin role still lives in legacy role tables (review finding 2026-11-15); this
  decision reads them as the source of truth.

## Verification and rollout

- **Evidence obtained (2026-11-16, local).**
  - The 0001–0037 chain applied cleanly on a disposable PostgreSQL 17 (CI image), with 32 postgres-owned
    SECURITY DEFINER routines.
  - The full API suite passed: 445 tests, Supabase auth skipped, 30-second timeout.
  - Real-database tests cover:
    - the catalog only for Organization Admins;
    - inspection reason, audit, other-user denial, idle and absolute expiry, and no direct table access;
    - responsible scope: a wrong department, a Department grant against an organization-wide
      publication, and an Organization grant;
    - withdrawal by reviewer and Admin with provenance for the author, and audit;
    - reports: reader-only, one open report, hidden from members, dismissal, and closure on withdrawal.
  - Route, UI and desktop allowlist tests passed.
  - A synthetic browser preview showed the catalog, reason dialog and inspection view at desktop and
    375 px widths.
- **CI follow-up (2026-11-17, `bdfad94`).** Run [44090300677](https://github.com/Arden-Enterprise/Arden/actions/runs/44090300677) passes schema recovery, full-chain apply/no-op repeat and the API suite after the real ownership handoff (445 tests, one provider-gated skip). The invoker-mode governance view preserves checked privileged execution without broadening runtime privileges. Grant fixtures now clean up after failed assertions. OS checks in that run still fail a separate immutable-history comparison; this is not a full-CI or release sign-off.
- **Not done:**
  - a run against the full local API with real sign-in;
  - Electron;
  - staging-copy rehearsal, operator apply and deployment.

## Rules and documentation updates

- Updated in this change:
  - the status lines of 0010 and 0011;
  - `docs/engineering/mainflow-2-workflow.md`;
  - `docs/engineering/security-and-data.md`.
- `DESIGN.md` records the governance screens. Signed-in and native interaction acceptance remains open.

## References

- Decisions 0010, 0011, 0013–0015; `apps/api/migrations/0035_apply_publication_change_requests.sql` and `0037_publication_governance.sql`.
- NIST SP 800-53 Rev. 5, AC-6(9).
- OWASP Session Management Cheat Sheet (idle and absolute timeouts).
- ISO 9001:2015 §7.5.
