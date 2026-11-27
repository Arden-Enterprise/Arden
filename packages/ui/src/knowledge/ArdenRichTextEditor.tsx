import type { BlockNoteEditor } from "@blocknote/core";
import { BlockNoteView } from "@blocknote/ariakit";
import { useCreateBlockNote } from "@blocknote/react";
import { useEffect, useId, useRef, useState } from "react";
import { markdownToSemanticDocument, semanticBodyText, serializeSemanticDocument } from "@arden/domain";
import { parseArdenDocument, serializeArdenDocument } from "./ardenDocumentModel";
import { ardenDocumentSchema } from "./ardenDocumentSchema";
import type { Platform } from "../shared/types";
import { WritingActionPanel, type InlineFormat } from "../shared/WritingActionPanel";
import { pointAnchor, type EditorActionAnchor } from "../shared/editor-action-anchor";
import { runEditorClipboard, type EditorClipboardAction } from "../shared/editor-clipboard";
import { uniformSelectionMarks } from "./writingSelectionMarks";

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
  /** Size of an encoded body against `maxLength`; characters by default, bytes for Private notes. */
  measure?: (body: string) => number;
  /** Private notes: AI writing without a selection works on the whole page. */
  pageWriting?: boolean;
  /** Private notes: the selection menu also toggles Bold, Italic, Strikethrough and Inline code. */
  selectionFormatting?: boolean;
};

const selectionFormats: InlineFormat[] = ["bold", "italic", "strike", "code"];

const writingLimit = 12_000;

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

