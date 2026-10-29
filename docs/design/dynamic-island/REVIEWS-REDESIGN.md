# Reviews — decision always in view, document first

Canvas: "Arden Dynamic Island" v22, board `Reviews.dc.html` (copy in this folder).
Code: `packages/ui/src/knowledge/ServerKnowledgeFeaturePage.tsx` (review screen, ~lines 320–369)
and `packages/ui/src/styles/island-knowledge.css` (`.review-*`, ~lines 48–73).

Layout and visual change only. Keep `decide("APPROVE" | "REJECT")`, the reason-required rule,
`approvalBlocked`, `KnowledgeDialog` semantics, the API calls and the status-island messages.

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
Below 1180px: queue collapses to a select/drawer above the document; under 860px stack document
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
