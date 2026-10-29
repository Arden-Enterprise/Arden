import { describe, expect, it } from "vitest";
import { PdfViewer, pdfFileName } from "../src/knowledge/PdfDocument";

describe("PDF reader citation navigation", () => {
  it("changes the embedded viewer identity when the citation moves to another page", () => {
    const first = PdfViewer({ url: "blob:synthetic-policy", title: "Policy", page: 2 });
    const next = PdfViewer({ url: "blob:synthetic-policy", title: "Policy", page: 7 });
    expect(first.props.data).toBe("blob:synthetic-policy#page=2");
    expect(next.props.data).toBe("blob:synthetic-policy#page=7");
    expect(next.key).not.toBe(first.key);
  });

  it("keeps a deterministic viewer identity for the first page and safe download names", () => {
    const viewer = PdfViewer({ url: "blob:synthetic-policy", title: "Policy" });
    expect(viewer.props.data).toBe("blob:synthetic-policy");
    expect(viewer.props["aria-label"]).toBe("PDF preview: Policy");
    expect(pdfFileName("Finance/Policy:2026.pdf")).toBe("Finance-Policy-2026.pdf");
  });
});
