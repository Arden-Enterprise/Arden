// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installTestDialogs } from "./dialogTestSupport";
import * as api from "../src/shared/api-client";
import { GovernanceDocumentsPanel, PublicationReportsPanel, ReportProblemButton } from "../src/knowledge/PublicationGovernance";

vi.mock("../src/knowledge/ArdenRichTextEditor", () => ({ ArdenDocumentView: ({ body }: { body: string }) => createElement("p", null, body) }));

let restoreDialogs: () => void;
beforeEach(() => { restoreDialogs = installTestDialogs(); });
afterEach(() => { cleanup(); restoreDialogs(); vi.restoreAllMocks(); });

const departmentName = (id: string | null) => ({ hr: "HR", ops: "Operations" } as Record<string, string>)[id ?? ""] ?? "Unassigned";
const item = (overrides: Partial<api.GovernancePublication> = {}): api.GovernancePublication => ({
  documentId: "doc", publishedVersionId: "version", title: "Salary bands", responsibleDepartmentId: "hr",
  readerMode: "SELECTED_MEMBERS", readerDepartmentId: null, versionLabel: "1.2", snapshotVersionNo: 3,
  publishedAt: "2026-11-01T00:00:00Z", openReports: 0, readable: false, ...overrides });
const document: api.GovernanceDocument = { documentId: "doc", publishedVersionId: "version", title: "Salary bands",
  mimeType: "text/plain", contentHash: "hash", body: "Confidential body", responsibleDepartmentId: "hr",
  readers: { mode: "SELECTED_MEMBERS", departmentId: null } };

