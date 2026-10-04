# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

People in an organization who need to capture, find, connect, and verify knowledge while doing their work. Reviewers and publishers govern what becomes official shared guidance; administrators manage the customer installation and access.

## Product Purpose

Arden is a private organizational memory and work-context system. It brings notes, published knowledge, and selected external work sources into a navigable, permission-filtered graph. Its AI assistant is intended to answer from material the person may access, with sources and uncertainty visible.

## Positioning

Self-hosted first: a customer controls Arden Core, its data, backups, connectors, and model endpoint. Personal knowledge stays private by default. Shared official guidance passes through human review and explicit publication. External source-owned information remains labeled as such.

## Operating Context

- Web and Windows desktop clients share the same product interface; Linux desktop packaging is later.
- The planned home screen is a permission-filtered graph. A left navigation opens Graph, My Work, Intake/Sources, Reviews, and Administration. Selecting a node opens a Knowledge Pane. A full editor supports sustained writing. The Arden Agent can use an explicit context basket. The current frontend preview opens My Work; the graph home is future scope.
- Developers run isolated local stacks. Staging and production are separate deployments on customer-controlled Ubuntu infrastructure using Coolify. The team's pilot allocation is 4 vCPU, 12 GB RAM, and 100 GB disk, with private AI on another customer-controlled machine.

## Capabilities and Constraints

- Personal notes, governed Arden knowledge, and external work context have different ownership, visibility, and authority.
- The server is authoritative for shared knowledge, permissions, review, indexing, and AI. The first desktop release is not fully offline-first.
- Graph results, search, citations, and AI context must be permission-filtered. AI may propose work, but may not silently publish or send data to external systems.
- The current repository is a frontend preview on a foundation scaffold. Shared web/Electron screens include session-memory private-note drafts, organization setup, invitations, acceptance, pending membership, department/role assignment and access readiness. Knowledge editing, immutable review snapshots, explicit sample publication and handover demonstrate local transitions; Ask Arden displays a prerecorded sample answer. Real authentication, server authorization/governance, durable notes, email delivery, audit events, connectors, live graph and AI inference are not implemented. Demonstration content must remain plainly labeled and isolated from real organization data.
- The chosen architecture and remaining product decisions are detailed in [ARDEN_BLUEPRINT.md](ARDEN_BLUEPRINT.md). Standalone personal-only accounts and full offline synchronization remain open decisions.

## Brand Commitments

- Product name: Arden.
- The user specified warm white `#F4F3EF`, mist `#D4D5D5`, stone grey `#929698` and charcoal `#242628`, then approved the more expressive Living Archive direction in Figma. Dark surfaces remain dominant, with amber actions, jade success/connections, blue source context and muted red errors. Headings use Sora and body text uses DM Sans, both bundled locally. Edges should feel square but soft. Semantic roles, responsive behavior and contrast rules live in [DESIGN.md](DESIGN.md).
- The monochrome wordmark files in `brand/wordmark-exploration/` are explorations, not an approved final logo.

## Evidence on Hand

- [ARDEN_BLUEPRINT.md](ARDEN_BLUEPRINT.md) records the agreed product direction, architecture, and boundaries. It is a proposed plan, not evidence of shipped features.
- The repository has a shared React UI shell used by the web and Electron clients. It contains no customer data or live knowledge graph.
- [Mainflow 1 preview](docs/engineering/mainflow-1-preview.md) records the implemented UI journey and sample-only assumptions. Accepting an invitation creates a pending membership; an administrator subsequently confirms its primary department, one of three fixed preview roles and role scope. These client transitions are not production authorization or a decision that replaces the blueprint's unresolved identity and role policy.

## Product Principles

1. Customer-controlled by default, with no mandatory Arden-operated infrastructure.
2. Make information ownership, visibility, provenance, and official status legible.
3. Show useful connected context without leaking inaccessible information.
4. Keep AI grounded, inspectable, and subordinate to human decisions.
