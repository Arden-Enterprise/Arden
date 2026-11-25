import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { runWritingAction, type WritingAction, type WritingResult } from "./writing-action-api";
import { ApiError } from "./api-client";
import type { EditorActionAnchor } from "./editor-action-anchor";
import type { EditorClipboardAction } from "./editor-clipboard";
import type { Platform } from "./types";

const clipboardActions = [{ action: "cut", label: "Cut" }, { action: "copy", label: "Copy" },
  { action: "paste", label: "Paste" }] as const;

export function WritingActionPanel({
  platform, organizationId, text, scope, onApply, onClose, canApply = true,
  anchor, source, focusOnOpen, clipboard,
}: {
  platform: Platform; organizationId: string; text: string; scope: "SELECTION" | "PAGE";
  onApply: (replacement: string, action: WritingAction) => void; onClose: (restoreFocus: boolean) => void;
  canApply?: boolean | ((action: WritingAction) => boolean);
  anchor: EditorActionAnchor;
  source: HTMLElement;
  focusOnOpen?: boolean;
  clipboard?: { hasSelection: boolean; run: (action: EditorClipboardAction, signal: AbortSignal) => Promise<void> };
}) {
  const [pending, setPending] = useState<WritingAction | null>(null);
  const [result, setResult] = useState<(WritingResult & { action: WritingAction }) | null>(null);
  const [error, setError] = useState("");
  const [clipboardPending, setClipboardPending] = useState(false);
  const editable = (action: WritingAction) => typeof canApply === "function" ? canApply(action) : canApply;
  const controller = useRef<AbortController | null>(null);
  const panel = useRef<HTMLElement>(null);
  const expanded = Boolean(pending || result || error);
  const canWrite = Boolean(text.trim()) && text.length <= 12_000;
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
    {canWrite && <div className="writing-action-options" role="group" aria-label="Writing actions">
      <button type="button" disabled={Boolean(pending) || clipboardPending || !editable("IMPROVE")} onClick={() => void run("IMPROVE")}>Improve Writing</button>
      <button type="button" disabled={Boolean(pending) || clipboardPending || !editable("REFORMAT")} onClick={() => void run("REFORMAT")}>Reformat</button>
      <button type="button" disabled={Boolean(pending) || clipboardPending} onClick={() => void run("EXPLAIN")}>Explain</button>
    </div>}
    {text.length > 12_000 && <p role="status">Select up to 12,000 characters to use AI writing.</p>}
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
        && <p role="status">This selection cannot be replaced safely. Select plain text in one paragraph and try again.</p>}</div>}
  </section>;
}
