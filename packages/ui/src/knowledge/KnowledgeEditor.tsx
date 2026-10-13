import { KnowledgeBadge, KnowledgeHeading, KnowledgeNotice, KnowledgeRow } from "./KnowledgePrimitives";
import { useAutosizeTextarea } from "../shared/useAutosizeTextarea";
import { draftReadyForReview, knowledgeDraftChanged, knowledgeDraftMatchesPublication, type KnowledgeDraft, type KnowledgePreviewAction, type KnowledgePreviewState } from "./knowledgePreviewModel";

export function KnowledgeEditor({ state, dispatch, onBack, onSubmitted }: { state: KnowledgePreviewState; dispatch: (action: KnowledgePreviewAction) => void; onBack: () => void; onSubmitted: () => void }) {
  const draft = state.draft;
  const titleRef = useAutosizeTextarea(draft.title, 60);
  const ready = draftReadyForReview(draft);
  const publishedUnchanged = knowledgeDraftMatchesPublication(state);
  const draftChanged = knowledgeDraftChanged(state);
  const headingTitle = state.revisionRequested && !publishedUnchanged ? "Revision requested" : draft.title || "Untitled knowledge";
  const submitLabel = state.revisionRequested ? "Resubmit for review" : state.publication ? "Submit new version for review" : "Submit for review";
  const update = (changes: Partial<KnowledgeDraft>) => dispatch({ type: "edit", draft: { ...draft, ...changes } });
  const updateSection = (index: number, key: "heading" | "body", value: string) => update({ sections: draft.sections.map((section, sectionIndex) => sectionIndex === index ? { ...section, [key]: value } : section) });
  const submit = () => { if (!ready || publishedUnchanged) return; dispatch({ type: "submit" }); onSubmitted(); };

  return <>
    <KnowledgeHeading eyebrow="WORKSPACE / KNOWLEDGE" title={headingTitle}  action={publishedUnchanged ? <KnowledgeBadge tone="jade">Published · Sample</KnowledgeBadge> : <button type="button" className="primary-button" disabled={!ready} onClick={submit}>{submitLabel}</button>} />
    <div className="knowledge-draft-controls"><KnowledgeBadge tone={publishedUnchanged ? "jade" : "amber"}>{publishedUnchanged ? "Published sample" : state.revisionRequested ? "Revision required" : "Sample draft"}</KnowledgeBadge><KnowledgeBadge tone="blue">{draft.classification}</KnowledgeBadge><span>{draftChanged ? "Unsaved changes" : "Saved in this session"}</span><button type="button" className="secondary-button" disabled={!draftChanged} onClick={() => dispatch({ type: "save" })}>Save draft</button></div>
    {state.revisionRequested && !publishedUnchanged && <KnowledgeNotice title="Two changes requested by Minh Tran" tone="amber">Replace the private dashboard source and link incident INC-2841. This feedback belongs to the sample review.</KnowledgeNotice>}
    <div className="knowledge-editor-grid">
      <article className="knowledge-article">
        <div className="knowledge-format-toolbar" aria-label="Editor format"><span>Plain text editor</span><button type="button" disabled title="Rich text formatting is not connected">B</button><button type="button" disabled title="Rich text formatting is not connected">I</button><button type="button" disabled>Link</button><button type="button" disabled>List</button></div>
        <label><span className="sr-only">Knowledge title</span><textarea ref={titleRef} className="knowledge-article-title" rows={1} value={draft.title} maxLength={160} onChange={(event) => update({ title: event.target.value })} placeholder="Untitled knowledge" /></label>
        <label><span className="sr-only">Knowledge introduction</span><textarea className="knowledge-article-intro" rows={2} value={draft.introduction} maxLength={2000} onChange={(event) => update({ introduction: event.target.value })} /></label>
        {draft.sections.map((section, index) => <section key={index} className="knowledge-article-section"><label><span className="sr-only">Section {index + 1} heading</span><input value={section.heading} maxLength={200} onChange={(event) => updateSection(index, "heading", event.target.value)} /></label><label><span className="sr-only">Section {index + 1} content</span><textarea rows={3} value={section.body} maxLength={4000} onChange={(event) => updateSection(index, "body", event.target.value)} /></label></section>)}

      </article>
      <aside className="knowledge-editor-evidence" aria-label="Draft readiness and evidence">
        <div className="knowledge-readiness"><h2>{publishedUnchanged ? "Next-version readiness" : "Review readiness"}</h2><div className="knowledge-readiness-signal"><strong>{ready ? "100%" : draft.recoveryReady || draft.sourceReady ? "91%" : "82%"}</strong><span>{Number(!draft.recoveryReady) + Number(!draft.sourceReady)} checks left</span></div><p>{publishedUnchanged ? "Edit this sample to submit a new version" : "Before submitting"}</p>
          <label className="knowledge-check"><input type="checkbox" checked={draft.recoveryReady} onChange={(event) => update({ recoveryReady: event.target.checked })} /><span>Add recovery checklist / link INC-2841</span></label>
          <label className="knowledge-check"><input type="checkbox" checked={draft.sourceReady} onChange={(event) => update({ sourceReady: event.target.checked })} /><span>Use evidence accessible to the intended readers</span></label>
          <span className="knowledge-tone-jade">✓ Receiving owner confirmed</span>

        </div>
        <h2>Linked evidence</h2>
        <KnowledgeRow title="INC-2841" details="Synthetic incident · Department" status="Source" tone="blue" />
        <KnowledgeRow title="Retry policy decision" details="Published sample · v1.3" status="Cited" />

        <button type="button" className="secondary-button" onClick={onBack}>Back to library</button>
      </aside>
    </div>
  </>;
}
