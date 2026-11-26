# F21: In-app notifications

- Spec revision/date: 4 / 2026-11-22
- Decision state: accepted for implementation by the requesting user
- Originator: current user supplied the plan; identity is unavailable in the public record
- Decision owner: unknown; the user's explicit implementation authorization is recorded, but organizational authority is not inferred
- Record author: Codex coding agent
- Approval: the user message on 2026-11-19 explicitly requested implementation of the complete plan
- Intended audience: public-safe product and engineering contract
- Source/code baseline and affected repositories: Arden `origin/main` `9fa3d34a19a559318eff87b4487f2113e6ee5a49`; current implementation branch `feat/document-share-notifications` based on `origin/staging` `611092903c22e8dc85d8c02361254441ca5286e5`; Arden Core, shared UI, Windows desktop, database/release operations
- Related Linear issue: unavailable in this session; no issue ID was created or inferred
- Supersedes / superseded by: none; see [decision 0025](../decisions/0025-in-app-notifications.md)

## Goal, scope and decisions

Give each active organization member a durable inbox, with Realtime used only to make the inbox refresh quickly. PostgreSQL/Core remains the source of truth for notification content, read state and current authorization. This follows [decision 0001](../decisions/0001-supabase-and-hybrid-development.md) and the current review/publication rules in [decisions 0011–0015](../decisions/0011-permission-aware-publication-and-semantic-documents.md).

V1 covers review requests, review outcomes, publication activation/failure, personal and group document sharing, primary department changes, and reviewer-grant creation/revocation. Review-request recipients follow current Organization Admin, Department/Organization grant and frozen legacy rules. A personal share creates `DOCUMENT_SHARED_PERSONAL`; an approved reader selection in `SELECTED_MEMBERS` mode supplies its recipients. A group share creates `DOCUMENT_SHARED_GROUP`; approved `DEPARTMENT` or `ORGANIZATION` reader selections supply its recipients. Both share events are created only after a `READER_CHANGE` request for an already-current publication is approved. Publication activation has its separate `PUBLICATION_ACTIVE` event and does not send a share notification. Fan-out includes active recipients in the approved selection who also pass the publication's frozen audience, and excludes the requesting author. Events and their outbox rows are inserted in the approval transaction. Each approved request is idempotent per recipient.

The current approved `Change readers` workflow is the event source. This change prepares the notification contract and database hook for a later Share button; it does not add that button. A future Share UI should create the corresponding reviewer-approved reader-selection request so its recipients receive the same personal or group event after approval.

### Notification types

| Type | Notification |
| --- | --- |
| `REVIEW_REQUESTED` | A knowledge item is waiting for review. |
| `REVIEW_APPROVED` | The author's knowledge request was approved. |
| `REVIEW_REJECTED` | The author's knowledge request was rejected. |
| `PUBLICATION_ACTIVE` | The approved publication is active. |
| `PUBLICATION_FAILED` | Publication could not be completed. |
| `DOCUMENT_SHARED_PERSONAL` | A named colleague shared a named document with the recipient personally. |
| `DOCUMENT_SHARED_GROUP` | A named colleague shared a named document with the recipient's group. |
| `PRIMARY_DEPARTMENT_CHANGED` | The recipient's primary department changed. |
| `REVIEWER_GRANT_CREATED` | The recipient received a reviewer grant. |
| `REVIEWER_GRANT_REVOKED` | A reviewer grant was removed from the recipient. |

The API provides paged `all`/`unread` inbox reads with an unread count, mark-one-read, mark-all-read and a short-lived Realtime credential. Every request, item target and membership is checked using current server policy. A share notification names the person who requested the share and the published document title, without document body or excerpts. Core returns these details and a target only while the recipient can still read the current publication through PostgreSQL RLS; otherwise it returns generic unavailable text and no target.

The server outbox broadcasts only `{ notificationId }` to an exact private topic. The client fetches the item through Core. Reader tokens are scoped to one environment namespace, organization and membership, expire after two minutes and remain in memory. The desktop main process owns Realtime and sends only validated IDs through narrow IPC. Reconnect, focus and inbox opening reconcile state through the API.

V1 does not include inspection alerts deferred by [decision 0024](../decisions/0024-admin-only-direct-withdrawal.md), email, OS push, AI/My Work/connector alerts, or role/suspend/restore events before those lifecycle flows exist. Notifications do not replace review queues, audit records or permission checks.

