// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PdfReader } from "../src/knowledge/PdfReader";

const runtime = vi.hoisted(() => ({ getDocument: vi.fn() }));
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
});
