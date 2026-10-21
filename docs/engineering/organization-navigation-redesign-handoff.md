# Organization navigation redesign handoff

Status: **Accepted direction, implementation pending**  
Accepted by: Hung  
Accepted on: 2026-10-21  
Implementation owner: Khôi  
Working branch at handoff: `feat/ard-16-mainflow-2-governance` (`8de86b4`)  
Fresh main reviewed for this handoff: `0775a88`

This document records the UI information architecture and wording agreed for Arden's
multi-organization workspace. It is the implementation handoff for the navigation redesign;
it does not claim that the described routes or screens are already shipped.

## 1. Goal

One account may actively participate in several organizations and may administer several of
them. The interface must always make the current organization and current permission boundary
obvious.

The redesign must separate three levels:

1. the signed-in Arden account;
2. the selected organization;
3. work and governance functions inside that organization.

The current single sidebar mixes organization switching, workspace navigation, personal work,
administration and account actions. `Administration` also hides several distinct functions behind
tabs. This makes scope and capability difficult to understand.

The target direction borrows Discord's persistent organization rail, but does not copy its channel
model. Arden remains an enterprise governance workspace with concise, task-oriented destinations.

## 2. Accepted shell structure

Wide layouts use four regions:

```text
┌──────────┬─────────────────────────┬──────────────────────┬──────────────┐
│ Org Rail │ Organization Navigation │ Main Content         │ Context Pane │
│ 64px     │ 248px                   │ Flexible             │ 320px        │
└──────────┴─────────────────────────┴──────────────────────┴──────────────┘
```

- **Organization Rail** changes the organization scope.
- **Organization Navigation** shows the selected organization, its contextual action menu and the
  member's regular work destinations.
- **Main Content** owns the current page and its primary actions.
- **Context Pane** remains optional and collapsed by default. It must not create an empty rail.

The existing Arden charcoal/ivory palette, Sora headings, DM Sans body text, muted blue selection,
amber action, sage success and muted red risk remain authoritative. This work changes hierarchy,
layout and wording; it is not a brand replacement.

## 3. Organization rail

The rail is persistent on desktop and lists organizations available to the current account.

```text
[A]  Arden Home
────
[NS] Northstar Studio
[AC] Arden Consulting
[RS] Research Sandbox
────
[+]  Create organization

[S]  System Console        only for an Arden System Admin
[HN] Account
```

### Behavior

- Use the organization logo when available, otherwise a stable two-letter monogram.
- Show the full organization name in an accessible tooltip and accessible name.
- Mark the active organization with Arden's muted-blue selection treatment and a non-color cue.
- Keep `Create organization` visually separate from organization identities.
- Keep Account at the bottom of the global rail.
- Show System Console only to an active Arden System Admin.
- Do not show System Console inside an organization's action menu or management surface.
- Do not let Arden System Admin capability grant organization or content access.

`Arden Home` is the account-level surface for organization membership, pending invitations,
organization creation and account settings. V1 must not aggregate private content, publications or
tasks from several organizations into one cross-organization feed.

## 4. Navigation inside one organization

After selecting an organization, show its identity and contextual action trigger above a flat
grouped tree. Group headings are labels, not pages. The regular tree should not exceed two
navigation levels and must not contain organization-management destinations.

```text
Northstar Studio                                      [⌄]
Organization Admin · Engineering

WORK
├── My Work
└── Private Notes

KNOWLEDGE
├── Library
├── Contributions
└── Reviews
```

Sections may collapse when useful, but the default desktop state should keep `WORK` and
`KNOWLEDGE` expanded.

The caret beside the selected organization opens an organization action menu, following the
interaction model of Discord's server menu without copying Discord's visual styling. For an
Organization Admin, the menu exposes:

```text
Organization actions
├── Invite members
└── Manage organization
```

`Manage organization` opens a separate organization-management surface with its own local
navigation:

```text
ORGANIZATION MANAGEMENT
├── Members
├── Departments
├── Invitations
├── Audiences
├── Reviewer Access
└── Settings

← Back to workspace
```

