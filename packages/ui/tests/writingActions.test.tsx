// @vitest-environment jsdom
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PrivateNoteEditor } from "../src/personal-workspace/PrivateNoteEditor";
import * as api from "../src/shared/writing-action-api";

beforeEach(() => {
  Object.defineProperty(document, "fonts", { configurable: true, value: { ready: Promise.resolve() } });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function Note({ assistantEnabled = true, initialBody = "Alpha selected omega.", discardBody }: {
  assistantEnabled?: boolean; initialBody?: string; discardBody?: string;
} = {}) {
  const [body, setBody] = useState(initialBody);
  return <PrivateNoteEditor selectedNote={{ id: "note", title: "Note", body, updatedLabel: "Saved" }}
    draftTitle="Note" draftBody={body} isDirty={false} savedMessage=""
    toolbar={discardBody === undefined ? null : <button type="button" onClick={() => setBody(discardBody)}>Discard draft</button>}
    platform="web" organizationId="123e4567-e89b-42d3-a456-426614174000" assistantEnabled={assistantEnabled}
    onTitleChange={() => {}} onBodyChange={setBody} />;
}

it("replaces only the selected text after explicit Apply", async () => {
  const run = vi.spyOn(api, "runWritingAction").mockResolvedValue({ status: "CHANGED", text: "revised", sourceQuote: "" });
  render(<Note />);
  const editor = screen.getByRole("textbox", { name: "Note content" }) as HTMLTextAreaElement;
  editor.setSelectionRange(6, 14);
  fireEvent.select(editor);
  fireEvent.click(screen.getByRole("button", { name: "Improve Writing" }));
  await screen.findByText("revised");
  expect(editor.value).toBe("Alpha selected omega.");
  expect(run).toHaveBeenCalledWith("web", "123e4567-e89b-42d3-a456-426614174000", "IMPROVE", "selected", "SELECTION", expect.any(AbortSignal));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Replace selection" })); });
  expect(editor.value).toBe("Alpha revised omega.");
});

it("shows Explain in chat without editing the note", async () => {
  vi.spyOn(api, "runWritingAction").mockResolvedValue({ status: "EXPLAINED", text: "A simple idea.", sourceQuote: "" });
  render(<Note />);
  const editor = screen.getByRole("textbox", { name: "Note content" }) as HTMLTextAreaElement;
  editor.setSelectionRange(6, 14);
  fireEvent.select(editor);
  fireEvent.click(screen.getByRole("button", { name: "Explain" }));
  await screen.findByLabelText("AI explanation");
  expect(editor.value).toBe("Alpha selected omega.");
  expect(screen.queryByRole("button", { name: "Replace selection" })).toBeNull();
});

it("uses current note context and shows an exact quote when no text is selected", async () => {
  const run = vi.spyOn(api, "runWritingAction").mockResolvedValue({ status: "EXPLAINED",
    text: "It describes a chosen passage.", sourceQuote: "Alpha selected omega." });
  render(<Note />);
  fireEvent.click(screen.getByRole("button", { name: "AI writing" }));
  fireEvent.click(screen.getByRole("button", { name: "Explain" }));
  await screen.findByText(/From this note:/);
  expect(run).toHaveBeenCalledWith("web", "123e4567-e89b-42d3-a456-426614174000", "EXPLAIN", "Alpha selected omega.", "PAGE", expect.any(AbortSignal));
  expect((screen.getByRole("textbox", { name: "Note content" }) as HTMLTextAreaElement).value).toBe("Alpha selected omega.");
});

it("formats the selection from the menu and from shortcuts, even without AI writing", async () => {
  render(<Note assistantEnabled={false} />);
  const editor = screen.getByRole("textbox", { name: "Note content" }) as HTMLTextAreaElement;
  editor.setSelectionRange(6, 14);
  fireEvent.select(editor);
  expect(screen.queryByRole("button", { name: "Improve Writing" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Bold" }));
  expect(editor.value).toBe("Alpha **selected** omega.");
  await waitFor(() => expect(screen.getByRole("button", { name: "Bold" }).getAttribute("aria-pressed")).toBe("true"));
  expect(editor.value.slice(editor.selectionStart, editor.selectionEnd)).toBe("selected");
  fireEvent.keyDown(editor, { key: "b", ctrlKey: true });
  expect(editor.value).toBe("Alpha selected omega.");
  await waitFor(() => expect(editor.value.slice(editor.selectionStart, editor.selectionEnd)).toBe("selected"));
  fireEvent.keyDown(editor, { key: "i", ctrlKey: true });
  expect(editor.value).toBe("Alpha _selected_ omega.");
});

it("closes a selection menu with Escape and preserves the note", () => {
  render(<Note />);
  const editor = screen.getByRole("textbox", { name: "Note content" }) as HTMLTextAreaElement;
  editor.setSelectionRange(6, 14);
  fireEvent.select(editor);
  expect(screen.getByRole("region", { name: "Writing assistant" })).toBeTruthy();
  fireEvent.keyDown(editor, { key: "Escape" });
  expect(screen.queryByRole("region", { name: "Writing assistant" })).toBeNull();
  expect(editor.value).toBe("Alpha selected omega.");
});

it("opens from right-click on selected text and keeps the original until Replace", async () => {
  const run = vi.spyOn(api, "runWritingAction").mockResolvedValue({ status: "CHANGED", text: "tidied", sourceQuote: "" });
  render(<Note />);
  const editor = screen.getByRole("textbox", { name: "Note content" }) as HTMLTextAreaElement;
  editor.setSelectionRange(6, 14);
  fireEvent.contextMenu(editor);
  fireEvent.click(screen.getByRole("button", { name: "Reformat" }));
  await screen.findByText("tidied");
  expect(run).toHaveBeenCalledWith("web", expect.any(String), "REFORMAT", "selected", "SELECTION", expect.any(AbortSignal));
  expect(editor.value).toBe("Alpha selected omega.");
});

it("right-click without a selection uses the current note", async () => {
  const run = vi.spyOn(api, "runWritingAction").mockResolvedValue({ status: "EXPLAINED", text: "Simple.", sourceQuote: "Alpha" });
  render(<Note />);
  const editor = screen.getByRole("textbox", { name: "Note content" }) as HTMLTextAreaElement;
  fireEvent.contextMenu(editor);
  fireEvent.click(screen.getByRole("button", { name: "Explain" }));
  await screen.findByLabelText("AI explanation");
  expect(run).toHaveBeenCalledWith("web", expect.any(String), "EXPLAIN", "Alpha selected omega.", "PAGE", expect.any(AbortSignal));
});

it("keeps the native context menu when AI writing is disabled", () => {
  render(<Note assistantEnabled={false} />);
  const editor = screen.getByRole("textbox", { name: "Note content" });
  expect(fireEvent.contextMenu(editor)).toBe(true);
  expect(screen.queryByRole("region", { name: "Writing assistant" })).toBeNull();
});

it("places the compact context menu next to the pointer and focuses it from Shift+F10", () => {
  render(<Note />);
  const editor = screen.getByRole("textbox", { name: "Note content" });
  fireEvent.contextMenu(editor, { button: 2, clientX: 125, clientY: 140 });
  const menu = screen.getByRole("region", { name: "Writing assistant" });
  expect(menu.style.left).toBe("125px");
  expect(menu.style.top).toBe("146px");
  expect(menu.classList.contains("is-expanded")).toBe(false);
  fireEvent.keyDown(editor, { key: "Escape" });
  fireEvent.keyDown(editor, { key: "F10", shiftKey: true });
  const paste = screen.getByRole("button", { name: "Paste" });
  expect(document.activeElement).toBe(paste);
  fireEvent.keyDown(paste, { key: "Escape" });
  expect(document.activeElement).toBe(editor);
});

it("copies and cuts the captured selection through the editor's native command", async () => {
  render(<Note />);
  const editor = screen.getByRole("textbox", { name: "Note content" }) as HTMLTextAreaElement;
  const command = vi.fn(() => {
    expect(document.activeElement).toBe(editor);
    expect(editor.value.slice(editor.selectionStart, editor.selectionEnd)).toBe("selected");
    return true;
  });
  const original = Object.getOwnPropertyDescriptor(document, "execCommand");
  Object.defineProperty(document, "execCommand", { configurable: true, value: command });
  try {
    for (const action of ["Copy", "Cut"]) {
      editor.setSelectionRange(6, 14);
      fireEvent.contextMenu(editor, { button: 2, clientX: 120, clientY: 150 });
      fireEvent.click(screen.getByRole("button", { name: action }));
      await waitFor(() => expect(screen.queryByRole("region", { name: "Writing assistant" })).toBeNull());
    }
    expect(command.mock.calls).toEqual([["copy"], ["cut"]]);
  } finally {
    if (original) Object.defineProperty(document, "execCommand", original);
    else Reflect.deleteProperty(document, "execCommand");
  }
});

it("pastes into the selected range and at the caret in an empty note", async () => {
  const readText = vi.fn().mockResolvedValue("pasted");
  vi.stubGlobal("navigator", { clipboard: { readText } });
  for (const [body, start, end, expected] of [
    ["Alpha selected omega.", 6, 14, "Alpha pasted omega."],
    ["", 0, 0, "pasted"],
  ] as const) {
    const note = render(<Note initialBody={body} />);
    const editor = screen.getByRole("textbox", { name: "Note content" }) as HTMLTextAreaElement;
    editor.setSelectionRange(start, end);
    fireEvent.contextMenu(editor, { button: 2, clientX: 120, clientY: 150 });
    if (!body) expect(screen.queryByRole("button", { name: "Improve Writing" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Paste" }));
    await waitFor(() => expect(editor.value).toBe(expected));
    expect(screen.queryByRole("region", { name: "Writing assistant" })).toBeNull();
    note.unmount();
  }
  expect(readText).toHaveBeenCalledTimes(2);
});

it("reports no change without a Replace action", async () => {
  vi.spyOn(api, "runWritingAction").mockResolvedValue({ status: "UNCHANGED", text: "No changes needed.", sourceQuote: "" });
  render(<Note />);
  fireEvent.click(screen.getByRole("button", { name: "AI writing" }));
  fireEvent.click(screen.getByRole("button", { name: "Improve Writing" }));
  await screen.findByText("No changes needed.");
  expect(screen.queryByRole("button", { name: /Replace/ })).toBeNull();
  expect((screen.getByRole("textbox", { name: "Note content" }) as HTMLTextAreaElement).value).toBe("Alpha selected omega.");
});

it("discards an in-flight suggestion when the note changes", async () => {
  let finish!: (value: api.WritingResult) => void;
  vi.spyOn(api, "runWritingAction").mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  render(<Note />);
  const editor = screen.getByRole("textbox", { name: "Note content" }) as HTMLTextAreaElement;
  editor.setSelectionRange(6, 14);
  fireEvent.select(editor);
  fireEvent.click(screen.getByRole("button", { name: "Improve Writing" }));
  fireEvent.change(editor, { target: { value: "Updated elsewhere." } });
  await act(async () => { finish({ status: "CHANGED", text: "Stale result", sourceQuote: "" }); });
  expect(editor.value).toBe("Updated elsewhere.");
  expect(screen.queryByText("Stale result")).toBeNull();
});

it("clears a whole-note result when the draft body is discarded", async () => {
  vi.spyOn(api, "runWritingAction").mockResolvedValue({ status: "CHANGED", text: "Generated replacement", sourceQuote: "" });
  render(<Note initialBody="Unsaved draft." discardBody="Saved content." />);
  fireEvent.click(screen.getByRole("button", { name: "AI writing" }));
  fireEvent.click(screen.getByRole("button", { name: "Improve Writing" }));
  await screen.findByText("Generated replacement");
  fireEvent.click(screen.getByRole("button", { name: "Discard draft" }));
  expect((screen.getByRole("textbox", { name: "Note content" }) as HTMLTextAreaElement).value).toBe("Saved content.");
  expect(screen.queryByText("Generated replacement")).toBeNull();
  expect(screen.getByRole("button", { name: "Improve Writing" })).toBeTruthy();
});
