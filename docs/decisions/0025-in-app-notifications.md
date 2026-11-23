# 0025: Durable in-app notifications with Realtime hints

Status: accepted for implementation
Date: 2026-11-19
Decision owner/approval: current user explicitly requested implementation of this plan; organizational decision-owner role is unknown
Brainstorm originator / record author: current user supplied the plan (identity unavailable); Codex coding agent recorded it
Approval evidence and exact source/spec revision: initial user request on 2026-11-19; share-type and future-integration refinements confirmed by the current user on 2026-11-22; [F21 revision 4](../product/in-app-notifications.md)
Implementation: partial in `feat/document-share-notifications`, based on `origin/staging` `611092903c22e8dc85d8c02361254441ca5286e5`; exact verification and rollout are recorded in F21
Supersedes / superseded by: none; does not supersede the inspection-alert deferral in 0024

## Context and requirement

Members need durable in-product delivery and read state for review/publication and membership-governance events. Arden already accepts Supabase Realtime as a supporting service while keeping domain authorization in Core ([decision 0001](0001-supabase-and-hybrid-development.md)). A transient transport alone cannot guarantee delivery after disconnects, app shutdown or policy changes.

## Options and tradeoffs

- Store notifications in PostgreSQL with an outbox, then use Realtime Broadcast as an ID-only hint. This preserves history/read state and permits retry; it adds tables, a worker, JWT/policy setup and operational monitoring.
- Use direct Postgres Changes. This couples client subscriptions to table replication and exposes more row/schema concerns than the notification signal needs.
- Use a third-party notification database/service. This adds a second source of truth, provider and data boundary not present in the accepted architecture.

The first option is accepted. Realtime REST Broadcast avoids a server receive connection. The Core BFF continues to own session verification, organization membership and object authorization.

## Decision

- PostgreSQL notification rows and an outbox are canonical. Source events and notification/outbox rows are written in one transaction; retries are idempotent.
- The dispatcher uses a dedicated non-bypass database login which can `SET ROLE arden_notification_worker`; the NOLOGIN capability role has schema access only to the notification tables and column-limited outbox updates. The regular `arden_runtime` pool handles actor-authorized inbox and read-state API operations.
- V1 covers review requests/outcomes, publication activation/failure, document sharing, primary-department changes, and reviewer-grant creation/revocation. Request fan-out follows current review authorization, including immutable Department/Organization scope separation and frozen legacy rules.
- 22 November 2026 user-confirmed scope refinement: publication and sharing are separate. Approval of `READER_CHANGE` for an existing current publication creates one of two events: `SELECTED_MEMBERS` produces `DOCUMENT_SHARED_PERSONAL`; `DEPARTMENT` or `ORGANIZATION` produces `DOCUMENT_SHARED_GROUP`. Notify every active member in the approved selection who also passes the publication's frozen audience, excluding the requester. The message contains the sharer's display name and the published document title, without body or excerpts. Core returns those details and a target only while the recipient can still read the current publication. Publication activation remains `PUBLICATION_ACTIVE` and never creates a share event. See [F21 revision 4](../product/in-app-notifications.md).
- The user asked to prepare this notification path for another contributor to implement the Share button later. No Share button or separate Share API is added here. The database hook follows the approved reader-selection update; the future Share action should submit a reviewer-approved reader-selection request to integrate with it. The current selection-change workflow can use the same notification hook.
- Core exposes authenticated page/read/read-all and Realtime-credential endpoints. It rechecks active membership and authorization when rendering a target. A share notification's permitted name/title details and target are suppressed when current publication access is lost; no document body is included.
- Supabase Realtime Broadcast carries only `{ notificationId }` over a private per-membership topic. The Core-issued reader token is short-lived (120 seconds), has one exact namespace/org/membership topic and no Arden data grants or Broadcast write permission. A separate server sender can Broadcast but cannot read.
- Web uses the shared React inbox and Realtime client. Electron main owns the socket and relays validated IDs through narrow IPC; renderer credential storage is prohibited. Focus/reconnect/inbox opening recover state from Core.
- A namespace is unique per deployment/slot. Realtime and the browser WSS proxy/CSP must be configured and verified before enabling. If the target Realtime service cannot validate the narrowly scoped Core token as configured, keep Realtime disabled; inbox API behavior remains available.
- V1 excludes inspection notifications explicitly deferred by 0024, email, OS push, AI/My Work/connectors, and role/suspend/restore events until their lifecycle flows are implemented.

## Boundaries and consequences

PostgreSQL/Core own content and read state. The outbox worker sends an opaque UUID to the Realtime service; clients fetch display data only through the authenticated Core API. A membership can be deactivated after credential issuance; active Realtime authorization may remain cached until the short token expires, but the ID-only signal reveals no document content and Core denies subsequent fetches. Current permissions are rechecked on every inbox fetch and target open.

Notification rows cascade with their organization/member records under migration 0039. Backup retention and restore behavior must preserve the notification/outbox pair and must not reactivate membership or access erased by newer policy state. Migrations 0039 and 0043 are operator-class; 0043 adds one narrowly scoped SECURITY DEFINER approved-share trigger executor and restricts the Realtime worker to routing columns, keeping share name/title details Core-only. The exact owner repair inventory is updated without changing unrelated routine ownership.

Self-hosted Realtime needs exact JWT verifier, private-channel policy, role grants, TLS/WSS proxy and environment namespace configuration. Managed/hosted Realtime token acceptance is not assumed; verify the exact target's signing-key support and role mapping before rollout. Do not change the shared Supabase JWT key set just to make this feature work.

## Verification and rollout

Focused API, UI and desktop tests cover contracts, token scope, safe payloads and IPC bounds. Full acceptance requires a disposable real PostgreSQL migration/RLS/outbox rehearsal; sender/reader authorization and expired/wrong-topic token checks on the exact Realtime deployment; web and Windows keyboard/responsive/reconnect/revocation tests; then a configured staging end-to-end path. No publication, migration application to a shared database, merge or deployment is authorized by this record.

On delivery failure, the PostgreSQL inbox remains available. The worker retries with bounded backoff and moves exhausted records to `FAILED`; an operator inspects safe error codes and may use the documented recovery procedure after confirming the notification row still exists. Realtime downtime does not remove notifications.

## Rules and documentation updates

- [F21 in-app notification specification](../product/in-app-notifications.md)
- [Technology guide](../engineering/technology-guide.md)
- [Security and data rules](../engineering/security-and-data.md)
- [Operations and release guide](../engineering/operations.md)
- [Realtime role/policy setup](../../deploy/supabase/realtime-notifications.sql)

## References

- [Supabase Realtime Broadcast](https://supabase.com/docs/guides/realtime/broadcast)
- [Supabase Realtime Authorization](https://supabase.com/docs/guides/realtime/authorization)
- [Supabase self-hosted Realtime configuration](https://supabase.com/docs/guides/self-hosting/realtime/config)
- [Supabase JWT signing keys](https://supabase.com/docs/guides/auth/signing-keys)
- [Current Core review policy](../../apps/api/src/knowledge/policy.ts)
- Decisions [0011](0011-permission-aware-publication-and-semantic-documents.md), [0015](0015-organization-wide-reviewer-grants.md), and [0024](0024-admin-only-direct-withdrawal.md)