This management navigation exists only inside the management surface; it must never be added back
to the regular organization tree. `Invite members` is a permitted shortcut to Invitations, not a
second invitation workflow. If the actor has no available organization actions, render the
organization name as a static header and do not show an empty caret or empty menu.

When the management surface opens, replace the regular `WORK`/`KNOWLEDGE` tree in the second rail
with the local management navigation and render the selected management page in Main Content.
`Back to workspace` restores the last regular organization destination rather than always resetting
to My Work. The organization rail remains visible, so the selected organization is still explicit.

Open the action menu by click, Enter or Space, not by hover. Escape and outside click close it;
keyboard focus returns to the organization trigger. `Invite members` enters the same management
surface with Invitations selected.

### Wording convention

Regular navigation group names describe scope and use nouns: `WORK` and `KNOWLEDGE`. Management
destinations belong to the separate `ORGANIZATION MANAGEMENT` surface rather than the regular
tree. Child labels stay short and do not repeat their surrounding context. Page headings may add
that context when needed. User-facing wording and backend/domain wording map as follows:

| Navigation label | Page heading | Domain/API term |
| --- | --- | --- |
| Library | Knowledge Library | published knowledge |
| Contributions | My Contributions | contribution, shared draft, submission and publication version |
| Reviews | Reviews | review assignment and Reviewer Grant |
| Audiences | Audiences | audience and audience group |
| Reviewer Access | Reviewer Access | Reviewer Grant / `reviewer_grant` |
| Settings | Organization Settings | organization configuration |

Use these exact labels throughout navigation, the organization action menu, management navigation,
breadcrumbs, page titles, empty states and documentation. Keep technical names such as
`reviewer_grant` in code, API contracts and database documentation; do not expose them as primary
navigation wording.

## 5. Screen contracts and wording

### My Work

`My Work` remains the default destination after selecting an organization. It summarizes only work
inside that organization:

- contributions requiring the user's action;
- reviews assigned to the user;
- recent authorized publications;
- a shortcut to the user's private notes.

It must not contain handover metrics, handover risk, fabricated analytics or a cross-organization
feed.

### Private Notes

Rename `Personal Workspace` to **Private Notes**.

- Notes remain owner-only.
- Organization Admin, reviewers, audiences and Arden System Admin do not receive access.
- This is the private source from which a user may explicitly create a contribution copy.
- Private Notes remains organization-scoped in the current product contract.

The primary sharing action should use wording such as `Share as contribution`, not imply that the
private original becomes shared.

### My Contributions

Add **My Contributions** as the author's view of governed shared copies. It is distinct from both
Private Notes and the published Knowledge Library.

```text
Private Note
    ↓ Share as contribution
Contribution v1
    ↓ Submit for review
In review
    ↓ Final approval
Published
```

Recommended filters are `Draft`, `In review`, `Revision requested`, `Published` and `Rejected`.
Editing a published contribution does not mutate that publication. The author returns to their
private source, creates a new immutable contribution version and submits it again.

### Knowledge Library

Rename `Knowledge` to **Knowledge Library**.

It shows only published knowledge the current actor is authorized to read. Do not mix it with:

- owner-private notes;
- unpublished shared drafts;
- submissions outside the actor's audience;
- review assignments.

### Reviews

Rename `Review Queue` to **Reviews**.

- Display it only when the actor has applicable reviewer authority or assigned review work.
- Reviewer authority comes from Reviewer Grants, not audience membership or Organization Admin.
- Keep the assigned count beside the navigation item when live server data is available.
- Recommended views are `Assigned to me`, `Waiting`, `Revision requested` and `Completed`.

### Members

Show organization memberships, status, department placement and the protected Organization Admin
capability. Membership management must not imply access to private notes or every publication.

### Departments

Show department identity, status and active memberships. Department audiences remain managed
audiences, not configurable authorization roles.

### Invitations

Show pending, accepted, expired and revoked invitation states with the existing resend/revoke
operations where authorized.

### Audiences

Use the canonical user-facing term **Audiences**. Audience answers who may read an authorized
publication; it grants no administration, review, editing or publication capability.

Distinguish:

- everyone in the organization;
- everyone in a department;
- explicit audience groups.

