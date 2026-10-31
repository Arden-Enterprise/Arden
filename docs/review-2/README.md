# Review 2 documentation package (SEP490 · GFA26SE43)

This folder holds the documents submitted for Review 2 of the capstone project
*AI-powered Enterprise Knowledge Platform with Human-in-the-Loop Governance and
Permission-aware Retrieval* (Arden), so that a coding agent can review them
against the source code at tag `review-2`.

Baseline: Arden `staging` at commit `e9e4b3a` (31 October 2026) and Arden-AI
`main` at commit `cc0b4d2`. All documents contain synthetic data only.

## Contents

| Path | Document |
| --- | --- |
| `registration/GFA26SE43_Registration_Form_v2.0.(docx\|pdf)` | Registration form, version 2.0: the proposed final version and the scope baseline |
| `reports/GFA26SE43_Report3_Software_Requirement_Specification.(docx\|pdf)` | Report 3, SRS |
| `reports/GFA26SE43_Report4_Software_Design_Document.(docx\|pdf)` | Report 4, SDD (architecture, package, ERD, class, sequence, activity and state machine diagrams; technology declaration) |
| `reports/GFA26SE43_Report5_Test_Documentation.(docx\|pdf)` | Report 5, test documentation |
| `reports/GFA26SE43_Report5_Test_Report.xlsx`, `reports/GFA26SE43_Report5_Unit_Test.xlsx` | Report 5 test report and unit-test workbook |
| `diagrams/*.mmd` | Mermaid sources of the Report 4 diagrams |
| `../../Arden_PostgreSQL_Schema.sql` | Database script: the schema produced by migrations `0001`–`0023` |

The PDF is the reference rendering of each Word document.

## Diagram sources

| Report 4 figure | Source |
| --- | --- |
| Logical ERD (complete; Figures D-01 to D-05 show parts of it) | `diagrams/logical-erd.mmd` |
| M-01 Organization Invitation State Machine | `diagrams/state-m01-organization-invitation.mmd` |
| M-02 Organization Membership State Machine | `diagrams/state-m02-organization-membership.mmd` |
| M-03 Knowledge Submission State Machine | `diagrams/state-m03-knowledge-submission.mmd` |
| M-04 Knowledge Index Generation State Machine | `diagrams/state-m04-knowledge-index-generation.mmd` |

Other figure sources (architecture A-, package P-, ERD D-, class C-,
sequence S- and activity U-) are listed in the table below as they are added.

<!-- Codex: append one row per added figure source: | <Figure ID and title> | `diagrams/<file>.mmd` | -->

## Database script

`Arden_PostgreSQL_Schema.sql` is generated, not written by hand. Migrations
`apps/api/migrations/0001`–`0023` are applied in order to an empty PostgreSQL
database, which is then exported with `pg_dump --schema-only --no-owner`. It
contains 35 tables, 34 functions, 32 triggers and 81 row-level-security
policies. After any migration change, regenerate the script and
`diagrams/logical-erd.mmd` together.
