# Knowledge Library — make document names stand out

File: `packages/ui/src/knowledge/ServerKnowledgeFeaturePage.tsx` (published table, ~lines 499–517)
plus styles in `packages/ui/src/styles/island-knowledge.css`. Visual change only — keep
`openPublished`, search, `readerDocumentStatusAt` and all data as they are.

## Problem
Every column uses primary text at nearly the same size, titles wrap to two lines because the
document code is baked into the title ("NSS-STD-067 — Emergency rollback…"), the meta line repeats
"Code not assigned · Text · INTERNAL" on every row, and six green "Effective" chips pull the eye
away from the names.

## Changes
1. **Type hierarchy**
   - Title: 15px / 600 / `--arden-text-primary`, one line, ellipsis, full title in `title` attribute.
   - Owner + Version cells: 13px / 400 / `--arden-text-secondary`.
   - Effective date: 13px / `--arden-text-muted`, `font-variant-numeric: tabular-nums`,
     format with `toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })`.
2. **Code above the title**
   - Show the code on its own line *above* the title: 12px monospace, `--arden-text-muted`.
   - Source: `item.documentCode`; if null, derive it for display only from a leading title prefix
     matching `/^([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+)\s*[—–-]\s+/` and strip that prefix from the shown title.
     If neither exists, render no code line (never "Code not assigned").
3. **Quieter meta line** (under the title, 12px muted, only if non-empty)
   - Show "PDF" only for PDFs (hide "Text").
   - Hide INTERNAL. For CONFIDENTIAL / RESTRICTED render a small chip instead
     (CONFIDENTIAL = info tone, RESTRICTED = danger tone with lock icon), matching existing chip tokens.
4. **Status**
   - "Effective": no chip — 6px `--arden-success` dot + 13px secondary text.
   - Keep chips only for "Upcoming" (info) and "Expired" (neutral/danger as today).
5. **Version**: show `item.versionLabel` (e.g. "v4"); if missing show "—" in muted, not "Current".
6. **Columns**: `columns="minmax(320px, 3fr) minmax(130px, 1fr) 72px 128px 112px"`; row min-height 60px,
   cells vertically centred.
7. **Type icon**: 16px muted document/PDF icon (existing `Icon`) left of the code/title block, 12px gap.
8. **Hover**: row background `--arden-surface-hover`, title underline (offset 3px). No violet.

## Done when
- At 1440px every title fits one line or truncates; no row taller than ~64px.
- Eye lands on titles first (owner/version/date visibly secondary).
- `pnpm --filter @arden/ui typecheck` and `pnpm --filter @arden/ui test` pass.
