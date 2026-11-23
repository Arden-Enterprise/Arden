# Flow 4 redesign and Ask Arden panel evidence

Date: 22 November 2026, Asia/Saigon. Tracking: ARD-81.
Branch: `feat/knowledge-maintenance-screens`, stacked on
`feat/knowledge-maintenance-cases` from staging `6110929`.

These captures come from a local component harness that renders the committed
Flow 4 and Ask Arden components with fictional data ("Northwind Field Ops",
invented people and documents) and a mocked API. They show layout, states and
responsive behavior. They are not screenshots of a signed-in deployment, and the
harness is not part of this change.

## Screens

| File | Step | Shows |
| --- | --- | --- |
| [f4-01-reader--desktop.png](f4-01-reader--desktop.png) | F4-01 | Reader view of published version 3 with **Report an issue**. |
| [f4-01-report-form--desktop.png](f4-01-report-form--desktop.png) | F4-01 | Report dialog tied to the exact version, with the filled text fields. |
| [f4-01-my-reports--desktop.png](f4-01-my-reports--desktop.png) | F4-01, F4-07 | My reports list with aligned status labels and unread markers. |
| [f4-02-queue--desktop.png](f4-02-queue--desktop.png) | F4-02 | Maintenance queue for an eligible reviewer. |
| [f4-03-compare--desktop.png](f4-03-compare--desktop.png) | F4-03 | Case workspace: version pager with Reported/Current tags and labelled + Added / - Removed rows beside the raised case rail. |
| [f4-04-findings--desktop.png](f4-04-findings--desktop.png) | F4-04 | Findings with run state and exact citations. |
| [f4-05-decision--tall.png](f4-05-decision--tall.png) | F4-05 | No-change decision with reporter explanation and reviewer rationale, plus the Flow 2 publication link field. |
| [f4-07-reporter-outcome--desktop.png](f4-07-reporter-outcome--desktop.png) | F4-07 | Reporter sees the resolved journey and the outcome explanation. |
| [f4-03-compare--phone.png](f4-03-compare--phone.png) | F4-03 | 390 px phone layout of the comparison. |
| [shell-panel-chat--desktop.png](shell-panel-chat--desktop.png) | Shell | Ask Arden agent panel opened from the top-right Arden mark. |
| [shell-panel-chat--phone.png](shell-panel-chat--phone.png) | Shell | The panel as a full sheet on a phone. |
| [worst-case--tall.png](worst-case--tall.png) | F4-03–F4-05 | Worst-case data: a long Vietnamese title and report, an unbroken URL in the report and diff, related cases and an invalid case ID error. |

## Executed checks for this branch

| Check | Observed result |
| --- | --- |
| Workspace typechecks (domain, UI app and tests, API, desktop, web) | Passed on the committed tree. |
| `packages/ui` Vitest | 64 files, 480 tests passed. One existing test, `ArdenShell invitation batch navigation > preserves an unsaved shared draft until workspace switching is confirmed`, timed out at 5 s in 2 of 4 full runs and passed in isolation (about 0.57 s on this branch, 0.55 s on staging). |
| Worst-case data and motion | A worst-case data pass and a motion review in the harness. |

## Not verified

Electron after the redesign, 200% zoom, a screen reader, and a full signed-in
Flow 4 walkthrough on a hosted slot.