No Linear connector was available during this implementation, so scheduling/assignment remains unlinked. There is no claim that the issue tracker contains this work.

## Actors, dependencies and paths

- Members use the shared React inbox in web and Windows desktop. Their current active organization membership determines the inbox scope.
- Reviewers/Admins receive only review requests they can currently review under the frozen snapshot rule. Authors receive decisions and publication state while their current ownership path remains available. Affected members receive department/grant updates only while active.
- Fastify and PostgreSQL own writes, authorization, paging, read state and retryable outbox work. Supabase Realtime transports a minimal signal; it does not authorize document access.
- The outbox dispatcher connects with a separate non-inheriting login, then uses the `arden_notification_worker` capability role. That role can read only notification envelopes and update only delivery-state columns; it has no access to Arden business content. Actor inbox access remains on the normal `arden_runtime` connection.
- Web obtains the short-lived credential from Core and opens a private channel. Desktop obtains it in Electron main through the cookie-backed Core request path. Neither renderer stores the Core session or notification signing secret.
- If Realtime is unavailable, the durable inbox still loads through Core and refreshes on opening, focus or reconnection. If a target is stale or access has been revoked, Core omits the target or returns the ordinary denied/not-found screen.
- Environment namespaces separate local/development slots, staging and production. A deployment must configure the matching Realtime JWT verifier, scoped roles/policies, TLS/WSS proxy and browser `connect-src` before enabling the feature.

## Acceptance and evidence

| ID | Observable requirement, including relevant failure/denial cases | Implementation reference | Evidence actually obtained | Remaining/owner |
| --- | --- | --- | --- | --- |
| F21-AC1 | Each in-scope source event creates one notification/outbox per current authorized recipient in the same transaction; rollback leaves neither; duplicates do not fan out twice. | `apps/api/migrations/0039_in_app_notifications.sql`; repository integration tests | Disposable PostgreSQL authorization CI passed on `2205ecf`, exercising the API integration suite; the local API run skipped its database cases. | Rehearse backup/restore and the migration chain before any shared-environment rollout. |
| F21-AC2 | Review requests follow current Admin and disjoint Department/Organization grants, including frozen legacy submissions; inactive, wrong-scope, expired and revoked reviewers receive no request. | Migration trigger and Core review policy | Disposable PostgreSQL authorization CI passed on `2205ecf`; the suite covers organization grants, legacy Department/Senior fallback and denial for the wrong scope. | Verify the exact shared environment's current grants and revocation behavior before rollout. |
| F21-AC3 | Authenticated APIs page all/unread notifications, report unread count, and mark one/all read; foreign organization, inactive membership, malformed cursor and foreign item fail closed. | `apps/api/src/notifications/routes.ts`, `store.ts`, and notification-scoped methods in `apps/api/src/db/repository.ts` | The API checks review authority against submission IDs present in this member's notification rows; the same authorized IDs filter unread count and pages. Focused route tests pass 9/9, including an older authorized request after 100 newer unrelated resources. Disposable PostgreSQL authorization CI passed on `2205ecf`; local database cases were skipped. | Full signed-in web/desktop inbox flow with current database permissions remains. |
| F21-AC4 | Revoked review permission or ownership does not expose protected details or target; a share notification's author name/title and target are returned only while the recipient can currently read the publication. Opening a target rechecks current permission. | Notification route and resource-scoped repository checks | Route tests cover lost review authority, lost authorship and redaction of share name/title after access loss; repository integration cases cover allowed/denied resource IDs, including a batch larger than 100. | Signed-in web/desktop flow with current database permissions remains. |
| F21-AC5 | Outbox leases safely across workers, broadcasts only an opaque notification ID, retries transient errors and stops after bounded attempts without losing inbox data. | `apps/api/src/notifications/outbox.ts`, `realtime.ts` | API tests cover ID-only REST payload and HTTP failure. Disposable PostgreSQL authorization CI passed on `2205ecf`, including lease and bounded-retry cases. | Multi-worker shared-environment rehearsal and real Realtime REST delivery remain. |
| F21-AC6 | Reader JWT expires in two minutes and matches one exact environment/org/membership topic; reader cannot send and sender cannot read or access Arden tables. | `realtime.ts`, `deploy/supabase/realtime-notifications.sql` | API token tests pass, including two-minute expiry; scoped SQL policies are implemented but have not been applied or probed against Realtime. | Verify role, topic, write denial, sender/read denial and token rejection on the target Realtime service. |
| F21-AC7 | Web/desktop inbox supports unread state, paging, empty/error/offline states, keyboard operation and narrow screens; duplicate/reconnect signals reconcile from Core. | `packages/ui/src/notifications`, `apps/desktop/src/main/index.ts` | UI notification suite passed 4/4, including offline, keyboard, organization switch, duplicate signal and mocked reconnect. Desktop IPC policy passed 17/17. | Native Windows interaction, responsive visual review and CSP/WSS acceptance remain. |
| F21-AC8 | Organization switch, sign-out, session loss and window shutdown close the old channel and clear prior-organization state; desktop IPC carries IDs only. | `NotificationProvider.tsx`, desktop main/preload | Web organization replacement test passes; Electron allowlist denies renderer access to the credential route and permits only inbox/read APIs. | Native Electron sign-out, expiry and shutdown/revocation rehearsal remains. |
| F21-AC9 | Realtime stays disabled until environment secrets, namespace, policies, proxy and monitoring are verified; migration uses operator-reviewed rollout/recovery. | Operations and release guides | Migrations 0039 and 0043 are registered operator-class; `node tools/releases/migrations.mjs check --base 611092903c22e8dc85d8c02361254441ca5286e5` passed for 43 entries. | No Realtime environment, shared migration, policy probe, publication or deployment has occurred. |
| F21-AC10 | Only approval of a `READER_CHANGE` request for an existing current publication creates a share notification. `SELECTED_MEMBERS` creates `DOCUMENT_SHARED_PERSONAL`; `DEPARTMENT` and `ORGANIZATION` create `DOCUMENT_SHARED_GROUP`. Notify every active recipient in the approved selection who also passes the frozen audience; exclude the author. Publication activation does not create a share event. The message names the sharer and document without body/excerpts; Core returns those details and a target only while current RLS permits reading. Reapplying the same approved request does not duplicate a recipient's event. | Migration `0061_document_share_notifications.sql`; notification store/route and `listReadableCurrentPublicationIds`; reader-change integration and route tests | Current local checks pass for typecheck, focused and workspace tests, build and migration/release inventories. Database fan-out cases are present but skipped locally without `ARDEN_TEST_DATABASE_URL`; details follow. | Disposable PostgreSQL migration/RLS and approved-reader-change rehearsal; exact Realtime target and web/desktop acceptance remain separate. |

