// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WritingActionPanel, type InlineFormat } from "../src/shared/WritingActionPanel";
import * as api from "../src/shared/writing-action-api";

// The Private note and shared draft editors place this panel; these tests cover the panel's own contract.
beforeEach(() => {
  Object.defineProperty(document, "fonts", { configurable: true, value: { ready: Promise.resolve() } });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const organizationId = "123e4567-e89b-42d3-a456-426614174000";

function panel(props: Partial<Parameters<typeof WritingActionPanel>[0]> = {}) {
  const source = document.createElement("div");
  document.body.append(source);
  const onApply = vi.fn();
  const onClose = vi.fn();
  const view = render(<WritingActionPanel platform="web" organizationId={organizationId} text="selected" scope="SELECTION"
    anchor={{ left: 125, top: 140, bottom: 146 }} source={source} onApply={onApply} onClose={onClose} {...props} />);
  return { ...view, onApply, onClose };
}

it("shows a suggestion and changes the text only after explicit Replace", async () => {
  const run = vi.spyOn(api, "runWritingAction").mockResolvedValue({ status: "CHANGED", text: "revised", sourceQuote: "" });
  const { onApply } = panel();
  fireEvent.click(screen.getByRole("button", { name: "Improve Writing" }));
  await screen.findByText("revised");
  expect(run).toHaveBeenCalledWith("web", organizationId, "IMPROVE", "selected", "SELECTION", expect.any(AbortSignal));
  expect(onApply).not.toHaveBeenCalled();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Replace selection" })); });
  expect(onApply).toHaveBeenCalledWith("revised", "IMPROVE");
});

it("shows Explain in the panel without offering Replace", async () => {
  vi.spyOn(api, "runWritingAction").mockResolvedValue({ status: "EXPLAINED", text: "A simple idea.", sourceQuote: "" });
  const { onApply } = panel();
  fireEvent.click(screen.getByRole("button", { name: "Explain" }));
  await screen.findByLabelText("AI explanation");
  expect(screen.queryByRole("button", { name: "Replace selection" })).toBeNull();
  expect(onApply).not.toHaveBeenCalled();
});

it("sends the whole page and shows an exact quote for a page explanation", async () => {
  const run = vi.spyOn(api, "runWritingAction").mockResolvedValue({ status: "EXPLAINED",
    text: "It describes a chosen passage.", sourceQuote: "Alpha selected omega." });
  panel({ text: "Alpha selected omega.", scope: "PAGE" });
  fireEvent.click(screen.getByRole("button", { name: "Explain" }));
  await screen.findByText(/From this note:/);
  expect(run).toHaveBeenCalledWith("web", organizationId, "EXPLAIN", "Alpha selected omega.", "PAGE", expect.any(AbortSignal));
});

it("offers Replace page for a whole-page rewrite", async () => {
  vi.spyOn(api, "runWritingAction").mockResolvedValue({ status: "CHANGED", text: "**Rewritten** note", sourceQuote: "" });
  const { onApply } = panel({ text: "Alpha selected omega.", scope: "PAGE" });
  fireEvent.click(screen.getByRole("button", { name: "Improve Writing" }));
  const replace = await screen.findByRole("button", { name: "Replace page" });
  await act(async () => { fireEvent.click(replace); });
  expect(onApply).toHaveBeenCalledWith("**Rewritten** note", "IMPROVE");
});

it("shows the formatting row with its active state, also without AI writing", () => {
  const onToggle = vi.fn<(format: InlineFormat) => void>();
  panel({ aiEnabled: false, formatting: { active: { bold: true, italic: false, strike: false, code: false }, onToggle } });
  expect(screen.queryByRole("button", { name: "Improve Writing" })).toBeNull();
  expect(screen.getByRole("button", { name: "Bold" }).getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByRole("button", { name: "Italic" }).getAttribute("aria-pressed")).toBe("false");
  fireEvent.click(screen.getByRole("button", { name: "Italic" }));
  fireEvent.click(screen.getByRole("button", { name: "Inline code" }));
  expect(onToggle.mock.calls).toEqual([["italic"], ["code"]]);
});

it("closes with Escape and returns focus to the editor", () => {
  const { onClose } = panel();
  fireEvent.keyDown(screen.getByRole("region", { name: "Writing assistant" }), { key: "Escape" });
  expect(onClose).toHaveBeenCalledWith(true);
});

it("places the compact menu next to the anchor and focuses its first command from the keyboard", () => {
  panel({ focusOnOpen: true, clipboard: { hasSelection: false, run: vi.fn() } });
  const menu = screen.getByRole("region", { name: "Writing assistant" });
  expect(menu.style.left).toBe("125px");
  expect(menu.style.top).toBe("152px");
  expect(menu.classList.contains("is-expanded")).toBe(false);
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Paste" }));
  expect((screen.getByRole("button", { name: "Copy" }) as HTMLButtonElement).disabled).toBe(true);
});

it("runs clipboard commands through the editor and closes", async () => {
  const run = vi.fn().mockResolvedValue(undefined);
  const { onClose } = panel({ clipboard: { hasSelection: true, run } });
  fireEvent.click(screen.getByRole("button", { name: "Cut" }));
  await waitFor(() => expect(onClose).toHaveBeenCalled());
  expect(run).toHaveBeenCalledWith("cut", expect.any(AbortSignal));
});

it("reports no change without a Replace action", async () => {
  vi.spyOn(api, "runWritingAction").mockResolvedValue({ status: "UNCHANGED", text: "No changes needed.", sourceQuote: "" });
  panel({ scope: "PAGE" });
  fireEvent.click(screen.getByRole("button", { name: "Improve Writing" }));
  await screen.findByText("No changes needed.");
  expect(screen.queryByRole("button", { name: /Replace/ })).toBeNull();
});

it("withholds Replace when the editor reports the captured text is stale", async () => {
  vi.spyOn(api, "runWritingAction").mockResolvedValue({ status: "CHANGED", text: "revised", sourceQuote: "" });
  panel({ canApply: action => action !== "IMPROVE" });
  expect((screen.getByRole("button", { name: "Improve Writing" }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: "Reformat" }) as HTMLButtonElement).disabled).toBe(false);
});
