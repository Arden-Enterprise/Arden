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
- The graph is the home screen. A left navigation opens Graph, My Work, Intake/Sources, Reviews, and Administration. Selecting a node opens a Knowledge Pane. A full editor supports sustained writing. The Arden Agent can use an explicit context basket.
- Developers may run isolated local stacks or local frontends against four hosted development APIs/databases. Staging and production use separate release deployments and database instances. Full Supabase service placement and capacity must be measured before provisioning; the earlier pilot hardware target is not a verified allocation. Private AI remains on a separate customer-controlled machine. See [hybrid development](docs/engineering/remote-development.md).

## Capabilities and Constraints

- Personal notes, governed Arden knowledge, and external work context have different ownership, visibility, and authority.
- The server is authoritative for shared knowledge, permissions, review, indexing, and AI. The first desktop release is not fully offline-first.
- Graph results, search, citations, and AI context must be permission-filtered. AI may propose work, but may not silently publish or send data to external systems.
- The current repository is a foundation scaffold. Authentication, live graph data, review, editing, connectors, and AI are not implemented yet. Any demonstration content in the interface must be plainly labeled as sample data.
- The chosen architecture and remaining product decisions are detailed in [ARDEN_BLUEPRINT.md](ARDEN_BLUEPRINT.md). Standalone personal-only accounts and full offline synchronization remain open decisions.

## Brand Commitments

- Product name: Arden.
- The user specified warm white `#F4F3EF`, mist `#D4D5D5`, stone grey `#929698`, charcoal `#242628`, and a black/grey/white visual family. Edges should feel square but soft.
- The monochrome wordmark files in `brand/wordmark-exploration/` are explorations, not an approved final logo.

## Evidence on Hand

- [ARDEN_BLUEPRINT.md](ARDEN_BLUEPRINT.md) records the agreed product direction, architecture, and boundaries. It is a proposed plan, not evidence of shipped features.
- The repository has a shared React UI shell used by the web and Electron clients. It contains no customer data or live knowledge graph.

## Product Principles

1. Customer-controlled by default, with no mandatory Arden-operated infrastructure.
2. Make information ownership, visibility, provenance, and official status legible.
3. Show useful connected context without leaking inaccessible information.
4. Keep AI grounded, inspectable, and subordinate to human decisions.
