# 0001: Publish automatically after final knowledge approval

Status: accepted
Date: 2026-10-07
Decision owner/approval: project lead, explicit Mainflow 2 clarification in the project conversation
Implementation: frontend preview implemented; authoritative server workflow not started

## Context and requirement

The Mainflow 2 diagram routes Approve to **System — Publish Approved Version**. Earlier planning text incorrectly introduced a separate human publisher and manual Publish action. The project lead clarified that approval triggers publication automatically.

## Options and tradeoffs

- A manual publisher step adds a second human release gate, but contradicts the chosen flow and can leave approved documents waiting indefinitely.
- Automatic publication after final approval matches the chosen flow. It makes the review decision the release gate, so reviewer authorization, submitted metadata, intended audience and policy checks must be complete before final approval.

## Decision

When the last review step required by the organization's policy approves an immutable submitted snapshot, the server automatically publishes **that exact snapshot** and makes it the current knowledge version. A one-step policy publishes after one authorized approval. Intermediate approvals in a multi-step policy do not publish. Request Revision and Reject never publish. Mainflow 2 has no human publisher role, permission or button.

Classification levels are accepted in [decision 0002](0002-three-level-knowledge-classification.md). Organization-specific extra review conditions remain to be defined. They may change who can give final approval or how many review steps are required; they do not introduce a manual publication step.

## Boundaries and consequences

- Check reviewer authority, self-approval prohibition, snapshot/hash, classification, intended audience, grant validity and policy version at final decision time.
- Store the review decision and publication as distinct audit events linked to the same snapshot and policy.
- Commit the final decision, immutable published version and current-version pointer consistently. On publication failure, expose no partial or unapproved version and return a retryable error without duplicate publication.
- Indexing may run asynchronously. Search/AI use only the current, valid, authorized published version after indexing is ready. Existing published versions remain current while a newer revision is under review.
- AI cannot initiate approval or publication; this automatic system transition follows an authorized human decision.

## Verification and rollout

The session-memory frontend preview covers one-step approval → automatic sample publication, wrong-version approval rejection, Request Revision → no publication, and current-version preservation while a newer revision is reviewed. Server verification still needs intermediate approvals, Reject, concurrency, revoked grants, mismatched snapshot/scope, publication failure/rollback, idempotent retry, current-version replacement and indexing lag.

## Rules and documentation updates

See [PRODUCT.md](../../PRODUCT.md), [ARDEN_BLUEPRINT.md](../../ARDEN_BLUEPRINT.md), [security and data rules](../engineering/security-and-data.md), and [AGENTS.md](../../AGENTS.md). Linear Mainflow 2 issues are updated to match.
