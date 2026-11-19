# 0025: Remove knowledge Topics

Status: accepted
Date: 2026-11-18
Decision owner/approval: requesting project maintainer. The maintainer asked on 2026-11-18 to remove the Topic concept from the project ("Topic is no longer needed"). When shown the impact and the option to stage it, they chose to remove it in one step on one branch. Recorded by the coding agent.
Brainstorm originator / record author: maintainer request; record drafted by the coding agent.
Approval evidence and exact source/spec revision: maintainer instruction in the session above, against `origin/staging` af28915.
Implementation: branch `refactor/remove-knowledge-topics`, migration `0039_remove_knowledge_topics.sql`; not merged, rehearsed on a staging copy or deployed.
Supersedes / superseded by: supersedes the Topic parts of [0020](0020-knowledge-management-catalog.md) and of [F11 KM-v1](../product/graph-ai-and-work.md#knowledge-management-refinement-km-v1-accepted-12-november-2026).

## Context and requirement

KM-v1 (decision 0020) made one primary Topic mandatory at submission. Topics were an organization catalog
managed only by Org Admins. In practice a new organization has no Topics, so authors could not submit
until an Org Admin created one. The maintainer no longer needs the concept.

## Options and tradeoffs

| Option | Benefit | Cost |
| --- | --- | --- |
| Keep Topic required | No change | Blocks first submissions; extra catalog work for Org Admins |
| Make Topic optional | Small change | Keeps a concept the product no longer wants |
| **Remove Topic in two steps** (hide, then drop data later) | Reversible first step | Two releases |
| **Remove Topic in one step (accepted)** | One change, no leftover concept | Dropping the catalog table is not reversible without a backup |

## Decision

- Topic is removed from the product. That covers:
  - the draft form and submission requirements, on the client and the server;
  - Library Discover and the All documents filter;
  - the reader's information panel and the review detail;
  - Manage catalog and Administration guidance;
  - the API and the Ask Arden source context.
- Discover keeps its Type groups and Collections.
- Required at submission: Title, Type, Content, Version, Effective Date (when the form asks for it) and Target Readers. A Change Note is still required for an update. Collections stay as optional curated bundles managed by Org Admins.
- Migration 0039 removes the Topic schema and the Topic data that can be changed:
  - the `knowledge_topic` table and its policies;
  - the generated `shared_draft.management_topic_id` column and its foreign key;
  - Topic fields in mutable drafts.
  
  Submission freezing no longer adds a Topic name.
- Already submitted and published versions are immutable snapshots (decision 0011). Their frozen metadata JSON keeps the historical `topicId`/`topicName` keys. The immutability trigger is not relaxed to rewrite them. Arden no longer reads or shows those keys.

## Boundaries and consequences

- **API:** metadata no longer accepts `topicId`, and old clients that still send it are refused with 400. `GET /catalog` returns `collections` only. Catalog writes accept only `collections`. The desktop allowlist drops the Topic routes.
- **Data:** Topic names and catalog entries are deleted. Restoring them needs a pre-migration backup. The migration is operator-class: it drops a table and replaces a trigger function.
- **Legacy snapshots:** they display without a Topic, with no other change.

## Verification and rollout

- Planned:
  - disposable full-chain apply, repeat no-op and the CI ownership handoff;
  - API, UI and desktop suites;
  - submit without a Topic, and an old draft that had a Topic.
- Evidence is recorded in the PR and in `docs/engineering/knowledge-management.md`.
- Rollout: backup, staging-copy rehearsal, then operator apply.

## Rules and documentation updates

- Updated together:
  - the status of decision 0020;
  - KM-v1 in `docs/product/graph-ai-and-work.md`;
  - `docs/engineering/knowledge-management.md`;
  - `DESIGN.md`;
  - the reader information list in decision 0022.
