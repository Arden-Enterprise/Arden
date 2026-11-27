# Arden product flows

Baseline checked 2026-11-20. The local Flow 4 candidate on staging `4df192d` passed the disposable staging upgrade and one signed-in Web/Electron case walkthrough. The opt-in provider passed its separate synthetic live check. Shared release remains pending. The [Flow 4 step catalog](flow-4-sequences.md) records the current source and evidence.

| Flow | Role in the lifecycle | Owning material |
| --- | --- | --- |
| 1. Organization and access | Supplies membership, document access, reviewer grants and reassignment authority. | [Identity and access](../identity-and-access.md) |
| 2. Contribution and publication | Reviews, indexes, activates, replaces and withdraws official documents. | [Knowledge lifecycle](../knowledge-lifecycle.md), [review and publication contract](../../engineering/mainflow-2-workflow.md) |
| 3. Discovery and retrieval | Opens an authorized exact document version from Home, Knowledge Graph, search or a citation, and renders governed modular Ask Arden surfaces. | [Discovery and AI](../graph-ai-and-work.md), [Graph and Modular Agent diagrams and local evidence](flow-3-graph-and-agent.md), [Graph & Agent Capability Map](../../features/graph-and-agent-ui/CAPABILITY-MAP.md), [reader AI contract](https://github.com/Arden-Enterprise/Arden/blob/0eae5b8/docs/engineering/reader-ai.md) |
| 4. Knowledge maintenance | Tracks post-publication issues and human resolution. | [Specification](flow-4-maintenance.md), [sequenced diagrams](flow-4-sequences.md), [Implementation status](../../features/knowledge-maintenance/STATUS.md), [glossary](../../../GLOSSARY.md) |

```mermaid
flowchart LR
    A["Flow 1 · Current membership and reviewer grants"] --> B["Flow 2 · Publish a reviewed version"]
    A --> C["Flow 3 · Open an authorized version"]
    A --> D["Flow 4 · Route, claim, and resolve a case"]
    B --> C
    C -->|"Report an issue · F4-01"| D
    B -->|"Existing governance reports at cutover · F4-00a"| D
    D -->|"F4-05 · Submit replacement or withdrawal request"| B
    B -->|"Effective replacement or applied withdrawal · F4-06"| D
```

Update affected step IDs, diagrams, and step catalog when a flow, service boundary, permission, state transition or handoff changes. Status and source revision belong with each flow. Keep historical descriptions readable and dated.
