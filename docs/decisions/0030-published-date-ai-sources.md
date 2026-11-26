# 0030 — Published-date AI sources

Status: accepted, 23 November 2026. Implementation: local; not deployed.
Originator/decision owner: requesting maintainer. Record author: Codex.
Approval: explicit request to remove Current guidance, its options and all related
backend/DB behavior, defaulting to Published date. This supersedes the temporal
parts of ADR0021 and the earlier same-day proposal to retain the dropdown. The
maintainer supplied this replacement after the real mode behavior was explained;
no further teammate consultation is claimed.

## Decision

- Company Ask and exact-document Reader AI use only the canonical current indexed
  publication. Published date determines availability; review/index activation and
  the current-publication pointer remain authoritative. Never infer a replacement
  from an unapproved draft or fall back to a superseded publication.
- Remove CURRENT/UPCOMING/COMPARE from the UI, API inputs/history, retry identity,
  source lookup and persisted conversation turns. The no-argument eligibility
  helper enforces current organization, active identity, current Target Readers,
  current pointer validity, index readiness, Published date and optional inclusive
  expiration. An inaccessible, withdrawn or expired replacement does not revive
  an older version.
- Remove Effective Date from active metadata inputs/output/status/AI labels and
  mutable draft data. Original PDFs and frozen submission/publication JSON retain
  their exact historical contents. Retired keys never control live behavior or
  reappear in current API projections. This does not reinterpret dates written in
  source documents as machine-enforced rules.
- Keep hybrid search/RRF, evidence validation, conversation owner isolation,
  expiration, governance inspection and audit. Private AI remains separate pending
  work under the Company/Personal context contract.

## Data and compatibility

Operator migration0063 drops the obsolete version-scope column, scope policies,
parameterized helper and release-lineage trigger/function/table. It introduces
current-only policies/helper, strips Effective Date from mutable drafts, prevents
it entering new content snapshots and updates maintenance publication proof to
publication time. It leaves turns, citations, evidence, publications, files,
permissions, generations and applied migrations intact. Trusted routines retain
their execution identity; the retired trigger reduces the definer inventory by one.

Existing answers referencing a superseded source remain stored but become
unavailable through revalidation. Old clients sending versionScope receive400;
coordinate Core/web/desktop rollout. Do not roll old Core onto the contracted
schema. Recovery requires the reviewed matching code/schema or the protected
pre-migration backup, not editing old SQL or weakening authorization. Take a full
backup and rehearse restore/upgrade against the exact target before shared rollout.

Arden-AI already accepts an explicit Core allow-list without a version-scope field.
No AI dependency/model/schema change or corpus reindex is required.

## Acceptance

1. No composer selector or placeholder attachment; normal submit/retry/history work.
2. Scope request fields are rejected; responses/history contain no scope field.
3. Latest published current source is used immediately; superseded, unauthorized,
   cross-organization, expired and withdrawn sources cannot enter AI or restore an
   old answer. Expiration remains inclusive through its UTC day.
4. Real runtime RLS and conversation persistence work after full ownership handoff.
5. Forward upgrade preserves history/evidence and frozen metadata, removes only
   retired scope machinery, and rolls back atomically in rehearsal. Old migration
   checksums remain unchanged. Shared rollout is a separate operational milestone.
