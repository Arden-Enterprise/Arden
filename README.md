# Arden

This repository is the initial foundation for Arden, a private organizational knowledge and work-context product. Product and architecture decisions live in [ARDEN_BLUEPRINT.md](ARDEN_BLUEPRINT.md).

## Repository rules

Start with [AGENTS.md](AGENTS.md), which applies to agents and human contributors. [CONTRIBUTING.md](CONTRIBUTING.md) defines meaningful branches such as `feat/private-notes` and `fix/desktop-sign-in`, the development workflow, and review expectations. Detailed rules cover [technologies](docs/engineering/technology-guide.md), [security and data](docs/engineering/security-and-data.md), [operations](docs/engineering/operations.md), and [lasting decisions](docs/decisions/README.md).

[Code-quality standards](docs/engineering/code-quality.md) require readable cohesive code, testable boundaries, deterministic regression tests, explicit cleanup, and incremental maintainable changes. These are acceptance criteria, not a claim that the scaffold already has complete test or lint coverage.

Accepted product, architecture, technology, security, and deployment decisions must update these documents in the same change; they must not live only in chat. Installed capabilities and future plans must remain clearly distinguished.

## Local development

Prerequisites: Node.js 24+, pnpm 11+, and Docker Desktop or Docker Engine with Compose.

```sh
pnpm install
pnpm db:up
pnpm dev
```

The web shell runs at `http://127.0.0.1:5180`; the API runs at `http://127.0.0.1:3001`. PostgreSQL is bound to local port **5433** to avoid colliding with other development databases. The web dev server proxies `/api` to the API. To open the Windows desktop shell, run `pnpm dev:desktop` in another terminal. The desktop renderer is bundled locally and does not load a remote website.

`pnpm db:down` stops the local database without deleting its volume. The Compose password is **for local development only**. Production must supply its own secret and connection string.

## Current UI foundation

The shared React package now contains the first ARD-16 frontend slice for both web and desktop:

- a minimal sign-in boundary with no public registration;
- a Figma-aligned `My Work` preview;
- a responsive `Personal Workspace` with a private-note list, editor, search, keyboard focus shortcut, unsaved state, and empty states;
- a permission-aware Knowledge Pane that keeps the active access boundary visible;
- a guided first-run organization setup preview (SCR-02) covering template, departments, members/roles and access review;
- a System Admin organization and access preview (SCR-09) with local edits, validation and a separate confirmation step.

Open the first-run setup from the sign-in preview button, or open the member preview to enter My Work directly. Completing setup enters the admin preview, where Organization & Access is available in the sidebar. The template catalogue and member records are illustrative. The two-department minimum is a demo constraint for testing permission boundaries, not a production rule for every organization.

This slice is intentionally labeled as a frontend preview. The sign-in action does not create a session, sample work is not live data, organization/role and private-note edits are held only in memory, and access rules are read-only guidance. Real authentication, authorization, audit events, persistence, conflict handling, and server enforcement still depend on the corresponding API and data-model tasks. Hidden UI is never treated as an authorization boundary.

## Checks

```sh
pnpm typecheck
pnpm test
pnpm build
```

The API exposes `/api/health/live` and `/api/health/ready`; readiness checks PostgreSQL. This is a scaffold, not a deployable Arden release: authentication, authorization, the canonical data model, persisted notes, ingestion, graph data, AI, installers, and Coolify production configuration are not implemented yet.
