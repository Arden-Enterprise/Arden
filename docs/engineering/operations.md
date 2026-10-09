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

There are no root lint, seed, worker, E2E, packaging, deploy, or backup scripts. Apply pending database migrations explicitly with `pnpm --filter @arden/api db:migrate`; they are not run automatically by API startup. Migration 0002 adds organization bootstrap, departments/default roles, role-tag permissions, and invitations. Migration 0003 removes a scope/role-assignment recursive RLS dependency and is applied to Kiet Local `arden_dev_2`. A rollback-only bootstrap rehearsal exposed a second recursion: the role visibility policy queried `role_assignment` while a role-assignment write was checking the target role. Migration 0004 removes that dependency by deriving role visibility from the active organization, actor memberships, or global system-role status. It was rehearsed and applied to the exact Kiet Local `arden_dev_2` database. The rehearsal completed all organization-bootstrap statements under `arden_runtime`, then rolled back; it created no organization. Migration 0005 permits reading accepted invitations by the accepting actor, fixing the RLS violation when updating invitation status from PENDING to ACCEPTED under `arden_runtime`; it is applied to Kiet Local `arden_dev_2` and its acceptance transaction was rehearsed and verified under `arden_runtime`. The initial failed organization-creation requests also rolled back. This limited check does not verify invitation writes, every RLS path, or a clean installation.

The migrations create Arden's `arden` schema, enable and force row-level security on domain tables, and create the non-login, non-superuser `arden_runtime` role. Supabase owns its Auth schema and credentials; Arden migrations must not create, alter, or grant access to Supabase-managed Auth tables. The API database login must be provisioned separately and granted membership in `arden_runtime`. Apply domain migrations with a distinct reviewed migration connection and verify the target is disposable/local before first use. The command serializes and records each application in `public.arden_schema_migrations`; never edit an applied migration. Migration 0002 deliberately fails if organizations already exist without a creator mapping; review and prepare an explicit admin backfill before applying it to a populated installation.

