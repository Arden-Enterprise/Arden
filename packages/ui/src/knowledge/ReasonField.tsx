import { useId, type ReactNode } from "react";
import { Icon, type IconName } from "../shared/Icon";

export const REASON_LIMIT = 1000;

/** A required reason with its character count inside the field and the error below it. */
export function ReasonField({ label, value, placeholder, busy, showMissing, onChange, initialFocus = true }: {
  label: string; value: string; placeholder: string; busy: boolean; showMissing: boolean; onChange: (value: string) => void;
  initialFocus?: boolean;
}) {
  const id = useId();
  return <div className="reason-field">
    <label htmlFor={`${id}-input`}>{label}</label>
    <div className={showMissing ? "reason-field-box is-invalid" : "reason-field-box"}>
      <textarea id={`${id}-input`} rows={5} maxLength={REASON_LIMIT} value={value} disabled={busy} data-autofocus={initialFocus || undefined}
        aria-required="true" aria-invalid={showMissing} aria-describedby={`${id}-count${showMissing ? ` ${id}-error` : ""}`}
        placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
      <small id={`${id}-count`} className="reason-field-count">{value.length} / {REASON_LIMIT}</small>
    </div>
    {showMissing && <small id={`${id}-error`} className="field-error" role="alert">Enter a reason.</small>}
  </div>;
}

/** The consequence or audience of the decision, stated beside the field. */
export function ReasonNotice({ icon, tone = "default", children }: { icon: IconName; tone?: "default" | "danger"; children: ReactNode }) {
  return <div className={tone === "danger" ? "reason-notice is-danger" : "reason-notice"}>
    <Icon name={icon} size={16} />
    <div>{children}</div>
  </div>;
}
