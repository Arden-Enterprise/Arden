# Arden Knowledge Maintenance

Knowledge Maintenance tracks problems with published organizational knowledge from intake through a human decision. Its vocabulary distinguishes evidence, publication state, and resolution.

## Language

**Publication problem report**

An item submitted by an authorized reader to the publication governance workflow. A closed report retains its original governance disposition in history. An eligible open report may carry forward into a Maintenance case.

**Maintenance case**

The work record for investigating and resolving a problem with one pinned published version. It may originate from a reader report or a scoped reviewer.

**Pinned published version**

The exact version named when a maintenance case opens. It remains the subject even when a replacement is published.

**Comparison version**

Another readable version examined alongside a pinned version. It is evidence for review and does not change the case subject.

**Applicable version**

A published version whose guidance currently applies. An upcoming version can be readable before it applies.

**Eligible reviewer**

An active member who can review a case in the document's scope and did not author the pinned version.

**Assignee**

The eligible reviewer currently responsible for working a maintenance case.

**Reporter status**

The case stage visible to the reporter: Submitted, In Progress, or Resolved. _Needs reassignment_ describes an internal assignment condition.

**Publication outcome**

The Flow 2 result of activating a replacement or applying a withdrawal. It supplies evidence for, and remains distinct from, a maintenance resolution.

**Maintenance resolution**

An authorized human's recorded closure of a case as No change needed, Updated, or Withdrawn.

**Reporter explanation**

The outward-facing message explaining a case decision. Its visibility follows current access to that case.

**Reviewer rationale**

The reason and evidence relied on by the reviewer. It belongs to the authorized case record.

**Case history**

The authorized, ordered record of actions and decisions that concern a maintenance case.

**Analysis run**

An explicitly started AI investigation over a set of exact versions selected for that case.

## Knowledge Graph and Modular Agent UI

The Knowledge Graph visualizes authorized published organizational knowledge and its ISO/IEC 38505-1:2026 accountability structure. The Modular Agent UI renders governed, composable interactive blocks inside Ask Arden without granting unverified authority or mutating official knowledge.

**Knowledge Graph**

An authorized, read-only visual map of published organizational knowledge and explicit cross-document relationships within one organization. It excludes private notes and unreviewed direct shares.

**Accountability View**

The default Knowledge Graph hierarchy organized by governing responsibility: Organization, then Owner Department, then controlled Document Type (with legacy untyped documents grouped explicitly as uncategorized), then published documents.

**Collections View**

An alternate Knowledge Graph grouping organized by Organization Collections (single-level folders for Organization-wide published documents, plus Unassigned), keeping Department, Selected-reader, and legacy audience-scoped documents visibly separate under Shared.

**Governance Monitor Mode**

An opt-in graph overlay available only to accountable roles (authors for their own documents, responsible reviewers for their granted scope, and Organization Admins for metadata-only oversight) that highlights expiry risk, authorized open maintenance cases, unassigned Organization-wide documents, and optionally expired documents awaiting renewal or withdrawal.

**Document Relationship**

An explicit, human-declared link between two published documents in the same organization (references, related, or cross-document supersedes). A reader may perceive a relationship only when currently authorized to read both linked documents.

**Cross-Document Supersedes Link**

An informational directional Document Relationship noting that one distinct logical document replaces another logical document. It is distinct from Flow 2 version replacement within the same logical document and does not alter publication eligibility on Home or in Ask Arden.

**Context Basket**

An explicit, user-curated set of selected documents or graph branches whose currently authorized documents narrow the scope of Ask Arden retrieval. Adding items to the Context Basket is distinct from a Flow 4 pinned published version; it can only narrow access and never broadens permissions.

**UI Surface**

A declarative, composable, schema-bounded visual layout returned alongside an Ask Arden turn so structured answers can nest layout containers, domain data blocks, and allowlisted interactive actions safely across Web and Desktop clients.

**Surface Container**

A layout block within a UI Surface that arranges child blocks within strict nesting, depth, and node-count limits.

**Surface Leaf**

A terminal content or domain block within a UI Surface. Document and governance fields are hydrated exclusively from authoritative system state rather than model-generated text.

**Surface Binding**

An explicit reference attaching a UI Surface and its blocks to exact authorized published document versions and verified evidence chunks so permissions are checked at generation and re-checked on every history reload.

**Allowlisted Surface Action**

A strictly typed, non-mutating user interaction attached to a UI Surface that manipulates local graph focus or filters, opens an authorized document version, initiates a human-confirmed workflow dialog, or prefills a follow-up question in the composer.

**Turn-Level Fail-Closed Revocation**

The rule that if any evidence chunk or Surface Binding referenced by a saved conversation turn is no longer authorized, current, or unexpired, the entire turn—including prose, citations, and UI Surface—is withheld as unavailable.
