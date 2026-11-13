import { useId, useState } from "react";
import { checkAccountPassword } from "@arden/domain";

type NewPasswordFieldProps = {
  label?: string;
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
};

export const accountPasswordRequirementMessage = "Password needs at least 8 characters, one uppercase letter, and one special character.";

/** Shows the account-creation checks beside the password entry. */
export function NewPasswordField({
  label = "Password",
  placeholder = "Create a secure password",
  value,
  onChange,
}: NewPasswordFieldProps) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  const hasValue = value.length > 0;
  const checks = checkAccountPassword(value);
  const metCount = Object.values(checks).filter(Boolean).length;
  const requirements = [
    { label: "At least 8 characters", met: checks.minimumLength },
    { label: "At least 1 uppercase letter", met: checks.uppercaseLetter },
    { label: "At least 1 special character", met: checks.specialCharacter },
  ];

  return (
    <div className="auth-password-field">
      <label htmlFor={`${id}-input`}>{label}</label>
      <input
        id={`${id}-input`}
        type={visible ? "text" : "password"}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete="new-password"
        placeholder={placeholder}
        minLength={8}
        aria-invalid={hasValue && metCount < requirements.length}
        aria-describedby={`${id}-requirements`}
        required
      />
      <button
        type="button"
        className="auth-password-visibility"
        aria-label={`${visible ? "Hide" : "Show"} password`}
        aria-pressed={visible}
        onClick={() => setVisible((current) => !current)}
      >
        {visible ? "Hide" : "Show"}
      </button>
      <div id={`${id}-requirements`} className="auth-password-guidance">
        <p>Password requirements</p>
        <span className="sr-only" role="status" aria-live="polite">
          {hasValue ? `${metCount} of 3 password requirements met.` : "No password entered."}
        </span>
        <ul>
          {requirements.map((requirement) => {
            const state = !hasValue ? "pending" : requirement.met ? "met" : "unmet";
            return (
              <li key={requirement.label} className={`is-${state}`}>
                <span className="auth-password-check-icon" aria-hidden="true">
                  {state === "met" ? "✓" : state === "unmet" ? "×" : "·"}
                </span>
                <span className="sr-only">{state === "met" ? "Met: " : state === "unmet" ? "Not met: " : "Pending: "}</span>
                <span>{requirement.label}</span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
