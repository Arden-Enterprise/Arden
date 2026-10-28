# Development, deployment, and operations rules

Read [AGENTS.md](../../AGENTS.md), [the technology guide](technology-guide.md), and [security/data rules](security-and-data.md). This is the operational policy for the intended product. The repository now has a reviewed initial SQL migration command and local database Compose file, but it still has no complete Coolify release, worker, installer, or backup automation.

## 1. Supported baseline and current commands

- Development/CI baseline: Node.js 24, root-pinned pnpm (currently 11.19.0), and Docker with Compose. Windows is the first desktop target; Ubuntu 24.04 is the customer server target.
- Do not assume host Node and Electron's bundled Node/Chromium are interchangeable. Native dependencies must be compatible with the desktop runtime and packaged target.
- Do not upgrade a major runtime/database/package-manager version just because a newer release exists. Record the support decision, update related tooling/config/docs together, and test the upgrade path.

These commands exist now:

| Command | Actual purpose |
| --- | --- |
| `pnpm install` | Developer dependency install using the lockfile; intentional dependency changes may update it |
| `pnpm install --frozen-lockfile` | CI/reproducibility install; fails on manifest/lockfile mismatch |
| `pnpm db:up` | Start the local PostgreSQL Compose service |
| `pnpm db:down` | Stop Compose without requesting volume removal |
| `pnpm --filter @arden/api db:migrate` | Apply every pending numbered migration in order, one transaction at a time, to the configured migration database |
| `pnpm dev` | Start API and web host processes |
| `pnpm dev:api` | API hot reload with tsx |
| `pnpm dev:web` | Vite web development server |
| `pnpm dev:desktop` | electron-vite desktop development |
| `pnpm typecheck` | Run package typecheck scripts |
| `pnpm test` | Run package unit/request tests; skip real PostgreSQL unless `ARDEN_TEST_DATABASE_URL` is configured |
| `pnpm build` | Run existing package build scripts; does not produce a signed installer |
| `pnpm --filter @arden/api start` | Run built API, after build and required environment setup |
| `pnpm --filter @arden/desktop preview` | Preview a built desktop application, not a deployment/signing check |

There are no root lint, seed, worker, E2E, packaging, deploy, or backup scripts. Apply pending database migrations explicitly with `pnpm --filter @arden/api db:migrate`; they are not run automatically by API startup. Migration 0002 adds organization bootstrap, departments/default roles, role-tag permissions, and invitations.

Historical migration evidence from Kiet's earlier `arden_dev_2` setup: migration 0003 removes a scope/role-assignment recursive RLS dependency. A rollback-only bootstrap rehearsal exposed a second recursion: the role visibility policy queried `role_assignment` while a role-assignment write was checking the target role. Migration 0004 removes that dependency by deriving role visibility from the active organization, actor memberships, or global system-role status. Migrations 0003 and 0004 were rehearsed and applied to that earlier database. The rehearsal completed all organization-bootstrap statements under `arden_runtime`, then rolled back; it created no organization. Migration 0005 permits reading accepted invitations by the accepting actor, fixing the RLS violation when updating invitation status from PENDING to ACCEPTED under `arden_runtime`; it was applied there and its acceptance transaction was rehearsed under `arden_runtime`. The initial failed organization-creation requests also rolled back. This limited evidence does not verify every RLS path or a clean installation and does not identify Kiet's current database. Resolve today's target and migration inventory using [the current team layout](remote-development.md#current-team-layout) and [database readiness procedure](remote-development.md#database-and-storage-readiness-before-onboarding).

The migrations create Arden's `arden` schema, enable and force row-level security on domain tables, and create the non-login, non-superuser `arden_runtime` role. Supabase owns its Auth schema and credentials; Arden migrations must not create, alter, or grant access to Supabase-managed Auth tables. The API database login must be provisioned separately and granted membership in `arden_runtime`. Apply domain migrations with a distinct reviewed migration connection and verify the target is disposable/local before first use. The command serializes and records each application in `public.arden_schema_migrations`; never edit an applied migration. Migration 0002 deliberately fails if organizations already exist without a creator mapping; review and prepare an explicit admin backfill before applying it to a populated installation.

