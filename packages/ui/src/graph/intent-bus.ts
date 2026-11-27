import type {
  DocumentRelationshipType,
  GraphReaderScope,
  GraphTypeCode,
  GraphValidityFilter,
  GraphViewMode,
} from "@arden/domain";

/** Platform-agnostic Knowledge Graph intent vocabulary aligned with SPEC-graph-agent-bridge.md §4.2. */

export type GraphIntentViewMode = GraphViewMode;
export type GraphIntentTypeCode = GraphTypeCode;
export type GraphIntentReaderScope = GraphReaderScope;
export type GraphIntentValidityFilter = GraphValidityFilter;
export type GraphIntentRelationshipType = DocumentRelationshipType;
export type GraphIntentBranchKind = "department" | "collection" | "type";

export type GraphIntent =
  | { type: "focus_nodes"; documentIds: string[] }
  | {
    type: "apply_filter";
    ownerDepartmentId?: string;
    typeCode?: GraphIntentTypeCode;
    collectionId?: string;
    readerScope?: GraphIntentReaderScope;
    validity?: GraphIntentValidityFilter;
  }
  | { type: "isolate_branch"; branchKind: GraphIntentBranchKind; branchId: string }
  | { type: "toggle_links"; enabled: boolean; relationshipTypes?: GraphIntentRelationshipType[] }
  | { type: "open_graph"; view?: GraphIntentViewMode; focusDocumentId?: string; search?: string };

export interface GraphIntentEnvelope {
  readonly id: number;
  readonly intent: GraphIntent;
}

export type GraphIntentListener = (envelope: GraphIntentEnvelope) => void;

export interface GraphIntentBus {
  /**
   * Publishes a graph intent. Delivered immediately to active subscribers;
   * buffered in FIFO order while no subscriber is attached (for example, while
   * navigating to `/graph` on Web or Electron `file://`).
   */
  dispatch(intent: GraphIntent): GraphIntentEnvelope;
  /**
   * Subscribes to live intents. By default (`flushPending: true`), any buffered
   * pending intents are drained in FIFO order and delivered to this subscriber
   * immediately so navigation-time intents are never dropped.
   */
  subscribe(listener: GraphIntentListener, options?: { flushPending?: boolean }): () => void;
  /** Returns currently buffered pending intents without consuming them. */
  peekPending(): readonly GraphIntentEnvelope[];
  /** Drains and returns all buffered pending intents in FIFO order. */
  consumePending(): GraphIntentEnvelope[];
  /** Clears buffered pending intents (for example on organization switch or sign-out). */
  clear(): void;
}

function cloneIntent(intent: GraphIntent): GraphIntent {
  switch (intent.type) {
    case "focus_nodes":
      return { type: "focus_nodes", documentIds: [...intent.documentIds] };
    case "toggle_links":
      return {
        type: "toggle_links",
        enabled: intent.enabled,
        ...(intent.relationshipTypes ? { relationshipTypes: [...intent.relationshipTypes] } : {}),
      };
    case "apply_filter":
      return { ...intent };
    case "isolate_branch":
      return { ...intent };
    case "open_graph":
      return { ...intent };
  }
}

/**
 * Creates an in-memory pub/sub and pending-intent bus for Knowledge Graph intents
 * that works identically on Electron (`file://`, no URL routing) and Web.
 */
export function createGraphIntentBus(): GraphIntentBus {
  let nextId = 1;
  const listeners = new Set<GraphIntentListener>();
  let pending: GraphIntentEnvelope[] = [];

  return {
    dispatch(intent) {
      const envelope: GraphIntentEnvelope = { id: nextId++, intent: cloneIntent(intent) };
      if (listeners.size === 0) {
        pending.push(envelope);
        return envelope;
      }
      for (const listener of [...listeners]) {
        listener(envelope);
      }
      return envelope;
    },

    subscribe(listener, options = {}) {
      listeners.add(listener);
      if (options.flushPending !== false && pending.length > 0) {
        const queued = pending;
        pending = [];
        for (const envelope of queued) {
          listener(envelope);
        }
      }
      return () => {
        listeners.delete(listener);
      };
    },

    peekPending() {
      return [...pending];
    },

    consumePending() {
      const queued = pending;
      pending = [];
      return queued;
    },

    clear() {
      pending = [];
    },
  };
}

const filterKeys = ["ownerDepartmentId", "typeCode", "collectionId", "readerScope", "validity"] as const;

/**
 * Projects a graph intent onto `/graph` query parameters so Web URLs stay in sync
 * with intent dispatches while keeping unrelated active query filters intact.
 */
export function graphIntentToSearch(intent: GraphIntent, currentSearch = ""): string {
  const baseSearch = intent.type === "open_graph" && intent.search !== undefined ? intent.search : currentSearch;
  const trimmed = baseSearch.startsWith("?") ? baseSearch.slice(1) : baseSearch;
  const params = new URLSearchParams(trimmed);

  switch (intent.type) {
    case "open_graph":
      if (intent.view) params.set("view", intent.view);
      if (intent.focusDocumentId) params.set("focusDocumentId", intent.focusDocumentId);
      break;
    case "focus_nodes":
      if (intent.documentIds[0]) params.set("focusDocumentId", intent.documentIds[0]);
      break;
    case "apply_filter":
      for (const key of filterKeys) {
        const value = intent[key];
        if (value === undefined) continue;
        if (value === "") params.delete(key);
        else params.set(key, value);
      }
      break;
    case "isolate_branch":
      params.set("isolate", "true");
      params.delete("q");
      params.delete("focusDocumentId");
      for (const key of filterKeys) params.delete(key);
      if (intent.branchKind === "department") {
        params.delete("view");
        params.set("ownerDepartmentId", intent.branchId);
      } else if (intent.branchKind === "collection") {
        params.set("view", "collections");
        params.set("collectionId", intent.branchId);
      } else if (intent.branchKind === "type") {
        params.delete("view");
        params.set("typeCode", intent.branchId);
      }
      break;
    case "toggle_links":
      if (intent.enabled) {
        params.set("includeLinks", "true");
        if (intent.relationshipTypes && intent.relationshipTypes.length > 0) {
          params.set("relationshipTypes", intent.relationshipTypes.join(","));
        }
      } else {
        params.delete("includeLinks");
        params.delete("relationshipTypes");
      }
      break;
  }

  const serialized = params.toString();
  return serialized ? `?${serialized}` : "";
}
