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
4. Ensure key login works. The operator must grant slot ownership and permission for the root-owned development start entry point. The command uses noninteractive SSH and `sudo -n` for that start operation only; it does not change privileges or SSH settings.

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
sudo -n python3 provision.py /srv/DEDICATED_PROJECT_DIRECTORY APPROVED_SSH_ACCOUNT
```

The bootstrap refuses an existing target. It creates root-owned controls/Compose configuration, private generated credentials, four development source directories, and isolated staging/production **database templates**. It does not start containers, alter sudo/SSH policy, or deploy a production application. Build/start the named development Compose project and inspect readiness. Use `compose config --quiet`; full rendered config can reveal secrets.

The development PostgreSQL instance has a 768 MiB limit; each API has 384 MiB, plus CPU/process/log limits. These are scaffold limits, not full-product capacity guarantees. Database initialization creates four non-superuser logins, prohibits role/database creation, and revokes public `CONNECT` grants. Initialization runs only for a fresh named volume. Never delete a volume to rerun it. Normal shutdown does not use `down -v`.

Initial slot ownership uses one approved account. The operator assigns each slot to its approved contributor account and grants only the required root-owned `start.py` invocation before onboarding additional writers. This task does not create accounts, distribute credentials, or give all contributors unrestricted sudo. Code sync is unprivileged; container start is privileged and limited to development slots.

Secrets/state live outside synced source. Only development names can sync or start through these commands. Staging/production need immutable release provisioning, migration roles, protected backups, and promotion following [operations.md](operations.md). Full Supabase environments need supported independent service/configuration isolation and capacity planning; do not casually attach several Auth/Storage servers to this shared PostgreSQL cluster.

Bootstrap uses Docker Compose directly; these are **not registered Coolify resources**. Coolify registration and GitHub deployment credentials remain separate integration work. Do not modify Coolify's internal database to imitate registration.

## References

- [Vite 7 server configuration](https://v7.vite.dev/config/server-options)
- [pnpm filtering](https://pnpm.io/filtering)
- [Supabase self-hosting differences](https://supabase.com/docs/guides/self-hosting)
- [Supabase Docker setup/capacity](https://supabase.com/docs/guides/self-hosting/docker)
