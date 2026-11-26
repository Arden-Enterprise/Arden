# F22: Writing actions in editable text

- Spec revision/date: 4 / 2026-11-25
- Decision state: accepted for the requested Arden UI and Core integration
- Originator and decision owner: requesting maintainer in this task; individual attribution unknown
- Record author: Arden implementation agent
- Approval evidence: maintainer specified the three actions and asked to implement the Arden UI on 2026-11-24. On 2026-11-25 the maintainer requested a smaller menu beside the selection with standard clipboard commands. Later on 2026-11-25 the maintainer asked for basic text formatting (bold, italic and similar, no more) in the Private note selection menu, shown with the AI skills in a Notion-like box.
- Source baseline: Arden `origin/staging` `871e96012ec519acc6002e537bfea2872e46cc21`; approved Arden `origin/main` `9fa3d34a19a559318eff87b4487f2113e6ee5a49`; Arden-AI `origin/main` `34fc6f9d639215c8b23ea7da93e1d1d4db979dbe`
- Affected repositories: Arden; consumes Arden-AI's merged writing-action contract
- Related Linear issue: none found in available task context; tracking remains to be assigned

## Scope and paths

Members editing an owner-private note or a shared text draft can select text to open Improve Writing, Reformat and Explain in a compact menu beside the selection. Right-click or Shift+F10 opens a context menu with Cut, Copy and Paste in addition to available AI actions. Cut and Copy require a selection. Paste replaces the selected range or inserts at the caret. Web paste uses the browser clipboard permission and pastes plain text. The desktop menu invokes the native paste command for the focused editor. When the browser blocks clipboard access, the menu shows the keyboard alternative.

In Private notes the selection menu also shows Bold, Italic, Strikethrough and Inline code above the AI actions, with Ctrl+B, Ctrl+I, Ctrl+Shift+S and Ctrl+E shortcuts. Notes are Markdown text, so each format adds or removes Markdown markers on every selected line, outside surrounding spaces and list, quote or heading prefixes. Formatting is local editing and is available even when AI writing is disabled. A note with no selection uses its full body for AI actions. The note toolbar also opens those actions. The rich document editor requires an explicit text selection for AI actions. Published reader selection Explain remains deferred under RA-06.

The UI sends only the selected text or current note body to Arden Core. Core checks active organization membership, organization AI opt-in, the request shape and the bounded Arden-AI response. It checks membership again after inference. Because renderer-provided text has no verifiable provenance, the existing `ARDEN_PRIVATE_NOTE_AI_ORGANIZATIONS` opt-in gates **all** writing actions, including shared drafts. The deployment owner must approve the configured inference destination and handling before enabling an organization. No text is stored by this route or included in Core error logs.

Improve Writing preserves meaning, formatting, links, code and inline structures while improving clarity and correctness. Reformat changes structure without changing source words. Explain returns a short chat response and never edits the page; page explanations include an exact quote from the supplied note. Improve and Reformat display a suggestion and require an explicit Replace. A stale editor body cannot receive the replacement. In the rich editor, edits to marked text or selections spanning blocks are disabled when exact safe replacement is unavailable; Explain remains available. No AI action runs simply from opening the menu.

## Acceptance and evidence

| ID | Observable requirement | Current evidence | Remaining |
| --- | --- | --- | --- |
| F22-AC1 | The compact menu opens beside the selected text and stays inside the viewport. Right-click and Shift+F10 offer Cut, Copy and Paste as well as available AI actions. Demo notes retain their native context behavior. | Both editors checked in Electron at normal size, plus a 400 px viewport for notes and focused UI tests for clipboard commands | Signed-in acceptance and system clipboard verification |
| F22-AC2 | Improve/Reformat return a preview; only explicit Replace changes selected text, leaving outside text intact | Focused UI test; rich editor uses captured ProseMirror range and body fingerprint | Browser acceptance for rich formatting and multiline text |
| F22-AC3 | Explain answers in panel without editing and cites an exact note quote for page scope | Focused UI and Core tests | Provider-quality check |
| F22-AC4 | Unauthenticated, nonmember, unapproved organization, malformed (including non-string status), stale-access and invalid-output paths do not release content | Focused Core, UI API parser and desktop allowlist tests | Live provider and deployment configuration check |
| F22-AC5 | Empty/unchanged, loading, retry, Escape and stale selection are understandable and safe; changing or discarding the page draft clears its previous writing result | UI state and cancellation implementation; focused no-change, stale-response, discarded-body and Escape tests | Keyboard, small-screen and native walkthrough |
| F22-AC6 | Private note selection menu toggles Bold, Italic, Strikethrough and Inline code Markdown on the selected lines, keeps the text selected and shows the active state; works without AI writing | Focused helper and editor tests | Visual walkthrough in web and desktop |

## Delivery

The original Arden UI and Core integration reached `staging` in PR #76. Revision 3 updates the menu and clipboard commands on `fix/editor-action-menu`, based on `staging` `6c9a93d`. Revision 4 adds the Private note formatting row and Notion-style menu on `feat/notion-selection-menu`, based on `staging` `c62b2f6`.
