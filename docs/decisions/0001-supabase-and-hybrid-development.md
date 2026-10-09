# 0001: Supabase direction and local frontend development

Status: accepted  
Date: 2026-10-04  
Decision owner/approval: user relayed the leader's updated team direction and repository decision 0001  
Implementation: partial — Supabase Auth is integrated through the Arden API BFF; Supabase Storage, Realtime, deployment topology, and production release remain incomplete  
Supersedes / superseded by: supersedes the blueprint's earlier Better Auth/local-storage/SSE direction and the proposal for four hosted frontend slots

## Context and requirement

Arden is self-hosted first and must keep organization membership, scoped roles, private content, governance, and audit decisions under Arden's server-side policy. The leader's current direction uses Supabase PostgreSQL, Auth, Storage, and Realtime while retaining Fastify domain APIs and reviewed SQL/Drizzle migrations. Local frontends need to connect safely to isolated hosted API/database slots without using Git push as a routine synchronization mechanism.

## Options and tradeoffs

- **Supabase supporting services:** provides Auth, Storage, Realtime and PostgreSQL features in a familiar stack, while adding service configuration, secrets, policies, upgrades, and backup obligations.
- **Better Auth plus independent local services:** reduces the Supabase service footprint but departs from the leader's current direction.
- **Direct client access to all Supabase data:** reduces API work but risks creating a second authorization path that can drift from Arden's private-note, membership, governance, and revocation policy.

## Decision

- Use Supabase PostgreSQL, Auth, Storage, and Realtime as the accepted supporting-service direction. Keep Fastify as the routine domain API and Drizzle/reviewed SQL as the domain migration direction.
- Supabase Auth owns credential verification and identity sessions. Arden maps the verified Supabase user UUID to `user_account.user_id`; Arden owns organization membership, role/scope assignments, content grants, review/publication, audit decisions, and authorization.
- Do not run Better Auth in parallel. Supabase identity or project metadata does not itself grant Arden organization or content access.
- Service-role/secret keys remain server-only. Direct database, Storage, and Realtime access must enforce policy equivalent to the Arden API or remain unavailable to clients.
- Developers use local Vite web/desktop frontends and isolated hosted API/database development slots. Four logical API databases do not imply four full self-hosted Supabase projects.
- Keep staging and production isolated. Promote the same reviewed immutable release artifact; migrate with reviewed forward-only SQL and a recovery plan.

## Boundaries and consequences

- The current implementation uses `@supabase/supabase-js` in the API with persistence and auto-refresh disabled. Fastify exposes Arden sign-in/sign-out routes, holds Supabase access/refresh tokens in HttpOnly cookies for web, verifies sessions through Supabase Auth, and stores the same cookie jar encrypted by Electron `safeStorage` on desktop. Tokens are not returned to the renderer.
- The session BFF is a deliberate adaptation for Arden's rich SPA and prior HttpOnly-cookie requirement. Supabase's normal browser SDK flow expects browser-accessible token storage for refresh; Arden instead performs refresh from the API. Recheck this boundary if clients later call Supabase services directly.
- Only Arden domain PostgreSQL is managed by the initial Arden migration. It stores the Supabase user UUID as an external identity link and does not create or alter Supabase-owned `auth` tables.
- Supabase Storage and Realtime are target services but are not part of this auth/private-note slice. Current private note bodies remain on protected persistent file storage as previously selected; changing that storage decision needs an explicit implementation/migration update.
- Supported project placement, exact self-hosted service images, environment resource budgets, per-environment Auth/Storage/Realtime configuration, private bucket/event authorization, and migration/restore procedures remain operational work. Four databases on one PostgreSQL process share resource, maintenance, and failure boundaries.
- The current frontend-development implementation does not yet include the private SSH profile resolution, bounded source deltas, writer lease, operator controls, or four-slot switching described by the separate hybrid-development guide; do not claim those operational features exist based on this decision.

## Verification and rollout

Fastify request tests exercise Supabase sign-in/session behavior through a synthetic provider, and API/UI typecheck, unit/request tests, and builds are expected to validate this branch. A gated live Supabase Auth test requires a dedicated project and synthetic account. The real PostgreSQL/RLS test requires an already-migrated disposable database. Neither live test, nor Supabase Storage/Realtime policy verification or a production Coolify deployment, is evidence available from this decision alone.

Do not configure Supabase/Auth credentials for a shared or production environment until the administrator provides the approved project URL and publishable/anon key through the private environment. Never request or store a service-role key for the current authentication slice.

## Rules and documentation updates

- [Technology guide](../engineering/technology-guide.md)
- [Security and data rules](../engineering/security-and-data.md)
- [Operations guide](../engineering/operations.md)
- [Architecture blueprint](../../ARDEN_BLUEPRINT.md)
- [Product](../../PRODUCT.md)

## References

- [Supabase Auth](https://supabase.com/docs/guides/auth)
- [Supabase sessions](https://supabase.com/docs/guides/auth/sessions)
- [Supabase self-hosting](https://supabase.com/docs/guides/self-hosting)
- [Supabase Storage access control](https://supabase.com/docs/guides/storage/security/access-control)
- [Supabase Realtime authorization](https://supabase.com/docs/guides/realtime/authorization)
