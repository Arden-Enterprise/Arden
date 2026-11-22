// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MaintenanceQueue } from "../src/maintenance/MaintenanceQueue";
import { MyReports } from "../src/maintenance/MyReports";
import type { MaintenanceCase } from "../src/maintenance/maintenance-client";

afterEach(() => cleanup());

const unread: MaintenanceCase = {
  kind: "queue", caseId: "case-1", reporterStatus: "Submitted", title: "IT Support Guide", revision: 1, unread: true,
};

describe("maintenance lists", () => {
  it("shows loading, empty, unavailable, and unread states", () => {
    const { rerender } = render(<MaintenanceQueue items={[]} loading error="" onOpen={() => undefined} onRetry={() => undefined} />);
    expect(screen.getByRole("status").textContent).toContain("Loading cases");
    rerender(<MaintenanceQueue items={[]} loading={false} error="The queue is unavailable." onOpen={() => undefined} onRetry={() => undefined} />);
    expect(screen.getByRole("alert").textContent).toContain("The queue is unavailable.");
    rerender(<MaintenanceQueue items={[]} loading={false} error="" onOpen={() => undefined} onRetry={() => undefined} />);
    expect(screen.getByRole("heading", { name: "No unassigned cases" })).toBeTruthy();
    rerender(<MaintenanceQueue items={[unread]} loading={false} error="" onOpen={() => undefined} onRetry={() => undefined} />);
    expect(screen.getByText("Unread")).toBeTruthy();
    const retry = vi.fn();
    rerender(<MyReports items={[]} loading={false} error="Reports are unavailable." onOpen={() => undefined} onRetry={retry} />);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("counts an Org Admin's unassigned case as unassigned", () => {
    const adminView: MaintenanceCase = { ...unread, kind: "assigned", caseId: "case-2", assigneeMembershipId: null, unread: false };
    render(<MaintenanceQueue items={[adminView]} loading={false} error="" onOpen={() => undefined} onRetry={() => undefined} />);
    expect(screen.getByRole("button", { name: /Open IT Support Guide, Submitted/ })).toBeTruthy();
  });
});