Do not restore Custom Role or permission-switch UI.

### Reviewer Access

Keep Reviewer Access separate from Members and Audiences. It manages Reviewer Grants and shows the
reviewer, department scope, classification authority, tags, validity and status supported by the
server contract.

### Organization Settings

Reserve this destination for organization identity and lifecycle settings that actually exist.
Do not invent archive, delete, policy or integration controls before their product and API contracts
are accepted.

## 6. Capability-based navigation

| Actor context | Visible organization navigation |
| --- | --- |
| Active Member | Work and Knowledge destinations |
| Member with Reviewer Grant | Work, Knowledge and Reviews |
| Organization Admin | Work and Knowledge tree, plus organization action menu and management surface |
| Arden System Admin only | System Console outside the organization tree |

Organization Admin does not bypass audiences, reviewer grants or owner-private access. Arden System
Admin does not enter an organization merely because of installation-level capability.

The backend currently makes an organization creator its first Organization Admin. Do not introduce
the label `Organization Owner` unless a separate product decision defines ownership transfer,
last-owner protection, leaving, archive and deletion behavior.

## 7. Navigation state and scope switching

Switching organizations must:

- update the organization ID used by every request;
- reload organization membership, capability and reviewer information;
- reset organization-specific selection, review counts and Context Pane content;
- close the Context Pane and mobile navigation;
- guard unsaved private-note or administration edits before leaving;
- never retain content from the previous organization in visible loading, empty or error states;
- restore focus to a predictable destination after the switch.

The selected organization may be remembered as a non-sensitive preference, but authorization must
always be re-established from the current server session.

Breadcrumbs must start with the active organization, for example:

```text
Northstar Studio / Knowledge Library
Northstar Studio / Manage organization / Audiences
```

## 8. Target route model

The long-term deep-link model is:

```text
/organizations
/org/:organizationId/work
/org/:organizationId/private-notes
/org/:organizationId/contributions
/org/:organizationId/knowledge
/org/:organizationId/reviews

/org/:organizationId/manage/members
/org/:organizationId/manage/departments
/org/:organizationId/manage/invitations
/org/:organizationId/manage/audiences
/org/:organizationId/manage/reviewer-grants
/org/:organizationId/manage/settings

/system/...
/account/...
```

React Router is still documented as planned rather than installed. This route model does not by
itself authorize adding a routing dependency. The first implementation may preserve the existing
typed view state while making view names and page boundaries route-ready.

## 9. Responsive behavior

- At wide widths, keep the Organization Rail and Organization Navigation visible.
- At intermediate widths, retain the organization rail and allow the organization tree to collapse
  to an accessible icon rail or drawer without losing labels for keyboard and screen-reader users.
- Below 640px, replace both left rails with one navigation sheet. The sheet first identifies the
  selected organization, then lists its destinations, and provides a separate organization switcher.
- On mobile, expose the organization action menu from the selected-organization header in the same
  sheet. When management is open, show its local navigation before the management page content and
  keep `Back to workspace` directly reachable.
- Opening a rail or Context Pane must not produce horizontal overflow in the main content.
- Escape closes overlays and focus returns to the control that opened them.
- Do not depend on hover to expose the only organization name or required action.

## 10. Remove Handovers completely

The standalone Handovers flow has been explicitly removed from the product direction. Do not keep
it as `Planned`, disabled navigation or renamed functionality.

Implementation cleanup includes:

- remove `Knowledge Handover` from navigation and `WorkspaceView`;
- remove the `knowledge-handover` view and `KnowledgeHandover` component;
- remove handover counts, queue items, filters, risk cards and callbacks from My Work;
- remove handover Context Pane content;
- remove handover sample data, preview-model types/functions and dedicated tests;
- remove handover-only CSS and icon mappings when no other semantic use remains;
- remove `Handover` from document-type sample filters;
- remove `Handover` from review step labels;
- update product, blueprint, design and preview documentation that still claims the flow exists.

If document responsibility reassignment is needed later, treat it as a bounded metadata/governance
operation backed by a separate accepted contract. Do not recreate a standalone handover workflow by
default.

