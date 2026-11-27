// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ARDEN_DOCUMENT_PREFIX, parseSemanticDocument, plainTextToSemanticDocument, serializeSemanticDocument } from "@arden/domain";
import { PrivateNoteEditor } from "../src/personal-workspace/PrivateNoteEditor";
import { noteEditorBody, noteText } from "../src/personal-workspace/noteDocument";
import { mergePdfIntoNote } from "../src/personal-workspace/pdfImport";

vi.mock("../src/knowledge/ArdenRichTextEditor", () => import("./richEditorStub"));
vi.mock("../src/shared/useAutosizeTextarea", () => ({ useAutosizeTextarea: () => ({ current: null }) }));
afterEach(cleanup);

const rich = (text: string) => serializeSemanticDocument(plainTextToSemanticDocument(text, (index) => `b${index}`));

function Note({ initialBody, discardBody }: { initialBody: string; discardBody?: string }) {
  const [body, setBody] = useState(initialBody);
  return <>
    <PrivateNoteEditor selectedNote={{ id: "note", title: "Note", body, updatedLabel: "Saved" }}
      draftTitle="Note" draftBody={body} isDirty={false} savedMessage=""
      toolbar={discardBody === undefined ? null : <button type="button" onClick={() => setBody(discardBody)}>Discard draft</button>}
      platform="web" organizationId="org" assistantEnabled onTitleChange={() => {}} onBodyChange={setBody} />
    <output aria-label="Saved body">{body}</output>
  </>;
}

describe("Private note rich editor", () => {
  it("opens a legacy Markdown note formatted, without changing the stored body", async () => {
    render(<Note initialBody={"**Contribution 26/11**\n- _first_ point"} />);
    const editor = await screen.findByRole("textbox", { name: "Note content" });
    const parsed = parseSemanticDocument(editor.getAttribute("data-editor-body")!);
    expect(parsed.ok && parsed.document.blocks.map(block => [block.type, block.type === "paragraph" || block.type === "bulletListItem" ? block.content : null]))
      .toEqual([
        ["paragraph", [{ type: "text", text: "Contribution 26/11", styles: { bold: true } }]],
        ["bulletListItem", [{ type: "text", text: "first", styles: { italic: true } }, { type: "text", text: " point", styles: {} }]],
      ]);
    expect(screen.getByLabelText("Saved body").textContent).toBe("**Contribution 26/11**\n- _first_ point");
    expect(screen.getByText("30 characters")).toBeTruthy();
  });

  it("keeps the editor open while typing and reopens it when the body changes from outside", async () => {
    render(<Note initialBody={rich("Saved content.")} discardBody={rich("Saved content.")} />);
    const editor = await screen.findByRole("textbox", { name: "Note content" });
    fireEvent.change(editor, { target: { value: "Local edit" } });
    expect(screen.getByRole("textbox", { name: "Note content" })).toBe(editor);
    fireEvent.click(screen.getByRole("button", { name: "Discard draft" }));
    const reopened = screen.getByRole("textbox", { name: "Note content" }) as HTMLTextAreaElement;
    expect(reopened).not.toBe(editor);
    expect(reopened.value).toBe("Saved content.");
  });

  it("counts readable characters, not the stored document encoding", async () => {
    render(<Note initialBody={rich("Hello")} />);
    await screen.findByRole("textbox", { name: "Note content" });
    expect(screen.getByText("5 characters")).toBeTruthy();
  });

  it("leaves legacy notes beyond the rich document limits editable as text", () => {
    const original = "Line\n".repeat(2_001);
    render(<Note initialBody={original} />);
    const editor = screen.getByRole("textbox", { name: "Note content" }) as HTMLTextAreaElement;
    expect(editor.value).toBe(original);
    fireEvent.change(editor, { target: { value: `${original}Added text` } });
    expect(screen.getByLabelText("Saved body").textContent).toBe(`${original}Added text`);
    expect(screen.getByRole("textbox", { name: "Note content" })).toBe(editor);
  });
});

describe("note document helpers", () => {
  it("reads text from rich and legacy bodies", () => {
    expect(noteText(rich("One\nTwo"))).toBe("One\nTwo");
    expect(noteText("**plain**")).toBe("**plain**");
    expect(noteText(`${ARDEN_DOCUMENT_PREFIX}{broken`)).toBe("");
    expect(noteEditorBody(rich("Kept"))).toBe(rich("Kept"));
  });

  it("appends a PDF to a rich note as paragraphs and keeps the note's own title", () => {
    const merged = mergePdfIntoNote({ title: "Meeting", body: rich("My notes\n") },
      { fileName: "report.pdf", metadataTitle: null, pages: ["Page one", "Page two"] }, "Untitled private note");
    expect(merged.title).toBe("Meeting");
    expect(noteText(merged.body)).toBe("My notes\n\nPage one\n\nPage two");
  });

  it("shrinks a rich-note PDF import to fit the encoded note limit", () => {
    const merged = mergePdfIntoNote({ title: "Meeting", body: rich("Start") },
      { fileName: "big.pdf", metadataTitle: null, pages: Array.from({ length: 20 }, (_, index) => `Page ${index} ${"x".repeat(400)}`) },
      "Untitled private note", 4_000);
    expect(new TextEncoder().encode(merged.body).length).toBeLessThanOrEqual(4_000);
    expect(merged.imported.truncated).toBe(true);
    expect(noteText(merged.body).startsWith("Start\n\nPage 0")).toBe(true);
  });
});
