# Mainflow 1 — frontend preview

Status: implemented session-memory UI, 4 October 2026. This is a reviewable frontend journey, not production authentication or authorization. The accepted visual reference is [Figma: Living Archive](https://www.figma.com/design/UmW5qb5cTWo6lwMYZ4Z9bC/Arden?node-id=147-2).

## Screens and transitions

1. Sign-in offers explicitly labeled member/admin/setup previews. Member preview selects a workspace; sign-in itself reports that authentication is unavailable.
2. Setup reviews organization name, a starting template, departments, members and fixed roles before explicit completion. Administration also supports organization-name review, department forms and membership management.
3. Invitations creates a synthetic invitation without adding a member or sending email. Pending invitations can be renewed or revoked. Duplicate pending invitations and existing member addresses are rejected after normalization.
4. Preview invitation starts without a demo identity. The invited account can accept once; the wrong account, expired, revoked and already-used invitations cannot create another membership. Clearly labeled scenario controls demonstrate terminal views without changing data.
5. Acceptance creates a pending membership with no department or role. The access screen explains the missing assignment and returns to Administration.
6. Members → Awaiting assignment opens a form for primary department, one of three fixed roles and organization/department responsibility. Review shows the current/proposed assignment and effective boundaries before confirmation. A suspended membership stays suspended when its assignment changes; restoration is separate. The last eligible System Admin cannot be suspended or demoted.
7. Preview access renders checking, pending, denied, expired-session or ready states. Only ready synthetic memberships can enter the workspace. Switching demo members clears private notes, with discard confirmation for unsaved private drafts.

All preview state is in React memory. Refresh or confirmed exit clears it. Private-note drafts survive selection/navigation within one identity; they are never added to shared knowledge or sample answers. Knowledge review and handover are separate sample workflows, and Ask Arden uses a prerecorded answer with inspectable sample citations.

## Preview conventions, not settled production policy

- Templates start with four departments; validation permits one or more departments and requires an eligible active System Admin. Empty departments and pending unassigned members are valid.
- Invitations expire after seven days in the demonstration. Renewing extends that synthetic expiry and increments its resend count; it sends no message and implements no real token rotation.
- The three fixed roles and explicit responsibility scope model the supplied flow. They do not settle the blueprint's unresolved reviewer/publisher policy.
- Role responsibility is distinct from document audience. Company-wide, department and owner-private boundaries remain visible; admins/reviewers do not gain another person's private content.
- Browser readiness checks are demonstrations, never security gates for real content.

## Production handoff

Implement authenticated sessions, provisioned accounts, server membership checks, scoped administration APIs, durable organization/departments/memberships, invitation token lifecycle and email delivery. Acceptance must be transactional/idempotent; the server must verify recipient, expiry and revocation. Assignment/restoration must preserve the last-admin invariant and write an audit event. Recheck authorization before retrieval, mutations, citations and AI output. Implement persistence/version-conflict behavior and define supported invitation expiry, role and recovery policy before release.

## Verification scope

On 4 October 2026, recursive typecheck, test and build checks ran with Node 24 and pinned pnpm 11.19.0. All 50 UI model tests and four API health cases passed. Pure models cover normalization, duplicates, expiry boundary, wrong-account/terminal acceptance, assignment readiness, suspension, malformed scope, last-admin protection, private draft retention and immutable knowledge review/publication.

Browser checks exercised sign-in boundaries, workspace selection, setup/review, duplicate department/member validation, metadata review, invitation renew/revoke/wrong-account acceptance, pending/ready/suspended/expired-session access, identity-private-note reset, draft navigation/save/exit, review/revision/publication, handover ownership/receipt, sample questions and citations. Layout checks used 1440, 1360, 1024, 720, 390 and 320 CSS-pixel widths, expanded context and long editor titles. The member table has its own keyboard-accessible horizontal scroll region on small screens.

The built desktop renderer was served locally and checked for navigation, draft retention, local fonts/SVGs and CSP errors. SVG export as separate assets resolved the blocked inlined-image issue; the renderer then reported no console errors. Native Electron launch/loadFile/IPC behavior was not verified because its executable is absent from the local installation. Successful builds and browser checks do not prove real server authorization, email delivery, native installers or durable storage.
