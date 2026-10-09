---
name: Arden
description: Living Archive, a dark workspace with measured color for private organizational knowledge and work context.
colors:
  charcoal: "#242628"
  warm: "#f4f3ef"
  mist: "#d4d5d5"
  stone: "#929698"
  canvas: "#242628"
  sidebar: "#1c1e20"
  surface: "#2d3032"
  elevated: "#363a3d"
  line: "#33373a"
  strong-line: "#656b6e"
  control-border: "#929698"
  text-muted: "#a5aaac"
  amber: "#e7b970"
  amber-hover: "#f0c98b"
  jade: "#80c5b8"
  blue: "#a4b9e8"
  danger: "#e9978a"
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

The accepted 4 October 2026 **Living Archive** redesign follows [Figma page 06 Redesign — Living Archive](https://www.figma.com/design/UmW5qb5cTWo6lwMYZ4Z9bC/Arden?node-id=147-2). Dark surfaces remain dominant while measured accents make actions, sources and connections easier to distinguish. Charcoal `#242628` is the main canvas. Warm white `#F4F3EF` is primary text, mist `#D4D5D5` is secondary text, and stone `#929698` remains a brand neutral and control border. Use muted `#A5AAAC` for small tertiary text rather than applying stone indiscriminately.

Use sidebar `#1C1E20`, content surfaces `#2D3032`, raised surfaces `#363A3D`, structural dividers `#33373A` and stronger dividers `#656B6E`. Amber `#E7B970` carries primary actions and active navigation, with `#F0C98B` on hover and charcoal text on amber controls. Jade `#80C5B8` signals success and connections, blue `#A4B9E8` signals source context, and muted red `#E9978A` signals errors. Pair every status color with a visible label or icon. These accents replace the earlier monochrome-only restriction; they do not justify gradients, rainbow decoration or fabricated analytics. Keep existing brand explorations separate from the accepted Figma icon assets.

The implemented UI remains a session-memory frontend preview: sign-in, workspace selection, My Work, private notes, first-run setup, organization/access administration, invitation acceptance and access readiness, plus sample knowledge editing, review/publication and handover. Ask Arden displays a prerecorded answer, not live AI. There is no live graph screen. Native SVGs exported from the accepted Figma design are local decorative/interface assets, not fetched knowledge projections. [Mainflow 1 preview](docs/engineering/mainflow-1-preview.md) records the demonstrated transitions and the server work still required.

## Typography and geometry

Use Sora for headings and DM Sans for body, controls and metadata, with Segoe UI/sans-serif fallbacks. The variable TTF files and their OFL notices live in `packages/ui/src/assets/fonts/`; `@font-face` bundles them through Vite without runtime requests to a font service. Normal workspace headings use 30px, section headings 22px, body text 14px and metadata typically 12px. Sign-in has a larger editorial heading. Use heading weight 600, restrained tracking and tabular figures for counts. Wrap long note titles instead of hiding the selected title in a single-line input.

Corners remain square with small softening: 4px for small controls, 6px for buttons/navigation and 8px for major containers. Avoid card nesting when spacing and a divider can express the same relationship. Shadows are unnecessary on ordinary dark workspace surfaces.

Interaction depth is selective: featured/raised surfaces use a soft dark shadow and quiet top edge, while actionable rows, navigation and buttons respond with a small lift or lateral shift. Short entrance motion is limited to page sections, the context pane, feedback and dialogs; there is no continuous decorative animation. Hover motion applies only to fine pointers, keyboard focus remains visible without requiring motion, and reduced-motion preferences remove transforms and entrance effects.

## Shell and responsive behavior

The desktop shell has a 216px sidebar and a flexible workspace. Context starts collapsed and occupies no rail; opening it adds a 320px Knowledge Pane. At 1280px and below, navigation is 208px and the expanded pane 280px. Crossing into 1180px or below collapses context; the user can reopen it. From 761–980px, navigation is a 72px icon rail with accessible names and tooltips.

The workspace is an inline-size query container. Below 760px **of available workspace width**, My Work sections stack; the note layout stacks below 640px. This depends on the actual content width rather than the viewport alone, so opening a pane cannot push editor controls beneath it. Below 500px of content width, compact forms and organization rows stack further.

At viewport widths of 760px or below, navigation becomes a sticky 64px strip with short visible labels. Its destinations scroll horizontally inside the navigation strip rather than widening the page; the workspace top bar stays below it. Private notes show either the list or the editor. Selecting or creating a note opens the editor and hides the introductory heading/search so writing starts sooner; Back to notes restores the list and New private note action without discarding a draft. The collapsed context pane occupies no mobile space. Opening Context reveals the pane below the workspace and moves focus/scroll to it; closing it returns focus to the Context control. Organization tables, setup steps, dialogs and knowledge layouts must reflow without hiding required actions.

On mobile sign-in, keep the brand and a compact introduction above the form. The long desktop explanation is omitted so the form appears sooner.

## My Work and context

Priority queue is the main section. Its title must outweigh secondary activity labels. Use flat rows with dividers, readable urgency metadata and a separate activity surface; do not force a 560px empty card. Search describes its current scope: it filters the priority queue, not every document or activity. The sample status summary stays a whole-workspace summary while the queue is filtered.

The Knowledge Pane retains visible access scope. In Personal Workspace it follows the selected note's draft title. Planned AI suggestions live inside a disclosure instead of a stack of disabled action buttons. Keep preview/sample labels and explain unavailable features without internal ticket IDs or API names in primary actions.

## Private-note draft contract

Keep drafts separately for each note in shell-owned session memory. Switching notes, creating another note or navigating to My Work must preserve existing drafts. Saving applies only the selected draft to the in-memory preview; other drafts survive. Show unsaved state in both the editor and the list. Exiting with unsaved work opens an accessible discard confirmation; refreshing/closing gets the browser's unload warning. Switching the demo member identity also guards unsaved private drafts and resets the private-note session before rendering the other member's workspace. Exiting resets notes, drafts and organization state.

This is not persistence, authentication, offline synchronization or authorization. Do not write private notes to browser storage to make a UI demonstration look persistent. Real content still requires server authorization and an accepted storage design.

## Future graph surface (planned)

The planned graph home keeps the network dominant within its workspace, with a restrained dot grid, Zoom/Fit controls and a Knowledge Pane for the selected item's identity, provenance, freshness, context and connections. Preserve the shape grammar: shared items use solid-outline circles, personal items dashed-outline circles and external items squares. Neutral fills, visible text labels and a legend accompany those shapes. Adapt selection to the dark palette with warm emphasis and a visible halo; strengthen selected connections before fading unrelated marks, and keep item names legible. Respect reduced motion.

At narrow widths, provide a selected-item summary and a direct navigable item list alongside the pannable graph. Canvas interaction must have a keyboard-accessible alternative. Sample nodes and unavailable actions remain clearly labeled. These are retained design requirements for future implementation, not a claim that this preview ships a graph.

## Accessibility and verification

Use stable accessible search names independent of shortcut hints and clear buttons. All editable fields must retain visible keyboard focus. Active navigation must remain legible on hover. Use warm focus rings, at least 44px main action targets, reduced-motion rules and a skip-to-content link. Native dialog confirmation keeps focus inside the dialog and restores focus on dismissal.

Check 1440px desktop, 1024px narrow windows, 390px/320px mobile, long content and 200% zoom/reflow. Check expanded and collapsed context, mobile editor/back navigation, note switching, save/reset/exit, empty search and keyboard access. Shared UI must be checked in web and Electron; a successful build alone does not prove native behavior.
