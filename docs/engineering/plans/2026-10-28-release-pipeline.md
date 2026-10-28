# Staging and production CI/CD implementation plan

> For agentic workers: use the executing-plans skill for the owner's selected inline implementation. Read the approved design and current task ledger before resuming. Preserve unrelated work.

Goal: automatically deploy tested staging app images and promote the exact verified pair to production using GitHub-hosted public runners without retained GitHub build storage.

Architecture: GitHub validates and builds; a restricted SSH protocol transfers bounded images to a root-owned receiver. Coolify manages app-only Services, with stable Auth/database/storage outside routine app deployment. Production promotes a matching staging source tree instead of rebuilding.

Stack: Node 24, pnpm 11.19.0, Python 3 with cryptography for signed job identity verification, Docker/Compose, Coolify 4.5, GitHub Actions/OpenSSH. The CI verifier dependency is pinned in `deploy/release/requirements-ci.txt`; the host uses Ubuntu's maintained package.

Spec: [approved release design](../release-pipeline-design.md), requirements REL-01–REL-12.

## Global constraints

- Automatic staging and production are owner-approved; production requires matching successful staging artifacts.
- Standard public GitHub runners only; no retained artifacts, persistent Actions caches or container registry publication.
- No runtime/database/SMTP or broad administrative credentials in GitHub. Separate environment-specific deployment capabilities and strict host pins.
- Preserve current databases, Auth, private volume identities, runtime secrets, routing and unrelated work. No automatic schema changes or host-wide cleanup.
- Keep implementation, tests, publication and live activation evidence separate. Current manual snapshots remain until verified cutover.

## Review focus

- Wrong environment, caller-selected command/path/Compose and malicious archive contents must fail before privileged side effects.
- Concurrent/stale runs, disconnects and uncertain management requests must not activate an older release or duplicate a rollout.
- A healthy page with the wrong images/tree is a failed rollout; recovery must verify the previous image pair.
- Staging promotion must compare exact source trees and retained image identities across different merge commit IDs.
- Source visibility, storage and runner configuration must not silently enable paid execution or retained build artifacts.

## Task 1: Release protocol and receiver

Files: create `deploy/release/protocol.py`, `deploy/release/receiver.py`, `deploy/release/tests/test_protocol.py`, `deploy/release/tests/test_receiver.py`.

Interfaces: JSON protocol version 1 uses fixed operations `status`, `upload`, `deploy`, `promote`; manifests carry commit/tree/image IDs, run/attempt, migration fingerprint, archive SHA/size. The forced-command environment is authoritative. Receiver consumes root-owned configuration, an injected management boundary and protected state.

- [x] Write and observe failing tests for exact environment/manifest validation, duplicate/unknown fields, bounded archive validation, wrong tags, tampering, traversal, stale/idempotent/concurrent requests and failed/recovered activation.
- [x] Implement strict protocol and receiver with no caller-selected shell/path/management targets, atomic receipts, locking, bounded uploads, image checks and verified recovery.
- [x] Run Python unit tests on Windows and Linux where appropriate; use disposable fixtures and fail-closed injected management behavior. Record platform limits explicitly.
- [x] Prepare a coherent protocol/receiver commit only after checks pass and publication authority is established.

## Task 2: Packaging, runner client and workflow

Files: create `deploy/release/Dockerfile`, its allowlist ignore file, environment-neutral web config, `tools/releases/release.mjs`, release-client tests; modify `.github/workflows/ci.yml`, PR-convention validation/tests and owning branch rule.

Interfaces: client builds manifest version 1 and speaks Task 1's fixed protocol over pinned SSH; workflow supplies verified commit/tree and run/attempt. Staging transfers a single bounded archive; main promotes an existing matching staged image pair.

- [x] Write and observe failing client/branch-policy tests for environment selection, stale/invalid input, status versus promotion behavior and the exact `staging` branch exception.
- [x] Add clean frozen multi-stage packaging, immutable base/action pins, metadata/version/migration fingerprints and no-secret build context.
- [x] Use public-runner-only jobs, no cache/artifact/registry steps, minimum job permissions and environment-specific release secrets; preserve existing checks and serialize activation.
- [x] Verify protocol/client/workflow syntax, focused tests and normal typecheck/test/test:remote/build checks. Run image build/security/smoke checks on GitHub, not the application server.
- [x] Prepare a coherent workflow/packaging commit after verification.

## Task 3: Operator bootstrap and guide

Files: create `deploy/release/bootstrap.py`, `deploy/release/tests/test_bootstrap.py`, `docs/engineering/release-pipeline.md`; update operations/contributor guidance and the private Knowledge topic/handoff.

Interfaces: protected operator input maps existing Coolify environments, app/infra networks, volume IDs and per-environment identities. Output is a root-owned receiver/configuration, restricted SSH accounts/keys, app-only Services and GitHub environment/secret settings. Runtime values never enter public source or CI output.

- [x] Write and observe failing tests for configuration preservation, exact target mapping, external-volume identity, no public internal ports, app-only stack boundaries and invalid bootstrap input.
- [x] Implement idempotent, backed-up, staging-first bootstrap with no host-wide cleanup, existing-account overwrite, unverified host keys or unrestricted sudo grants.
- [x] Inspect actual installed API behavior and construct private before-state/cutover/rollback records. Enable only the approved local management path; keep its credential off GitHub.
- [x] Prepare beginner daily branch/push, failed-check, migration gate, recovery, credential rotation and retention instructions with placeholders.
- [x] Prepare a coherent operator/docs commit after verification; preserve the earlier unrelated migration notes.

## Task 4: Review, publication and controlled activation

Interfaces: Tasks 1–3's verified code, immutable image manifest, actual GitHub environments and protected operator state.

- [x] Run one fresh whole-change review, assess findings against actual source, fix required defects with regression evidence and rerun affected checks.
- [ ] Publish through the authorized repository workflow; create/update the focused PR if needed. Obtain merge authority if not already covered. Do not quietly merge unrelated branches or the private Knowledge PR.
- [x] Establish a baseline rollback record and verify staging app cutover without modifying its private data or Auth/DB components. Run the first GitHub-built staging release and a controlled rollback/recovery rehearsal.
- [ ] Only after staging evidence, cut over production app management and activate automatic main promotion. Verify exact running images, HTTPS, web version, API readiness/denial and unchanged stateful components.
- [ ] Finalize owning public/private guides and ARD-65 with exact source/check/deployment evidence. Keep any required unverified milestone open; no generic production-readiness claim.

Delivery checkpoint (28 October): staging's signed GitHub rollout, exact previous-pair rollback and fresh automated recovery passed in run 40712177548 (attempts 2/3). Production's app-only baseline and restricted deployment capability/environment are verified. Main integration, first automatic production promotion and final task/Knowledge integration remain pending; the unchecked items retain those required milestones.
