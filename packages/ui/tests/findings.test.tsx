// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Findings } from "../src/maintenance/Findings";

afterEach(() => cleanup());

describe("findings", () => {
  it("shows a citation after success and nothing kept after cancel", () => {
    const onOpenCitation = vi.fn();
    const { rerender } = render(<Findings onOpenCitation={onOpenCitation}
      run={{ state: "succeeded", findings: [{ versionId: "v4", summary: "The line changed." }] }} />);
    fireEvent.click(screen.getByRole("button", { name: "Open citation" }));
    expect(onOpenCitation).toHaveBeenCalledWith("v4");
    rerender(<Findings run={{ state: "cancelled", findings: [] }} />);
    expect(screen.getByText(/Earlier findings were not kept/)).toBeTruthy();
  });
});
