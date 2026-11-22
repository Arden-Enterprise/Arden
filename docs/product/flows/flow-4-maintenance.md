# Flow 4 — AI-assisted Knowledge Maintenance

**Decision state:** The Flow 4 owner confirmed the product journey on 2026-11-17. **Delivery:** As of 2026-11-20, the local branches have a disposable PostgreSQL and signed-in browser/API checkpoint. The source is local and unpublished. One opt-in live provider call passed through the local Arden-AI route with synthetic data. The reconciled build passed a disposable staging upgrade and one signed-in Web/Electron case walkthrough. Shared release remains pending. [Verification evidence](../../features/knowledge-maintenance/STATUS.md)

[Flow index](README.md) · [Diagrams and step catalog](flow-4-sequences.md) · [Implementation status](../../features/knowledge-maintenance/STATUS.md) · [Glossary](../../../GLOSSARY.md)

**Integration checkpoint, 2026-11-19** — Staging `af28915` is merged. Maintenance SQL is `0039` through `0049`. One reader report action remains, and an admin can import open governance reports through that writer. The inventory check passed 49 entries. The disposable database `arden_test_flow4` replayed the manual report, claim, reassignment, no-change, and revoked-history path under `arden_runtime`, then one operator import, the read-only Closed filter, stored pairs through version 5, and one exact **UPDATED** confirmation. An isolated web session on that database walked those paths with synthetic accounts. The dev-1 app schema still diverges at `0024` and was not changed. Electron was not run. [Intake decision](../../decisions/0028-maintenance-report-intake.md)

## Local behavior update, 2026-11-20

- **Reported problems → Closed** shows retained dispositions in pages of 200, with **Load more** when a next cursor exists. The existing governance scope applies on each page.
- A fresh report stores the exact publication pin and an unread notice for eligible independent reviewers in the same transaction. Maintenance routes these updates through **Reviews → Maintenance** and **Home → My reports**. Staging's general notification bell keeps its existing event scope. Active admins receive an assignment exception when no reviewer matches. Import keeps its distinct provenance.
- Flow 4 records a withdrawal only when the linked Flow 2 request has approval and its exact target publication has actually been withdrawn. An eligible organization-wide reviewer can approve through the existing Flow 2 route.
- The analysis action includes the reported version and the selected comparison pair, with duplicate versions removed. Findings open the exact cited original under the current access rules. The optional v2 provider adapter uses only exact hashed evidence from the assigned case and validates citations before committing findings. Core configuration uses `ARDEN_MAINTENANCE_ANALYSIS_ADAPTER=http-provider` with the normal service URL and token. Controlled and local modes remain available for synthetic verification.

## Purpose and boundaries

A reader who finds incorrect guidance can report the exact version and follow the outcome. A scoped reviewer can compare versions, gather evidence and decide what to do. Flow 2 retains responsibility for approving and applying publication changes. Flow 4 verifies the real outcome and records the human decision. The scope is published organizational knowledge, with one primary version per case. Ordinary comments and ratings, automatic recertification, standalone document-wide audit browsing, external research and autonomous document changes are separate product work.

