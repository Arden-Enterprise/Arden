# 0002: Three levels of knowledge classification

Status: accepted
Date: 2026-10-07
Decision owner/approval: project lead, explicit approval of the Mainflow 2 classification table in the project conversation
Implementation: frontend preview implemented; authoritative policy enforcement not started

## Context and requirement

Mainflow 2 needs a content classification that influences reviewer eligibility and any policy-specific extra review. The project lead approved the three-level table after clarifying that final approval causes the system to publish automatically. Classification must not be confused with publication audience, private workspace status, or team/project routing attributes.

## Options and tradeoffs

- A single unclassified state gives no basis for routing sensitive material or explaining release policy.
- More levels can express finer distinctions but increase author and reviewer ambiguity before the organization has a mature classification policy.
- Three levels give a small, usable vocabulary while leaving extra review conditions to the organization's recorded policy.

## Decision

| Classification | Typical content | Review gate |
| --- | --- | --- |
| `INTERNAL` | Routine work instructions and lessons learned | Normally one reviewer with the applicable grant. |
| `CONFIDENTIAL` | Internal recruiting procedures or unreleased plans | Normally one reviewer explicitly authorized for the responsible department and document category. |
| `RESTRICTED` | Sensitive security procedures or especially sensitive personnel information | A specialist or senior reviewer with the applicable grant. A second review step exists only when organization policy requires it. |

Every level follows the same release transition: the system automatically publishes the immutable submitted snapshot after the final required approval. There is no separate publisher role or button. A classification alone never grants read access; publication audience and effective access controls determine that separately. `PRIVATE` is a personal access scope, not a classification value.

## Boundaries and consequences

- Freeze classification with content, metadata and intended audience on submission. A later change to classification or a wider audience requires a new snapshot and review.
- Check reviewer authority and policy for the exact snapshot at each decision. A reviewer must request revision or reject if the proposed audience is too broad for the sensitivity or cannot be enforced by current access controls.
- In particular, do not publish `RESTRICTED` knowledge into a broad organization/department audience when the intended readers are narrower and Arden lacks the required access grants.
- The exact content-to-level examples, default for existing documents, who may override a proposed classification, and organization-specific extra review triggers remain open implementation-policy details. Do not infer that `RESTRICTED` always needs two reviewers.

## Verification and rollout

The session-memory frontend preview exposes all three classifications, keeps classification distinct from audience, freezes both on the submitted snapshot and displays the frozen classification during review. Authoritative policy tests still need allowed and denied reviewers, wrong department/attribute, self-approval, insufficient audience controls, classification/audience changes after submission, one-step publication and policy-required multi-step publication.

## Rules and documentation updates

See [PRODUCT.md](../../PRODUCT.md), [ARDEN_BLUEPRINT.md](../../ARDEN_BLUEPRINT.md), [security and data rules](../engineering/security-and-data.md), [AGENTS.md](../../AGENTS.md), and [decision 0001](0001-automatic-publication-after-final-approval.md). Linear Mainflow 2 issues track schema, authorization, UI and QA implementation.
