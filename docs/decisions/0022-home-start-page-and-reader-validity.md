# 0022: Home start page and reader validity

Status: accepted
Date: 2026-11-15
Decision owner/approval: project team leader (Ngô Quang Khôi), in the project conversation on 2026-11-15, after reviewing the Home and reader mockups
Record author: Claude, from the team leader's explicit choices in that conversation
Implementation: branch `feat/home-reader-information` only; not merged, released or deployed
Supersedes / superseded by: supersedes the "My Work is the entry screen" rules in [product contract item 7](../engineering/rules/product-contract.md) and [design rules](../engineering/rules/design.md), and the reader field list and effective-date wording in `DESIGN.md`. Everything else stays in force.

## Context

My Work showed only labelled sample data (`sampleWorkQueue`), and signed-in sessions already disabled it.
Signed-in members landed on Private Notes or a waiting page instead of the knowledge they can read. The
document reader showed a locked version selector that read "Current" while the document said 1.0, two
status words (Published/Current), an effective date shown as "—", no readers, and the browser PDF
toolbar with its own download, print and drawing tools.

## Decision

1. **Home.** The Library is renamed **Home** and is the first screen after sign-in for every member.
   Navigation: WORK (Home, Ask Arden, Private Notes), REVIEW (Reviews, planned Integrations), MANAGE
   ORGANIZATION (Administration). The phone tab bar shows Home, Ask, Notes and Reviews. My Work and its
   sample dashboard are removed. A member waiting for a department sees Home with the note "Waiting for an
   admin to assign your department. You can read documents shared with the whole organization."
2. **Tabs.** Home keeps Discover, All documents and My Contributions, and shows a disabled **My reports**
   tab ("Coming later") reserved for Flow 4 issue reports.
3. **No effective date.** A publication is in force from approval. Authors no longer enter an effective
   date; saving a draft clears an older one. The optional expiration date is labelled **Valid until**.
   The API still accepts `effectiveDate` so older snapshots keep their recorded value; such a future date
   still shows as Upcoming rather than being misreported.
4. **One status vocabulary.** Current; **Expires in N days** when the expiration is 30 days away or less;
   Expired. Home lists VALID UNTIL ("No expiry" when unset) instead of EFFECTIVE DATE.
5. **Reader information.** Type when set (Topic removed by [0027](0027-remove-knowledge-topics.md)); Version as plain text ("Not recorded" when an older
   publication has none), with a selector only when more than one version can be chosen; Status;
   Classification when sensitive; Valid until when set; **Readers** in plain words (Whole organization,
   the department, Selected members; never member identities); Owner department; Published date. The
   reviewer's name is not shown; who approved what belongs to the audit view owned by Flow 4.
6. **Reader actions.** One **Download** action. The browser PDF toolbar is hidden in the reader
   (`#toolbar=0`); scrolling and zoom remain. **Report an issue** appears disabled until Flow 4 provides it.

## Consequences

- Reports 3/4 and the BM documents that describe My Work, the Library name or the effective date need the
  same update; this record does not change them.
- Dead `my-work` CSS remains in `packages/ui/src/styles` and can be removed separately.
- Version history for published documents is unchanged: the live reader still shows only the current
  version until an authorized history contract exists.
