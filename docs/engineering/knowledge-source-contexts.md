# Company and Private document AI contexts

The 24 November 2026 decision limits the Private sidebar to the document
currently open. The Company path follows the
[Published-date decision](../decisions/0030-published-date-ai-sources.md).

## User-facing contract

- Full Ask Arden searches all current, eligible Company publications the actor
  may read, including Organization-wide and restricted Target Readers documents.
  The sidebar on Company surfaces uses the same source policy.
- In **Private**, members open a saved document and click Ask Arden to use the
  right sidebar. The note title and cited excerpts identify the source.
  The root, collections, Trash and Archive prompt the user to open a saved note.
  Edits must be saved before asking. Each question stands on its own.
- Private prompts, answers and citations clear when the member switches notes,
  edits the note, changes saved revision, or leaves Private. An outstanding
  reply from the previous context is discarded.
- PDF imports participate through the text saved in the note. Original PDF
  storage, scans and diagrams that lack extracted text are outside this path.

## Backend contract

The [private note question endpoint](../features/private-notes-organization/API.md#routes)
authorizes the exact owned, active note and revision. It reads the verified
stored text, selects bounded passages within the same note and uses the existing
Arden-AI exact-document generation contract with empty history. It verifies each
quote against the supplied passages and confirms current access and revision before
responding. An empty note or insufficient evidence is reported in the same context.
The route requires no new DB migration, shared retrieval, or re-index.

Private note answering is off by default. Set `ARDEN_PRIVATE_NOTE_AI_ORGANIZATIONS`
to approved organization UUIDs after each organization approves the configured
inference destination and its data handling. The sidebar discloses the handoff
to the configured AI service. The current Arden-AI OpenAI reader adapter sends
the question and selected excerpts to OpenAI with response storage
disabled. The Core handler logs only request and error identifiers. Review the
deployment's provider and observability settings before enabling a real tenant.

## Verification

F13-SC4 covers exact-note authorization, revision freshness, quote validation,
sidebar routing and ignoring replies from a previous context. F13-SC5 covers
signed-in web and native verification and a paired AI smoke test with synthetic
data in an opted-in organization.
