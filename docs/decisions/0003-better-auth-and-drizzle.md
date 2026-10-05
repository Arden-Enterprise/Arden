# 0003: Better Auth with Drizzle and Arden-owned authorization

Status: superseded
Date: 2026-10-05
Decision owner/approval: user direction to follow the original architecture blueprint
Implementation: partial — Better Auth email/password sessions use the Drizzle adapter; live DB/account and RLS verification remain outstanding
Supersedes / superseded by: superseded by the restored leader-approved Supabase direction in [decision 0001](0001-supabase-and-hybrid-development.md)

This record documents the temporary Better Auth implementation direction. The leader's updated repository decision 0001 restores Supabase Auth; do not use this record as the current stack instruction. Its generic Arden authorization boundaries remain applicable.

## Context and requirement

The architecture blueprint is the accepted stack direction for a self-hosted Arden installation. It selects Better Auth with its Drizzle adapter for accounts and sessions while keeping organization membership and content authorization in Arden. An earlier task clarification temporarily changed this to Supabase Auth; the task owner later directed the implementation back to the original blueprint. The Supabase code was removed before any database migration or deployment.

## Options and tradeoffs

- **Better Auth + Drizzle adapter (selected):** fits the blueprint, stores credentials and sessions in the customer PostgreSQL installation, and avoids operating the larger Supabase service stack. Arden still owns membership, scoped roles, and content access.
- **Supabase Auth:** offers a separate identity service but departs from the accepted self-hosted blueprint and adds another service boundary to operate. It is no longer selected.
- **Custom Arden password/session implementation:** rejected because Arden should use the selected auth library instead of rebuilding password verification and session lifecycle.

## Decision

- Use Better Auth 1.7.7 with `@better-auth/drizzle-adapter` 1.7.7 and Drizzle ORM 0.45.3. Pin changes through package manifests and lockfile; review official docs for the installed versions.
- Better Auth owns email/password verification and session records. Its default scrypt hash is held in `auth.account.password`; the API never handles or logs plaintext credentials beyond the sign-in request and does not duplicate hashes in `user_account.password_hash`.
- Generate UUID user IDs. `user_account.user_id` references `auth.user.id`; Arden checks account status, membership, role, scope, and private workspace ownership on every protected endpoint.
- Disable public sign-up. Account provisioning and bootstrap are still open work; existing/synthetic accounts must be provisioned before sign-in.
- Web uses Better Auth's HttpOnly cookie session. Desktop stores the cookie encrypted with Electron `safeStorage`; renderer requests reach the main process over a narrow allowlisted IPC request bridge, so the cookie is never exposed to renderer code.
- Keep authentication records in a dedicated PostgreSQL `auth` schema. A non-login `arden_auth_runtime` role serves Better Auth; the non-login `arden_runtime` role serves Arden's RLS-protected domain repository. Use a privileged migration connection for schema changes.
- Keep Arden organization membership and authorization canonical in the `arden` schema. The Better Auth organization/invitation plugin is not enabled in this slice because its tables must first be mapped to Arden's agreed membership/invitation model without creating competing authorization state.
- Do not run Supabase Auth or another credential/session system alongside Better Auth.

## Boundaries and consequences

- Required configuration: `BETTER_AUTH_URL`, a private `BETTER_AUTH_SECRET` of at least 32 characters, exact `ARDEN_AUTH_TRUSTED_ORIGINS`, and a PostgreSQL login with `arden_auth_runtime` membership (optionally through `ARDEN_AUTH_DATABASE_URL`).
- The migration creates Better Auth core user/session/account/verification tables. Email/password account hashes are in Better Auth's account table; Arden profile and organization tables remain in the agreed domain schema.
- Synthetic accounts require both a Better Auth user/credential account and matching Arden `user_account`, membership, role assignment, scope, and explicit private-workspace permission rows. The initial migration grants no private-note permissions by default.
- Existing sessions, credentials, databases, and deployments have not been migrated or changed. Supabase code from this branch's earlier implementation was not deployed; no external identity provider credentials need migration here.
- Better Auth's organization plugin and invitation sync, organization bootstrap, password reset email delivery, and production account provisioning remain separate implementation decisions/tasks.

## Verification and rollout

Fastify tests exercise a synthetic Better Auth handler and session cookies; web and desktop transport tests cover their cookie boundaries. Typecheck, unit/request tests, and web/desktop/API builds pass. The gated live Better Auth test requires a preconfigured synthetic account in an isolated migrated PostgreSQL database. PostgreSQL migration/RLS integration remains unrun because Docker Desktop's database engine is unavailable. Do not migrate a shared Coolify database until the migration and the API/auth database role grants have been reviewed against a disposable target.

## Rules and documentation updates

- [Architecture blueprint](../../ARDEN_BLUEPRINT.md)
- [Repository rules](../../AGENTS.md)
- [Technology guide](../engineering/technology-guide.md)
- [Operations guide](../engineering/operations.md)
- [Security and data rules](../engineering/security-and-data.md)
- [First-slice permission/API contract](../engineering/first-slice-permission-and-api-contracts.md)

## References

- [Better Auth installation](https://better-auth.com/docs/installation)
- [Better Auth Drizzle adapter](https://better-auth.com/docs/adapters/drizzle)
- [Better Auth Fastify integration](https://better-auth.com/docs/integrations/fastify)
- [Better Auth database schema](https://better-auth.com/docs/concepts/database)
- [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)
