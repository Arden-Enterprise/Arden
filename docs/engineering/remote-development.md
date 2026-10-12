# Local frontend, hosted development backend

## Layout and scope

| Environment | Frontend | API | Database |
| --- | --- | --- | --- |
| `dev-1` through `dev-4` | Each developer's computer, Vite hot reload | Separate non-root container per slot | Separate Arden application database/login per slot; placement described below |
| Staging | Immutable release, when provisioned | Reviewed release image, when provisioned | Dedicated PostgreSQL instance, volume, secret |
| Production | Same approved release artifact | Same approved image digest | Dedicated PostgreSQL instance, volume, secret |

This replaces the two hosted frontend slot proposal. The development command supports the current Fastify API, including Supabase Auth and the merged organization/private-note flows. It is **not four full Supabase projects**. Supabase Storage/Realtime integration, workers and release applications remain separate work. Supabase is the accepted platform direction; see [decision 0001](../decisions/0001-supabase-and-hybrid-development.md).

Development roles cannot routinely connect to one another's databases, but share compute, maintenance, and a failure domain. Administrator/host access can inspect all environments. Use synthetic data, separate external sandboxes, and no production credentials. Staging/production never share the development database instance.

### Current team layout

The operating layout reconciled on 12 October 2026 differs from the fresh bootstrap template. Do not infer an API's database from its Coolify display label or from an unused logical database with a similar name. Inspect its private runtime configuration before any migration.

| Person / label | Slot | Arden application data | Supabase identity |
| --- | --- | --- | --- |
| Zack / `zack-local` | `dev-1` | Own Arden schema in the Zack Supabase PostgreSQL service | Zack Supabase Auth |
| Kiet / `kiet-local` | `dev-2` | Own Arden schema in the Kiet Supabase PostgreSQL service | Kiet Supabase Auth |
| Khoi / `khoi-local` | `dev-3` | Own Arden schema in the existing Khoi Supabase PostgreSQL service | Shared Khoi/Hung Supabase Auth |
| Hung / `hung-local` | `dev-4` | Dedicated logical application database in the managed development PostgreSQL service | Shared Khoi/Hung Supabase Auth |

All four APIs are Coolify-managed resources in the development Compose service. Each has its own uploaded source/state, dependency volumes, persistent private-note directory and loopback API port. Coolify may render personal labels with spaces/capital letters. The `-local` label describes the development workflow; these backends run on the server.

Khoi and Hung share identity accounts, not Arden application records. An Arden organization or note created in one slot is not automatically copied to another. This saves the cost of operating a fourth full Supabase stack. It also shares Auth configuration, availability and test-email effects, so coordinate changes to that Auth service. Separate databases on a shared host are not independent machines or high availability.

Zack and Hung were initialized from application main `972f0f9` with migrations 0001–0005. Existing Kiet/Khoi source and application data were preserved. A slot may therefore contain teammate work newer than main. Starting `dev:remote` reconciles that slot's backend to **your local checkout**, including removals from its prior manifest; preserve unmerged work and choose the intended branch before starting.

The command was started successfully from the owner's computer. First login and coding-session acceptance on each other teammate's computer are separate onboarding steps. Service health does not establish complete application authorization, SMTP delivery, backup restoration or production readiness.

## Contributor setup

New contributors should follow [Start coding on Arden](teammate-setup.md) for the complete beginner walkthrough, daily commands, Coolify navigation, and troubleshooting. Complete its administrator handoff before broader onboarding. This document is the implementation/operator reference.

