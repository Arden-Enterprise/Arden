# Mainflow 3 Phase 1 audit

Baseline: `origin/main` and working HEAD `0775a88d0d6357cea66c7877b043abb53454143a`, inspected 2026-10-21. The private Arden-Knowledge checkout had no approved Mainflow 3 topic and contained unrelated uncommitted operations edits; it was read but not modified.

## Flow 2 findings

- Shared editable content was stored as a bounded string. The UI embedded versioned BlockNote JSON, but its parser also accepted unversioned plain text and flattened links.
- The canonical document parser lived in `packages/ui`, so the API could not validate the same semantic contract.
- Pending review blocked draft content and governance metadata edits in both API code and database triggers, despite submitted versions already being immutable snapshots.
- Review exposed three outcomes (`APPROVE`, `REQUEST_REVISION`, `REJECT`) and persisted `CHANGES_REQUESTED`.
- Approval inserted a publication and current pointer in the review transaction, before a future indexing pipeline could prove readiness.
- Publication reads depended on publication `valid_from`/`valid_until`. Reviewer-grant and audience-membership validity are separate authorization lifecycles and remain.
- Existing content is synthetic test data and has no retention requirement. Identity and authorization configuration must survive the reset.

## Phase 1 contract response

- `packages/domain` now owns Semantic Document v1 validation and serialization.
- New plain-text input is normalized before shared-draft storage; old unversioned stored content is not supported.
- Migration 0018 resets content-only test state, makes drafts mutable during review, removes the third review outcome, adds one-open-candidate enforcement and introduces `NONE/PREPARING/ACTIVE/FAILED` publication state.
- Approval enters `PREPARING`; current publication activation is deferred to the publication/index pipeline.
- AI pipeline work moves to the separate Python 3.11 `Arden-AI` repository. Arden core retains
  durable generation state, AccessPolicy decisions and atomic activation; ChromaDB is a derived
  index and never an authorization source.

## Deliberately deferred

Snapshot persistence expansion, immutable asset-version tables, index-generation manifests,
policy update/unpublish APIs and physical storage-object purge tooling remain later checklist
items. Deterministic Markdown compilation/source-map implementation has started in `Arden-AI`;
cross-repository contract and integration work is not yet complete. Migration 0018 must be
rehearsed on a disposable database before shared deployment.


## Optional synthetic browser regression

With a local frontend running and Playwright plus a browser installed in the test environment, run
`node tools/verification/ask-arden-browser.cjs`. `ARDEN_UI_QA_ORIGIN` selects an HTTP loopback
frontend (default `http://127.0.0.1:5180`). `ARDEN_QA_BROWSER_CHANNEL` can select an installed
channel such as `msedge`; `ARDEN_PLAYWRIGHT_MODULE` optionally identifies an existing Playwright
module instead of the default module resolution. No local machine path belongs in committed settings.

This regression injects a synthetic session and API responses, verifies that a delayed answer
cannot enter a reset conversation, and checks desktop/mobile rendering and page errors. Screenshots
stay in ignored `.private/qa`. It does not sign in to a real server, invoke a model or establish
live AI/authorization acceptance. The browser dependency is optional and is not installed on the server.
