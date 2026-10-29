# Dynamic Island redesign — canvas → code handoff

Source of truth: the Design canvas "Arden Dynamic Island" (version 21, 2026-10-24).
The `.dc.html` files in this folder are exact copies of its artboards. Open one in a
browser only for reading markup/CSS; they need the canvas runtime to render interactively.

The app (`packages/ui`) already has the island shell (`styles/island-*.css`,
`AdminDetailIslands.tsx`, `IslandTable.tsx`, `StatusIslandContext.tsx`). This handoff is
about bringing it level with the **latest** canvas. Verify each item against the code
before changing it — some may already be done.

## Ground rules
- Keep every API call, permission check and data flow as it is. This is visual + layout work,
  except where a row below says otherwise.
- Use the semantic tokens (`--arden-*`) already defined; add new ones only if missing (list below).
- Text contrast must stay WCAG AA (values below are already checked).
- Run `pnpm --filter @arden/ui typecheck` and `pnpm --filter @arden/ui test` after each section.

## 1. Tokens, type, sizes (Anatomy.dc.html)
| Token | Value | Note |
|---|---|---|
| bg.app / bg.sidebar / surface / surface.raised | #101014 / #15151A / #1C1C23 / #25252E | |
| border / border.strong | #303039 / #6A6976 | strong = inputs (3.1:1) |
| text.primary / secondary / muted / disabled | #F2F1F7 / #A5A4B1 / #8C8B98 / #777683 | muted tuned for AA; disabled only for disabled |
| accent / accent.hover / accent.subtle | #8B82F6 / #A69EFF / violet 14% | text on accent = #101014 |
| success / warning / danger / info | #7FCFA3 / #E3B26B / #F2938A / #7EB0F0 | each with 12% `*-subtle`, 30% `*-border` |
- Fonts: Inter Tight 600 headings (letter-spacing -0.02em), Inter 400/500/600 body,
  `font-feature-settings: "cv11","ss03"`. Bundle locally like the old Sora/DM Sans files.
- Control heights (desktop): sm 28 (island actions, inner tabs), md 32 (buttons, inputs,
  filters, icon buttons, nav items), lg 36 (one primary action per page). Touch: 44 on phone.
- Radii: 6 chip/badge · 8 control · 12–14 island/list/card · 16 nav/panel.

## 2. Shell (Main.dc.html)
- Nav: one "Administration" item under MANAGE ORGANIZATION; the five admin sections are
  tabs inside the page, not nav items. Group labels padding 0 10px (same on every page).
- Page header row: `align-items: center` (primary button centred on the title block).
- Admin pages: description one line, so the tab bar never jumps between tabs.

## 3. Administration
Tabs: Members · Departments · **Audiences** · Invitations · Reviewer access.
"Roles" is gone (decision 0010: custom roles → audiences).
- **Members** (Main.dc.html): column ROLE → **ACCESS** = chip "Member" | "Org Admin", plus a
  "Reviewer" chip (shield icon, title = grant scope) when the member has an active reviewer grant.
  Detail island rows: Access (Make Org Admin / Make Member) · Department (Move) ·
  Reviewer grant (scope or "None", "Manage" → Reviewer access). Remove → confirm in the
  status island. Detail island sits beside the table (top aligned with table), width 300–340.
  Email in detail truncates with ellipsis. Table min-width ~700.
- **Departments** (Departments.dc.html): table + side island (rename = icon button,
  managed "Everyone in …" audience box, people avatars, "View all", deactivate disabled while
  members remain).
- **Audiences** (Audiences.dc.html): sections Organization / Departments (managed) /
  Groups (Org Admin). Count badge min-width 28, kind chip min-width 76. Side: group members,
  add/remove with undo toast.
- **Invitations** (Invitations.dc.html): status filter row above the split; columns
  EMAIL (meta: "Member · Invited by X") · DEPARTMENT · SENT · STATUS · actions
  (Retry | Resend + ✕ revoke icon; empty 28px slot keeps buttons aligned). Invite form island.
- **Reviewer access** (ReviewerAccess.dc.html): columns REVIEWER (meta "Level · tags") ·
  DEPARTMENT · CLASSIFICATIONS · STATUS (chip + validity) · Revoke. New-grant island:
  RESTRICTED disabled for Standard level.
- All admin side islands: `flex: 1 1 300px; max-width: 340px`.

## 4. Work + Knowledge
- My Work (MyWork.dc.html), Private Notes (PrivateNotes.dc.html: Contribute copy opens in
  the status island), My Contributions (Contributions.dc.html), Reviews (Reviews.dc.html:
  decision bar pinned to the bottom of the submission island and aligned to the text column),
  Draft from PDF (DraftFromPdf.dc.html: every section bordered, checked = success border,
  "Low confidence" chip).
- Library search panel (Library.dc.html): result rows min-height 52 with 2px gap.

## 5. Already fixed in code (2026-10-24) — do not redo
- My Contributions black screen: drafts list returned `audienceRoleIds`; `listKnowledgeDrafts`
  now normalizes to `audienceIds`. (Optional follow-up: make the API list route use
  `representSharedDraft` so list and detail share one shape.)
- Handover removed from navigation (route/component still exist; remove later if unused).
- Collapsed sidebar footer no longer stretches/overflows.
