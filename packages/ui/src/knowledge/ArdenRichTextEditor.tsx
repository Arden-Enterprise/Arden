import type { BlockNoteEditor } from "@blocknote/core";
import { BlockNoteView } from "@blocknote/ariakit";
import { useCreateBlockNote } from "@blocknote/react";
import { useEffect, useId, useRef, useState } from "react";
import { parseArdenDocument, serializeArdenDocument } from "./ardenDocumentModel";
import { ardenDocumentSchema } from "./ardenDocumentSchema";
import type { Platform } from "../shared/types";
import { WritingActionPanel } from "../shared/WritingActionPanel";

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
  platform?: Platform;
  organizationId?: string;
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

function ToolbarButton({ label, active, disabled, className, children, onActivate }: {
  label: string;
  active: boolean;
  disabled: boolean;
  className?: string;
  children: string;
  onActivate: () => void;
}) {
  return <button type="button" aria-label={label} title={label} aria-pressed={active} disabled={disabled}
    className={[className, active ? "is-active" : ""].filter(Boolean).join(" ") || undefined}
    onMouseDown={(event) => event.preventDefault()} onClick={onActivate}>
    {children}
  </button>;
}

const textSizes: { value: TextSize; label: string }[] = [
  { value: "paragraph", label: "Normal" },
  { value: "heading-3", label: "Large" },
  { value: "heading-2", label: "Heading" },
];

function TextSizeMenu({ value, disabled, onChange }: { value: TextSize; disabled: boolean; onChange: (size: TextSize) => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const focusListOnOpen = useRef(false);
  const menuId = useId();
  const current = textSizes.find((option) => option.value === value) ?? textSizes[0];

  const close = (restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    if (focusListOnOpen.current) {
      focusListOnOpen.current = false;
      const selected = rootRef.current?.querySelector<HTMLButtonElement>("[role='option'][aria-selected='true']")
        ?? rootRef.current?.querySelector<HTMLButtonElement>("[role='option']");
      selected?.focus();
    }
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") close(true); };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const moveOption = (currentOption: HTMLButtonElement, direction: 1 | -1) => {
    const items = [...rootRef.current?.querySelectorAll<HTMLButtonElement>("[role='option']") ?? []];
    const index = items.indexOf(currentOption);
    items[Math.min(items.length - 1, Math.max(0, index + direction))]?.focus();
  };

  return <div className={`arden-text-size${open ? " is-open" : ""}`} ref={rootRef}>
    <button type="button" className="arden-text-size-trigger" ref={triggerRef} aria-haspopup="listbox" aria-expanded={open} aria-controls={menuId}
      aria-label={`Text size: ${current.label}`}
      disabled={disabled} onMouseDown={(event) => event.preventDefault()}
      onClick={(event) => {
        const next = !open;
        focusListOnOpen.current = next && event.detail === 0;
        setOpen(next);
      }}
      onKeyDown={(event) => {
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
        event.preventDefault();
        if (open) {
          const selected = rootRef.current?.querySelector<HTMLButtonElement>("[role='option'][aria-selected='true']")
            ?? rootRef.current?.querySelector<HTMLButtonElement>("[role='option']");
          selected?.focus();
          return;
        }
        focusListOnOpen.current = true;
        setOpen(true);
      }}>
      <span>{current.label}</span>
    </button>
    {open && <div className="arden-text-size-menu" id={menuId} role="listbox" aria-label="Text size">
      {textSizes.map((option) => <button type="button" key={option.value} role="option" aria-selected={option.value === value}
        className={option.value === value ? "is-selected" : undefined}
        onMouseDown={(event) => event.preventDefault()}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") { event.preventDefault(); moveOption(event.currentTarget, 1); }
          if (event.key === "ArrowUp") { event.preventDefault(); moveOption(event.currentTarget, -1); }
          if (event.key === "Escape") { event.preventDefault(); close(true); }
        }}
        onClick={() => { onChange(option.value); close(true); }}>{option.label}</button>)}
    </div>}
  </div>;
}

