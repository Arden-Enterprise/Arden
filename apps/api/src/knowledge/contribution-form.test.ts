import { describe, expect, it } from "vitest";
import { isIsoDate, normalizeChangeDescription, normalizeKeywords, submitFieldError, validateDates,
  validateRelatedDocumentIds, type SubmitFacts } from "./contribution-form.js";

const ready: SubmitFacts = {
  title: "Onboarding guide", categoryId: "category", categoryActive: true, hasTargetReaders: true,
  effectiveDate: "2026-12-01", expirationDate: null, changeDescription: null, isNewVersion: false,
};

describe("T3.2 contribution form rules", () => {
  it("accepts only real YYYY-MM-DD dates and an Expiration Date later than the Effective Date", () => {
    expect(isIsoDate("2026-02-28")).toBe(true);
    for (const value of ["2026-02-30", "2026-2-01", "01/12/2026", "2026-13-01"]) expect(isIsoDate(value)).toBe(false);
    expect(validateDates("2026-12-01", "2026-12-02")).toEqual({ ok: true, value: null });
    expect(validateDates("2026-12-01", "2026-12-01")).toMatchObject({ ok: false, field: "expirationDate" });
    expect(validateDates("2026-12-01", "2026-11-30")).toMatchObject({ ok: false, field: "expirationDate" });
    expect(validateDates(null, "2026-11-30")).toEqual({ ok: true, value: null });
    expect(validateDates("2026-12-xx", null)).toMatchObject({ ok: false, field: "effectiveDate" });
  });

  it("normalizes keywords and refuses blanks, long entries, duplicates and more than 20", () => {
    expect(normalizeKeywords([" VPN ", "onboarding"])).toEqual({ ok: true, value: ["VPN", "onboarding"] });
    expect(normalizeKeywords(["vpn", "VPN"])).toMatchObject({ ok: false, field: "keywords" });
    expect(normalizeKeywords(["  "])).toMatchObject({ ok: false, field: "keywords" });
    expect(normalizeKeywords(["x".repeat(51)])).toMatchObject({ ok: false, field: "keywords" });
    expect(normalizeKeywords(Array.from({ length: 21 }, (_, index) => `k${index}`))).toMatchObject({ ok: false });
  });

  it("treats a blank change description as missing and limits its length", () => {
    expect(normalizeChangeDescription("  ")).toEqual({ ok: true, value: null });
    expect(normalizeChangeDescription(" Added the VPN step ")).toEqual({ ok: true, value: "Added the VPN step" });
    expect(normalizeChangeDescription("x".repeat(2001))).toMatchObject({ ok: false, field: "changeDescription" });
  });

  it("refuses self links, duplicates and more than 20 related documents", () => {
    expect(validateRelatedDocumentIds("doc", ["a", "b"])).toEqual({ ok: true, value: ["a", "b"] });
    expect(validateRelatedDocumentIds("doc", ["doc"])).toMatchObject({ ok: false, field: "relatedDocumentIds" });
    expect(validateRelatedDocumentIds("doc", ["a", "a"])).toMatchObject({ ok: false });
    expect(validateRelatedDocumentIds("doc", Array.from({ length: 21 }, (_, index) => `d${index}`))).toMatchObject({ ok: false });
  });

  it("names the first missing required field in form order", () => {
    expect(submitFieldError(ready)).toBeNull();
    expect(submitFieldError({ ...ready, title: " " })).toMatchObject({ field: "title", missing: true });
    expect(submitFieldError({ ...ready, categoryId: null, hasTargetReaders: false })).toMatchObject({ field: "categoryId", missing: true });
    expect(submitFieldError({ ...ready, categoryActive: false })).toMatchObject({ field: "categoryId", missing: false });
    expect(submitFieldError({ ...ready, hasTargetReaders: false })).toMatchObject({ field: "targetReaders" });
    // Both dates are optional; only their order is checked.
    expect(submitFieldError({ ...ready, effectiveDate: null })).toBeNull();
    expect(submitFieldError({ ...ready, effectiveDate: null, expirationDate: "2027-01-31" })).toBeNull();
    expect(submitFieldError({ ...ready, expirationDate: "2026-11-01" })).toMatchObject({ field: "expirationDate", missing: false });
  });

  it("requires a change description only for a new version", () => {
    expect(submitFieldError({ ...ready, isNewVersion: true })).toMatchObject({ field: "changeDescription", missing: true });
    expect(submitFieldError({ ...ready, isNewVersion: true, changeDescription: "Updated the VPN step" })).toBeNull();
  });
});