Supabase Auth owns passwords and email confirmation. Invitation account setup is non-enumerating; after verification, the invite link must be reopened and accepted by a matching session. Arden stores the verified Supabase UUID and profile, not password hashes or rows in Supabase's internal `auth` schema. Organization creation provisions the creator as first Org Admin and assigns the initial department/default role in one transaction. Configure Supabase Auth email confirmation/SMTP separately from Arden's invitation SMTP. Invitation delivery uses the all-or-nothing server settings `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, and `SMTP_FROM`; keep credentials in Coolify runtime secrets. `secure=true` uses implicit TLS (normally port 465); `secure=false` requires STARTTLS (normally port 587), and the API fails the send if the server cannot negotiate encryption. Connection, greeting, and socket timeouts are bounded. In authenticated deployments, including all four current hosted slots, `ARDEN_PUBLIC_WEB_ORIGIN` must also be configured to the recipient-accessible web origin. The historical dev-2 no-login test mode described in section 3 can send test invitations only with all six SMTP settings; otherwise it uses a mail sink. Its links target the developer's local frontend, and its behavior does not establish the current slots' email configuration. SMTP behavior is request-tested but real provider delivery is not verified until a message is received.

Google sign-in uses Supabase Auth PKCE through Arden's backend. Enable only the Google provider in the self-hosted Supabase Auth service, keep its Google client secret in Coolify, and allow the exact Arden callback `${ARDEN_PUBLIC_WEB_ORIGIN}/api/v1/auth/google/callback`; desktop also requires `${ARDEN_PUBLIC_API_ORIGIN}/api/v1/auth/google/callback`. `ARDEN_PUBLIC_API_ORIGIN` must match the origin reachable through desktop `ARDEN_CORE_URL`. A first-time Google-only account is routed to Arden's password-creation screen; the API calls Supabase `updateUser` and marks that setup complete, so subsequent sign-in can use either Google or the same verified email and password. Access and refresh tokens remain in HttpOnly cookies on web and OS-encrypted desktop storage. Do not expose the Google secret, service-role key, or Supabase session tokens to the renderer.

The API uses Nodemailer as its SMTP client; no provider SDK is needed for Gmail or Mailjet. Its current SMTP authentication supports username/password, not Gmail OAuth2. Example Coolify API environment values for Gmail are `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=465`, `SMTP_SECURE=true`, `SMTP_USER=<sender Gmail address>`, `SMTP_PASS=<Google App Password>`, and `SMTP_FROM=Arden <sender Gmail address>`. Google's App Password option requires 2-Step Verification and may not be available for some managed accounts; Google recommends Sign in with Google where supported. For Mailjet SMTP relay use `SMTP_HOST=in-v3.mailjet.com`, `SMTP_PORT=587`, `SMTP_SECURE=false`, the account's SMTP API key as `SMTP_USER`, its secret as `SMTP_PASS`, and a sender address/domain verified by the provider as `SMTP_FROM`. Store `SMTP_PASS` in Coolify's runtime secrets, never commit it or expose it as a client variable. If Coolify shares these variables across resources, all API resources that consume them can send invitations when their auth path is enabled; Supabase Auth confirmation mail has separate SMTP settings. These examples are configuration recipes, not evidence that provider credentials, sender authorization, DNS, or real delivery have been tested.

`pnpm --filter @arden/api test` includes opt-in live Supabase Auth and PostgreSQL/RLS suites. Configure `ARDEN_TEST_SUPABASE_*` with a synthetic account in a dedicated Supabase project. Configure `ARDEN_TEST_DATABASE_URL` with a dedicated PostgreSQL URL to an already-migrated disposable database named `arden_test_*`; the suite creates and removes its own synthetic Arden profiles, organization, memberships, roles, and notes. Both suites skip when their settings are absent. Never point either at shared Coolify environments.

Mainflow 2 shared-draft creation requires migrations 0006, 0007, and 0008 in sequence before the new API route is used. Migration 0008 adds an author-scoped idempotency key and private-source-only runtime RLS; it does not enable editing, submission, review, or publication. See [the function-1 contract](mainflow-2-group-1-create.md). Verify 0008 with the opt-in disposable PostgreSQL/RLS suite before deployment; local unit tests alone cannot establish SQL policy behavior.

PDF shared-draft submission requires `0013_pdf_shared_drafts.sql` and then `0014_pdf_snapshot_mime_not_null.sql` after 0012. Together they widen `ck_shared_submission_flow2_snapshot` to accept `application/pdf` alongside `text/plain` while preserving the original non-null MIME requirement; a `CHECK` expression containing only `mime_type IN (...)` does not reject `NULL`. The API does not apply migrations at startup. On 2026-10-14, the aligned `dev-3` Supabase development database recorded both 0013 and 0014 after rollback rehearsals and post-commit constraint/ledger checks. Staging and production were not changed. Apply both migrations in order to any other target with its reviewed migration-owner procedure before enabling PDF submission there.

Migration `0015_org_admin_member_profiles.sql` adds a `SELECT`-only RLS policy so the verified Org Admin transaction can read account profiles belonging to memberships in its current organization. This restores member directory rows and reviewer-grant target checks after invitation acceptance; it does not change self-read, writes, or other organizations. On 2026-10-15 it was rehearsed with rollback, then applied to the `dev-3` Supabase development database; post-commit checks confirmed the invitation-accepted member appeared, a reviewer-grant insert succeeded in a rollback-only transaction, ordinary member and other-organization contexts remained denied, and the migration ledger recorded 0015. No real reviewer authority was granted by the rehearsal. Staging and production were not changed. Apply 0015 with the reviewed migration-owner procedure to other targets before relying on this fix. The opt-in disposable PostgreSQL integration suite has regression cases for administration visibility, reviewer-grant creation, ordinary-member denial, and tenant isolation; it was not run on a disposable database in this environment.

Migration `0016_fix_flow2_cross_actor_validation.sql` repairs reviewer approval/publication under the forced-RLS runtime role. It validates Flow 2 audit and publication tenant ownership from the submission's explicit organization instead of querying the submitter's membership, which is intentionally hidden from another member, and replaces circular current-publication write policies with approved-submission checks while retaining the exact-pointer validation trigger. On 2026-10-16 the migration DDL and an existing cross-member approve/publish transaction were exercised on `dev-3` inside one rollback-only transaction as `arden_runtime`; the review decision, separate review and system audit events, published version, current pointer, and deferred constraints all succeeded, then all schema and data changes were rolled back. Migration 0016 was then applied atomically with the reviewed `supabase_admin` migration-owner role and recorded in the `dev-3` hosted ledger; post-commit checks confirmed both replacement functions remain `SECURITY INVOKER`, both current-publication policies exist, the pending submission was unchanged, and API readiness returned 200. Staging and production were not changed. Apply 0016 with the reviewed migration-owner procedure to other targets before expecting the reviewer UI to publish successfully there. The new real-PostgreSQL regression test also requires a migrated disposable `arden_test_*` database and was skipped here because `ARDEN_TEST_DATABASE_URL` was not configured.

Migration `0018_flow3_contract_and_test_content_reset.sql` contains the approved development test-content reset, including private/shared drafts, review/publication records, chunks and AI artifacts. It preserves organization/identity structures but is not a data-preserving upgrade. Merging Flow 3 into `staging` does not authorize applying this reset to staging/production data. Inspect the actual ledger and data, verify recovery and obtain target-specific reset approval before applying it to a shared release database. The release pipeline's migration fingerprint gate must remain in place; do not bypass it to deploy the merged source.

Migration `0020_permission_aware_answer_sources.sql` grants the runtime role a narrow `SELECT` on READY index generations only when the same actor can still see the matching active publication through existing publication RLS. It supplies Core's generation allow-list for Ask Arden; it does not authorize Chroma directly or grant Arden-AI database access. Rehearse and apply it once with the reviewed migration connection before enabling the answer route. Verify an authorized actor receives only matching generation IDs and a revoked/non-audience actor receives none. Local unit tests do not establish this SQL behavior.

For Coolify, mount `ARDEN_PRIVATE_STORAGE_ROOT` to persistent private storage with API-only access and include it in the protected backup/restore plan with PostgreSQL. Production API startup refuses to run when this path is unset. Set `ARDEN_CORE_URL` in the desktop launch environment to the public HTTPS origin; the desktop bridge rejects non-loopback HTTP and URL paths. A packaged settings UI and the complete staging/production application release stack are not implemented.

Hosted backend commands now exist: `pnpm dev:remote`, `pnpm remote:preview`, and `pnpm remote:status`. They keep Vite local, use private SSH forwarding, and support four development slots. See [the authoritative setup/operations guide](remote-development.md), including [the current team layout](remote-development.md#current-team-layout), [database/storage readiness](remote-development.md#database-and-storage-readiness-before-onboarding), and [adoption into Coolify](remote-development.md#coolify-adoption). Bootstrap remains separate from Coolify registration; adopted installations use the protected management marker to start existing managed development containers without recreating legacy stacks. Development was reconciled to four personal APIs on 12 October 2026. The provisioner creates separate staging/production database templates only; application releases and Supabase Storage/Realtime integration remain incomplete.

## 2. Ports, environment, and configuration

| Setting | Current local default | Requirements |
| --- | --- | --- |
| Web development | `127.0.0.1:5180` | Strict port, loopback binding; `/api` development proxy |
| Desktop renderer development | `127.0.0.1:5181` | Strict port, development only |
| `ARDEN_API_HOST` | `127.0.0.1` | Deliberate bind address; container/service binding is a deployment decision |
| `ARDEN_API_PORT` | `3001` | Validate numeric port/range when central configuration is implemented |
| `ARDEN_POSTGRES_PORT` | `5433` | Local Compose host mapping; PostgreSQL inside container uses 5432 |
| `DATABASE_URL` | Local dev URL in `.env.example` / API fallback | API connection; production login must be non-superuser/non-`BYPASSRLS` and permitted to `SET ROLE arden_runtime` |
| `ARDEN_MIGRATION_DATABASE_URL` | Unset | Optional locally; production migration connection when the API `DATABASE_URL` is restricted. Never expose it to the running API or client |
| `SUPABASE_URL` | Unset locally | Supabase project Auth/API URL reachable from the API container |
| `SUPABASE_PUBLISHABLE_KEY` | Unset locally | Project publishable/anon key used by the server-side Supabase Auth adapter; never substitute a service-role key |
| `ARDEN_AUTH_TRUSTED_ORIGINS` | Local Vite origins | Comma-separated exact client origins allowed to use Arden's cookie-authenticated API; production requires HTTPS |
| `ARDEN_PUBLIC_WEB_ORIGIN` | Unset | Exact public web origin for invitation links; required to send invitations |
| `ARDEN_PUBLIC_API_ORIGIN` | Unset | Exact public API origin used by the desktop Google OAuth callback; HTTPS is required in production |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Unset | Configure all six together for organization invitation email; runtime secrets stay API-side |
| `ARDEN_PRIVATE_STORAGE_ROOT` | `.private/note-content` default | Required in production; must resolve to a protected persistent mount outside the image/static web root |
| `ARDEN_CORE_URL` | `http://127.0.0.1:3001` for local desktop | Public HTTPS Core origin for the Windows desktop process; loopback HTTP is allowed only for local development |
| `ARDEN_AI_URL` | Unset | Private HTTP(S) origin of Arden-AI, with no path or credentials; configure together with the service token |
| `ARDEN_AI_SERVICE_TOKEN` | Unset | Server-only shared credential for Core/worker to call Arden-AI; never expose it to web/desktop clients |
| `ARDEN_TEST_DATABASE_URL` | Unset | Optional real-PostgreSQL integration target; must be a disposable, pre-migrated database named `arden_test_*` |
| `ARDEN_LOCAL_FLOW1_TEST_MODE` | Unset | Manual local browser-test auth; only `true` with loopback API/PostgreSQL, database `arden_test_*`, no Supabase config, and non-production mode |
| `ARDEN_LOCAL_TEST_USERS` | Unset | JSON list of synthetic `@example.test` accounts, required only in fenced local Mainflow 1 test mode; keep the passwords in the launching shell, not files/Git |
| `ARDEN_TEST_SUPABASE_*` | Unset | Optional live Supabase Auth smoke test using a synthetic account in a dedicated test project |

