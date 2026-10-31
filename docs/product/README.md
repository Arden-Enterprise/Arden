# Feature and flow index

Owner: product/engineering maintainers; issue-level people remain in Linear. Prepared 2026-10-26 from Arden main `6d06292be349924fa84f3bfa84af802692ab7ad5`, Arden-AI main `405023927b0256122989da3339e89027934086e5` and the explicitly identified Arden branch snapshot `5e0def733da37a70268e340f879aff7379f19165`.

This is an initial evidence-backed map of **20 feature groups**, not a claim that the product has only 20 individual features, that every historical conversation was imported, or that every path is finished. Its acceptance cases expose work to verify; they are not claims that new product decisions were approved. Add missing accepted scope using stable IDs and the [specification rule](../engineering/rules/specifications.md). Keep [PRODUCT.md](../../PRODUCT.md), the [blueprint](../../ARDEN_BLUEPRINT.md), [design](../../DESIGN.md), accepted ADRs and source as the owning contracts.

## Read and update a feature

Find its group below, read the linked owning sources and actual applicable source/tests, then select the required acceptance IDs. Record the brainstorm originator and decision owner from real evidence; the owner responsible for delivery need not be either person. Historical attribution is incomplete here: public ADRs often identify only the project lead/task owner, and no more precise identity is inferred. Resolve unknown attribution privately with the team before relying on it for a conflicting decision.

Each group document distinguishes current main, branch-only alternatives, observed source boundaries and remaining evidence. Linear owns live assignment and scheduling. Do not duplicate all tickets here or create an issue for every acceptance row.

