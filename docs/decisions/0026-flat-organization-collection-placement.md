# 0026: Flat Organization Collection placement

Status: accepted
Date: 2026-11-19
Decision owner/approval: requesting project maintainer, explicitly accepting the three P3B product questions in chat.
Brainstorm originator: maintainer (flat common folders); Codex (detailed placement proposal). Record author: Codex.
Source revision: staging `af28915231817aaf6efc67c8f534b627aa45b178`; local `feat/knowledge-scope-foundation`.
Implementation: local schema/API, compatible management UI and scoped Home implemented; protected staging restore verified, live repair/release and physical legacy contraction pending.
Supersedes: [0020](0020-knowledge-management-catalog.md) for required Topic, mixed-reader curated bundles, exact-publication placement and replacement curation. Other publication/private-original safeguards stand.

## Context and options

The common register contains explicit Organization-wide knowledge, not everything
an Admin can inspect. The maintainer wants optional single-level folders,
independent of author contribution, without duplicate document entities or another
permission hierarchy. Multiple curated links are flexible but do not give a
document a single folder location. Pinning each exact version loses that location
at replacement. Silently converting old links would invent an unapproved mapping.

## Decision

- A logical document belongs to zero or one Collection. Only Org Admin may add,
  move or remove it, after publication. No author Collection field or hierarchy.
- Name and nonempty Allowed types are required for new management operations.
  Description is optional. Types are the existing controlled five values.
- Only current eligible Organization publications of an allowed Type can be
  placed. Placement never changes content, Type, responsibility or Target Readers.
- Eligible activated replacements keep the logical location. Narrower readership,
  incompatible Type or withdrawn availability detaches it to Unassigned. Archive
  also detaches contents, without deleting history or withdrawing documents.
- The common All/Master List still includes assigned and unassigned documents.
  Collection membership is not an entitlement or a separate AI trust boundary.

## Schema and compatibility

Forward operator migration `0040_flat_collection_placement.sql` reuses
`shared_draft_id` as the stable logical identity. A separate placement relation
has that primary key and same-organization foreign keys. It retains nullable
Unassigned rows and a server-incremented revision, avoiding revision reset after
remove/re-add. Runtime has no DELETE grant. The next API slice must use atomic
expected-revision mutations and safe stale/deadlock failures.

Nullable legacy `allowed_types` means unconfigured, never all Types. Existing
`knowledge_collection_document` exact-version links remain untouched by 0040;
no automatic backfill or arbitrary folder choice occurs. The existing API/UI still use that old relation
at the original P3B.1 checkpoint. [P3B.2](../engineering/collection-legacy-transition.md)
now connects logical API projection/placement and required Allowed types, refuses
the retired bulk payload, and provides explicit local legacy conversion/cleanup.
Compatible UI and actual live mapping/cutover remain release gates. Explicit
P3B.2 conversion removes mapped synthetic old links in disposable tests only;
it does not rewrite 0040 or drop legacy tables/Topic provenance.

The narrow trigger-only validator uses a trusted postgres execution identity to
lock eligibility inputs without granting runtime writes to publication tables.
It has no runtime/PUBLIC EXECUTE or content-returning surface. Reconciliation is
invoker-context. Preserve this trusted definer (34 total with notifications) in the ownership handoff and
repair inventory; do not relax RLS or grant BYPASSRLS to runtime.

## Verification and rollout

### Integration allocation — 20 November 2026

Staging d2321ce already contains immutable notification migration0039 and ADR0025.
Rename only these unapplied local migrations to0040 (Collection) and0041 (metadata
repair), and this ADR to0026. Collection SQL bytes stay unchanged; the repair's
operator label/audit migration ID follows its new allocation. Earlier receipts
were for the previous candidate and do not prove the new combined chain or grant
authority to operate notification migration0039. The maintainer authorizes source
integration/merge of PR58 and PR60; live operations remain separately gated.

### Approved historical metadata repair exception — 19 November 2026

The requesting maintainer explicitly approved staging-only migration 0039 and a
forward metadata repair after protected backup and restore rehearsal. The repair
is limited to the 30 approved demonstration PDFs matched by exact content hash.
Fill missing Type/Version from the verified source manifest/PDF, retain each
existing ARD draft code (separately confirmed), and copy that code into its missing
submission/publication identity. Capture before/after metadata in audit. Refuse
nonempty or stale snapshots rather than overwriting them. Files, content hashes,
readers, index generations, publication state and the four other current
publications are outside this exception. It is not a general permission to edit
review history or a runtime metadata repair endpoint.

No legacy Collection destination or archive is inferred from this approval;
that separate configuration decision remains pending.

P3B.3 management and P4A scoped Home are now implemented locally; the compatible
UI-pending checkpoint above is historical. [P4A evidence](../evidence/2026-11-19-knowledge-organization/README.md#km2-p4a--home-composition)
separates synthetic component/HTTP observations from real isolated DB tests and
remaining authenticated/native acceptance. No live mapping/cutover is implied.

[P3B.1 evidence](../evidence/2026-11-19-knowledge-organization/README.md#km2-p3b1--flat-folder-database-foundation)
records real isolated PostgreSQL after DDL handoff, local rollback/upgrade,
one-folder/CAS/tenant/Type/Archive/replacement checks, workspace tests and screenshot.
This is not API/UI, full restore, native, provider or staging acceptance. Existing
migrations are unchanged. Target-specific inventory, mapping, backup/restore
rehearsal, migration and deployment require separate release authority.

Owning contract: [phased implementation](../engineering/knowledge-organization-phases.md#km2-p3b-accepted-folder-governance-19-november),
[F11](../product/graph-ai-and-work.md#knowledge-organization-restructuring-km2-19-november-2026),
[ownership rules](../engineering/security-and-data.md#database-ownership-is-an-execution-contract).
