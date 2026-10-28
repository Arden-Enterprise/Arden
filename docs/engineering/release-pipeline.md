# Staging and production release guide

This guide owns the branch-based application release procedure. Read the [approved design](release-pipeline-design.md), [operations policy](operations.md) and [server access rules](server-access.md) first. The design's delivery status and the private operational handoff distinguish prepared code from an activated environment. Do not assume that a merged workflow proves a live deployment.

## Daily flow

1. Fetch and safely update your local checkout. Preserve unfinished work before switching branches.
2. Make a meaningful feature branch from current `staging`, such as `feat/knowledge-search`.
3. Develop and test locally using the [teammate setup guide](teammate-setup.md). Hosted development slots are independent of staging and production.
4. Commit coherent units of work and push your feature branch. Open a PR **into `staging`**. Read CI and configured reviewer findings; fix valid findings before the authorized merge.
5. A push or merged PR to `staging` runs checks, builds/scans the images on GitHub and deploys them to [staging](https://staging.ardenai.tech). Watch the GitHub **CI** run, especially **Deploy verified app release**. A failed check leaves the current app running.
6. Test the feature on staging. When that complete source tree is ready, prepare a promotion PR **from `staging` into `main`**. Do not add production-only code or modify files during promotion.
7. After an authorized merge, successful main checks automatically promote the matching, retained staging images to [production](https://ardenai.tech). There is no separate production approval button. Main can have a different merge/squash commit ID, but its Git tree must match a staging release verified within the last 24 hours.

Example commands, after the initial operator setup:

```sh
git fetch origin
git switch staging
git pull --ff-only origin staging
git switch -c feat/knowledge-search
# Edit, run relevant checks, then commit selected files.
git push -u origin feat/knowledge-search
gh pr create --base staging
# Later, after staging is verified and promotion is authorized:
gh pr create --base main --head staging
```

Do not force-push either release branch. A push is a deployment request, so do not use staging/main as scratch branches. Ordinary PR/fork checks receive no deployment keys. Teammates do not need an administrator SSH key or production database password to use this release flow.

## What GitHub checks

The workflow uses standard public-repository Ubuntu/Windows runners, pinned actions, Node 24 and pnpm 11.19.0. It runs frozen dependency installation, typechecking, existing tests, remote-development protocol tests and builds. Linux additionally exercises the release receiver's privilege/locking boundaries and existing hosted maintenance protocol. A separate disposable PostgreSQL job applies migrations and runs the existing real database/RLS suite. These databases contain synthetic fixtures and exist only for that job.

Image jobs build both targets from one checkout, scan HIGH/CRITICAL vulnerabilities and embedded secrets, then run disposable image checks for migrations, a non-superuser API connection, readiness, anonymous denial, web content and source identity. The smoke test uses no live Auth provider: real sign-in, mail delivery, private documents and full user journeys still require separate staging acceptance.

Staging builds and transfers one bounded archive; production reuses the already scanned staging pair. The runner normalizes Docker exports to one Docker-manifest view, removing alternate OCI/repository metadata, then exercises a real validate/load round trip. The receiver rejects alternate loader views and checks checksum, archive limits, portable image-config digests/platform/users/labels, migration fingerprint, environment capability and workflow identity before activation. After loading, it verifies the actual runtime configuration and root filesystem layer identities, then saves a protected mapping from portable content digest to store-local Docker image ID. This accommodates classic and containerd stores without treating their different IDs as interchangeable. It never accepts a shell command, arbitrary destination or caller-provided Compose configuration.

The server loads finished images and asks Coolify to recreate only the two app containers. It does not install dependencies, compile source or scan images. Auth, gateway, SMTP, database and private volumes remain separate. A single-server container replacement can briefly interrupt requests; this is not a zero-downtime or high-availability setup.

Every upload, deployment and production promotion also carries a short-lived GitHub Actions identity proof bound to that exact request. The server checks GitHub's signature and the repository/owner IDs, workflow, environment, branch, commit, run and hosted-runner claims. Only the release job gets `id-token: write`; PR/check jobs get no identity permission or deployment secret. Status inspection still works with the restricted SSH key alone. Stored receipts contain verified metadata, never the bearer token. Production rejects legacy or unauthenticated staging eligibility. Protecting the reviewed workflow is part of this trust boundary; the identity proves which job authorized the request, rather than independently proving its compilation/scanning logic.

## Cost and storage boundary

The owner approved **standard free runners for this public repository**, with temporary build storage only. GitHub currently documents standard public-repository runner use as free; [provider pricing can change](https://docs.github.com/en/billing/concepts/product-billing/github-actions). The jobs fail closed if the canonical repository is no longer public.

There are no Actions build artifacts, persistent package/Docker caches, registry pushes or paid/larger runners. Trivy's database and build files are on the disposable runner disk. Normal Git history, job logs, statuses and deployment records remain on GitHub. Historical Actions caches from older workflows are separate; an operator may remove only confirmed obsolete caches. Old branches can recreate caches until their workflows are updated.

The application server necessarily retains running images and a bounded rollback set: active/previous releases for both environments, pending recovery references and the newest unactivated upload for at most one hour. Collection runs under the shared host lock and only removes unused images carrying this pipeline's exact ownership/revision labels and permitted tags. It never prunes the host or removes live volumes. Keep sufficient headroom for upload, image loading and recovery; a full disk blocks deployment.

## One-time operator setup

Only an authorized administrator performs this section. Resolve real resource IDs, SSH settings, fingerprints and runtime values from approved private records; never put them in a public PR or this guide. The owner approved the initial app separation and restricted local management bootstrap for this task. Future infrastructure/access changes still need their own scope authorization.

1. Inspect current main, current live app/infra identities, runtime configuration, exact named private volumes, schema inventory, public routing and available memory/disk. Bootstrap compares the selected database's applied migration IDs with the captured image's exact migration inventory using a read-only local administrative query; image files or API readiness alone are insufficient. This does not grant the runtime account extra database permissions. Save a protected before-state and recovery procedure. Confirm the installed Coolify version/action contract matches the reviewed adapter. Stop if another release or configuration change is active.
2. Review and test the exact `deploy/release/` package. Verify the system Python isolated interpreter can import Ubuntu's maintained `python3-cryptography` package (the inspected server has 41.0.7); do not install arbitrary global pip packages on the server. CI uses a pinned cryptography wheel in a disposable temporary virtual environment with pip caching disabled. Install source under root-owned `/opt/arden-release`, with no group/world write access or symlink ancestors. Install `arden-release` as root-owned executable `/usr/local/libexec/arden-release`. Create root-only `/etc/arden/releases` and `/var/lib/arden/releases`; keep environment/state/upload files private. Do not run copied privileged code from a developer-writable folder.
3. Generate **two new Ed25519 deployment keys**, one per environment. Keep private recovery copies in approved secret storage. Do not reuse a person's administrator key. Verify the SSH host key through an already trusted connection; do not treat a fresh `ssh-keyscan` response as verification.
4. Create root-only `/etc/arden/releases/operator.json` containing a random 32-character hexadecimal `nonce`, `sources` mapping staging/production to their existing private service UUIDs, `origins` mapping the approved public HTTPS origins, the verified old manual snapshot's `baseline_commit`/`baseline_tree`, and `public_keys` mapping each environment to its new public key. The operator rejects unexpected identities and preserves unrelated existing accounts/policies.
5. Invoke the installed operator with Python isolated mode. `enable-management` checks that API access is currently disabled and that there are no unrelated active API tokens. It enables API access with a loopback-only allowlist, creates a 90-day team-bound local capability and saves protected recovery material before committing. The token stays on the server. If existing API users are found, reconcile rather than clobbering their access.

```sh
sudo python3 -I /opt/arden-release/bootstrap_operator.py enable-management
sudo python3 -I /opt/arden-release/bootstrap_operator.py prepare staging
sudo python3 -I /opt/arden-release/bootstrap_operator.py cutover staging
sudo python3 -I /opt/arden-release/bootstrap_operator.py install-account staging
```

6. `prepare` captures selected app state privately, creates an app-only Coolify Service using the same old images/runtime/private volume, and saves a phase journal. `cutover` checks the candidate, moves only the original web/API pair out of routing, verifies public health and unchanged infrastructure identities, then initializes a non-promotable manual baseline. It retires only the old app definitions from the original Service without redeploying infrastructure; their protected original configuration remains available for recovery. A later infrastructure redeploy must not start duplicate old apps.
7. Verify the local management path works while public API access is denied. Test the staging key's fixed protocol and denial cases: wrong environment, malformed input, attempted shell command, PTY and forwarding. The deployment account must not join the Docker group or have general sudo. Its root-owned authorized-key entry uses `restrict` plus one fixed forced command; sudo permits only that environment's receiver invocation. A caller's SSH command text is ignored by the forced command and cannot execute a shell.
8. Create GitHub environments `staging` and `production`. Set **selected branch policies** to exactly `staging` and `main`, respectively, with no required production reviewer. Configure each environment's own `DEPLOY_SSH_HOST`, `DEPLOY_SSH_PORT`, `DEPLOY_SSH_USER`, `DEPLOY_SSH_KEY` and `DEPLOY_SSH_KNOWN_HOSTS` secrets using `gh` and stdin/private files. Do not put a broad Coolify token, Auth secret or database password in GitHub.
9. Publish the reviewed workflow to staging. Verify a real passing GitHub build, scan, transfer and rollout, exact image IDs, `/release.json`, API readiness/anonymous denial and unchanged stateful components. Rehearse a controlled staging app rollback and verify recovery. A simulated state-machine test is not evidence of a live rollback.
10. Only after that evidence, repeat prepare/cutover/install-account for production. The operator refuses production cutover without a GitHub-built verified staging release. Integrate the reviewed workflow into main only through the authorized PR process, then verify its first automatic promotion. Do not mark either environment complete until these live checks pass.

Keep the private operational handoff current with installed source hash, Coolify image/version, resource/account mappings, baseline/release identities, token expiry, key locations, actual check results and recovery outcome. Do not publish full `docker inspect`, rendered Compose, environment responses or unrestricted command logs.

## Failure and recovery

| Failure | Expected response |
| --- | --- |
| Source tests, dependency install, image build, scan or image smoke fails | No release is uploaded/activated. Fix the actual failure; do not disable the check or add blanket scanner exclusions. |
| Newer branch head supersedes a build | Client refuses the stale release. Follow the newest run. |
| Main has no matching fresh staging tree | Production stays on its current version. Test/push the intended complete tree to staging, then rerun the appropriate current main attempt. |
| Schema fingerprint differs | No automatic migration. Review an explicit migration/backup/compatibility plan, test it on disposable data, apply only with authorization, then update protected approval state and restage. |
| Historical Windows-built snapshot differs only in migration line endings | Preserve the original approval/state and compare all immutable-image SQL files plus the selected read-only database ledger. Only after proving exact CRLF-to-LF equivalence may an authorized operator reconcile baseline metadata with a protected recovery audit. Any other content change retains the schema-approval gate. Do not replay already applied migrations. |
| SSH is unavailable or protected release state is unresolved | A two-minute read-only status preflight stops before image work. Strict host checking remains enabled. SSH keepalives detect a subsequently lost connection; inspect actual server state before retrying. |
| Upload is truncated/oversized/tampered | No activation. The temporary upload is removed; loaded valid pending images follow bounded retention. |
| Missing/expired/incorrect GitHub identity, or its public signing keys are unavailable | No mutating operation is accepted. Keep the existing app running; inspect the current job and provider availability. Never disable identity verification as a retry mechanism. |
| App rollout fails | Receiver attempts the previous exact app pair, verifies recovery and leaves CI red. No database restore is attempted. |
| Recovery or Coolify activity is uncertain | Keep pending state and stop automatic progress. Inspect the protected journal and actual activity/container state; do not delete journals or submit blind duplicate starts. |
| Host disk headroom or API capability expires | Existing app stays running. Operator resolves only the specific condition, then reruns a current workflow attempt. |
| Coolify image changes | Preflight stops. Revalidate the installed API/action/queue behavior and bridge before updating the protected adapter pin. |

For an authorized app rollback, run the installed fixed root operator command below and record the reason in the private handoff. It acquires the same shared release lock, reconciles any pending recovery, selects the protected previous manifest, activates/verifies it, and atomically updates active/previous state while preserving workflow fencing. Do not merely edit image tags or mark state successful without verifying running IDs/public responses. This operation is intentionally absent from the CI credential's protocol.

```sh
sudo python3 -I /opt/arden-release/bootstrap_operator.py rollback staging
# Use production only with explicit production recovery authorization.
```

Bootstrap journals distinguish creating, created, prepared, cutover-started, recovered and verified phases. A `creating` record means a create request may have succeeded without a receipt: reconcile the exact Coolify resource before retrying. A `created` record resumes runtime env upsert. A protected API bootstrap result without a completed host receipt must be reconciled against actual token/settings state; do not mint another token or loosen the allowlist to get past an error. A requested old-app restart is not a verified recovery.

## Rotation and maintenance

- Rotate the 90-day local Coolify capability before expiry through an authorized root-only maintenance procedure. Keep the same minimum abilities/team, write the new token atomically with mode 0600, verify local management and external denial, then revoke only the old pipeline token. Never print/copy it into CI. Reinstall/revalidate the container-local bridge after a Coolify container replacement.
- Rotate one environment's SSH key at a time: prepare a new private recovery copy, register only its constrained public key, update that environment's GitHub secret, verify a fixed status/denial test, then remove only the old key. Preserve the other environment's key.
- Review pinned actions, base images and scanner regularly. A pin update needs build/scan/smoke evidence and staging verification before production promotion. Security scans can discover newly published vulnerabilities even when source is unchanged.
- Monitor app/server memory, disk and deployment failures in Coolify/GitHub. Log suppression protects app data but reduces diagnostics; use approved private, bounded investigations when needed.
- This pipeline does not configure database backups, tested restores, external Auth/mail, alert delivery, desktop signing, product authorization acceptance or high availability. Track those as explicit work rather than treating green deployment checks as complete production readiness.
