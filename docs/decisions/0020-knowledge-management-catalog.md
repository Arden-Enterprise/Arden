# 0020 — Governed knowledge catalog and business metadata

Status: accepted, 12 November 2026. Implementation is local/in progress; no release
or data migration is established by this record. Decision owner: requesting
project maintainer. Recorded by Codex from the approved Library reference,
standardized field discussion and explicit catalog-ownership confirmation.
Owning requirements: [F11 KM-v1](../product/graph-ai-and-work.md#knowledge-management-refinement-km-v1-accepted-12-november-2026), ARD-77.

## Decision

Separate Type (a fixed document format/purpose), Topic (one primary business
subject) and Collection (an optional curated reading bundle). Org Admin manages
the organization catalog. Authors select existing active Topics. A catalog item
is not a role, audience or access grant. Collection discovery/curation uses current
publication authorization, including when the curator is Org Admin.

Keep immutable business metadata with each submitted/published version, separate
from the mutable working draft. Store the small versioned metadata object on the
draft and copy it at submit and activation; a generated topic-reference column
pins draft Topics to their organization through a composite foreign key. Freeze
Topic display names at submission rather than rewriting old releases on rename.
Document Code is a stable generated logical identity; business Version is an
author-supplied label, not a save revision. Published Date and Effective Date
remain distinct. Existing publication/index eligibility timestamps are unchanged.

Collections pin exact publications. A replacement must be curated again; a
retired/revoked publication disappears from reader discovery. Preserve invisible
existing links when a curator edits the readable part rather than silently
deleting material they can no longer inspect. No inaccessible source IDs/counts
are returned to that curator. Inactive catalogs remain available for history but
cannot be newly selected for submission or reader discovery.

## Consequences and boundaries

The metadata object avoids duplicating a large set of evolving form columns in
three lifecycle tables. API/domain validation owns its input shape; immutable SQL
triggers protect snapshot identity and copying. The draft Topic foreign key is
relational. This is not a general schema-less tag or custom-field system.

Catalog migration 0030 is additive and operator-class (reallocated from the
unapplied branch-only 0027 to preserve PR #37's 0027–0029 before integration).
It adds a bounded active-member
display-name lookup for Target Readers. It exposes no email or private content.
The combined reviewed trusted-function inventory becomes 21; preserve the existing
postgres execution identities and rerun workflows after the ownership handoff.
No applied migration or existing trusted routine body is rewritten.

### Target Readers authority after legacy backfill

On 12 November 2026 the requesting project maintainer explicitly confirmed Target
Readers as the authoritative readership source after being shown the alternative
dual-check contract and its revocation consequences. This supersedes PR #37's
earlier T1.2 promise that removing a legacy Audience assignment still revokes a
mapped reader. The earlier author's separate consultation is not established;
the maintainer resolved the integration conflict explicitly. This record refines
decision 0010 for publications with a non-null reader selection, not for unmapped
legacy publications or reviewer authority.

Removing a legacy Audience assignment does not revoke a mapped selected reader;
adding one does not enlarge the frozen selection. Governed Target Readers changes
or organization-membership suspension revoke access. Current account, organization,
membership and applicable department eligibility remain enforced. Approved selected
readers may be across departments. Unmapped publications retain legacy checks.

Legacy policies remain for compatibility, alongside 0025's restrictive reader
check and 0030's selection-authorized pointer policy. Initial backfill must preserve
the exact current reader sets without widening; subsequent legacy-report differences
are not the source of current entitlement. Physical legacy-schema removal remains
a separately reviewed migration. Regression coverage must exercise actual runtime
RLS after legacy-role removal, including an unselected reader's denial.

Legacy publications/pending snapshots are not relabelled from filenames. Metadata
backfill for an existing corpus requires an exact mapping and separate authorized
data rehearsal/rollout. Collection access does not imply file download beyond the
existing reader capability. AI Summary, OCR/image understanding, retention,
temporal AI version selection and production rollout are separate work.