describe("decision 0023 Administration → Documents", () => {
  function renderPanel(items: api.GovernancePublication[]) {
    const list = vi.spyOn(api, "listGovernancePublications").mockResolvedValue(items);
    vi.spyOn(api, "listPublicationReports").mockResolvedValue([]);
    render(createElement(GovernanceDocumentsPanel, { platform: "web", organizationId: "org", departmentName }));
    return list;
  }

  it("shows metadata only and opens an inspection only after a reason", async () => {
    renderPanel([item()]);
    const row = (await screen.findByText("Salary bands")).closest("[role=row]") as HTMLElement;
    expect(within(row).getByText("HR")).toBeTruthy();
    expect(within(row).getByText("Selected members")).toBeTruthy();
    expect(within(row).getByText("1.2")).toBeTruthy();
    const open = vi.spyOn(api, "openGovernanceInspection").mockResolvedValue("inspection");
    const load = vi.spyOn(api, "loadGovernanceInspection").mockResolvedValue({ ...document, inspectionId: "inspection",
      reason: "Reported leak", expiresAt: "2026-11-16T10:15:00Z",
      readers: { mode: "SELECTED_MEMBERS", departmentId: null, names: ["Avery", "Blake"] } });
    fireEvent.click(within(row).getByRole("button", { name: "Inspect" }));
    const dialog = screen.getByRole("dialog", { name: "Inspect document" });
    expect(within(dialog).getByText(/won’t\s+become a reader/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Open" }));
    expect(within(dialog).getByText("Enter a reason.")).toBeTruthy();
    expect(open).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByRole("textbox", { name: /Reason/ }), { target: { value: " Reported leak " } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Open" }));
    await waitFor(() => expect(open).toHaveBeenCalledWith("web", "org", "doc", "Reported leak"));
    expect(load).toHaveBeenCalledWith("web", "org", "inspection");
    const viewer = await screen.findByRole("dialog", { name: "Salary bands" });
    expect(await within(viewer).findByText("Confidential body")).toBeTruthy();
    expect(within(viewer).getByText("Avery, Blake")).toBeTruthy();
    expect(within(viewer).getByText("Reported leak")).toBeTruthy();
  });

  it("offers no inspection for a document the Admin already reads, and withdraws with a reason", async () => {
    const list = renderPanel([item({ readable: true, openReports: 2 })]);
    const row = (await screen.findByText("Salary bands")).closest("[role=row]") as HTMLElement;
    expect(within(row).queryByRole("button", { name: "Inspect" })).toBeNull();
    expect(within(row).getByText("Readable in Library")).toBeTruthy();
    expect(within(row).getByText("2 reported")).toBeTruthy();
    const withdraw = vi.spyOn(api, "withdrawPublication").mockResolvedValue();
    fireEvent.click(within(row).getByRole("button", { name: "Withdraw" }));
    const dialog = screen.getByRole("dialog", { name: "Withdraw publication" });
    expect(within(dialog).getByText(/author sees your reason/)).toBeTruthy();
    fireEvent.change(within(dialog).getByRole("textbox", { name: /Reason/ }), { target: { value: "Legal hold" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Withdraw" }));
    await waitFor(() => expect(withdraw).toHaveBeenCalledWith("web", "org", "doc", "Legal hold"));
    await screen.findByText("Publication withdrawn");
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("shows the server's refusal inside the dialog", async () => {
    renderPanel([item()]);
    fireEvent.click(await screen.findByRole("button", { name: "Withdraw" }));
    vi.spyOn(api, "withdrawPublication").mockRejectedValue(new api.ApiError(409, "A newer version is being prepared."));
    const dialog = screen.getByRole("dialog", { name: "Withdraw publication" });
    fireEvent.change(within(dialog).getByRole("textbox", { name: /Reason/ }), { target: { value: "Wrong" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Withdraw" }));
    expect(await within(dialog).findByText("A newer version is being prepared.")).toBeTruthy();
  });
});

describe("decision 0023 reported problems", () => {
  const report: api.PublicationReport = { id: "report", documentId: "doc", publishedVersionId: "version", title: "Salary bands",
    message: "Wrong column", reporterName: "Avery", createdAt: "2026-11-16T00:00:00Z", stillCurrent: true, canView: true };

  it("ignores reports that arrive after the panel is gone", async () => {
    let resolve: (items: api.PublicationReport[]) => void = () => undefined;
    vi.spyOn(api, "listPublicationReports").mockReturnValue(new Promise((done) => { resolve = done; }));
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { unmount, container } = render(createElement(PublicationReportsPanel, { platform: "web", organizationId: "org", departmentName }));
    unmount();
    resolve([report]);
    await new Promise((settle) => setTimeout(settle, 0));
    expect(container.innerHTML).toBe("");
    expect(errors).not.toHaveBeenCalled();
  });

  it("stays hidden when there is nothing to show", async () => {
    const list = vi.spyOn(api, "listPublicationReports").mockResolvedValue([]);
    const { container } = render(createElement(PublicationReportsPanel, { platform: "web", organizationId: "org", departmentName }));
    await waitFor(() => expect(list).toHaveBeenCalled());
    expect(container.innerHTML).toBe("");
  });

  it("lets the responsible reviewer view the document and dismiss the report", async () => {
    const list = vi.spyOn(api, "listPublicationReports").mockResolvedValueOnce([report]).mockResolvedValue([]);
    vi.spyOn(api, "loadResponsiblePublication").mockResolvedValue(document);
    const dismiss = vi.spyOn(api, "dismissPublicationReport").mockResolvedValue();
    render(createElement(PublicationReportsPanel, { platform: "web", organizationId: "org", departmentName }));
    expect(await screen.findByText("Wrong column")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "View document" }));
    const viewer = await screen.findByRole("dialog", { name: "Salary bands" });
    expect(await within(viewer).findByText("Confidential body")).toBeTruthy();
    fireEvent.click(within(viewer).getByRole("button", { name: /Close/ }));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(dismiss).toHaveBeenCalledWith("web", "org", "report"));
    expect(list).toHaveBeenCalledTimes(2);
    // The outcome stays visible after the last report closes.
    expect(await screen.findByText("Report dismissed")).toBeTruthy();
    expect(screen.queryByText("Wrong column")).toBeNull();
  });

  it("offers an Admin an inspection instead of the responsible view", async () => {
    vi.spyOn(api, "listPublicationReports").mockResolvedValue([{ ...report, canView: false }]);
    const inspect = vi.fn();
    render(createElement(PublicationReportsPanel, { platform: "web", organizationId: "org", departmentName, onInspect: inspect }));
    fireEvent.click(await screen.findByRole("button", { name: "Inspect" }));
    expect(screen.queryByRole("button", { name: "View document" })).toBeNull();
    expect(inspect).toHaveBeenCalledWith("doc", "Salary bands");
  });
});

describe("decision 0023 reader report", () => {
  it("requires a description and sends the report", async () => {
    const send = vi.spyOn(api, "reportPublicationProblem").mockResolvedValue();
    const reported = vi.fn();
    render(createElement(ReportProblemButton, { platform: "web", organizationId: "org", publishedVersionId: "version",
      title: "Salary bands", onReported: reported }));
    fireEvent.click(screen.getByRole("button", { name: "Report a problem" }));
    const dialog = screen.getByRole("dialog", { name: "Report a problem" });
    expect(within(dialog).getByText(/Other readers won’t/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Send report" }));
    expect(send).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByRole("textbox", { name: /What is wrong/ }), { target: { value: "Out of date" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send report" }));
    await waitFor(() => expect(send).toHaveBeenCalledWith("web", "org", "version", "Out of date"));
    expect(reported).toHaveBeenCalledWith("Report sent");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