1. Install Node.js 24 and the root-pinned pnpm version. Run `pnpm install --frozen-lockfile`.
2. Obtain your approved SSH account/key and assigned slot through the team's private channel. Follow [server-access.md](server-access.md); independently verify the host fingerprint. Never send passwords/private keys to Codex.
3. Copy `deploy/hosted/remote.example.json` to **`.private/remote.json`** in this checkout. Replace the alias/root with approved values and set your default slot. Confirm `git check-ignore .private/remote.json` matches and `git ls-files .private` prints nothing.
4. Ensure key login works. The operator must map your individual SSH account to your slot and grant permission for the root-owned development start entry point. Both uploads and startup verify this assignment; a writer token alone cannot grant access to another slot. The command uses noninteractive SSH and `sudo -n` for that start operation only; it does not change privileges or SSH settings.

Each contributor has their own private file and SSH configuration. Actual aliases, endpoints, ports, account/key paths, credentials, and operational notes must stay out of public GitHub/Linear/reviewer artifacts. There are no machine-specific connection values in the scripts.

## Daily use

```sh
pnpm dev:remote
pnpm dev:remote --slot dev-2
```

Use your assigned slot. Open the local URL Vite prints, normally `http://127.0.0.1:5180`. The local frontend proxies `/api` through a loopback SSH tunnel to the hosted API. No database credentials enter the frontend. No public development domain or database port is required.

| Edit | Result |
| --- | --- |
| UI source | Local Vite hot reload, subject to normal Vite state-preservation rules |
| API/server package source | Saved file delta uploaded; `tsx watch` restarts the API |
| Backend manifest, workspace config, lockfile | Frozen Linux dependency reinstall and restart; wait for readiness |
| SQL/schema | Source sync only; migrations are explicit, not automatic |
| Container/bootstrap config | Reviewed operator update; excluded from automatic sync |

The source scanner runs about every 750 ms. SSH latency and API restarts add delay. Each file is replaced atomically; a multi-file save can cause a temporary compiler error while its remaining files arrive. This is a small-source workflow, limited to 2 MiB per file and 16 MiB total, rather than a large asset transfer system.

The allowlist includes `apps/api`, existing selected server packages (`domain`, `db`, `ai`, `api-client`), workspace manifests, and TypeScript config. Hidden paths, Git-ignored files, credential-like filenames, symlinks, dependency/build/data/backup/fixture directories are excluded. Add a new backend package to both client/server allowlists deliberately. These exclusions cannot detect a secret hardcoded in ordinary source; follow [private-files.md](private-files.md).

Linux dependencies come from the pinned lockfile; Windows `node_modules` is never uploaded. The container runs as non-root, has a read-only source mount, separate writable dependency volumes, capability restrictions, and no sudo or Docker socket.

## Viewing and shutdown

```sh
pnpm remote:status --slot dev-1
pnpm remote:preview --slot dev-1
```

Status reports writer occupancy and uploaded file count, not comprehensive service health. Preview starts **your local frontend** against that slot's API without uploading or acquiring a writer lease. It does not host the exact frontend another developer has locally; use their branch locally to view that UI. Viewers need their own approved SSH access.

One writer per slot is enforced. A second writer is rejected. Ctrl+C stops your frontend/tunnel and releases your lease; the hosted API and database volumes stay running. After a crash or disconnected cleanup, the lease expires after five minutes. Restart for a complete reconciliation. Never delete another writer's lease to take over their slot.

The local API port defaults to 3001; change `localApiPort` in private configuration if occupied. Do not run `pnpm dev` alongside this command on that port. Tunnel failure exits visibly; Vite also fails on an occupied web port. Frozen dependency-install failure requires fixing the manifest/lockfile and restarting, not disabling safeguards. Electron remains local; this command wires web development only.

## Operator setup and maintenance

Review `deploy/hosted` and copy the public bootstrap files to a private temporary server directory. Verify that the intended project directory is new and dedicated. In the operator's terminal, substitute approved private values:

```sh
sudo -n python3 provision.py /srv/DEDICATED_PROJECT_DIRECTORY DEV1_ACCOUNT DEV2_ACCOUNT DEV3_ACCOUNT DEV4_ACCOUNT
```

