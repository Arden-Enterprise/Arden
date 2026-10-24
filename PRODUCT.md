# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

People in an organization who need to capture, find, connect, and verify knowledge while doing their work. Reviewers govern what becomes official shared guidance; the system publishes the approved snapshot automatically. Administrators manage the customer installation and access.

## Product Purpose

Arden is a private organizational memory and work-context system. It brings notes, published knowledge, and selected external work sources into a navigable, permission-filtered graph. Its AI assistant is intended to answer from material the person may access, with sources and uncertainty visible.

## Positioning

Self-hosted first: a customer controls Arden Core, its data, backups, connectors, and model endpoint. Personal knowledge stays private by default. Shared official guidance passes through human review, then the system publishes the approved snapshot automatically. External source-owned information remains labeled as such.

## Operating Context

- Web and Windows desktop clients share the same product interface; Linux desktop packaging is later.
- The planned home screen is a permission-filtered graph. A left navigation opens Graph, My Work, Intake/Sources, Reviews, and Administration. Selecting a node opens a Knowledge Pane. A full editor supports sustained writing. The Arden Agent can use an explicit context basket. The current frontend preview opens My Work; the graph home is future scope.
- Developers run isolated local stacks. Staging and production are separate deployments on customer-controlled Ubuntu infrastructure using Coolify. The team's pilot allocation is 4 vCPU, 12 GB RAM, and 100 GB disk, with private AI on another customer-controlled machine.

## Capabilities and Constraints

- Personal notes, governed Arden knowledge, and external work context have different ownership, visibility, and authority.
- Published readership is audience-based, not role-based. Arden manages organization-wide and department-wide audiences; Org Admins may manage explicit audience groups. Authors may target only audiences they currently belong to within the selected Organization/Department scope. Audience membership grants read/search/contribution-copy access to matching published knowledge only; it grants no administration, review, edit, or publish capability.
- Arden System Admin is an installation-level capability for the Arden operations team. It is not an organization membership and does not grant document, private-workspace, review, or impersonation access. Organization Admin remains separate. See [decision 0010](docs/decisions/0010-audiences-and-system-administration.md).
- Review has only Approve and Reject. Final approval moves the exact snapshot into publication preparation; search and AI see it only after index-ready atomic activation. There is no human publisher role. See [decision 0011](docs/decisions/0011-permission-aware-publication-and-semantic-documents.md).
- Knowledge classification has three accepted levels: `INTERNAL`, `CONFIDENTIAL` and `RESTRICTED`. Classification is distinct from the publication audience. Restricted knowledge requires a suitably authorized specialist or senior reviewer and must not be published to an audience the access controls cannot safely enforce. See [the classification decision](docs/decisions/0008-three-level-knowledge-classification.md).
- The server is authoritative for shared knowledge, permissions, review, indexing, and AI. The first desktop release is not fully offline-first.
- Graph results, search, citations, and AI context must be permission-filtered. AI may propose work, but may not silently publish or send data to external systems.
- The current repository includes authenticated organization, invitation, owner-private notes, shared-draft, submission, ReviewerGrant, review-to-preparation, audience-group, and installation-administration API slices. Approval now creates a `PREPARING` release candidate; activation waits for the Mainflow 3 index pipeline. Migration 0017 adds canonical audiences and Arden System Admin data while retaining legacy role-backed storage only as a temporary compatibility projection. Real-PostgreSQL/RLS rehearsal for the latest migrations remains required before deployment. Ask Arden has a labelled interface preview only; retrieval, generation, live citations, connectors, and the live graph remain deferred.
- The chosen architecture and remaining product decisions are detailed in [ARDEN_BLUEPRINT.md](ARDEN_BLUEPRINT.md). Standalone personal-only accounts and full offline synchronization remain open decisions.

## Brand Commitments

- Product name: Arden.
- The user specified warm white `#F4F3EF`, mist `#D4D5D5`, stone grey `#929698` and charcoal `#242628`, then approved the more expressive Living Archive direction in Figma. Dark surfaces remain dominant, with amber actions, jade success/connections, blue source context and muted red errors. Headings use Sora and body text uses DM Sans, both bundled locally. Edges should feel square but soft. On 23 October 2026 the user accepted the Island system for the signed-in workspace: graphite tones, one violet accent, Inter/Inter Tight and floating, morphing islands; authentication/onboarding keep the Living Archive look. Semantic roles, responsive behavior and contrast rules live in [DESIGN.md](DESIGN.md).
- The monochrome wordmark files in `brand/wordmark-exploration/` are explorations, not an approved final logo.

## Evidence on Hand

- [ARDEN_BLUEPRINT.md](ARDEN_BLUEPRINT.md) records the agreed product direction, architecture, and boundaries. It is a proposed plan, not evidence of shipped features.
- The repository has a shared React UI shell used by the web and Electron clients. It contains no customer data or live knowledge graph.
- [Mainflow 1 preview](docs/engineering/mainflow-1-preview.md) records a sample-only journey. Its older three-role model is superseded: the preview now distinguishes Member from Organization Admin, while ReviewerGrant and Arden System Admin are separate server capabilities. These client transitions are not production authorization.

## Product Principles

1. Customer-controlled by default, with no mandatory Arden-operated infrastructure.
2. Make information ownership, visibility, provenance, and official status legible.
3. Show useful connected context without leaking inaccessible information.
4. Keep AI grounded, inspectable, and subordinate to human decisions.
