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

F22 writing actions send a bounded text selection (or the current note body when no text is selected) through Core to Arden-AI. The client supplies this text, so Core cannot prove it came from a shared draft rather than a private note. The same organization opt-in therefore gates all writing actions. Core checks active membership before and after inference, returns only validated output, and does not persist the input or log its text. The UI requires explicit Replace for edits; Explain remains a chat response. See [F22](../product/writing-actions.md).

## Verification

F13-SC4 covers exact-note authorization, revision freshness, quote validation,
sidebar routing and ignoring replies from a previous context. F13-SC5 covers
signed-in web and native verification and a paired AI smoke test with synthetic
data in an opted-in organization.

## Answer actions

Ask Arden and its right sidebar show Copy, Good response, Bad response and View
sources under each available answer. Copy preserves readable text and list
structure. View sources lists all validated passages for that answer. Numbered
inline references open their exact passages when the answer supplies a valid
number. Company source links still use the governed reader.

Company ratings belong to a single answer turn in the owner's conversation.
`PUT /api/v1/organizations/:organizationId/ai/conversations/:conversationId/turns/:turnId/feedback`
accepts `{ "feedback": "GOOD" }`, `"BAD"` or `null` as the value. The owner can
replace or clear a rating and see it again in History. Migration 0066 gives the
runtime update access only to the rating column under the existing conversation
owner policy.

Private conversations remain session-only. The 24 November decision allows a
member to send the rating alone. The question response issues a random, signed
feedback token valid for 24 hours. The token is scoped to the current member and
organization and contains no document or member identifier. The feedback endpoint
(`PUT /api/v1/organizations/:organizationId/ai/private-feedback`) checks that
token and active membership, then accepts only the token and rating. Migration 0067
stores one random vote key, a nullable rating and the timestamp of the latest
change. Repeating the same request preserves the timestamp. Clearing a rating
excludes it from the report. There is no foreign key to a user, organization,
conversation, file or document. Feedback submissions carry no private text.

From the workspace chooser, an active System Admin can open **Private AI
feedback**. `GET /api/v1/system/analytics/private-feedback` returns only counts
of current Good and Bad ratings for the last 12 UTC weeks, including the current
week. The UI computes their total and Good rate. A changed vote is counted in the
week of its latest change. The report returns no user, document, per-vote details,
or conversation content.