The bootstrap requires four distinct existing non-root SSH accounts in slot order and refuses an existing target. It creates root-owned controls/Compose configuration and slot assignments, private generated credentials, four development source/state directories, and isolated staging/production **database templates**. Slot identity and parent directories stay root-owned; each contributor owns only their assigned source/state. Each API has its own dependency volumes and writable pnpm cache. It does not start containers, alter sudo/SSH policy, or deploy a production application. Build/start the named development Compose project and inspect readiness. Use `compose config --quiet`; full rendered config can reveal secrets.

The development PostgreSQL instance has a 768 MiB limit; each API has 384 MiB, plus CPU/process/log limits. These are scaffold limits, not full-product capacity guarantees. Database initialization creates four non-superuser logins, prohibits role/database creation, and revokes public `CONNECT` grants. Initialization runs only for a fresh named volume. Never delete a volume to rerun it. Normal shutdown does not use `down -v`.

The default contributor policy grants only the required root-owned `start.py` invocation. Use separate accounts and one assigned writer slot per person. The team's separately authorized full passwordless-sudo grants are administrator access: they can bypass slot/filesystem checks and reach other services, data and secrets. Inspect actual policy and keep these two access levels distinct; do not broaden permissions automatically when a command fails. The root-owned `slot-owners.json` records the permitted Unix UID for each slot; normal uploads check the login UID and normal startup checks sudo's caller UID. Code sync is unprivileged; the start helper admits only assigned development slots.

### Database and storage readiness before onboarding

An empty database container is not a migrated Arden backend. Before the first coding session:

