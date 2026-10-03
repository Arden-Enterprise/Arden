import { useState } from "react";
import { Icon } from "../shared/Icon";
import { AccessRules } from "./AccessRules";
import { DepartmentEditor, MemberEditor } from "./OrganizationEditors";
import {
  createPreviewOrganization,
  previewTemplates,
  validateOrganization,
  type OrganizationPreview,
} from "./previewModel";

const steps = ["Organization", "Departments", "Members & roles", "Access review"] as const;

export function OrganizationSetupPage({
  onCancel,
  onComplete,
}: {
  onCancel: () => void;
  onComplete: (organization: OrganizationPreview) => void;
}) {
  const [organization, setOrganization] = useState(createPreviewOrganization);
  const [step, setStep] = useState(0);
  const [confirmed, setConfirmed] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const updateOrganization = (next: OrganizationPreview) => {
    setOrganization(next);
    setErrors([]);
    setConfirmed(false);
  };

  const continueToNextStep = () => {
    const problems = validateOrganization(organization);
    const relevantProblems = step === 0
      ? problems.filter((problem) => problem.includes("organization name"))
      : step === 1
        ? problems.filter((problem) => {
          const lowerCaseProblem = problem.toLowerCase();
          return lowerCaseProblem.includes("department") && !lowerCaseProblem.includes("employee");
        })
        : problems;
    if (relevantProblems.length > 0) {
      setErrors(relevantProblems);
      return;
    }
    setErrors([]);
    setStep((current) => Math.min(current + 1, steps.length - 1));
  };

  const completePreview = () => {
    const problems = validateOrganization(organization);
    if (problems.length > 0) {
      setErrors(problems);
      return;
    }
    if (!confirmed) {
      setErrors(["Confirm that this is a local preview configuration before continuing."]);
      return;
    }
    onComplete(organization);
  };

  return (
    <main className="organization-setup-page">
      <aside className="organization-setup-rail">
        <div className="organization-setup-brand"><span className="sidebar-brand-mark" aria-hidden="true" /> ARDEN <small>SETUP PREVIEW</small></div>
        <div className="organization-setup-rail-content">
          <span className="meta-label">FIRST-RUN ROUTE · SCR-02</span>
          <h1>Set the boundaries before the work begins.</h1>
          <p>Configure one organization, its departments, members and document access rules in a guided preview.</p>
          <ol className="organization-step-list">
            {steps.map((label, index) => (
              <li key={label} className={index === step ? "is-current" : index < step ? "is-complete" : ""}>
                <span>{index < step ? <Icon name="check" size={13} /> : String(index + 1).padStart(2, "0")}</span>
                {label}
              </li>
            ))}
          </ol>
        </div>
        <div className="organization-setup-rail-footer">One installation · One organization<br />Organization → Department</div>
      </aside>

      <div className="organization-setup-main">
        <header className="organization-setup-topbar">
          <span>CONFIGURATION / {steps[step].toUpperCase()}</span>
          <span>STEP {step + 1} OF {steps.length} · SYNTHETIC DATA</span>
        </header>

        <div className="organization-setup-content">
          {step === 0 && (
            <div className="organization-editor-stack">
              <div className="organization-section-heading">
                <div>
                  <span className="meta-label">FOUNDATION</span>
                  <h2>Organization &amp; template</h2>
                  <p>Choose a starting structure. These two templates are illustrative; the final catalogue is still a product decision.</p>
                </div>
              </div>
              <label className="organization-field">
                <span>Organization name</span>
                <input value={organization.name} maxLength={100} onChange={(event) => updateOrganization({ ...organization, name: event.target.value })} placeholder="Organization name" />
              </label>
              <fieldset className="organization-template-fieldset">
                <legend>Structure template</legend>
                <div className="organization-template-grid">
                  {previewTemplates.map((template) => (
                    <label key={template.id} className={`organization-template-card${organization.templateId === template.id ? " is-selected" : ""}`}>
                      <input
                        type="radio"
                        name="organization-template"
                        value={template.id}
                        checked={organization.templateId === template.id}
                        onChange={() => updateOrganization({ ...createPreviewOrganization(template.id), name: organization.name })}
                      />
                      <span className="organization-template-check"><Icon name="check" size={13} /></span>
                      <strong>{template.name}</strong>
                      <span>{template.description}</span>
                      <small>{template.departments.join(" · ")}</small>
                    </label>
                  ))}
                </div>
              </fieldset>
              <p className="organization-helper">Selecting another template resets the synthetic department and member examples.</p>
            </div>
          )}

          {step === 1 && <DepartmentEditor organization={organization} onChange={updateOrganization} />}
          {step === 2 && <MemberEditor organization={organization} onChange={updateOrganization} />}
          {step === 3 && (
            <div className="organization-editor-stack">
              <AccessRules />
              <div className="organization-review-summary">
                <div><span className="meta-label">ORGANIZATION</span><strong>{organization.name}</strong></div>
                <div><span className="meta-label">DEPARTMENTS</span><strong>{organization.departments.length}</strong></div>
                <div><span className="meta-label">MEMBERS</span><strong>{organization.members.length}</strong></div>
              </div>
              <label className="organization-confirm-check">
                <input type="checkbox" checked={confirmed} onChange={(event) => { setConfirmed(event.target.checked); setErrors([]); }} />
                <span>I understand this is a local, synthetic UI preview. It does not create an organization, account, session or access policy on the server.</span>
              </label>
            </div>
          )}

          {errors.length > 0 && (
            <div className="organization-validation" role="alert">
              <strong>Review before continuing</strong>
              <ul>{errors.map((error) => <li key={error}>{error}</li>)}</ul>
            </div>
          )}
        </div>

        <footer className="organization-setup-actions">
          <button type="button" className="secondary-button" onClick={step === 0 ? onCancel : () => { setStep(step - 1); setErrors([]); }}>
            {step === 0 ? "Back to sign in" : "Previous step"}
          </button>
          <span>Changes live only in this preview session.</span>
          <button type="button" className="primary-button" onClick={step === steps.length - 1 ? completePreview : continueToNextStep}>
            {step === steps.length - 1 ? "Open workspace preview" : "Continue"} <Icon name="arrow" size={15} />
          </button>
        </footer>
      </div>
    </main>
  );
}
