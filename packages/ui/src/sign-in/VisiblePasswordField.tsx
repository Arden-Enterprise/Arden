import { useId, useState } from "react";
import { accountPasswordMaximumLength } from "@arden/domain";

type VisiblePasswordFieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  placeholder: string;
  minLength?: number;
};

/** Password entry with an explicit visibility control and no account-creation rules. */
export function VisiblePasswordField({ label, value, onChange, autoComplete, placeholder, minLength }: VisiblePasswordFieldProps) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  return (
    <div className="auth-password-field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type={visible ? "text" : "password"}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete={autoComplete}
        placeholder={placeholder}
        minLength={minLength}
        maxLength={accountPasswordMaximumLength}
        required
      />
      <button
        type="button"
        className="auth-password-visibility"
        aria-label={`${visible ? "Hide" : "Show"} ${label.toLowerCase()}`}
        aria-pressed={visible}
        onClick={() => setVisible((current) => !current)}
      >
        {visible ? "Hide" : "Show"}
      </button>
    </div>
  );
}
