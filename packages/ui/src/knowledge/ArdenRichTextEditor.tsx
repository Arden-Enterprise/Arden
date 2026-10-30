import type { BlockNoteEditor } from "@blocknote/core";
import { BlockNoteView } from "@blocknote/ariakit";
import { useCreateBlockNote } from "@blocknote/react";
import { useEffect, useRef, useState } from "react";
import { parseArdenDocument, serializeArdenDocument } from "./ardenDocumentModel";
import { ardenDocumentSchema } from "./ardenDocumentSchema";

type ArdenEditor = BlockNoteEditor<
  typeof ardenDocumentSchema.blockSchema,
  typeof ardenDocumentSchema.inlineContentSchema,
  typeof ardenDocumentSchema.styleSchema
>;

type Props = {
  body: string;
  instanceKey: string;
  disabled?: boolean;
  maxLength?: number;
  onChange?: (body: string) => void;
};

type TextSize = "paragraph" | "heading-3" | "heading-2";
type BlockKind = "bulletListItem" | "numberedListItem" | "quote";
type TextStyle = "bold" | "italic" | "underline" | "strike" | "code";

function currentTextSize(editor: ArdenEditor): TextSize {
  const block = editor.getTextCursorPosition().block;
  if (block.type !== "heading") return "paragraph";
  return block.props.level === 2 ? "heading-2" : "heading-3";
}

function selectedBlocks(editor: ArdenEditor) {
  return editor.getSelection()?.blocks ?? [editor.getTextCursorPosition().block];
}

function setTextSize(editor: ArdenEditor, size: TextSize) {
  for (const block of selectedBlocks(editor)) {
    if (size === "paragraph") editor.updateBlock(block, { type: "paragraph", props: {} });
    else editor.updateBlock(block, { type: "heading", props: { level: size === "heading-2" ? 2 : 3 } });
  }
  editor.focus();
}

function toggleBlock(editor: ArdenEditor, type: BlockKind) {
  for (const block of selectedBlocks(editor)) {
    editor.updateBlock(block, block.type === type ? { type: "paragraph", props: {} } : { type, props: {} });
  }
  editor.focus();
}

function ToolbarButton({ label, active, disabled, children, onActivate }: {
  label: string;
  active: boolean;
  disabled: boolean;
  children: string;
  onActivate: () => void;
}) {
  return <button type="button" aria-label={label} title={label} aria-pressed={active} disabled={disabled}
    className={active ? "is-active" : undefined} onMouseDown={(event) => event.preventDefault()} onClick={onActivate}>
    {children}
  </button>;
}

function ArdenFormattingToolbar({ editor, disabled, revision }: { editor: ArdenEditor; disabled: boolean; revision: number }) {
  void revision;
  const styles = editor.getActiveStyles();
  const block = editor.getTextCursorPosition().block;
  const toggleStyle = (style: TextStyle) => {
    editor.toggleStyles({ [style]: true });
    editor.focus();
  };

  return <div className="arden-format-toolbar" role="toolbar" aria-label="Document formatting">
    <label><span className="sr-only">Text size</span><select aria-label="Text size" value={currentTextSize(editor)} disabled={disabled}
      onChange={(event) => setTextSize(editor, event.target.value as TextSize)}>
      <option value="paragraph">Normal</option>
      <option value="heading-3">Large</option>
      <option value="heading-2">Heading</option>
    </select></label>
    <span className="arden-format-divider" aria-hidden="true" />
    <ToolbarButton label="Bold" active={styles.bold === true} disabled={disabled} onActivate={() => toggleStyle("bold")}>B</ToolbarButton>
    <ToolbarButton label="Italic" active={styles.italic === true} disabled={disabled} onActivate={() => toggleStyle("italic")}>I</ToolbarButton>
    <ToolbarButton label="Underline" active={styles.underline === true} disabled={disabled} onActivate={() => toggleStyle("underline")}>U</ToolbarButton>
    <ToolbarButton label="Strikethrough" active={styles.strike === true} disabled={disabled} onActivate={() => toggleStyle("strike")}>S</ToolbarButton>
    <ToolbarButton label="Inline code" active={styles.code === true} disabled={disabled} onActivate={() => toggleStyle("code")}>&lt;/&gt;</ToolbarButton>
    <span className="arden-format-divider" aria-hidden="true" />
    <ToolbarButton label="Bulleted list" active={block.type === "bulletListItem"} disabled={disabled} onActivate={() => toggleBlock(editor, "bulletListItem")}>• List</ToolbarButton>
    <ToolbarButton label="Numbered list" active={block.type === "numberedListItem"} disabled={disabled} onActivate={() => toggleBlock(editor, "numberedListItem")}>1. List</ToolbarButton>
    <ToolbarButton label="Quote" active={block.type === "quote"} disabled={disabled} onActivate={() => toggleBlock(editor, "quote")}>Quote</ToolbarButton>
  </div>;
}