- Current API reads shell/process environment and dev defaults; `.env.example` is a reference. It does not mean Fastify/tsx automatically load an API `.env` file. Introduce explicit loading/validation if needed and document precedence.
- Keep secret values out of tracked env/config files. Track sanitized examples with descriptions, defaults, required status, consumer, and restart/build implications. Treat `.env.production` as sensitive even if the current ignore patterns do not cover it.
- Vite client env values are build-time public values. Future runtime public config must remain distinct from server secrets and support the same immutable artifact in staging/production.
- Production startup must fail closed on missing/invalid critical configuration. No dev password, default administrator, disabled auth/TLS, or cloud fallback may become an implicit production setting.
- Supabase Auth URL/publishable key, exact cookie origins, protected storage root, desktop Core URL, migration connection, and gated PostgreSQL/Supabase test connections are implemented for the first slice; connector credentials, model profiles, resource limits, and retention remain future configuration surfaces. Keep actual values out of tracked files.

## 3. Isolated local development for every developer

For local Mainflow 1 browser testing before Supabase is available, `ARDEN_LOCAL_FLOW1_TEST_MODE=true` selects a process-memory test auth provider and an invitation mail sink. This mode is deliberately fenced: `NODE_ENV` must not be `production`; Supabase variables must be absent; `ARDEN_API_HOST` must be loopback; `DATABASE_URL` must connect directly to loopback PostgreSQL and a database named `arden_test_*`; and `ARDEN_LOCAL_TEST_USERS` must contain only synthetic `@example.test` accounts with passwords of at least 16 characters. The migration URL may use a privileged local account for this disposable database. Do not use an SSH tunnel, Coolify hostname, shared dev database, or real account/email. Test invitations are persisted as pending, but no email is sent and acceptance is not part of this local sign-in mode. The live Supabase adapter remains the only non-test authentication path.

