// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, renderHook, screen, within } from "@testing-library/react";
import { CONTEXT_BASKET_MAX_DOCUMENTS, type DocumentId, type GraphDocumentNode, type PublishedVersionId } from "@arden/domain";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentPanel } from "../app/AgentPanel";
import { ChatComposer } from "../ask-arden/ChatComposer";
import type { ArdenChat } from "../ask-arden/useArdenChat";
import { useContextBasket, type ContextDocument } from "./context-basket";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function makeContextDoc(index: number, overrides: Partial<ContextDocument> = {}): ContextDocument {
  return {
    documentId: `doc-${index}`,
    title: `Policy ${index}`,
    ownerDepartmentName: "Engineering",
    ...overrides,
  };
}

function makeGraphDoc(index: number, overrides: Partial<GraphDocumentNode> = {}): GraphDocumentNode {
  return {
    documentId: `doc-${index}` as DocumentId,
    publishedVersionId: `ver-${index}` as PublishedVersionId,
    title: `Policy ${index}`,
    type: "Policy & Standard",
    version: "1.0",
    ownerDepartmentId: "dept-eng",
    ownerDepartmentName: "Engineering",
    authorDisplayName: "Lan Nguyen",
    publishedAt: "2026-11-20T00:00:00Z",
    validUntil: null,
    validityStatus: "Current",
    daysUntilExpiry: null,
    readerScope: "ORGANIZATION",
    collectionId: null,
    openTarget: "READER",
    canEditRelationships: false,
    canRenew: false,
    monitorSignals: null,
    ...overrides,
  };
}

function makeFakeChat(): ArdenChat {
  return {
    messages: [],
    draft: "",
    setDraft: vi.fn(),
    pending: false,
    canAsk: true,
    empty: true,
    privateNote: false,
    threadTitle: "New chat",
    currentId: null,
    history: [],
    historyOpen: false,
    historyLoading: false,
    historyError: "",
    openingId: null,
    sourcePanel: null,
    submit: vi.fn().mockResolvedValue(undefined),
    stopWaiting: vi.fn(),
    reset: vi.fn(),
    toggleHistory: vi.fn(),
    closeHistory: vi.fn(),
    loadHistory: vi.fn().mockResolvedValue(undefined),
    openConversation: vi.fn().mockResolvedValue(true),
    reloadConversation: vi.fn(),
    openSources: vi.fn(),
    closeSources: vi.fn(),
    sendFeedback: vi.fn().mockResolvedValue(undefined),
  } as unknown as ArdenChat;
}

describe("useContextBasket", () => {
  it("rejects additions exceeding the 50-document cap without partial truncation", () => {
    const { result } = renderHook(() => useContextBasket("user-1:org-1"));
    const firstBatch = Array.from({ length: 40 }, (_, i) => makeContextDoc(i + 1));
    const overflowBatch = Array.from({ length: 15 }, (_, i) => makeContextDoc(i + 41));

    act(() => {
      const added = result.current.pin(firstBatch, "Engineering");
      expect(added.kind).toBe("added");
    });
    expect(result.current.documentIds.size).toBe(40);

    act(() => {
      const rejected = result.current.pin(overflowBatch, "Security");
      expect(rejected).toEqual({ kind: "limit" });
    });
    expect(result.current.documentIds.size).toBe(40);
    expect(result.current.entries).toHaveLength(1);

    // Exactly up to CONTEXT_BASKET_MAX_DOCUMENTS succeeds cleanly.
    const exactFit = Array.from({ length: CONTEXT_BASKET_MAX_DOCUMENTS - 40 }, (_, i) => makeContextDoc(i + 41));
    act(() => {
      const added = result.current.pin(exactFit, "Security");
      expect(added.kind).toBe("added");
    });
    expect(result.current.documentIds.size).toBe(CONTEXT_BASKET_MAX_DOCUMENTS);
  });

  it("supports branch pinning and individual removal from inside a pinned branch", () => {
    const { result } = renderHook(() => useContextBasket("user-1:org-1"));
    const branchDocs = [makeContextDoc(1, { title: "Runbook A" }), makeContextDoc(2, { title: "Runbook B" })];

    act(() => {
      result.current.pin(branchDocs, "Engineering");
    });
    expect(result.current.entries).toHaveLength(1);
    expect(result.current.entries[0]?.branchLabel).toBe("Engineering");
    expect(result.current.documentIds.size).toBe(2);

    act(() => {
      result.current.removeDocument("doc-1");
    });
    expect(result.current.documentIds.has("doc-1")).toBe(false);
    expect(result.current.documentIds.has("doc-2")).toBe(true);
    expect(result.current.entries[0]?.documents.map((d) => d.documentId)).toEqual(["doc-2"]);

    act(() => {
      result.current.removeDocument("doc-2");
    });
    expect(result.current.entries).toHaveLength(0);
    expect(result.current.documentIds.size).toBe(0);
  });

  it("reconciles with a non-oracle generic count notice and allows dismissing the notice when emptied", () => {
    const { result } = renderHook(() => useContextBasket("user-1:org-1"));
    act(() => {
      result.current.pin([
        makeContextDoc(1, { title: "Secret Acquisition Plan" }),
        makeContextDoc(2, { title: "Travel Guide" }),
      ]);
    });

    // doc-1 disappears or expires; only doc-2 stays pinnable.
    act(() => {
      result.current.reconcile([
        makeGraphDoc(1, { validityStatus: "Expired", title: "Secret Acquisition Plan" }),
        makeGraphDoc(2, { title: "Travel Guide" }),
      ]);
    });
    expect([...result.current.documentIds]).toEqual(["doc-2"]);
    expect(result.current.notice).toBe("One selected document is no longer available and was removed.");
    expect(result.current.notice).not.toContain("Secret Acquisition Plan");
    expect(result.current.notice).not.toContain("doc-1");

    // Reconciling away the last document keeps the notice, and dismissNotice clears it.
    act(() => {
      result.current.reconcile([]);
    });
    expect(result.current.documentIds.size).toBe(0);
    expect(result.current.notice).toBe("One selected document is no longer available and was removed.");

    act(() => {
      result.current.dismissNotice();
    });
    expect(result.current.notice).toBe("");
  });

  it("resets basket entries and notice immediately on workspace switch", () => {
    const { result, rerender } = renderHook(
      ({ workspace }) => useContextBasket(workspace),
      { initialProps: { workspace: "user-1:org-1" as string | null } },
    );

    act(() => {
      result.current.pin([makeContextDoc(1)]);
    });
    expect(result.current.documentIds.size).toBe(1);

    rerender({ workspace: "user-1:org-2" });
    expect(result.current.entries).toHaveLength(0);
    expect(result.current.documentIds.size).toBe(0);
    expect(result.current.notice).toBe("");
  });
});

