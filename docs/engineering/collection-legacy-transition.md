# Collection backend transition and legacy rehearsal

Owner: product/engineering maintainers. Tracking: ARD-77.
Accepted scope: 19 November 2026, requesting maintainer approves API first,
explicit legacy conversion second and safe cleanup third. Recorded by Codex.
Source: local `feat/knowledge-scope-foundation` from staging `af28915`, main
`9fa3d34`; [0026](../decisions/0026-flat-organization-collection-placement.md).
Status: compatible local API/UI/Home implemented and staging inventory/protected
restore verified. Reviewed live mapping, operator cutover and release pending.

P3B.3 adds the compatible shared management UI locally: separate configuration and
one-document placement; no legacy bulk payloads. Form snapshots retain the editing
revision across background catalog refresh; stale/uncertain writes block another
submission until reload. Safe Cancel remains available during read-only loading;
mutation-in-flight navigation waits for the outcome. Topic creation/browse/filter
controls are removed from the affected shared Home path, not historical metadata.
Evidence uses real production components/client with an explicitly labelled local
volatile HTTP fixture; it is not a combined authenticated HTTP-to-DB/native test.

P4A locally supplies the compatible Home composition: the common master register
is explicit Organization sources, Shared is separate, and null-reader legacy
publications remain discoverable under Other documents. This does not approve a
legacy destination map or delete old links/Topic storage. Do not remove the
compatibility view before reviewed conversion and consumer acceptance.

## API contract

Base: `/api/v1/organizations/:organizationId/knowledge/catalog`.

| Operation | Contract |
| --- | --- |
| GET base | Authorized catalog. Collections project current eligible publication IDs through logical placement, never through old exact-version links. Members discover nonempty active eligible folders; Admin can inspect empty/unconfigured shells. `allowedTypes: null` denotes legacy unconfigured. |
| POST `/collections` | Name, status and nonempty controlled `allowedTypes`; optional description/cover. No content placement. Existing name uniqueness and transaction/audit retained. |
| PATCH `/collections/:id` | Same configuration payload and `If-Match: "catalog-N"`. `INACTIVE` is Archive: triggers detach contents to Unassigned, never withdraw/delete documents. |
| GET `/placements/:documentId` | Current Org Admin only, current eligible common source, logical `shared_draft_id` identity. Returns `{documentId, collectionId, revision}` and `ETag: "placement-N"`; absent placement has null/0. |
| PATCH `/placements/:documentId` | `{collectionId: UUID\|null}` plus `If-Match: "placement-N"`. One atomic add/move/remove; audit in the same transaction. Retained Unassigned rows never reset revision. |

All successful/authenticated catalog replies use no-store. Invalid input is 400,
missing/malformed revision 428, stale/deadlock/serialization conflict 412,
unavailable/denied/foreign/ineligible source 404. Never automatically retry a
mutation after an ambiguous transport outcome: GET current placement and reconcile
before another deliberate change. Audit failure rolls back the mutation and
remains a server failure, not a misleading eligibility error.

Collection configuration with the retired `documentIds` bulk-picker input gets
409 `CATALOG_UPGRADE_REQUIRED`; it never updates old links. Missing Allowed types
does not mean all Types. The shared web/desktop client adds placement adapters;
Electron permits only exact GET/PATCH placement routes/preconditions and no query
or unrelated capability. No public general SQL/operator endpoint is introduced.

**Release compatibility gate:** the management editor now uses separate
configuration/placement and Home uses the scoped projections. Ship the matching
API/UI together, after the operator migration and target-specific rehearsal.
Legacy mapping, native acceptance and separately approved physical contraction
remain distinct gates; obsolete clients still receive the explicit upgrade error.

## Explicit legacy mapping

`collection-legacy.ts` inventories organization-scoped identifiers/configuration,
old links, current eligibility/Type and existing placement revisions. It includes
no document text, titles, source URIs or reader identities. The output still
contains private installation metadata: store/review it outside the public tree.

Inventory has a SHA-256 fingerprint. A reviewed plan must contain exactly:

```json
{
  "organizationId": "<organization UUID>",
  "fingerprint": "<exact fresh inventory fingerprint>",
  "collections": [
    {"id": "<each unconfigured Collection UUID>", "allowedTypes": ["Guide"]}
  ],
  "documents": [
    {"documentId": "<each distinct linked logical document UUID>", "collectionId": null}
  ]
}
```

This is a shape illustration, not an executable mapping. Explicitly configure
every unconfigured folder and resolve each old logical document once, including
deliberate Unassigned. A new assigned destination must be an existing old link,
active and compatible with the current Organization source/Type. A document in
multiple old folders requires a reviewed single choice, never an automatic first
match. Unknown/missing/duplicate/stale/foreign/conflicting plans fail. A newer
placement cannot be overwritten; a matching newer valid placement outside the
old folder links is retained rather than forced back into a historical folder.
Ineligible legacy sources must be Unassigned;
corrupt foreign-source links never create a local placement.

