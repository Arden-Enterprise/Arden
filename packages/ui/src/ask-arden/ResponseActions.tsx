import { useState, type MouseEvent } from "react";
import { Icon } from "../shared/Icon";
import { ApiError, type AnswerFeedback } from "../shared/api-client";
import { copyableAnswer, type AskArdenMessage } from "./askArdenModel";

function Thumb({ down }: { down: boolean }) {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <g transform={down ? "rotate(180 12 12)" : undefined}>
      <rect x="2.75" y="9.5" width="4.25" height="11" rx="1.25" />
      <path d="M7 10.5l4.6-7a1.7 1.7 0 0 1 3.1 1l-.6 4.8h5a2 2 0 0 1 2 2.4l-1.4 7a2 2 0 0 1-2 1.6H7" />
    </g>
  </svg>;
}

export function ResponseActions({ message, onRate, onOpenSources, sourcesId, sourcesOpen }: {
  message: AskArdenMessage;
  onRate?: (feedback: AnswerFeedback) => Promise<void>;
  onOpenSources?: (opener: HTMLElement) => void;
  sourcesId: string;
  sourcesOpen: boolean;
}) {
  const [status, setStatus] = useState("");
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(copyableAnswer(message.body, message.citations ?? []));
      setCopied(true);
      setStatus("Answer copied.");
    } catch {
      setCopied(false);
      setStatus("Could not copy the answer.");
    }
  };

  const rate = async (choice: "GOOD" | "BAD") => {
    if (saving || !onRate) return;
    const feedback = message.feedback === choice ? null : choice;
    setSaving(true);
    setStatus("");
    try {
      await onRate(feedback);
      setStatus(feedback === null ? "Feedback removed." : "Feedback saved.");
    } catch (error) {
      setStatus(error instanceof ApiError && error.code === "PRIVATE_FEEDBACK_UNAVAILABLE"
        ? error.message : "Could not save feedback. Try again.");
    } finally {
      setSaving(false);
    }
  };

  return <div className="ask-response-actions" role="group" aria-label="Answer actions">
    <button type="button" className="ask-response-action" aria-label="Copy answer" title="Copy answer"
      onClick={() => void copy()}><Icon name={copied ? "check" : "copy"} size={16} /></button>
    {onRate && <>
      <button type="button" className="ask-response-action" aria-label="Good response"
        title={message.privateFeedbackToken ? "Good response · Only the rating is recorded" : "Good response"}
        aria-pressed={message.feedback === "GOOD"} aria-disabled={saving || undefined}
        onClick={() => void rate("GOOD")}><Thumb down={false} /></button>
      <button type="button" className="ask-response-action" aria-label="Bad response"
        title={message.privateFeedbackToken ? "Bad response · Only the rating is recorded" : "Bad response"}
        aria-pressed={message.feedback === "BAD"} aria-disabled={saving || undefined}
        onClick={() => void rate("BAD")}><Thumb down /></button>
    </>}
    {onOpenSources && <button type="button" className="ask-response-action ask-response-sources"
      aria-expanded={sourcesOpen} aria-controls={sourcesOpen ? sourcesId : undefined}
      onClick={(event: MouseEvent<HTMLButtonElement>) => onOpenSources(event.currentTarget)}>
      <Icon name="book-open" size={16} /> View sources
    </button>}
    <span className="ask-response-status" role="status">{status}</span>
  </div>;
}
