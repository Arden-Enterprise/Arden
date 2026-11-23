// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../src/shared/api-client";
import { AppSidebar } from "../src/app/AppSidebar";
import { PersonalWorkspacePage } from "../src/personal-workspace/PersonalWorkspacePage";
import { usePrivateNotes, type PrivateNotesController } from "../src/personal-workspace/usePrivateNotes";
import { buildImportedNote, importTitle, pageText, PdfImportError, readPdfFile } from "../src/personal-workspace/pdfImport";
import type { PrivateCollection, PrivateNote } from "../src/shared/types";
import { installTestDialogs } from "./dialogTestSupport";

vi.mock("../src/shared/useAutosizeTextarea", () => ({ useAutosizeTextarea: () => ({ current: null }) }));
/** Stand-in for the lazily loaded pdf.js runtime used by the controller's reader. */
const runtimeMock = vi.hoisted(() => ({ pages: [] as Array<{ items: unknown[] }> }));
vi.mock("../src/knowledge/pdfRuntime", () => ({
  getDocument: () => ({
    promise: Promise.resolve({
      numPages: runtimeMock.pages.length,
      getPage: async (number: number) => ({ getTextContent: async () => runtimeMock.pages[number - 1] }),
      getMetadata: async () => ({ info: {} }),
    }),
    destroy: async () => undefined,
  }),
}));

/** Spec F03-PDF: import a PDF's text as a new private note. */
const pdfFile = (name = "Quarterly_report.pdf", body = "%PDF-1.7 synthetic") => new File([body], name, { type: "application/pdf" });
type FakePage = { items: Array<{ str: string; hasEOL?: boolean } | { type: string }> };
function fakeRuntime(pages: FakePage[], options: { title?: string; fail?: Error } = {}) {
  const destroy = vi.fn(async () => undefined);
  const getDocument = vi.fn(() => ({
    promise: options.fail ? Promise.reject(options.fail) : Promise.resolve({
      numPages: pages.length,
      getPage: async (number: number) => ({ getTextContent: async () => pages[number - 1]! }),
      getMetadata: async () => ({ info: options.title ? { Title: options.title } : {} }),
    }),
    destroy,
  }));
  return { load: async () => ({ getDocument }) as never, getDocument, destroy };
}

let restoreDialogs: () => void;
beforeEach(() => {
  restoreDialogs = installTestDialogs();
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => { callback(0); return 0; });
});
afterEach(() => {
  cleanup();
  restoreDialogs();
  vi.restoreAllMocks();
});

describe("PDF text to note", () => {
  it("rebuilds lines, tidies spacing and drops empty runs", () => {
    expect(pageText([{ str: "Hello  " }, { str: "world", hasEOL: true }, { str: "" , hasEOL: true }, { str: "", hasEOL: true },
      { str: "", hasEOL: true }, { str: "\tNext line " }])).toBe("Hello world\n\nNext line");
  });

  it("names the note after the PDF title, or the file name", () => {
    expect(importTitle("Quarterly_report.PDF")).toBe("Quarterly report");
    expect(importTitle("x.pdf", "  Board minutes ")).toBe("Board minutes");
    expect(Array.from(importTitle(`${"á".repeat(300)}.pdf`)).length).toBe(200);
  });

  it("keeps whole pages that fit the note limit and reports what was left out", () => {
    const note = buildImportedNote("a.pdf", null, ["one", "two", "three"], 9);
    expect(note).toEqual({ title: "a", body: "one\n\ntwo", importedPages: 2, totalPages: 3, truncated: true });
    expect(buildImportedNote("a.pdf", null, ["one", "two"])).toMatchObject({ body: "one\n\ntwo", truncated: false });
    // A first page longer than the limit is cut at a line boundary.
    expect(buildImportedNote("a.pdf", null, ["line one\nline two\nline three"], 17)).toMatchObject({ body: "line one\nline two", importedPages: 0, truncated: true });
  });

  it("refuses a PDF without selectable text", () => {
    expect(() => buildImportedNote("scan.pdf", null, ["", "  "])).toThrow(/no selectable text/);
  });

  it("checks the file before loading pdf.js and maps password and corrupt files to clear messages", async () => {
    const runtime = fakeRuntime([{ items: [{ str: "Hi", hasEOL: true }, { type: "beginMarkedContent" }, { str: "there" }] }], { title: "Doc title" });
    await expect(readPdfFile(new File(["x"], "notes.txt", { type: "text/plain" }), runtime.load)).rejects.toThrow("Choose a PDF file.");
    await expect(readPdfFile(pdfFile("a.pdf", ""), runtime.load)).rejects.toThrow("This PDF is empty.");
    await expect(readPdfFile(pdfFile("a.pdf", "not a pdf"), runtime.load)).rejects.toThrow("This file isn’t a valid PDF.");
    expect(runtime.getDocument).not.toHaveBeenCalled();

    await expect(readPdfFile(pdfFile(), runtime.load)).resolves.toMatchObject({ title: "Doc title", body: "Hi\nthere", totalPages: 1 });
    expect(runtime.destroy).toHaveBeenCalled();
    const password = Object.assign(new Error("needs password"), { name: "PasswordException" });
    await expect(readPdfFile(pdfFile(), fakeRuntime([], { fail: password }).load)).rejects.toThrow(/password-protected/);
    await expect(readPdfFile(pdfFile(), fakeRuntime([], { fail: new Error("bad xref") }).load)).rejects.toThrow(/may be damaged/);
    await expect(readPdfFile(pdfFile(), fakeRuntime([{ items: [] }]).load)).rejects.toBeInstanceOf(PdfImportError);
  });
});

