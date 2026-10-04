# Development, deployment, and operations rules

Read [AGENTS.md](../../AGENTS.md), [the technology guide](technology-guide.md), and [security/data rules](security-and-data.md). This is operational policy for the intended product. The repository has local and hosted API/database development scaffolding plus CI; it has no complete Supabase/Coolify release, worker, migration command, installer, or backup automation yet.

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
| `pnpm dev` | Start API and web host processes |
| `pnpm dev:api` | API hot reload with tsx |
| `pnpm dev:web` | Vite web development server |
| `pnpm dev:desktop` | electron-vite desktop development |
| `pnpm typecheck` | Run package typecheck scripts |
| `pnpm test` | Run existing package test scripts (currently API health tests only) |
| `pnpm build` | Run existing package build scripts; does not produce a signed installer |
| `pnpm --filter @arden/api start` | Run built API, after build and required environment setup |
| `pnpm --filter @arden/desktop preview` | Preview a built desktop application, not a deployment/signing check |

There are no root lint, migration, seed, worker, E2E, packaging, deploy, or backup scripts yet. Add the corresponding implementation and documentation together before listing them as runnable procedures.

Hosted backend commands now exist: `pnpm dev:remote`, `pnpm remote:preview`, and `pnpm remote:status`. They keep Vite local, use private SSH forwarding, and support four development slots. See [the authoritative setup/operations guide](remote-development.md), including [adoption into Coolify](remote-development.md#coolify-adoption). Bootstrap remains separate from Coolify registration; adopted installations use the protected management marker to start existing managed development containers without recreating legacy stacks. The current provisioner creates separate staging/production database templates only; application release deployment and full Supabase service integration remain absent.

## 2. Ports, environment, and configuration

| Setting | Current local default | Requirements |
| --- | --- | --- |
| Web development | `127.0.0.1:5180` | Strict port, loopback binding; `/api` development proxy |
| Desktop renderer development | `127.0.0.1:5181` | Strict port, development only |
| `ARDEN_API_HOST` | `127.0.0.1` | Deliberate bind address; container/service binding is a deployment decision |
| `ARDEN_API_PORT` | `3001` | Validate numeric port/range when central configuration is implemented |
| `ARDEN_POSTGRES_PORT` | `5433` | Local Compose host mapping; PostgreSQL inside container uses 5432 |
| `DATABASE_URL` | Local dev URL in `.env.example` / API fallback | Required when `NODE_ENV=production`; never a public client setting |

- Current API reads shell/process environment and dev defaults; `.env.example` is a reference. It does not mean Fastify/tsx automatically load an API `.env` file. Introduce explicit loading/validation if needed and document precedence.
- Keep secret values out of tracked env/config files. Track sanitized examples with descriptions, defaults, required status, consumer, and restart/build implications. Treat `.env.production` as sensitive even if the current ignore patterns do not cover it.
- Vite client env values are build-time public values. Future runtime public config must remain distinct from server secrets and support the same immutable artifact in staging/production.
- Production startup must fail closed on missing/invalid critical configuration. No dev password, default administrator, disabled auth/TLS, or cloud fallback may become an implicit production setting.
- Core URL, auth origins, connector credentials, storage roots, model profiles, resource limits, and retention are future configuration surfaces. Do not invent undocumented environment names or claim they already work.

## 3. Isolated local development for every developer

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
