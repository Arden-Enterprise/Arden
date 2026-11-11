// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReviewList } from "../src/knowledge/ReviewList";
import type { AssignedKnowledgeReview, DecidedKnowledgeReview } from "../src/shared/api-client";

const pending: AssignedKnowledgeReview[] = [
  { submissionId: "s1", snapshotId: "v1", title: "FPD-SOP-061 — Incident escalation runbook", departmentId: "eng",
    classification: "INTERNAL", submittedAt: "2026-10-28T09:00:00Z", approvalBlocked: false, versionNo: 3, authorName: "Minh Tran" },
  { submissionId: "s2", snapshotId: "v2", title: "API gateway timeout guidance", departmentId: "eng",
    classification: "INTERNAL", submittedAt: "2026-10-27T09:00:00Z", approvalBlocked: true, versionNo: 1, authorName: null },
];
const decided: DecidedKnowledgeReview[] = [
  { submissionId: "s3", title: "Information security policy", departmentId: "sec", classification: "INTERNAL",
    versionNo: 5, decision: "APPROVED", decidedAt: "2026-10-18T09:00:00Z", submittedAt: "2026-10-17T09:00:00Z",
    publicationState: "ACTIVE", authorName: "Bao Long" },
  { submissionId: "s4", title: "Expense reimbursement policy (draft)", departmentId: "fin", classification: "INTERNAL",
    versionNo: 1, decision: "REJECTED", decidedAt: "2026-10-10T09:00:00Z", submittedAt: "2026-10-09T09:00:00Z",
    publicationState: "NONE", authorName: "Thu Ha" },
];
const names: Record<string, string> = { eng: "Product Engineering", sec: "Security", fin: "Finance" };

function renderList(onOpen = vi.fn()) {
  render(createElement(ReviewList, { pending, decided, busy: false, onOpen, onRefresh: vi.fn(),
    departmentName: (id: string | null) => names[id ?? ""] ?? "Unassigned" }));
  return onOpen;
}

afterEach(cleanup);

describe("REV-02 review list", () => {
  it("groups pending and decided submissions with code, version, department, author and counts", () => {
    renderList();
    expect(screen.getByRole("button", { name: /Needs review\s*2/ }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: /Approved\s*1/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Rejected\s*1/ })).toBeTruthy();
    const first = screen.getByRole("button", { name: /Incident escalation runbook/ });
    expect(within(first).getByText("FPD-SOP-061")).toBeTruthy();
    expect(within(first).getByText("v3")).toBeTruthy();
    expect(within(first).getByText("Product Engineering")).toBeTruthy();
    expect(within(first).getByText("Minh Tran")).toBeTruthy();
    expect(within(screen.getByRole("button", { name: /API gateway timeout guidance/ })).getByText("—")).toBeTruthy();
  });

  it("opens only pending submissions; decided history is read-only", () => {
    const onOpen = renderList();
    fireEvent.click(screen.getByRole("button", { name: /Incident escalation runbook/ }));
    expect(onOpen).toHaveBeenCalledWith("s1");
    expect(screen.queryByRole("button", { name: /Information security policy/ })).toBeNull();
    expect(screen.getByText("Information security policy").closest(".review-row")?.getAttribute("title"))
      .toMatch(/^Approved .* · Published$/);
  });

  it("collapses groups, filters rows and hides decided groups from display options", () => {
    renderList();
    fireEvent.click(screen.getByRole("button", { name: /^Needs review/ }));
    expect(screen.queryByText("Incident escalation runbook")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Needs review/ }));
    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "Filter reviews" }), { target: { value: "finance" } });
    expect(screen.queryByText("Incident escalation runbook")).toBeNull();
    expect(screen.getByText("Expense reimbursement policy (draft)")).toBeTruthy();
    expect(screen.getByText("No matches.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    fireEvent.click(screen.getByRole("button", { name: "Display options" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Rejected" }));
    expect(screen.queryByRole("button", { name: /Rejected\s*1/ })).toBeNull();
  });
});
