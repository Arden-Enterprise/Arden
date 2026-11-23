# Flow 4 specification — Knowledge Maintenance

## Problem and intended users

Readers need a way to flag outdated or incorrect official guidance and learn what happened. Reviewers need to see the exact reported evidence, establish responsibility and close cases with a traceable explanation. Authors handle corrections through the publication workflow. Organization Admins handle routing exceptions and authorized reassignment.

The [Flow 4 product specification](../../product/flows/flow-4-maintenance.md) owns product details. The IDs below map one-to-one to its MA criteria and the [flow catalog](../../product/flows/flow-4-sequences.md). AC-10 maps to MA-10 in the [cutover decision](../../decisions/0028-maintenance-report-intake.md) and the [original Phase 0 plan](../../superpowers/plans/2026-11-18-flow-4-complete-working-plan.md).

## User journey

1. From **Home**, open a published document. See its version, published date and validity. **Report a problem** keeps that exact version visible and takes a description with optional section or page. An eligible reviewer can start a scoped review with an objective.
2. In **Reviews → Maintenance**, eligible reviewers see **Unassigned**, **Mine** and **All I can review**. Opening a row is read-only. An independent reviewer claims the case. Admin assignment exceptions are visible to authorized admins.
3. The case shows the document alongside **Case**, **Version changes**, **Findings**, and **Audit history**. Compare readable versions oldest first and open the exact source passages. Ask for more information or explicitly start an analysis over selected evidence.
4. The reviewer decides whether a change is needed. An author follows the Flow 2 action in **My Contributions** when applicable. A reviewer verifies any required publication outcome and confirms resolution with a reporter-facing explanation.
5. In **Home → My reports**, the reporter sees **Submitted**, **In Progress**, or **Resolved** and authorized unread updates. Reviewer history records actions and evidence. A recurrence is a linked new case with its own resolution.

## Acceptance criteria

| ID | Flow / prior ID | Observable pass condition |
| --- | --- | --- |
| **AC-01** | F4-01 / MA-01 | An authorized reader submits once against the exact readable version and optional valid anchor. Identical keyed retries return the same case. Changed payload under that key conflicts. Independent reports remain separate. Scoped reviewer-started cases work without a member reporter. Invalid, inaccessible or stale evidence does not change the source or write a case. |
| **AC-02** | F4-02 / MA-02 | Only one eligible independent reviewer wins a claim race. The losing reviewer sees refreshed permitted state. Correct department or organization scope applies. The author cannot claim or close their own version. On grant loss, actions stop and an eligible Admin can reassign with a reason and audit. Include the no-eligible-reviewer path. |
| **AC-03** | F4-01–07 / MA-03 | Each role gets only the fields and actions it may use. An active reporter after source-access loss sees only case ID and status. Inactive and foreign members receive safe denial. UI, API, notification links, history, citations and cached evidence follow current access. |
| **AC-04** | F4-02, F4-07 / MA-04 | Case changes and audit events persist together. History is ordered, paginated and audience filtered. Relevant unread updates appear in **My reports** and **Reviews → Maintenance**, open only authorized views, and avoid duplicate delivery. Include author updates when asked to act. |
| **AC-05** | F4-03 / MA-05 | The reviewer starts at the reported version and advances through authorized exact pairs. The current shortcut selects the applicable version. Show **+ Added** and **− Removed**, source links, collapsed unchanged context and a readable mobile layout. Show manual originals when comparison is unavailable and withhold hidden versions and counts. |
| **AC-06** | F4-04–06 / MA-06 | Allowed replies return to the reviewer. **No change needed** uses a human confirmation and reporter explanation. For **Updated** or **Withdrawn**, verify the exact applicable correction or actual applied withdrawal before confirmation. Pending, stale, failed, rejected, unrelated, superseded or upcoming evidence keeps the case open. |
| **AC-07** | F4-04 / MA-07 | The assigned reviewer can select evidence, start one analysis, open valid citations, cancel or retry, and continue manually. No result appears from revoked evidence, a replaced assignee, an expired run or an invalid citation. A newer version offers comparison or explicit rerun, and existing findings retain their source scope. |
| **AC-08** | F4-01–07 / MA-08 | Signed-in web and genuine Electron expose the same applicable journey with Arden UI, visible focus, keyboard operation, permission-safe messages and useful loading, empty, failure and unavailable states. Narrow screens support reading and next actions without trapping focus or hiding version context. |
| **AC-09** | F4-05–07 / MA-09 | Reporting a recurrence creates a linked case on the affected version. Authorized reviewers see permitted linked context. Each case retains its own owner, status, history and confirmed decision. The original resolution stays read-only. |
| **AC-10** | F4-00, F4-01e / MA-10 | At cutover there is one reader report action and an authoritative intake path. Each eligible open report becomes one unassigned **Submitted** case with its original report reference, exact version, reporter, text and time. Authorized governance users see retained dispositions in the read-only **Closed** filter. Supported older clients receive the existing duplicate response while a report is open and can submit the same wording again after closure. Withhold unverifiable rows for authorized review and suppress new-submission alerts for imported cases. |

## Boundaries

- The exact source version, case status, publication status and analysis status are distinct. Publication changes follow Flow 2 and case resolution requires authorized human confirmation.
- Keep public explanations and reviewer rationale separate. Administrator status alone does not confer source or derived evidence access. Counts and activity previews obey the same permissions as details.
- The [intake ADR](../../decisions/0028-maintenance-report-intake.md) owns the cutover decision. Compatibility mechanisms and remaining approvals are tracked in [Architecture](ARCHITECTURE.md).