## 11. Implementation phases

### Phase 1: navigation contract and cleanup

- Update typed view names and navigation configuration.
- Remove Handovers from source, samples, tests and documentation.
- Apply the accepted labels: Private Notes, Knowledge Library and Reviews.
- Preserve existing authorization and unsaved-change guards.

### Phase 2: organization rail and shell

- Add the persistent organization rail.
- Move organization switching out of the existing access card.
- Add account-level Arden Home and Account entry points.
- Keep System Console isolated and capability-gated.
- Implement desktop, intermediate and mobile navigation states.

### Phase 3: split organization destinations

- Add My Contributions.
- Add the contextual organization action menu to the selected-organization header.
- Move Members, Departments, Invitations, Audiences, Reviewer Access and Settings into a separate
  organization-management surface launched from `Manage organization`.
- Add a persistent `Back to workspace` action within the management surface.
- Add Organization Settings only for implemented settings.
- Update page titles and breadcrumbs to show organization scope.

### Phase 4: verification and documentation integration

- Verify member, reviewer, Organization Admin and System Admin navigation separately.
- Verify organization switching with unsaved work and stale-request cancellation.
- Verify 1440px, 1024px, 640px, 390px and 320px layouts plus 200% zoom.
- Verify keyboard order, focus restoration, accessible names and current-page state.
- Verify web and Electron render the same navigation behavior.
- Update `DESIGN.md`, `PRODUCT.md`, `ARDEN_BLUEPRINT.md` and affected engineering guides to make
  this document's accepted direction authoritative throughout the repository.

## 12. Likely implementation touchpoints

Start by reviewing these existing files rather than creating a second shell:

- `packages/ui/src/app/AppSidebar.tsx`
- `packages/ui/src/app/ArdenShell.tsx`
- `packages/ui/src/shared/types.ts`
- `packages/ui/src/shared/WorkspaceNavigationContext.tsx`
- `packages/ui/src/shared/WorkspaceTopbar.tsx`
- `packages/ui/src/sign-in/WorkspaceSelectPage.tsx`
- `packages/ui/src/my-work/`
- `packages/ui/src/knowledge/`
- `packages/ui/src/organization/OrganizationAdminPage.tsx`
- `packages/ui/src/styles/app-shell.css`
- `packages/ui/src/styles/shell-redesign.css`
- `packages/ui/src/styles/responsive.css`
- `packages/ui/tests/workspaceNavigation.test.ts`
- `packages/ui/tests/workQueueModel.test.ts`
- `packages/ui/tests/knowledgePreviewModel.test.ts`

Keep server authorization authoritative. Hiding a navigation item is usability behavior, not an
authorization boundary.

## 13. Acceptance checklist

- [ ] The active organization is visible on every organization-scoped screen.
- [ ] A user can switch among active organization memberships without signing out.
- [ ] No content or transient state leaks from the previous organization during switching.
- [ ] My Work, Private Notes, Knowledge Library, My Contributions and Reviews have distinct purposes.
- [ ] Organization management does not appear in the regular Work/Knowledge tree.
- [ ] The organization action menu and management surface appear only for Organization Admin
      capability.
- [ ] The management surface has a clear `Back to workspace` action and preserves organization
      scope.
- [ ] Reviews follows Reviewer Grant capability, not Organization Admin or audience membership.
- [ ] System Console is outside the organization tree and grants no content access.
- [ ] Custom Role wording and permission switches do not return.
- [ ] Handovers has no navigation, route/view, sample card, metric, filter, context, test or stale docs.
- [ ] Planned or unavailable features do not occupy primary navigation as disabled controls.
- [ ] Unsaved changes are guarded before organization or destination changes.
- [ ] Navigation works with keyboard, screen reader, reduced motion, narrow widths and 200% zoom.
- [ ] Web and desktop use the same shared implementation.

## 14. Coordination note

At the time of this handoff, the working tree also contains unrelated uncommitted shared-slot lock
fixes in `deploy/hosted/sync.py` and `deploy/hosted/tests/test_workflow.py`. Preserve them and do not
stage, discard or rewrite them as part of the UI redesign.
