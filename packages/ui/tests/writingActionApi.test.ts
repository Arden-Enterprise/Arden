// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import * as client from "../src/shared/api-client";
import { runWritingAction } from "../src/shared/writing-action-api";

const requestId = "123e4567-e89b-42d3-a456-426614174000";
const organizationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function mockResponse(action: "IMPROVE" | "EXPLAIN", status: string | string[], text: string, sourceQuote = "") {
  vi.stubGlobal("crypto", { randomUUID: () => requestId });
  vi.spyOn(client, "apiRequest").mockResolvedValue({
    contractVersion: 1, requestId, action, status, text, sourceQuote,
  });
}

it.each([
  ["CHANGED", "IMPROVE", "Revised sentence.", ""],
  ["UNCHANGED", "IMPROVE", "No changes needed.", ""],
  ["EXPLAINED", "EXPLAIN", "A simple explanation.", "Original sentence."],
] as const)("accepts valid string status %s", async (status, action, responseText, sourceQuote) => {
  mockResponse(action, status, responseText, sourceQuote);
  const inputText = "Original sentence.";
  await expect(runWritingAction("web", organizationId, action, inputText,
    status === "EXPLAINED" ? "PAGE" : "SELECTION", new AbortController().signal))
    .resolves.toMatchObject({ status, text: responseText, sourceQuote });
});

it("rejects an array status instead of coercing it into the string union", async () => {
  mockResponse("IMPROVE", ["CHANGED"], "See https://attacker.example");
  await expect(runWritingAction("web", organizationId, "IMPROVE", "See https://trusted.example",
    "SELECTION", new AbortController().signal)).rejects.toMatchObject({ status: 502 });
});