Use **Home → My reports**, the reader's existing **Report a problem** action, and **Reviews → Maintenance** beside publication approvals. Home is the start page. The reader shows published date, version and validity. New forms follow the current date model. Historical snapshots can still carry a future applicability date and appear **Upcoming**. Use Flow 2/Core's eligibility and activation rules to determine whether a correction applies. [Home and reader decision](https://github.com/Arden-Enterprise/Arden/blob/0eae5b8/docs/decisions/0022-home-start-page-and-reader-validity.md) · [Staging governance reader](https://github.com/Arden-Enterprise/Arden/blob/af28915/docs/decisions/0023-organization-admin-governance-access.md)

## Actor and data access contract

| Actor | Allowed behavior |
| --- | --- |
| Active reader | Report the exact published version they can currently read. Read and reply on their own case while eligible. A still-active reporter who loses document access sees only case ID and reporter status. An inactive member has no case access. |
| Eligible reviewer before claim | Start a scoped review or see cases routed to an active matching grant. View a minimal queue projection and authorized case progress. Claim a case when eligible. Queue access alone cannot reveal case-only source contents, restricted evidence, or internal findings. |
| Assigned independent reviewer | Read the pinned snapshot within the case purpose. Compare additional sources only where current read policy authorizes those exact versions. Run analysis, ask for information, request a remedy, record a decision and verify closure. |
| Author of pinned version | Provide requested context and use normal Flow 2 author actions. Exclude the author from claiming or resolving their own version, including when the author is an admin. Grant only a narrow action/projection for an author handoff. |
| Organization Admin | See and route assignment exceptions, reassign to an eligible independent reviewer and inspect permitted audit history. The role alone grants neither ordinary document access nor unrelated analysis evidence. Apply the same independent-review rule on case resolution. Any emergency withdrawal belongs to the Flow 2 contract. |
| Core and Arden-AI | Core authenticates, authorizes, stores and projects. Arden-AI receives the supplied authorized evidence for the specific run and returns validated findings. The AI service receives no business database credential or mutation authority. |

Recheck active membership, grant and assignment for reads, commands, runs, citation navigation, notification deep links and audit queries. Use the server actor and organization identity. Access to the primary snapshot is confined to this case. It never grants discovery or general chat access. Reject mixed-tenant identifiers before producing any derived data. Use the same unavailable response for unreadable and unknown resources. Make permitted queue/list counts and redacted responses safe before returning them to clients.

## User journeys and screen behavior

### F4-00 · Carry existing reports forward at cutover

- Review each existing report within its organization. Closed reports stay in governance history with their original disposition. Each eligible open report becomes one unassigned **Submitted** case with its original reference, exact version, reporter, text and timestamp. Preserve the source and audit trail, record import provenance and suppress new-submission notifications for imported cases.
- Route cases with verifiable evidence through the ordinary authorized queues and reporter view. Hold open reports with unverifiable exact evidence or routing facts for authorized review. Publication changes continue through Flow 2. A prior withdrawal does not close the Maintenance case automatically.
- Authorized governance users can see retained closed records in the read-only **Closed** filter under **Reported problems**. Show the original disposition under the existing governance visibility rules.

### F4-01 · Report or start review

- Keep one **Report a problem** action in the reader. When Maintenance is enabled, new submissions create a single version-pinned case through this action. Preserve existing governance records and audit history through the compatibility path. Open the existing dialog primitive, restore focus on close, and preserve scroll. Show the read-only title and version, require a description, and offer an optional page or passage and permitted comparison suggestion. Core validates exact publication and anchor before recording them.
- A scoped reviewer can **Start review** with a published version and an objective. Additional documents are optional comparison evidence. If multiple documents need decisions, open individual linked cases. Proactive cases need no member reporter.
- Submit uses a request idempotency key. A same-key retry from the same actor and organization returns the same case through a fresh projection. Same key and different payload yields a conflict. Independent reports remain separate, with authorized reviewer-only case links if useful. Show the case ID and **View in My reports** after successful report. If the version changed meanwhile, honor the original exact version only if access still permits it. Never silently bind the report to a replacement.
- Supported older clients allow one open report per member and document. An attempt while open receives the existing duplicate response. After closure, a fresh authorized submission may use the same wording.

### F4-02 · Route, claim and maintain ownership

- Derive the route from the reported publication’s governing review scope and responsible department. One authorized reviewer claims using an atomic compare-and-set. On a race, reload the visible case and show the permitted current owner or unavailable state. A queue row opening is read-only.
- Show **Unassigned**, **Mine**, and **All I can review** under Maintenance. While routing has no eligible owner, send the exception to Org Admin. On loss of an assignee’s authority, block actions immediately and surface **Needs reassignment** for admins. Preserve old assignment events. A previously claimed report stays **In Progress**. Do not re-route it based on the reporter’s department.
- Show unread case updates in **Home → My reports** for reporters and **Reviews → Maintenance** for reviewers. Each opens the permitted case. Notify eligible reviewers when work enters their queue, the author when requested to act, and the reporter at claim, request for information and resolution. Recheck recipient and current projection on list and open. Notification rows and previews contain only the fields safe for the recipient. Scope this experience to maintenance events.

### F4-03 · Compare chronological versions

- Open **Version changes** at the reported passage if one is available. List only authorized versions in the same document lineage from the reported version onward, oldest first, with reported/current/applicable/upcoming labels as warranted. Do not disclose counts, identities or content of unavailable intermediates. If the next browsable version is not adjacent in full history, label the two exact versions that are actually compared.
- Default pair is the reported version and the next available version. Offer **Previous change**, **Next change** and **Compare reported with current**. The shortcut uses the currently applicable version, not the newest future release. Do not silently change the active pair when a new version appears.
- Default view is a unified text diff with `+ Added` and `− Removed` labels and existing semantic success/danger tones. Collapse unchanged context with a keyboard-accessible expansion. Show both version labels, section or PDF page anchors and **Open original**. Highlight modifications as removal plus addition. Offer a side-by-side original view on desktop when needed, with stacked navigation on small screens.
- Use immutable text/source maps and deterministic diffing. Normalize layout-only line wrapping and equivalent line endings while preserving case, numbers, punctuation, meaningful whitespace and document structure. Start at the relevant section, fall back to the first changed section if the original passage cannot be mapped. Bound comparison work and give a clear unavailable/manual path for scanned, unsupported, very large or unmappable sources. A failed comparison must not imply unchanged text.
- Treat the diff itself as protected derived data. Check both source grants before fetch, compare and return. Following a citation or reopening a panel rechecks the original access context. Clear previously rendered diff/findings on access or actor change. Existing reader compare/AI calls are not a general history entitlement. Add a case-specific resolver and honor existing per-version authorization and lineage boundaries.

### F4-04 · Ask for context or analyze evidence

- Assigned reviewer can request more information. Show a separate reporter-facing message and reply entry point. Store the reply on the case and return the case to the reviewer’s attention. Until then the outer status remains **In Progress**. For a reviewer-started case, direct any questions to an authorized participant through the case path.
- **Analyze** first shows the pinned version, issue or objective, selected exact comparison versions, and optional bounded instructions. **Start analysis** enqueues a run. One active run per case. Return structured findings with exact source citations, what differs, evidence gaps and a suggested next step when supported. Treat user text and document content as untrusted inputs.
- Run states are queued, running, succeeded, failed or cancelled. Expose manual **Cancel** and **Retry** when allowed. Retry creates a new run after checking the selected versions again. If the worker stopped, permission changed or results arrive late after cancellation or reassignment, fence completion. Keep manual review available.
- Keep each run tied to its selected source manifest. On a newly available newer version, show the scope of the old result and offer compare or a fresh run. Failed, cancelled or unavailable evidence cannot block the human from selecting a supported manual outcome.

### F4-05 and F4-06 · Decide, hand off and close

- Require a short reporter-facing explanation on reviewer decisions and a reviewer rationale/evidence reference where appropriate. **No change needed** can close when a reviewer confirms why the report warrants no change. Requesting update or withdrawal leaves the case open and records a linked action for the author. The author submits through **Flow 2 → Submit replacement for review** or **Flow 2 → Submit publication withdrawal request**. If the author cannot act, an Org Admin arranges an eligible owner through current rules.
- A selected previously published fix may be linked if it is currently applicable, belongs to the right document lineage and addresses the problem. Record the exact linked version and reviewer explanation. An unrelated replacement, rejected request, failed indexing, superseded request or upcoming version does not satisfy closure. A withdrawal requires confirmation that the corresponding publication change actually applied. Re-read current Flow 2 facts inside the final decision, with race protection.
- The reporter status moves from **Submitted** to **In Progress** on first claim and from **In Progress** to **Resolved** only on human confirmation. Outcomes are **No change needed**, **Updated**, **Withdrawn**. A new instance of the problem opens a new linked case with its affected version. Resolved cases and prior events are read-only. Analysis state, case status and publication status are separate fields.
- A related-case link gives authorized reviewers context for separate reports. Every linked case keeps its own assignee, status, history and human-confirmed outcome. A shared publication outcome can serve as evidence for multiple cases when applicable. Confirm the outcome against each case separately and give each reporter their own explanation.

### F4-07 · Follow progress and audit history

- **Home → My reports** lists the reader's own cases through the reporter projection. In the case workspace, use **Case**, **Findings**, **Version changes** and **Audit history** alongside the pinned source. Keep the document first, maintain responsive reading and keep one primary action visible for the current state.
- Capture submission or import provenance, routing, claim, reassignment, reporter/reviewer communication, analysis lifecycle, decision, linked Flow 2 outcome and confirmation. Record actor or system, time, relevant version, action, outcome and safe message. Preserve the original report time separately from the import event. Capture the specific evidence relied on when closing, where available. Avoid recording routine tab opens as case events.
- Store an organization- and case-scoped append-only history atomically with each committed state change. Use an authorized paginated read endpoint to project events into the UI. Show reporters only allowed progress and public explanations. Authorized reviewers see the permitted timeline, while Flow 2 reviewer identities and decisions are shown only through an authorized case link. The ADR 0022 reservation for a broader approval audit view can be followed up with its own readership contract.
- Keep raw prompts, source bodies, document snippets, identifiers for hidden versions, provider errors and private rationale out of reporter responses and notifications. A newly restricted case must render the minimal status without previously cached fields. Show empty, loading, refresh and unavailable states without inventing progress.

## Proposed implementation contracts

### Persistence

Use additive PostgreSQL migrations from the current inventory. Recheck the next available migration number and release policy. Keep transaction-scoped actor context and use actual restricted runtime roles when proving isolation.

| Record | Minimum contract |
| --- | --- |
| `maintenance_case` | Organization, case ID, origin, optional reporter, primary document and published version IDs, verified hash/anchor, route, historical author, optional current assignee, first-claimed timestamp, revision, reporter state and terminal outcome. Require coherent organization/document/version relationships. Never overwrite the pinned version. |
| `maintenance_case_link` | Typed organization-scoped links for related/recurring cases or Flow 2 requests and resulting published version/disposition. A current link must identify the exact target and preserve superseded prior evidence in audit. |
| `maintenance_case_message` | Actor, case, audience, plain-text message, timestamp and optional request/reply relation. Reporter-facing release is explicit. |
| `audit_event` association | Reuse append-only audit table with a typed case reference or a tenant-constrained case/event association that preserves existing single-subject rules. Add deterministic per-case ordering and an index. Emit validated event types and role-safe projections. |
| `maintenance_analysis_run` | Case, requesting assignee, assignment/revision fence, immutable ordered source manifest, status, attempt, lease/fence, bounded failure code and evidence-linked result. At most one active run per case, including concurrent starts. |
| Notification delivery | Transactional in-app inbox or existing equivalent. Unique logical event/recipient key. Projections authorize at read/deep link time. Route failures are surfaced to admins. |

Expected constraints include tenant-scoped foreign keys, append-only decisions/results, revision checks for contested writes, and current access checks for all derived content. Use a locking/CAS strategy that serializes claim, reassignment, cancel, apply proof and closure. If adding a case association requires changing existing audit policies, inspect deployed constraints and migration evidence before choosing the final shape. Avoid broad new raw-table grants.

### Routes and return types

Proposed base: `/api/v1/organizations/:organizationId/knowledge/maintenance`. Ordinary clients use Core only. Names may be refined against repo conventions before implementation.

| Method and suffix | Inputs / response |
| --- | --- |
| `POST /cases` | `origin, documentId, publishedVersionId, description, anchor?, comparisonVersionIds?` and `Idempotency-Key`. Returns the caller’s case projection. Reporter identity comes from session. |
| `GET /cases`, `GET /cases/:id` | Scoped queue or own reports. Return explicit reporter, minimal reporter, queue, assigned or admin projection. Scope and cursor are validated server-side. |
| `POST /cases/:id/claim`, `/reassign` | Expected revision and command key. Reassignment takes eligible membership ID and reason. Return current permitted detail on success. |
| `POST /cases/:id/messages`, `/decisions` | Idempotent reply, information request or decision. Decision includes `action, reporterExplanation, reviewerRationale?, evidenceRefs?`. Server writes state, audit and notification effects together. |
| `GET /cases/:id/versions`, `POST /cases/:id/compare` | Return readable timeline or `fromPublishedVersionId, toPublishedVersionId, anchor?` diff. Verifies access to both exact versions. Response includes exact pair, section/anchor, hunks or an unavailable reason. |
| `POST /cases/:id/publication-link`, `/resolve` | Link verified request or already applicable version. Resolve with expected case revision and evidence, and reverify effective publication/actual withdrawal for any nontrivial outcome. |
| `GET /cases/:id/history` | Server-ordered, bounded page using timestamp and unique tie-breaker. Returns events already filtered for the caller. Use no-store for sensitive case responses. |
| `POST /cases/:id/analyses`, `GET /cases/:id/analyses/:runId`, `POST /cases/:id/analyses/:runId/cancel` | Start, poll and cancel. Use current assignment and source checks, command keys and no-store. A retry is a distinct record linked to the prior attempt. |

Validate schema strictly and bound text lengths, pagination, source count/range, execution time and evidence size. Pin limits in paired contracts at implementation. Keep opaque cursors and stable public errors. `404` equivalent for unknown/inaccessible resources, `409` for stale, conflicting or already-claimed writes that the actor is allowed to know. A provider failure reports a safe failure category and supports manual continuation.

### AI service and publication integration

Core resolves the reported snapshot under the scoped case grant and other sources under each exact version’s read policy. Prepare canonical text and anchors from existing source preparation. Use a typed internal versioned request for the one bounded analysis, with finite source/text/time limits. Arden-AI returns structured evidence references keyed to the provided manifest. Core validates the response schema, input provenance and original spans, and checks the current worker fence and permissions before commit and read. A dependency on an unavailable source withholds the related result. Provider logs must omit content and prompts.

Consume the authoritative Core publication facts. The case link verifies submission/request, organization, target, lineage, index-ready activation, legacy applicability when present, and actual withdrawal. Keep terminal case transitions separate from Flow 2 transactions unless the ownership boundary supports a safe same-transaction command. A reconciliation job or poll may update progress, and only a reviewer confirms resolution.

## Acceptance IDs

| ID | Observable behavior |
| --- | --- |
| MA-01 | Authorized report pins exact version and optional passage. A retry returns one outcome, independent reports remain separate, stale/denied inputs neither leak info nor write a case. |
| MA-02 | Exactly one eligible independent reviewer claims. Author/wrong scope cannot claim. Admin can reassign with audit. Grant loss blocks the former assignee immediately. |
| MA-03 | Reporter sees the proper status and allowed messages. Revocation yields the minimal case projection. Loss of membership denies the case. Peers and authors see only their permitted projections. |
| MA-04 | Case events persist with state updates, paginate deterministically, appear in the authorized timeline and redact other audience data. Notifications deduplicate and reauthorize on open. |
| MA-05 | Reviewer steps through readable versions, sees accessible additions/deletions, can jump to applicable current, and can inspect originals. Upcoming and scan-only behavior are honest. Hidden versions and revoked content are withheld. |
| MA-06 | More information loops back to review. Author handoff links an exact Flow 2 action. Rejected, failed, upcoming or unrelated changes never close the case. Applied withdrawal or applicable proven correction can be human-confirmed. |
| MA-07 | Analyze uses the fixed selected evidence, supports cancel/retry, and rejects stale or late completions and forged citations. Manual decisions remain usable. |
| MA-08 | Home/reader/Reviews UX follows Arden tokens, works with keyboard, small screens and Electron, clears private state on context change and exposes meaningful loading, error and empty states. |
| MA-09 | Repeat issue opens a linked new case. The previous resolution and audit remain intact. |
