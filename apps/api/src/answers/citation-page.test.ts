import { describe, expect, it } from "vitest";
import { citationPage } from "./citation-page.js";

describe("citationPage", () => {
  it("reads the PDF page from a source block", () => {
    expect(citationPage(["pdf-page-12"])).toBe(12);
    expect(citationPage(["pdf-page-7-heading"])).toBe(7);
    expect(citationPage(["pdf-page-3-paragraph-2"])).toBe(3);
  });

  it("falls back to the parent section and ignores non-PDF blocks", () => {
    expect(citationPage(["policy-introduction"], "pdf-page-4-heading")).toBe(4);
    expect(citationPage(["policy-introduction"], null)).toBeUndefined();
    expect(citationPage(["pdf-page-0", "pdf-page-x"])).toBeUndefined();
  });
});
