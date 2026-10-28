import { describe, expect, it } from "vitest";
import { readerDocumentStatusAt } from "../src/knowledge/KnowledgeDocumentDetail";

describe("published document reader status", () => {
  const now = new Date("2026-10-24T12:00:00.000Z");

  it("marks a future publication as upcoming", () => {
    expect(readerDocumentStatusAt("2026-11-01T00:00:00.000Z", null, now)).toBe("UPCOMING");
  });

  it("marks a publication whose validity ended as expired", () => {
    expect(readerDocumentStatusAt("2026-01-01T00:00:00.000Z", "2026-10-24T12:00:00.000Z", now)).toBe("EXPIRED");
  });

  it("keeps an active publication effective", () => {
    expect(readerDocumentStatusAt("2026-01-01T00:00:00.000Z", null, now)).toBe("EFFECTIVE");
  });
});
