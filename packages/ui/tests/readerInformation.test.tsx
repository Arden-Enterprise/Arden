// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { KnowledgeDocumentDetail, type ReaderDocumentMetadata } from "../src/knowledge/KnowledgeDocumentDetail";
import { validityLabel } from "../src/knowledge/KnowledgeLibraryBrowse";
import { PdfViewer } from "../src/knowledge/PdfDocument";

afterEach(cleanup);

const base: ReaderDocumentMetadata = {
  title: "Synthetic lifecycle reference", ownerDepartment: "HR", summary: "", publishedDate: "2026-11-12T03:00:00.000Z",
  activeVersionId: "v1", versions: [{ id: "v1", label: "1.0", status: "EFFECTIVE" }],
};
const show = (metadata: ReaderDocumentMetadata, onVersionChange?: (id: string) => void) =>
  render(createElement(KnowledgeDocumentDetail, { metadata, content: createElement("p", null, "Body"), onBack: () => undefined, onVersionChange }));

describe("reader document information (15 Nov 2026 layout)", () => {
  it("shows one version as text, Current status, readers, and no effective date", () => {
    show({ ...base, readers: "Whole organization" });
    expect(screen.queryByRole("combobox", { name: "Document version" })).toBeNull();
    expect(screen.getByText("Current")).toBeTruthy();
    expect(screen.getByText("Whole organization")).toBeTruthy();
    expect(screen.queryByText(/Effective date/i)).toBeNull();
    expect(screen.queryByText("Valid until")).toBeNull();
    expect(screen.getByText("v1.0")).toBeTruthy();
  });

  it("shows the optional expiration date and the days left when it is close", () => {
    show({ ...base, expirationDate: "2026-11-27", versions: [{ id: "v1", label: "1.0", status: "EXPIRING", expiresInDays: 12 }] });
    expect(screen.getByText("Valid until")).toBeTruthy();
    expect(screen.getByText("Expires in 12 days")).toBeTruthy();
  });

  it("says when an older publication has no recorded version instead of inventing one", () => {
    show({ ...base, versions: [{ id: "v1", label: "", status: "PUBLISHED" }] });
    expect(screen.getByText("Not recorded")).toBeTruthy();
    expect(screen.getByText("Current")).toBeTruthy();
  });

  it("offers a version selector only when there is more than one version to choose", () => {
    show({ ...base, versions: [{ id: "v2", label: "2.0", status: "EFFECTIVE" }, { id: "v1", label: "1.0", status: "EXPIRED" }], activeVersionId: "v2" }, () => undefined);
    expect(screen.getByRole("combobox", { name: "Document version" })).toBeTruthy();
  });
});

describe("Home validity labels and PDF chrome", () => {
  it("uses one vocabulary for the Home list", () => {
    expect(validityLabel({ status: "Current", daysLeft: null })).toBe("Current");
    expect(validityLabel({ status: "Expiring soon", daysLeft: 1 })).toBe("Expires in 1 day");
    expect(validityLabel({ status: "Expiring soon", daysLeft: 0 })).toBe("Expires today");
    expect(validityLabel({ status: "Expired", daysLeft: 0 })).toBe("Expired");
  });

  it("hides the browser PDF toolbar only in the governed reader", () => {
    expect(PdfViewer({ url: "blob:synthetic", title: "Policy", readerChrome: true }).props.data)
      .toBe("blob:synthetic#toolbar=0&navpanes=0&view=FitH");
    expect(PdfViewer({ url: "blob:synthetic", title: "Policy", page: 3, readerChrome: true }).props.data)
      .toBe("blob:synthetic#page=3&toolbar=0&navpanes=0&view=FitH");
    expect(PdfViewer({ url: "blob:synthetic", title: "Policy" }).props.data).toBe("blob:synthetic");
  });
});
