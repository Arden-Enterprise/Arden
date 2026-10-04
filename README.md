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
