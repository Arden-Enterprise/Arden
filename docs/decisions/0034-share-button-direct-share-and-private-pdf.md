# 0034: One Share button, unreviewed direct sharing with individuals and private PDF items

Status: accepted
Date: 2026-11-26
Decision owner/approval: requesting project maintainer. On 2026-11-26, after reviewing the proposed record, its option tables and the comparison with product contract item 4, the maintainer answered "Duyệt như đề xuất" ("approve as proposed").
Brainstorm originator / record author: the maintainer raised one-member sharing (Report 1 scope and Report 3 FR-PKM-05 already describe "shared with one member without review"), asked whether a PDF can be shared, asked how person-by-person sharing should be limited, and proposed a single Share button that also offers contribution. At the maintainer's request ("đừng bias theo tôi") the coding agent re-examined whether one-person sharing needs review and recommended the rules below. Record drafted by the coding agent. Team consultation: not recorded.
Approval evidence and exact source revision: the maintainer answer above, given against this record as proposed. Baseline `origin/staging` c62b2f6; approved `origin/main` 9fa3d34.
Implementation: not started.
Supersedes / superseded by: refines [product contract](../engineering/rules/product-contract.md) item 4, [0002](0002-first-slice-private-notes-contract.md) and [0029](0029-private-notes-organization-and-trash.md) owner-only access (for items the owner shares), and the F03-PDF rule that a PDF file is never stored. [0031](0031-private-note-live-version-and-autosave.md) one-live-version saving, 0029 trash/tombstones and every review/publication contract (0011, 0013–0015, 0033) stay unchanged.

## Context and requirement

Today a private note can reach another person only by **Contribute**: a separate shared copy, chosen Target Readers (Selected members, Department or Organization) and reviewer approval before publication. Selecting one member still needs review. There is no way to let one colleague read a note, and Private cannot hold a PDF file: F03-PDF extracts its text in the browser and discards the file.

The maintainer wants a quick way to show a note or a PDF to a colleague, and one discoverable place to start sharing.

## Options and tradeoffs

### Does showing an item to one person need review?

| Option | Benefit | Cost or risk |
| --- | --- | --- |
| Keep review for every reader, including one member | One rule | Review protects official knowledge (department responsibility, Ask Arden answers, reader trust); none of that applies to one colleague reading. Friction pushes users to email or chat, which loses audit and revocation. Reviewers spend time on trivial requests. |
| Skip review when Selected members has exactly one person | Small change to the existing flow | The result is still an official publication with department responsibility and Ask Arden indexing, but unreviewed. Sharing one person at a time bypasses review. "One" is arbitrary. |
| **Separate, non-official direct share to named individuals (recommended)** | Fast; the official/unofficial line stays clear; audited and revocable | New sharing object, permission path and UI; residual risk that an owner shows sensitive content to the wrong colleague (comparable to email, but audited and revocable). |

### How to limit person-by-person sharing

| Option | Assessment |
| --- | --- |
| No limit | Simple, but an unreviewed item can reach a whole department one person at a time: a shadow knowledge base. |
| Hard limit of one person | Arbitrary and too strict; two or three colleagues is ordinary. |
| Automatically require review above N people | Mixes the two concepts and creates a "half-official" state. |
| **Individuals only, an organization-configurable per-item cap, a nudge to Contribute near the cap, and audit (recommended)** | Groups and departments stay on the reviewed path; the cap is a product default the organization can change. |

### How to share a PDF

| Option | Assessment |
| --- | --- |
| Share only the extracted text (existing PDF import) | Loses layout, tables, forms and signatures, which are often the content. |
| Upload a file inside the Share dialog without storing it in Private | A file-transfer side channel with no collection, trash or archive; outside Arden's purpose. |
| Attach a PDF inside a note | Ambiguous: what is shared, and which text does AI read? |
| **A PDF item in Private, beside notes (recommended)** | Reuses collections, favorites, archive, trash, the PDF viewer and contribution; one sharing mechanism for notes and PDFs. |

### Where sharing starts

| Option | Assessment |
| --- | --- |
| Keep Contribute and add a separate Share action | Users look for "Share" first; two entry points for one intention. |
| One recipient picker that routes automatically (people → direct share, department → Contribute) | Hides that a department share makes a reviewed **copy** whose later edits do not follow the note. |
| **One Share button with two clearly labelled choices (recommended)** | One entry point; the user sees the different consequences before choosing. |

## Decision

1. **Share button.** Private notes and private PDF items get a **Share** button (note header and `···`). It opens a panel with two choices:
   - **Share with people** — "Not reviewed · view only · not an official document".
   - **Contribute to a department or the organization** — "Creates a copy for review · becomes an official document after approval". It opens the existing contribution form unchanged.
   The existing Contribute command may remain as a shortcut.
2. **Direct share.** The owner grants view access to **individual active members of the same organization**. Several people can be added in one action; each receives a separate grant. Departments, groups and Everyone are not available here; reaching a group remains publication with review.
   - No review. The item is labelled "Shared by ‹owner› — not reviewed" wherever the recipient sees it. It is not an official document, has no responsible department and is never indexed for organization Ask Arden.
   - The recipient sees the owner's **current saved** content, read-only, and cannot edit, re-share, contribute or move it.
   - The owner sees who has access and can revoke one person or everyone at once, with immediate effect.
   - Access also ends when the owner moves the item to Trash (restoring does not re-share), when the owner or recipient leaves the organization or becomes inactive, and when the item is purged.
   - Collections are not shared.
   - **Cap:** each item has at most N active recipients. N is an organization setting with a default of 10; an Organization Admin can change it or disable direct sharing for the organization. Near the cap the dialog suggests Contribute instead.
   - **Audit:** share and revoke events record actor, recipient, item id and time, without title or content.
