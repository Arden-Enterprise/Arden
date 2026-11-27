import type { HydratedDocumentSummary, SurfaceAction } from "@arden/domain";
import type { GraphIntent } from "../../graph/intent-bus";

type ReaderAnchor = Pick<Extract<SurfaceAction, { kind: "open_reader" }>, "blockId" | "page">;

type SurfaceActionDestination = {
  graph: (intent: GraphIntent) => void;
  pin: (documents: readonly HydratedDocumentSummary[]) => void;
  reader: (document: HydratedDocumentSummary, anchor: ReaderAnchor) => void;
  report: (document: HydratedDocumentSummary) => void;
  maintenance: (document: HydratedDocumentSummary) => void;
  renewal: (document: HydratedDocumentSummary) => void;
  prefill: (prompt: string) => void;
  unavailable: () => void;
};

/** A rendered action can only navigate, change local scope or prefill a question. */
export function dispatchSurfaceAction(action: SurfaceAction, documents: readonly HydratedDocumentSummary[],
  destination: SurfaceActionDestination): void {
  if (action.kind === "prompt_chip") {
    destination.prefill(action.prompt);
    return;
  }
  if (action.kind === "graph_action") {
    switch (action.action.op) {
      case "focus_nodes":
      case "pin_to_context": {
        const documentIds = action.action.documentIds;
        const selected = documents.filter((doc) => documentIds.includes(doc.documentId)
          && doc.openTarget === "READER" && doc.validityStatus !== "Expired");
        if (new Set(selected.map((doc) => doc.documentId)).size !== documentIds.length) {
          destination.unavailable();
        } else if (action.action.op === "pin_to_context") {
          destination.pin(selected);
        } else {
          destination.graph({ type: "focus_nodes", documentIds });
        }
        return;
      }
      case "apply_filter": {
        const { op: _op, ...filters } = action.action;
        destination.graph({ type: "apply_filter", ...filters });
        return;
      }
      case "isolate_branch":
        destination.graph({ type: "isolate_branch", branchKind: action.action.branchKind, branchId: action.action.branchId });
        return;
      case "toggle_links":
        destination.graph({ type: "toggle_links", enabled: action.action.enabled, relationshipTypes: action.action.relationshipTypes });
        return;
    }
  }

  const document = documents.find((doc) => doc.publishedVersionId === action.publishedVersionId
    && doc.documentId === action.documentId);
  if (!document) {
    destination.unavailable();
    return;
  }
  if (action.kind === "open_reader") {
    destination.reader(document, { blockId: action.blockId, page: action.page });
    return;
  }
  if (action.handoff === "report_issue" && document.canReportIssue) destination.report(document);
  else if (action.handoff === "open_maintenance_case" && document.canOpenMaintenance) destination.maintenance(document);
  else if (action.handoff === "open_renewal" && document.canRenew) destination.renewal(document);
  else destination.unavailable();
}