const collections: PrivateCollection[] = [{ id: "c1", title: "Capstone", parentId: null, favoritedAt: null }];
const notes: PrivateNote[] = [{ id: "n1", title: "Existing", body: "", updatedLabel: "Saved", collectionId: "c1" }];
let controllerRef: PrivateNotesController;
function Workspace({ connect }: { connect?: boolean }) {
  const controller = usePrivateNotes(connect ? [] : notes, connect ? [] : collections);
  controllerRef = controller;
  return createElement("div", { className: "arden-app-shell" },
    createElement(AppSidebar, {
      activeView: "personal-workspace", platform: "web", previewRole: "member", organization: null,
      memberName: "Lan Nguyen", memberRole: "Member", onNavigate: vi.fn(), onSignOut: vi.fn(), onOpenSettings: vi.fn(),
      privateNotes: { controller, pageVisible: true, onOpen: vi.fn() },
    }),
    createElement(PersonalWorkspacePage, {
      controller, platform: "web", organizationId: connect ? "org" : "", contributionAttempt: null,
      onContributionAttemptChange: vi.fn(), onKnowledgeDraftCreated: vi.fn(), contextOpen: false, onToggleContext: vi.fn(),
    }));
}
const tree = () => screen.getByRole("group", { name: "Private notes" });

describe("Import PDF in Private Notes", () => {
  it("offers Import PDF in a collection's ··· menu, opening the file picker", () => {
    const click = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => undefined);
    render(createElement(Workspace));
    fireEvent.click(within(tree()).getByRole("button", { name: "More actions for Capstone" }));
    fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Import PDF" }));
    expect(click).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(within(tree()).getByRole("button", { name: "Expand Capstone" }));
    fireEvent.click(within(tree()).getByRole("button", { name: "More actions for Existing" }));
    expect(within(screen.getByRole("menu")).queryByRole("menuitem", { name: "Import PDF" })).toBeNull();
  });

  it("saves the imported text as a note in the collection, opens it and announces truncation honestly", async () => {
    const posted: unknown[] = [];
    vi.spyOn(api, "apiRequest").mockImplementation(async (_platform, path, init) => {
      const method = init?.method ?? "GET";
      if (method === "GET" && path.includes("/drafts?")) return { items: [], nextCursor: null };
      if (method === "GET" && path.endsWith("/collections")) return { items: [{ ...collections[0], createdAt: "", updatedAt: "" }] };
      if (method === "GET" && path.endsWith("/trash")) return { items: [] };
      if (method === "POST" && path.endsWith("/drafts")) {
        const body = JSON.parse(String(init!.body));
        posted.push(body);
        return { id: "imported", organizationId: "org", ...body, createdAt: "2026-11-24T00:00:00Z", updatedAt: "2026-11-24T00:00:00Z",
          currentVersion: { id: "v1", version: 1 }, favoritedAt: null, position: null };
      }
      throw new Error(`Unexpected ${method} ${path}`);
    });
    runtimeMock.pages = [{ items: [{ str: "Page one", hasEOL: true }] }, { items: [{ str: "Page two" }] }];
    render(createElement(Workspace, { connect: true }));
    await act(() => controllerRef.connectServer("web", "org"));
    await act(async () => { await controllerRef.importPdf(pdfFile(), "c1"); });
    expect(posted).toEqual([{ title: "Quarterly report", body: "Page one\n\nPage two", collectionId: "c1" }]);
    expect(controllerRef.selectedNote).toMatchObject({ id: "imported", collectionId: "c1", body: "Page one\n\nPage two" });
    expect(controllerRef.focus.kind).toBe("note");
    expect(controllerRef.notice?.message).toBe("Imported “Quarterly report” (2 pages)");

    // A scanned PDF (no text) shows an explicit error and creates nothing.
    runtimeMock.pages = [{ items: [] }];
    await act(async () => { await controllerRef.importPdf(pdfFile("scan.pdf"), null); });
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("no selectable text"));
    expect(posted).toHaveLength(1);
  });
});
