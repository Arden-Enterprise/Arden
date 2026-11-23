# Flow 4 Knowledge Maintenance Implementation Plan

**Goal** — Let a reader report one exact published version, allow an independent reviewer to work the case, and give both sides an authorized record of the outcome.

**Architecture** — Shared React web/Electron UI calls Arden Core. Core owns cases, grants, evidence authorization, publication linkage and audit. Arden-AI handles only bounded analysis of evidence Core selected for a run.

**Stack** — Existing TypeScript, React, Fastify, PostgreSQL, Electron and pnpm workspace. The final milestone also uses the existing Python Arden-AI service and its contract fixtures.

**Read first** — [Spec](../../product/flows/flow-4-maintenance.md), [sequence catalog](../../product/flows/flow-4-sequences.md), [Arden Cursor design skill](../../../.cursor/skills/arden-flow-design/SKILL.md), [Git workflow](../../engineering/rules/git-workflow.md), [2026-11-17 UI baseline and ADR](https://github.com/Arden-Enterprise/Arden/blob/0eae5b8/docs/decisions/0022-home-start-page-and-reader-validity.md).

**Status** — Confirmed product direction. Implementation planned. Work has to be explicitly started by the workspace owner. Tasks and paths below are proposed. Reconcile them against fresh approved refs before editing actual application code.

**Continuing the full flow?** The [November 18 complete working plan](2026-11-18-flow-4-complete-working-plan.md) resumes the implemented slice and covers current staging reconciliation, remaining milestones, and full acceptance. Use its Cursor prompt. The prompt below records the original first-slice checkpoint.

## Paste into Cursor

```text
Read Arden/docs/superpowers/plans/2026-11-17-flow-4-maintenance-cursor.md,
the linked Flow 4 specification, step catalog and Arden Flow Design SKILL.md.
If Arden is the opened folder, omit the leading Arden/ from those paths.
Check repo instructions, current staging source and worktree status.
Use the existing Home → My reports, reader Report an issue, and Reviews
patterns. Use Save.design to research reusable component patterns per the
design skill, and keep existing Arden tokens and components as the base.
Show me your source baseline, scope, file map and MA acceptance IDs first.
For authorized implementation, work through Milestone 1 only and stop at
its checkpoint. Commit dates reflect actual work. Follow the repo's
publication and release rules.
```

Open the `Arden` folder in Cursor if skill discovery is unclear when opening the multi-repo parent. The skill lives in `.cursor/skills/arden-flow-design/SKILL.md`. It can also be read by path. For a local development setup, use the official [Cursor skill guide](https://cursor.com/docs/skills) and [Save.design setup for Cursor](https://save.design/mcp/cursor). The latter provides the MCP URL and authorization instructions. Connector authentication is per environment.

## Global constraints

- The current UI reference is staging `0eae5b8`. Its Home is the start page and reserves **My reports**. The reader already reserves **Report an issue**. Add **Maintenance** inside Reviews.
- Reuse Home, review list and dialog, theme tokens and reader primitives. Deliver a local component mapping and proof of relevant narrow-width and keyboard states. Use Save.design for focused component research. Existing Arden styling wins when references differ.
- One case has one permanent primary published version. Watch for publish, withdrawal, grant changes and concurrent requests. Permission-sensitive results are checked again on return or reopen.
- Reviewer case access covers only the pinned source. Other versions and diff outputs follow exact-version read policy. An author cannot claim or close their own document’s case.
- Flow 2 owns publication. No new visible status beyond **Submitted**, **In Progress**, **Resolved**. Route exceptions and run/publication states are separate.
- Add no third-party UI package, search service, notification transport, general history route or agent framework without a concrete gap. Follow current runtime roles, migration checks and release boundaries. Keep existing unrelated changes intact.
- Name only verified completed work in the checkpoint. Run focused tests and real integration evidence for the milestone being implemented. Treat recorded implementation, CI, staging runtime and acceptance separately.

## Start fresh and map the files

- [ ] Read workspace and each affected repo’s current instructions. Inspect `git status --short --branch`, `git worktree list`, approved remote heads and unpublished drafts. Stage only task-owned changes. If implementation is authorized, use an isolated `feat/knowledge-maintenance` branch based on the safely refreshed staging tip. Carry only these approved docs/skill into the branch. Rearrange the current main worktree only through the workspace procedure.
- [ ] Pin dependency contracts. Check the current [Flow 2 workflow](https://github.com/Arden-Enterprise/Arden/blob/0eae5b8/docs/engineering/mainflow-2-workflow.md), [reader AI](https://github.com/Arden-Enterprise/Arden/blob/0eae5b8/docs/engineering/reader-ai.md), reviewer authorization, audit event insertion, 0032–0035, and ADR 0022. Update the handoff baseline when the inspected code differs.
- [ ] Inspect the existing report placeholder and Home tabs in `packages/ui/src/knowledge/KnowledgeDocumentDetail.tsx` and `ServerKnowledgeFeaturePage.tsx`. Inspect `ReviewList.tsx`, `KnowledgeDialog.tsx`, `PdfDocument.tsx`, `shared/IslandTable.tsx` and `shared/StatusIslandContext.tsx`. Note the real integration points.
- [ ] Search Save.design for a report dialog, document-first case layout, diff, and audit timeline. Record short notes about the references and the Arden component they inform. Keep code and visual assets inside Arden's own approved component vocabulary. If Save.design is unavailable in that Cursor session, document the Arden pattern used for each surface.

| Area | Proposed files and responsibilities |
| --- | --- |
| Core routing | New `apps/api/src/maintenance/routes.ts` for claims, projections and validation registration. Wire through existing `apps/api/src/app.ts` seams. |
| Case domain and store | New `apps/api/src/maintenance/case-service.ts`, `case-store.ts`, `policy.ts`, `contracts.ts`. Keep SQL/action transactions in the store, business transition guards in the service, and request auth in Core. Reuse trusted membership/reviewer/access queries. |
| SQL and audit | Add sequential files under `apps/api/migrations/` and update inventory/release policy through existing procedure. New audit/notifications stores scoped to Maintenance and existing runtime privileges. |
| Client | New `packages/ui/src/maintenance/` feature, e.g. `ReportIssueDialog.tsx`, `MaintenanceQueue.tsx`, `MaintenanceCaseScreen.tsx`, `MyReports.tsx`, `CaseHistory.tsx`, `maintenance-client.ts`. Use `shared/api-client.ts` transport. Update `apps/desktop/src/main/apiRequestPolicy.ts` and its tests for exact authenticated routes and methods. |
| Version history | `apps/api/src/maintenance/version-service.ts` and `compare.ts` beside existing exact-source resolvers. New `VersionChanges.tsx`. Use canonical version IDs and existing citation/source navigation where appropriate. |
| Flow 2 linking | New `apps/api/src/maintenance/publication-link.ts`. Integrate with current contribution and publication read/decision paths through existing stores. Use a typed authoritative eligibility query rather than UI dates. |
| Analysis | New `apps/api/src/maintenance/analysis-service.ts`, `analysis-worker.ts` and worker registration under existing Core worker patterns. Add paired contract and internal route in Arden-AI, with schema and fixture counterparts in Core. |

## Milestone 1 · Human maintenance case

### Task 1 · Authorized intake and durable case

**Interfaces.** `createCase(actor, orgId, input, requestKey)` as the F4-01 contract. Returns the current projected case. Keep `documentId` and `publishedVersionId` distinct.

- [ ] Add focused route/store test cases for reading and pinning a published version, forged or stale anchors, a cross-organization version, and same-key replay versus a changed payload. A denied request must create neither a case nor an event.
- [ ] Add the case schema with scoped FKs, immutable primary ref and first-claim/revision state. Prove actor context and deny behavior using the repo’s disposable PostgreSQL harness. Allocate the next available migration after checking staging and other active work.
- [ ] Implement authorized reader report and scoped reviewer intake. Derive historical author/routing scope and validate anchor against the canonical source. Atomically create the case, idempotency record and initial history event.
- [ ] Implement a readable queue and own-reporter projections. Redact before serialization and ensure the case cannot be discovered from another organization or actor.
- [ ] Verify the API and migration checks. Expected MA-01 and the intake portion of MA-03. Suggested authorized commit: `feat(maintenance): persist version-pinned cases`.

### Task 2 · Assignment, timeline and notifications

**Interfaces.** `claimCase(actor, orgId, caseId, expectedRevision, commandKey)`, `reassignCase(..., membershipId, reason)`, `listCaseHistory(actor, orgId, caseId, cursor)`. Return explicit permission-safe projections and stable conflicts.

- [ ] Add cases for two concurrent claimers, author with a grant, reviewer grant loss, Admin reassignment and racy decision after reassignment. Assert one winning claim and append-only prior events.
- [ ] Implement grant-aware routing, tenant-scoped transactional claim/reassign, first claim status, admin exception and safe queue counts. Check the current grant inside writes and before each read projection.
- [ ] Wire append-only case event association and ordered pagination. Test timestamp ties, redacted actor/evidence, current grant/role checks, and no case/reporter crossover.
- [ ] Add transactional in-app notification records with logical de-duplication, recipient reauthorization and routing exception. Reuse existing inbox infrastructure if present. Keep messages minimally identifying and require authorized deep-link loading.
- [ ] Implement the manual **No change needed** decision and reporter explanation with exact case revision. Test that the reviewer’s rationale never appears in the reporter reply, and that closure and audit commit together.
- [ ] Verify MA-02, MA-03, MA-04 and the no-change path in MA-06. Suggested authorized commit: `feat(maintenance): assign and audit manual review cases`.

### Task 3 · Wire Home, reader and Reviews

**Interfaces.** Use authorized Core routes above. Use actual snapshot navigation and no-store responses. The UI renders the server projection.

- [ ] Enable **Report an issue** where eligible in the existing reader toolbar. Use the current dialog and status patterns. Validate report text, preserve focus and scroll, show a successful case ID, and maintain one request key across transport retries.
- [ ] Enable **Home → My reports**. Add **Reviews → Maintenance**. Build the case detail around the existing document-first pane and responsive stacked layout. Show safe waiting, loading, empty, error, lost-claim and reassignment states.
- [ ] Add keyboard-accessible **Audit history** with paginated events, visible effective focus, timestamps and user-safe message. Cover the minimal reporter view and ensure permission/entity switches clear stale detail and snippets.
- [ ] Add precise native request allowlist methods/paths. Keep web and Electron using the shared UI and same authorization rules. Test actual user paths in both supported hosts before claiming both accepted.
- [ ] Demo the report, claim, human resolution, reporter status and audit. Re-run focused Core, UI and desktop checks. Update diagrams with real wiring and evidence. Suggested authorized commit: `feat(maintenance): connect reporting and review screens`.

**Checkpoint 1.** Demo with synthetic IT Support Guide v3. A reader submits twice with the same retry key and sees one case. Two scoped reviewers race and one wins. The winner records **No change needed** and an authorized reporter sees **Resolved**. Revoke the reporter’s source access and verify minimal projection. Reassign a separate open case and verify the previous reviewer cannot act. Verify audit read/render and screenshots relative to current Home/Reviews. Stop here for the first requested milestone.

**Checkpoint 1 evidence, 2026-11-17.** The in-memory service suite in `apps/api/src/maintenance/case-service.test.ts` walked that path against a pinned publication titled IT Support Guide. Same-key replay stayed one case, one of two claims won, the author claim was denied, reassignment blocked the previous reviewer, grant loss blocked closure, and the reporter history contained the explanation without the reviewer rationale. Route, dialog, and desktop allowlist tests passed, and `pnpm migrations:check` passed. No hosted `pnpm dev:remote` session was running, so the signed-in web pass, Electron pass, and screenshots were not taken. PostgreSQL RLS was not executed.

## Milestone 2 · Version comparison and Flow 2 handoff

### Task 4 · Permission-aware version changes

**Interfaces.** `listReadableCaseVersions(actor, orgId, caseId)` and `compareCaseVersions(actor, orgId, caseId, fromId, toId, anchor?)`. Results name exact versions/anchors or a safe unavailable reason.

- [ ] Set test fixtures for v3, v4 and v5 where v4 fixes and v5 reintroduces a line. Include an inaccessible intermediate, a legacy future-applicable version, scanned PDF, and access lost during computation or before reopen.
- [ ] Add case-scoped history and compare server operations. Read the pinned snapshot only with the case-purpose grant. Filter other versions through current read policy. Validate lineage and exact pair and recheck access before output.
- [ ] Implement bounded deterministic text diff over meaning-preserving canonical text. Preserve significant whitespace and numbers, report uncertain mappings, and route unsupported text to manual original comparison.
- [ ] Build **Version changes** with sequential navigation, exact pair and applicability labels, accessible `+ Added`/`− Removed`, collapsed unchanged sections and source actions. Verify that adjacent review reveals the regression even if comparing only endpoints looks unchanged.
- [ ] Verify MA-05 and affected MA-03/MA-08. Suggested authorized commit: `feat(maintenance): compare authorized document versions`.

### Task 5 · Information requests, change requests and closure proof

**Interfaces.** `recordDecision`, `postCaseMessage`, `linkPublicationAction`, `confirmResolution` using the spec’s expected revision, caller projection and source scope. Core supplies publication evidence.

- [ ] Add tests for the reporter reply loop, inactive/unavailable author, unrelated or wrong-lineage publication, staged approval, index failure, upcoming, supersession and actual withdrawal. Include a replacement that becomes inapplicable between display and final confirmation.
- [ ] Add information request and reply, keeping **In Progress**. Send only permitted notification payloads and clear the outstanding request on the valid reply.
- [ ] Wire **Request update** and **Request withdrawal** as maintenance decisions. Create the author action and link the exact existing Flow 2 request. Keep the current author-only withdrawal API. Add Admin routing if an author cannot act.
- [ ] Add authoritative verification for a linked effective replacement, a reviewer-selected existing applicable fix or an applied withdrawal. Close only after human confirmation inside a version/revision-safe command. Persist the evidence reference and public explanation.
- [ ] Support a new related case with its own pinned version for recurrence. Preserve old case and audit entries. Verify MA-06 and MA-09 with actual Flow 2 integration evidence. Suggested authorized commit: `feat(maintenance): link cases to governed publication outcomes`.

## Milestone 3 · Bounded AI investigation

### Task 6 · Paired analysis contract and worker

**Interfaces.** `startAnalysis(actor, orgId, caseId, selectedVersionIds, requestKey)`, `cancelAnalysis`, `getAnalysis`. Internal proposal `maintenance-analysis-v1`, with ordered immutable source manifest and result findings anchored to that manifest.

- [ ] Write paired strict contract fixtures for valid evidence, unknown/forged offsets, insufficient evidence, cancellation, revocation between dispatch and write, and concurrent duplicate starts. Use fake providers and disposable data.
- [ ] Lock finite input count, text, time and attempts as implementation contract defaults and record them in the paired schemas. Reuse exact-version text preparation. Add an additive internal operation in Arden-AI for one bounded analysis scoped to the supplied evidence.
- [ ] Persist and lease runs in Core with one active run per case. Recheck assignment and source access before dispatch and commit. Reject invalid citations and stale-worker completion. Return safe failures and no raw provider bodies.
- [ ] Cover job retry/fencing, reassignment, source revocation, process restart and provider unavailability. Verify MA-07. Suggested authorized commits: `feat(ai): analyze bounded maintenance evidence` (Arden-AI) and `feat(maintenance): govern maintenance analysis runs` (Arden).

### Task 7 · Analysis UX and final integration

- [ ] Add **Analyze**, exact comparison selection, scope confirmation, queued/running and cancel/retry states. Keep **Record decision** available through the manual path.
- [ ] Display cited findings, exact source manifest and evidence gaps. When a newer authorized version is available, show the prior result’s scope and allow compare/rerun. On permission loss, withhold dependent findings and clear previous rendered content.
- [ ] Connect the case, comparison, AI run, Flow 2 handoff, closing decision, reporter status and audit for a signed-in synthetic example. Record what each host and provider environment actually proved. Suggested authorized commit: `feat(maintenance): show authorized findings in case review`.

## Checks and handoff

Use the latest instructions and manifests to select exact test files. These commands are for implementation and verification time in the relevant repo. They assume the documented local dependencies or an isolated disposable environment are already available.

```text
pnpm --filter @arden/api test
pnpm --filter @arden/ui test
pnpm --filter @arden/desktop test
pnpm migrations:check
pnpm typecheck
pnpm build
uv run pytest -q
uv run ruff check .
uv run mypy
```

The uv commands run in Arden-AI during Milestone 3. The API feature checks must exercise actual RLS and actor context in disposable PostgreSQL, including concurrency and denial. Complete a scoped signed-in web and genuine Electron visual/behavior pass for claimed client support. If an earlier rollout has a migration, review additive compatibility, operator inventory and rollback/failure handling through current release docs. Preserve separate approval for publish, promotion or deployment.

| Acceptance | Owning task(s) |
| --- | --- |
| MA-01 exact version, replay and deny | 1, 3 |
| MA-02 independent assignment and permission revocation | 2, 3 |
| MA-03 role projections and lost access | 1–4, 7 |
| MA-04 audit transactions and notification-safe retrieval | 2, 3 |
| MA-05 chronological compare, effective vs upcoming, inaccessible or scan fallback | 4 |
| MA-06 human decision and actual publication evidence | 2, 5 |
| MA-07 bounded run, cancellation, evidence and stale worker checks | 6, 7 |
| MA-08 Arden UI and host evidence | 3, 4, 7 |
| MA-09 related recurrence and preserved history | 5 |

At each milestone, list passed tests, scenario evidence, approved base and actual head, migrations, unresolved criteria and next owner. Update [canonical flow diagrams](../../product/flows/README.md) with any actual behavior and the real source revision. Maintain the separate Knowledge topic, index and dated handoff required by the workspace. Keep approved UI/product wording and implementation evidence distinct in handoffs.

## Three-week history and commit order

Documentation backfill window **2026-10-27 to 2026-11-17**, Asia/Bangkok. Keep observed chronology distinct from the proposed commit sequence. October workspace and earlier uses of “Flow 4” are context for the surrounding product, not implementation evidence for this maintenance flow.

| When | Evidence |
| --- | --- |
| Oct 27 starting baseline | Arden's latest preceding first-parent baseline was [ce912b7](https://github.com/Arden-Enterprise/Arden/commit/ce912b7), committed Oct 26 local time. |
| Oct 29 | [f5876f7](https://github.com/Arden-Enterprise/Arden/commit/f5876f7) integrated permission-aware publication foundations later reused by Maintenance. |
| Nov 3–12 | The November four-flow plan established the Knowledge Maintenance direction. Its planning handoff was shared Nov 12. |
| Nov 14 | [c6d815d](https://github.com/Arden-Enterprise/Arden/commit/c6d815d) integrated exact-document Reader AI and [7707de6](https://github.com/Arden-Enterprise/Arden/commit/7707de6) integrated Flow 2 publication change foundations in staging. |
| Nov 17 | [0eae5b8](https://github.com/Arden-Enterprise/Arden/commit/0eae5b8) is the inspected staging baseline. This dated handoff records the now-confirmed case workflow and proposed implementation contracts. |

Suggested first docs commit, if later authorized: `docs(maintenance): document flow 4 and Cursor handoff`. A truthful body can say **“Backfills project history from 2026-10-27 through 2026-11-17”** and link the verified historical revisions. Let Git record the actual author/commit time. Retain existing history and historical evidence dates. Subsequent implementation commits follow Tasks 1–7 in dependency order at their actual completion dates. Keep the Arden, Arden-AI and private Knowledge commits separate and finalize Knowledge against actual integrated revisions.
