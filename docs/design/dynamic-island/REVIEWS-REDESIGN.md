# Reviews — decision always in view, document first

Canvas: "Arden Dynamic Island" v22, board `Reviews.dc.html` (copy in this folder).
Code: `packages/ui/src/knowledge/ServerKnowledgeFeaturePage.tsx` (review screen, ~lines 320–369)
and `packages/ui/src/styles/island-knowledge.css` (`.review-*`, ~lines 48–73).

Layout and visual change only. Keep `decide("APPROVE" | "REJECT")`, the reason-required rule,
`approvalBlocked`, `KnowledgeDialog` semantics, the API calls and the status-island messages.

## Landing list (REV-02 "Reviews · Linear list", Figma node 334:1213)
The Reviews destination opens on one island listing submissions in collapsible groups: **Needs review**
(the pending queue), **Approved** and **Rejected** (the signed-in reviewer's own decisions, read-only).
Group header 36px: chevron · status icon (amber half circle / sage check circle / muted cross circle) ·
label · count. Row 44px: mono code 92px · status icon · title with `vN` chip (and the blocked dot) ·
department chip · author avatar + name 128px · short date 56px right. Toolbar: Refresh, Filter (text
filter over title, code, department, author) and Display options (show/hide the decided groups).
Opening a Needs review row shows the review detail (next section); the breadcrumb "Reviews" returns to
the list.

## Review detail (REV-03 note/draft, Figma 340:1419; REV-04 PDF, Figma 340:1642)
One island: a 52px breadcrumb bar ("Reviews" > mono code + title; position "n / m"; next/previous
round 28px buttons) above a two-column body: the document (left, scrolls by itself) and a 340px side
panel. Notes/drafts render the title (26px) and the Semantic Document in a 680px reading column (padding
36px 56px). PDFs show a 44px toolbar (PDF icon, file name, size, Download, Open in a new tab) above the
browser PDF viewer on a dark canvas; page count and zoom are the browser viewer's own controls (a custom
page/zoom bar would need pdf.js). Side panel: Properties (version "Version n · replaces vn-1", author
avatar + name, submitted date), SUBMITTED DETAILS, note to the author ("Optional to approve", turning
danger "Required to reject"), pinned footer with Reject / Approve and the in-place confirmation. Below
820px of island width the side panel stacks under the document with a sticky footer. The three-pane
layout below is superseded by this detail; its decision rules still apply. Below 760px of list width the department and author columns hide; below 520px
the code hides. Author names come from `review_submission_authors` (migration 0026), which only
returns names to an Org Admin, a current reviewer of a pending submission or the reviewer who decided it.

## Problem
The decision bar sits under the document, so reviewers scroll to the end to act, and the
frozen-details grid plus the title compete with the document body.

## Layout: three panes, fixed height, each scrolls by itself
```
.review-workspace  grid: 240px | minmax(0,1fr) | 312px ; gap 12px
                   height: calc(100dvh - <header height> - 24px); min-height: 0
```
Each pane: `display:flex; flex-direction:column; min-height:0; overflow:hidden; border-radius:14px`.
Only the inner list, document body and decision middle scroll — never the page.
Below a 1020px page width (container `knowledge-page`; a 1440px window gives 1148px) the queue moves above the document; under 860px stack document
then decision, with the decision footer `position: sticky; bottom: 0`.

### 1. Queue (left, `--arden-bg-sidebar`)
- Header "Review queue" 15px + count badge; one muted line "Covered by your grants. Never your own."
- Item: mono code (12px muted, same derivation as LIBRARY-HIERARCHY.md) / title 13px 600, one line,
  ellipsis, `title` attr / meta 12px muted "Author · date".
- Classification: hide INTERNAL; CONF. (info) / RESTR. (danger) mini chip 18px.
- Approval blocked: 6px `--arden-warning` dot at the right (with `title`), not a full chip.
- Selected: `--arden-accent-subtle` bg + 2px accent bar on the left; `aria-current="true"`.

### 2. Document (centre, the focus)
- Header (not scrolling), border-bottom:
  - row: doc/PDF icon 14px · mono code · chip "v3 · replaces v2" (or "v1 · new document") ·
    classification chip only if not INTERNAL;
  - title: Inter Tight 24px/600, line-height 1.25;
  - meta 13px secondary: avatar 20 · author · department · "Submitted Oct 21" · "3 min read"
    (words/220, optional).
- Body: `overflow:auto; padding:24px 32px 40px`; text column `max-width:640px`, 15px/1.75.
  PDF submissions keep `PdfDocument` here, filling the pane width.
- Reset body scroll to top when the selected submission changes.

### 3. Decision island (right)
Flex column, full pane height:
1. Header row: "Decision" 14px + "2 of 4" + prev/next icon buttons 28px (disabled at the ends).
2. "FROZEN AT SUBMISSION": `<dl>` two columns (96px label, value with ellipsis): Classification,
   Department, Access scope, Audience, Team / project, Snapshot (mono). Replaces `dl.review-frozen` grid.
3. Blocked note (if `approvalBlocked`): compact warning box, "You can still reject."
4. Textarea "Note to {first name}", right label "Optional to approve" → turns danger
   "Required to reject" + `aria-invalid` when Reject is pressed with an empty note. Clear the note on
   submission change.
5. **Footer pinned** (`margin-top:auto`, `--arden-surface-raised`, border-top):
   - Reject: 36px, transparent, danger text + `--arden-danger-border`.
   - Approve: 36px primary, flex 1.6, disabled when `approvalBlocked`.
   - One muted hint line: "Approve prepares this exact snapshot for indexing. It becomes active for
     {audience} afterwards." / blocked: "Approval needs an enforceable audience."
   - Confirmation happens **in the footer** (replace buttons with title + body + Cancel / confirm),
     instead of a modal, so the reviewer's eye stays put:
     - Reject → "Reject v3?" / "{name} gets your note. Their working draft stays editable." / solid
       danger "Reject with note".
     - Approve → "Approve v3 for preparation?" / "Snapshot … is indexed first; it is not active until
       indexing finishes." / primary "Approve for preparation".
     If keeping `KnowledgeDialog` is simpler, keep it — the pinned footer is the must-have.
6. After a decision: status-island toast (existing messages), remove the item, auto-select the next
   one (or previous if it was last). Empty state in the document pane: "Nothing left to review".

## Tokens
All existing `--arden-*`. Mono font stack: `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`.

## Done when
- At 1440×900 Approve and Reject are visible without any scrolling, for any document length.
- Document title is the most prominent text on the page; frozen facts read as secondary.
- Keyboard: Tab order queue → document body (focusable, `tabindex=0`) → note → Reject → Approve.
- `pnpm --filter @arden/ui typecheck` and `pnpm --filter @arden/ui test` pass.
