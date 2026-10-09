import { useState } from "react";
import { Icon } from "../shared/Icon";
import { KnowledgeHeading, KnowledgeNotice, KnowledgeSteps } from "./KnowledgePrimitives";
import { type KnowledgeDraft, type KnowledgeScope } from "./knowledgePreviewModel";

const scopes: { value: KnowledgeScope; description: string }[] = [
  { value: "Company-wide", description: "Everyone in FPT Digital." },
  { value: "Department", description: "Product Engineering only." },
  { value: "Private", description: "Only the owner." },
];

export function CreateKnowledge({ draft, onSave, onContinue, onBack }: { draft: KnowledgeDraft; onSave: (draft: KnowledgeDraft) => void; onContinue: (draft: KnowledgeDraft) => void; onBack: () => void }) {
  const [metadata, setMetadata] = useState<KnowledgeDraft>(() => ({ ...draft, title: "API Gateway Recovery Runbook" }));
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const complete = (navigate: boolean) => {
    if (!metadata.title.trim()) { setError("Enter a title before saving this sample draft."); return; }
    setError("");
    if (navigate) onContinue(metadata); else { onSave(metadata); setMessage("Sample draft saved in this preview session."); }
  };
  return <>
    <KnowledgeHeading eyebrow="WORKSPACE / KNOWLEDGE" title="Create knowledge" description="Bring a useful document into your organization’s shared memory." action={<button type="button" className="primary-button" onClick={() => complete(false)}>Save draft</button>} />
    <KnowledgeSteps steps={["Source", "Metadata", "Ownership", "Access", "Review"]} active={0} />
    <div className="knowledge-two-column">
      <form className="knowledge-panel knowledge-metadata" onSubmit={(event) => { event.preventDefault(); complete(true); }}>
        <span className="meta-label knowledge-tone-blue">SOURCE &amp; METADATA</span>
        <div className="knowledge-upload"><Icon name="document" size={24} /><h2>Start from a template</h2><p>Use the sample runbook to explore the contribution flow.</p><button type="button" className="secondary-button" disabled>File import not connected</button><small>PDF, DOCX and Markdown import requires Arden Core.</small></div>
        <label>Title<input value={metadata.title} maxLength={160} onChange={(event) => setMetadata({ ...metadata, title: event.target.value })} aria-invalid={Boolean(error)} aria-describedby={error ? "knowledge-create-error" : undefined} /></label>
        {error && <p className="knowledge-form-error" id="knowledge-create-error" role="alert">{error}</p>}
        <div className="knowledge-form-pair"><label>Type<select value={metadata.documentType} onChange={(event) => { const value = event.target.value; if (value === "Runbook" || value === "Decision" || value === "Checklist") setMetadata({ ...metadata, documentType: value }); }}><option>Runbook</option><option>Decision</option><option>Checklist</option></select></label><label>Owner<input value="Lan Nguyen" readOnly /></label></div>
        <label>Responsible department<input value="Product Engineering" readOnly /></label>
        <label>Tags<input value={metadata.tags} maxLength={240} onChange={(event) => setMetadata({ ...metadata, tags: event.target.value })} /></label>
        <small>Project and team references are optional metadata.</small>
        <button type="button" className="knowledge-back-button" onClick={onBack}>← Back to library</button>
      </form>
      <div className="knowledge-panel knowledge-scope-panel">
        <span className="meta-label knowledge-tone-jade">WHO CAN ACCESS THIS?</span><h2>Choose one scope</h2><p>Choose the intended audience for this sample draft.</p>
        <fieldset className="knowledge-scope-options"><legend className="sr-only">Knowledge visibility scope</legend>{scopes.map((scope) => <label key={scope.value} className={metadata.scope === scope.value ? "is-selected" : ""}><span><input type="radio" name="knowledge-scope" value={scope.value} checked={metadata.scope === scope.value} onChange={() => setMetadata({ ...metadata, scope: scope.value })} />{scope.value}</span><small>{scope.description}</small></label>)}</fieldset>
        <KnowledgeNotice title={metadata.scope === "Private" ? "Private by default" : "Review before sharing"} tone="amber">{metadata.scope === "Private" ? "Only your sample working draft changes. Contribution requires a separate shared snapshot." : `This draft needs human review before it becomes governed ${metadata.scope} knowledge.`}</KnowledgeNotice>
        <button type="button" className="primary-button" onClick={() => complete(true)}>Continue to editor</button>
      </div>
    </div>
    {message && <p role="status" className="knowledge-action-message">{message}</p>}
  </>;
}