For all four current hosted development slots, including `dev-2`, `.private/remote.json` supplies the SSH alias and assigned slot settings. `pnpm remote:status` reads the server writer status; `pnpm dev:remote` acquires the slot lease, uploads only allowlisted backend source/manifests, invokes the exact slot startup helper, forwards the loopback-only server API port over SSH to local port 3001, checks API readiness, then starts the local web frontend at `http://127.0.0.1:5180`. Sign in with an application account in the slot's configured Supabase Auth service; SSH access does not sign you into Arden. Backend edits sync while the session runs. Stop with Ctrl+C before changing branches. The command never runs database migrations, does not expose the API publicly, and does not upload `.private`, UI source, local env files, or dependencies. Do not use it for staging or production. Follow [the teammate setup guide](teammate-setup.md) and [the current team layout](remote-development.md#current-team-layout).

Historical no-login test mode: the code still contains a synthetic actor for Kiet's earlier hosted test target. It activates only with `NODE_ENV=development`, PostgreSQL host `postgres`, database name `arden_dev_2`, and no Supabase URL/key. This mode is inactive in the current four-slot layout: the dev-2 API now uses a Supabase database and configured Auth service. Do not remove Supabase settings or switch databases to regain no-login access. If an administrator explicitly provisions the old test target, keep its API host port bound to `127.0.0.1` and use the assigned SSH tunnel. The actor is not authentication; test writes persist in that dedicated database. Invitations use a mail sink unless all six SMTP settings are configured, and their links target only the developer's local frontend. Account creation, invitation acceptance, real login, and cross-user/session authorization are not tested by this mode. A migration or rehearsal against that earlier target is not evidence for the current Supabase database.

