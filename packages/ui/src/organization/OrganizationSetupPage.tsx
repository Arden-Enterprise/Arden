import { useState } from "react";
import { Icon } from "../shared/Icon";
import { AccessRules } from "./AccessRules";
import { DepartmentEditor } from "./OrganizationEditors";
import { OrganizationDialog } from "./OrganizationDialog";
import { MemberDirectory } from "./MemberDirectory";
import { createPreviewOrganization, previewTemplates, validateOrganization, type OrganizationPreview } from "./previewModel";

const steps = ["Template", "Departments", "Members", "Review"] as const;

export function OrganizationSetupPage({ onCancel, onComplete, initialOrganization, onSaveDraft }: {
  onCancel: () => void;
  onComplete: (organization: OrganizationPreview) => void;
  initialOrganization?: OrganizationPreview;
  onSaveDraft?: (organization: OrganizationPreview) => void;
}) {
  const [organization, setOrganization] = useState(() => initialOrganization ?? createPreviewOrganization());
  const [savedConfiguration, setSavedConfiguration] = useState(() => JSON.stringify(initialOrganization ?? createPreviewOrganization()));
  const [discarding, setDiscarding] = useState(false);
  const [step, setStep] = useState(0);
  const [confirmed, setConfirmed] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const template = previewTemplates.find((item) => item.id === organization.templateId) ?? previewTemplates[0];
  const update = (next: OrganizationPreview) => { setOrganization(next); setConfirmed(false); setErrors([]); setMessage(""); };
  const continueToNextStep = () => {
    const problems = validateOrganization(organization);
    const relevant = step === 0 ? problems.filter((problem) => problem === "Enter an organization name.") : step === 1 ? problems.filter((problem) => /department/i.test(problem)) : problems;
    if (relevant.length) { setErrors(relevant); return; } setErrors([]); setStep((current) => Math.min(current + 1, steps.length - 1));
  };
  const complete = () => {
    const problems = validateOrganization(organization);
    if (problems.length) { setErrors(problems); return; }
    if (!confirmed) { setErrors(["Confirm the preview configuration before completing setup."]); return; }
    onComplete(organization);
  };
  const saveDraft = () => {
    const problems = validateOrganization(organization);
    if (problems.length) { setErrors(problems); return; }
    onSaveDraft?.(organization); setSavedConfiguration(JSON.stringify(organization)); setMessage("Setup draft kept in this preview session. It is not stored on a server.");
  };
  const cancelSetup = () => { if (JSON.stringify(organization) !== savedConfiguration) setDiscarding(true); else onCancel(); };
  return <main id="arden-main" className="organization-setup-page" aria-labelledby="organization-setup-title" tabIndex={-1}>
    <aside className="organization-setup-rail"><div className="organization-setup-brand"><Icon name="knowledge" size={24} /><strong>ARDEN</strong></div><div className="organization-setup-context"><span className="meta-label">{organization.name || "YOUR ORGANIZATION"}</span><strong>Organization</strong></div><span className="meta-label">FIRST-RUN SETUP</span><ol className="organization-step-list">{steps.map((label, index) => <li key={label} className={index === step ? "is-current" : index < step ? "is-complete" : ""}><span>{index < step ? <Icon name="check" size={14} /> : String(index + 1).padStart(2, "0")}</span>{label}</li>)}</ol><div className="organization-setup-rail-footer"><strong>{organization.members.find((member) => member.id === "sample-admin")?.name ?? "Organization administrator"}</strong><span>Organization Admin · Session preview</span></div></aside>
    <div className="organization-setup-main"><header className="organization-setup-topbar"><span>{organization.name} / Administration</span><span className="organization-preview-badge">SETUP PREVIEW · SYNTHETIC DATA</span></header><div className="organization-setup-content">
      <div className="page-title-row organization-access-heading"><div><span className="meta-label">ORGANIZATION / GOVERNANCE</span><h1 id="organization-setup-title">Set up your organization</h1></div>{onSaveDraft && <button type="button" className="primary-button" onClick={saveDraft}>Save setup draft</button>}</div>
      <ol className="organization-horizontal-steps" aria-label="Setup progress">{steps.map((label, index) => <li key={label} className={index === step ? "is-current" : index < step ? "is-complete" : ""} aria-current={index === step ? "step" : undefined}><span>{String(index + 1).padStart(2, "0")}</span>{label}</li>)}</ol>
      {step === 0 && <div className="organization-template-layout"><section className="organization-template-picker"><h2>Choose a starting structure</h2><label className="organization-field"><span>Organization name</span><input value={organization.name} maxLength={100} placeholder="Organization name" onChange={(event) => update({ ...organization, name: event.target.value })} /></label><fieldset className="organization-template-fieldset"><legend className="sr-only">Structure template</legend><div className="organization-template-grid">{previewTemplates.map((item) => <label key={item.id} className={`organization-template-card${organization.templateId === item.id ? " is-selected" : ""}`}><input type="radio" name="organization-template" value={item.id} checked={organization.templateId === item.id} onChange={() => { const next = createPreviewOrganization(item.id); update({ ...organization, templateId: item.id, departments: next.departments }); }} /><span className="organization-template-check"><Icon name={organization.templateId === item.id ? "check" : "document"} size={16} /></span><strong>{item.name}</strong><small>{item.departments.join(" · ")}</small></label>)}</div></fieldset></section><aside className="organization-surface organization-template-preview"><span className="meta-label organization-jade">{template.name.toUpperCase()} CREATES</span><h2>{organization.name || "Your organization"}</h2><span className="organization-status status-active">Organization</span><div className="organization-overview-departments">{organization.departments.map((department, index) => <div key={department.id}><span>{String(index + 1).padStart(2, "0")}</span><strong>{department.name}</strong><span className="organization-status">Department</span></div>)}</div><span className="meta-label organization-amber">DEFAULT GOVERNANCE</span></aside></div>}
      {step === 1 && <section className="organization-surface"><DepartmentEditor organization={organization} onChange={update} /></section>}
      {step === 2 && <><MemberDirectory organization={organization} onChange={update} /></>}
      {step === 3 && <section className="organization-surface organization-editor-stack"><div className="organization-section-heading"><div><span className="meta-label organization-jade">READY TO REVIEW</span><h2>A clear foundation for your team</h2></div></div><div className="organization-review-summary"><div><span className="meta-label">ORGANIZATION</span><strong>{organization.name}</strong></div><div><span className="meta-label">DEPARTMENTS</span><strong>{organization.departments.length}</strong></div><div><span className="meta-label">MEMBERS</span><strong>{organization.members.length}</strong></div></div><div className="organization-review-departments">{organization.departments.map((department) => <div key={department.id}><strong>{department.name}</strong><small>{organization.members.filter((member) => member.departmentId === department.id).length} assigned members</small></div>)}</div><AccessRules /><div className="organization-notice"><strong>{(organization.invitations ?? []).filter((item) => item.status === "pending").length} invitations pending · {organization.members.filter((member) => member.status === "pending-assignment").length} waiting for assignment</strong><span>Pending members remain outside the workspace until an administrator confirms their department and role.</span></div><label className="organization-confirm-check"><input type="checkbox" checked={confirmed} onChange={(event) => { setConfirmed(event.target.checked); setErrors([]); }} /><span>I reviewed this synthetic configuration and understand that it changes this session only.</span></label></section>}
      {message && <p className="organization-feedback" role="status">{message}</p>}{errors.length > 0 && <div className="organization-validation" role="alert"><strong>Review before continuing</strong><ul>{errors.map((error) => <li key={error}>{error}</li>)}</ul></div>}
      <footer className="organization-setup-actions"><button type="button" className="secondary-button" onClick={() => { if (step === 0) cancelSetup(); else { setStep((current) => current - 1); setErrors([]); } }}>{step === 0 ? "Back to workspace" : `Back: ${steps[step - 1]}`}</button><span>Session only · No server changes</span><button type="button" className="primary-button" onClick={step === steps.length - 1 ? complete : continueToNextStep}>{step === steps.length - 1 ? "Complete preview setup" : `Next: ${steps[step + 1]}`}<Icon name="arrow" size={16} /></button></footer>
    </div></div>
    {discarding && <OrganizationDialog title="Discard setup changes?" description="Changes since the last saved setup draft will be lost." onClose={() => setDiscarding(false)}><div className="organization-dialog-actions"><button type="button" className="secondary-button" autoFocus onClick={() => setDiscarding(false)}>Keep editing</button><button type="button" className="primary-button" onClick={onCancel}>Discard changes</button></div></OrganizationDialog>}
  </main>;
}
