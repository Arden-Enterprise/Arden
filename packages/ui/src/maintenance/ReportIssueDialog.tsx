import { useId, useRef, useState } from "react";
import { KnowledgeDialog } from "../knowledge/KnowledgeDialog";
import { Icon } from "../shared/Icon";

const versionChip = (label: string) => /^\d/.test(label) ? `v${label}` : label;

/**
 * Report dialog for one published version.
 * Accessibility: labeled required field, error linked with aria-describedby, focus restored by KnowledgeDialog.
 * Baseline and UI engineering: existing dialog, one primary action, helper text beside the field.
 * Save.design had no saved references for this surface.
 */
export function ReportIssueDialog({ title, versionLabel, busy, purpose = "report", onClose, onSubmit, onViewReports }: {
  title: string;
  versionLabel: string;
  busy: boolean;
  purpose?: "report" | "review";
  onClose: () => void;
  onSubmit: (description: string, requestKey: string, anchor?: { page?: number; passage?: string }) => Promise<string>;
  onViewReports: () => void;
}) {
  const descriptionId = useId();
  const pageId = useId();
  const passageId = useId();
  const helpId = useId();
  const errorId = useId();
  const requestKey = useRef<string | null>(null);
  const [description, setDescription] = useState("");
  const [page, setPage] = useState("");
  const [passage, setPassage] = useState("");
  const [error, setError] = useState("");
  const [caseId, setCaseId] = useState<string | null>(null);
  const reviewing = purpose === "review";
  const describedBy = error ? `${helpId} ${errorId}` : helpId;
  const submit = async () => {
    const text = description.trim();
    if (text.length < 1) {
      setError("Describe the issue.");
      return;
    }
    const parsedPage = page.trim() === "" ? undefined : Number(page);
    if (parsedPage !== undefined && (!Number.isInteger(parsedPage) || parsedPage < 1 || parsedPage > 10000)) {
      setError("Enter a page from 1 to 10000, or leave it blank.");
      return;
    }
    requestKey.current ??= crypto.randomUUID();
    setError("");
    try {
      setCaseId(await onSubmit(text, requestKey.current, {
        page: parsedPage,
        passage: passage.trim() || undefined,
      }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Couldn’t submit this report.");
    }
  };
  return <KnowledgeDialog title={reviewing ? "Start review" : "Report an issue"} onClose={onClose} dismissible={!busy}>
    {caseId ? <div className="maintenance-report-sent maintenance-enter">
      <span className="maintenance-sent-mark" aria-hidden="true"><Icon name="check" size={18} /></span>
      <div className="maintenance-sent-copy" role="status">
        <strong>{reviewing ? "Review started" : "Report sent"}</strong>
        <p>{title} · {versionChip(versionLabel)}</p>
        <p className="maintenance-id">Case {caseId}</p>
      </div>
      <div className="dialog-actions">
        <button type="button" className="secondary-button" onClick={onClose}>Done</button>
        <button type="button" className="primary-button" onClick={onViewReports}>View in My reports</button>
      </div>
    </div> : <div className="maintenance-dialog-form">
      <p className="maintenance-dialog-context">
        <Icon name="document" size={14} /><span>{title}</span><span className="maintenance-version-chip">{versionChip(versionLabel)}</span>
      </p>
      <div className="maintenance-field">
        <label className="island-field" htmlFor={descriptionId}>
          <span>{reviewing ? "Review objective" : "What needs attention?"}</span>
          <textarea id={descriptionId} required aria-required="true" aria-invalid={error ? true : undefined}
            aria-describedby={describedBy} maxLength={4000} value={description} disabled={busy}
            onChange={(event) => setDescription(event.target.value)} />
        </label>
        <small id={helpId}>Required. It stays attached to this exact published version.</small>
      </div>
      <fieldset className="maintenance-location">
        <legend>Location <span>(optional)</span></legend>
        <label className="island-field maintenance-location-page" htmlFor={pageId}>
          <span>Page</span>
          <input id={pageId} inputMode="numeric" value={page} disabled={busy} maxLength={5}
            onChange={(event) => setPage(event.target.value)} />
        </label>
        <label className="island-field" htmlFor={passageId}>
          <span>Passage</span>
          <input id={passageId} value={passage} disabled={busy} maxLength={500}
            onChange={(event) => setPassage(event.target.value)} />
        </label>
      </fieldset>
      {error && <p id={errorId} className="field-error" role="alert">{error}</p>}
      <div className="dialog-actions">
        <button type="button" className="secondary-button" disabled={busy} onClick={onClose}>Cancel</button>
        <button type="button" className="primary-button" disabled={busy} aria-busy={busy || undefined}
          aria-describedby={error ? errorId : undefined} onClick={() => void submit()}>
          {busy ? "Submitting…" : reviewing ? "Start review" : "Submit report"}
        </button>
      </div>
    </div>}
  </KnowledgeDialog>;
}
