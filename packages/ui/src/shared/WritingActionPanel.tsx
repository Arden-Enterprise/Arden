import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { runWritingAction, type WritingAction, type WritingResult } from "./writing-action-api";
import { ApiError } from "./api-client";
import type { EditorActionAnchor } from "./editor-action-anchor";
import type { EditorClipboardAction } from "./editor-clipboard";
import type { Platform } from "./types";

const clipboardActions = [{ action: "cut", label: "Cut" }, { action: "copy", label: "Copy" },
  { action: "paste", label: "Paste" }] as const;

export type InlineFormat = "bold" | "italic" | "strike" | "code";

const formatButtons: { format: InlineFormat; label: string; shortcut: string; glyph: string }[] = [
  { format: "bold", label: "Bold", shortcut: "Ctrl+B", glyph: "B" },
  { format: "italic", label: "Italic", shortcut: "Ctrl+I", glyph: "I" },
  { format: "strike", label: "Strikethrough", shortcut: "Ctrl+Shift+S", glyph: "S" },
  { format: "code", label: "Inline code", shortcut: "Ctrl+E", glyph: "</>" },
];

const aiIcons: Record<"IMPROVE" | "REFORMAT" | "EXPLAIN", string> = {
  IMPROVE: "M8 1.5l1.4 3.6 3.6 1.4-3.6 1.4L8 11.5 6.6 7.9 3 6.5l3.6-1.4L8 1.5zM12.5 10l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8z",
  REFORMAT: "M2.5 4h11M2.5 8h7M2.5 12h9",
  EXPLAIN: "M8 14.5A6.5 6.5 0 1 0 8 1.5a6.5 6.5 0 0 0 0 13zM6.2 6.2a1.9 1.9 0 1 1 2.6 1.8c-.5.2-.8.6-.8 1.1v.4M8 11.6v.1",
};

function AiIcon({ action }: { action: keyof typeof aiIcons }) {
  const filled = action === "IMPROVE";
  return <svg className="writing-action-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"
    fill={filled ? "currentColor" : "none"} stroke={filled ? "none" : "currentColor"} strokeWidth="1.4" strokeLinecap="round">
    <path d={aiIcons[action]} />
  </svg>;
}

