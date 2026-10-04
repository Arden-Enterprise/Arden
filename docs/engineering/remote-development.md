# Local frontend, hosted development backend

## Layout and scope

| Environment | Frontend | API | Database |
| --- | --- | --- | --- |
| `dev-1` through `dev-4` | Each developer's computer, Vite hot reload | Separate non-root container per slot | Separate database/login per slot in one development PostgreSQL instance |
| Staging | Immutable release, when provisioned | Reviewed release image, when provisioned | Dedicated PostgreSQL instance, volume, secret |
| Production | Same approved release artifact | Same approved image digest | Dedicated PostgreSQL instance, volume, secret |

This replaces the two hosted frontend slot proposal. The implementation supports the existing API health scaffold. It is **not four full Supabase projects**: Auth, Storage, Realtime, domain migrations, worker, release applications, and deployment automation remain to implement. Supabase is the accepted platform direction; see [decision 0001](../decisions/0001-supabase-and-hybrid-development.md). Four logical databases do not create four self-hosted Supabase projects.

Development roles cannot routinely connect to one another's databases, but share compute, maintenance, and a failure domain. Administrator/host access can inspect all environments. Use synthetic data, separate external sandboxes, and no production credentials. Staging/production never share the development database instance.

## Contributor setup

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

The operator grants each account only its required root-owned `start.py` invocation before onboarding writers. Do not share accounts, grant general sudo/Docker access to contributors, or assign one account multiple slots. The root-owned `slot-owners.json` records the permitted Unix UID for each slot; upload checks the login UID and startup checks sudo's caller UID. Host administrators retain control of every slot. Code sync is unprivileged; container start is privileged and limited to the caller's assigned development slot.

For an older installation that used one owner, stop its development writers before an operator update. Back up source and lease metadata privately, copy the reviewed helpers including `slot_access.py`, create protected root-owned slot assignments, keep each slot directory/identity root-owned, and move lease/manifest/status/lock files into an individually owned `state` directory alongside `source`. Assign distinct source/state owners, update Compose to use a separate pnpm cache volume per slot, and verify the scoped sudo grants. Preserve the previous configuration for rollback. Do not rerun provisioning or delete database volumes. Old clients cannot upload until this migration is complete. This PR does not migrate an existing host.

Before opening the workflow to more contributors, the environment/code owner must add focused automated coverage for competing writers, cross-slot account denial, deletion reconciliation, disconnect cleanup, and failed startup. Current CI covers the application scaffold; syntax and operational checks do not cover those cases.

Secrets/state live outside synced source. Only development names can sync or start through these commands. Staging/production need immutable release provisioning, migration roles, protected backups, and promotion following [operations.md](operations.md). Full Supabase environments need supported independent service/configuration isolation and capacity planning; do not casually attach several Auth/Storage servers to this shared PostgreSQL cluster.

Bootstrap uses Docker Compose directly. Running those containers alone does **not** register them in Coolify. Follow [Coolify adoption](#coolify-adoption) to create genuine managed resources through its supported UI/API. GitHub release deployment credentials remain separate integration work. Do not modify Coolify's internal database to imitate registration.

## Coolify adoption

Use one Arden project with `development`, `staging`, and `production` environments. Development contains the four API slots and shared development PostgreSQL; staging and production each contain their own PostgreSQL service. The local frontends remain on contributors' computers. The release applications and full Supabase services remain planned.

An operator imports the reviewed Compose definitions as three Docker Compose services, without deploying them immediately. Keep actual service UUIDs, host paths, environment files, database secrets, migration journals, and backups in protected private storage. This is an operator migration, not a daily developer command.

1. Pause writers and retain protected configuration/source backups and logical database dumps. Identify the exact original containers, images, volumes, database catalogs, and PostgreSQL system identifiers. Check backup recovery separately; a nonempty dump does not establish a tested restore.
2. Register the three services using the authenticated Coolify UI or its supported API. Preserve pinned images, health checks, resource limits, private networks, secret files, loopback development ports, and read-only source binds. A locally built development image needs `pull_policy: never`; build the reviewed image on that host first.
3. Inspect Coolify's **generated** Compose before deployment. In the observed 4.3.23 service parser, named volumes are prefixed/renamed; an external volume name is not sufficient evidence of reuse. Variable-prefixed source mounts can also be interpreted as named volumes. Use verified absolute private paths for source/init-file binds and check that the generated mounts are binds. Environment variables and secret-file references need explicit resource configuration. Never publish the rendered configuration.
4. Record the exact original-to-managed volume mapping privately. Stop only the identified original containers and disable their restart policies while retaining them. Preserve the old volumes. For a physical PostgreSQL copy, all original writers/processes must be stopped, the image/version must match, and the managed target must be empty. Copy ownership/modes as well as files. Never copy live PostgreSQL data or overwrite an existing managed database.
5. Copy the reviewed `coolify_runtime.py` alongside the root-owned start helper. The helper must call `start_managed(ROOT, slot)` before its legacy Compose path. Create a root-owned, non-group/world-writable `ops/coolify-development.json` with the private `service_uuid`. A malformed marker or missing managed container must fail closed; never remove the marker to make ordinary startup recreate legacy volumes.
6. Use the root-owned `ops/coolify-cutover` marker during migration to reject sync/start requests. Acquire each slot's sync lock and recheck active leases before cutover. Deploy the copied stacks through Coolify after storage validation. Check all seven managed containers, four readiness responses, private port bindings, volume mappings, and preserved database identifiers/catalogs. Then archive/remove the cutover marker and verify the start helper uses the managed containers.
7. Record the verified resource IDs, helper version, retained originals, and recovery route privately. Complete individual account/slot onboarding before additional contributors use the host; dashboard registration does not establish scoped SSH access.

After adoption, `pnpm dev:remote` starts/waits for the existing managed database and assigned API container. It does not issue a full-stack redeploy, pull new images, or change staging/production. If Coolify removed the containers, the operator must deploy the service in Coolify first. Source uploads and API hot reload continue through the existing SSH workflow. Use Coolify for logs, deployment configuration, and service operations.

**Recovery:** stop the new managed services before any rollback and block writers. Retained original volumes are the cutover snapshot; they do not contain later managed writes. Reconcile those writes or use a reviewed backup/restore procedure before switching back. Restore the matching protected helper/Compose configuration and restart only the identified originals. Do not run both database copies as the active environment or use `down -v`, pruning, or volume deletion as routine recovery.

The management helper has syntax and live operational evidence only. Automated coverage of malformed markers, duplicate/missing containers, health timeouts, and scoped startup remains a follow-up alongside the writer-protocol coverage above.

## References

- [Vite 7 server configuration](https://v7.vite.dev/config/server-options)
- [pnpm filtering](https://pnpm.io/filtering)
- [Supabase self-hosting differences](https://supabase.com/docs/guides/self-hosting)
- [Supabase Docker setup/capacity](https://supabase.com/docs/guides/self-hosting/docker)
- [Coolify Compose services](https://coolify.io/docs/services/configuration/docker-compose)
- [Coolify persistent storage](https://coolify.io/docs/services/configuration/persistent-storage)
