# Flow coverage seed

`flow-cases.json` names the fixture accounts and every sign-in, document, and maintenance state. `flow-coverage.mjs` creates the states the running API can store. A route that is not on that API is recorded as `skipped`. Google sign-in and password recovery stay `manual`.

Run it from this Arden checkout while the local API is reachable at `http://127.0.0.1:5180` (or `http://127.0.0.1:3001` if 5180 is down):

```powershell
$env:ARDEN_SEED_PASSWORD = "<shared fixture password>"
node tools/seed/flow-coverage.mjs
```

The password is read only from that environment variable. It is not written into this repository. Run the script again and it keeps the existing records. A pending invitation is not sent a second time.

The fixture accounts use one shared password:

| Account | Email |
| --- | --- |
| System Admin | `local-system-admin@example.test` |
| Organization Admin | `local-org-admin@example.test` |
| Department member | `local-department-member@example.test` |
| Department reviewer | `local-department-reviewer@example.test` |
| Organization reviewer | `local-organization-reviewer@example.test` |

The organization admin creates **Arden Flow Practice** if that admin does not already belong to it. Local Role Practice, Zack, and any other existing organization are left in place.

Sign in as `local-org-admin@example.test` and choose **Arden Flow Practice**. The same choice is on **Choose your workspace** after sign-in.

Library examples:

- `Desk draft without an audience` — internal, not ready
- `Ready workplace draft` — internal, ready, not submitted
- `Pending workplace submission` — internal, awaiting review
- `Rejected confidential submission` — confidential, rejected with a comment
- `Withdrawn workplace submission` — only when the API has a withdraw route
- `Current workplace policy` — internal, approved
- `Current restricted handling rule` — restricted, approved

Approval can leave publication at `PREPARING` until the knowledge indexer finishes. Until then those titles do not appear in the library, and reader summary, document questions, change requests, and maintenance cases have no current publication to attach to. The script records that. It does not write publication rows directly.

These paths are listed and not created, because the API cannot store them from this script:

- Google sign-in and the Google consent screen
- A password-recovery email
- A publication that failed indexing

Flow 4 maintenance cases (intake, claim, reassignment, and no-change resolution) are created only when the live API exposes `/api/v1/organizations/:organizationId/knowledge/maintenance/cases`. If port 3001 is not that API, those cases are `skipped`.
