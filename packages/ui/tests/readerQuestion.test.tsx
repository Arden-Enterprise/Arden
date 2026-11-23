// @vitest-environment jsdom
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KnowledgeDocumentDetail } from "../src/knowledge/KnowledgeDocumentDetail";
import type { ReaderSummaryOptions } from "../src/knowledge/useReaderSummary";
import * as api from "../src/shared/reader-question-api";
import * as summaryApi from "../src/shared/reader-summary-api";
import { ApiError } from "../src/shared/api-client";
import { deferred, readerContext, readerId, readerSummaryFixture } from "./readerSummary.test-support";
import { chooseReaderTask } from "./readerAi.test-support";

function answer(): api.ReaderAnswer {
  return { requestId: readerId(7), documentId: readerContext.documentId, versionId: readerContext.versionId,
    status: "ANSWERED", answer: "Approved readers only.", citations: readerSummaryFixture(readerId(7)).points[0].citations };
}
function fixture() {
  const options: ReaderSummaryOptions = { platform: "web", active: true, context: { ...readerContext }, onCitation: vi.fn(), onAccessLost: vi.fn() };
  const ask = vi.spyOn(api, "askReaderQuestion").mockResolvedValue(answer());
  const access = vi.spyOn(summaryApi, "checkReaderSummaryAccess").mockResolvedValue();
  const props = { metadata: { title: "Guide", documentCode: "ARD-001", summary: "", ownerDepartment: "HR",
    activeVersionId: readerContext.versionId, versions: [{ id: readerContext.versionId, label: "1.0", status: "EFFECTIVE" as const }] },
  summaryOptions: options, content: createElement("p", null, "Original document"), onBack: vi.fn() };
  const view = render(createElement(KnowledgeDocumentDetail, props));
  chooseReaderTask("question");
  const submit = () => { fireEvent.change(screen.getByRole("textbox", { name: "Your question" }), { target: { value: "Who may read?" } }); fireEvent.click(screen.getByRole("button", { name: "Send question" })); };
  return { options, props, ask, access, view, submit };
}
function tabVisibility() {
  const visibility = vi.spyOn(document, "visibilityState", "get");
  return (value: DocumentVisibilityState) => { visibility.mockReturnValue(value); fireEvent(document, new Event("visibilitychange")); };
}
beforeEach(() => { localStorage.clear(); vi.stubGlobal("matchMedia", () => ({ matches: true })); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); delete window.ardenDesktop; });

