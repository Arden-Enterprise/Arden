// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PdfReader } from "../src/knowledge/PdfReader";

const runtime = vi.hoisted(() => ({
  getDocument: vi.fn(),
  TextLayer: class {
    constructor(private readonly input: { textContentSource: string; container: HTMLDivElement }) {}
    async render() { this.input.container.textContent = this.input.textContentSource; }
    cancel() {}
  },
}));
vi.mock("../src/knowledge/pdfRuntime", () => runtime);
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); runtime.getDocument.mockReset(); });

describe("PDF reader failure and teardown", () => {
  it("destroys a loading task when the reader closes before parsing finishes", async () => {
    const destroy = vi.fn().mockResolvedValue(undefined);
    runtime.getDocument.mockReturnValue({ promise: new Promise(() => {}), destroy });
    const view = render(createElement(PdfReader, { base64: "cGRm", title: "Synthetic PDF" }));
    await waitFor(() => expect(runtime.getDocument).toHaveBeenCalledOnce());
    view.unmount();
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("shows a page error instead of silently leaving an empty canvas", async () => {
    vi.stubGlobal("ResizeObserver", class {
      constructor(private readonly callback: (entries: { contentRect: { width: number } }[]) => void) {}
      observe() { this.callback([{ contentRect: { width: 800 } }]); }
      disconnect() {}
    });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const getPage = vi.fn().mockResolvedValue({ getViewport: () => ({ width: 600, height: 800 }) });
    runtime.getDocument.mockReturnValue({ promise: Promise.resolve({ numPages: 1, getPage, destroy: vi.fn().mockResolvedValue(undefined) }), destroy: vi.fn().mockResolvedValue(undefined) });
    render(createElement(PdfReader, { base64: "cGRm", title: "Synthetic PDF" }));
    expect(await screen.findByText("Page 1 could not be displayed. Use Download to open the original file.")).toBeTruthy();
  });

  it("highlights the review citation on its original page and reports a missing match without using another page", async () => {
    vi.stubGlobal("ResizeObserver", class {
      constructor(private readonly callback: (entries: { contentRect: { width: number } }[]) => void) {}
      observe() { this.callback([{ contentRect: { width: 800 } }]); }
      disconnect() {}
    });
    const getContext = vi.fn().mockReturnValue({});
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(getContext);
    const phrase = "Return the workshop kit before Friday.";
    const practice = "Practice on a new example.";
    const getPage = vi.fn(async (page: number) => ({
      getViewport: () => ({ width: 600, height: 800 }),
      render: () => ({ promise: Promise.resolve(), cancel() {} }),
      streamTextContent: () => page <= 2 ? `${phrase} Other text. ${practice}` : "A different passage.",
    }));
    runtime.getDocument.mockReturnValue({
      promise: Promise.resolve({ numPages: 3, getPage }), destroy: vi.fn().mockResolvedValue(undefined),
    });
    const props = { base64: "cGRm", title: "Synthetic PDF" };
    const view = render(createElement(PdfReader, { ...props, focus: {
      page: 2, excerpt: phrase, additionalExcerpts: ["workshop kit before Friday.", practice], samePage: true,
    } }));
    expect(await screen.findByText("Cited text highlighted on page 2.")).toBeTruthy();
    const marks = () => Array.from(view.container.querySelectorAll("mark.pdf-citation-mark"));
    expect(marks().map(mark => mark.closest("[data-page-number]")?.getAttribute("data-page-number"))).toEqual(["2", "2"]);
    expect(marks().map(mark => mark.textContent)).toEqual([phrase, practice]);
    view.rerender(createElement(PdfReader, { ...props, focus: {
      page: 2, excerpt: phrase, additionalExcerpts: ["No matching second source."], samePage: true,
    } }));
    expect(await screen.findByText(/Part of the cited text could not be highlighted on page 2/)).toBeTruthy();
    expect(marks().map(mark => mark.textContent)).toEqual([phrase]);
    view.rerender(createElement(PdfReader, { ...props, focus: { page: 3, excerpt: phrase, samePage: true } }));
    expect(await screen.findByText(/Opened page 3. Passage not found/)).toBeTruthy();
    expect(marks()).toHaveLength(0);
  });
});
