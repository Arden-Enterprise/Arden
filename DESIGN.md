---
name: Arden
description: Island system, a graphite workspace with one violet accent and floating, morphing chrome for private organizational knowledge and work context.
colors:
  bg-app: "#101014"
  bg-sidebar: "#15151a"
  surface: "#1c1c23"
  surface-raised: "#25252e"
  surface-hover: "white 4%"
  border: "#303039"
  border-strong: "#6a6976"
  text-primary: "#f2f1f7"
  text-secondary: "#a5a4b1"
  text-muted: "#8c8b98"
  text-disabled: "#777683"
  accent: "#8b82f6"
  accent-hover: "#a69eff"
  accent-subtle: "violet 14%"
  text-on-accent: "#101014"
  success: "#7fcfa3"
  warning: "#e3b26b"
  danger: "#f2938a"
  info: "#7eb0f0"
typography:
  family: "Inter, Segoe UI, sans-serif"
  heading-family: "Inter Tight, Inter, Segoe UI, sans-serif"
  headline: "34px / 1.2, weight 600, -0.03em"
  section: "15–18px / 1.3, weight 600"
  body: "14px / 1.55"
  metadata: "12px / 1.5"
rounded:
  chip: "6px"
  control: "8px"
  island: "12px"
  panel: "16px"
spacing:
  compact: "8px"
  shell-gap: "12px"
  medium: "16px"
  section: "24px"
---

# Design system: Arden

## Direction

