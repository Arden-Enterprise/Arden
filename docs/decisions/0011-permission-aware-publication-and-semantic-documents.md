# 0011: Permission-aware publication lifecycle and Semantic Documents

Status: accepted
Date: 2026-10-21
Decision owner/approval: project lead, explicitly approved during Mainflow 3 Phase 0
Implementation: partial — review contract, mutable drafts, clean-content reset and Semantic Document v1 implemented; indexing/activation follows in ARD-55/ARD-56
Supersedes: the immediate-activation portion of [0007](0007-automatic-publication-after-final-approval.md), request-revision wording in [0008](0008-three-level-knowledge-classification.md), and conflicting reviewer/admin wording in [0010](0010-audiences-and-system-administration.md)

## Context and requirement

Mainflow 3 needs search and RAG to observe exactly the same active, authorized publication. Immediate visibility at approval time races asynchronous compilation, chunking and embedding. The existing editor format also lived in the UI package, flattened links and accepted unversioned text as a second stored format.

All content currently stored in development is disposable test data. The accepted reset keeps identity, organizations, departments, audiences and reviewer grants while deleting private/shared drafts, uploads, submissions, reviews, publications, chunks and AI query artifacts.

## Decision

- A working draft remains mutable while an immutable snapshot is under review. Each document has at most one open release candidate.
- Review has exactly two outcomes: `APPROVE` and `REJECT`. Rejection closes the candidate; the author may keep editing and submit a new snapshot. There is no request-revision outcome.
- The assigned reviewer or Organization Admin may decide a submission. Ordinary reviewers cannot self-review. Organization Admin may self-approve as final authority, with explicit `selfApproved` audit evidence.
- Approval moves the exact snapshot to `PREPARING`. It does not update the active-publication pointer. Only a complete index generation followed by atomic activation makes the version `ACTIVE` and visible to search/RAG.
- Publication access has no `validFrom`/`validUntil` eligibility in Mainflow 3. Current access policy and the active pointer decide visibility; Organization Admin unpublishes explicitly.
- Semantic Document v1 is the only stored editable shared-document format. It is a versioned block tree with required unique stable block IDs. Markdown is a deterministic derived processing artifact, not the authoring source.
- Plain text remains an accepted ingestion input, but is normalized to Semantic Document before shared-draft storage. Unversioned text is not accepted as stored canonical shared content.

## Boundaries and consequences

Migration `0018_flow3_contract_and_test_content_reset.sql` intentionally deletes test content and removes historical `CHANGES_REQUESTED` compatibility. It does not remove accounts, organizations, memberships, departments, audiences, audience memberships or reviewer grants. File-backed objects become orphan candidates and must be purged from the explicitly selected development storage root during environment reset; the migration does not inspect or delete filesystem paths.

Semantic Document v1 defines paragraph, heading, list item, quote, code, table and immutable asset-reference blocks. The current BlockNote adapter supports the authoring subset and fails closed for unsupported stored blocks until its UI support is implemented.

## Verification and rollout

- Validate the reset migration on a disposable PostgreSQL database before any shared environment.
- Prove only one pending candidate can exist under concurrent submission.
- Prove editing creates a new draft version without changing the pending snapshot.
- Prove approval produces `PREPARING` with no active pointer; indexing/activation tests arrive with ARD-55/ARD-56.
- Prove Semantic Document validation rejects duplicate/missing IDs, unsafe links, excessive nesting/count/text and unsupported versions.

## Rules and documentation updates

- [Semantic Document v1](../engineering/semantic-document-v1.md)
- [Mainflow 3 Phase 0 contract](../engineering/mainflow-3-phase-0-contract.md)
- [Mainflow 3 Phase 1 audit](../engineering/mainflow-3-phase-1-audit.md)
- [Technology guide](../engineering/technology-guide.md)
- [Security and data rules](../engineering/security-and-data.md)


## Review safety clarification — 29 October 2026

The owner's authorized review/fix release adds migration 0021 without rewriting applied migrations.
Activation is serialized per draft and cannot replace a newer published snapshot with an older
delayed job, including after unpublication. Replaced historical approved snapshots are marked
`SUPERSEDED`; indexing failure remains `FAILED`. Only the current successfully activated snapshot
is `ACTIVE`. The UI/Core state extension must ship together. Existing stale pointers are not
automatically republished or repaired. Live data reset/migration consent is still separate.
