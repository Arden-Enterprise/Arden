# GitHub-hosted staging and production releases

Status: owner-approved design on 28 October 2026; implemented with a verified GitHub staging rollout and live app rollback. Main integration/first production promotion remain separate activation milestones; follow ARD-65 and the linked run evidence.
Source baseline: Arden main `ce912b703fe71d1fb1c52b34f5e5c12a2157efe9`, inspected 28 October 2026.
Accountable decision owner: project lead. Record author: coding agent at the owner's request.
Related task: ARD-65. The deployment-settings review scheduled for 2 November remains separate.

## Requested outcome and accepted decisions

The owner requested a permanent `staging` branch deploying to `staging.ardenai.tech`, with `main` targeting `ardenai.tech`. The owner explicitly chose automatic production deployment after successful checks. The `staging` branch is an owner-requested exception to the ordinary contributor branch naming convention; feature branches keep meaningful typed names.

The owner also explicitly selected standard free public-repository GitHub runners with no retained build storage. GitHub currently documents those runners as free and unlimited for public repositories. This is a dated provider policy, not a lifetime pricing guarantee. See [GitHub billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions) and [runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).

The builder must not silently substitute paid/larger runners, private-repository hosted runs, Actions artifacts, persistent Actions caches, GHCR, or another paid build/storage service. Normal Git source, workflow status and logs still exist; this design avoids retained build artifacts and cache/package storage, not GitHub's ordinary repository records.

## Approaches and selected direction

1. **GitHub builds, registry distribution, Coolify pulls:** conventional image distribution and easy multi-host promotion, but it retains registry images. Rejected under the owner's no-retained-build-storage choice.
2. **GitHub builds, direct transfer, Coolify manages the rollout:** images exist temporarily on the standard runner, are transferred over SSH, then loaded and selected on the existing server. This matches the selected temporary-storage approach. It needs a restricted deployment receiver and keeps rollback images on the server.
3. **Build on the application server:** avoids GitHub build execution but competes with application/database workloads. Rejected because the owner chose GitHub-hosted build work and lower server load.

Approach 2 is the proposed implementation. Coolify remains the resource manager; the application server receives completed images rather than installing dependencies or compiling source.

## Release path

```text
feature branch -> PR into staging
                    |
           GitHub checks and temporary image build
                    |
            restricted staging deployment
                    |
             staging.ardenai.tech
                    |
        PR into main with the same tested source tree
                    |
       checks + exact staging-image promotion
                    |
                ardenai.tech
```

The existing operations contract requires promoting the same immutable artifact. Production therefore reuses the successful staging image IDs when the proposed main source tree matches the tested staging source tree; squash/merge commit IDs may differ. It must not silently rebuild a different production image or promote code that has no matching successful staging release. A failed promotion prerequisite leaves the current production release running.

Release identity records deployment commit, built-source commit, Git tree, portable web/API config-content digests, verified store-local image bindings, bounded archive checksums, workflow run/attempt, migration fingerprint and verification state. Classic and containerd Docker stores can use different local IDs for the same content; compare loaded configuration and root filesystem layers before recording that private binding. Export normalization removes alternate loader views and runner checks exercise a real validate/load round trip. A small public web version document can expose the built-source/tree identity without exposing runtime configuration. Internal checks verify the API's actual loaded image ID as well as readiness; a green homepage alone is insufficient.

## GitHub checks, builds and cost controls

- Use standard named public-repository runners only. Gate hosted jobs on the repository remaining public; a visibility change must not silently enable paid runs.
- Preserve existing Ubuntu/Windows typecheck, unit/request, hosted-protocol, remote-workflow and build checks. Add release/configuration tests and disposable database migration/permission checks where their current contracts can be exercised safely. Do not hide existing failing tests or claim skipped integration coverage passed.
- Pin third-party actions to verified immutable commits, maintain the Node 24/pnpm 11.19.0 baseline and frozen lockfile, and give jobs only required token permissions.
- PR jobs cannot access deployment credentials. Do not use `pull_request_target` or execute untrusted fork artifacts in a privileged release job.
- Build web/API from one clean source tree using a Docker context allowlist, pinned bases, non-root runtime users and no runtime secrets as build arguments. Scan release images on the runner; unapproved material findings block release.
- No upload-artifact/download-artifact, persistent cache actions, setup-node package-manager caching, remote Docker cache exports, package publication or container registry pushes. Temporary runner files disappear with the job. Repeated work on GitHub is an accepted performance tradeoff for avoiding persistent build storage.
- Define timeouts and bounded logs. Cancel superseded checks/builds when safe; serialize both environments through one shared deployment queue and never cancel halfway through an activation merely because another push arrived. Use `queue: max` with `cancel-in-progress: false` so a staging push cannot evict a pending main promotion. GitHub allows up to 100 pending jobs; additional jobs are cancelled and need operator attention. Source/run fencing still rejects obsolete work. See [GitHub concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency).
- Recheck the intended branch head before activation and reject obsolete release/run identities at the receiver. A late older build cannot replace a newer accepted release.