On 23 October 2026 the user accepted the **Island system** ([design canvas](https://claude.ai/code/artifact/78a3072a-46d4-4575-a1a6-65ff52221b89)) for every workspace destination. It supersedes the 13 October charcoal/ivory/amber workspace palette and the Sora/DM Sans workspace typography. Authentication/onboarding retain their original appearance; do not restyle those screens by changing root tokens.

The palette is low-saturation graphite with one violet accent. Violet marks only the active place, the primary action, AI work and focus. Everything else is told apart by tone, not colour. Status colours (sage success, amber warning, coral danger, blue info) each have a 12% `subtle` fill and 30% border for chips and never mean "selected". Pair every status colour with a visible label or icon. No gradients, glows, rainbow decoration or fabricated analytics.

Depth comes from tone: each layer is one step lighter (app → sidebar → surface → raised) plus a 1px border. Only floating islands (status island, detail and form islands, dialogs, mobile tab bar) carry the soft island shadow.

Tokens live in `packages/ui/src/styles/island-shell.css` under `.arden-app-shell`. Components read the semantic `--arden-*` names there; the earlier `--arden-canvas`, `--arden-accent`, etc. are re-pointed aliases so older rules keep working. A future light theme swaps only the semantic layer.

The implemented UI combines live authentication, server-backed private notes, governed shared knowledge, Organization administration and permission-aware Ask Arden retrieval with session-memory previews for My Work and handover. Ask Arden conversations are session-local for the MVP, while answers and citations come from the server-authorized RAG path. Preview content stays labelled and never represents a server write. Durable chat history and the graph remain deferred. [Mainflow 1 preview](docs/engineering/mainflow-1-preview.md) records the earlier demonstration and its then-current boundaries.

## Typography, icons and geometry

Inter (body, controls, metadata) and Inter Tight (headings) are bundled through the pinned `@fontsource-variable/inter` and `@fontsource-variable/inter-tight` packages (OFL-1.1) and served locally by Vite; there is no runtime font-service request. They include Vietnamese diacritics. Page titles are 34px Inter Tight 600 with -0.03em tracking, section headings 15–18px, body 14px and metadata 12px. Use tabular figures for counts.

Interface icons use Flaticon Uicons Regular Rounded through the shared `Icon` adapter: briefcase for work, book for knowledge, clipboard-check for reviews, exchange for handover, lock for private content, users for administration, plug for integrations, shield for reviewer authority and sidebar for collapsing navigation. Decorative glyphs are hidden from screen readers and the free-licence attribution stays visible on every screen.

Radii: 6px chips, 8px controls, 12px islands and inner boxes, 14–16px panels. Control heights: 28px (island actions, inner tabs), 32px (default buttons, inputs, filters, nav items), 36px (one primary action per page), 44px+ touch targets on phones.

The server-backed `Document text` field keeps one compact formatting toolbar (Normal/Large/Heading, bold, italic, underline, strike, inline code, lists, quote). Arden owns the typography: no font family, arbitrary colour, background colour, remote embeds or files. The same validated formatting appears in authoring, immutable review and published reading.

## Shell

- **Navigation island** — a 256px rounded panel (bg-sidebar) with the organization button, WORK (My Work, Ask Arden, Private Notes), KNOWLEDGE (Library, Reviews with assigned count, planned Integrations) and MANAGE ORGANIZATION (Administration, admins only). A Collapse control shrinks it to a 72px icon rail; labels remain accessible names and tooltips.
- **Status island** — centred in the 64px top bar. Idle (380×44): organization mark and breadcrumb, plus a Ctrl K trigger when the page provides a search. Search (600×52): the page's own search field; Esc or blur closes it unless it holds a value. Toast (480×58): every `ActionToast` is announced here through `StatusIslandContext`, with dismiss and an optional single action such as Undo. Confirm (520×62): destructive admin actions confirm here (`IslandConfirm`, falling back to a modal dialog outside the shell); Escape cancels. Panel (480 wide, floating over the page): a page may pass one short task, such as Contribute a copy from Private Notes. It morphs width/height/radius over 500ms `cubic-bezier(.32,.72,0,1)`; reduced motion makes it instant. The island search only searches what the page says it searches (e.g. the priority queue) — never imply a global search that does not exist.
- The preview/server label and the Context toggle stay at the right of the top bar. The Context pane is a 320px island, collapsed by default and occupying no space; it opens inline when the workspace is at least 1100px wide, otherwise as an overlay with a scrim.
- Shell gap is 12px around and between islands. The page header and top bar stay fixed while the content region scrolls.

## Pages

- **Page header** — eyebrow (11px, 0.08em), 34px title, one-line description, optional primary action.
- The page header's eyebrow, title and one-line description form one block; the page action is vertically centred beside it. Administration descriptions stay on one line so the tab bar never moves between tabs.
- **Lists** are islands of grid rows (`IslandTable`), which keep ARIA table/row/cell semantics. Headers are 11px muted capitals; selected rows use accent-subtle. Below 640px of workspace width the rows become stacked cards and the header is visually hidden.
- **Detail islands** open beside a list (Members, Departments, Audiences, My Contributions) and slide in; focus moves to their heading and returns to the opener on close; Escape closes. Below 640px they stack under the list.
- **Segmented islands** carry section tabs (Administration, Library/My Contributions) and status filters, with counts.
- **Administration** — Members (list + member detail with access, primary department, reviewer authority and audience chips), Departments (list + managed audience detail), Audiences (Organization / Departments managed by Arden, Groups managed by Org Admins, detail island to edit groups and members), Invitations (status filters + list + Invite form island), Reviewer access (Active/Inactive + grant list + New grant form island; no classification or level choice; the accessible scope control selects One department or Whole organization, hides the department picker for organization scope, and the list's Covers column shows the department or Whole organization). Filter rows sit above the list/detail split so side islands (300–340px) align with the table top. Audience group removal applies at once with an Undo toast. Actions the server cannot perform yet (change Org Admin access, remove a member, rename or deactivate a department) are shown disabled with a visible reason. Values the server does not provide (last active, publication counts) are not invented.
- **My Work** — Priority queue island with type/status filters and row actions, beside Recently published, Handover at risk and a Private Notes card. Sample data stays labelled; island search filters only the queue.
- **Private Notes** — a note-list island (sidebar tone, search, new note) beside an editor island with an "Only you" chip, save state, Contribute copy and Save. Below 760px of workspace width only the list or the editor shows, with Back to notes.
- **Knowledge** — Library as a searchable publication list; My Contributions as a separate list with a detail island (status, reviewer note, metadata, history, Open draft); New shared draft asks only for the content source and title; the draft editor is a document island beside a "Before you submit" island where each sharing field appears once — the derived owner line ("Owned by you · reviewed by {primary department}", decision 0014; older servers still show a department select), a single "Who can read it" search picker followed by the derived reviewer authority (Organization audience → Organization reviewer; Department / Groups → responsible-department reviewer; no per-person or deny entries), and team/project tags folded into Advanced; there is no classification control. Selecting Organization warns when no active Organization grant exists. The publication scope is derived from the chosen readers (organization audience → Organization, department audience → Department, groups only → Organization unless narrowed to the responsible department) and shown as text; Reviews as three fixed-height panes — queue (240px), the submitted document (the focus; its body scrolls by itself) and a 312px decision island holding the frozen facts including Reviewed by, the note to the author and a pinned footer where Approve/Reject and their confirmation stay visible without scrolling (Approve or Reject only; approval moves the exact snapshot into preparation). See decisions 0010, 0013 and 0015.
- **Published knowledge search and reader** — Library search presents authorized publications as a dense, responsive list with document identity, owner, exact version, effective date and status. Search matches title, document code, owner department and summary only within the server-authorized publication set. Opening a result shows a compact information island beside the document surface, borrowing the useful split of established QMS readers without their blue chrome, ratings or feedback clutter. The reader shows only document code, version selector, `Effective`/`Upcoming`/`Expired`, effective date, owner department and a short summary. Document type belongs in navigation/filter context rather than the information island. Classification appears only when it is `Confidential` or `Restricted`. Historical versions remain subordinate to the current version and receive an explicit expired warning. The live server may show only the current version until its authorized history contract supplies older snapshots; the UI must not invent history.
- **Ask Arden** — a Linear-style sparse agent canvas. It replaces the normal workspace top bar with a 42px conversation header; the empty state centres a compact composer over a nearly invisible Arden watermark, followed by an indexed-knowledge chip and three starter cards. The active thread keeps the same narrow reading column and docks the composer at the bottom. Prompts use the live permission-aware RAG endpoint. Citation rows use exact publication-version references; selecting one opens the governed reader, shows the cited excerpt and highlights the stable source block. Insufficient evidence and service failures are shown honestly without fabricated citations.
- **Phones (<640px)** — a compact status island and menu button at the top, and a bottom tab island (My Work, Ask, Notes, Library, Reviews). The menu drawer keeps Administration, every other destination and sign-out.

## Private-note draft contract

Keep drafts separately for each note in shell-owned session memory. Switching notes, creating another note or navigating to My Work must preserve existing drafts. Saving applies only the selected draft; other drafts survive. Show unsaved state in both the editor and the list. Exiting with unsaved work opens an accessible discard confirmation; refreshing/closing gets the browser's unload warning. Switching the demo member identity also guards unsaved private drafts. Exiting resets notes, drafts and organization state.

This is not persistence, authentication, offline synchronization or authorization. Do not write private notes to browser storage to make a demonstration look persistent.

In the sample knowledge workflow, an unchanged working copy that was approved shows **Published · Sample**; editing it may start a new reviewable version and never edits the published snapshot in place.

## Approved brand artwork reference

The selected **Flux Circle — Equal rhythm spacing (option 2, v15)** artwork is delivered in [the final logo package](brand/arden-logo-final/README.md), with vector/raster variants, selection metadata, checksums and the Sora licence. The artwork was selected on 15 October 2026. This export package does not replace the current application icons, favicons or installer assets; adopting it in shipped surfaces requires a separate implementation and visual verification.

## Future graph surface (planned)

The planned graph home keeps the network dominant within its workspace, with a restrained dot grid, Zoom/Fit controls and a Knowledge Pane for the selected item's identity, provenance, freshness, context and connections. Shared items use solid-outline circles, personal items dashed-outline circles and external items squares, with neutral fills, visible labels and a legend. Selection uses the violet accent with a visible halo. At narrow widths provide a selected-item summary and a navigable item list; canvas interaction needs a keyboard-accessible alternative. These are requirements for future work, not a claim that the preview ships a graph.

## Accessibility and verification

Text meets 4.5:1 on its surface (text.muted is tuned to 5.1:1; border.strong gives inputs 3.1:1). Focus is a 2px accent-hover ring with 2px offset; inside the status island the island border shows focus. Use real buttons, links and labelled inputs; icon-only buttons have accessible names. Keep sample/server/planned badges visible so reduced copy never implies live functionality. Native dialogs keep focus inside and restore it on dismissal.

Check 1440px desktop, 1024px, the 640–899px icon rail, 375px/320px phones, long content and 200% zoom. Check island search/Esc, toasts, detail islands open/close, collapsed navigation, expanded and collapsed Context, note switching and keyboard access. Shared UI must be checked in web and Electron; a successful build alone does not prove native behaviour.
