import { useEffect, useRef, useState } from "react";
import { runWritingAction, type WritingAction, type WritingResult } from "./writing-action-api";
import { ApiError } from "./api-client";
import type { Platform } from "./types";

export function WritingActionPanel({ platform, organizationId, text, scope, onApply, onClose, canApply = true }: {
  platform: Platform; organizationId: string; text: string; scope: "SELECTION" | "PAGE";
  onApply: (replacement: string, action: WritingAction) => void; onClose: () => void;
  canApply?: boolean | ((action: WritingAction) => boolean);
}) {
  const [pending, setPending] = useState<WritingAction | null>(null);
  const [result, setResult] = useState<(WritingResult & { action: WritingAction }) | null>(null);
  const [error, setError] = useState("");
  const editable = (action: WritingAction) => typeof canApply === "function" ? canApply(action) : canApply;
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { controller.current?.abort(); onClose(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

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

  return <section className="writing-action-panel" aria-label="Writing assistant">
    <div className="writing-action-head"><strong>Writing assistant</strong><button type="button" aria-label="Close writing assistant"
      onClick={() => { controller.current?.abort(); onClose(); }}>×</button></div>
    <div className="writing-action-options" role="group" aria-label="Writing actions">
      <button type="button" disabled={Boolean(pending) || !editable("IMPROVE")} onClick={() => void run("IMPROVE")}>Improve Writing</button>
      <button type="button" disabled={Boolean(pending) || !editable("REFORMAT")} onClick={() => void run("REFORMAT")}>Reformat</button>
      <button type="button" disabled={Boolean(pending)} onClick={() => void run("EXPLAIN")}>Explain</button>
    </div>
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
