# Company and Personal AI contexts

Decision state: accepted product direction, 23 November 2026.
Implementation state: Company simplification and UI cleanup local; Personal path planned; not deployed.
Originator/decision owner: requesting maintainer. Record author: Codex at their direction.
Approval: the maintainer explicitly selected Company-only Ask Arden and Personal-only
sidebar use in Private after being asked whether global Ask should include both.
Inspected source: Core staging `d47ddc5`; Core main `9fa3d34`; Arden-AI main `e56a89b`.
Owning feature: [F13/F14](../product/graph-ai-and-work.md#f13-grounded-agent).

## User-facing contract

- Full Ask Arden searches all eligible Company knowledge the actor can currently
  read: Organization-wide and restricted Target Readers publications together.
  There is no Organization/Department/Shared-with-me source picker in chat.
- The sidebar while the member is in **Private** uses only that member's private
  knowledge in the current organization. Other workspace surfaces use Company.
- Company retrieval never includes personal originals. Personal retrieval never
  uses Company material as a fallback. An empty, unindexed or failed private source
  is reported honestly in its own context.
- These are implicit application contexts, fixed for a conversation. Switching
  surfaces uses separate conversations/state rather than changing an existing
  transcript's source kind. Returning to a context must not mix in late replies,
  citations, drafts or history from the other context.
- `Private` replaces the visible `Private Notes` workspace/root/navigation name.
  This naming change does not claim that private PDF upload is implemented.
- Remove the disabled attachment `+` from the shared chat composer. File upload
  belongs to Private's document-management flow, not an unimplemented chat button.
- The version dropdown and its CURRENT/UPCOMING/COMPARE modes are removed by
  [ADR0030](../decisions/0030-published-date-ai-sources.md). Company AI uses the
  current indexed publication, available from Published date. Effective Date no
  longer controls selection, metadata inputs or reader status. Expiration remains
  optional and inclusive. Superseded versions are never revived as a fallback.

## Current implementation and gaps

| Boundary | Audited behavior at the inspected revisions | Required work |
| --- | --- | --- |
| Company Ask | `GovernedAnswering.sources` + `listAuthorizedAiSources` authorize eligible indexed publications; Core supplies the generation allow-list to the separate AI service. | Retain this path; verify shared and common publications participate without a UI reader-scope filter. |
| Sidebar | `AgentPanel` always calls the same `useArdenChat`/Company endpoint and receives no private context. | Introduce a genuine Personal path before presenting the sidebar as Personal AI. |
| Private storage | Owner-private text notes, immutable versions, folders, Favorites and Trash exist. | Add private PDF upload/read/replace and explicit processing readiness. Existing shared PDF upload is not a private upload API. |
| Indexing | Current publication generations and citations reference shared/reviewed versions. | Add private version/generation identity; do not fabricate a shared publication or reviewer approval for a private file. |
| History/citations | Company history is owner-private within the organization but its evidence is Company publication evidence. | Bind history to source kind and add owner-authorized private version citations/navigation. |

## Backend boundaries

Core continues to own authentication, organization membership, private ownership,
source eligibility, durable jobs, current-version activation and conversation
persistence. Arden-AI continues to own compilation, chunking, embeddings and hybrid
retrieval/generation. Reuse that pipeline; do not add another RAG engine in Core.

Private retrieval must be calculated from the authenticated actor and private
workspace, not from a client-supplied owner ID or the visible tab. Private metadata,
files, chunks, citations and history retain that boundary, including against Org
Admins. Only eligible ready generations reach the model. Provider/observability
data-flow and consent must follow the existing external-provider policy.

Design the durable request contract with a server-bound `COMPANY` or `PERSONAL`
source kind. Keep Company routes backward compatible. A dedicated private route
can reuse orchestration, but it must resolve only private versions. The exact
route/schema and migration remain implementation work, not existing endpoints.
Existing conversations are Company conversations; never reinterpret them as
Personal. Persist the source kind with each new conversation and reject attempts
to continue the same conversation under another kind.

For Personal ingestion: authenticated upload/save creates an immutable private
version; a bounded job prepares its generation; completion verifies that version
and owner are still eligible before activation. Updates retire the previous
generation. Trash, purge, account/membership loss or version replacement exclude
sources immediately; later index cleanup must not revive them. A Personal source
needs no organizational review. A contribution remains an independent reviewed
copy and does not publish or share the private original.

PDF support is text extraction under the existing size/format safeguards. Image
understanding/OCR is outside this agreed scope; unsupported/image-only documents
must not be labelled AI-ready or answered using invented text.

## Phases and observable acceptance

| ID | Deliverable | Required evidence |
| --- | --- | --- |
| F13-SC1 | Context/audit contract and Private/composer naming cleanup. | Source audit; navigation/composer tests; clear implemented/planned labels. |
| F13-SC2 | Private PDF upload/read/replace, version identity and processing states. | Owner allow/deny, cross-organization denial, invalid/image-only PDF, retry and unchanged independent contributions. |
| F13-SC3 | Private indexing using the existing AI service. | Incomplete/stale generation exclusion, update/trash/purge races, exact hash/version, no Company fallback or shared-index mutation. |
| F13-SC4 | Personal sidebar answering, history and private citation navigation. | Context-bound conversation enforcement; owner isolation; late reply/context-switch denial; exact private version citation and revoked access. |
| F13-SC5 | Regression/evaluation and staging integration. | Company still retrieves permitted common/restricted publications; Personal excludes others; approved migration backup/rehearsal; signed-in/native checks and phase screenshots. |

This document records the accepted direction and implementation boundaries. It
does not authorize shared schema changes, provider spend, publication or release.
