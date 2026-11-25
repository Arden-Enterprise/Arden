// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentPanel } from "../src/app/AgentPanel";
import { AskPanelResizeHandle } from "../src/app/AskPanelResizeHandle";
import { ASK_PANEL_MAX, ASK_PANEL_MIN, askPanelMaxFor, clampAskPanelWidth, defaultAskPanelWidth, readAskPanelWidth,
  writeAskPanelWidth } from "../src/app/askPanelWidth";
import { installTestDialogs } from "./dialogTestSupport";

/** Spec F13-RESIZE: the docked Ask Arden panel can be resized and remembers its width. */
let restoreDialogs: () => void;
beforeEach(() => { restoreDialogs = installTestDialogs(); window.localStorage.clear(); });
afterEach(() => { cleanup(); restoreDialogs(); vi.restoreAllMocks(); });

describe("Ask Arden panel width", () => {
  it("keeps the page its readable width and stays within 320–720 px", () => {
    expect(askPanelMaxFor(2000)).toBe(ASK_PANEL_MAX);
    expect(askPanelMaxFor(1000)).toBe(480);
    expect(askPanelMaxFor(700)).toBe(ASK_PANEL_MIN);
    expect(clampAskPanelWidth(100, 600)).toBe(ASK_PANEL_MIN);
    expect(clampAskPanelWidth(900, 600)).toBe(600);
    expect(clampAskPanelWidth(450.6, 600)).toBe(451);
    expect(defaultAskPanelWidth(1100)).toBe(340);
    expect(defaultAskPanelWidth(1400)).toBe(360);
  });

  it("remembers a valid width, forgets it on reset and ignores bad or unavailable storage", () => {
    expect(readAskPanelWidth()).toBeNull();
    writeAskPanelWidth(480);
    expect(readAskPanelWidth()).toBe(480);
    window.localStorage.setItem("arden.askPanelWidth", "5000");
    expect(readAskPanelWidth()).toBeNull();
    writeAskPanelWidth(null);
    expect(window.localStorage.getItem("arden.askPanelWidth")).toBeNull();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(readAskPanelWidth()).toBeNull();
    expect(() => writeAskPanelWidth(400)).not.toThrow();
  });
});

function Harness({ onCommit, onReset }: { onCommit: (width: number) => void; onReset: () => void }) {
  const [width, setWidth] = useState(360);
  return <AskPanelResizeHandle width={width} max={600} onChange={setWidth} onCommit={onCommit} onReset={onReset} />;
}

describe("Ask Arden resize handle", () => {
  it("is a keyboard splitter that announces its width", () => {
    const commit = vi.fn();
    render(<Harness onCommit={commit} onReset={vi.fn()} />);
    const handle = screen.getByRole("separator", { name: "Resize Ask Arden" });
    expect(handle.getAttribute("aria-orientation")).toBe("vertical");
    expect(handle.getAttribute("aria-valuenow")).toBe("360");
    expect(handle.getAttribute("aria-valuemin")).toBe("320");
    expect(handle.getAttribute("aria-valuemax")).toBe("600");
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(handle.getAttribute("aria-valuenow")).toBe("376");
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(handle.getAttribute("aria-valuenow")).toBe("344");
    fireEvent.keyDown(handle, { key: "End" });
    expect(handle.getAttribute("aria-valuenow")).toBe("600");
    fireEvent.keyDown(handle, { key: "Home" });
    expect(handle.getAttribute("aria-valuenow")).toBe("320");
    expect(commit).toHaveBeenLastCalledWith(320);
  });

  it("widens when the edge is dragged left, clamps, saves once at the end and resets on double-click", () => {
    const commit = vi.fn();
    const reset = vi.fn();
    render(<Harness onCommit={commit} onReset={reset} />);
    const handle = screen.getByRole("separator", { name: "Resize Ask Arden" });
    fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientX: 1000 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 900 });
    expect(handle.getAttribute("aria-valuenow")).toBe("460");
    expect(handle.className).toContain("is-dragging");
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 200 });
    expect(handle.getAttribute("aria-valuenow")).toBe("600");
    expect(commit).not.toHaveBeenCalled();
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 200 });
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith(600);
    fireEvent.doubleClick(handle);
    expect(reset).toHaveBeenCalledTimes(1);
  });
});

describe("Ask Arden panel splitter placement", () => {
  const props = { platform: "web" as const, organizationId: "org", source: { kind: "company" } as const,
    onClose: () => undefined, onOpenAskArden: () => undefined };
  const resize = { width: 360, max: 600, onChange: vi.fn(), onCommit: vi.fn(), onReset: vi.fn() };

  it("shows the splitter only on the open docked panel", () => {
    const view = render(<AgentPanel open {...props} resize={resize} />);
    expect(screen.getByRole("separator", { name: "Resize Ask Arden" })).toBeTruthy();
    view.rerender(<AgentPanel open {...props} />);
    expect(screen.queryByRole("separator", { name: "Resize Ask Arden" })).toBeNull();
    view.rerender(<AgentPanel open={false} {...props} resize={resize} />);
    expect(screen.queryByRole("separator", { name: "Resize Ask Arden" })).toBeNull();
  });
});