function ArdenFormattingToolbar({ editor, disabled, revision, writingEnabled, pageWriting, onWriting }: {
  editor: ArdenEditor; disabled: boolean; revision: number; writingEnabled: boolean; pageWriting: boolean;
  onWriting: (source: HTMLButtonElement, keyboard: boolean) => void;
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
      <button type="button" title={pageWriting ? "Use AI writing on the selection, or on the whole note when nothing is selected"
        : "Select up to 12,000 characters to use AI writing"}
        disabled={disabled || !writingTarget(editor, pageWriting)}
        onMouseDown={event => event.preventDefault()} onClick={event => onWriting(event.currentTarget, event.detail === 0)}>AI writing</button></>}
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

type EditorMark = ArdenEditor["_tiptapEditor"]["state"]["doc"]["marks"][number];
/** `plain` means AI text can replace the selection safely; `marks` is the formatting the replacement keeps. */
type WritingSelection = { text: string; from: number; to: number; body: string; plain: boolean; wholeBlock: boolean;
  page?: boolean; marks?: readonly EditorMark[] };

function richTextAnchor(editor: ArdenEditor): EditorActionAnchor {
  const { view, state } = editor._tiptapEditor;
  const { from, to } = state.selection;
  const selection = view.dom.ownerDocument.getSelection();
  if (selection?.anchorNode && selection.focusNode && view.dom.contains(selection.anchorNode) &&
    view.dom.contains(selection.focusNode) && selection.rangeCount) {
    const range = selection.getRangeAt(0);
    const lines = Array.from(range.getClientRects?.() ?? []).filter(rect => rect.height > 0);
    const first = lines[0];
    const last = lines.at(-1);
    if (first && last) return { left: last.right, top: first.top, bottom: last.bottom };
  }
  const start = view.coordsAtPos(from);
  const end = view.coordsAtPos(to, -1);
  return { left: end.right,
    top: Math.min(start.top, end.top), bottom: Math.max(start.bottom, end.bottom) };
}

function captureWritingSelection(editor: ArdenEditor): WritingSelection | null {
  const text = editor.getSelectedText();
  const state = editor._tiptapEditor.state;
  const { from, to, $from, $to } = state.selection;
  if (!text.trim() || from === to || text.length > 12_000) return null;
  const sameBlock = $from.parent === $to.parent && $from.parent.isTextblock;
  // Text in one style (all bold, all italic, ...) keeps that style; mixed styles or links stay blocked.
  const marks = sameBlock ? uniformSelectionMarks(state.doc, from, to) : null;
  return { text, from, to, body: serializeArdenDocument(editor.document), plain: marks !== null, marks: marks ?? undefined,
    wholeBlock: sameBlock && from === $from.start() && to === $to.end() };
}

/** The whole document as an AI writing target, for editors that allow page-scope actions. */
function capturePage(editor: ArdenEditor): WritingSelection | null {
  const body = serializeArdenDocument(editor.document);
  const text = semanticBodyText(body) ?? "";
  if (!text.trim() || text.length > writingLimit) return null;
  // A page rewrite starts from plain text, so it cannot preserve blocks, links, or inline formatting.
  const plain = editor.document.every(block => block.type === "paragraph" && !block.children.length
    && block.content.every(part => part.type === "text" && !Object.keys(part.styles).length));
  return { text, from: 0, to: editor._tiptapEditor.state.doc.content.size, body, plain, wholeBlock: false, page: true };
}

function writingTarget(editor: ArdenEditor, pageWriting: boolean): WritingSelection | null {
  const { from, to } = editor._tiptapEditor.state.selection;
  if (from !== to && editor.getSelectedText().trim()) return captureWritingSelection(editor);
  return pageWriting ? capturePage(editor) : null;
}

export function ArdenRichTextEditor({ body, instanceKey, disabled = false, maxLength = 131_072, onChange, platform, organizationId,
  measure = (value) => value.length, pageWriting = false, selectionFormatting = false }: Props) {
  const { editor, initialDocument } = useArdenEditor(body, instanceKey);
  const acceptedBody = useRef(body);
  const reverting = useRef(false);
  const [selectionRevision, setSelectionRevision] = useState(0);
  const [limitReached, setLimitReached] = useState(false);
  const [selectionTooLong, setSelectionTooLong] = useState(false);
  const [writingSelection, setWritingSelection] = useState<WritingSelection | null>(null);
  const [popup, setPopup] = useState<{
    source: HTMLElement; anchor: EditorActionAnchor; keyboard?: boolean;
    clipboard?: { hasSelection: boolean; run: (action: EditorClipboardAction, signal: AbortSignal) => Promise<void> };
  } | null>(null);
  const suppressSelection = useRef(false);
  const formatting = useRef(false);

  useEffect(() => { acceptedBody.current = body; }, [body]);

  if (initialDocument.status === "invalid") {
    return <p className="arden-document-error" role="alert">Couldn’t open document.</p>;
  }

  const handleChange = () => {
    if (reverting.current) return;
    const encoded = serializeArdenDocument(editor.document);
    if (measure(encoded) > maxLength) {
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
    // A format toggled from the selection menu keeps the selection and its menu open.
    if (formatting.current) { onChange?.(encoded); return; }
    setPopup(null);
    setWritingSelection(null);
    onChange?.(encoded);
  };
  const closePopup = (restoreFocus: boolean) => {
    suppressSelection.current = true;
    setPopup(null);
    if (restoreFocus) {
      if (popup?.source instanceof HTMLButtonElement) popup.source.focus({ preventScroll: true });
      else editor.focus();
    }
  };
  const openContext = (point: EditorActionAnchor | undefined, keyboard: boolean) => {
    if (disabled || !platform || !organizationId) return;
    const { view, state } = editor._tiptapEditor;
    const { from, to } = state.selection;
    suppressSelection.current = true;
    setWritingSelection(from !== to ? captureWritingSelection(editor) : pageWriting ? capturePage(editor) : null);
    setPopup({ source: view.dom, anchor: from !== to || !point ? richTextAnchor(editor) : point, keyboard,
      clipboard: { hasSelection: from !== to, run: (action, signal) =>
        runEditorClipboard(action, platform, signal, () => {
          if (view.isDestroyed || !view.editable || !view.state.doc.eq(state.doc)) return false;
          suppressSelection.current = true;
          editor._tiptapEditor.commands.setTextSelection({ from, to });
          editor.focus();
          return true;
        }, text => { editor.pasteText(text); }) },
    });
  };

  return <div className={`arden-rich-text-shell${disabled ? " is-disabled" : ""}`}>
    <ArdenFormattingToolbar editor={editor} disabled={disabled} revision={selectionRevision}
      writingEnabled={Boolean(platform && organizationId)} pageWriting={pageWriting} onWriting={(source, keyboard) => {
        const captured = writingTarget(editor, pageWriting);
        if (!captured) return;
        suppressSelection.current = true;
        setWritingSelection(captured);
        setPopup({ source: keyboard ? source : editor._tiptapEditor.view.dom, anchor: richTextAnchor(editor), keyboard });
      }} />
    <div onMouseDownCapture={() => { suppressSelection.current = false; }}
      onKeyDownCapture={(event) => {
        if (event.key === "Escape") return;
        if (!disabled && platform && organizationId && (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10"))) {
          event.preventDefault();
          openContext(undefined, true);
          return;
        }
        suppressSelection.current = false;
        if (popup?.clipboard) setPopup(null);
      }}
      onContextMenu={(event) => {
        if (disabled || !platform || !organizationId || !editor._tiptapEditor.view.dom.contains(event.target as Node)) return;
        event.preventDefault();
        const keyboard = !event.clientX && !event.clientY && event.button === 0;
        openContext(keyboard ? undefined : pointAnchor(event.clientX, event.clientY), keyboard);
      }}><BlockNoteView editor={editor} theme="dark" editable={!disabled} onChange={handleChange}
      onSelectionChange={() => {
        setSelectionRevision((value) => value + 1);
        setSelectionTooLong(editor.getSelectedText().length > writingLimit);
        if (suppressSelection.current || !platform || !organizationId || disabled) return;
        const captured = captureWritingSelection(editor);
        setWritingSelection(captured);
        setPopup(captured ? { source: editor._tiptapEditor.view.dom, anchor: richTextAnchor(editor) } : null);
      }} className="arden-blocknote-editor"
      {...disabledBlockNoteUi} /></div>
    {platform && organizationId && !disabled && popup && <WritingActionPanel
      key={`${popup.clipboard ? "context" : "selection"}:${writingSelection?.from}:${writingSelection?.to}`}
      platform={platform} organizationId={organizationId} text={writingSelection?.text ?? ""} scope={writingSelection?.page ? "PAGE" : "SELECTION"}
      anchor={popup.anchor} source={popup.source} focusOnOpen={popup.keyboard} clipboard={popup.clipboard}
      formatting={selectionFormatting && writingSelection && !writingSelection.page ? {
        active: Object.fromEntries(selectionFormats.map(format => [format, editor.getActiveStyles()[format] === true])) as Record<InlineFormat, boolean>,
        onToggle: (format) => {
          formatting.current = true;
          try { editor.toggleStyles({ [format]: true }); } finally { formatting.current = false; }
          setWritingSelection(captureWritingSelection(editor));
        },
      } : undefined}
      canApply={action => Boolean(writingSelection?.plain && writingSelection.body === serializeArdenDocument(editor.document)
        && (writingSelection.page || action !== "REFORMAT" || writingSelection.wholeBlock))}
      onClose={closePopup} onApply={(replacement, action) => {
        if (!writingSelection?.plain || writingSelection.body !== serializeArdenDocument(editor.document)) return;
        if (writingSelection.page) {
          // A whole-page result is Markdown; it replaces every block with the supported Arden blocks.
          const parsed = parseArdenDocument(serializeSemanticDocument(markdownToSemanticDocument(replacement, () => crypto.randomUUID())));
          if (parsed.status !== "ok") return;
          editor.replaceBlocks(editor.document, parsed.blocks);
        } else if (action === "REFORMAT") {
          if (!writingSelection.wholeBlock) return;
          editor._tiptapEditor.commands.setTextSelection({ from: writingSelection.from, to: writingSelection.to });
          editor.pasteMarkdown(replacement);
        } else {
          const tiptap = editor._tiptapEditor;
          const { from, to, marks = [] } = writingSelection;
          tiptap.view.dispatch(replacement
            ? tiptap.state.tr.replaceWith(from, to, tiptap.state.schema.text(replacement, marks))
            : tiptap.state.tr.delete(from, to));
        }
        suppressSelection.current = true;
        setPopup(null); setWritingSelection(null); editor.focus();
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
