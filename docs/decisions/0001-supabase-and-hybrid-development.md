# 0001: Supabase direction and local frontend development

Status: accepted
Date: 2026-10-04
Decision owner/approval: user requests in this project's conversation
Implementation: partial; hosted API/database scaffold, not full Supabase integration or production release
Supersedes: blueprint's Better Auth/local-storage/SSE direction and the two hosted frontend slot proposal

## Decision and tradeoffs

Use Supabase PostgreSQL, Auth, Storage, and Realtime while retaining Fastify domain APIs, Drizzle reviewed SQL migrations, and a future separate pg-boss worker. Supabase supplies supporting features and can reduce integration effort, while adding services, secrets, policies, upgrades, and backup obligations. It does not remove Arden's governance/authorization work or migrations. The earlier stack has fewer deployed services. Neither design guarantees scale or measured time savings.

Arden owns content policy: personal originals, organization/team grants, immutable approvals and publication, authorized retrieval, revocation, and external actions. Supabase identity is not Arden authorization. Do not run Better Auth in parallel. Custom login/UI remains Arden's responsibility.

Developers run Vite locally; four independent development APIs/databases live on the server. One command connects the frontend and syncs saved backend changes without Git push. Staging/production use separate databases and reviewed immutable release images.

## Current implementation boundary

The current scaffold has no auth/content implementation. Provision the API/database it actually uses now: four development databases and non-superuser logins in one PostgreSQL process; separate staging/production database templates. The shared development process saves memory but shares resource, maintenance, and failure boundaries. Release application deployment is still absent.

This is **not a full Supabase deployment**. Four logical databases do not create four self-hosted Supabase projects. Before feature integration, select supported project placement, exact images, resource budgets, per-environment Auth/Storage/Realtime secrets, origins, private bucket/event authorization, and migration/restore procedures. Measure capacity or increase/split infrastructure; never reuse production as a development project.

Node 24, pnpm 11.19.0, React/Vite 7, Electron, Fastify, PostgreSQL, Drizzle, and pg-boss remain the direction. Bun runtime/package-manager migration is out of scope. Service-role keys remain server-only. Governed writes use Arden policy; direct SDK reads, downloads, signed URLs, and events need equivalent authorization/revocation.

## Operations and evidence

OpenSSH handles keys/fingerprint verification, with private ignored configuration. Bounded source deltas exclude private files. A writer lease prevents accidental overwrites, alongside OS permissions. Root-owned operator controls start constrained non-root containers; normal sync has no sudo. Staging receives reviewed releases and production promotes the same digests with authorized migrations and backups. No production readiness or HA guarantee is claimed.

Implementation: [contributor/operator guide](../engineering/remote-development.md), client/server source allowlists, leases, private forwarding, local Vite proxy, and development bootstrap/container scripts. Operational evidence belongs in the task handoff. Automated denial/concurrency/reconnect/permission coverage remains required before broader rollout; no automated tests were added/run for this request.

Owning docs: [technology](../engineering/technology-guide.md), [operations](../engineering/operations.md), [security](../engineering/security-and-data.md), [blueprint](../../ARDEN_BLUEPRINT.md), [product](../../PRODUCT.md).

## Primary references

- [Supabase architecture](https://supabase.com/docs/guides/getting-started/architecture)
- [Supabase self-hosting](https://supabase.com/docs/guides/self-hosting)
- [Supabase Docker capacity](https://supabase.com/docs/guides/self-hosting/docker)
- [Supabase Storage access control](https://supabase.com/docs/guides/storage/security/access-control)