export function WritingActionPanel({
  platform, organizationId, text, scope, onApply, onClose, canApply = true,
  anchor, source, focusOnOpen, clipboard, formatting, aiEnabled = true,
}: {
  platform: Platform; organizationId: string; text: string; scope: "SELECTION" | "PAGE";
  onApply: (replacement: string, action: WritingAction) => void; onClose: (restoreFocus: boolean) => void;
  canApply?: boolean | ((action: WritingAction) => boolean);
  anchor: EditorActionAnchor;
  source: HTMLElement;
  focusOnOpen?: boolean;
  clipboard?: { hasSelection: boolean; run: (action: EditorClipboardAction, signal: AbortSignal) => Promise<void> };
  /** Formatting for the selected text, shown above the AI actions. */
  formatting?: { active: Record<InlineFormat, boolean>; onToggle: (format: InlineFormat) => void };
  aiEnabled?: boolean;
}) {
  const [pending, setPending] = useState<WritingAction | null>(null);
  const [result, setResult] = useState<(WritingResult & { action: WritingAction }) | null>(null);
  const [error, setError] = useState("");
  const [clipboardPending, setClipboardPending] = useState(false);
  const editable = (action: WritingAction) => typeof canApply === "function" ? canApply(action) : canApply;
  const controller = useRef<AbortController | null>(null);
  const panel = useRef<HTMLElement>(null);
  const expanded = Boolean(pending || result || error);
  const canWrite = aiEnabled && Boolean(text.trim()) && text.length <= 12_000;
  const close = (restoreFocus: boolean) => {
    controller.current?.abort();
    onClose(restoreFocus);
  };

  useLayoutEffect(() => {
    const element = panel.current;
    if (!element) return;
    if (element.showPopover && !element.matches(":popover-open")) element.showPopover();
    const place = () => {
      const margin = 8;
      const gap = 6;
      const below = Math.max(0, window.innerHeight - anchor.bottom - gap - margin);
      const above = Math.max(0, anchor.top - gap - margin);
      const fullHeight = element.scrollHeight + element.offsetHeight - element.clientHeight;
      const openAbove = fullHeight > below && above > below;
      element.style.maxHeight = `${Math.min(openAbove ? above : below, 440)}px`;
      const rightLimit = window.innerWidth - margin - element.offsetWidth;
      element.style.left = `${Math.max(margin, Math.min(anchor.left, rightLimit))}px`;
      element.style.top = `${Math.max(margin, openAbove
        ? anchor.top - gap - element.offsetHeight : anchor.bottom + gap)}px`;
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(element);
    return () => observer.disconnect();
  }, [anchor, expanded, pending, result, error]);

  useLayoutEffect(() => {
    if (focusOnOpen) panel.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true });
  }, [focusOnOpen]);

  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && (source.contains(event.target as Node) || panel.current?.contains(event.target as Node))) {
        event.preventDefault();
        close(true);
      }
    };
    const onOutside = (event: Event) => {
      if (event.type === "pointerdown" && source instanceof HTMLButtonElement && source.contains(event.target as Node)) return;
      if (!panel.current?.contains(event.target as Node)) close(false);
    };
    const onResize = () => close(false);
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onOutside, true);
    window.addEventListener("scroll", onOutside, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onOutside, true);
      window.removeEventListener("scroll", onOutside, true);
      window.removeEventListener("resize", onResize);
    };
  }, [onClose, source]);

  const run = async (action: WritingAction) => {
    controller.current?.abort();
    const next = new AbortController();
    controller.current = next;
    setPending(action); setResult(null); setError("");
    try {
      const output = await runWritingAction(platform, organizationId, action, text, scope, next.signal);
      if (!next.signal.aborted) setResult({ ...output, action });
    } catch (cause) {
      if (!next.signal.aborted) setError(cause instanceof ApiError && cause.code === "WRITING_AI_DISABLED"
        ? "AI writing is not enabled for this organization."
        : cause instanceof ApiError && cause.code === "WRITING_BUSY"
          ? "Please wait a moment before trying again."
          : "Writing assistant is unavailable. Try again.");
    } finally { if (controller.current === next) { controller.current = null; setPending(null); } }
  };

  const runClipboard = async (action: EditorClipboardAction) => {
    if (!clipboard || controller.current) return;
    const next = new AbortController();
    controller.current = next;
    setClipboardPending(true);
    try {
      await clipboard.run(action, next.signal);
      if (!next.signal.aborted) onClose(true);
    } catch {
      if (!next.signal.aborted) setError(`Use the keyboard shortcut to ${action}.`);
    } finally {
      if (controller.current === next) { controller.current = null; setClipboardPending(false); }
    }
  };

  return <section ref={panel} popover={typeof source.showPopover === "function" ? "manual" : undefined}
    className={`writing-action-panel${expanded ? " is-expanded" : ""}`}
    aria-label="Writing assistant"
    onMouseDown={event => { if ((event.target as Element).closest("button")) event.preventDefault(); }}>
    {expanded && <div className="writing-action-head"><strong>Writing assistant</strong><button type="button" aria-label="Close writing assistant"
      onClick={() => close(true)}>×</button></div>}
    {clipboard && <div className="writing-action-options writing-action-clipboard" role="group" aria-label="Clipboard">
      {clipboardActions.map(({ action, label }) => <button key={action} type="button"
        disabled={Boolean(pending) || clipboardPending || (action !== "paste" && !clipboard.hasSelection)}
        onClick={() => void runClipboard(action)}>{label}</button>)}
    </div>}
    {formatting && !expanded && <div className="writing-action-format" role="toolbar" aria-label="Text formatting">
      {formatButtons.map(({ format, label, shortcut, glyph }) => <button key={format} type="button"
        className={`writing-format-${format}${formatting.active[format] ? " is-active" : ""}`}
        aria-label={label} aria-pressed={formatting.active[format]} title={`${label} (${shortcut})`}
        disabled={Boolean(pending) || clipboardPending} onClick={() => formatting.onToggle(format)}>{glyph}</button>)}
    </div>}
    {canWrite && <div className="writing-action-options writing-action-ai" role="group" aria-label="Writing actions">
      {!expanded && <span className="writing-action-label" aria-hidden="true">Arden AI</span>}
      <button type="button" disabled={Boolean(pending) || clipboardPending || !editable("IMPROVE")} onClick={() => void run("IMPROVE")}><AiIcon action="IMPROVE" />Improve Writing</button>
      <button type="button" disabled={Boolean(pending) || clipboardPending || !editable("REFORMAT")} onClick={() => void run("REFORMAT")}><AiIcon action="REFORMAT" />Reformat</button>
      <button type="button" disabled={Boolean(pending) || clipboardPending} onClick={() => void run("EXPLAIN")}><AiIcon action="EXPLAIN" />Explain</button>
    </div>}
    {canWrite && scope === "PAGE" && !editable("IMPROVE") && !editable("REFORMAT")
      && <p role="status">To edit with AI, select text in one paragraph with a single style and no links.</p>}
    {aiEnabled && text.length > 12_000 && <p role="status">Select up to 12,000 characters to use AI writing.</p>}
    {pending && <p role="status">{pending === "EXPLAIN" ? "Explaining…" : "Preparing suggestion…"}</p>}
    {error && <p role="alert">{error}</p>}
    {result?.status === "UNCHANGED" && <p role="status">{result.text}</p>}
    {result?.status === "EXPLAINED" && <div className="writing-action-chat" role="status" aria-label="AI explanation">
      <span>Arden AI</span><p>{result.text}</p>
      {result.sourceQuote && <small>From this note: “{result.sourceQuote}”</small>}</div>}
    {result?.status === "CHANGED" && <div className="writing-action-suggestion"><span>Suggested text</span>
      <pre>{result.text}</pre><div className="writing-action-result-actions">
        <button type="button" className="primary-button" disabled={!editable(result.action)}
          onClick={() => onApply(result.text, result.action)}>Replace {scope === "SELECTION" ? "selection" : "page"}</button>
        <button type="button" className="secondary-button" onClick={() => setResult(null)}>Dismiss</button>
      </div>{!editable(result.action)
        && <p role="status">This selection cannot be replaced safely. Select text in one paragraph with a single style and no links, then try again.</p>}</div>}
  </section>;
}
