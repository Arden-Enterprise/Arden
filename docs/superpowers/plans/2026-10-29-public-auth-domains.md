# Public Auth Domains for Google Sign-In Implementation Plan

> **For agentic workers:** use `superpowers:executing-plans` to implement this plan task by task. Keep commits coherent and preserve unrelated work.

**Goal:** Enable separate HTTPS Supabase Auth hostnames for production and staging Google sign-in without exposing Arden's server-to-server token exchange.

**Architecture:** The Fastify BFF generates the browser's Supabase OAuth authorization URL using a validated public Auth origin, while every subsequent Auth API call and PKCE code exchange keeps using the existing private gateway origin. Cloudflare Tunnel publishes only the OAuth authorization and provider callback paths on each Auth hostname and forwards through Coolify's Auth Gateway domain route. Production and staging use distinct Google callbacks and OAuth credentials.

**Tech Stack:** TypeScript, Supabase JS Auth, Fastify, Coolify Compose, Cloudflare Tunnel and DNS.

**Spec:** User request on 2026-10-29: publish separate production and staging Auth hostnames securely for Google login. Actual hostnames are retained in private operational records; domains below are examples.

## Global Constraints

- Preserve private Auth URLs for all API-to-Auth requests and PKCE code exchange.
- `SUPABASE_AUTH_PUBLIC_URL` values are exact HTTPS origins, such as `https://auth.example.test` and `https://auth-staging.example.test` for separate environments.
- Expose only `^/auth/v1/(authorize|callback)$` on those hostnames through Cloudflare Tunnel.
- Set each GoTrue `GOTRUE_EXTERNAL_GOOGLE_REDIRECT_URI` to its matching public host plus `/auth/v1/callback`; preserve existing `API_EXTERNAL_URL`, `GOTRUE_SITE_URL`, and allowed redirects.
- Keep Google client secrets in Coolify's protected runtime environment; never commit or send them in chat.
- Keep existing application domains, Auth origins, database/auth data and the existing website/API container state intact.
- Do not enable Google provider until each environment has its own configured Google OAuth credentials.

## Review Focus

- Missing or malformed production public URLs fail closed before OAuth can start.
- OAuth starts against the correct environment's public hostname, but code exchange stays on that environment's private gateway.
- Cloudflare path matching does not expose token, user, settings, admin, or other Auth endpoints.
- Google callback URIs exactly match the per-environment host/path configured in Google Cloud and GoTrue.
- Applying Coolify changes redeploys only the targeted Auth gateways and preserves the website/API containers.

---

### Task 1: Separate public browser redirect from private Auth calls

**Files:**
- Create: `apps/api/src/auth/provider.test.ts`
- Modify: `apps/api/src/auth/provider.ts`
- Modify: `apps/api/src/index.ts`
- Modify: `.env.example`
- Modify: `docs/engineering/operations.md`

**Interfaces:**
- `SupabaseAuthProvider(privateUrl, publishableKey, publicAuthUrl?)`
- OAuth start returns an authorization URL built from `publicAuthUrl`; callback exchange and all other Auth calls continue using `privateUrl`.
- `SUPABASE_AUTH_PUBLIC_URL` is optional in development (defaults to private `SUPABASE_URL`) and required for the production API when Supabase Auth is configured.
- The per-call PKCE client must use its supplied ephemeral storage adapter; Supabase Auth JS 2.117.2 ignores custom storage when `persistSession` is false.

- [x] **Step 1: Write the failing tests**
  - OAuth start URL host/path is `https://auth.example.test/auth/v1/authorize` and preserves Arden's exact callback URL plus PKCE parameters.
  - OAuth start returns the verifier from the per-call PKCE adapter instead of failing with `INVALID_AUTH_RESPONSE`.
  - Completing a PKCE exchange sends its request to the private gateway even when a different public URL was supplied.
  - Production requires a public Auth origin; an explicit origin rejects non-HTTPS scheme, credentials, path, query, or fragment.
- [x] **Step 2: Run `pnpm --filter @arden/api exec vitest run src/auth/provider.test.ts` and verify failures are about the missing public/private URL behavior.**
- [x] **Step 3: Implement the smallest provider and production configuration changes that satisfy those boundaries.**
- [x] **Step 4: Document the per-environment setting without any credentials, then run the focused test, `pnpm typecheck`, `pnpm test`, and `pnpm build`. Expected: all pass.**
- [x] **Step 5: Commit the reviewed code, configuration template and operations guidance as one coherent unit.**

**PR preparation verification (2026-10-30):** Refreshed main `be27d2c` and prepared the public-safe change against staging `d310f32`. Frozen-lockfile install, workspace typecheck, workspace tests (255 passed, 7 skipped, including the 8 Auth boundary tests), remote-workflow tests (16/16), and workspace build passed on Node 24.22.1 / pinned pnpm 11.19.0. Both modified startup-check scripts passed `node --check`; their synthetic production configuration includes the new required origin. Existing large-chunk build advisories remain. Provider/database integration cases were skipped locally; CI image/database checks and real Google sign-in are separate pending evidence. No application release is established by these checks.

### Task 2: Add narrowly scoped public routes for the two Auth services

**Resources:**
- Production Supabase Auth Gateway, `auth.example.test`.
- Staging Supabase Auth Gateway, `auth-staging.example.test`.
- Existing approved Cloudflare Tunnel and project DNS zone.

- [x] Add proxied `auth` and `auth-staging` CNAME records to the existing tunnel and matching Coolify Auth Gateway routes on internal HTTP port 8080.
- [x] Add ordered hostname/path rules matching exactly `^/auth/v1/(authorize|callback)$`, forwarding through `http://approved-internal-proxy:80`; leave all existing routes and the fallback unchanged.
- [x] Apply Auth gateway routing using component-only deployment with dependencies disabled.
- [x] Verify HTTPS certificate coverage, OAuth route behavior, denial for `/auth/v1/token` and other unexposed Auth paths, and that existing Coolify/app domains still work.

**Recorded infrastructure evidence (2026-10-29):** Both Auth gateways were healthy after component-only deployment. HTTPS validation succeeded, authorization/callback probes reached Auth, token paths returned 404, existing sites returned 200 and dashboards redirected to login. Website/API start times were unchanged. Actual hostnames, tunnel identifiers and connection details remain in private operational records; all domains here are examples.

### Task 3: Add Google credentials and complete environment smoke tests

- [ ] User creates one Google OAuth web client per environment and stores client ID/secret only in that environment's Coolify Auth variables.
- [ ] Set exact provider callback URI: `https://auth.example.test/auth/v1/callback` or `https://auth-staging.example.test/auth/v1/callback`.
- [ ] Enable Google separately per environment only after credentials and exact redirect allowlists are configured.
- [ ] Test a real sign-in on staging first; verify callback returns to the correct Arden app and secure HttpOnly session behavior. Promote to production only through the authorized release workflow.
- [ ] Record remaining limitations and actual live evidence in the owning Linear issue/private operational handoff; do not mark broader Supabase work done.
