import { useEffect, useMemo, useState } from "react";
import { CONTEXT_BASKET_MAX_DOCUMENTS, type GraphDocumentNode } from "@arden/domain";

export type ContextDocument = Pick<GraphDocumentNode, "title"> & {
  documentId: string;
  ownerDepartmentName: string;
};

export type ContextBasketEntry = {
  id: string;
  branchLabel?: string;
  documents: readonly ContextDocument[];
};

type BasketState = {
  workspace: string | null;
  entries: readonly ContextBasketEntry[];
  notice: string;
};

const emptyEntries: readonly ContextBasketEntry[] = [];

export function canPinGraphDocument(doc: GraphDocumentNode): boolean {
  return doc.openTarget === "READER" && doc.validityStatus !== "Expired";
}

function retainDocuments(entries: readonly ContextBasketEntry[], keep: (document: ContextDocument) => boolean) {
  return entries.flatMap((entry) => {
    const documents = entry.documents.filter(keep);
    return documents.length > 0 ? [{ ...entry, documents }] : [];
  });
}

export function useContextBasket(workspace: string | null) {
  const [state, setState] = useState<BasketState>({ workspace, entries: emptyEntries, notice: "" });
  const entries = state.workspace === workspace ? state.entries : emptyEntries;
  const documentIds = useMemo(() => new Set(entries.flatMap((entry) => entry.documents.map((doc) => doc.documentId))), [entries]);

  useEffect(() => {
    setState({ workspace, entries: emptyEntries, notice: "" });
  }, [workspace]);

  const pin = (documents: readonly ContextDocument[], branchLabel?: string) => {
    const unique = new Map(documents.map((document) => [document.documentId, document]));
    const added = [...unique.values()].filter((document) => !documentIds.has(document.documentId));
    if (documentIds.size + added.length > CONTEXT_BASKET_MAX_DOCUMENTS) return { kind: "limit" } as const;
    if (added.length === 0) return { kind: "unchanged" } as const;
    const id = crypto.randomUUID();
    const entry: ContextBasketEntry = { id, branchLabel, documents: branchLabel ? [...unique.values()] : added };
    setState({ workspace, entries: [...entries, entry], notice: "" });
    return { kind: "added", id, count: documentIds.size + added.length } as const;
  };

  const removeEntry = (id: string) => {
    setState((current) => current.workspace === workspace
      ? { ...current, entries: current.entries.filter((entry) => entry.id !== id), notice: "" }
      : current);
  };
  const removeDocument = (id: string) => {
    setState((current) => current.workspace === workspace
      ? { ...current, entries: retainDocuments(current.entries, (document) => document.documentId !== id), notice: "" }
      : current);
  };
  const clear = () => setState({ workspace, entries: emptyEntries, notice: "" });
  const dismissNotice = () => {
    setState((current) => current.workspace === workspace && current.notice
      ? { ...current, notice: "" }
      : current);
  };

  const reconcile = (visibleDocuments: readonly GraphDocumentNode[]) => {
    const visible = new Set<string>(visibleDocuments.filter(canPinGraphDocument).map((doc) => doc.documentId));
    setState((current) => {
      if (current.workspace !== workspace || current.entries.length === 0) return current;
      const removed = new Set(current.entries.flatMap((entry) => entry.documents
        .filter((document) => !visible.has(document.documentId)).map((document) => document.documentId))).size;
      if (removed === 0) return current;
      return {
        ...current,
        entries: retainDocuments(current.entries, (document) => visible.has(document.documentId)),
        notice: removed === 1 ? "One selected document is no longer available and was removed."
          : `${removed} selected documents are no longer available and were removed.`,
      };
    });
  };

  return { entries, documentIds, notice: state.workspace === workspace ? state.notice : "",
    pin, removeDocument, removeEntry, clear, reconcile, dismissNotice };
}

export type ContextBasket = ReturnType<typeof useContextBasket>;