function useArdenEditor(body: string, instanceKey: string) {
  const [initialDocument] = useState(() => parseArdenDocument(body));
  const editor = useCreateBlockNote({
    schema: ardenDocumentSchema,
    initialContent: initialDocument.blocks,
    domAttributes: { editor: { "aria-label": "Document text", spellcheck: "true" } },
  }, [instanceKey]);
  return { editor, initialDocument };
}

const disabledBlockNoteUi = {
  formattingToolbar: false,
  linkToolbar: false,
  slashMenu: false,
  sideMenu: false,
  filePanel: false,
  tableHandles: false,
  emojiPicker: false,
  comments: false,
  attributionTooltip: false,
} as const;

export function ArdenRichTextEditor({ body, instanceKey, disabled = false, maxLength = 131_072, onChange }: Props) {
  const { editor, initialDocument } = useArdenEditor(body, instanceKey);
  const acceptedBody = useRef(body);
  const reverting = useRef(false);
  const [selectionRevision, setSelectionRevision] = useState(0);
  const [limitReached, setLimitReached] = useState(false);

  useEffect(() => { acceptedBody.current = body; }, [body]);

  if (initialDocument.status === "invalid") {
    return <p className="arden-document-error" role="alert">Couldn’t open document.</p>;
  }

  const handleChange = () => {
    if (reverting.current) return;
    const encoded = serializeArdenDocument(editor.document);
    if (encoded.length > maxLength) {
      const accepted = parseArdenDocument(acceptedBody.current);
      reverting.current = true;
      editor.replaceBlocks(editor.document, accepted.blocks);
      reverting.current = false;
      setLimitReached(true);
      return;
    }
    acceptedBody.current = encoded;
    setLimitReached(false);
    setSelectionRevision((value) => value + 1);
    onChange?.(encoded);
  };

  return <div className={`arden-rich-text-shell${disabled ? " is-disabled" : ""}`}>
    <ArdenFormattingToolbar editor={editor} disabled={disabled} revision={selectionRevision} />
    <BlockNoteView editor={editor} theme="dark" editable={!disabled} onChange={handleChange}
      onSelectionChange={() => setSelectionRevision((value) => value + 1)} className="arden-blocknote-editor"
      {...disabledBlockNoteUi} />
    {limitReached && <p className="arden-document-limit" role="status">Document too long.</p>}
  </div>;
}

export function ArdenDocumentView({ body, instanceKey }: Pick<Props, "body" | "instanceKey">) {
  const { editor, initialDocument } = useArdenEditor(body, instanceKey);
  if (initialDocument.status === "invalid") {
    return <p className="arden-document-error" role="alert">Couldn’t open document.</p>;
  }
  return <BlockNoteView editor={editor} theme="dark" editable={false} className="arden-blocknote-document"
    {...disabledBlockNoteUi} />;
}
