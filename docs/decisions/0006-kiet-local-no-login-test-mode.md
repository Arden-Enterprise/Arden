# 0006: Kiet Local no-login Mainflow 1 test mode

Status: accepted  
Date: 2026-10-06  
Decision owner/approval: task owner requested skipping login to test organization, department, and invitation core flows on their dedicated Kiet Local slot  
Implementation: partial; exact dev-slot detection, fixed test actor, optional SMTP delivery when all six runtime settings are configured, remote sync/tunnel CLI, and synthetic API tests are implemented; migrations 0003/0004 and organization-bootstrap rollback rehearsal were verified on Kiet Local; SMTP credentials/delivery and manual browser workflow remain unverified
Supersedes / superseded by: none

## Context and requirement

Supabase is not deployed to Kiet Local yet. The user needs to exercise Mainflow 1 organization setup, department management, and invitation creation from the local frontend against the hosted development API/database. Requiring a real account would prevent this limited development check.

## Decision

- Keep `ARDEN_LOCAL_FLOW1_TEST_MODE` restricted to loopback API and disposable loopback `arden_test_*` PostgreSQL.
- Add a separate no-login test actor only for Kiet Local slot `dev-2`. The API selects it automatically after checking `NODE_ENV=development`, PostgreSQL host `postgres`, database name `arden_dev_2`, and no Supabase configuration. No project-wide test-mode variable is used. The exact target is built into the guard to avoid project configuration and reduce manual setup.
- The server uses one fixed synthetic verified identity. This mode exercises the real API/database workflows as one Org Admin; it does not test identity, sign-up, invitation acceptance, or cross-user authorization. The default invitation mailer is a sink. If all six SMTP settings are present, only a no-login request on the exact fenced dev-2 database sends real invitation email; incomplete settings fail closed. The link in that email targets the developer's loopback frontend, so this proves delivery only and cannot support acceptance from a teammate's device.
- The Kiet Local API port must remain bound to loopback and reachable only through the assigned SSH tunnel. Writes persist in that dedicated development database. No automatic database migration or reset is performed.
- The remote CLI uploads only the backend allowlist, uses the operator-provided slot startup helper, opens the private tunnel, verifies this test mode, and starts the local frontend. It never deploys this mode to staging or production.

## Boundaries and consequences

Anyone with the assigned SSH access to this development slot can exercise the fixed synthetic actor as an Org Admin. This is not an authentication substitute and must not be exposed through a public API/domain. The database host/name in the guard were checked against the running Kiet Local container on 2026-10-06; if the slot configuration changes, update the guard and documentation together. Supabase testing later uses the normal Supabase session path rather than this test actor.

## Verification and rollout

Synthetic request tests verify the no-cookie `/api/v1/me` response, organization creation, and invitation delivery through an injected mailer. Fence tests reject non-development runtime, wrong database host/name, and Supabase configuration. The remote status command and source sync were run against `dev-2`. Migrations 0003/0004 and a rollback-only organization-bootstrap rehearsal were applied/verified against the exact `arden_dev_2` database; no organization was committed. SMTP variables are currently absent from the running API container, so no email is sent until the team configures a sender. Coolify may share variables across the project; coordinate use of a team-controlled sender and send only to intended test recipients.

## Rules and documentation updates

- [AGENTS.md](../../AGENTS.md)
- [Operations guide](../engineering/operations.md)
- [Security and data rules](../engineering/security-and-data.md)
- [Technology guide](../engineering/technology-guide.md)
- [Kiet Local setup packet](../../kiet-local/SETUP.md)

## References

- [Remote development CLI](../../scripts/remote-development.mjs)
- [Remote test-mode startup fence](../../apps/api/src/auth/remote-flow1-test.ts)
- [Kiet Local server slot configuration](../../kiet-local/remote.json)
