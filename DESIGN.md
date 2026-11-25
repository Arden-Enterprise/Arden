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

On 23 October 2026 the user accepted the **Island system** ([design canvas](https://claude.ai/code/artifact/78a3072a-46d4-4575-a1a6-65ff52221b89)) for every workspace destination. It supersedes the 13 October charcoal/ivory/amber workspace palette and the Sora/DM Sans workspace typography. Authentication/onboarding (sign-in, register, password reset, workspace chooser, invitation link) use the Island **colours** since 22 November 2026 (maintainer request: colours only), through colour tokens scoped to `.auth-entry-page` in `sign-in.css`; they keep their own layout and Sora headings. Do not restyle them by changing root tokens. The invitation email keeps its Living Archive palette.

Password recovery follows one visible path: request by email, show a neutral check-email screen with an option to request another reset link, then open the new-password form when the link supplies a recovery session. The API verifies the link proof before changing the password. A missing or expired link shows a new-link action. No verification-code field appears in this flow. This shared authentication UI uses the Island colours (violet primary action, graphite surfaces) with its original layout and type on web and desktop; Continue with Google shows Google's standard four-colour mark.

After sign-in, show the workspace chooser even for a single active membership so the member can select it or create another organization. The signed-in workspace control reopens the chooser, with an unsaved-change confirmation when needed. Sign-in and reset password fields offer Show/Hide; the three-item password checklist appears only when creating a new account or setting the first Google password.

The palette is low-saturation graphite with one violet accent. Violet marks only the active place, the primary action, AI work and focus. Everything else is told apart by tone, not colour. Status colours (sage success, amber warning, coral danger, blue info) each have a 12% `subtle` fill and 30% border for chips and never mean "selected". Pair every status colour with a visible label or icon. No gradients, glows, rainbow decoration or fabricated analytics.

Depth comes from tone: each layer is one step lighter (app → sidebar → surface → raised) plus a 1px border. Only floating islands (status island, detail and form islands, dialogs, mobile tab bar) carry the soft island shadow.

Tokens live in `packages/ui/src/styles/island-shell.css` under `.arden-app-shell`. Components read the semantic `--arden-*` names there; the earlier `--arden-canvas`, `--arden-accent`, etc. are re-pointed aliases so older rules keep working. A future light theme swaps only the semantic layer.

The implemented UI combines live authentication, server-backed private notes, governed shared knowledge, Organization administration and permission-aware Ask Arden retrieval with session-memory previews for My Work and handover. Ask Arden conversations are session-local for the MVP, while answers and citations come from the server-authorized RAG path. Preview content stays labelled and never represents a server write. Durable chat history and the graph remain deferred. [Mainflow 1 preview](docs/engineering/mainflow-1-preview.md) records the earlier demonstration and its then-current boundaries.

In editable Private notes and shared text drafts, selecting text opens a compact menu beside the selection with Improve Writing, Reformat and Explain. The context menu also includes Cut, Copy and Paste and supports Shift+F10. The menu stays within the viewport and opens above the selection when it needs more room. The note toolbar supports whole-note actions. Improve and Reformat show a suggestion with an explicit Replace action. Explain stays in the assistant panel. The editor disables replacements that cannot preserve rich-text structure. The separate published-reader Explain selection task remains deferred under RA-06. See [F22](docs/product/writing-actions.md).

## Typography, icons and geometry

Inter (body, controls, metadata) and Inter Tight (headings) are bundled through the pinned `@fontsource-variable/inter` and `@fontsource-variable/inter-tight` packages (OFL-1.1) and served locally by Vite; there is no runtime font-service request. They include Vietnamese diacritics. Page titles are 34px Inter Tight 600 with -0.03em tracking, section headings 15–18px, body 14px and metadata 12px. Use tabular figures for counts.

Interface icons use Flaticon Uicons Regular Rounded through the shared `Icon` adapter: briefcase for work, book for knowledge, clipboard-check for reviews, exchange for handover, lock for private content, users for administration, plug for integrations, shield for reviewer authority and sidebar for collapsing navigation. Decorative glyphs are hidden from screen readers and the free-licence attribution stays visible on every screen.

Radii: 6px chips, 8px controls, 12px islands and inner boxes, 14–16px panels. Control heights: 28px (island actions, inner tabs), 32px (default buttons, inputs, filters, nav items), 36px (one primary action per page), 44px+ touch targets on phones.

The server-backed `Document text` field keeps one compact formatting toolbar (Normal/Large/Heading, bold, italic, underline, strike, inline code, lists, quote). Arden owns the typography: no font family, arbitrary colour, background colour, remote embeds or files. The same validated formatting appears in authoring, immutable review and published reading.

## Shell

- **Navigation island** — a 256px rounded panel (bg-sidebar) with the organization button, WORK (Home, Ask Arden, Private Notes), REVIEW (Reviews with assigned count, planned Integrations) and MANAGE ORGANIZATION (Administration, admins only). A Collapse control shrinks it to a 72px icon rail; labels remain accessible names and tooltips.
- **Status island** — centred in the 64px top bar. Idle (380×44): organization mark and breadcrumb, plus a Ctrl K trigger when the page provides a search. Search (600×52): the page's own search field; Esc or blur closes it unless it holds a value. Toast (480×58): every `ActionToast` is announced here through `StatusIslandContext`, with dismiss and an optional single action such as Undo. Confirm (520×62): destructive admin actions confirm here (`IslandConfirm`, falling back to a modal dialog outside the shell); Escape cancels. Panel (480 wide, floating over the page): a page may pass one short task, such as Contribute a copy from Private Notes. It morphs width/height/radius over 500ms `cubic-bezier(.32,.72,0,1)`; reduced motion makes it instant. The island search only searches what the page says it searches (e.g. the priority queue) — never imply a global search that does not exist.
- The Demo label (when applicable) and the Arden mark stay at the right of the top bar. The mark opens the **Ask Arden panel** (owner request, 22 November 2026; it replaces the earlier Context pane). The panel is a 360px island, collapsed by default and taking no space. It docks inline when the workspace is at least 1100px wide, floats with a scrim below that, and becomes a full sheet on phones. It uses the same permission-aware Ask Arden answers and action row as the Ask Arden page: Stop waiting, New chat with confirmation, Open Ask Arden and Close. The conversation survives closing the panel and resets on organization or account change. Escape closes it and returns focus to the mark.
- Shell gap is 12px around and between islands. The page header and top bar stay fixed while the content region scrolls.

## Pages

- **Page header** — eyebrow (11px, 0.08em), 34px title, one-line description, optional primary action.
- The page header's eyebrow, title and one-line description form one block; the page action is vertically centred beside it. Administration descriptions stay on one line so the tab bar never moves between tabs.
- **Lists** are islands of grid rows (`IslandTable`), which keep ARIA table/row/cell semantics. Headers are 11px muted capitals; selected rows use accent-subtle. Below 640px of workspace width the rows become stacked cards and the header is visually hidden.
- **Reason dialogs** (Inspect, Withdraw, Request withdrawal, Request a reader change) use the compact dialog island accepted on 22 November 2026 ([design canvas](https://claude.ai/artifact/6sdbDHaHRob38YdDdVbDE1)). It is 480px wide on the base surface. The header has a 32px icon tile, a 17px title, the document title as a muted subtitle and a ghost close button. Focus starts in the reason field, not on Close. The field shows its count inside ("0 / 1000"); "Enter a reason." appears below it. The audience or consequence sits in a quiet notice under the field. A danger action moves the notice above the field in the coral subtle tone and uses a coral icon tile and button. The footer has a top border and a sidebar-tone background, with a ghost Cancel and a 32px primary action.
- **Detail islands** open beside a list (Members, Departments, Audiences, My Contributions) and slide in; focus moves to their heading and returns to the opener on close; Escape closes. Below 640px they stack under the list.
- **Segmented islands** carry section tabs (Administration, Library/My Contributions) and status filters, with counts.
- **Administration** — Members (list + member detail with access, primary department, reviewer authority and audience chips), Departments (list + managed audience detail), Audiences (Organization / Departments managed by Arden, active Groups and separate Inactive reader groups, detail island to edit groups and members), Invitations (status filters + list with a distinct recipient-email cell + Invite form island), Reviewer access (Active/Inactive + grant list + New grant form island; no classification or level choice; the accessible scope control selects One department or Whole organization, hides the department picker for organization scope, and the list's Covers column shows the department or Whole organization). The form prevents assigning an effective duplicate for the same reviewer, scope and team/project tags, while allowing different tags. Filter rows sit above the list/detail split so side islands (300–340px) align with the table top. Audience group removal applies at once with an Undo toast. Actions the server cannot perform yet (change Org Admin access, remove a member, rename or deactivate a department) are shown disabled with a visible reason. Values the server does not provide (last active, publication counts) are not invented.
- **Administration → Documents** (decision 0023, Organization Admins only)
  - **Content.** A search field and an `IslandTable` of current publications: document, department, Shared with, version, published date and row actions.
  - **Metadata only.** Shared with shows Everyone in organization, the department or Selected members, never a reader count or names.
  - **Reported problems.** A row with open problem reports carries a danger chip ("2 reported"). The Reported problems island sits above the table.
  - **Inspect.** A document the Admin already reads shows "Readable in Library" instead of Inspect. Inspect and Withdraw each open a reason dialog: a required reason with a 0/1000 counter and the consequence stated at the decision point.
  - **Inspection view.** A dialog with Reason, Shared with (names) and Open until, above the read-only document.
  - **Withdraw.** The confirming button uses the danger colour.
- **Publication changes and governance in Knowledge**
  - **Reviews.** The decision island adds Approve for: Proposed readers (default) or Fewer readers, narrowing only.
    - A checklist for selected members; a member search limited to the department; a department or members for Everyone.
    - Incomplete selections show a neutral status line and keep Approve disabled.
  - **Reported problems in Reviews.** The island appears above the list only when the reviewer has reports, with View document and Dismiss. Direct Withdraw belongs only to Administration → Documents, including its reports island (decision 0024).
  - **My Contributions.**
    - Change readers and Withdraw document open request dialogs with a required reason.
    - A failed approved version shows "Not published" with one plain explanation, and Try again only for a temporary failure.
    - A directly withdrawn document shows the recorded actor role and reason. New direct withdrawals are Admin-only; existing reviewer provenance is historical, not rewritten.
  - **Reader.** The document reader offers Report a problem beside Download PDF.
- **Invitation composer** — The Invite form island accepts one or up to 20 email addresses in a multiline field. It previews each normalized address with a text status before sending, shows the ready/skipped count and blocks over-limit batches. Send names the number of recipients, then reports every outcome in the same island; a saved invitation whose email failed points to Resend in the list. The admin may clear an unsent draft. During sending, navigation and sign-out wait for completion, and the client requests a browser exit warning. The field keeps its visible focus treatment and an announced result summary. The island remains usable when it stacks below the list on a narrow workspace.
- **Home** — the first screen after sign-in ([decision 0022](docs/decisions/0022-home-start-page-and-reader-validity.md)); it replaced the sample My Work dashboard. Tabs: Organization (with Overview and All documents), Shared with me, Other documents when any exist, My Contributions and My reports. My reports lists the member's own Flow 4 reports with their status (Submitted, In Progress or Resolved) and an unread marker, and opens each case. Header actions are a quiet Refresh icon button, New draft and Create from PDF; Manage catalog appears only beside Collections in Discover, for catalog managers. Discover sections (Browse by type, Collections, Newly published) share one heading style: a title only (descriptive subtitles under Home sections and source tabs were removed at the maintainer's request on 22 November 2026; error, empty-state, warning and privacy copy stays). A member waiting for a department sees a note that only organization-wide documents are readable.
- **Private Notes** — a note-list island (sidebar tone, search, new note) beside an editor island with an "Only you" chip, save state, Contribute copy and Save. Below 760px of workspace width only the list or the editor shows, with Back to notes.
- **Knowledge** — Home as a searchable publication list; My Contributions as a separate list with a detail island (status, reviewer note, metadata, clickable saved-content versions, Open draft). The draft editor's History also opens those versions in a read-only text/PDF dialog; submission status is attached to the saved version it reviewed. New shared draft asks only for the content source and title; the draft editor is a document island beside a "Before you submit" island where each sharing field appears once — the derived owner line ("Owned by you · reviewed by {primary department}", decision 0014; older servers still show a department select), a single "Who can read it" search picker followed by the derived reviewer authority (Organization audience → Organization reviewer; Department / Groups → responsible-department reviewer; no per-person or deny entries), and team/project tags folded into Advanced; there is no classification control. Selecting Organization warns when no active Organization grant exists. The publication scope is derived from the chosen readers (organization audience → Organization, department audience → Department, groups only → Organization unless narrowed to the responsible department) and shown as text; Reviews opens on a Linear-style grouped list (REV-02: Needs review / Approved / Rejected, each row code · status icon · title · version · department chip · author · date, with a text filter and group display options; the decided groups are the reviewer's own read-only history), and opening a Needs review row shows the review detail (REV-03 for notes/drafts, REV-04 for PDFs): one island with a breadcrumb bar (Reviews > code and title, position n / m and next/previous), the submitted document on the left (a reading column, or a PDF toolbar with file name, size, Download and Open in a new tab above the browser PDF viewer) and a 340px side panel with Properties (version, author, submitted date), Submitted details, the note to the author and a pinned Reject/Approve footer whose confirmation stays in place (Approve or Reject only; approval moves the exact snapshot into preparation). See decisions 0010, 0013 and 0015.
- **Published knowledge search and reader** — Home search presents authorized publications as a dense, responsive list with document identity, type, owner, exact version, Valid until ("No expiry" when unset) and status. Search matches title, document code, owner department and summary only within the server-authorized publication set. Opening a result shows a compact information island beside the document surface, borrowing the useful split of established QMS readers without their blue chrome, ratings or feedback clutter. The information island shows Type when set (no Topic, decision 0025), Version as text (a selector only when more than one version can be chosen; "Not recorded" for older publications), one status vocabulary (`Current`, `Expires in N days` within 30 days of Valid until, `Expired`; `Upcoming` only for older snapshots with a future effective date), Valid until when set, Readers in plain words, owner department, published date and a short summary. There is no effective date and no reviewer name (decision 0022). The viewer bar has one Download action and a disabled Report an issue placeholder; when reader AI is available it also has a violet **Arden AI** action (the shipped Arden mark, Ctrl J) that opens a side island beside the document: a task choice, then Summary / Ask tabs (Explain a selection stays disabled as Coming later), AI-generated labels, compact page/source chips and Close/Escape back to Arden AI; document information steps aside while it is open and below 980px the island stacks above the document ([Reader AI side panel](docs/engineering/reader-ai.md#reader-ai-side-panel--accepted-20-november-2026)). Published PDFs use the custom PDF.js toolbar rather than the browser toolbar. Classification appears only when it is `Confidential` or `Restricted`. Historical versions remain subordinate to the current version and receive an explicit expired warning. The live server may show only the current version until its authorized history contract supplies older snapshots; the UI must not invent history.
- **Ask Arden** — a Linear-style sparse agent canvas. It replaces the normal workspace top bar with a 42px conversation header; the empty state centres a compact composer over a nearly invisible Arden watermark, followed by an indexed-knowledge chip and three starter cards. The active thread keeps the same narrow reading column and docks the composer at the bottom. Prompts use the live permission-aware RAG endpoint. Answers render the Markdown structure the model writes (headings, bullet and numbered lists, bold, italic and inline code) instead of showing its characters; Ask this document answers use the same rendering. The answer action row contains **Copy**, **Good response**, **Bad response** and **View sources**. Ratings can be changed or cleared. Company ratings persist with the owner's answer turn. Private feedback saves the score separately from the session-only discussion. Active System Admins can open the aggregate weekly report from the workspace chooser. **View sources** opens the validated passages for that answer in a panel (an overlay below 900px and inside the right sidebar). An explicit source number in the answer opens the corresponding passage. **Close** or Escape returns focus to the action or source number that opened it. The Company **Open in document** action rechecks access and highlights the cited quote in the reader. **History** opens a popover under the header button (design option B, same date): a title search (titles only), the owner's latest 50 chats grouped Today / Yesterday / Previous 7 days / Older with their last update time, the open chat marked, loading/empty/no-match/failure-with-Try-again states, Arrow keys between rows and Escape or a click outside to close; on phones it spans the header. Insufficient evidence and service failures are shown honestly without fabricated citations.
- **Phones (<640px)** — a compact status island and menu button at the top, and a bottom tab island (Home, Ask, Notes, Reviews). The menu drawer keeps Administration, every other destination and sign-out.

## Knowledge-context naming refinement (23 November 2026)

The private workspace/root/navigation label is **Private**. Its right Ask Arden sidebar
shows the saved note currently open as the only source. Switching notes or editing the
note resets the sidebar. PDF imports contribute the text saved in the note. The
[context contract](docs/engineering/knowledge-source-contexts.md) records the
organization opt-in and source restrictions.
The disabled attachment plus and publication-version dropdown are removed from
chat. There is no source/version selector. Company AI uses the current indexed
publication from Published date under [ADR0030](docs/decisions/0030-published-date-ai-sources.md).

## Knowledge Maintenance surfaces and motion (Flow 4, 22 November 2026)

Requested by the Flow 4 owner. This section covers presentation only; flow order, permissions and API contracts are unchanged.

- **Case workspace:**
  - **Document column:** comes first. A header with Back, the title, and a meta line (status chip, "Reported on Version N" when the readable version list includes it, case ID), followed by the report.
  - **Layout:** a quiet canvas with no boxed islands. A large title and a three-step status journey (Submitted → In Progress → Resolved) lead the page, the reader's report reads as a pull-quote, and hairlines separate sections. The case rail is one raised, sticky card (panel radius, soft shadow, faint top highlight); its sections stay borderless inside it.
  - **Version changes:** a section with a pager labelled "{earlier} to {later}", Reported/Current tags, and the current shortcut. Diff rows are tinted, with visible `+ Added` / `− Removed` labels and foldable unchanged context.
  - **Findings:** a section with a run-state chip, a thin progress bar while queued or running, citation chips, and a scope line naming the exact versions. Findings show only to the assigned reviewer.
  - **Case rail:** runs in decision order (claim, conversation, decision, reassign, related cases, audit timeline). The decision has one primary action per state. "Record published outcome" becomes primary only when the publication proof applies and a publication is linked; pending, upcoming and rejected proofs each state what blocks confirmation.
- **Lists and dialogs:**
  - The queue and My reports mark unread work with a violet dot that is also announced as "Unread". Case IDs stay visible in full, as muted monospace.
  - A failed case action (a stale revision, a changed publication, a network error) shows an inline alert at the top of the case rail and refreshes the case in place. Typed notes stay; only a case that fails to load shows the full "That case is unavailable" state.
  - The report dialog shows a version chip, the required field first, an optional "Location" row, and Cancel. Success shows the full case ID.
- **Interaction feel (workspace-wide):**
  - Hover changes tone only, and is gated to fine pointers. Press scales to 0.97 (0.985 for rows and cards). Focus glows in the violet accent.
  - Entrances use the existing `--arden-motion-*` and `--arden-morph` tokens, animating transform and opacity only (accordions also animate rows). Keyboard and very frequent actions stay instant.
  - Under reduced motion, everything becomes opacity-only or static.

## Local Collection refinement (KM2, 19 November 2026)

The accepted [flat Organization folder decision](docs/decisions/0026-flat-organization-collection-placement.md)
supersedes the older Topic/curated-bundle directions above. Home keeps its entry
position. Shared Collection management separates a compact Name*/Allowed types*/
Description form from one-document Move (including Unassigned), with compatible
destination filtering. Only Org Admin manages it; Authors have no Collection picker.
Archive explains that documents return to Unassigned and stay published. Legacy
unconfigured folders say Setup needed; archived folders are read-only. Keep Island
tokens/covers, visible exits, protected unsaved edits, announced errors and keyboard
focus restoration. Browser checks and remaining native/live boundaries are in
[P3B.3 evidence](docs/evidence/2026-11-19-knowledge-organization/README.md#km2-p3b3--collection-management-ui).
Topic controls are removed from affected Home browse/filter/current-reader paths;
frozen metadata is preserved.

Local P4A Home composition supersedes the old Discover/All-documents tab grouping:
Organization holds the common Overview, All documents and Unassigned; Shared with
me holds permitted Department/Selected documents. Other documents is a conditional
compatibility view for unclassified legacy sharing. My Contributions stays in the
tab group; Private notes is a separate owner-only workspace entry. Each source has
its own search/filter/loading/error state. Counts appear only after successful
reads, never as fabricated zeroes during failure. Reader Back restores the source,
filters and document focus. Tabs support arrow/Home/End navigation. Preserve Island
tokens/covers and wrapping actions at narrow widths, not a second theme.
[P4A evidence](docs/evidence/2026-11-19-knowledge-organization/README.md#km2-p4a--home-composition)
is local synthetic-fixture evidence, not a deployed/signed-in/native acceptance.

## Private-note draft contract

Keep drafts separately for each note in shell-owned session memory. Switching notes, creating another note or navigating to Home must preserve existing drafts. Saving applies only the selected draft; other drafts survive. Show unsaved state in both the editor and the list. Exiting with unsaved work opens an accessible discard confirmation; refreshing/closing gets the browser's unload warning. Switching the demo member identity also guards unsaved private drafts. Exiting resets notes, drafts and organization state.

This is not persistence, authentication, offline synchronization or authorization. Do not write private notes to browser storage to make a demonstration look persistent.

In the sample knowledge workflow, an unchanged working copy that was approved shows **Published · Sample**; editing it may start a new reviewable version and never edits the published snapshot in place.

## Approved brand artwork reference

The selected **Flux Circle — Equal rhythm spacing (option 2, v15)** artwork is delivered in [the final logo package](brand/arden-logo-final/README.md), with vector/raster variants, selection metadata, checksums and the Sora licence. The artwork was selected on 15 October 2026. This export package does not replace the current application icons, favicons or installer assets; adopting it in shipped surfaces requires a separate implementation and visual verification.

## Invitation email

Requested by the user on 7 November 2026. The organization invitation email keeps the Living Archive charcoal, warm white, amber and jade palette used by Arden's web entry screens. Center the current web Arden mark above the message, then present the invitation heading, explanation, primary action, expiry, fallback link and privacy note in that order. Embed the mark in the email itself and provide `Arden` alternative text; do not rely on a remote image URL. Keep the plain-text alternative and make the HTML card fit narrow phones without horizontal scrolling. This changes the invitation email presentation, not its token or acceptance rules.

## Future graph surface (planned)

The planned graph home keeps the network dominant within its workspace, with a restrained dot grid, Zoom/Fit controls and a Knowledge Pane for the selected item's identity, provenance, freshness, context and connections. Shared items use solid-outline circles, personal items dashed-outline circles and external items squares, with neutral fills, visible labels and a legend. Selection uses the violet accent with a visible halo. At narrow widths provide a selected-item summary and a navigable item list; canvas interaction needs a keyboard-accessible alternative. These are requirements for future work, not a claim that the preview ships a graph.

## Account-entry password guidance

Requested and refined by the user on 7 November 2026. New-account password entry on registration, invitation and Google setup uses the authentication screens' colours (Island since 22 November 2026). Show exactly three live, text-labelled checks: at least 8 characters, at least one uppercase letter and at least one special character. These are required for new-account setup at both the form and API. Use sage for met, coral for unmet and a neutral state before typing. The Show/Hide control works by keyboard and does not submit the form. Keep technical input limits out of the checklist. Account-setup rejection stays non-enumerating and leaves the entry available to revise.

## User-facing copy

Approved by the requesting maintainer on 30 October 2026 (ARD-74). Prefer short task labels and statuses over explanations of implementation. Delete copy that repeats a title, field, action or status; do not replace it with longer prose or a tooltip. Avoid server/API, snapshot, grant, indexing, hash and schema vocabulary in routine user-facing text. Internal API/schema identifiers remain unchanged.

Keep essential consequences at the decision point: unsaved work being lost, a private original remaining private when copied, and access/assignment changes. Keep accessible names, concrete validation and file limits, and visible Demo/unavailable labels. Approval/preparation/publication and uncertain/failed/successful outcomes must remain distinct. Show errors without raw internal exception text. Apply the same copy to shared web/desktop UI; do not change permissions, immutable submissions or retry identity to shorten a message.

## Cancellation and exit paths

Maintainer correction accepted on 30 October 2026: concise copy must not remove or obscure the way out of a task.

Editing and creation surfaces must offer a visible Cancel, Back or Discard action, not require refresh or sign-out. Explicitly discarding unsaved document/note/group content asks once and keeps a Keep working route; backing out must not delete saved content, withdraw a submission or change permissions. Discard only the selected note's edits (remove a never-saved local note), preserving every other note draft. Disable local discard while its save is in flight; an uncertain server result is not proof that a completed write was undone.

Chat offers Clear for an unsent prompt, Stop waiting for the current response, and an explicit New chat action with confirmation before clearing the session-local conversation. Stop waiting dismisses the local wait and ignores late responses; it does not promise to cancel provider work or cost. Composer geometry must be independent of optional copy: keep send actions trailing even when status/help text is absent.

## Accessibility and verification

Text meets 4.5:1 on its surface (text.muted is tuned to 5.1:1; border.strong gives inputs 3.1:1). Focus is a 2px accent-hover ring with 2px offset; inside the status island the island border shows focus. Use real buttons, links and labelled inputs; icon-only buttons have accessible names. Keep demo/unavailable labels visible so reduced copy never implies live functionality. Native dialogs keep focus inside and restore it on dismissal.

Check 1440px desktop, 1024px, the 640–899px icon rail, 375px/320px phones, long content and 200% zoom. Check island search/Esc, toasts, detail islands open/close, collapsed navigation, the Ask Arden panel docked (1100px and wider), floating with a scrim and as the phone sheet, including Escape and focus returning to the Arden mark, note switching and keyboard access. Shared UI must be checked in web and Electron; a successful build alone does not prove native behaviour.
