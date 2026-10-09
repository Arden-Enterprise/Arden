# 0004: Role-tagged audiences for published content

Status: accepted  
Date: 2026-10-05  
Decision owner/approval: task owner confirmed that Org Admins create and assign roles and that one matching role is sufficient for access  
Implementation: not started for shared-content audiences; current role/permission tables are used only by the first owner-private note slice  
Supersedes / superseded by: none

## Context and requirement

Mainflow 1 is focused on organization creation, invitations, membership, departments, roles, and permissions. Arden also needs a clear visibility rule for future published content and permission-filtered search. The product already requires private originals to remain private, contribution to create a separate copy, and publication to follow explicit review/approval.

## Options and tradeoffs

- **Role audience with any-match semantics:** a member who has at least one audience role can access the published item. This is simple to explain and supports users assigned to multiple groups, but every additional role may broaden access and role changes need immediate authorization/cache handling.
- **Require all listed roles:** narrows access but is difficult to administer and behaves unexpectedly when a user or item has several roles.
- **Copy full Discord permission overwrites:** offers detailed allow/deny precedence and role hierarchies, but expands policy complexity beyond the current product need and increases the chance of hidden access combinations.

## Decision

- Org Admins manage organization members, departments, and organization-scoped custom roles. Custom roles are created within an organization and assigned to that organization's memberships.
- A published item's audience may contain one or more roles. A member can view it if their active membership has **at least one** matching active assigned role; matching is OR/any-match, not all-match.
- An absent, empty, malformed, or unknown audience grants no access. The API does not infer organization-wide visibility from missing role tags.
- The same role-audience grant permits viewing the published item, including retrieval by authorized search/RAG, and submitting a contribution as a separate copy of the visible published version.
- A contribution does not mutate the source publication and does not become published automatically. It follows the separate review and explicit publication policy.
- Org Admin authority to manage memberships, departments, and roles is separate from content audience. Org Admin status alone does not reveal content or another member's private notes.
- Private originals remain owner-only and are excluded from shared-organization search/RAG. Role audiences apply to published shared content, not private drafts.
- This decision does not select detailed role assignment scopes, invitation expiry/email delivery, or initial organization bootstrap behavior. Mainflow 1 establishes organization-scoped roles and assignments; published-content search/contribution enforcement remains later implementation work.

## Boundaries and consequences

Role creation/assignment, audience checks, search candidate selection, citation resolution, and contribution submission must use current server-verified membership and role state. Do not accept role IDs as proof of access from the client. Select authorized published versions before text/vector retrieval and model-context construction; recheck the version and audience before returning results, citations, or performing a contribution action. Role removal, membership suspension, unpublishing, or audience changes must block subsequent access before derived-index cleanup completes.

The `Org Admin` management capability must not be a user-created audience tag that can be deleted or casually granted. The private-workspace owner boundary remains unchanged. This is not a decision to implement Discord-style permission precedence, role hierarchy, private-note sharing, or automatic publication.

## Verification and rollout

No shared-content audience or role-tagged RAG implementation exists yet. When implemented, tests must cover: one matching role allows access; no matching role denies without exposing titles/counts/snippets; multiple roles use any-match semantics; role/membership revocation blocks later search and contribution; private originals remain owner-only; contributions copy the exact visible published version; and the copy cannot alter or publish the source.

## Rules and documentation updates

- [Architecture blueprint](../../ARDEN_BLUEPRINT.md)
- [Product](../../PRODUCT.md)
- [Security and data rules](../engineering/security-and-data.md)
- [First-slice permission and API contract](../engineering/first-slice-permission-and-api-contracts.md)
- [Mainflow 1 preview](../engineering/mainflow-1-preview.md)

## References

- [PostgreSQL row security](https://www.postgresql.org/docs/17/ddl-rowsecurity.html)
