// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ReportIssueDialog } from "../src/maintenance/ReportIssueDialog";

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = () => undefined;
  HTMLDialogElement.prototype.close = () => undefined;
});
afterEach(() => cleanup());

describe("report an issue dialog", () => {
  it("keeps one request key across a failed submit and explains an empty report", async () => {
    const keys: string[] = [];
    const onSubmit = vi.fn(async (_description: string, requestKey: string) => {
      keys.push(requestKey);
      if (keys.length === 1) throw new Error("Couldn’t confirm this action.");
      return "case-1";
    });
    render(<ReportIssueDialog title="IT Support Guide" versionLabel="v3" busy={false} onClose={() => undefined}
      onSubmit={onSubmit} onViewReports={() => undefined} />);
    const hidden = { hidden: true };
    fireEvent.click(screen.getByRole("button", { name: "Submit report", ...hidden }));
    expect((await screen.findByRole("alert", hidden)).textContent).toContain("Describe the issue.");
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("What needs attention?", hidden), { target: { value: "Step 3 is wrong." } });
    fireEvent.click(screen.getByRole("button", { name: "Submit report", ...hidden }));
    expect((await screen.findByRole("alert", hidden)).textContent).toContain("Couldn’t confirm this action.");
    fireEvent.click(screen.getByRole("button", { name: "Submit report", ...hidden }));
    expect((await screen.findByRole("status", hidden)).textContent).toContain("case-1");
    expect(keys).toEqual([keys[0], keys[0]]);
  });

  it("sends an optional page and passage with a reviewer objective", async () => {
    const onSubmit = vi.fn(async () => "case-2");
    render(<ReportIssueDialog title="IT Support Guide" versionLabel="v3" purpose="review" busy={false}
      onClose={() => undefined} onSubmit={onSubmit} onViewReports={() => undefined} />);
    const hidden = { hidden: true };
    fireEvent.change(screen.getByLabelText("Review objective", hidden), { target: { value: "Confirm the restart step." } });
    fireEvent.change(screen.getByLabelText("Page", hidden), { target: { value: "4" } });
    fireEvent.change(screen.getByLabelText("Passage", hidden), { target: { value: "Restart the service." } });
    fireEvent.click(screen.getByRole("button", { name: "Start review", ...hidden }));
    expect(await screen.findByRole("status", hidden)).toBeTruthy();
    expect(onSubmit).toHaveBeenCalledWith("Confirm the restart step.", expect.any(String), {
      page: 4, passage: "Restart the service.",
    });
  });
});