Missing/null published Type or Version is a separate metadata-repair inventory.
Do not invent those values from PDF filenames or mutate immutable publications.
An unknown-Type source cannot be placed until a governed repair/republication
makes it eligible; explicit Unassigned does not hide it from the common register.

The maintainer approved the bounded staging exception in ADR 0026: operator
migration 0041 accepts a private, hash-verified manifest in the same transaction
through `arden.metadata_repair_manifest`. No input means no repair, never guessed
metadata. The operator separately requires exactly 30 matches and 30 audit rows.
Existing draft ARD codes are retained and copied to missing submission/publication
codes. Only fully missing metadata is repaired; stale hashes, different current
draft content or existing metadata cause an atomic refusal. Normal optional
metadata fields remain empty, not fabricated dates/Topics/change descriptions.
Three named snapshot guards and the draft timestamp trigger are transactionally suspended and restored, with
full non-metadata row comparisons and before/after audit. Any failure rolls back
the repair and trigger DDL. There is no persistent bypass routine or runtime API.
All content, readers, index generations and unmatched publications stay unchanged.
This exception does not authorize a Collection mapping or physical schema drop.

## Disposable rehearsal tooling

The CLI is intentionally **local-only**, named `arden_test_*`, non-production,
loopback connection. Apply also verifies a disposable superuser DB and a current
same-organization Admin membership for attribution. It cannot migrate staging.
Use the existing ignored private location and shell environment; do not put real
URLs or mapping files in public artifacts.

```powershell
pnpm --filter @arden/api exec tsx src/knowledge/collection-legacy-cli.ts --inventory <organizationId>
pnpm --filter @arden/api exec tsx src/knowledge/collection-legacy-cli.ts --apply <private-plan.json> <adminMembershipId>
```

Set `ARDEN_TEST_DATABASE_URL` to the explicitly verified disposable target first.
Review the inventory/plan before apply. The module owns one Read Committed
transaction: organization advisory lock, bounded maintenance-table locks, fresh
fingerprint and Admin validation after every maintenance lock is held, configure legacy folders, create only missing
logical placements, remove exactly that organization's legacy links, audit and
commit. Any failure rolls back configuration, placement and deletion together.
Lock/statement timeouts are bounded; do not loop retries against a stale plan.
The maintenance locks block writes across the affected tables, not just one
organization, so they are not a zero-downtime live migration design.

Use Read Committed with those locks: the authoritative inventory is read after
all locks are obtained. Do not switch this to a transaction-wide snapshot taken
by the earlier advisory-lock SELECT; that could miss a legacy link committed
while waiting. A real two-connection regression inserts/commits such a link and
verifies the old plan is refused with no conversion/deletion. Fresh mapping then
converts both links. A newer valid explicit placement is also retained even if
its folder is absent from historical associations.

## Cleanup boundary and release prerequisites

Removed in code: runtime Collection writes/deletes/inserts through
`knowledge_collection_document`, bulk replacement and exact-version projection.
Local conversion tests actually delete converted synthetic legacy associations.
Only their old links are removed; no file, publication, snapshot, reader selection,
private original or audit history is deleted. No applied migration is rewritten.

Retained deliberately: the empty legacy relation/schema and Topic storage/API.
`freeze_knowledge_management` still joins `knowledge_topic` when creating snapshots;
mutable drafts can retain its FK, historical snapshots retain Topic provenance,
and compatibility API/types still retain Topic. Dropping those objects now
would break an accepted path. Verify the remaining API/SQL dependency
inventory and preservation, then use a reviewed forward contraction migration.
Do not erase frozen metadata or legacy Audience/role compatibility as collateral
cleanup. This phase is not a complete physical schema contraction.

Before a live transition: explicit target authority, protected backup and real
restore rehearsal, exact live inventory/owner-approved mapping, maintenance and
single-writer/cutover plan, compatible UI, migration 0040 applied through its
operator gate, paired runtime/native acceptance and recovery plan. The local CLI
must not be made remote-capable by changing its environment or bypassing guards.
Authorize/review a proper operator entry point separately. Data converted to the
logical model cannot be safely rolled back to an old exact-link writer merely by
reverting application code; restore or reviewed reconstruction is required.

Actual tests/screenshots: [P3B.2 evidence](../evidence/2026-11-19-knowledge-organization/README.md#km2-p3b2--collection-api-and-explicit-legacy-rehearsal).
Compatible UI/tests: [P3B.3 evidence](../evidence/2026-11-19-knowledge-organization/README.md#km2-p3b3--collection-management-ui).
Relevant PostgreSQL 17 behavior: [lock conflicts](https://www.postgresql.org/docs/17/explicit-locking.html),
[transaction isolation](https://www.postgresql.org/docs/17/transaction-iso.html).
