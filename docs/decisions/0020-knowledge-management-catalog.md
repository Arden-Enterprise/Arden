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

Migration 0027 is additive and operator-class: it adds a bounded active-member
display-name lookup for Target Readers. It exposes no email or private content.
The reviewed trusted-function inventory becomes 20; preserve the existing
postgres execution identities and rerun workflows after the ownership handoff.
No applied migration or existing trusted routine body is rewritten. Approved
Target Readers remain authoritative even across department boundaries; legacy
audience policies and 0025's restrictive reader check remain in place.

Legacy publications/pending snapshots are not relabelled from filenames. Metadata
backfill for an existing corpus requires an exact mapping and separate authorized
data rehearsal/rollout. Collection access does not imply file download beyond the
existing reader capability. AI Summary, OCR/image understanding, retention,
temporal AI version selection and production rollout are separate work.