3. **Private PDF items.** In Private, **Upload PDF** creates a PDF item next to notes.
   - The original file is kept in protected private storage and served only through Core after an authorization check, using short-lived signed access; never a public URL.
   - Maximum 5 MB, the same limit as shared PDF drafts, so the item can always be contributed.
   - The file cannot be edited. **Replace file** stores a new file as the item's live version under the 0031 rules; a version sealed by contribution is kept.
   - The PDF's text is extracted for title, search and the private AI side panel. A PDF without a text layer is accepted, but AI is unavailable for it (no OCR).
   - PDF items take part in collections, favorites, ordering, archive and the 30-day trash; purging erases the stored file.
   - **Contribute** on a PDF item creates a shared PDF draft through the existing PDF contribution path.
   - **Import PDF into a note** (F03-PDF) remains for users who want editable text.
4. **Delivery order.** Phase 1: Share button offering Contribute only. Phase 2: private PDF items. Phase 3: direct sharing for notes and PDF items together.

Out of scope for this decision: editing by recipients, comments, sharing collections, public links, people outside the organization, recipients' AI over shared items, and copying a shared item into the recipient's Private.

## Decision-change comparison

- Affected contracts: product contract item 4; ADR 0002/0029 owner-only access; F03 (out of scope "sharing collections"; owner-only acceptance F03-AC1, F03-ORG-AC1); F03-PDF ("the PDF file itself is never uploaded or stored"); Reports 1 and 3 (FR-PKM-05 "one member").
- Current decision and rationale: personal knowledge is private; the only way out is an explicit separate copy through review, so nothing unreviewed reaches another person through Arden.
- Earlier originator / accountable owner: product contract item 4 and ADR 0002 come from the project lead/task owner; individual attribution is not established in public records. The current accountable owner is the requesting project maintainer.

| Aspect | Current accepted behavior | Proposed behavior | Benefit, cost or risk |
| --- | --- | --- | --- |
| User outcome and paths | A note reaches others only after Contribute and review; Private holds text only | Share button; immediate view-only access for named individuals; PDF items in Private | Faster collaboration; users need to understand "not reviewed" vs official |
| Data, permissions, external effects | Private items readable only by the owner (RLS) | A grant table lets named recipients read the current saved content; the owner can revoke at any time; Org/System Admins still cannot read private items | Larger read surface on private data; needs RLS, revocation and membership-change tests |
| APIs, clients, dependencies | No share routes; PDF text extracted client-side and discarded | Share, revoke and "shared with me" routes; PDF upload, replace and download through Core; new desktop allow-list entries; no Arden-AI change | More API, storage and UI work; no new external service |
| Existing work, compatibility, migration | — | New tables and storage paths through additive migrations; existing notes unaffected | Purge and storage cleanup must include PDF objects and grants |
| Acceptance and verification | F03 owner-only cases | F03-SHR and F03-FILE acceptance cases | Real PostgreSQL, RLS, revocation and platform evidence required |

### Decision request

Recommendation: approve items 1–4 as written, or with adjusted defaults. The cap default of 10 and the "enabled by default" setting are product choices, not facts. Consulting the team is recommended because the change relaxes a project-level privacy rule. Options: keep the current contract, consult the team first, or approve this replacement (with any changed details).

### Resolution

- State: replacement approved.
- Decision maker, authority, date and evidence: requesting project maintainer, as accountable product owner, on 2026-11-26 ("Duyệt như đề xuất").
- Consultation: not recorded; the team was not consulted in this session although consultation was recommended.
- Approved scope and conditions: items 1–4 of the Decision exactly as written, including the defaults (cap 10, direct sharing enabled) and the choices marked *agent choice* in F03-SHR and F03-FILE.
- Records updated with this approval: product contract item 4; ADR 0002/0029 cross-references; F03 in [identity and access](../product/identity-and-access.md); [feature index](../product/README.md); Reports 1 and 3 (FR-PKM-05, BR-ACC-001, BR-ACC-008: "one member" becomes "named individuals").

## Boundaries and consequences

- Core owns grants, the cap, revocation and authorization. RLS must allow a recipient to read only the current saved version of a granted, non-trashed item while both members are active.
- Storage: new private PDF objects in the existing protected storage, under the same ownership and purge rules as note content.
- Notifications: a recipient receives an in-app notice when an item is shared with them (a new event type under 0025, without content or excerpt); revocation sends none.
- Arden-AI: unchanged. Direct shares are not indexed. A private PDF item's text is passed to the private side panel the same way as note text.
- The Admin setting and audit add organization configuration and audit event types.

## Verification and rollout

Planned evidence (none obtained):

- API and real-PostgreSQL RLS tests for owner, recipient, other member, Org Admin and System Admin.
- Revocation, trash, membership deactivation and cap enforcement.
- PDF upload limits, replacement, purge and contribution.
- UI tests and browser acceptance on web; desktop allow-list tests; Electron acceptance.

Each phase ships as its own reviewed PR.

## Rules and documentation updates

Specification: [F03-SHR and F03-FILE](../product/identity-and-access.md#f03-shr-share-button-and-direct-sharing). Product contract item 4, ADR 0002/0029 cross-references and F03-PDF are updated in the same change; Reports 1 and 3 are updated outside this repository.

## References

[Product contract](../engineering/rules/product-contract.md), [0002](0002-first-slice-private-notes-contract.md), [0025](0025-in-app-notifications.md), [0029](0029-private-notes-organization-and-trash.md), [0031](0031-private-note-live-version-and-autosave.md), F03-PDF in [identity and access](../product/identity-and-access.md#f03-pdf-import-a-pdf-into-a-private-note), F07 in [knowledge lifecycle](../product/knowledge-lifecycle.md#f07-creation-and-contribution).
