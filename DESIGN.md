---
name: Arden
description: Living Archive, a dark workspace with measured color for private organizational knowledge and work context.
colors:
  charcoal: "#1b1f21"
  warm: "#f2ece2"
  mist: "#c8cfd5"
  stone: "#929698"
  canvas: "#1b1f21"
  sidebar: "#171b1d"
  surface: "#212629"
  elevated: "#292f33"
  line: "#30373c"
  strong-line: "#68737c"
  control-border: "#85929e"
  text-muted: "#a8b3bd"
  amber: "#e6b66e"
  amber-hover: "#f0c78a"
  jade: "#9bcfaf"
  blue: "#8cbaea"
  danger: "#e5a0a0"
typography:
  family: "DM Sans, Segoe UI, sans-serif"
  heading-family: "Sora, Segoe UI, sans-serif"
  headline: "30px / 1.2, weight 600"
  section: "22px / 1.3, weight 600"
  body: "14px / 1.6"
  metadata: "12px / 1.5"
rounded:
  small: "4px"
  medium: "6px"
  large: "8px"
spacing:
  compact: "8px"
  small: "12px"
  medium: "16px"
  section: "24px"
  page: "32px"
---

# Design system: Arden

## Direction

The original 4 October 2026 **Living Archive** foundation follows [Figma page 06 Redesign — Living Archive](https://www.figma.com/design/UmW5qb5cTWo6lwMYZ4Z9bC/Arden?node-id=147-2). On 13 October the user accepted a deeper charcoal/ivory workspace reference, first for My Work and then for every workspace tab. The metadata above records the current workspace palette. Authentication/onboarding retain the original palette; do not restyle those screens merely by changing root tokens.

Use the shared workspace tokens for canvas, surfaces and dividers. Muted blue carries navigation/selection and source context; amber carries primary actions and attention; sage carries success and connections; muted red carries errors and risk. Pair every status color with a visible label or icon. These accents do not justify gradients, rainbow decoration or fabricated analytics. Keep existing brand explorations separate from the accepted Figma icon assets.

The implemented UI combines live authentication, server-backed private notes and governed shared knowledge with session-memory previews for My Work and handover. Signed-in members can create text or PDF drafts, edit governance metadata, submit a version for review, and see authorized publications; assigned reviewers can decide an immutable snapshot. Preview content stays labeled and never represents a server write. Ask Arden and the graph remain deferred. Native SVGs exported from the accepted Figma design are local decorative/interface assets, not fetched knowledge projections. [Mainflow 1 preview](docs/engineering/mainflow-1-preview.md) records the earlier demonstration and its then-current boundaries.

## Typography and geometry

Interface icons use Flaticon Uicons Regular Rounded through the shared `Icon`
adapter. Use briefcase for work, book for knowledge/context, clipboard-check for reviews, exchange for handover, lock for private content,
users for administration and plug for integrations. Generic arrows remain
navigation controls, not workflow identifiers. Keep inherited semantic colors,
consistent sizing and accessible button labels; decorative glyphs are hidden from
screen readers. The free-license attribution remains visible on every screen.
This does not adopt a new brand mark or replace the rich editor's own toolbar icons.

Use Sora for headings and DM Sans for body, controls and metadata, with Segoe UI/sans-serif fallbacks. The variable TTF files and their OFL notices live in `packages/ui/src/assets/fonts/`; `@font-face` bundles them through Vite without runtime requests to a font service. Redesigned workspace page titles use 28px, section headings 15–18px, body text 14px and metadata typically 12px. Sign-in has a larger editorial heading. Use heading weight 600, restrained tracking and tabular figures for counts. Wrap long note titles instead of hiding the selected title in a single-line input.

The server-backed shared-knowledge `Document text` field keeps the existing dark bordered writing surface and adds one compact toolbar inside that boundary. Users may choose Normal, Large or Heading text and apply bold, italic, underline, strike, inline code, bullet/numbered lists and quotes. Arden owns the typography: do not expose font family, arbitrary color, background color, remote embeds, files or decorative formatting. The same validated document formatting must appear in authoring, immutable review and published reading. Legacy plain text remains readable, disabled/pending editors retain their formatting without appearing editable, and the toolbar must wrap without horizontal page overflow at narrow widths.

Corners remain square with small softening: 4px for small controls, 6px for buttons/navigation and 8px for major containers. Avoid card nesting when spacing and a divider can express the same relationship. Shadows are unnecessary on ordinary dark workspace surfaces.

The primary workspace sidebar follows the redesign handoff: 248px on wide layouts, 224px at 900–1199px, and a 64px accessible icon rail at 640–899px. Below 640px it becomes a 280px overlay opened from the top bar, with a scrim and Escape-to-close behavior. Keep the sidebar scrollbar visually hidden at rest and reveal it on sidebar hover or keyboard focus without changing the content width.

The redesigned shell, Administration and Knowledge surfaces use dividers, flat tints and a scrim for depth rather than box-shadows. Hover and focus states change background and border without moving controls; reduced-motion preferences remain respected elsewhere in the workspace.

## Shell and responsive behavior

The desktop shell has a flexible workspace. Context starts collapsed and occupies no rail; opening it adds a 320px Context pane inline only when the measured workspace width after the sidebar is at least 1100px. Otherwise Context overlays the workspace, with a scrim; on mobile it may take the full width. The top bar remains 56px high and shows structured breadcrumbs. The Review Queue nav item displays the assigned review count when server data is available.

Every primary workspace destination uses the shared page header for its eyebrow, title, description and optional action. The workspace top bar and page header remain visible while only the content region below them scrolls; body scrolling must not move shell navigation or page identity. Keep this split consistent across My Work, Knowledge, Review Queue, Knowledge Handover, Personal Workspace and Organization administration, including narrow layouts.

The workspace is an inline-size query container. Below 760px **of available workspace width**, My Work sections stack; the note layout stacks below 640px. This depends on the actual content width rather than the viewport alone, so opening a pane cannot push editor controls beneath it. Below 500px of content width, compact forms and organization rows stack further.

Below 640px, the top-bar hamburger opens the sidebar over the workspace. Private notes show either the list or the editor. Selecting or creating a note opens the editor and hides the introductory heading/search so writing starts sooner; Back to notes restores the list and New private note action without discarding a draft. The collapsed Context pane occupies no mobile space; opening it overlays the workspace and closing it returns focus to the Context control. Organization tables, setup steps, dialogs and knowledge layouts must reflow without hiding required actions.

On mobile sign-in, keep the brand and a compact introduction above the form. The long desktop explanation is omitted so the form appears sooner.

## My Work and context

My Work uses the accepted reference's deeper charcoal canvas (#1B1F21), ivory text
(#F2ECE2), muted blue selection, amber urgency, sage success and muted red risk.
The palette now applies to every workspace destination through
`styles/workspace-theme.css`: Knowledge, Review Queue, Handover,
Personal Workspace and Organization administration as well as My Work.
Authentication/onboarding retain their existing appearance. Blue denotes
navigation/selection; amber remains an action/attention color, sage indicates
success and muted red indicates risk. Keep each feature's functional layout:
editor, context/answer, review queue, handover and role rail are not dashboard
copies. Retain the shared fixed page header/scroll contract and
collapsed-by-default context pane. Selection, readable surfaces, keyboard
focus, search controls and preview badges must stay consistent across tabs.

Priority queue is the main section. Place the full-width queue search above three
compact status cards, then use a wide priority column beside a narrower activity
surface (recent publications, handover risk and a private-workspace shortcut).
The runbook is a queue row, not a separate oversized spotlight. Rows show a
semantic color edge, status text, metadata and assignee; color alone is never a
status label. Type/status filters combine with queue search and preserve urgency
order. Search only filters the sample priority queue, not every document or
activity. The sample status summary remains a whole-workspace summary while
filtered. Do not restore explanatory subtitles from the reference. Reflow by
available workspace width when context opens, with stacked activity on narrow
layouts and no horizontal page overflow. This remains sample UI, not live work
counts, real assignee data or server filtering.

The Knowledge Pane retains visible access scope. In Personal Workspace it follows the selected note's draft title. Do not display AI assistance disclosures or an Ask Arden composer while Flow 3 is deferred. Keep preview/sample labels and explain unavailable features without internal ticket IDs or API names in primary actions.

In the sample knowledge workflow, the editor must reflect the immutable snapshot's lifecycle: after approval and automatic sample publication, an unchanged working copy shows **Published · Sample** instead of offering another submission. Editing that copy may start a new reviewable version; it never edits the published snapshot in place. These preview states do not imply server publication or audit records.

## Private-note draft contract

Keep drafts separately for each note in shell-owned session memory. Switching notes, creating another note or navigating to My Work must preserve existing drafts. Saving applies only the selected draft to the in-memory preview; other drafts survive. Show unsaved state in both the editor and the list. Exiting with unsaved work opens an accessible discard confirmation; refreshing/closing gets the browser's unload warning. Switching the demo member identity also guards unsaved private drafts and resets the private-note session before rendering the other member's workspace. Exiting resets notes, drafts and organization state.

This is not persistence, authentication, offline synchronization or authorization. Do not write private notes to browser storage to make a UI demonstration look persistent. Real content still requires server authorization and an accepted storage design.

## Future graph surface (planned)

The planned graph home keeps the network dominant within its workspace, with a restrained dot grid, Zoom/Fit controls and a Knowledge Pane for the selected item's identity, provenance, freshness, context and connections. Preserve the shape grammar: shared items use solid-outline circles, personal items dashed-outline circles and external items squares. Neutral fills, visible text labels and a legend accompany those shapes. Adapt selection to the dark palette with warm emphasis and a visible halo; strengthen selected connections before fading unrelated marks, and keep item names legible. Respect reduced motion.

At narrow widths, provide a selected-item summary and a direct navigable item list alongside the pannable graph. Canvas interaction must have a keyboard-accessible alternative. Sample nodes and unavailable actions remain clearly labeled. These are retained design requirements for future implementation, not a claim that this preview ships a graph.

## Accessibility and verification

Routine screens use concise titles, field labels and functional metadata, without
explanatory subtitles, repeated helper paragraphs or implementation footnotes.
Preserve document/answer content, errors, loading/save states, required action
warnings and confirmation consequences. Sample/server/planned badges remain
visible so reducing copy never implies live functionality. Permission switches
retain accessible names even without visible descriptions; remove dangling
`aria-describedby` references when removing helper text. Do not hide copy globally
with CSS or remove all `small`/`p` elements: many contain actual data or feedback.

Custom-role configuration uses a flat two-column role rail/editor, with Details,
Permissions and Members sections, permission switches, search and a Save/Reset
bar. Blue marks selection and jade marks enabled switches. At narrow workspace
widths the rail stacks above the editor. Private defaults and protected management
rights are not editable switches. In a signed-in administration session, custom-role
changes use server APIs; the preview flow remains visibly synthetic. See
[custom-role UI boundary](docs/engineering/custom-role-ui-preview.md) for the earlier preview contract.

Use stable accessible search names independent of shortcut hints and clear buttons. All editable fields must retain visible keyboard focus. Active navigation must remain legible on hover. Redesigned controls use a blue 2px focus ring, 40px main actions, reduced-motion rules and a skip-to-content link. Native dialog confirmation keeps focus inside the dialog and restores focus on dismissal.

Check 1440px desktop, 1024px narrow windows, 390px/320px mobile, long content and 200% zoom/reflow. Check expanded and collapsed context, mobile editor/back navigation, note switching, save/reset/exit, empty search and keyboard access. Shared UI must be checked in web and Electron; a successful build alone does not prove native behavior.
