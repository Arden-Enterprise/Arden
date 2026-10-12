# Team development flow implementation plan

> **For agentic workers:** Use superpowers:executing-plans to execute the existing authorized workflow task by task. Track operator evidence privately and publish only sanitized conclusions.

**Goal:** Each teammate starts a local UI with hot reload and synchronizes backend code to their own hosted development slot with `pnpm dev:remote`.

**Architecture:** Keep the existing SSH source synchronization, writer lease, Fastify API, and local Vite frontend. Use four assigned API/database slots managed in Coolify. Reuse supporting Supabase Auth services where appropriate; separate application databases do not require four complete Supabase installations.

**Tech stack:** Node.js 24, pnpm 11.19.0, OpenSSH, Vite, Fastify, PostgreSQL 17, Supabase Auth, Coolify.

**Spec:** [Accepted hybrid development decision](../../decisions/0001-supabase-and-hybrid-development.md) and [hosted development reference](../../engineering/remote-development.md).

## Global constraints

- Baseline: application main `972f0f9d87f2fcac420d88a664f4ffef4d8d3f01`.
- Assign one developer to each of `dev-1` through `dev-4`; distribute personal labels and assignments in private handoffs.
- Preserve existing teammate source and database contents; stop if an active writer prevents maintenance.
- Keep frontend and forwarded API listeners on loopback. Do not expose development APIs publicly.
- Keep all real server profiles, credentials, resource identifiers, backups, and handoff packets private.
- Source synchronization does not apply SQL migrations. Never edit or reapply an applied migration.
- Full sudo gives whole-host administrator access. Slot checks prevent routine mistakes; they cannot constrain an administrator. Keep actual access grants private.
- Repository publication is a separate milestone and requires authorization.

## Review focus

1. A migration journal may already contain a successful migration after an interrupted setup. Resume pending migrations from inspected state.
2. Restricted runtime roles and administrative schema setup have different responsibilities. Check role ownership and RLS privileges explicitly.
3. A syntactically accepted Compose file can omit an existing service or change persistent mounts. Compare its service and storage inventory with the running installation.
4. Existing teammate code may be newer than main. Preserve it during reassignment; the first writer must choose the intended checkout deliberately.
5. Local ports, keys, and SSH agents differ between computers. Report owner-machine verification separately from teammate first-login acceptance.

## Task 1: Reconcile hosted slots

**Files:** Private operator scripts and protected server configuration; public instructions in `docs/engineering/remote-development.md` and `docs/engineering/operations.md`.

**Interfaces:** Retain `ops/sync.py SLOT ACTION TOKEN`, `ops/start.py SLOT`, the protected slot assignment file, and the existing maintenance fence.

- [x] Fetch approved main; inspect source, service, database, migration, writer, and account state without changing it.
- [x] Identify incomplete schema setup and differences between intended and actual Compose services.
- [x] Back up affected source/configuration and databases under protected operator storage.
- [x] Apply only pending reviewed SQL through the approved administrative migration connection; preserve runtime role restrictions.
- [x] Give `dev-4` a dedicated application database/API while preserving existing `dev-2` and `dev-3` data and source.
- [x] Map four separate source/state directories to the four approved account identities.
- [x] Inspect and deploy complete Compose with retained database storage, loopback ports and persistent note storage.
- [x] Record four healthy API readiness responses and the cleared maintenance fence.

## Task 2: Complete the command and handoff

**Files:** `tools/remote/cli.mjs` and `tools/remote/transport.mjs` only if observed behavior requires a fix; ignored per-person setup packets.

**Interfaces:** Keep `pnpm dev:remote`, `pnpm remote:preview`, `pnpm remote:status` and `.private/remote.json` compatible with existing callers.

- [x] Inspect local port/process ownership and prepare an ignored owner profile without changing unrelated checkouts.
- [x] Start the owner workflow and record source synchronization, hosted API readiness, local frontend startup and observed browser behavior.
- [x] Resolve only defects supported by this evidence; record checks actually executed.
- [x] Prepare updated private slot settings for teammates without reading or sharing their private keys.
- [x] Record each teammate's real first login and local coding session as pending until observed on their computer.

Owner startup and a controlled task-owned frontend stop/restart were observed. A later tool-mediated Ctrl+C ended the Windows launcher before lease cleanup; the operator released that task's own reservation through the normal account protocol, and the slot is available. Saved-edit UI/API reload, ordinary interactive Ctrl+C and reconnect acceptance remain pending rather than being inferred from healthy services or source inspection.

## Task 3: Make the guide match the running setup

**Files:** `docs/engineering/teammate-setup.md`, `docs/engineering/remote-development.md`, relevant operations/technology status, and sanitized Knowledge handoff.

- [x] Replace obsolete setup-branch instructions with current main and explain the one-time setup separately from daily coding.
- [x] Explain local UI edits, server API edits, manual migrations, leases, stopping and reconnecting in simple language.
- [x] Document the actual application database/Auth boundaries and what Coolify manages.
- [x] Check task-owned relative links, formatting and exclusion of private values.
- [x] Update existing Linear issue ARD-9 with executed evidence and remaining acceptance; create no duplicate issue.
- [x] Inspect the complete diff and offer a PR once the reviewable work is ready. The owner authorized PR publication on 12 October 2026; merge remains a separate milestone.