- Each developer uses their own local database, attachments, credentials, model configuration, and synthetic users/organizations. Local work does not connect to production by default.
- Multiple checkouts on the same machine need distinct Compose project names/volumes and distinct host ports. The current web/desktop strict ports must also be changed explicitly for simultaneous sessions; do not silently attach to someone else's server when a port is occupied.
- Verify the resolved Compose project/volume/database before stopping, migrating, resetting, or deleting anything. An environment variable or matching database name is not enough evidence of a disposable target.
- Test databases must be explicitly disposable, separate from developer and customer data. Create/reset only the named test target; do not use a broad cleanup command or automatic volume deletion.
- `docker compose down` preserves named volumes by default; `down -v` is destructive and is not normal shutdown. Obtain explicit data-loss authorization for non-disposable targets.
- Keep connector sandbox tokens/destinations separate and use fakes for routine tests. Do not let a test create real Jira issues or send private documents to an external model inadvertently.
- Local development may run host web/API/worker with database/model containers. The accepted hybrid alternative runs four hosted development APIs/databases with local Vite frontends; see [remote-development.md](remote-development.md). No public development ports or production database access are implicit.
- Prefer cross-platform package scripts and literal-path PowerShell operations on Windows. Do not solve Docker/runtime issues by deleting broad Docker/user directories, bypassing security, or disabling unrelated system protections.

