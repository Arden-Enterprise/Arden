# Custom role implementation progress

Accepted policy: [decision 0009](../decisions/0009-custom-role-scope-and-owner-defaults.md).

## Completed foundation

- Exact-scope, VIEW catalog, protected-name and owner-default domain rules with unit tests.
- Knowledge policy now requires VIEW and exact scope on the matching audience grant.
- API repository SQL prepares owner-private defaults while retaining active identity checks.
- Migration 0011 committed on the user-authorized shared dev target, with backup.
- Migration 0012 committed on the same target; one active Organization marker has one VIEW grant
  and zero assignments. The updated runtime-role rehearsal passed and rolled back its fixtures.
- Runtime-role rollback rehearsal passed for owner isolation, scope and VIEW removal.
- Existing role permissions, assignments and actual content were not rewritten.
- Server-managed custom-role catalog, CRUD lifecycle, exact-scope assignment/revocation,
  optimistic version checks and transaction-linked audit are implemented locally.
- The organization administration UI uses server role records, exposes only VIEW, separates
  configuration Save from assignment actions, and guards unsaved changes.
- Web/desktop response validation and the desktop request allowlist reject unknown permissions,
  inconsistent scopes and unbounded role routes.
- `ALL_MEMBERS` is implemented as a reserved, server-managed Organization audience. It has VIEW
  but no assignments, is absent from custom-role administration, and appears in authoring only
  for Organization scope. Active membership grants it; Department scope rejects it.

## Remaining

- Deploy and exercise the matching API changes on the aligned shared `dev-3`/`arden-hk` target.
  The target database records migration 0011, but DB migration alone does not replace old API
  permission checks until this branch is synchronized to the hosted API.
- Remove the compatibility create/assign endpoints only after existing consumers are checked.
- Run live-auth administration UI/API verification against the aligned hosted target.
- Match Flow 2 authoring/Share to the ALL_MEMBERS contract and complete immutable submission from
  private, stable document identity and per-document publication numbers.
- Run API/UI/manual permission matrix; current rehearsal is deliberately narrower.

## Manual verification tool

Use `tools/roles/policy-rehearsal.sql` through the existing migration owner with
`psql -X -v ON_ERROR_STOP=1 -P pager=off`. It creates only synthetic fixtures in one
transaction and ends with ROLLBACK. Do not turn it into a reset script, run it against
production, or disable the automatic integration suite's disposable-database fence.
An assertion failure requires explicit ROLLBACK before further commands.
Short statements can be entered individually in Coolify Terminal; long shell input may
be truncated and must not be assumed executed. Verify COMMIT/ROLLBACK and migration records.

## Current boundaries

The shared hosted target is now aligned: `dev-3` resolves to the `arden-hk` database that records
migrations 0011/0012, and its container health passes. The former personal `dev-4` resource was
retired separately from this feature change. The custom-role API/UI source in this branch still
requires remote synchronization and live-auth verification; infrastructure health is not feature
acceptance. Do not copy credentials, backup contents or server connection details into this
repository.
