import { ApiError, apiRequest } from "./api-client";
import type { Platform } from "./types";

export type WritingAction = "IMPROVE" | "REFORMAT" | "EXPLAIN";
export type WritingResult = { status: "CHANGED" | "UNCHANGED" | "EXPLAINED"; text: string; sourceQuote: string };

export async function runWritingAction(platform: Platform, organizationId: string, action: WritingAction, text: string,
  scope: "SELECTION" | "PAGE", signal: AbortSignal): Promise<WritingResult> {
  const requestId = crypto.randomUUID();
  const response = await apiRequest<unknown>(platform, `/api/v1/organizations/${organizationId}/ai/writing-actions`, { method: "POST",
    body: JSON.stringify({ requestId, action, scope, text }), signal });
  if (!response || typeof response !== "object") throw new ApiError(502, "Writing assistant returned an invalid result.");
  const value = response as Record<string, unknown>;
  if (value.contractVersion !== 1 || value.requestId !== requestId || value.action !== action
    || !["CHANGED", "UNCHANGED", "EXPLAINED"].includes(String(value.status))
    || (action === "EXPLAIN") !== (value.status === "EXPLAINED")
    || typeof value.text !== "string" || !value.text.trim() || value.text.length > 24_000
    || typeof value.sourceQuote !== "string" || value.sourceQuote.length > 300
    || (action === "EXPLAIN" && scope === "PAGE" && (!value.sourceQuote || !text.includes(value.sourceQuote)))
    || ((action !== "EXPLAIN" || scope === "SELECTION") && value.sourceQuote !== "")) {
    throw new ApiError(502, "Writing assistant returned an invalid result.");
  }
  return { status: value.status as WritingResult["status"], text: value.text, sourceQuote: value.sourceQuote };
}
