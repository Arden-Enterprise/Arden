# Implementation status and rollout boundaries

## Knowledge organization KM2-P4A — local Home composition, 19 November

Home now separates Organization, Shared with me and a conditional Other documents
compatibility view. Organization alone supplies the common register, Collections
and Unassigned. Shared uses approved Department/Selected readers; unknown legacy
sharing is not silently classified. Private notes opens the existing owner-only
workspace; My Contributions remains the contribution path. No new Library route.

Independent scoped requests distinguish loading/error from empty, discard stale
responses and clear failed/known-denied sources. Per-source search/filters and
reader-return focus survive navigation. Home filtering does not select AI context
or bypass server authorization. Existing Island styling/artwork is retained.

Root1007 tests pass with isolated PostgreSQL enabled (domain22/API526/UI441/
desktop18, one provider-gated skip); remote16 pass. Production-component browser
checks use a labelled synthetic HTTP fixture, not signed-in DB/native E2E.
See [P4A evidence](../evidence/2026-11-19-knowledge-organization/README.md#km2-p4a--home-composition).
Reviewed live mapping/backfill, protected restore/cutover, schema contraction and
release acceptance remain pending. This slice is local/unpublished, not a rollout.

## Knowledge organization KM2-P3B.3 — local management UI, 19 November

Shared Admin UI now separates Name/Allowed types/Description configuration from
revisioned logical-document placement. It shows Unassigned and folder contents,
filters explicit Organization publications and compatible destinations, confirms
Archive, and supports Cancel/dirty discard/read loading/conflict/uncertain outcomes.
Background refresh cannot upgrade an edit's precondition. Topic browsing/filter
controls and old bulk picker are removed; source/history/schema remain intact.
The native confirmation fallback now restores focus after closing its top layer.

Final root986 tests pass: domain22/API526/UI420/desktop18 (real isolated PostgreSQL
enabled, one provider skip). Final workspace typecheck/build pass. Local browser interaction checks exercise production UI and
client against synthetic volatile HTTP fixtures; screenshots are labelled. This
does not establish authenticated combined app/DB E2E or genuine Electron behavior.
See [evidence](../evidence/2026-11-19-knowledge-organization/README.md#km2-p3b3--collection-management-ui).

The P4A checkpoint above supersedes the Home-composition-pending status. Still pending: reviewed live legacy
mapping/backfill, protected backup/restore/cutover, physical schema contraction and
authorized release. No commit/push/PR/merge, staging mutation, provider call or deploy.

## Knowledge organization KM2-P3B.2 — local backend / legacy rehearsal, 19 November

Configuration and logical placement API now use 0039 storage, controlled Allowed
types, revision/ETag, transactional audit and current eligible publication
projection. Old bulk link payloads receive409; obsolete runtime Collection link
writes are removed. Shared adapters and exact Electron allowlist are updated,
not the management UI. A local-only explicit-plan conversion module is tested
with actual deletion of converted synthetic legacy associations and full rollback
on audit failure, preserving readers, publications and Topic history.

Final workspace968 passed/one provider skip; focused backend61 passed; workspace
typecheck/build, remote16, unchanged migration39 and Python119 pass/seven skips.
[Evidence](../evidence/2026-11-19-knowledge-organization/README.md#km2-p3b2--collection-api-and-explicit-legacy-rehearsal).
UI, real legacy inventory/mapping, live backup/restore/cutover and physical Topic/
legacy-table contraction remain. No staging data, provider or release operation.
The [runbook](collection-legacy-transition.md) owns compatibility and removal gates.

## Knowledge organization KM2-P3B.1 — local schema checkpoint, 19 November 2026

The maintainer approves one optional Collection, Admin-only placement, controlled
Allowed types and version-following/Archive-to-Unassigned. Forward operator 0039
adds logical placement, same-organization/Type/readership constraints, retained
revision tombstones and reconciliation. Legacy links stay untouched. API/UI still
use old storage: Add/Move/Remove/Archive management is **not connected** yet.

Real isolated post-ownership tests pass: workspace 938 passed/one provider skip;
focused final repository file 30 passed, including ten new schema cases. Build,
workspace typecheck, 16 remote-tool tests and 39-migration inventory pass. Release
Python tests: 119 passed/seven platform skips. API typecheck repeated after the
final fixture refinement. No full restore, staging/native/provider acceptance or
release is claimed. [Evidence](../evidence/2026-11-19-knowledge-organization/README.md#km2-p3b1--flat-folder-database-foundation).

Next: P3B.2 management API/compatibility and explicit legacy inventory, then P3B.3
UI/E2E. No new rule approval needed for those accepted choices; target-specific
staging migration/backfill/deployment authority remains separate.

## Knowledge organization KM2-P3A — partial local checkpoint, 19 November 2026

Collection list/write eligibility and the existing picker now require approved
Organization readership, independently of what the Admin can otherwise read.
Later restriction hides existing links/counts without changing ordinary document
access or deleting legacy placement. Two UI regressions and three real PostgreSQL
cases cover the new boundary; a small checkbox-width correction keeps labels
together. Existing styles/assets and Cancel/Discard controls remain.

Workspace checks pass: 928 tests, one provider-gated skip; typecheck/build,
16 remote-tool tests and unchanged 38-entry migration inventory. The real database
tests reuse the isolated post-ownership schema; native/authenticated staging and
provider acceptance are not established. [Evidence](../evidence/2026-11-19-knowledge-organization/README.md#km2-p3a--organization-only-collection-boundary)
includes the actual component in a synthetic local harness, not a deployed app.

At this earlier P3A checkpoint those P3B decisions were pending; the P3B.1 entry
above supersedes that status. No P3A schema migration, backfill/reset,
reindex, Git publication or deployment. Do not mark the entire Phase 3 complete.

## Knowledge organization KM2-P1/P2 — local checkpoint, 19 November 2026

From staging `af28915`, the local `feat/knowledge-scope-foundation` checkout adds
optional authorized publication-list scopes and Topic-free contribution. New
metadata saves clear Topic, submit no longer depends on its catalog, and old
frozen snapshots remain intact. Home/catalog composition, flat Collection detail
rules and legacy metadata repair remain open; no current staging behavior is
changed by this uncommitted checkout. See the [phased contract](knowledge-organization-phases.md)
and [actual evidence](../evidence/2026-11-19-knowledge-organization/README.md).

Root checks: 923 passed/1 provider-gated skip with isolated PostgreSQL enabled;
typecheck/build, 16 remote-tool tests and the unchanged 38-migration inventory pass.
Real runtime/RLS/worker-contract tests run after full DDL ownership transfer;
activation uses synthetic manifests, not real embeddings or provider calls.
Component screenshots do not certify authenticated web/native E2E. No staging
migration/backfill, reindex, commit/push/PR, merge or deployment in this checkpoint.

## Minimal reader lifecycle refinement — review preparation, 15 November 2026

After the focus/panel diagnosis, the maintainer approved the
[minimal Reader AI refinement](reader-ai.md#ra-0405-refinement-switching-panels-is-not-close-accepted-14-november-2026).
One exact-reader access session is shared by Summary/Q&A. Internal panel changes,
PDF/DOM focus and repeated active-panel selection do not recheck/discard results;
actual hidden-tab return and citation navigation still validate current access.
Close/context changes clear transient results; known denial remains fail-closed.
PDF page/citation is no longer cleared on blur or a temporary check failure.
Prepared for a PR targeting staging; not merged or deployed. No backend/AI/DB/
dependency change or paid call. The final review/CI checkpoint belongs in the PR.
Genuine Electron/native PDF and signed-in staging acceptance remain separate.

## Summary reliability — local follow-up, 14 November 2026

The accepted [SR-1–SR-5 refinement](reader-ai.md#summary-reliability-refinement--accepted-14-november-2026)
adds per-publication cooldown, bounded same-actor in-flight joining with independent
final authorization, classified safe failures, manual Retry countdown and metadata
diagnostics. No completed/shared cache, DB/index, model or dependency changes.
This follow-up is local and not deployed; existing provider/native acceptance is
not upgraded by offline checks or the synthetic browser preview.

## Reader panel session follow-up — 14 November 2026

The [Reader AI refinement](reader-ai.md#ra-0405-refinement-switching-panels-is-not-close-accepted-14-november-2026)
retains Summary/Q&A only within the same mounted exact-version reader and revalidates
before revealing retained results. Explicit dismissal/context change still clears them.
Local regression tests cover switching/in-flight/denied cases and duplicate return events;
integration, CI and staging activation require their own final-revision evidence.
No model, provider budget, persistent cache or AI-service change is introduced.

## Governed answering v2 — feature checkout, 13 November 2026

The paired [governed hybrid answering contract](governed-hybrid-answering.md)
implements staged retrieve/authorize/generate, filtered semantic + BM25/RRF,
current-applicable version selection and owner-private persisted conversations.
Operator migration 0031 and actual RLS/indexing/history workflows have only been
rehearsed on disposable local PostgreSQL, including post-ownership transfer.
Not yet committed, integrated into staging or deployed. Live provider relevance
and signed-in browser acceptance remain unverified. This checkpoint supersedes
historical claims below that chat persistence is wholly unimplemented, without
certifying the rest of the historical inventory.

## Reader AI — local checkpoint, 14 November 2026

[RA-02/RA-03](reader-ai.md) now implement exact-version source preparation and a
bounded whole-text Summary backend, with original-source citations and final reader
authorization. RA-04 adds the on-request shared reader panel, strict web/native
adapters and no-model access revalidation. RA-05 adds stateless Ask this document:
one exact-generation hybrid retrieval, source-bound cited answers, fixed insufficient
copy, shared reader interaction and native request validation. Local regression and
12 real disposable PostgreSQL cases pass. Genuine Electron and signed-in paired
acceptance remain unverified; the maintainer explicitly retained them before release
while approving local RA-05 development. No cache/history write or selection
explanation is delivered. Provider-quality acceptance remains separate.
Model/effort and shared data are unchanged; no paid calls or publication/deployment.
Fetched staging is now `5bd752c`, while this dependent checkout remains `a07f575`.
Its unpublished GA-v2 migration 0031 conflicts with staging's reviewer-grant 0031;
reconcile the integration/migration plan before any release, not by editing applied SQL.

This inventory was moved from the main agent entry point during the October 2026 rules reconciliation. Keep it synchronized with the [technology guide](technology-guide.md), source and operational evidence; a documented capability is not proof it is deployed.

Decision 0010 supersedes the role-based product wording in the historical inventory below. The current application contract uses Member and Organization Admin for organization capability, Reviewer Grants for review authority, canonical Audiences for published readership, and installation-level Arden System Admins that have no organization/content bypass. Custom Role endpoints and UI have been removed; migration 0017 retains legacy role-backed columns and shadow writes only as a bounded compatibility bridge until the Phase 5 schema contraction.

Release automation is implemented in the [release design/runbook](release-pipeline.md): free public GitHub runners perform source/database/image checks and build temporary web/API images, while a restricted receiver lets Coolify replace only the app pair. Production promotion requires the same fresh authenticated staging tree and exact images. Revision `73e6bee` deployed in [run 40712177548](https://github.com/Arden-Enterprise/Arden/actions/runs/40712177548), attempt 2; a controlled rollback restored the exact previous pair, and attempt 3 verified automated recovery. Revision `8506abc` subsequently passed [staging run 40719483404](https://github.com/Arden-Enterprise/Arden/actions/runs/40719483404), with exact live image/tree, readiness/denial and infrastructure/storage checks. The owner-approved 0017→0021 schema/app cutovers were verified in both environments on 29 October, with paired recovery backups and preserved infrastructure/private volumes. Source `f347579` then passed [automatic staging deployment](https://github.com/Arden-Enterprise/Arden/actions/runs/40824623831), attempt 2. Per-release activation and current main/staging outcomes are recorded in [GitHub deployments](https://github.com/Arden-Enterprise/Arden/deployments) and ARD-65; later source updates require their own evidence. These release checks do not establish live AI, mail, sign-in or whole-product readiness.

Decision 0016 approves a server-side migration runner for explicitly reviewed `expand` migrations. Implementation is in local branch `feat/release-migration-runner` only; it has not been pushed, enabled on the server, or exercised against staging/production. Windows checks on 2026-10-30 passed typecheck, workspace tests, remote-workflow tests, production builds, release-client/inventory tests and 99 receiver tests (8 platform skips). The laptop has no Docker CLI; its built-image/PostgreSQL smoke and Linux-only hosted-maintenance suite await the hosted Ubuntu runner. Per-environment database credentials, checksum-baseline receipts and current backup/restore-readiness records remain separate server prerequisites. A green local build is not evidence of migration or deployment readiness.

The repository has the shared React frontend for web/Electron: the Island workspace with Living Archive authentication/onboarding, with connected My Work, organization administration, and knowledge workflows. The backend implements Supabase Auth email/password and Google PKCE account setup through a Fastify BFF, `/api/v1/me`, organization bootstrap, Org Admin-checked department/member/Audience Group administration, Reviewer Grants, Arden System Admin lifecycle APIs, hashed-token invitation create/resend/revoke/accept APIs with configurable SMTP, owner-private note APIs, versioned PostgreSQL migrations with RLS and a non-bypass Arden runtime role, protected file-backed note bodies, and a web/desktop API client. Web session tokens stay in HttpOnly cookies; desktop sessions remain encrypted in OS storage behind a narrow main-process bridge. The loopback-only local Mainflow 1 test provider remains restricted to synthetic `@example.test` accounts and loopback `arden_test_*` databases, and always uses a mail sink. A historical no-login test adapter remains in code for the earlier `dev-2` test target; its exact conditions and limitations are documented in the operations guide. It is inactive in the current four Supabase-authenticated hosted slots and must not be treated as an onboarding path. Migrations 0003 and 0004 fix RLS recursion in scope/role policies and are applied to Kiet Local. Migration 0005 permits reading accepted invitations by the accepting actor, fixing the RLS violation when updating invitation status to ACCEPTED under `arden_runtime`; it is applied to Kiet Local and verified via a rehearsal transaction. A rollback-only transaction verified that organization bootstrap now completes under `arden_runtime`; the transaction was rolled back, so no organization was created. `/api/v1/me` also succeeds there. Real SMTP delivery, broader RLS behavior, Supabase account/email flows, and end-to-end frontend interactions remain unverified. The current hosted layout and its limited readiness evidence are documented in the remote development guide; historical migration rehearsals below do not identify the current slot databases. Existing organization data requires an explicitly reviewed creator/admin backfill before migration 0002 applies. See [Mainflow 1 preview](mainflow-1-preview.md), the [first-slice contract](first-slice-permission-and-api-contracts.md), and the [audience/system-admin implementation plan](audience-system-admin-implementation.md) for current boundaries and remaining work.

- The API implements shared-draft list/read/edit/submit, Reviewer Grant review, publication, Audience Group administration, and Arden System Admin lifecycle routes. Synthetic API/UI/desktop checks cover the application contracts. Migration 0017 and the complete RLS path still require clean-install and populated-upgrade rehearsal on a disposable PostgreSQL database before deployment.
- Google OAuth supports a separately validated public Auth origin for browser authorization while token exchange stays on the private gateway. Adapter tests cover the origin boundary, verifier payload and rejected configuration. Every production-mode API needs `SUPABASE_AUTH_PUBLIC_URL` before rollout; Google provider credentials and a real sign-in remain separate unverified requirements. See [operations](operations.md).
- The `feat/identity-invitation-review` bundle includes the invitation email logo, batch invitations, account password guidance and link-only recovery, 24-hour sessions, reviewer-grant deduplication/history, and shared-draft version history. Source branches report focused checks for their individual changes; tests and builds have not been rerun on the combined branch. Live SMTP/mail-client rendering, Supabase acceptance, Electron interaction, and deployment remain unverified.
- Current tooling: Node.js 24 in CI, pnpm 11.19.0, strict TypeScript, React/Vite, Electron/electron-vite, Fastify with `pg`, PostgreSQL 17 via a pgvector image, and Vitest. Exact versions come from manifests and lockfile.
- Manual local Mainflow 1 browser testing before Supabase setup may use the fenced auth/mail-sink mode documented in `docs/engineering/operations.md`; it requires an isolated loopback `arden_test_*` database and synthetic accounts. It must never use a tunnel or Coolify target. The historical Kiet hosted no-login adapter requires its exact earlier PostgreSQL host/database, development mode, absent Supabase configuration, and SSH-only API exposure; it is inactive in the current four Supabase-authenticated slots. Do not remove Auth settings or change database targets to enable it. Neither test mode may run in production or staging. Treat historical rehearsals as evidence only for their recorded targets; consult the current hosted layout before onboarding or operating a slot.
- Planned: React Router, TanStack Query, Sigma.js/Graphology, Drizzle migrations for future schema authoring, pg-boss worker, an Ollama/private-endpoint model gateway, Supabase Realtime notifications, and Playwright coverage.
- Planned does not mean installed, configured, secure, licensed for every use, or tested. Add only the part needed for the authorized feature, with compatibility/license review and tests.
- Supabase is the accepted identity direction; this slice uses Supabase Auth behind Fastify while Arden's organization and content authorization remains server-owned. Web sessions use HttpOnly cookies and desktop uses OS-secure cookie storage. Supabase service-role keys stay server-only; do not run Better Auth or another parallel auth system. The [hybrid development guide](remote-development.md) covers four hosted API/database slots with local frontends. Do not add a graph database, Redis, Elasticsearch, Kubernetes, or a separate vector database without a documented need and accepted architecture decision.
