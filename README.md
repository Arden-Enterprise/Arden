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

The shared React package implements the [Living Archive Figma redesign](https://www.figma.com/design/UmW5qb5cTWo6lwMYZ4Z9bC/Arden?node-id=147-2) for web and desktop, using dark surfaces, amber/jade/blue accents and locally bundled Sora/DM Sans fonts:

- a minimal sign-in boundary with no public registration;
- workspace selection and a redesigned `My Work` preview with scoped queue search;
- a responsive `Personal Workspace` with per-note session drafts that survive navigation, a mobile list/editor flow, scoped search, keyboard focus, unsaved state, and empty states;
- a collapsible Knowledge Pane that follows the selected private note and keeps the active access boundary visible;
- a guided first-run organization setup preview (SCR-02) covering template, departments, members/roles and access review;
- organization, department and member administration with reviewed access assignments;
- invitation creation, renew/revoke, acceptance, pending membership and access readiness states;
- sample knowledge library/editor, exact-version review with separate approval/publication, handover and prerecorded Ask Arden answers with citations.

Open the member preview for workspace selection, the admin preview for Administration, or first-run setup from sign-in. Completing setup enters Administration. For [Mainflow 1](docs/engineering/mainflow-1-preview.md), create an invitation, preview acceptance, return to assign the member's primary department/role, then preview their access and workspace. The template catalogue and member records are synthetic; a configuration needs at least one department and an active organization-scoped System Admin.

This is a labeled frontend preview. Sign-in does not authenticate, invitations do not send email, and organization, notes and knowledge transitions are held only in memory. Private drafts survive navigation; refresh or confirmed exit clears them. Switching demo members clears private notes after guarding unsaved changes. Real authentication, authorization, audit events, persistence, conflict handling and server governance still require API/data-model implementation. Hidden UI is never an authorization boundary.
## Hosted backend development

**New teammate? Start with [Start coding on Arden](docs/engineering/teammate-setup.md).** It covers installing tools, obtaining individual access, SSH/private settings, your first edit, Coolify, troubleshooting, and GitHub review. The guide records the remaining administrator onboarding requirements and the approved source branch while the setup PR is unmerged.

Run `pnpm dev:remote` after the guide's setup and administrator handoff. Vite stays on your computer; saved backend changes sync to your assigned hosted API/database. Four development slots are supported. Coolify manages the development APIs and the separate staging/production databases; full Supabase integration and release applications/deployment remain to implement. Operators can use the [hosted development reference](docs/engineering/remote-development.md).

## Checks

```sh
pnpm typecheck
pnpm test
pnpm test:remote
pnpm build
```

The API exposes `/api/health/live` and `/api/health/ready`; readiness checks PostgreSQL. This is a scaffold, not a deployable Arden release: authentication, the data model, ingestion, graph data, AI, installers, and Coolify production configuration are not implemented yet.

## Private local configuration and server access

For local environment files, credentials, sensitive notes, and data exports, follow the [private files guide](docs/engineering/private-files.md). It explains where to keep private material, how to check Git exclusions, and how to ask Codex for setup help without sharing secret values. Public configuration examples contain placeholders only.

For authorized server work, follow the [private server setup guide](docs/engineering/server-access.md). Connection details belong in each contributor's local Git metadata and personal SSH configuration; the public guide contains placeholders, and Codex's instructions remain scoped to this project through [AGENTS.md](AGENTS.md).

Public environment templates contain placeholders only. Set real values locally using the team's private setup instructions.