| ID | Feature group and paths | Specification / coverage map | Known boundary at this inspection |
| --- | --- | --- | --- |
| F01 | Account registration, sign-in, recovery and sessions | [Identity and access](identity-and-access.md#f01-accounts-and-sessions) | API/UI slices exist; complete live identity acceptance not established here |
| F02 | Organization setup, invitations and membership | [Identity and access](identity-and-access.md#f02-organizations-and-membership) | Implemented slices; lifecycle and integration evidence remain |
| F03 | Owner-private notes | [Identity and access](identity-and-access.md#f03-private-notes) | API/UI slices exist; privacy/conflict/platform acceptance required |
| F04 | Published audiences and reader access | [Identity and access](identity-and-access.md#f04-published-audiences) | Decision 0010/code/migration foundation; database rehearsal boundary |
| F05 | Reviewer authority and organization administration | [Identity and access](identity-and-access.md#f05-reviewer-and-organization-authority) | Main/branch review-authority conflict; see G1/G3 below |
| F06 | Installation System Admin | [Identity and access](identity-and-access.md#f06-installation-administration) | API foundation; System Admin UI/rehearsal pending in main inventory |
| F07 | Create a shared draft or contribute a separate copy | [Knowledge lifecycle](knowledge-lifecycle.md#f07-creation-and-contribution) | Main slices; preserve private original |
| F08 | Canonical document versions and import | [Knowledge lifecycle](knowledge-lifecycle.md#f08-content-versions-and-import) | Semantic Document contract is branch-only; import breadth not certified |
| F09 | Immutable submission and review decisions | [Knowledge lifecycle](knowledge-lifecycle.md#f09-submission-and-review) | Material main/branch contract conflict G1/G3 |
| F10 | Publication, activation and withdrawal | [Knowledge lifecycle](knowledge-lifecycle.md#f10-publication-and-activation) | Main/branch activation contract conflict G1 |
| F11 | Published library and search | [Graph, AI and work](graph-ai-and-work.md#f11-library-and-search) | Published list/detail exist; full search/index acceptance not established |
| F12 | Graph navigation, selected-item details and context | [Graph, AI and work](graph-ai-and-work.md#f12-graph-and-context) | Planned; ARD-50 records requested UI and acceptance |
| F13 | Permission-aware retrieval, answers and citations | [Graph, AI and work](graph-ai-and-work.md#f13-grounded-agent) | Separate AI source exists; core contract/integration conflict G1/G2 |
| F14 | Permission-aware conversation history | [Graph, AI and work](graph-ai-and-work.md#f14-conversation-history) | Planned in ARD-59; no integrated completion established |
| F15 | My Work, work briefs and handover | [Graph, AI and work](graph-ai-and-work.md#f15-work-context-and-handover) | Preview/roadmap; persistence and accepted detailed scope incomplete |
| F16 | Jira/GitHub source ingestion and connectors | [Graph, AI and work](graph-ai-and-work.md#f16-external-sources) | Proposed blueprint scope; source permission mapping unresolved |
| F17 | Explicitly confirmed external actions | [Graph, AI and work](graph-ai-and-work.md#f17-external-actions) | Conditional later pilot scope; no implementation claim |
| F18 | Shared web/Windows behavior and offline boundaries | [Platform and delivery](platform-and-delivery.md#f18-web-and-desktop) | Shared source exists; installer/native/offline guarantees separate |
| F19 | Developer environments and release promotion | [Platform and delivery](platform-and-delivery.md#f19-development-and-release-flow) | Tooling/runbooks exist; each target/version needs evidence |
| F20 | Customer installation, recovery and support | [Platform and delivery](platform-and-delivery.md#f20-installation-and-recovery) | Release gates remain; no general production-readiness claim |

## Known reconciliation gaps

Integration update, 29 October 2026: inspected main `be27d2c` already includes ADR 0011/0012, so G1/G2 below describe the historical inspection, not the current integration contract. During the workflow/staging merge the requesting maintainer explicitly approved ADR 0013–0015 after a comparison with main: the author's primary department supplies responsibility, frozen readers determine disjoint Department/Organization reviewer scope, and pending legacy rules are retained. This resolves the G3 decision requirement for this change, not its database/live acceptance. The owning sources and acceptance maps govern; historical findings below are retained as provenance.

These gaps have not been resolved by writing this index. Decision owner: accountable product maintainer with the original affected decision owners; exact historical individuals are not established by the inspected public records. Existing coordination tracking: ARD-63. Related implementation issues retain their own owners.

- **G1 — Flow 2/3 behavior and integration.** Main uses request-revision, locked pending drafts and publication on approval. The [branch Flow 3 contract](https://github.com/Arden-Enterprise/Arden/blob/5e0def733da37a70268e340f879aff7379f19165/docs/engineering/mainflow-3-phase-0-contract.md) and [branch ADR 0011](https://github.com/Arden-Enterprise/Arden/blob/5e0def733da37a70268e340f879aff7379f19165/docs/decisions/0011-permission-aware-publication-and-semantic-documents.md) instead define approve/reject, mutable drafts, audited Org Admin self-approval and approval-to-PREPARING before indexed activation. They record project-lead approval but are not in inspected main. [PR #8](https://github.com/Arden-Enterprise/Arden/pull/8) merged to a feature branch after [PR #7](https://github.com/Arden-Enterprise/Arden/pull/7) had integrated its earlier state. A merged badge did not deliver the newer contract to main. Reconcile with the owner before dependent integration; do not silently combine the two contracts.
- **G2 — AI service architecture.** Main's blueprint/technology plan still describes pgvector/local inference, while [branch ADR 0012](https://github.com/Arden-Enterprise/Arden/blob/5e0def733da37a70268e340f879aff7379f19165/docs/decisions/0012-separate-python-ai-service-and-chromadb.md) records a separate Python/OpenAI/Chroma service, consistent with inspected Arden-AI source. ARD-52 still contains older single-process/pgvector wording. Inspect paired contracts and record the accepted reconciled baseline before deployment or provider/data-flow changes.
- **G3 — Classification versus audience-breadth review.** Main decision 0008/0010 uses classifications; [branch ADR 0013](https://github.com/Arden-Enterprise/Arden/blob/5e0def733da37a70268e340f879aff7379f19165/docs/decisions/0013-audience-breadth-review-levels.md) proposes/reports partial audience-breadth implementation and explicitly requests project-lead confirmation in its PR. Its `accepted` heading alone does not resolve that approval condition or prove integration.
- **G4 — Navigation and complete design handoff.** The blueprint describes a graph home; current design/product-contract and UI use My Work, and ARD-50 leaves the default landing choice open. Preserve the current flow while that choice and a versioned graph/chat handoff remain unresolved.
- **G5 — Coverage and shared context.** Several historical summaries describe earlier behavior, some Knowledge/rule handoffs are unpushed and teammate design/research inputs are not fully imported. This index covers visible evidence only. No claim is made that every brainstorm, all user paths or live tracker state has been reconciled. Resolve missing scope/provenance and publish approved records before claiming team-wide availability.

## Working artifacts

- [Feature specification template](templates/feature-spec.md): scope, owners, complete paths and acceptance/evidence matrix.
- [Decision-change comparison](templates/decision-change.md): current/proposed behavior, consequences, consultation and actual decision.
- [Resume checkpoint](templates/resume-checkpoint.md): exact state, remaining work, preserved paths and authorized next actions.
- [Implementation inventory](../engineering/implementation-status.md): reported code/rollout boundaries; recheck source and actual target evidence.

This index is documentation, not a fixed feature cap, automatic CI gate, acceptance of every roadmap item or permission to merge a branch. Review and update it whenever accepted scope or its delivery boundary changes.