describe("ChatComposer Context Basket chips and Private isolation", () => {
  it("renders Arden Island compact chips directly, lets users expand a branch to remove individual docs, and lets users dismiss reconciled notices", () => {
    function ComposerHarness() {
      const basket = useContextBasket("user-1:org-1");
      const ref = createRef<HTMLTextAreaElement>();
      return (
        <div>
          <button type="button" onClick={() => basket.pin([
            makeContextDoc(1, { title: "Deployment Checklist", ownerDepartmentName: "Engineering" }),
            makeContextDoc(2, { title: "Incident Runbook", ownerDepartmentName: "Engineering" }),
          ], "Engineering")}>
            Pin branch
          </button>
          <button type="button" onClick={() => basket.pin([
            makeContextDoc(3, { title: "Security Handbook", ownerDepartmentName: "Security" }),
          ])}>
            Pin single
          </button>
          <button type="button" onClick={() => basket.reconcile([])}>
            Reconcile empty
          </button>
          <ChatComposer chat={makeFakeChat()} placement="dock" composerRef={ref} basket={basket} />
        </div>
      );
    }

    render(<ComposerHarness />);
    fireEvent.click(screen.getByRole("button", { name: "Pin branch" }));
    fireEvent.click(screen.getByRole("button", { name: "Pin single" }));

    expect(screen.getByText("Scoped to 3 documents")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Clear scope" })).toBeTruthy();

    // Compact chips are directly visible (no hidden double-nested <details>).
    expect(document.querySelector("details")).toBeNull();
    expect(screen.getByText("Security Handbook")).toBeTruthy();
    const branchToggle = screen.getByRole("button", { name: /Engineering.*2 docs/i });
    expect(branchToggle.getAttribute("aria-expanded")).toBe("false");

    // Expand branch chip to inspect and remove one document individually.
    fireEvent.click(branchToggle);
    expect(branchToggle.getAttribute("aria-expanded")).toBe("true");
    const branchPanel = screen.getByRole("region", { name: "Engineering documents" });
    expect(within(branchPanel).getByText("Deployment Checklist")).toBeTruthy();
    expect(within(branchPanel).getByText("Incident Runbook")).toBeTruthy();

    fireEvent.click(within(branchPanel).getByRole("button", { name: "Remove Deployment Checklist" }));
    expect(screen.getByText("Scoped to 2 documents")).toBeTruthy();
    expect(within(branchPanel).queryByText("Deployment Checklist")).toBeNull();
    expect(within(branchPanel).getByText("Incident Runbook")).toBeTruthy();

    // Reconcile away everything -> notice appears and can be dismissed cleanly.
    fireEvent.click(screen.getByRole("button", { name: "Reconcile empty" }));
    expect(screen.queryByText(/Scoped to/)).toBeNull();
    expect(screen.getByText("2 selected documents are no longer available and were removed.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss notice" }));
    expect(screen.queryByText(/no longer available/)).toBeNull();
  });

  it("isolates Company Context Basket from Private note chat in AgentPanel", () => {
    function IsolationHarness({ isPrivate }: { isPrivate: boolean }) {
      const basket = useContextBasket("user-1:org-1");
      return (
        <div>
          <button type="button" onClick={() => basket.pin([makeContextDoc(1, { title: "Company Policy" })])}>
            Pin company doc
          </button>
          <AgentPanel
            open
            platform="web"
            organizationId="org-1"
            source={isPrivate
              ? { kind: "private-note", id: "note-1", title: "My Private Note", version: 1 }
              : { kind: "company" }}
            companyChat={makeFakeChat()}
            basket={basket}
            onClose={vi.fn()}
            onOpenAskArden={vi.fn()}
          />
        </div>
      );
    }

    const view = render(<IsolationHarness isPrivate={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Pin company doc" }));
    expect(screen.getByText("Scoped to 1 document")).toBeTruthy();

    // Switching AgentPanel to a Private note hides the Company basket completely.
    view.rerender(<IsolationHarness isPrivate />);
    expect(screen.queryByText("Scoped to 1 document")).toBeNull();
    expect(screen.queryByText("Company Policy")).toBeNull();
  });
});
