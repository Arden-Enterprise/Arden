import { describe, expect, it, vi } from "vitest";
import { createGraphIntentBus, graphIntentToSearch, type GraphIntent, type GraphIntentEnvelope } from "../src/graph/intent-bus";

describe("GraphIntentBus", () => {
  it("buffers intents in FIFO order while no subscriber is attached and flushes them on subscribe", () => {
    const bus = createGraphIntentBus();
    const first = bus.dispatch({ type: "open_graph", view: "collections", focusDocumentId: "doc-1" });
    const second = bus.dispatch({ type: "focus_nodes", documentIds: ["doc-1", "doc-2"] });

    expect(bus.peekPending()).toEqual([first, second]);

    const received: GraphIntentEnvelope[] = [];
    const unsubscribe = bus.subscribe((envelope) => { received.push(envelope); });

    expect(received).toEqual([first, second]);
    expect(bus.peekPending()).toEqual([]);
    unsubscribe();
  });

  it("delivers intents synchronously to live subscribers without queueing them", () => {
    const bus = createGraphIntentBus();
    const listenerA = vi.fn();
    const listenerB = vi.fn();
    const unsubA = bus.subscribe(listenerA);
    const unsubB = bus.subscribe(listenerB);

    const intent: GraphIntent = { type: "apply_filter", typeCode: "POLICY_AND_STANDARD", readerScope: "ORGANIZATION" };
    const envelope = bus.dispatch(intent);

    expect(listenerA).toHaveBeenCalledWith(envelope);
    expect(listenerB).toHaveBeenCalledWith(envelope);
    expect(bus.peekPending()).toEqual([]);

    unsubA();
    unsubB();
  });

  it("supports isolate_branch and toggle_links intents and defensively clones array payloads", () => {
    const bus = createGraphIntentBus();
    const docIds = ["doc-a"];
    const relTypes: Array<"REFERENCES" | "SUPERSEDES"> = ["REFERENCES"];

    bus.dispatch({ type: "focus_nodes", documentIds: docIds });
    bus.dispatch({ type: "isolate_branch", branchKind: "department", branchId: "dept-1" });
    bus.dispatch({ type: "toggle_links", enabled: true, relationshipTypes: relTypes });

    docIds.push("mutated-doc");
    relTypes.push("SUPERSEDES");

    const drained = bus.consumePending();
    expect(drained.map((item) => item.intent)).toEqual([
      { type: "focus_nodes", documentIds: ["doc-a"] },
      { type: "isolate_branch", branchKind: "department", branchId: "dept-1" },
      { type: "toggle_links", enabled: true, relationshipTypes: ["REFERENCES"] },
    ]);
    expect(bus.peekPending()).toEqual([]);
  });

  it("respects flushPending: false and clears buffered intents on reset", () => {
    const bus = createGraphIntentBus();
    bus.dispatch({ type: "open_graph", view: "accountability" });

    const listener = vi.fn();
    const unsubscribe = bus.subscribe(listener, { flushPending: false });
    expect(listener).not.toHaveBeenCalled();
    expect(bus.peekPending()).toHaveLength(1);

    bus.clear();
    expect(bus.peekPending()).toEqual([]);
    unsubscribe();
  });

  it("does not skip sibling subscribers when one subscriber unsubscribes mid-dispatch", () => {
    const bus = createGraphIntentBus();
    let unsubFirst: (() => void) | null = null;
    const second = vi.fn();
    unsubFirst = bus.subscribe(() => { unsubFirst?.(); });
    bus.subscribe(second);

    bus.dispatch({ type: "toggle_links", enabled: false });
    expect(second).toHaveBeenCalledTimes(1);
  });
});

describe("graphIntentToSearch", () => {
  it("serializes graph intents onto URL query strings while preserving unrelated filters", () => {
    const afterOpen = graphIntentToSearch(
      { type: "open_graph", view: "collections", focusDocumentId: "doc-1" },
      "",
    );
    expect(afterOpen).toBe("?view=collections&focusDocumentId=doc-1");

    const afterFilter = graphIntentToSearch(
      { type: "apply_filter", typeCode: "GUIDE", ownerDepartmentId: "dept-1" },
      afterOpen,
    );
    expect(afterFilter).toBe("?view=collections&focusDocumentId=doc-1&ownerDepartmentId=dept-1&typeCode=GUIDE");

    const afterLinks = graphIntentToSearch(
      { type: "toggle_links", enabled: true, relationshipTypes: ["REFERENCES", "SUPERSEDES"] },
      afterFilter,
    );
    expect(afterLinks).toBe("?view=collections&focusDocumentId=doc-1&ownerDepartmentId=dept-1&typeCode=GUIDE&includeLinks=true&relationshipTypes=REFERENCES%2CSUPERSEDES");

    const afterDisableLinks = graphIntentToSearch(
      { type: "toggle_links", enabled: false },
      afterLinks,
    );
    expect(afterDisableLinks).toBe("?view=collections&focusDocumentId=doc-1&ownerDepartmentId=dept-1&typeCode=GUIDE");

    const afterBranch = graphIntentToSearch(
      { type: "isolate_branch", branchKind: "collection", branchId: "col-9" },
      "",
    );
    expect(Object.fromEntries(new URLSearchParams(afterBranch))).toEqual({
      view: "collections", collectionId: "col-9", isolate: "true",
    });
  });
});
