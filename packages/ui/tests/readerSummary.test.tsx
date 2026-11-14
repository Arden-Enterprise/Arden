// @vitest-environment jsdom
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KnowledgeDocumentDetail, type ReaderDocumentMetadata } from "../src/knowledge/KnowledgeDocumentDetail";
import type { ReaderSummaryOptions } from "../src/knowledge/useReaderSummary";
import * as api from "../src/shared/reader-summary-api";
import { ApiError } from "../src/shared/api-client";
import { deferred, readerContext, readerId, readerSummaryFixture } from "./readerSummary.test-support";

const metadata: ReaderDocumentMetadata = { title: "Working together", ownerDepartment: "HR", summary: "",
  activeVersionId: readerContext.versionId, versions: [{ id: readerContext.versionId, label: "1.0", status: "EFFECTIVE", effectiveDate: "2026-11-01" }] };
function fixture() {
  const options: ReaderSummaryOptions = { platform: "web", context: { ...readerContext }, active: true, onCitation: vi.fn(), onAccessLost: vi.fn() };
  const generation = vi.spyOn(api, "generateReaderSummary").mockImplementation(async (_platform, context, requestId) => readerSummaryFixture(requestId, context));
  const check = vi.spyOn(api, "checkReaderSummaryAccess").mockResolvedValue();
  const props = { metadata, summaryOptions: options, content: createElement("p", { "data-source-block-id": "source-rule" }, "Original document"), onBack: vi.fn() };
  return { options, generation, check, props };
}
beforeEach(() => { localStorage.clear(); vi.stubGlobal("matchMedia", () => ({ matches: true })); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("exact-version on-request Summary reader", () => {
  it("counts down before manual Retry, never auto-generates and cleans its timer on Close", async () => {
    vi.useFakeTimers();
    const interval = vi.spyOn(globalThis, "setInterval"), clear = vi.spyOn(globalThis, "clearInterval");
    const h = fixture(); h.generation.mockRejectedValueOnce(new ApiError(429, "private", "SUMMARY_COOLDOWN", 2, true));
    render(createElement(KnowledgeDocumentDetail, h.props)); fireEvent.click(screen.getByRole("button", { name: "Summary" }));
    await act(async () => {});
    const retry = screen.getByRole("button", { name: "Retry in 2s" });
    expect(retry.hasAttribute("disabled")).toBe(true); fireEvent.click(retry); expect(h.generation).toHaveBeenCalledOnce();
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(screen.getByRole("button", { name: "Retry in 1s" }).hasAttribute("disabled")).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(h.generation).toHaveBeenCalledOnce(); expect(screen.getByRole("button", { name: "Retry" }).hasAttribute("disabled")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Retry" })); await act(async () => {});
    expect(h.generation).toHaveBeenCalledTimes(2); expect(screen.getByText("Only approved readers can use this guidance.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(clear).toHaveBeenCalledWith(interval.mock.results[0].value);
  });
  it("cleans an unexpired countdown when the panel is closed", async () => {
    vi.useFakeTimers();
    const interval = vi.spyOn(globalThis, "setInterval"), clear = vi.spyOn(globalThis, "clearInterval");
    const h = fixture(); h.generation.mockRejectedValueOnce(new ApiError(429, "Wait", "SUMMARY_COOLDOWN", 60));
    render(createElement(KnowledgeDocumentDetail, h.props)); fireEvent.click(screen.getByRole("button", { name: "Summary" }));
    await act(async () => {}); expect(screen.getByRole("button", { name: "Retry in 60s" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(clear).toHaveBeenCalledWith(interval.mock.results[0].value);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(h.generation).toHaveBeenCalledOnce();
  });
  it("keeps temporary source failures retryable but does not retry a configuration failure", async () => {
    const h = fixture(); h.generation.mockRejectedValueOnce(new ApiError(503, "private", "SUMMARY_SOURCE_UNAVAILABLE", undefined, true));
    render(createElement(KnowledgeDocumentDetail, h.props)); fireEvent.click(screen.getByRole("button", { name: "Summary" }));
    await screen.findByText("Summary is unavailable. Please retry shortly.");
    h.generation.mockRejectedValueOnce(new ApiError(503, "private-key", "SUMMARY_PROVIDER_AUTH", undefined, false));
    fireEvent.click(screen.getByRole("button", { name: "Retry" })); await screen.findByText("Summary is unavailable.");
    expect(screen.queryByRole("button", { name: /^Retry/ })).toBeNull(); expect(screen.queryByText("private-key")).toBeNull();
  });
  it("starts only on request, keeps the source and Back, and rechecks before navigating", async () => {
    const h = fixture(); render(createElement(KnowledgeDocumentDetail, h.props));
    expect(h.generation).not.toHaveBeenCalled(); expect(screen.queryByText("AI-generated")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Summary" }));
    await screen.findByText("Only approved readers can use this guidance.");
    expect(screen.getByText("AI-generated")).toBeTruthy(); expect(screen.getByText("Original document")).toBeTruthy();
    const pending = deferred<void>(); h.check.mockReturnValue(pending.promise);
    fireEvent.click(screen.getByRole("button", { name: /View source for point 1/ }));
    expect(screen.queryByText("Only approved readers can use this guidance.")).toBeNull();
    expect(h.options.onCitation).not.toHaveBeenCalled();
    await act(async () => pending.resolve());
    expect(h.options.onCitation).toHaveBeenCalledWith(expect.objectContaining({ versionId: readerContext.versionId, page: 2, excerpt: "Only approved readers" }));
    fireEvent.click(screen.getByRole("button", { name: "Library" })); expect(h.props.onBack).toHaveBeenCalled();
  });
  it("Close and Escape remain usable while loading and discard late output without regeneration", async () => {
    const h = fixture(), pending = deferred<ReturnType<typeof readerSummaryFixture>>(); h.generation.mockReturnValue(pending.promise);
    render(createElement(KnowledgeDocumentDetail, h.props));
    const trigger = screen.getByRole("button", { name: "Summary" }); fireEvent.click(trigger);
    expect(screen.getByText("Preparing summary…")).toBeTruthy(); fireEvent.keyDown(trigger, { key: "Escape" });
    expect(document.activeElement).toBe(trigger); expect(screen.queryByText("Preparing summary…")).toBeNull();
    await act(async () => pending.resolve(readerSummaryFixture(readerId(4))));
    expect(screen.queryByText("Only approved readers can use this guidance.")).toBeNull(); expect(h.generation).toHaveBeenCalledTimes(1);
  });
  it.each(["version", "document", "organization", "hash", "inactive"])("does not retain output after %s changes, including late replies", async mode => {
    const h = fixture(), pending = deferred<ReturnType<typeof readerSummaryFixture>>(); h.generation.mockReturnValue(pending.promise);
    const view = render(createElement(KnowledgeDocumentDetail, h.props)); fireEvent.click(screen.getByRole("button", { name: "Summary" }));
    const options = { ...h.options, context: { ...h.options.context } };
    if (mode === "version") options.context.versionId = readerId(9);
    if (mode === "document") options.context.documentId = readerId(9);
    if (mode === "organization") options.context.organizationId = readerId(9);
    if (mode === "hash") options.context.contentHash = "b".repeat(64);
    if (mode === "inactive") options.active = false;
    view.rerender(createElement(KnowledgeDocumentDetail, { ...h.props, summaryOptions: options }));
    await act(async () => pending.resolve(readerSummaryFixture(readerId(4))));
    expect(screen.queryByText("AI-generated")).toBeNull(); expect(h.generation).toHaveBeenCalledTimes(1);
  });
  it.each([401, 403, 404, 422, 429, 503])("handles %s with concise safe copy and only permitted manual retry", async status => {
    const h = fixture(); h.generation.mockRejectedValue(new ApiError(status, "private diagnostic payload"));
    render(createElement(KnowledgeDocumentDetail, h.props)); fireEvent.click(screen.getByRole("button", { name: "Summary" }));
    await screen.findByRole("alert"); expect(screen.queryByText("private diagnostic payload")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Retry/ }) !== null).toBe(status === 429 || status === 503);
    if (status === 429) expect(screen.getByRole("button", { name: "Retry in 60s" }).hasAttribute("disabled")).toBe(true);
    expect(h.options.onAccessLost).toHaveBeenCalledTimes(status === 401 || status === 403 || status === 404 ? 1 : 0);
    if (status === 503) { h.generation.mockImplementation(async (_p, context, id) => readerSummaryFixture(id, context)); fireEvent.click(screen.getByRole("button", { name: "Retry" })); await screen.findByText("Only approved readers can use this guidance."); }
    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
  });
  it("hides a completed result across blur/focus, then withholds it after revoked access", async () => {
    const h = fixture(); render(createElement(KnowledgeDocumentDetail, h.props)); fireEvent.click(screen.getByRole("button", { name: "Summary" }));
    await screen.findByText("Only approved readers can use this guidance.");
    fireEvent.blur(window); expect(screen.queryByText("Only approved readers can use this guidance.")).toBeNull();
    h.check.mockRejectedValue(new ApiError(404, "denied")); fireEvent.focus(window);
    await screen.findByText("This document is unavailable."); expect(h.options.onAccessLost).toHaveBeenCalledOnce();
    expect(h.generation).toHaveBeenCalledTimes(1); expect(screen.queryByRole("button", { name: /View source for point/ })).toBeNull();
  });
  it("retries an access check, not paid generation, after a connection failure", async () => {
    const h = fixture(); render(createElement(KnowledgeDocumentDetail, h.props)); fireEvent.click(screen.getByRole("button", { name: "Summary" }));
    await screen.findByText("Only approved readers can use this guidance."); h.check.mockRejectedValueOnce(new ApiError(0, "offline"));
    fireEvent.blur(window); fireEvent.focus(window); await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Retry" })); await screen.findByText("Only approved readers can use this guidance.");
    expect(h.generation).toHaveBeenCalledTimes(1); expect(h.check).toHaveBeenCalledTimes(2);
  });
  it("discards a ready result and its citation on version change without auto-generation", async () => {
    const h = fixture(), view = render(createElement(KnowledgeDocumentDetail, h.props));
    fireEvent.click(screen.getByRole("button", { name: "Summary" }));
    await screen.findByText("Only approved readers can use this guidance.");
    fireEvent.click(screen.getByRole("button", { name: /View source for point 1/ }));
    await act(async () => {});
    expect(h.options.onCitation).toHaveBeenCalledWith(expect.objectContaining({ versionId: readerContext.versionId }));
    view.rerender(createElement(KnowledgeDocumentDetail, { ...h.props, summaryOptions: {
      ...h.options, context: { ...readerContext, versionId: readerId(9) },
    } }));
    expect(screen.queryByText("AI-generated")).toBeNull();
    expect(h.options.onCitation).toHaveBeenLastCalledWith(null);
    expect(h.generation).toHaveBeenCalledTimes(1);
  });
  it.each(["close", "unmount"])("does not revive a citation after %s during access checking", async mode => {
    const h = fixture(), view = render(createElement(KnowledgeDocumentDetail, h.props));
    fireEvent.click(screen.getByRole("button", { name: "Summary" }));
    await screen.findByText("Only approved readers can use this guidance.");
    const pending = deferred<void>(); h.check.mockReturnValue(pending.promise);
    fireEvent.click(screen.getByRole("button", { name: /View source for point 1/ }));
    if (mode === "close") fireEvent.click(screen.getByRole("button", { name: "Close" })); else view.unmount();
    await act(async () => pending.resolve());
    expect(vi.mocked(h.options.onCitation).mock.calls.every(([citation]) => citation === null)).toBe(true);
    expect(screen.queryByText("AI-generated")).toBeNull();
  });
  it("checks once on visibility return and ignores the duplicate focus event", async () => {
    const h = fixture(); render(createElement(KnowledgeDocumentDetail, h.props));
    fireEvent.click(screen.getByRole("button", { name: "Summary" }));
    await screen.findByText("Only approved readers can use this guidance.");
    const visibility = vi.spyOn(document, "visibilityState", "get"); visibility.mockReturnValue("hidden");
    fireEvent(document, new Event("visibilitychange"));
    expect(screen.queryByText("Only approved readers can use this guidance.")).toBeNull();
    const pending = deferred<void>(); h.check.mockReturnValue(pending.promise); visibility.mockReturnValue("visible");
    fireEvent(document, new Event("visibilitychange")); fireEvent.focus(window);
    expect(h.check).toHaveBeenCalledOnce();
    await act(async () => pending.resolve());
    expect(screen.getByText("Only approved readers can use this guidance.")).toBeTruthy();
    // Some browsers deliver focus after the visible event's request already completed.
    fireEvent.focus(window); fireEvent(document, new Event("visibilitychange"));
    await act(async () => {}); expect(h.check).toHaveBeenCalledOnce();
    expect(h.generation).toHaveBeenCalledOnce();
  });
  it("withholds generation completed while blurred until access is checked on return", async () => {
    const h = fixture(), pending = deferred<ReturnType<typeof readerSummaryFixture>>(); h.generation.mockReturnValue(pending.promise);
    render(createElement(KnowledgeDocumentDetail, h.props)); fireEvent.click(screen.getByRole("button", { name: "Summary" }));
    fireEvent.blur(window);
    await act(async () => pending.resolve(readerSummaryFixture(readerId(4))));
    expect(screen.queryByText("Only approved readers can use this guidance.")).toBeNull();
    expect(screen.getByText("Checking access…")).toBeTruthy();
    fireEvent.focus(window); await screen.findByText("Only approved readers can use this guidance.");
    expect(h.check).toHaveBeenCalledOnce(); expect(h.generation).toHaveBeenCalledOnce();
  });
  it.each(["inactive", "version"])("does not resurrect a discarded result when returning from %s to the original context", async mode => {
    const h = fixture(), view = render(createElement(KnowledgeDocumentDetail, h.props));
    fireEvent.click(screen.getByRole("button", { name: "Summary" }));
    await screen.findByText("Only approved readers can use this guidance.");
    const options = { ...h.options, context: { ...h.options.context } };
    if (mode === "inactive") options.active = false; else options.context.versionId = readerId(90);
    view.rerender(createElement(KnowledgeDocumentDetail, { ...h.props, summaryOptions: options }));
    view.rerender(createElement(KnowledgeDocumentDetail, h.props));
    expect(screen.queryByText("Only approved readers can use this guidance.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Summary" }));
    await screen.findByText("Only approved readers can use this guidance.");
    expect(h.generation).toHaveBeenCalledTimes(2);
  });
  it("renders generated strings as text, never model-supplied HTML", async () => {
    const h = fixture(); h.generation.mockImplementation(async (_p, context, id) => { const value = readerSummaryFixture(id, context); value.points[0].text = '<img src=x onerror="alert(1)">'; return value; });
    const view = render(createElement(KnowledgeDocumentDetail, h.props)); fireEvent.click(screen.getByRole("button", { name: "Summary" }));
    await screen.findByText('<img src=x onerror="alert(1)">'); expect(view.container.querySelector("img")).toBeNull();
  });
});
