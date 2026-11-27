# 0039: Remove reader group management

Status: accepted
Date: 2026-11-28
Decision owner/approval: the project team, in a discussion held outside this repository; the requesting maintainer reported the outcome and approved this scope in the task conversation on 2026-11-28.
Brainstorm originator / record author: project team (originator; individual attribution not recorded here); record drafted by the implementing coding agent.
Approval evidence and exact source/spec revision: maintainer instruction on 2026-11-28 against Arden `staging` `70742986cfd3f42a471fef43c22f4afe2ae4d0bc`: remove reader groups, keep the Organization, Department and Selected Members reader modes, and stop Organization Admins from managing reader groups.
Implementation: partial — API, desktop allowlist and UI removal on `refactor/remove-reader-group-management`; staging rollout not verified.
Supersedes / superseded by: supersedes the audience-group management parts of [0010](0010-audiences-and-system-administration.md) (`GROUP` audiences managed by Org Admins) and F04-AC1/F04-AC4 in the [identity specification](../product/identity-and-access.md#f04-published-audiences).

## Context and requirement

Decision 0010 let Organization Admins create reader (audience) groups and add members to them, and let authors target those groups. Target Readers later replaced audience selection for new submissions: a document is read by the whole organization, one department, or selected members. Groups could no longer be chosen as readers, but the Readers tab, member-detail group chips and `/audience-groups` API remained. The team decided to drop reader groups.

## Options and tradeoffs

| Option | Effect | Cost |
| --- | --- | --- |
| Remove management only (accepted) | No new groups or group membership changes; reader modes unchanged | Legacy tables and frozen legacy reads remain until a later cleanup |
| Also migrate legacy `GROUP` publications to Selected Members and drop tables | Removes all group code | Data migration and access change on live publications; needs its own decision |
| Keep groups | No work | Contradicts the team decision and keeps an unused admin surface |

## Decision

- Readers of a publication are chosen only by Target Readers: `ORGANIZATION`, `DEPARTMENT` or `SELECTED_MEMBERS`. These modes are unchanged.
- Organization Admins can no longer list, create, edit, deactivate or change membership of reader groups. The administration Readers tab, the member-detail group chips and "Manage reader groups", the `/api/v1/organizations/:organizationId/audience-groups*` routes, their desktop allowlist entries and client calls are removed.
- A shared-draft update can no longer attach a `GROUP` audience. A legacy draft may keep the group audiences it already carries, so saving it still works; knowledge options still return those groups only so legacy drafts and submissions can show their names.
- No data is deleted and no reader loses access. Publications that predate Target Readers keep their frozen audience check, including existing `GROUP` memberships, which are now fixed.
- **Accepted consequence:** a legacy `GROUP` read checks only an active organization membership and an active group membership, not the member's department. With group management removed, leaving the organization is the only way such access ends. On 2026-11-28 the requesting maintainer chose to leave legacy group publications as they are, because this is a course project and the final environment will start from fresh data with no legacy group audiences. A revoke-only path or a migration is not planned; revisit this if legacy group data must be kept in a long-lived environment.
- Migrating legacy `GROUP` publications and dropping `audience_group*` tables is out of scope and needs a separate decision.

## Boundaries and consequences

- API: the routes return 404 like any unknown route. No migration is added; RLS and triggers on `audience_group*` stay for the legacy rows.
- UI: Administration shows Members, Departments, Invitations, Review permissions, Documents and Sharing. Member detail still shows the managed "Everyone in" readerships.
- The repository's legacy reader query and department-change role projection are unchanged.

## Verification and rollout

Planned: API tests that the group routes are gone and that department administration still works; desktop policy tests that group paths are rejected; UI tests for the administration tabs and member detail. Staging needs only the normal application deploy.

## Rules and documentation updates

[0010](0010-audiences-and-system-administration.md), the F04 [specification](../product/identity-and-access.md#f04-published-audiences), [PRODUCT.md](../../PRODUCT.md), [DESIGN.md](../../DESIGN.md), [security and data](../engineering/security-and-data.md) and [implementation status](../engineering/implementation-status.md) reference this record.