### Scope refinement — 2026-11-22

- Originator/approval: current user requested share notifications and confirmed that the people the document is shared with should receive them. Identity and organizational decision-owner role are not established by this public record. Record author: Codex coding agent.
- Accepted behavior: publication and sharing are separate. After the reviewer approves a reader-selection request for an existing publication, send notices to all active recipients in that approved selection who pass the frozen audience. `SELECTED_MEMBERS` is a personal share (`DOCUMENT_SHARED_PERSONAL`); `DEPARTMENT` or `ORGANIZATION` is a group share (`DOCUMENT_SHARED_GROUP`). The notice names the sharer and document, contains no body/excerpt, and is redacted with no target if the recipient loses current access. Publication activation remains `PUBLICATION_ACTIVE` and never emits a share notice.
- Integration boundary: the user asked to prepare notification support so another contributor can add the Share button later. There is no Share button in this change. The approved reader-selection update is the integration hook; the future button should create the corresponding reviewer-approved request and let this path fan out notifications.
- This is an additive refinement of F21 within the existing PostgreSQL/outbox/Core architecture, replacing the earlier activation-as-share behavior. It does not enable Realtime or authorize migration, merge or deployment.

### Share notification verification — 2026-11-22

- Branch `feat/document-share-notifications`, based on `origin/staging` `611092903c22e8dc85d8c02361254441ca5286e5`: `pnpm typecheck` passed; focused notification route/store tests passed 11/11; `pnpm test` passed (API 481 passed/77 skipped, UI 452, domain 22, desktop 19); `pnpm build` passed with the existing large-bundle advisory; Python migration-baseline/schema-recovery tests passed (15 and 4); migration inventory check passed for 43 entries; release/migration inventory tests passed 28/28; `git diff --check` passed.
- `ARDEN_TEST_DATABASE_URL` is unset, so PostgreSQL integration cases—including approved personal/group reader-change fan-out and worker column-permission checks—were skipped locally. No migration was applied, and no shared database, Realtime service, publication, merge or deployment was changed.

