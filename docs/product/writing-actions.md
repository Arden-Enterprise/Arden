# F22: Writing actions in editable text

- Spec revision/date: 2 / 2026-11-25
- Decision state: accepted for the requested Arden UI and Core integration
- Originator and decision owner: requesting maintainer in this task; individual attribution unknown
- Record author: Arden implementation agent
- Approval evidence: maintainer requested Notion-like selection actions, specified the three prompts, then explicitly asked to implement the UI in Arden on 2026-11-24
- Source baseline: Arden `origin/staging` `871e96012ec519acc6002e537bfea2872e46cc21`; approved Arden `origin/main` `9fa3d34a19a559318eff87b4487f2113e6ee5a49`; Arden-AI `origin/main` `34fc6f9d639215c8b23ea7da93e1d1d4db979dbe`
- Affected repositories: Arden; consumes Arden-AI's merged writing-action contract
- Related Linear issue: none found in available task context; tracking remains to be assigned

## Scope and paths

Members editing an owner-private note or their shared text draft can select text to open Improve Writing, Reformat and Explain. Right-click on a selection opens the same menu. A note with no selection uses its full body for those actions; the note toolbar also opens the page action. The rich document editor requires an explicit text selection. Published reader selection Explain is a separate, still deferred RA-06 capability.

The UI sends only the selected text or current note body to Arden Core. Core checks active organization membership, organization AI opt-in, the request shape and the bounded Arden-AI response. It checks membership again after inference. Because renderer-provided text has no verifiable provenance, the existing `ARDEN_PRIVATE_NOTE_AI_ORGANIZATIONS` opt-in gates **all** writing actions, including shared drafts. The deployment owner must approve the configured inference destination and handling before enabling an organization. No text is stored by this route or included in Core error logs.

Improve Writing preserves meaning, formatting, links, code and inline structures while improving clarity and correctness. Reformat changes structure without changing source words. Explain returns a short chat response and never edits the page; page explanations include an exact quote from the supplied note. Improve and Reformat display a suggestion and require an explicit Replace. A stale editor body cannot receive the replacement. In the rich editor, edits to marked text or selections spanning blocks are disabled when exact safe replacement is unavailable; Explain remains available. No AI action runs simply from opening the menu.

## Acceptance and evidence

| ID | Observable requirement | Current evidence | Remaining |
| --- | --- | --- | --- |
| F22-AC1 | Selection and right-click expose exactly the three actions in private notes and shared text drafts; native context menu remains available when AI actions are disabled | UI implementation and focused private-note tests | Genuine Electron and signed-in browser walkthrough |
| F22-AC2 | Improve/Reformat return a preview; only explicit Replace changes selected text, leaving outside text intact | Focused UI test; rich editor uses captured ProseMirror range and body fingerprint | Browser acceptance for rich formatting and multiline text |
| F22-AC3 | Explain answers in panel without editing and cites an exact note quote for page scope | Focused UI and Core tests | Provider-quality check |
| F22-AC4 | Unauthenticated, nonmember, unapproved organization, malformed (including non-string status), stale-access and invalid-output paths do not release content | Focused Core, UI API parser and desktop allowlist tests | Live provider and deployment configuration check |
| F22-AC5 | Empty/unchanged, loading, retry, Escape and stale selection are understandable and safe; changing or discarding the page draft clears its previous writing result | UI state and cancellation implementation; focused no-change, stale-response, discarded-body and Escape tests | Keyboard, small-screen and native walkthrough |

## Delivery

Implementation branch `feat/editor-writing-actions` includes Arden `staging` `871e960`. Workspace typecheck and relevant Core/UI regression tests pass locally. The Arden-AI endpoint is merged to its main; Arden UI/Core has not been merged or deployed. This record does not change reader AI RA-06, review, publication or storage contracts.
