# 0005: Mainflow 1 organization, membership, and invitation rules

Status: accepted  
Date: 2026-10-05  
Decision owner/approval: task owner confirmed the organization creation, invitation, department, and role direction  
Implementation: partial; organization bootstrap, administration reads, department/custom-role creation and assignment, SMTP invitation lifecycle, and generic invitation acceptance are implemented in code; migration 0002 and live integration remain unverified  
Supersedes / superseded by: none

## Context and requirement

Mainflow 1 establishes organization ownership, departments, member invitations, and role assignments. The UI preview currently uses in-memory fixtures and fixed role names; it is not production authorization.

## Decision

- Any authenticated member may create an organization. The creating account becomes its initial Org Admin.
- Org Admins manage their organization's members, departments, and roles. Org Admin is a protected management capability, separate from user-created content-audience roles; an Org Admin role tag alone never opens private content.
- Each organization department has one default role. A member has one primary department in this flow and receives that department's default role. Org Admins may additionally create organization-scoped custom roles and assign them to members.
- Custom roles are organization-local. A role grant is server-authoritative and immediately affects future requests. Published-content audience matching is separately specified in [decision 0004](0004-role-tagged-published-audiences.md).
- Invitations are addressed to email. The email contains an opaque, expiring, single-use invitation link. Existing account holders sign in; people without accounts can create one through the invitation page. The page does not reveal whether an email has a Supabase account. A membership is created only after authentication, verified-email equality, and explicit acceptance.
- Invitation email is sent through a configurable third-party SMTP service. Credentials are runtime secrets, not source or client configuration. SMTP delivery errors must not report a successful invitation; the persisted invitation remains retryable/revocable under a controlled retry action.
- Supabase Auth continues to own passwords, confirmation, and sessions. Arden owns invitation tokens, membership, department and role policy.

## Boundaries and consequences

Organization identifiers, department/role IDs, membership IDs, and email input do not establish authority. The server derives the actor from the Supabase session and checks Org Admin capability for each administrative action. Token values are random bearer secrets stored only as a cryptographic hash; responses and logs never contain the raw token except in the delivery message. Email/account existence is not disclosed to an unauthenticated visitor.

Role assignment changes must be audited and take effect before subsequent content/search/RAG requests. A department default role is managed with the department lifecycle and cannot be removed while it is the department default. A member's primary department change replaces its default role assignment while preserving independently assigned custom roles.

The third-party SMTP provider remains configurable; this decision does not bind the product to Gmail or another vendor. Supabase's email confirmation delivery must use the team's configured Auth SMTP setup as well.

## Verification and rollout

Tests must cover organization creator promotion, non-admin denials, cross-organization isolation, department/default-role consistency, additive custom-role assignments, invitation token hashing/expiry/revocation/replay, verified-email matching, account-nonenumerating responses, SMTP failure handling, and audit records. Real PostgreSQL/RLS behavior and live Supabase Auth/mail delivery require isolated integration environments.

## Rules and documentation updates

- [Product](../../PRODUCT.md)
- [Architecture blueprint](../../ARDEN_BLUEPRINT.md)
- [Security and data rules](../engineering/security-and-data.md)
- [Technology guide](../engineering/technology-guide.md)
- [Operations guide](../engineering/operations.md)
- [Mainflow 1 preview](../engineering/mainflow-1-preview.md)

## References

- [Supabase sign-up](https://supabase.com/docs/reference/javascript/auth-signup)
- [Supabase email templates](https://supabase.com/docs/guides/auth/auth-email-templates)
- [Nodemailer SMTP transport](https://nodemailer.com/smtp)
