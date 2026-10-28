# Platform and delivery coverage

Read the [feature index](README.md). Sources: [product contract](../engineering/rules/product-contract.md), [technology guide](../engineering/technology-guide.md), [operations](../engineering/operations.md), [remote development](../engineering/remote-development.md), [teammate setup](../engineering/teammate-setup.md) and [blueprint release gates](../../ARDEN_BLUEPRINT.md#10-release-gates-and-unresolved-choices).

Provenance: project-lead-approved platform/environment direction and public plans, as recorded in owning sources. Original individuals for every historic detail are not known. Existing delivery owners remain in Linear, including ARD-9/ARD-26 for environment work. These acceptance cases are a coverage map; this documentation inspection did not test a deployment, install a desktop build or certify production readiness.

## F18 Web and desktop

Path: connect supported client to trusted Core → authenticate → use the same accepted feature flow → handle session/server/version changes → exit/recover without leaking private data.

| Acceptance ID | Complete path to verify | Evidence / remaining |
| --- | --- | --- |
| F18-AC1 | Shared web/Windows feature behavior, accessible navigation, unsaved-state protection and applicable responsive layouts match the accepted design. | Shared source exists; each changed behavior needs its actual platform checks. |
| F18-AC2 | Desktop renderer, IPC/allow-lists, session storage and trusted Core URL enforce the selected security boundary. | Browser rendering/build success does not establish native IPC/installer behavior. |
| F18-AC3 | Outage, incompatible versions and permitted draft/cache behavior have explicit recovery and revocation limits. | Full offline sync and Linux packaging remain later scope, not promises inferred from self-hosting. |

## F19 Development and release flow

Path: teammate obtains individual approved setup → starts local reloadable UI → updates the assigned hosted backend → verifies the same target → publishes a coherent Git checkpoint/PR when authorized → separately promotes reviewed versions to staging/production.

| Acceptance ID | Complete path to verify | Evidence / remaining |
| --- | --- | --- |
| F19-AC1 | Fresh setup uses documented commands and excluded personal settings, verifies the intended slot and avoids another active writer or release database. | Tooling/runbooks exist; teammate acceptance is per person/device/target. |
| F19-AC2 | Backend update/status/readiness, local reload, reconnect/cleanup and failure reporting work without exposing credentials or silently redirecting environments. | Link actual source/version and executed end-to-end evidence. |
| F19-AC3 | A deployment records exact artifact, intended branch/base, merge reachability, target, migrations and recovery. Staging and production data/Auth/files remain appropriately isolated. | A GitHub merge or passing CI is not target deployment; each authorized rollout needs its own checks. |

## F20 Installation and recovery

Proposed customer-release path: provision → configure trusted domain/Auth/storage/providers → bootstrap → install client → back up → restore → upgrade/rollback → support/monitor. A working team pilot does not complete these customer-release obligations.

| Acceptance ID | Complete path to verify | Evidence / remaining |
| --- | --- | --- |
| F20-AC1 | Supported hardware/OS, configuration, licenses, initial authority, ingress, secrets and provider/data-flow requirements have approved instructions and a clean installation check. | Customer support/hardware and some provider choices remain unresolved. |
| F20-AC2 | Coordinated database/content/config/key recovery, off-host backup, disposable restore, migration upgrade/rollback and ownership meet explicitly selected retention/RPO/RTO. | One snapshot or a database-only dump is not a complete recovery program. |
| F20-AC3 | Health/observability, capacity, rate limits, installer signing/update compatibility, failure/recovery and support boundaries are verified for the selected release. | No automatic HA, air-gap, root-proof privacy or production-readiness guarantee is introduced. |

## Reporting

Use [the checkpoint template](templates/resume-checkpoint.md) and owning operational evidence. Record approved versus proposed scope and actual checks separately from plans. Never include live connection metadata or credentials in public specs, PRs or screenshots. Publication, access changes and deployment retain their own authorization.