## 4. Staging, production, and the customer install

- Staging and production are separate Coolify environments/stacks, optionally in the same project, with separate domains, database volumes, attachment storage, secrets, connector accounts/scopes, model settings, and backup destinations/access. A Coolify project/environment label alone does not enforce data or network isolation.
- A branch name is not isolation. Preview environments, if added, are disposable separate stacks with synthetic data and disabled/sandboxed outbound actions. Do not point preview code at production DB/files/tokens.
- Production data goes to staging only through an explicitly approved sanitization process with privacy/access/retention checks. Restoring a private backup into a testing environment is still disclosure.
- The intended full application Compose includes web, API, worker, Supabase PostgreSQL/Auth/Storage/Realtime, and optional Ollama or a configured private model host. Full Supabase is not provisioned by the lean hosted scaffold. The current root `compose.yaml` only supplies local PostgreSQL.
- Expose web/API through the customer reverse proxy with TLS. Database, worker, storage internals, and model ports stay private. Scope proxy trust and origins; do not expose an admin DB console as a convenience.
- Use versioned/pinned images and reviewed digests for released deployments, verified base images, least-privilege users/capabilities where feasible, and explicit volume ownership/resource limits. Never give application containers the host Docker socket for ordinary product functions.
- Persistent state must live in named protected volumes/storage, not the writable image layer. Keep uploads/model caches out of the static web root. Establish disk quotas and free-space alerts.
- A clean installation needs a documented/setup-validated path for domain, initial administrator, secrets, storage, model endpoint/capacity, and backups. Bootstrap must be single-use/controlled, never a permanent unauthenticated admin route.
- The earlier 4 vCPU/12 GB pilot target is not a verified allocation. Measure current capacity for four hosted development APIs plus release/Supabase services; increase or split infrastructure when needed. Private AI stays on a separate customer-controlled machine. No fixed allocation guarantees customer capacity or HA.
- Measure CPU/RAM/disk, indexing lag, concurrent requests, and model latency. Apply backpressure/concurrency limits; do not let extraction/inference exhaust the API/database host.

