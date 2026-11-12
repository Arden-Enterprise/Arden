# Knowledge management implementation and rollout

Contract: [F11 KM-v1](../product/graph-ai-and-work.md#knowledge-management-refinement-km-v1-accepted-12-november-2026).
Decision: [ADR 0020](../decisions/0020-knowledge-management-catalog.md).
Baseline: staging `0e25b71`; local branch `feat/knowledge-management`. This guide
does not claim a merged commit, live migration, CI result or staging deployment.

## API and data

Under `/api/v1/organizations/:organizationId/knowledge`:

- `GET /catalog`: active Topics and currently readable collection projections;
  admin configuration may also include inactive/empty catalog shells.
- `POST /catalog/topics` or `/catalog/collections`: Org Admin only.
- `PATCH /catalog/:kind/:id`: complete name/description/status write, requiring
  `If-Match: "catalog-N"`. Collections accept a fixed cover key and ordered exact
  `documentIds`; input source IDs must be currently readable by the curator.
- `GET /catalog/readers?q=...&ids=...`: active-member display names only, bounded
  to the caller's organization. Search requires two characters; selected-ID
  resolution accepts at most 100 identities. It is not an email directory.
- Existing draft PATCH accepts `management` and explicit `targetReaders` with the
  usual save revision. A PDF can be replaced by a canonical `pdfBase64` payload,
  under the same draft/code, with a new immutable content revision; no text/PDF
  mixing, other-author writes or stale replacement is accepted.

`management` contains Type, Topic ID, business Version, Effective Date, optional
Expiration Date and Change Note. Save permits missing values, not malformed dates
or inverted date ranges. Submission requires complete metadata, active Topic,
explicit readers, an owner department, a new business Version and a Change Note
for previously published knowledge. Saving while pending does not alter a frozen
submission. System snapshot metadata adds the frozen Topic name and New/Updated
release kind. Activation copies metadata from that submission, not from the latest
draft. Published/activation timestamps retain their existing meaning.

The server marks current metadata objects with `schemaVersion: 1`. The client does
not supply that marker. On every save of a current-model draft, the server derives
the legacy compatibility audience/reviewer projection from the effective Target
Readers, including when the request only contains older fields. Those fields
cannot downgrade an organization-wide proposal to department review. Unversioned
pre-model fixtures/snapshots retain their deliberately frozen legacy projection.

Actor/organization context and RLS apply to every catalog transaction. Admin
writes use the existing verified Org Admin capability, optimistic versions,
organization-level serialization and audit. A catalog label cannot grant read,
review or RAG access. Collection counts/contents are filtered before response,
including for admin. Removed current pointers/revoked membership cannot remain
discoverable through a collection. Exact-version links are deliberately not
silently redirected to replacement content. Legacy rows show absent metadata
honestly, not inferred categories, dates or version labels.

## Safe rollout, separately authorized

1. Review the new SQL and API/client compatibility together. Do not edit 0001–0026.
2. Back up the selected environment's DB/files/config and rehearse 0027 on a
   restored disposable target. No full-chain replay or content reset on staging.
3. Apply operator migration 0027 with the reviewed trusted-executor identity.
   Confirm all 27 ledger checksums, forced RLS and the 20 reviewed SECURITY DEFINER
   routines. Use the normal ownership template; do not transfer trusted routines
   to the restricted migration owner or add BYPASSRLS to API/admin.
4. Verify bootstrap, catalog/member denial, save/submit, immutable review,
   index-ready activation, reader/collection revocation and source navigation
   under real runtime/worker roles **after** the ownership handoff.
5. Deploy through the existing pipeline only with release authority. Create the
   organization catalog through the API. Backfill existing publications only
   with a separately approved source-ID mapping/rehearsal; this migration does not
   invent Topics or overwrite approved publication history.

Recovery: stop the feature rollout on a mismatch, retain DB/files and previous
images, and use a reviewed forward repair or verified backup recovery. A previous
image does not undo a schema/data change. The old optional input shape remains
parseable, but all newly submitted documents must meet KM-v1 requirements. Existing
pending reviews retain their frozen rule. New catalog UI must not be deployed
ahead of its operator migration. No new re-index is required merely for catalog
navigation; changing governed content/readers still uses the existing review and
activation path.

## Verification boundaries

Local checks include pure metadata cases, HTTP schema/preconditions, actual
PostgreSQL catalog ownership/tenant/reader checks, frozen metadata through real
activation, admin-without-read curation denial, post-ownership workflows, shared
web/desktop builds and browser interaction. Native installer/runtime, live provider
calls, complete coverage measurement, production-scale pagination/performance and
live rollout are separate evidence. The register currently loads metadata for the
authorized list; larger catalogs need a measured server-pagination slice before
claiming enterprise-scale performance. Original image provenance is recorded in
`packages/ui/src/assets/knowledge/README.md`.
