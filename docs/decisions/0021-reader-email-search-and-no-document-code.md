# 0021: Find Target Readers by name or email, and retire Document Code

Status: accepted
Date: 2026-11-14
Decision owner/approval: requesting project maintainer, in the project conversation on 2026-11-14
Record author: Claude, from the maintainer's explicit choices in that conversation
Implementation: branch `feat/km-reader-email-no-document-code` only; not merged, released or deployed
Supersedes / superseded by: supersedes two parts of [0020](0020-knowledge-management-catalog.md) and [F11 KM-v1](../product/graph-ai-and-work.md#knowledge-management-refinement-km-v1-accepted-12-november-2026): the reader lookup "is not an email directory", and "Document Code is a stable generated logical identity". Every other part of 0020 remains in force.

## Context

KM-v1 found explicit Target Readers by display name only and showed a generated Document Code
(`ARD-` + 16 hex characters) on drafts, reviews, the Library and the document page. The maintainer
asked for the reader picker to work like sharing in Google Drive, by email, and decided the product
does not need Document Code.

Considered: an email search that masks the result (`kh***@company.com`) and only matches from the start
of the address. The maintainer chose the Drive model instead: inside one organization, members seeing
each other's full work email is normal (Google Workspace shows the organization directory by default).

## Decision

1. **Reader picker.** Members search active members of their own organization by name or email (two or
   more characters, case-insensitive). Each suggestion shows the display name, the full email and the
   primary department. Pasting a full email selects that member; an address outside the organization
   finds nobody and is never shared outside it. Search returns at most 20 suggestions; resolving
   already-selected readers accepts at most 100 IDs. The lookup stays the reviewed SECURITY DEFINER
   `knowledge_reader_directory`, bound to the caller's organization and active identities.
2. **No Document Code.** The API no longer returns `documentCode` and the UI no longer shows, searches
   or derives a code (including from a leading title prefix such as `NSS-STD-067 — `). Documents are
   identified by title, version label and link.
3. **Keep the column for now.** `document_code` stays in the database (drafts generate it; submissions
   and publications freeze it) because it is part of immutable snapshots. Dropping it is a destructive,
   operator-reviewed contraction to plan separately.

## Consequences

- Any member can learn the work email of colleagues in their organization through the picker. This is
  accepted as in Google Workspace; there is still no cross-organization lookup.
- Titles that contain an old code prefix now show it as part of the title.
- Reports 3/4 and any design that shows Document Code need the same update.
