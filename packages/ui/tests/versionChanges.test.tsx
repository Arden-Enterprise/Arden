// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VersionChanges } from "../src/maintenance/VersionChanges";

afterEach(() => cleanup());

describe("version changes", () => {
  it("labels additions and removals and offers the manual path", () => {
    const { rerender } = render(<VersionChanges comparison={{ unavailable: false, rows: [
      { kind: "removed", text: "Restart the service." },
      { kind: "added", text: "Restart the service after saving." },
    ] }} />);
    expect(screen.getByText("Restart the service after saving.").closest("li")?.textContent).toContain("+ Added");
    expect(screen.getByText("Restart the service.").closest("li")?.textContent).toContain("− Removed");
    rerender(<VersionChanges comparison={{ unavailable: true }} />);
    expect(screen.getByText(/Open the original versions/)).toBeTruthy();
  });

  it("shows an identical pair without added or removed labels", () => {
    render(<VersionChanges comparison={{ unavailable: false, rows: [
      { kind: "context", text: "Restart the service." },
      { kind: "collapsed", text: "Unchanged context" },
      { kind: "context", text: "Leave the rest." },
    ] }} />);
    expect(screen.getByText("These versions have the same lines.")).toBeTruthy();
    expect(screen.getByText("Unchanged context")).toBeTruthy();
    expect(screen.queryByText(/\+ Added/)).toBeNull();
    expect(screen.queryByText(/− Removed/)).toBeNull();
    expect(screen.queryByRole("button", { name: /Later version|Earlier version/ })).toBeNull();
  });

  it("opens the collapsed unchanged lines from the button", () => {
    render(<VersionChanges comparison={{ unavailable: false, rows: [
      { kind: "collapsed", text: "Unchanged context", hidden: ["Keep the old note."] },
    ] }} />);
    const button = screen.getByRole("button", { name: "Show unchanged lines" });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(button);
    expect(screen.getByText("Keep the old note.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Hide unchanged lines" }).getAttribute("aria-expanded")).toBe("true");
  });

  it("links an added line to the later version and keeps unchanged context collapsed", () => {
    const open = vi.fn();
    render(<VersionChanges onOpenOriginal={open} comparison={{ unavailable: false, rows: [
      { kind: "collapsed", text: "Unchanged context" },
      { kind: "added", text: "Record the ticket number." },
    ] }} />);
    expect(screen.getByText("Unchanged context")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open later version: Record the ticket number." }));
    expect(open).toHaveBeenCalledWith("later");
  });

  it("opens the reported version when a case has a single published version", () => {
    const open = vi.fn();
    render(<VersionChanges comparison={null} onOpenReported={open} />);
    expect(screen.getByText(/one published version/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open reported version" }));
    expect(open).toHaveBeenCalledOnce();
  });
});
