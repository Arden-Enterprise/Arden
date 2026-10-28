# Product contract and non-negotiable direction

Read with [AGENTS.md](../../../AGENTS.md). Current accepted decisions govern; implementation evidence comes from source, manifests and the [technology guide](../technology-guide.md).

1. Arden is private organizational memory and work context, **self-hosted first**. The customer installation is the trust boundary. Optional Arden Cloud comes later, using the same Core.
2. Web and Windows desktop share product behavior and feature UI. Linux desktop is later; Ubuntu 24.04 is the server target.
3. The server is authoritative for shared data, permissions, governance, indexing, and AI. Self-hosted does **not** mean a complete offline-first sync implementation.
4. Personal knowledge is private by default. Contribution creates an explicit separate copy; the private original remains private.
5. Shared Arden knowledge requires review of an immutable snapshot. The working draft may keep changing independently. The accepted classifications are `INTERNAL`, `CONFIDENTIAL` and `RESTRICTED`; classification is distinct from audience. Under [decision 0011](../../decisions/0011-permission-aware-publication-and-semantic-documents.md), review outcomes are `APPROVE` or `REJECT`; final approval starts preparation of that exact snapshot, and only index-ready atomic activation makes it current. There is no manual publisher action. Visibility and official status are different properties.
6. External Jira/GitHub context keeps source provenance and its permitted audience. A connector token is not permission for every Arden user.
7. My Work is the established-user entry screen under the newer `knowledge.md` in the SEP490 workspace. A future knowledge graph opens a Knowledge Pane for selected nodes; writing has a dedicated editor and AI has an inspectable context basket.
8. AI uses authorized evidence, exact-version citations, and visible uncertainty. It cannot silently publish, administer access, or write externally.
9. No mandatory Arden-operated service, telemetry, model endpoint, licensing call-home, or update dependency may be introduced without an explicit accepted product decision.
10. Do not claim end-to-end encryption against customer root/database administrators, guaranteed offline revocation, high availability, air-gap readiness, or production readiness without an implemented and tested design.

The blueprint's unresolved choices remain unresolved: supported Windows/hardware matrix, source audience mapping, private-data recovery, RPO/RTO/retention, contractual air-gap support, standalone personal spaces, and connector editions/authentication. Record a decision before locking these into behavior or promises.
