# 0014: The author's primary department owns and reviews a shared draft

Status: accepted
Date: 2026-10-26
Decision owner/approval: requested by the repository user in the working session on 2026-10-26 ("người up lên là người chịu trách nhiệm"). Record the project lead's confirmation in the pull request.
Implementation: partial — API rule, options field and UI implemented; real-PostgreSQL integration evidence not yet obtained
Supersedes: in [0010](0010-audiences-and-system-administration.md), the author *selecting* the responsible department at Share/Prepare Submission

## Context and requirement

Decision 0010 had the author choose a responsible department when preparing a submission. That department decides which reviewer grants apply ([0013](0013-audience-breadth-review-levels.md)). This caused two problems:

- **Duplicate choice.** Authors had to pick a department in addition to the readers, which duplicates the reader choice in the common case.
- **Self-routing.** The server accepted any active department, so an author could route review to a department they do not belong to, for example one with more lenient reviewers.

The project direction is the familiar document-system model: whoever uploads a document is responsible for it, and the system already knows which department they belong to.

## Options and tradeoffs

1. **Author chooses any department (status quo).** This is flexible, but it duplicates the reader choice and allows review routing outside the author's department.
2. **Author chooses among their own departments.** This prevents outside routing, but it keeps a choice that is rarely needed, and multi-department authors can still pick the more lenient reviewers.
3. **Derive from the author's primary department (accepted).** There is no choice to make and no routing outside the author's department. Primary-department membership is already maintained by Organization Admins. The cost: a multi-department author cannot assign a secondary department.

## Decision

- The author (`author_membership_id`) remains the owner of a shared draft.
- The responsible department is the author's **active primary department** (`department_membership.is_primary`), read on the server under the author's own RLS context. It is set on every draft save. A client may omit the field or repeat that value; any other department is rejected as invalid metadata.
- At submit time the stored responsible department must equal the author's current primary department, or the submission is not ready. It is then frozen on the snapshot, as before. Moving the author to another department later does not change a pending submission. The next save adopts the new department.
- An author without an active primary department can save but cannot submit. The UI asks them to contact an Organization Admin.
- Readers stay separate from reviewing ([0010](0010-audiences-and-system-administration.md)). A group or organization-wide audience never changes the reviewing department.
- Choosing a secondary department is out of scope. If it is needed later, the choice is limited to the author's own active departments.

## Boundaries and consequences

- **API:**
  - `GET …/knowledge/options` adds `primaryDepartmentId` (string or null).
  - `PATCH …/knowledge/drafts/:id` still accepts `responsibleDepartmentId` for older clients, but only `null` or the author's primary department.
  - Submission returns "not ready" when the stored department differs from the current primary department.
- **No migration:** the existing column and the submission trigger, which copies the draft's department, are reused.
- **UI:** the Responsible department select is replaced by "Owned by you · reviewed by {department}".
  - A server that does not return `primaryDepartmentId` (an older hosted slot) keeps the old select, so the UI works during a mixed rollout.
  - A draft whose stored department differs from the derived one can be saved without other changes to adopt it.

## Verification and rollout

- **Evidence obtained:**
  - API unit tests: derive when the field is omitted or `null`; accept the matching value; reject another department or any department when the author has none; submit only when the stored department equals the current primary department.
  - HTTP test: options exposes `primaryDepartmentId`.
  - UI tests: the derived owner wins over a stored choice; a missing primary department stays blocked; older servers fall back to the stored choice.
- **Not obtained:** the primary-department query and the save/submit paths run only against real PostgreSQL. The repository integration suite skips without `ARDEN_TEST_DATABASE_URL`.
- **Rollout:** upload this checkout to the assigned development slot with `pnpm dev:remote`. Then save and submit a draft as a member with, and as a member without, a primary department.

## Rules and documentation updates

- [DESIGN.md](../../DESIGN.md) — Before you submit shows the derived owner instead of a department select.
- [0010](0010-audiences-and-system-administration.md) — the "author selects responsible department" clause is superseded by this record.

## References

- `apps/api/src/knowledge/policy.ts` — `resolveResponsibleDepartment`, `canSubmitSnapshot`
- `apps/api/src/db/repository.ts` — `actorPrimaryDepartment`, draft update and submit
- `packages/ui/src/knowledge/readerSelection.ts` — `ownerDepartment`
