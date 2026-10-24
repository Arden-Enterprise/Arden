# Quality and maintainability metrics

Measure the codebase and the team's delivery process, not individual contributors. These are initial Arden review thresholds, not claims about industry averages. Collect a baseline during the first four weeks with application code, review the trends monthly, and revise thresholds when they encourage splitting for its own sake or hiding risk. Do not collapse the measures into one score.

Current metric values are **not collected**. Plans, scaffolds, and documentation are not a shipped-product baseline. Application-code PRs must select tools for the relevant measures and publish results in CI; until then reviewers use the same definitions manually where possible.

## Maintainability scorecard

| Measure | Definition and source | Initial threshold | Response when exceeded |
| --- | --- | --- | --- |
| PR change size | Added plus deleted, non-generated source lines per merged PR, from the GitHub diff. Report the 75th percentile monthly; exclude generated files and lockfiles, but show them separately. | P75 at or below 400 lines. | Split an independent part, or explain why the larger atomic change is safer. |
| PR commit count | Commits reachable from the PR head but not its intended base. Record when ready and after fixes; report P75 monthly. | Follow the normal target and ceiling in [Git workflow](rules/git-workflow.md#reviewable-pr-size). | Split independent work or record the required exception; preserve coherent units and authorized history. |
| PR file count | Unique changed paths in the merge-base diff, including renames/deletions; report authored and total counts separately, plus monthly P75. | Follow the authored-file target and total-file ceiling in [Git workflow](rules/git-workflow.md#reviewable-pr-size). | Split independent concerns; identify generated/lockfile changes and coverage gaps. |
| Review efficiency | Review-triggering push batches, completed AI runs, and avoidably superseded runs per PR, from available reviewer results/dashboards. Report unknown values honestly. | Zero avoidably superseded runs; establish a baseline for other counts. | Batch related fixes, wait for running reviews, and inspect trigger settings without changing budgets silently. |
| Reviewer capacity fit | Requested AI reviews with documented file/commit counting basis, applicable diff/context limits, quota/budget availability, unknown limits, and final coverage. Keep private account values outside public reports. | 100% of requested reviewers have a [fit check](rules/git-workflow.md#fit-the-enabled-reviewers); comply with every known limit and label unknowns. | Split, wait, or document approved alternative coverage; a local size exception cannot override vendor limits. |
| New complex functions | Count changed functions with cognitive complexity above 15, measured by the selected language analyzer. | Zero unexplained exceedances. | Simplify control flow or explain the domain reason and add focused verification. |
| New duplication | Duplicated lines in added source divided by added source lines, measured by the selected analyzer; exclude generated code. | At or below 3% monthly. | Extract a shared rule when the duplication represents the same behavior; keep independent code when coupling would be worse. |
| Changed-code coverage | Covered changed executable business-logic lines divided by changed executable business-logic lines, measured in CI. Exclude generated code and document any other exclusion in the PR. | At least 80% on a PR with changed business logic. | Explain the gap and add behavior-focused verification. Coverage alone never proves correctness. |
| Access-control evidence | PRs changing membership, permissions, publication, search, retrieval, or external writes that include allowed and denied scenarios. | 100% of such PRs. | Block review completion until the scenarios are documented and verified. |
| New high/critical findings | New unresolved high or critical security findings in selected scanners, plus high-impact maintainability findings where the analyzer supports severity. | Zero at release. | Fix before release or record an owner, expiry, and explicit risk acceptance. |
| Review response | Business time from a ready-for-review PR to first substantive AI review, or a human review when explicitly requested, from GitHub timestamps. Track the median monthly and report unavailable/rate-limited runs separately. | Within two business days for requested reviews; this is a process target, not a mandatory human-review gate. | Adjust reviewer capacity/ownership or reduce PR size; do not label a skipped run reviewed. |

The numeric complexity, duplication, coverage, and PR-size values are local starting points. They are review triggers, except for access-control evidence and release security findings. A reviewer may accept an explained exception; record it in the PR so the monthly review can find recurring causes. [Sonar's metric definitions](https://docs.sonarsource.com/sonarqube-server/user-guide/code-metrics/metrics-definition) explain cognitive complexity, duplication, and changed-code measures; the tool chosen for Arden must document its exact calculation.

## After the first deployment

Track [DORA's delivery metrics](https://dora.dev/guides/dora-metrics/) monthly for the service: change lead time (commit to production), deployment frequency, change fail rate, failed deployment recovery time, and deployment rework rate. Record the deployment and incident timestamps used for each calculation. Establish a baseline before setting targets; use the measures together to find bottlenecks and regressions.

Also record escaped defects reported within 30 days of release, with severity and affected workflow. Any cross-organization or private-knowledge exposure is treated as a security incident regardless of the monthly rate. Review these outcomes alongside the maintainability scorecard so faster merges do not hide reliability problems.

The technical lead owns the monthly review with the team. Record the period, source data, exclusions, trend, and one action for any worsening measure. Link the review from the team's planning issue or engineering notes.