1. Identify the API's **actual** database and Auth targets from protected runtime settings. Back up the affected source/configuration and database; check writer occupancy and use the maintenance fence for coordinated changes.
2. Inspect `public.arden_schema_migrations`, schema ownership, populated organizations and the current approved migration set. A partially completed setup must resume only pending migrations. Do not edit applied SQL or erase a database to retry setup.
3. Apply the exact reviewed migrations through the approved operator migration connection. The initial migration manages extensions and a cluster role; PostgreSQL reserves changes to the `BYPASSRLS` attribute for a superuser. Later setup migrations seed tables with forced RLS. A restricted normal API/schema-owner connection is insufficient for these administrative operations. Keep administrator credentials outside API containers; preserve or assign domain object ownership to the separate migration role after bootstrap. Review later migrations individually rather than granting permanent superuser access to the API. [PostgreSQL ALTER ROLE](https://www.postgresql.org/docs/17/sql-alterrole.html), [row security](https://www.postgresql.org/docs/17/ddl-rowsecurity.html).
4. Verify the API login is non-superuser, non-bypass, cannot create roles/databases, and can assume `arden_runtime`. Confirm its application database is separate from other slots. Do not modify Supabase-owned Auth schemas as part of Arden migrations.
5. Configure the approved Supabase URL and public anon/publishable key. Compare the API's key with the managed gateway's configuration and check Auth health separately from database readiness. The auth adapter does not require a service-role key.
6. Mount `ARDEN_PRIVATE_STORAGE_ROOT` to a separate writable persistent directory. When its container target is nested inside the read-only `/workspace` bind, create the empty target directories before startup; Docker cannot create them inside an already read-only mount. Retain any existing note bodies and database references. Inspect the resulting bind type, canonical source path, write flag and container-user access.
7. Inspect the complete generated Compose service inventory and persistent-volume mappings. Validation success alone does not prove an existing database service or its storage was retained. Deploy only after these checks; confirm API readiness and Auth health for each slot, then clear maintenance through successful completion of its context.

Logical database dumps and retained configuration provide a recovery starting point. A valid dump listing is not evidence of a successful restore. Keep the protected recovery procedure and migration journal with the operator, and verify restoration separately before promising release readiness.

For an older installation that used one owner, stop its development writers and prevent startup during the operator update. Back up source and lease metadata privately, copy the reviewed helpers including `slot_access.py` and `operation_fence.py`, create protected root-owned slot assignments, keep each slot directory/identity root-owned, and move lease/manifest/status/lock files into an individually owned `state` directory alongside `source`. Assign distinct source/state owners, update Compose to use a separate pnpm cache volume per slot, and verify the scoped sudo grants. Create `ops/development.lock` once as a root-owned regular file with mode `0644`, inside root-owned `ops` without group/world write permission. Preserve the previous configuration for rollback. Do not rerun provisioning or delete database volumes. Old clients cannot upload until this migration is complete. This PR does not migrate an existing host.

Uploads, lease changes, and the entire privileged startup/health wait hold a shared lock on `ops/development.lock`. Operator cutover/rollback must use `operation_fence.maintenance`: it creates `ops/coolify-cutover` to reject new operations, waits for admitted operations to finish, and holds the exclusive lock throughout the operator's work. Never replace or remove `development.lock`; a different inode would break coordination with running processes. Missing, writable, or symlinked controls fail closed. Administrator actions through Docker/Coolify must be coordinated within this procedure; the lock does not intercept those tools.

`pnpm test:remote` covers local session ordering, competing-writer rejection, source/deletion handling, startup/readiness failures, preview, and disconnect cleanup. Linux CI also runs `deploy/hosted/tests/test_workflow.py` against disposable owned directories: real concurrent non-root processes and kernel locks exercise ownership and writer admission; mocked Docker calls exercise managed-start failure paths. The tests do not connect to the host or establish its effective SSH/sudo policy, end-to-end hot reload, or backup recovery. Complete those operator/contributor checks before broader onboarding.

Secrets/state live outside synced source. Only development names can sync or start through these commands. Staging/production need immutable release provisioning, migration roles, protected backups, and promotion following [operations.md](operations.md). Full Supabase environments need supported independent service/configuration isolation and capacity planning; do not casually attach several Auth/Storage servers to this shared PostgreSQL cluster.

Bootstrap uses Docker Compose directly. Running those containers alone does **not** register them in Coolify. Follow [Coolify adoption](#coolify-adoption) to create genuine managed resources through its supported UI/API. GitHub release deployment credentials remain separate integration work. Do not modify Coolify's internal database to imitate registration.

## Coolify adoption

Use one Arden project with `development`, `staging`, and `production` environments. The fresh bootstrap template places four databases in shared development PostgreSQL. The [current team layout](#current-team-layout) also uses existing managed Supabase services; preserve their actual placement rather than rerunning that template. Staging and production each contain their own database resources. The local frontends remain on contributors' computers. Release applications remain separate work.

An operator imports the reviewed Compose definitions as three Docker Compose services, without deploying them immediately. Keep actual service UUIDs, host paths, environment files, database secrets, migration journals, and backups in protected private storage. This is an operator migration, not a daily developer command.

1. Pause writers and retain protected configuration/source backups and logical database dumps. Identify the exact original containers, images, volumes, database catalogs, and PostgreSQL system identifiers. Check backup recovery separately; a nonempty dump does not establish a tested restore.
2. Register the three services using the authenticated Coolify UI or its supported API. Preserve pinned images, health checks, resource limits, private networks, secret files, loopback development ports, and read-only source binds. A locally built development image needs `pull_policy: never`; build the reviewed image on that host first.
3. Inspect Coolify's **generated** Compose before deployment. In the observed 4.3.23 service parser, named volumes are prefixed/renamed; an external volume name is not sufficient evidence of reuse. Variable-prefixed source mounts can also be interpreted as named volumes. Use verified absolute private paths for source/init-file binds and check that the generated mounts are binds. Environment variables and secret-file references need explicit resource configuration. Never publish the rendered configuration.
4. Record the exact original-to-managed volume mapping privately. Stop only the identified original containers and disable their restart policies while retaining them. Preserve the old volumes. For a physical PostgreSQL copy, all original writers/processes must be stopped, the image/version must match, and the managed target must be empty. Copy ownership/modes as well as files. Never copy live PostgreSQL data or overwrite an existing managed database.
5. Copy the reviewed `coolify_runtime.py` alongside the root-owned start helper. The helper must call `start_managed(ROOT, slot)` before its legacy Compose path. Create a root-owned, non-group/world-writable `ops/coolify-development.json` with the private `service_uuid`. A malformed marker or missing managed container must fail closed; never remove the marker to make ordinary startup recreate legacy volumes.
6. Hold `operation_fence.maintenance` throughout the cold copy, deployment, and verification steps, including step 4's stop/copy actions. It pauses new sync/start requests and drains already admitted privileged starts and source writes before yielding. Stop writer sessions and recheck leases under the fence before moving storage; a live session must restart after cutover. Deploy the copied stacks through Coolify after storage validation. Check all seven managed containers, four readiness responses, private port bindings, volume mappings, and preserved database identifiers/catalogs. Only successful completion of the maintenance context clears the pause marker. Then verify the ordinary start helper uses the managed containers.
7. Record the verified resource IDs, helper version, retained originals, and recovery route privately. Complete individual account/slot onboarding before additional contributors use the host; dashboard registration does not establish scoped SSH access.

After adoption, `pnpm dev:remote` starts/waits for the existing managed database and assigned API container. It does not issue a full-stack redeploy, pull new images, or change staging/production. If Coolify removed the containers, the operator must deploy the service in Coolify first. Source uploads and API hot reload continue through the existing SSH workflow. Use Coolify for logs, deployment configuration, and service operations.

### Hold the maintenance fence

Put the complete reviewed migration procedure in a private operator script. Import `maintenance` from the deployed root-owned `operation_fence.py`; run the script as root. This example shows its structure, **not an executable migration recipe**:

```python
from pathlib import Path
from operation_fence import maintenance

with maintenance(Path('/srv/DEDICATED_PROJECT_DIRECTORY')):
    # Perform the reviewed stop, cold copy, deployment, and verification here.
    # Raise an error if a required check fails; do not clear the marker manually.
    perform_reviewed_cutover_and_verify()
```

The exclusive lock must remain held while any UI/API/Docker operation is in flight. Do not exit the context before performing the copy or waiting for deployment/health checks. An exception, crash, or interruption leaves `coolify-cutover` in place, keeping ordinary sync/start closed. Inspect the interrupted state and recovery plan first; an operator may then use `maintenance(root, resume=True)` around the complete reviewed recovery procedure. Successful recovery clears the pause; failed recovery leaves it closed. Inspect active maintenance before using `resume=True`.

**Recovery:** use the exclusive maintenance context for the entire rollback and stop the new managed services before switching storage. Retained original volumes are the cutover snapshot; they do not contain later managed writes. Reconcile those writes or use a reviewed backup/restore procedure before switching back. Restore the matching protected helper/Compose configuration and restart only the identified originals. Preserve the fence inode throughout recovery. Do not run both database copies as the active environment or use `down -v`, pruning, or volume deletion as routine recovery.

Linux CI covers malformed management markers, duplicate/missing containers, unhealthy/timeout startup, cross-slot caller denial, both managed/legacy fenced startup paths, draining an admitted start, and paused recovery after failure. Docker operations are mocked; actual service adoption, scoped sudo restrictions, storage mapping, and recovery still require private operator evidence.

## References

- [Vite 7 server configuration](https://v7.vite.dev/config/server-options)
- [pnpm filtering](https://pnpm.io/filtering)
- [Supabase self-hosting differences](https://supabase.com/docs/guides/self-hosting)
- [Supabase Docker setup/capacity](https://supabase.com/docs/guides/self-hosting/docker)
- [Coolify Compose services](https://coolify.io/docs/services/configuration/docker-compose)
- [Coolify persistent storage](https://coolify.io/docs/services/configuration/persistent-storage)