describe("Ask this document reader", () => {
  it("shares one hidden-tab return check across both retained panels", async () => {
    const h = fixture(); h.submit(); await screen.findByText("Approved readers only.");
    const summary = vi.spyOn(summaryApi, "generateReaderSummary").mockImplementation(async (_p, context, id) => readerSummaryFixture(id, context));
    chooseReaderTask("summary");
    await screen.findByText("Only approved readers can use this guidance.");
    const pending = deferred<void>(); h.access.mockReturnValue(pending.promise);
    const visibility = tabVisibility(); visibility("hidden"); visibility("visible");
    chooseReaderTask("question");
    expect(screen.queryByText("Approved readers only.")).toBeNull();
    expect(h.access).toHaveBeenCalledOnce();
    await act(async () => pending.resolve()); await screen.findByText("Approved readers only.");
    chooseReaderTask("summary");
    expect(screen.getByText("Only approved readers can use this guidance.")).toBeTruthy();
    expect(h.access).toHaveBeenCalledOnce(); expect(summary).toHaveBeenCalledOnce(); expect(h.ask).toHaveBeenCalledOnce();
  });
  it("does not close or erase the question when selecting the active Ask panel again", async () => {
    const h = fixture(); h.submit(); await screen.findByText("Approved readers only.");
    chooseReaderTask("question");
    expect(screen.getByText("Approved readers only.")).toBeTruthy();
    expect((screen.getByRole("textbox", { name: "Your question" }) as HTMLTextAreaElement).value).toBe("Who may read?");
    expect(h.ask).toHaveBeenCalledOnce(); expect(h.access).not.toHaveBeenCalled();
  });
  it("only requests after a nonblank question and reauthorizes source navigation", async () => {
    const h = fixture(); expect(h.ask).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Send question" }).hasAttribute("disabled")).toBe(true);
    h.submit(); await screen.findByText("Approved readers only.");
    expect(h.ask).toHaveBeenCalledWith("web", readerContext, "Who may read?", expect.any(AbortSignal));
    expect(screen.getByText("Original document")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "View answer source 1" })); await act(async () => {});
    expect(h.access).toHaveBeenCalledOnce(); expect(h.options.onCitation).toHaveBeenLastCalledWith(expect.objectContaining({ versionId: readerContext.versionId }));
  });
  it("discards late output after Escape, restores focus and clears the question on reopen", async () => {
    const h = fixture(), pending = deferred<api.ReaderAnswer>(); h.ask.mockReturnValue(pending.promise); h.submit();
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Your question" }), { key: "Escape" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Arden AI" }));
    await act(async () => pending.resolve(answer())); expect(screen.queryByText("Approved readers only.")).toBeNull();
    chooseReaderTask("question");
    expect((screen.getByRole("textbox", { name: "Your question" }) as HTMLTextAreaElement).value).toBe("");
    expect(h.ask).toHaveBeenCalledOnce();
  });
  it.each(["version", "organization", "hash", "inactive"])("drops result/question after %s changes", async mode => {
    const h = fixture(); h.submit(); await screen.findByText("Approved readers only.");
    const options = { ...h.options, context: { ...readerContext } };
    if (mode === "version") options.context.versionId = readerId(90);
    if (mode === "organization") options.context.organizationId = readerId(90);
    if (mode === "hash") options.context.contentHash = "b".repeat(64);
    if (mode === "inactive") options.active = false;
    h.view.rerender(createElement(KnowledgeDocumentDetail, { ...h.props, summaryOptions: options }));
    expect(screen.queryByText("Approved readers only.")).toBeNull(); expect(h.ask).toHaveBeenCalledOnce();
  });
  it.each([404, 422, 429, 503])("shows safe %s failure and only permitted manual retry", async status => {
    const h = fixture(); h.ask.mockRejectedValue(new ApiError(status, "private diagnostic")); h.submit();
    await screen.findByRole("alert"); expect(screen.queryByText("private diagnostic")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Retry/ }) !== null).toBe(status === 429 || status === 503);
    if (status === 429) expect(screen.getByRole("button", { name: "Retry in 10s" }).hasAttribute("disabled")).toBe(true);
    expect(h.options.onAccessLost).toHaveBeenCalledTimes(status === 404 ? 1 : 0);
    if (status === 503) { h.ask.mockResolvedValue(answer()); fireEvent.click(screen.getByRole("button", { name: "Retry" })); await screen.findByText("Approved readers only."); }
  });
  it("withholds a ready answer on hidden-tab return after access is revoked", async () => {
    const h = fixture(); h.submit(); await screen.findByText("Approved readers only.");
    const visibility = tabVisibility(); visibility("hidden"); h.access.mockRejectedValue(new ApiError(404, "revoked")); visibility("visible");
    await screen.findByText("This document is unavailable.");
    expect(screen.queryByText("Approved readers only.")).toBeNull(); expect(h.ask).toHaveBeenCalledOnce();
  });
  it("renders answer as plain text and never imports a previous answer into a new question", async () => {
    const h = fixture(); h.ask.mockResolvedValue({ ...answer(), answer: "<img src=x onerror=alert(1)>" }); h.submit();
    await screen.findByText("<img src=x onerror=alert(1)>"); expect(h.view.container.querySelector("img[src=x]")).toBeNull();
    fireEvent.change(screen.getByRole("textbox", { name: "Your question" }), { target: { value: "And the previous secret?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send question" })); await act(async () => {});
    expect(h.ask.mock.calls[1][2]).toBe("And the previous secret?"); expect(h.ask.mock.calls[1]).toHaveLength(4);
  });
  it("switches panels repeatedly without regenerating or rechecking the same visible reader", async () => {
    const h = fixture(); h.submit(); await screen.findByText("Approved readers only.");
    const summary = vi.spyOn(summaryApi, "generateReaderSummary").mockImplementation(async (_p, context, requestId) => readerSummaryFixture(requestId, context));
    chooseReaderTask("summary");
    await screen.findByText("Only approved readers can use this guidance.");
    expect(screen.queryByRole("textbox", { name: "Your question" })).toBeNull();
    chooseReaderTask("question");
    expect(screen.queryByText("Only approved readers can use this guidance.")).toBeNull();
    await screen.findByText("Approved readers only.");
    expect((screen.getByRole("textbox", { name: "Your question" }) as HTMLTextAreaElement).value).toBe("Who may read?");
    chooseReaderTask("summary");
    expect(screen.getByText("Only approved readers can use this guidance.")).toBeTruthy();
    expect(screen.queryByText("Updating…")).toBeNull();
    expect(summary).toHaveBeenCalledOnce(); expect(h.ask).toHaveBeenCalledOnce();
    expect(h.access).not.toHaveBeenCalled();
  });
  it("keeps in-flight Summary across panel switches without starting another generation", async () => {
    const h = fixture(), pending = deferred<ReturnType<typeof readerSummaryFixture>>();
    const summary = vi.spyOn(summaryApi, "generateReaderSummary").mockReturnValue(pending.promise);
    chooseReaderTask("summary");
    chooseReaderTask("question");
    await act(async () => pending.resolve(readerSummaryFixture(readerId(7))));
    expect(screen.queryByText("Only approved readers can use this guidance.")).toBeNull();
    chooseReaderTask("summary");
    await screen.findByText("Only approved readers can use this guidance.");
    expect(summary).toHaveBeenCalledOnce(); expect(h.access).not.toHaveBeenCalled();
  });
  it("does not revive retained Q&A after access is revoked while viewing Summary", async () => {
    const h = fixture(); h.submit(); await screen.findByText("Approved readers only.");
    vi.spyOn(summaryApi, "generateReaderSummary").mockImplementation(async (_p, context, requestId) => readerSummaryFixture(requestId, context));
    chooseReaderTask("summary");
    await screen.findByText("Only approved readers can use this guidance.");
    h.access.mockRejectedValue(new ApiError(404, "revoked"));
    const visibility = tabVisibility(); visibility("hidden"); visibility("visible");
    chooseReaderTask("question");
    await screen.findByText("This document is unavailable.");
    expect(screen.queryByText("Approved readers only.")).toBeNull();
    expect(h.options.onAccessLost).toHaveBeenCalledOnce(); expect(h.ask).toHaveBeenCalledOnce();
  });
  it("Close Arden AI discards both tasks and returns to the task choice; context changes discard both too", async () => {
    const h = fixture(); h.submit(); await screen.findByText("Approved readers only.");
    const summary = vi.spyOn(summaryApi, "generateReaderSummary").mockImplementation(async (_p, context, requestId) => readerSummaryFixture(requestId, context));
    chooseReaderTask("summary");
    await screen.findByText("Only approved readers can use this guidance.");
    fireEvent.click(screen.getByRole("button", { name: "Close Arden AI" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Arden AI" }));
    fireEvent.click(screen.getByRole("button", { name: "Arden AI" }));
    expect(screen.queryByRole("tab", { name: "Summary" })).toBeNull();
    expect(screen.getByRole("button", { name: /^Explain a selection/ }).hasAttribute("disabled")).toBe(true);
    chooseReaderTask("question");
    expect(screen.queryByText("Approved readers only.")).toBeNull();
    expect((screen.getByRole("textbox", { name: "Your question" }) as HTMLTextAreaElement).value).toBe("");
    h.submit(); await screen.findByText("Approved readers only.");
    chooseReaderTask("summary");
    await screen.findByText("Only approved readers can use this guidance.");
    expect(summary).toHaveBeenCalledTimes(2); expect(h.ask).toHaveBeenCalledTimes(2);
    h.view.rerender(createElement(KnowledgeDocumentDetail, { ...h.props,
      summaryOptions: { ...h.options, context: { ...readerContext, versionId: readerId(90) } } }));
    expect(screen.queryByText("Only approved readers can use this guidance.")).toBeNull();
    chooseReaderTask("question");
    expect(screen.queryByText("Approved readers only.")).toBeNull();
    expect((screen.getByRole("textbox", { name: "Your question" }) as HTMLTextAreaElement).value).toBe("");
  });
});

describe("document question public transport", () => {
  it("accepts a bounded cited passage late in a long document, without whole-Summary truncation", () => {
    const value = answer(), citation = value.citations[0];
    citation.startOffset = 250_000; citation.endOffset = citation.startOffset + Array.from(citation.excerpt).length;
    expect(api.parseReaderAnswer(value, readerContext, value.requestId).citations[0].startOffset).toBe(250_000);
  });
  it("bounds an unresponsive desktop question at 240 seconds and cleans its timer", async () => {
    vi.useFakeTimers(); window.ardenDesktop = { requestApi: vi.fn(() => new Promise<never>(() => {})),
      clearSession: vi.fn(), startGoogleSignIn: vi.fn() };
    const pending = api.askReaderQuestion("desktop", readerContext, "q", new AbortController().signal);
    const checked = expect(pending).rejects.toThrow("stopped");
    await vi.advanceTimersByTimeAsync(240_000); await checked;
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each(["web", "desktop"] as const)("sends only query/request identity over %s", async platform => {
    const query = "Who may read?";
    const response = async (body: string | undefined) => ({ ...answer(), requestId: (JSON.parse(body!) as { requestId: string }).requestId });
    const fetch = vi.fn(async (_url, init: RequestInit) => Response.json(await response(String(init.body)))); vi.stubGlobal("fetch", fetch);
    const requestApi = vi.fn(async (request: { body?: string }) => ({ status: 200, body: JSON.stringify(await response(request.body)) }));
    window.ardenDesktop = { requestApi, clearSession: vi.fn(), startGoogleSignIn: vi.fn() };
    try {
      const result = await api.askReaderQuestion(platform, readerContext, query, new AbortController().signal);
      expect(result.answer).toBe("Approved readers only.");
      const body = platform === "web" ? fetch.mock.calls[0][1].body : requestApi.mock.calls[0][0].body;
      expect(Object.keys(JSON.parse(String(body))).sort()).toEqual(["query", "requestId"]);
      expect(platform === "web" ? requestApi : fetch).not.toHaveBeenCalled();
    } finally { delete window.ardenDesktop; }
  });
  it.each(["foreign", "extra", "status", "citations", "range"])("rejects %s answer", mode => {
    const value = answer();
    const payload = mode === "extra" ? { ...value, history: [] } : mode === "status" ? { ...value, status: ["ANSWERED"] }
      : mode === "foreign" ? { ...value, versionId: readerId(90) } : mode === "citations" ? { ...value, citations: [] }
        : { ...value, citations: [{ ...value.citations[0], endOffset: -1 }] };
    expect(() => api.parseReaderAnswer(payload, readerContext, value.requestId)).toThrow();
  });
});
