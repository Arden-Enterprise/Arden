import { useId } from "react";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const isFullId = (value: string) => uuidPattern.test(value.trim());

export function NoteField({ label, help, placeholder, value, onChange, maxLength, required = false }: {
  label: string; help?: string; placeholder?: string; value: string; onChange: (value: string) => void; maxLength: number; required?: boolean;
}) {
  const fieldId = useId();
  const helpId = useId();
  return <div className="maintenance-field">
    <label className="island-field" htmlFor={fieldId}>
      <span>{label}</span>
      <textarea id={fieldId} value={value} placeholder={placeholder} maxLength={maxLength} required={required} aria-required={required || undefined}
        aria-describedby={help ? helpId : undefined} onChange={(event) => onChange(event.target.value)} />
    </label>
    {help && <small id={helpId}>{help}</small>}
  </div>;
}

export function IdField({ label, help, value, onChange, actionLabel, busy, onAction }: {
  label: string; help: string; value: string; onChange: (value: string) => void;
  actionLabel: string; busy: boolean; onAction: (id: string) => void;
}) {
  const fieldId = useId();
  const helpId = useId();
  const valid = isFullId(value);
  const invalid = value.trim() !== "" && !valid;
  return <div className="maintenance-field maintenance-id-field">
    <label className="island-field" htmlFor={fieldId}>
      <span>{label}</span>
      <input id={fieldId} value={value} placeholder="00000000-0000-0000-0000-000000000000" spellCheck={false} autoComplete="off" aria-invalid={invalid || undefined}
        aria-describedby={helpId} onChange={(event) => onChange(event.target.value)} />
    </label>
    <small id={helpId} className={invalid ? "is-error" : undefined}>{invalid ? "Enter the full 36-character ID." : help}</small>
    <button type="button" className="secondary-button" disabled={busy || !valid} onClick={() => onAction(value.trim())}>{actionLabel}</button>
  </div>;
}