Reference: [Coolify Compose deployments](https://coolify.io/docs/applications/builds/docker-compose). Check the installed Coolify version/features before writing a concrete setup procedure.

## 5. CI and reproducible builds

- Current `.github/workflows/ci.yml` runs frozen install, typecheck, tests, and build on Ubuntu and Windows for pushes and PRs. It does not currently validate branch names or configure GitHub branch protections.
- Maintain lockfile, Node/pnpm versions, and workspace configuration consistently between local and CI. A frozen install failure is a real mismatch, not a reason to remove `--frozen-lockfile`.
- Keep CI secrets scoped and unavailable to untrusted fork code. Use minimum token permissions; do not use privileged workflow triggers to execute untrusted PR contents with secrets.
- Review third-party actions, install scripts, native binaries, and supply-chain changes. Pin actions to verified immutable revisions when hardening/changing release workflows; the existing action tags are not immutable pinning.
- Do not introduce real production credentials, private corpora, external writes, or unrestricted AI egress into ordinary CI. Tests/build logs and artifacts are data destinations too.
- Test actual release artifacts and supported client/server combinations, not only source in hot reload. A successful CI scaffold build is not a production security or installer guarantee.

## 6. Release promotion, migrations, and compatibility

- Build an immutable release artifact once, deploy it to staging, and promote the same verified digest to production after applicable checks. Use environment-specific runtime config/secrets, not a silent second build.
- A deployment request does not authorize arbitrary customer/schema changes. Confirm target, version, required secrets, maintenance expectations, and data-loss implications before execution.
- Run reviewed migrations **once** with locking/serialization under an appropriate migration role. Do not race multiple API/worker startup migrations or use schema push on staging/production.
- Before migration: verify target identity, current schema/version, backup/restore viability, estimated lock/disk/time impact, and old API/desktop compatibility.
- Prefer expand -> migrate/backfill -> verify -> contract. Nullable/default/backfill behavior for existing rows must be intentional; a schema edit does not magically create/populate data.
- Test clean install and populated-version upgrade, interruption/retry, worker queue/schema compatibility, permission policy, and rollback/restore consequences. Long backfills need progress, bounded batching, and resumability.
- Do not edit migrations already applied to a shared environment. Fix forward with a new reviewed migration. A down script is not automatically safe recovery after new writes; restoring may lose data and needs a documented procedure.
- The API must eventually advertise/support a defined desktop version range. Do not remove contract fields or formats while supported installed clients still depend on them.
- Preserve drafts and reject incompatible operations gracefully. Coordinate server/schema/worker/desktop changes and document customer update order.
- Signed versioned Windows binaries, verified update manifests/artifacts, a customer-controlled feed or manual installers, and a tested support matrix are release requirements—not implemented current features.

## 7. Backup, restore, retention, and disaster recovery

- Coolify deployment management is not proof of an application-consistent backup. Back up PostgreSQL **and** attachments plus necessary configuration, credentials, and encryption-key recovery under restricted access.
- Protect backups with encryption, off-host storage, least privilege, tested key recovery, and a defined retention policy. Do not put backup archives/key material in Git or general CI artifacts.
- Preserve compatible DB/file versions and references. Define how backups are made consistent during writes, how source sync is paused/reconciled, and how recovery avoids duplicate external actions.
- Define required RPO/RTO with the customer before making reliability promises. The blueprint has not selected these targets; do not invent a contractual number in implementation.
- Run restoration rehearsals against isolated approved targets and verify login, content/attachments, permissions, governance snapshots, search/reindex behavior, jobs, and version compatibility. "Backup file exists" is not a restore test.
- Backups containing production secrets/data remain sensitive even on staging. Prevent restored connectors/jobs from writing to external production systems until explicitly re-enabled and reconciled.
- Model weights may be reproducible downloads, but air-gapped/private operation may require an approved model/package mirror with checksums/licenses. Do not assume network access during recovery.
- Document deletion/retention effects on backups and restore-time tombstone/revocation handling. Restoring old snapshots must not silently reactivate access or erased content.
- A single Coolify host is a pilot single point of failure. HA/failover is a separate accepted architecture/operations project, not an automatic capability of Compose.

## 8. Observability and operational safety

- Provide bounded liveness/readiness checks, request errors/latency, queue depth/age/failures, source sync lag, extraction/indexing state, disk/volume capacity, model latency/errors/concurrency, and auth/security/audit alerts as features appear.
- Logs/metrics/traces must avoid private bodies/prompts/tokens/credentialed URLs. Use safe IDs/correlation metadata and customer-controlled destinations; optional external telemetry needs explicit approval.
- Configure sensible per-organization limits and backpressure for uploads, extraction, graph/search queries, exports, inference, and connector backfills. Show actionable failure/staleness state to the user.
- Gracefully stop API, database pools, streams, and workers. Jobs need cancellation/draining/retry semantics so deployments do not silently lose acknowledged work.
- Diagnose with read-only checks first. Never delete user data, reset production, rotate customer credentials, upgrade infrastructure, or send external notifications as an assumed debugging step.
- For destructive maintenance, resolve exact targets, verify scope/environment/backups, obtain applicable authorization, prefer recoverable operations, and report what was removed and recovery options.
- Maintain customer-facing install/upgrade/backup/restore/troubleshooting runbooks as implementation matures. Do not label planned procedures as tested; record the actual release/environment used for rehearsal.


## Core indexing database capability

Provision a distinct non-superuser login for each environment's Core indexing worker after the
reviewed schema migrations, using an administrator session and a privately generated password.
The API request login keeps only its existing `arden_runtime` membership; do not grant it the
indexing capability. The indexer role can execute only the reviewed claim/complete/fail functions,
not read private document tables directly. For example, with placeholders replaced:

```sql
CREATE ROLE arden_index_worker LOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
-- Set the password privately through the administrator's secure credential workflow.
GRANT arden_indexer TO arden_index_worker;
GRANT CONNECT ON DATABASE app_database TO arden_index_worker;
```

For the embedded Core worker, set the private `ARDEN_INDEX_DATABASE_URL` to that login's app
database connection alongside `ARDEN_AI_URL` and `ARDEN_AI_SERVICE_TOKEN`. Its separate pool
has a bounded connection wait; transactions bound SQL/lock waits. The standalone worker uses its
own `DATABASE_URL` with the same indexer login and must not run concurrently merely as a duplicate
of the embedded worker. No worker/database credentials belong in GitHub build jobs or client bundles.
Idle connection errors on the embedded worker's separate pool are logged without database error
details; they do not terminate Core. Subsequent polls reconnect. The disposable built-process
regression terminates an actual idle worker backend and checks API readiness and reconnection.

Both entry points default to a 300-second lease; `ARDEN_INDEX_LEASE_SECONDS` accepts 180–600
seconds, longer than the 120-second bounded AI call with a completion margin. Monitor local storage
and database latency; an unhealthy filesystem is not a latency guarantee. No AI configuration means
Core indexing is disabled and answers unavailable. A partial AI origin/token pair fails explicitly. If AI is enabled but the separate worker connection is missing, the API remains available and logs that embedded indexing is disabled; provision the worker before expecting new publications to activate.

Migration 0021 preserves earlier migration history, serializes activation per draft and prevents a
delayed older job from replacing any newer published snapshot, including after unpublication.
`SUPERSEDED` denotes historical approved snapshots replaced by a newer publication; it is distinct
from indexing failure. Superseded jobs fail terminally without retrying model work. The legacy
unordered function is no longer executable by the worker. Existing publications are not automatically
republished or repaired; review any pre-existing stale pointer separately. Core and web must be
released together for the expanded state contract. A live schema upgrade still requires a separate
reviewed backup, compatibility/recovery plan and explicit authorization; this guide is not consent.
