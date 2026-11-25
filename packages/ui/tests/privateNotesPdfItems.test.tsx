// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../src/shared/api-client";
import { AppSidebar } from "../src/app/AppSidebar";
import { PersonalWorkspacePage } from "../src/personal-workspace/PersonalWorkspacePage";
import { usePrivateNotes, type PrivateNotesController } from "../src/personal-workspace/usePrivateNotes";
import { PdfImportError, readPdfUpload } from "../src/personal-workspace/pdfImport";
import { installTestDialogs } from "./dialogTestSupport";

vi.mock("../src/shared/useAutosizeTextarea", () => ({ useAutosizeTextarea: () => ({ current: null }) }));
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

/** Spec F03-FILE (decision 0034): original PDFs kept in Private. */
const pdfFile = (name = "Board_minutes.pdf", body = "%PDF-1.7 synthetic") => new File([body], name, { type: "application/pdf" });
let controllerRef: PrivateNotesController;
function Workspace() {
  const controller = usePrivateNotes([], []);
  controllerRef = controller;
  return createElement("div", { className: "arden-app-shell" },
    createElement(AppSidebar, {
      activeView: "personal-workspace", platform: "web", previewRole: "member", organization: null,
      memberName: "Lan Nguyen", memberRole: "Member", onNavigate: vi.fn(), onSignOut: vi.fn(), onOpenSettings: vi.fn(),
      privateNotes: { controller, pageVisible: true, onOpen: vi.fn() },
    }),
    createElement(PersonalWorkspacePage, {
      controller, platform: "web", organizationId: "org", contributionAttempt: null,
      onContributionAttemptChange: vi.fn(), onKnowledgeDraftCreated: vi.fn(), contextOpen: false, onToggleContext: vi.fn(),
    }));
}

type PdfRecord = { id: string; title: string; body: string; kind: "pdf"; textAvailable: boolean; collectionId: null;
  createdAt: string; updatedAt: string; currentVersion: { id: string; version: number }; favoritedAt: null; position: null };
let item: PdfRecord | null;
let requests: Array<{ method: string; path: string; body?: unknown; ifMatch?: string }>;
let restoreDialogs: () => void;
let pickedFile: File;

beforeEach(() => {
  restoreDialogs = installTestDialogs();
  item = null;
  requests = [];
  pickedFile = pdfFile();
  runtimeMock.pages = [{ items: [{ str: "Decision: hire two engineers." }] }];
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => { callback(0); return 0; });
  Object.assign(URL, { createObjectURL: vi.fn(() => "blob:pdf"), revokeObjectURL: vi.fn() });
  vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(function(this: HTMLInputElement) {
    Object.defineProperty(this, "files", { value: [pickedFile] });
    this.dispatchEvent(new Event("change"));
  });
  vi.spyOn(api, "apiRequest").mockImplementation(async (_platform, path, init) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const ifMatch = (init?.headers as Record<string, string> | undefined)?.["If-Match"];
    requests.push({ method, path, body, ifMatch });
    if (method === "GET" && path.includes("/drafts?")) return { items: item ? [item] : [], nextCursor: null };
    if (method === "GET" && path.endsWith("/collections")) return { items: [] };
    if (method === "GET" && path.endsWith("/trash")) return { items: [] };
    if (method === "POST" && path.endsWith("/drafts/pdf")) {
      item = { id: "p1", title: body.title, body: "", kind: "pdf", textAvailable: Boolean(body.text), collectionId: null,
        createdAt: "2026-11-26T00:00:00Z", updatedAt: "2026-11-26T00:00:00Z", currentVersion: { id: "v1", version: 1 },
        favoritedAt: null, position: null };
      return item;
    }
    if (method === "GET" && path.endsWith("/drafts/p1/pdf")) return { pdfBase64: btoa("%PDF-1.7 synthetic") };
    if (method === "PUT" && path.endsWith("/drafts/p1/pdf")) {
      item = { ...item!, textAvailable: Boolean(body.text), currentVersion: { id: "v1", version: item!.currentVersion.version + 1 } };
      return item;
    }
    if (method === "PATCH" && path.endsWith("/drafts/p1")) {
      item = { ...item!, title: body.title, currentVersion: { id: "v1", version: item!.currentVersion.version + 1 } };
      return item;
    }
    throw new Error(`Unexpected ${method} ${path}`);
  });
});
afterEach(() => {
  cleanup();
  restoreDialogs();
  vi.restoreAllMocks();
});