Supabase Auth owns passwords and email confirmation. Invitation account setup is non-enumerating; after verification, the invite link must be reopened and accepted by a matching session. Arden stores the verified Supabase UUID and profile, not password hashes or rows in Supabase's internal `auth` schema. Organization creation provisions the creator as first Org Admin and assigns the initial department/default role in one transaction. Configure Supabase Auth email confirmation/SMTP separately from Arden's invitation SMTP. Invitation delivery uses the all-or-nothing server settings `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, and `SMTP_FROM`; keep credentials in Coolify runtime secrets. `secure=true` uses implicit TLS (normally port 465); `secure=false` requires STARTTLS (normally port 587), and the API fails the send if the server cannot negotiate encryption. Connection, greeting, and socket timeouts are bounded. In the Kiet Local dev-2 no-login test mode, these settings opt invitation delivery into real SMTP; without all six, invitations remain saved with no email. The invite link in that test mode targets the local developer frontend, so it only opens on the developer's machine. In regular authenticated deployments, `ARDEN_PUBLIC_WEB_ORIGIN` must also be configured to the recipient-accessible web origin. SMTP behavior is request-tested but real provider delivery is not verified until a message is received.

The API uses Nodemailer as its SMTP client; no provider SDK is needed for Gmail or Mailjet. Its current SMTP authentication supports username/password, not Gmail OAuth2. Example Coolify API environment values for Gmail are `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=465`, `SMTP_SECURE=true`, `SMTP_USER=<sender Gmail address>`, `SMTP_PASS=<Google App Password>`, and `SMTP_FROM=Arden <sender Gmail address>`. Google's App Password option requires 2-Step Verification and may not be available for some managed accounts; Google recommends Sign in with Google where supported. For Mailjet SMTP relay use `SMTP_HOST=in-v3.mailjet.com`, `SMTP_PORT=587`, `SMTP_SECURE=false`, the account's SMTP API key as `SMTP_USER`, its secret as `SMTP_PASS`, and a sender address/domain verified by the provider as `SMTP_FROM`. Store `SMTP_PASS` in Coolify's runtime secrets, never commit it or expose it as a client variable. If Coolify shares these variables across resources, all API resources that consume them can send invitations when their auth path is enabled; Supabase Auth confirmation mail has separate SMTP settings. These examples are configuration recipes, not evidence that provider credentials, sender authorization, DNS, or real delivery have been tested.

`pnpm --filter @arden/api test` includes opt-in live Supabase Auth and PostgreSQL/RLS suites. Configure `ARDEN_TEST_SUPABASE_*` with a synthetic account in a dedicated Supabase project. Configure `ARDEN_TEST_DATABASE_URL` with a dedicated PostgreSQL URL to an already-migrated disposable database named `arden_test_*`; the suite creates and removes its own synthetic Arden profiles, organization, memberships, roles, and notes. Both suites skip when their settings are absent. Never point either at shared Coolify environments.

For Coolify, mount `ARDEN_PRIVATE_STORAGE_ROOT` to persistent private storage with API-only access and include it in the protected backup/restore plan with PostgreSQL. Production API startup refuses to run when this path is unset. Set `ARDEN_CORE_URL` in the desktop launch environment to the public HTTPS origin; the desktop bridge rejects non-loopback HTTP and URL paths. A packaged settings UI and an actual Coolify stack are not implemented.

Hosted backend commands now exist: `pnpm dev:remote`, `pnpm remote:preview`, and `pnpm remote:status`. They keep Vite local, use private SSH forwarding, and support four development slots. See [the authoritative setup/operations guide](remote-development.md), including [adoption into Coolify](remote-development.md#coolify-adoption). Bootstrap remains separate from Coolify registration; adopted installations use the protected management marker to start existing managed development containers without recreating legacy stacks. The current provisioner creates separate staging/production database templates only; application release deployment and full Supabase service integration remain absent.

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
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Unset | Configure all six together for organization invitation email; runtime secrets stay API-side |
| `ARDEN_PRIVATE_STORAGE_ROOT` | `.private/note-content` default | Required in production; must resolve to a protected persistent mount outside the image/static web root |
| `ARDEN_CORE_URL` | `http://127.0.0.1:3001` for local desktop | Public HTTPS Core origin for the Windows desktop process; loopback HTTP is allowed only for local development |
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

For the separate Kiet Local hosted development slot, `.private/remote.json` supplies the SSH alias and slot settings. `pnpm remote:status` reads the server writer status; `pnpm dev:remote` acquires the slot lease, uploads only allowlisted backend source/manifests, invokes the exact slot startup helper, forwards the loopback-only server API port over SSH to local port 3001, verifies API readiness and the Kiet Local mock actor, then starts the local web frontend at `http://127.0.0.1:5180`. Backend edits sync while the session runs. Stop with Ctrl+C before changing branches. The command never runs database migrations, does not expose the API publicly, and does not upload `.private`, UI source, local env files, or dependencies. Do not use it for staging or production.

For manual frontend testing without login on Kiet Local, no project-wide test-mode variable is needed. The API automatically uses one fixed, verified synthetic actor only when it detects `NODE_ENV=development`, PostgreSQL host `postgres`, database name `arden_dev_2`, and no Supabase URL/key. These checks uniquely identify the current `dev-2` runtime; if slot configuration changes, update the guard and this guide together. This actor is not authentication. Keep the `dev-2` API host port bound to `127.0.0.1` and reach it only through the assigned SSH account/tunnel. Test writes persist in that dedicated development database. Invitations are saved as pending; they send email only when all six SMTP settings above are present. The invite URL targets the developer's local frontend, so recipients cannot accept from another machine. Account creation, invitation acceptance, real login, and cross-user/session authorization are not tested by this mode. Real identity testing begins only after the dedicated Supabase project is configured.

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
