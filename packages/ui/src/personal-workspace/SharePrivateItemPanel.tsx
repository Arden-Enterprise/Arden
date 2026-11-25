import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Icon, type IconName } from "../shared/Icon";

/** What the Share panel shows: its two choices, or one of them. */
export type ShareStep = "choices" | "people" | "contribute";

type ShareChoice = {
  /** Explains why the choice is unavailable; the choice is then disabled. */
  unavailableReason?: string;
  /** Renders the choice; `onBack` returns to the two choices and `show` opens another step. */
  render: (onBack: () => void, show: (step: ShareStep) => void) => ReactNode;
};

/**
 * Decision 0034 (spec F03-SHR): one Share button for a private item. The panel names the consequence of each
 * choice before the member picks one: sharing with people is unreviewed and view only, contributing makes a copy
 * that becomes official only after review. Shown inside the status island like the contribution form.
 */
export function SharePrivateItemPanel({ title, people, contribute, initialStep = "choices", onClose }: {
  title: string;
  /** Omitted when direct sharing is not offered (for example, disabled by the organization). */
  people?: ShareChoice;
  contribute: ShareChoice;
  initialStep?: ShareStep;
  onClose: () => void;
}) {
  const [step, setStep] = useState<ShareStep>(initialStep);
  const heading = useRef<HTMLHeadingElement>(null);
  const titleId = useId();

  useEffect(() => {
    const opener = document.activeElement;
    return () => { if (opener instanceof HTMLElement && opener.isConnected) opener.focus(); };
  }, []);
  useEffect(() => { if (step === "choices") heading.current?.focus(); }, [step]);

  const back = () => setStep("choices");
  if (step === "people" && people && !people.unavailableReason) return <>{people.render(back, setStep)}</>;
  if (step === "contribute" && !contribute.unavailableReason) return <>{contribute.render(back, setStep)}</>;

  return <div className="contribute-island share-island" role="dialog" aria-labelledby={titleId}
    onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}>
    <div>
      <h2 id={titleId} ref={heading} tabIndex={-1}>Share</h2>
      <p className="island-meta share-island-title">{title}</p>
    </div>
    <ul className="share-choices">
      {people && <ShareChoiceButton icon="people" label="Share with people" choice={people} onSelect={() => setStep("people")}
        consequence="Not reviewed · view only · not an official document" />}
      <ShareChoiceButton icon="layers" label="Contribute to a department or the organization" choice={contribute}
        onSelect={() => setStep("contribute")}
        consequence="Creates a copy for review · becomes an official document after approval" />
    </ul>
    <div className="dialog-actions"><button type="button" className="secondary-button" onClick={onClose}>Close</button></div>
  </div>;
}

function ShareChoiceButton({ icon, label, consequence, choice, onSelect }: {
  icon: IconName; label: string; consequence: string; choice: ShareChoice; onSelect: () => void;
}) {
  const reasonId = useId();
  const unavailable = Boolean(choice.unavailableReason);
  return <li>
    <button type="button" className="share-choice" disabled={unavailable} onClick={onSelect}
      aria-describedby={unavailable ? reasonId : undefined}>
      <span className="share-choice-icon" aria-hidden="true"><Icon name={icon} size={16} /></span>
      <span className="share-choice-copy"><strong>{label}</strong><span>{consequence}</span>
        {unavailable && <span id={reasonId} className="share-choice-reason">{choice.unavailableReason}</span>}</span>
      <span className="share-choice-arrow" aria-hidden="true"><Icon name="chevron" size={14} /></span>
    </button>
  </li>;
}