async function connected() {
  render(createElement(Workspace));
  await act(() => controllerRef.connectServer("web", "org"));
  act(() => controllerRef.openRoot());
}

describe("Keeping a PDF in Private", () => {
  it("prepares the file and its text, accepts a scan without text and refuses files over 5 MB", async () => {
    const upload = await readPdfUpload(pdfFile());
    expect(upload).toMatchObject({ title: "Board minutes", text: "Decision: hire two engineers.", textTruncated: false });
    expect(atob(upload.pdfBase64)).toBe("%PDF-1.7 synthetic");
    runtimeMock.pages = [{ items: [] }];
    await expect(readPdfUpload(pdfFile("scan.pdf"))).resolves.toMatchObject({ title: "scan", text: "" });
    const large = new File([new Uint8Array(5 * 1024 * 1024 + 1)], "big.pdf", { type: "application/pdf" });
    await expect(readPdfUpload(large)).rejects.toThrow("larger than 5 MB");
    await expect(readPdfUpload(new File(["x"], "a.txt", { type: "text/plain" }))).rejects.toBeInstanceOf(PdfImportError);
  });

  it("uploads from the Private page, opens the PDF viewer and offers no text import for it", async () => {
    await connected();
    fireEvent.click(screen.getByRole("button", { name: "Upload PDF" }));
    await waitFor(() => expect(controllerRef.selectedNote?.kind).toBe("pdf"));
    expect(requests.find((request) => request.path.endsWith("/drafts/pdf"))?.body)
      .toEqual({ title: "Board minutes", pdfBase64: btoa("%PDF-1.7 synthetic"), text: "Decision: hire two engineers." });
    await waitFor(() => expect(screen.getByRole("link", { name: "Download PDF" })).toBeTruthy());
    expect(screen.getByRole("button", { name: "Replace file" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Share" })).toBeTruthy();

    const tree = screen.getByRole("group", { name: "Private notes" });
    fireEvent.click(within(tree).getByRole("button", { name: "More actions for Board minutes" }));
    expect(within(screen.getByRole("menu")).queryByRole("menuitem", { name: "Import PDF" })).toBeNull();
  });

  it("replaces the file with the version it was based on and reloads the viewer", async () => {
    await connected();
    fireEvent.click(screen.getByRole("button", { name: "Upload PDF" }));
    await waitFor(() => expect(screen.getByRole("link", { name: "Download PDF" })).toBeTruthy());
    const reads = () => requests.filter((request) => request.method === "GET" && request.path.endsWith("/drafts/p1/pdf")).length;
    expect(reads()).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "Replace file" }));
    await waitFor(() => expect(controllerRef.notice?.message).toBe("Replaced the file"));
    expect(requests.find((request) => request.method === "PUT")).toMatchObject({ ifMatch: '"1"' });
    await waitFor(() => expect(reads()).toBe(2));
  });

  it("renames a PDF item in place with its title only, and says when it has no text", async () => {
    runtimeMock.pages = [{ items: [] }];
    pickedFile = pdfFile("scan.pdf");
    await connected();
    fireEvent.click(screen.getByRole("button", { name: "Upload PDF" }));
    await waitFor(() => expect(controllerRef.selectedNote?.kind).toBe("pdf"));
    expect(controllerRef.notice?.message).toBe("Added “scan”. It has no text, so AI is unavailable for it");
    expect(screen.getByText("No text found in this PDF, so AI is unavailable for it.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    fireEvent.click(screen.getByRole("button", { name: /Contribute to a department/ }));
    expect(screen.getByRole("note").textContent).toContain("No text was found in this PDF");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    fireEvent.click(screen.getByTitle("Click to rename"));
    const field = screen.getByRole("textbox", { name: "Rename scan" });
    fireEvent.change(field, { target: { value: "Signed contract" } });
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(controllerRef.selectedNote?.title).toBe("Signed contract"));
    expect(requests.find((request) => request.method === "PATCH")).toMatchObject({ body: { title: "Signed contract" }, ifMatch: '"1"' });
  });
});
