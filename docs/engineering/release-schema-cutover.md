# One-time publication schema cutover

This procedure is separate from automatic application deployment. The release
receiver must continue rejecting an unapproved migration fingerprint. Read the
[release guide](release-pipeline.md), [operations policy](operations.md) and
[server operations rule](rules/server-operations.md) first.

## Scope and approval

The publication feature introduces migrations 0018–0021. Migration 0018 deletes
the existing content corpus: private and shared drafts/versions, submissions,
reviews, publications, chunks, questions/answers/citations, knowledge bases and
the associated content audit events. Identity, organizations, memberships,
departments, audiences and reviewer grants remain. File objects are not deleted.
An earlier development-data decision does not authorize resetting another live
environment. Obtain explicit approval for each named environment and this effect.

Inspect the actual ledger and affected content again immediately before work.
Stop if the inventory, source, affected data, resource mappings or maintenance
scope differs from the approved plan. Never infer disposable data from a name.

## Recovery evidence

The disposable GitHub PostgreSQL job runs
[`schema-recovery.py`](../../tools/verification/schema-recovery.py). It creates
an isolated random test database, applies 0001–0017, inserts synthetic retained
identity/content and an outside-service probe, then exercises:

- Failure of the entire 0018–0021 transaction, preserving the old table values.
- Successful upgrade/reset while retaining identity data.
- Restoration of the old Arden schema and migration ledger, comparing every
  selected table's values and verifying the outside-service probe is unchanged.

This verifies the database method. It does not prove a live backup, Coolify
maintenance, or restoration of real data. Those need their own operator record.

The rehearsal now also checks a separate 0021 → 0022 forward upgrade with retained
synthetic organization/content, induced failure rollback and the new default review
rule, before restoring the original 0017 snapshot. Its full source-inventory fence
is explicitly bounded to 0022. The historical operator bundle remains exactly
0018–0021; later migrations must not be silently included in that destructive bundle.

Use separate custom-format `pg_dump` archives for the entire `arden` schema and
`public.arden_schema_migrations`. **Do not combine `--schema` and `--table` in one
command:** PostgreSQL's table selection overrides schema selection and omits
non-table objects. Inspect both archives with `pg_restore --list`. Restore their
rendered SQL inside one transaction after removing only the selected Arden
schema and ledger. Preserve object owners/ACLs and existing required extensions
and roles; check for dependencies outside this boundary before any live restore.
See [pg_dump](https://www.postgresql.org/docs/17/app-pgdump.html) and
[pg_restore](https://www.postgresql.org/docs/17/app-pgrestore.html).

## Ordered maintenance

Prepare executable grouped SQL from the reviewed checkout's immutable Git HEAD
(no credentials or database connection are needed):

```sh
python deploy/release/publication_upgrade.py --output .private/publication-upgrade.sql
```

The tool refuses changed migration files, an unexpected inventory, or an existing
output. It writes UTF-8 directly, avoiding shell-dependent redirection encodings,
and reports the source commit and SQL checksum. Review that file, preserve its
checksum with the backup, and transfer it through the approved private operator
path. After approval and steps 1–4 below, run it using the selected database's
trusted administrator connection. For example, on the server, replace uppercase
placeholders with values from the private profile:

```sh
docker exec -i DATABASE_CONTAINER psql --no-psqlrc --username=ADMIN_ROLE \
  --dbname=APP_DATABASE --set=ON_ERROR_STOP=1 < publication-upgrade.sql
```

The file contains `BEGIN`, the migration advisory lock, an exact 0001–0017 ledger
guard, all four pending migrations and ledger inserts, then one `COMMIT`. The
disposable recovery job executes this path, including induced failure before
commit. **Do not substitute `pnpm db:migrate`:** the normal runner deliberately
commits each migration separately and cannot provide the cutover's grouped
rollback boundary. The tool prepares SQL only; CI cannot invoke administrative
migrations through the receiver. It does not replace target/data inspection,
backup or named reset authorization.

1. Finish source/reviewer checks and image scanning. Retain the exact validated
   new image pair and source identity on the server before stopping the app.
   An upload receipt is not deployment or migration approval.
2. Acquire the existing shared release lock. Verify no unresolved rollout or
   Coolify activity, the selected old app pair, mapped database, exact old
   migration ledger, protected infrastructure and private volume identities.
3. Stop only that environment's web/API containers for a short maintenance
   window. Auth, database, mail, other environments and development slots remain
   running. Ensure no independent worker/writer can change the selected corpus.
4. Save root-only recovery material outside public source: both database
   archives, their checksums, old migration inventory, selected table checksums,
   configuration/state, exact app images, volume/protected-container identities
   and a phase journal. Verify archive contents before writing SQL.
5. Apply the exact reviewed pending SQL and ledger inserts in **one transaction**
   with the migration advisory lock. Recheck the old ledger before changing it.
   Do not replay earlier migrations or use a general reset command.
6. Update only the selected protected migration approval fingerprint. Activate
   and verify the already scanned candidate pair as an explicit one-time
   maintenance cutover. Record it as a manual, non-promotable baseline. Do not
   fabricate a successful GitHub job or signed staging eligibility.
7. Verify HTTPS, readiness, anonymous denial, exact image/tree, ledger, preserved
   identities and unchanged infrastructure/volumes. Rerun staging CI to establish
   real fresh signed eligibility; then follow the approved production cutover
   and normal main promotion checks. Report the manual cutover separately from
   subsequent automatic verification/promotion.

If migration fails before commit, its transaction rolls back. If activation or
post-commit verification fails, keep maintenance in effect, establish that the
selected app operation has stopped, restore both database archives in one
transaction, restore protected approval/state, and reactivate/verify the exact
old app pair. An uncertain in-flight operation requires reconciliation before
restore or another start. Never let an old image run against the new schema as
an assumed rollback. Retain all recovery material until recovery is verified.

After successful cutover, ordinary image rollback is limited to versions with
the approved schema fingerprint. Recovering a pre-cutover image requires the
paired database/configuration restore and explicit operational authorization.
AI-service configuration and real Ask Arden acceptance are separate work; a
healthy Core deployment does not prove an available model/indexing service.
