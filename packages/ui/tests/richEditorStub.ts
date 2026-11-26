import { createElement } from "react";
import { semanticBodyText } from "@arden/domain";

/**
 * jsdom cannot drive BlockNote, so note tests replace the rich editor with a text box that shows the
 * document's text and reports edits as plain text (a body the note backend accepts as written).
 */
export function ArdenRichTextEditor({ body, onChange }: { body: string; onChange?: (body: string) => void }) {
  return createElement("textarea", { "aria-label": "Note content", "data-editor-body": body,
    defaultValue: semanticBodyText(body) ?? "", onChange: (event: { target: { value: string } }) => onChange?.(event.target.value) });
}

export function ArdenDocumentView() { return null; }