## Delivery and change history

Implementation is on `feat/in-app-notifications-ready` for PR #56, based on `staging` at `af28915231817aaf6efc67c8f534b627aa45b178`. The notification-resource permission fix follows reviewed branch head `de74302f9a2506ef7f15c1dca72dfa10c3e3ee42` and is published as `2205ecf`. No shared environment or Realtime configuration was changed. The dispatcher uses a separate NOLOGIN capability role and a dedicated non-inheriting database login; it cannot read Arden business tables and may update only outbox delivery fields. Linear issue tracking could not be updated because no Linear connector is available in this session; this specification is the local task record pending tracker access.

### Review fix checkpoint — 2026-11-20

- Review requests now derive candidate submission IDs from the current member's own notification rows, then apply the existing review policy only to those IDs. This removes the review queue's newest-100 list from notification authorization and unread counting.
- Review outcomes and publication notifications now recheck author membership against only the submission IDs on the returned page; they no longer use the newest-100 author submission list to choose their message or target.
- Local verification on this revision: `pnpm typecheck`, `pnpm test` (API 433 passed / 43 database-dependent tests skipped; UI 389 passed; domain 12 passed; desktop 17 passed), `pnpm test:remote` (16 passed), `pnpm build`, and focused notification route tests (9 passed). Local database tests were skipped because `ARDEN_TEST_DATABASE_URL` is unset.
- GitHub Actions runs 44694216846 (push) and 44694224715 (PR) passed on `2205ecf`, including Ubuntu, Windows, Disposable PostgreSQL authorization, and image build/security jobs. The release deployment job was skipped; no deployment occurred.

### Verification checkpoint — 2026-11-19

- Passed: `pnpm typecheck`; `pnpm test` (API 431 passed/43 skipped, UI 386 passed, domain 12 passed, desktop 17 passed); `pnpm test:remote` (16/16); `pnpm build`; `pnpm migrations:check --base af28915231817aaf6efc67c8f534b627aa45b178`; `node --test tools/releases/migration-inventory.test.mjs` (14/14); focused API notifications (15/15), UI notifications (4/4), desktop IPC (17/17), and `git diff --check`.
- The three skipped API files include database integration coverage. `ARDEN_TEST_DATABASE_URL` is unset, Docker Engine is unavailable, and PostgreSQL client/server binaries are absent; no real PostgreSQL, role/RLS, Realtime policy, native Windows or staging end-to-end verification ran. The web build reports large-bundle advisory warnings but succeeds.
- No environment was configured or migrated. Keep activation pending disposable-database rehearsal, exact Realtime JWT verifier/policy probes, CSP/WSS/native checks and target-specific backup/recovery review.

### Staging integration — 2026-11-23

PR #64 is reconciled with staging `c51c10f`, including Flow 4 migrations 0043–0060.
The new share-notification migration is 0061; applied migration history is unchanged.
Share targets carry the currently authorized publication ID. Opening a notice loads
that exact publication through the existing reader authorization and selects the
Organization or Shared with me tab from the returned reader policy. Revoked targets
remain redacted and cannot open document content. Notification navigation also
uses the discard confirmation when a contribution or review note is unsaved.

The release inventory has 61 operator-reviewed/history entries. The ownership
rehearsal expects 48 trusted routines and the recovery inventory explicitly matches
Flow 4 overload signatures. Database verification uses disposable CI PostgreSQL;
shared staging migration, release and signed-in/Realtime acceptance are separate.

### F21 direct-share notice (decision 0034)

`DOCUMENT_SHARED_DIRECT` tells a member that a colleague shared a private note or PDF with them without review. It names the owner and the item, never content, and opens the read-only reader (`/shared/:id`). Core returns the details and target only while the item is still shared with the reader; otherwise the generic unavailable message is shown. Revocation sends no notice. Evidence and remaining checks are in [F03-SHR](identity-and-access.md#f03-shr-share-button-and-direct-sharing).