function ArdenFormattingToolbar({ editor, disabled, revision, writingEnabled, onWriting }: {
  editor: ArdenEditor; disabled: boolean; revision: number; writingEnabled: boolean; onWriting: () => void;
}) {
  void revision;
  const styles = editor.getActiveStyles();
  const block = editor.getTextCursorPosition().block;
  const toggleStyle = (style: TextStyle) => {
    editor.toggleStyles({ [style]: true });
    editor.focus();
  };

  return <div className="arden-format-toolbar" role="toolbar" aria-label="Document formatting">
    <TextSizeMenu value={currentTextSize(editor)} disabled={disabled} onChange={(size) => setTextSize(editor, size)} />
    <span className="arden-format-divider" aria-hidden="true" />
    <ToolbarButton label="Bold" active={styles.bold === true} disabled={disabled} onActivate={() => toggleStyle("bold")}>B</ToolbarButton>
    <ToolbarButton label="Italic" active={styles.italic === true} disabled={disabled} onActivate={() => toggleStyle("italic")}>I</ToolbarButton>
    <ToolbarButton label="Underline" active={styles.underline === true} disabled={disabled} onActivate={() => toggleStyle("underline")}>U</ToolbarButton>
    <ToolbarButton label="Strikethrough" active={styles.strike === true} disabled={disabled} onActivate={() => toggleStyle("strike")}>S</ToolbarButton>
    <ToolbarButton label="Inline code" active={styles.code === true} disabled={disabled} onActivate={() => toggleStyle("code")}>&lt;/&gt;</ToolbarButton>
    <span className="arden-format-divider" aria-hidden="true" />
    <div className="arden-format-group" role="group" aria-label="Lists and quote">
      <ToolbarButton className="arden-format-block" label="Bulleted list" active={block.type === "bulletListItem"} disabled={disabled} onActivate={() => toggleBlock(editor, "bulletListItem")}>•</ToolbarButton>
      <ToolbarButton className="arden-format-block" label="Numbered list" active={block.type === "numberedListItem"} disabled={disabled} onActivate={() => toggleBlock(editor, "numberedListItem")}>1.</ToolbarButton>
      <ToolbarButton className="arden-format-block" label="Quote" active={block.type === "quote"} disabled={disabled} onActivate={() => toggleBlock(editor, "quote")}>“</ToolbarButton>
    </div>
    {writingEnabled && <><span className="arden-format-divider" aria-hidden="true" />
      <button type="button" title="Select up to 12,000 characters to use AI writing"
        disabled={disabled || !editor.getSelectedText().trim() || editor.getSelectedText().length > 12_000}
        onMouseDown={event => event.preventDefault()} onClick={onWriting}>AI writing</button></>}
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

type WritingSelection = { text: string; from: number; to: number; body: string; plain: boolean; wholeBlock: boolean };

function captureWritingSelection(editor: ArdenEditor): WritingSelection | null {
  const text = editor.getSelectedText();
  const state = editor._tiptapEditor.state;
  const { from, to, $from, $to } = state.selection;
  if (!text.trim() || from === to || text.length > 12_000) return null;
  const sameBlock = $from.parent === $to.parent && $from.parent.isTextblock;
  let plain = sameBlock;
  state.doc.nodesBetween(from, to, node => {
    if (node.isText && node.marks.length > 0) plain = false;
  });
  return { text, from, to, body: serializeArdenDocument(editor.document), plain,
    wholeBlock: sameBlock && from === $from.start() && to === $to.end() };
}

export function ArdenRichTextEditor({ body, instanceKey, disabled = false, maxLength = 131_072, onChange, platform, organizationId }: Props) {
  const { editor, initialDocument } = useArdenEditor(body, instanceKey);
  const acceptedBody = useRef(body);
  const reverting = useRef(false);
  const [selectionRevision, setSelectionRevision] = useState(0);
  const [limitReached, setLimitReached] = useState(false);
  const [selectionTooLong, setSelectionTooLong] = useState(false);
  const [writingSelection, setWritingSelection] = useState<WritingSelection | null>(null);
  const [writingOpen, setWritingOpen] = useState(false);
  const suppressSelection = useRef(false);

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
    setWritingOpen(false);
    setWritingSelection(null);
    setSelectionRevision((value) => value + 1);
    onChange?.(encoded);
  };

  return <div className={`arden-rich-text-shell${disabled ? " is-disabled" : ""}`}>
    <ArdenFormattingToolbar editor={editor} disabled={disabled} revision={selectionRevision}
      writingEnabled={Boolean(platform && organizationId)} onWriting={() => {
        suppressSelection.current = false;
        setWritingSelection(captureWritingSelection(editor)); setWritingOpen(true);
      }} />
    <div onMouseDownCapture={() => { suppressSelection.current = false; }}
      onKeyDownCapture={(event) => { if (event.key !== "Escape") suppressSelection.current = false; }}
      onContextMenu={(event) => {
      if (disabled || !platform || !organizationId) return;
      const captured = captureWritingSelection(editor);
      if (!captured) return;
      event.preventDefault();
      suppressSelection.current = false;
      setWritingSelection(captured);
      setWritingOpen(true);
    }}><BlockNoteView editor={editor} theme="dark" editable={!disabled} onChange={handleChange}
      onSelectionChange={() => {
        setSelectionRevision((value) => value + 1);
        setSelectionTooLong(editor.getSelectedText().length > 12_000);
        if (suppressSelection.current) return;
        const captured = captureWritingSelection(editor);
        if (captured && platform && organizationId && !disabled) { setWritingSelection(captured); setWritingOpen(true); }
      }} className="arden-blocknote-editor"
      {...disabledBlockNoteUi} /></div>
    {platform && organizationId && writingOpen && writingSelection && <WritingActionPanel
      key={`${writingSelection.from}:${writingSelection.to}:${writingSelection.body.length}`}
      platform={platform} organizationId={organizationId} text={writingSelection.text} scope="SELECTION"
      canApply={action => !disabled && writingSelection.body === serializeArdenDocument(editor.document)
        && writingSelection.plain && (action !== "REFORMAT" || writingSelection.wholeBlock)}
      onClose={() => { suppressSelection.current = true; setWritingOpen(false); editor.focus(); }} onApply={(replacement, action) => {
        if (writingSelection.body !== serializeArdenDocument(editor.document) || !writingSelection.plain) return;
        if (action === "REFORMAT") {
          if (!writingSelection.wholeBlock) return;
          editor._tiptapEditor.commands.setTextSelection({ from: writingSelection.from, to: writingSelection.to });
          editor.pasteMarkdown(replacement);
        } else {
          const tiptap = editor._tiptapEditor;
          tiptap.view.dispatch(tiptap.state.tr.insertText(replacement, writingSelection.from, writingSelection.to));
        }
        suppressSelection.current = true;
        setWritingOpen(false); setWritingSelection(null); editor.focus();
      }} />}
    {limitReached && <p className="arden-document-limit" role="status">Edit not applied. Document limit: {maxLength.toLocaleString()} characters, including formatting.</p>}
    {selectionTooLong && <p className="arden-document-limit" role="status">Select up to 12,000 characters to use AI writing.</p>}
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