## Deployment access and Coolify integration

Do not put the owner's administrator SSH key, an unrestricted sudo account or a broad Coolify management token in GitHub.

Proposed access: separate deployment-only SSH credentials for staging and production, stored in their corresponding GitHub environments. Restrict those environments to their exact branches. Hostnames, ports, host-key pins and resource identities belong in approved secret/private configuration, not source examples. Keep strict SSH host verification enabled.

Each credential is constrained by an administrator-owned forced command to one environment and a small release protocol. Disable interactive shells, PTY, agent/X11/TCP forwarding and arbitrary file/command access for these keys. The receiver must not accept caller-supplied shell commands, filesystem destinations, Compose definitions, container names, networks, mounts or service UUIDs.

SSH authentication alone does not establish that an image came from GitHub. Each mutating operation additionally requires a short-lived GitHub Actions OIDC signature whose audience binds the exact environment, operation and canonical request digest. Validate the fixed issuer/key endpoint, RS256 signature, lifetime, immutable repository/owner IDs, public visibility, push event, branch/environment, workflow, commit, run/attempt and hosted-runner claims before loading images or changing state. Store only sanitized verified provenance with upload/deployment receipts; require that provenance for production promotion, including old retained staging records. A stolen staging key alone must not manufacture production artifact authority. This implements the existing GitHub-built artifact requirement; labels/checksums alone prove consistency. The reviewed workflow remains trusted to build, scan and test correctly. See [GitHub's identity reference](https://docs.github.com/en/actions/reference/security/oidc).

The root-owned receiver maps the environment to the existing approved Coolify resource and uses a private, minimum-permission local management credential only where Coolify requires it. That credential stays on the server. Validate archive size, contents, exact permitted image names, checksums, image identity and protocol fields before loading/activation. Never extract caller-selected paths into the host filesystem.

The owner-approved one-time bootstrap has created narrow automation access, configured both GitHub environments and enabled only the restricted local Coolify management path. These changes were verified on 28 October; do not repeat bootstrap merely because production promotion is pending. The management credential stays on the server; GitHub receives only restricted deployment credentials.

Read-only inspection of installed Coolify 4.5.0 found that Service activation uses `docker compose up` with `--force-recreate` for the whole Service. The current release Services combine web/API and Auth components. Reusing those whole-stack deployments would therefore recreate Auth on ordinary code releases.

The proposed solution is a controlled one-time separation: give staging and production each an app-only Coolify Service containing web/API, and retain their existing Auth/gateway/SMTP and databases outside that frequently deployed Service. Preserve exact private-volume identities as external storage references, runtime settings, network isolation and existing public routing. Establish a common API alias on each app's private network so one environment-neutral web image can be promoted unchanged. This is a targeted app cutover, not a database migration or data reset. Inventory and privately back up the affected configuration, confirm storage and rollback mapping, and verify the first staging cutover before doing production.

Subsequent Coolify activations may recreate the two app containers only. Verify unchanged non-app component identities/configuration. Do not bypass Coolify with an undocumented parallel service manager; stop if the installed management path cannot meet this boundary.

## Safe activation, recovery and server load

- Accept a bounded upload into protected temporary storage, validate it completely, then load the built images. The receiver performs no package installation, source build, image scan or general-purpose runner work on the application server.
- Lock each environment. Keep a protected before-state record of the current web/API image pair and affected Coolify configuration before an update. Do not hold database credentials in GitHub or emit rendered Compose/environment content into logs.
- Preflight available disk, approved migration fingerprint, exact target identity and existing health before replacing app containers. Unknown or incompatible schema state blocks release; no automatic privileged database migrations or restore operations are introduced by this pipeline.
- Update only the environment's web/API images and retain its runtime hardening and resource limits. Keep production and staging data/secrets separate. Do not recreate databases, Auth, SMTP or unrelated workloads as a normal application update.
- Verify actual running image IDs, local readiness, public HTTPS, frontend version and anonymous API denial. Only then mark a deployment successful. Bound the rollout deadline and retries; reconcile an uncertain deployment request rather than submitting duplicate operations blindly.
- On an application rollout failure, attempt to restore the previous known image pair/configuration, verify recovery and leave GitHub red with a clear outcome. If recovery fails, report it distinctly; do not claim success because a rollback request was sent. No database rollback is implied.
- Keep the active and previous known-good app releases on the server. Protect image references still needed by either environment or an in-progress rollout. Delete only task-owned temporary uploads and explicitly unreferenced app-image records according to the approved retention policy; never run host-wide prune/cleanup or delete volumes.
- A single-host Compose replacement can cause a short interruption. This project does not promise zero downtime, high availability, a restored backup or complete product readiness. Known source defects and production mail/first-account gaps remain separate acceptance work.

## Requirements and evidence to obtain

| ID | Acceptance requirement |
| --- | --- |
| REL-01 | Published `staging` exists; passing staging pushes reach only staging |
| REL-02 | Passing main checks automatically promote only a matching tested staging artifact to production |
| REL-03 | Source checks, compilation and image scanning execute on standard public GitHub runners |
| REL-04 | No retained GitHub build artifacts, caches or registry images; visibility/runner policy fails closed |
| REL-05 | Exact source/image identities are checked across upload, activation and public/internal verification |
| REL-06 | Separate environment credentials and forced commands deny wrong targets, malformed inputs and arbitrary commands/paths |
| REL-07 | Oversized/truncated/tampered uploads, obsolete runs and concurrent releases cannot activate incorrectly |
| REL-08 | Failed checks/builds/scans never deploy; failed rollouts recover the prior app pair or clearly report failed recovery |
| REL-09 | Existing databases, Auth, storage, runtime secrets and unrelated services remain intact |
| REL-10 | Unknown migration/compatibility state blocks release without automatic schema changes |
| REL-11 | Operator/bootstrap, daily branch flow, rollback, credential rotation and retention guides match verified behavior |
| REL-12 | Local implementation, tests, GitHub publication and live activation are reported separately with actual evidence |

Test the receiver using disposable fixtures and injected management boundaries before a controlled live staging rollout. Test denial and recovery behavior, not just happy-path configuration text. Run existing applicable repository checks. Test the final pipeline on GitHub, then verify exact live staging and authorized production results; local tests alone do not prove deployed behavior.

## Current state and required activation inputs

The owner approved this design and inline implementation on 28 October, including app-only Service separation, restricted deployment access and restricted local Coolify management bootstrap. The permanent `staging` branch is published and its environment, restricted access and signed-job deployment path have been exercised. [Run 40712177548](https://github.com/Arden-Enterprise/Arden/actions/runs/40712177548), attempt 2, deployed revision `73e6bee` as a GitHub-built pair; a controlled root-only rollback restored the exact previous pair while preserving infrastructure/private storage and workflow fencing. Attempt 3 verified fresh automated recovery. Revision `8506abc` subsequently passed [staging run 40719483404](https://github.com/Arden-Enterprise/Arden/actions/runs/40719483404) and exact live image/tree, readiness/denial and protected infrastructure/storage checks. Later branch changes need their own verification. Production's app-only baseline cutover and restricted capability/selected-main environment are also verified; it still serves the prior version pending authorized main integration. Preserve unfinished Knowledge consolidation notes and excluded recovery material.

Existing repository administration and authorized server SSH access are available, so no new domain, DNS migration, paid plan or build machine is required. Main integration and first automatic production promotion still require their actual readiness/approval and verification. Root management credentials remain local, and the production environment accepts only main. Any inaccessible permission is a specific blocker to report; never request passwords/tokens in chat.

Bootstrap order must avoid accidental production promotion: prepare and test code, provision narrow access and baseline records, integrate approved workflow/configuration, publish the staging branch, verify its first release, then enable and verify main promotion against that tested artifact. Do not mark an unactivated pipeline complete.
