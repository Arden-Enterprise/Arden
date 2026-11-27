# 0038: Invitation account routing and direct account setup

Status: accepted
Date: 2026-11-27
Decision owner/approval: requesting project maintainer, who approved the replacement in the task conversation on 2026-11-27 after reviewing the comparison below and its consequences.
Brainstorm originator / record author: requesting project maintainer (originator); record drafted by the implementing coding agent.
Approval evidence and exact source/spec revision: maintainer approval on 2026-11-27 against Arden `main` `b4fcd495847760dc88351f540bf670ce14dfb651` and `staging` `06e2ae0dc945b0bf7e8c19b1bfc2cbef225e785e`. The maintainer accepted the three open points as recommended: a server-only Supabase secret key, the forwarded-link risk, and routing existing unconfirmed accounts to sign-in.
Implementation: partial — API, UI and focused tests on `feat/invitation-direct-account-setup`; live Supabase admin calls and staging configuration are not verified.
Supersedes / superseded by: supersedes the account-nonenumeration and Supabase-only confirmation bullets of [0005](0005-mainflow-1-organization-membership.md) for invitation entry only, and the service-role prohibition of [0001](0001-supabase-and-hybrid-development.md) for the narrow capability described here.

## Context and requirement

The invitation page offered sign-in and account setup on one screen because decision 0005 forbade revealing whether the invited email already had an account. An invited person without an account then created one, waited for a Supabase confirmation email, returned to the invitation and signed in. The maintainer found this flow confusing and asked that the invitation route the person to sign-in or to registration, and that registration through an invitation not send a second confirmation email.

The invitation link is a 256-bit random, single-use, expiring bearer token delivered only to the invited mailbox. Holding it is the same mailbox-control proof that a confirmation link provides.

## Options and tradeoffs

| Aspect | Previous (0005) | Accepted |
| --- | --- | --- |
| Entry screen | One screen with a sign-in/create-account switch | Sign-in when the invited email has an account; registration otherwise |
| Account disclosure | None | Only to a holder of a valid pending invitation token, and only about that invitation's address |
| Registration confirmation | Supabase confirmation email, then sign-in and acceptance | No email; the account is created confirmed, signed in and the invitation accepted in one request |
| Email on registration | Typed by the person, checked client-side | Taken from the invitation server-side; the person cannot choose another |
| Supabase credentials | Publishable key only | Publishable key, plus an optional server-only secret key for two admin calls |

Keeping 0005 with only UI cleanup was considered. It avoids a privileged key but keeps the confirmation round trip the maintainer wanted removed.

## Decision

- `GET /api/v1/invitations/:token` adds `accountStatus: "existing" | "new"` for a valid pending invitation when the server account capability is configured and the lookup succeeds. It omits the field otherwise, and the page falls back to the combined screen.
- `POST /api/v1/invitations/:token/account` with `{ fullName, password }` validates the token, name and password rules and creates a confirmed Supabase account for the invitation's address. It then signs in, sets the normal 24-hour session cookies and accepts the invitation through the existing transaction. An existing account, including an unconfirmed one, returns `409 ACCOUNT_ALREADY_EXISTS` and is never confirmed or changed by this path.
- If acceptance fails after the account is created, the response still signs the person in and reports `accepted: false`. Signing in later accepts the invitation; the token is never used twice.
- The capability uses `SUPABASE_SECRET_KEY` only inside the API's `InvitationAccountAdmin` adapter for the email lookup and confirmed creation. It never reaches clients, logs, responses or other routes. When it is unset, both additions are disabled and the previous combined flow remains.
- Ordinary `/api/v1/auth/sign-up`, recovery and sign-in stay non-enumerating and unchanged.

## Boundaries and consequences

- **Accepted risk:** whoever holds a forwarded or leaked invitation link before it is used can create the account for that address with their own password. The real mailbox owner can recover it through password reset. Expiry, single use, rotation on resend and revocation limit the window.
- **Pre-registration hijacking:** an account registered earlier but never confirmed may carry a password chosen by someone else. This path never confirms an existing account; such an account goes to sign-in, which still requires Supabase confirmation.
- **Enumeration:** no endpoint accepts a free email for lookup. Account setup attempts share the per-address throttle with sign-in failures.
- **Credential scope:** the secret key has full Supabase Auth authority. It belongs in protected runtime secrets alongside other API secrets, and operators rotate it through Supabase if exposed.
- **Supabase sign-up setting:** admin creation is not governed by the Supabase project's "allow new users to sign up" switch or its public sign-up rate limits. Configuring `SUPABASE_SECRET_KEY` is the decision to let valid invitations create accounts; leave it unset to freeze invitation registrations. Only a password-policy rejection is reported as the person's to fix and counted toward the throttle. An unanswered creation call is reported as unconfirmed, so a retry either succeeds or reaches sign-in.
- **Configuration:** staging and production need `SUPABASE_SECRET_KEY` added to the protected environment template and compose mapping before the feature is active. No database migration is required.

## Verification and rollout

Planned: API injection tests for the preview status, absent capability, invalid/expired tokens, existing and unconfirmed accounts, password/name validation, throttling, acceptance, acceptance failure and absence of the secret in responses. Add adapter tests with a stubbed HTTP boundary and UI tests for routing and the fallback. Live Supabase admin behavior and staging configuration require a separate authorized check. Team consultation before shared rollout is recommended and has not been recorded.

## Rules and documentation updates

[0005](0005-mainflow-1-organization-membership.md), [0001](0001-supabase-and-hybrid-development.md), [security and data](../engineering/security-and-data.md), the [technology guide](../engineering/technology-guide.md), [operations](../engineering/operations.md) and the F02 [specification](../product/identity-and-access.md#f02-invitation-account-routing-2026-11-27) reference this record.
