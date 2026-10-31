# Identity, ownership and access coverage

Read the [feature index and source baselines](README.md) first. These are traceability/verification cases derived from existing contracts, not newly approved behavior or a passing test report. Main decision 0010 governs the current main audience/admin boundary. Referenced branch alternatives remain explicit reconciliation work.

Provenance: main [private-note decision](../decisions/0002-first-slice-private-notes-contract.md), [organization decision](../decisions/0005-mainflow-1-organization-membership.md), [audience/System Admin decision](../decisions/0010-audiences-and-system-administration.md), [first-slice API contract](../engineering/first-slice-permission-and-api-contracts.md) and [technology guide](../engineering/technology-guide.md). Their public approval records identify project lead/task owners; more precise original brainstorm identities are not inferred. Delivery owners are the existing issue assignees. Unknown ownership or a changed requirement uses the [decision-change rule](../engineering/rules/specifications.md).

## F01 Accounts and sessions

Scope: the implemented Supabase-authenticated web/desktop boundary, account setup and recovery. Flow: account setup/verification or sign-in → session → current-user/organization discovery → sign-out/expiry/recovery. See ARD-13 and the technology guide; older sample-only sign-in descriptions are historical.

| Acceptance ID | Complete path to verify | Evidence / remaining |
| --- | --- | --- |
| F01-AC1 | Supported account/sign-in paths reach only the authenticated actor's available organizations; invalid credentials and unverified/expired provider state have clear outcomes. | Source slices reported; full provider/browser acceptance not established by this map. |
| F01-AC2 | Recovery, refresh, expiry and sign-out clear/revalidate sessions without exposing tokens; callbacks and redirects obey the current trust boundary. | Check actual provider, HTTP cookies and error paths. |
| F01-AC3 | Web HttpOnly sessions and desktop OS-protected sessions produce equivalent access; renderer/browser storage does not receive secret tokens. | Native behavior needs native evidence, not just a build. |

## F02 Organizations and membership

Scope: verified-account bootstrap, departments, invitations, membership and authorized administration. Flow: create organization → initial administrator/department → invite → intended recipient accepts → authorized assignment → usable workspace. ARD-8/ARD-13 cover related first-slice work.

| Acceptance ID | Complete path to verify | Evidence / remaining |
| --- | --- | --- |
| F02-AC1 | Bootstrap creates the correct initial authority exactly once; ordinary members cannot administer organizations, departments or other memberships. | API slices exist; real database/RLS and full UI acceptance remain distinct. |
| F02-AC2 | Invitation issue/resend/revoke/accept handles wrong account, expired/revoked/used token, duplicate request and email failure without duplicate membership or token disclosure. | Follow current server policy, not historical preview expiry values. |
| F02-AC3 | Pending/suspended/removed members lose relevant access; assignment/restoration and last-administrator safeguards follow an accepted lifecycle contract. | Remaining lifecycle/recovery choices must be decided, not guessed. |

## F03 Private notes

Scope: an actor's own organization-scoped notes; sharing creates a different object under F07. Flow: create/list/open → edit/save with concurrency control → navigate/reopen → sign-out or access change. ARD-15/ARD-16 and the first-slice API contract own the detailed scope.

| Acceptance ID | Complete path to verify | Evidence / remaining |
| --- | --- | --- |
| F03-AC1 | Owner create/read/update is durable through the actual API/storage boundary; another member, Org Admin or System Admin cannot read the private original or its metadata. | API/UI source exists; run actual-role isolation checks for an affected change. |
| F03-AC2 | Unsaved navigation, failed save, stale version and concurrent edits produce explicit states without silent overwrite/loss; one note's draft does not overwrite another. | UI/API/conflict evidence must be linked per changed behavior. |
| F03-AC3 | Switching identity, session expiry or membership revocation removes inaccessible data/context from web and desktop; contribution does not expose the original. | End-to-end acceptance not certified by this inventory. |

## F04 Published audiences

Scope: organization/department managed audiences and Org Admin-managed groups; readership remains distinct from administration and review. Main decision 0010 supersedes the older configurable role-based reader model.

| Acceptance ID | Complete path to verify | Evidence / remaining |
| --- | --- | --- |
| F04-AC1 | Authorized group management and membership updates result in correct effective published readers, scoped to the organization/department. | Canonical API/migration foundation exists; migration 0017 rehearsal remains a recorded gate. |
| F04-AC2 | Authors select only permitted target audiences; invalid/removed audiences fail safely at submission and approval. | Cover actual server/RLS checks, not UI filtering alone. |
| F04-AC3 | Removal/revocation immediately affects read, search, graph, agent context and citations wherever implemented; audience membership never grants review/admin/private-original access. | Future consumers inherit this invariant; do not claim they already exist. |

## F05 Reviewer and organization authority

Scope: administration and explicit Reviewer Grants. Flow: authorized grant creation → scoped review queue/detail → current-authority recheck → decision or denial → grant revocation. Related work includes ARD-31/ARD-36/ARD-38.

| Acceptance ID | Complete path to verify | Evidence / remaining |
| --- | --- | --- |
| F05-AC1 | Membership, frozen readers, disjoint grant scope, validity and tags determine queue/detail/decision access, with rechecks after protected-content reads; legacy pending snapshots retain their original rule. | ADR 0013–0015 explicitly confirmed on 29 October 2026; real migration/runtime-role tests remain required. |
| F05-AC2 | Ordinary reviewers cannot self-review; Organization Admin retains final decision authority and audited self-approval under ADR 0011. | Preserve private-original isolation and source access independently of review authority. |
| F05-AC3 | Grant/member removal and audience changes block unauthorized pending decisions; denial does not expose hidden content or alter another author's draft. | Actual-role and concurrency evidence required where affected. |

## F06 Installation administration

Scope: installation-level Arden operations authority, separate from every organization's memberships and content. See [implementation phases](../engineering/audience-system-admin-implementation.md).

| Acceptance ID | Complete path to verify | Evidence / remaining |
| --- | --- | --- |
| F06-AC1 | Authorized installation administration/bootstrap succeeds through the selected protected API and audit path; ordinary organization identities cannot acquire it. | API foundation reported; System Admin UI and database-denial rehearsal remain pending in main inventory. |
| F06-AC2 | System Admin cannot impersonate users, read private originals, bypass audiences or make organization review decisions through installation authority. | Verify denial at server/database boundaries. |
| F06-AC3 | Lifecycle/recovery and operational telemetry expose only approved metadata and preserve appropriate last-authority/recovery rules. | Exact recovery/support choices require an accepted contract; no root-proof privacy promise. |
