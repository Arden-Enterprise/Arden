import { useReducer, useState } from "react";
import { WorkspaceTopbar, type ContextControlProps } from "../shared/WorkspaceTopbar";
import { CreateKnowledge } from "./CreateKnowledge";
import { KnowledgeAsk } from "./KnowledgeAsk";
import { KnowledgeDialog } from "./KnowledgeDialog";
import { KnowledgeEditor } from "./KnowledgeEditor";
import { KnowledgeHandover } from "./KnowledgeHandover";
import { KnowledgeLibrary } from "./KnowledgeLibrary";
import { KnowledgeNotice } from "./KnowledgePrimitives";
import { KnowledgeReview } from "./KnowledgeReview";
import { createKnowledgePreview, reduceKnowledgePreview } from "./knowledgePreviewModel";

export type KnowledgeFeatureView = "knowledge" | "ask-arden" | "review-queue" | "knowledge-handover";
export type KnowledgeFeaturePageProps = ContextControlProps & {
  view: KnowledgeFeatureView;
  active?: boolean;
  organizationName?: string;
  departmentName?: string;
  showPrivateSample?: boolean;
  onNavigate?: (view: KnowledgeFeatureView | "my-work") => void;
};

const labels: Record<KnowledgeFeatureView, string> = { knowledge: "Knowledge", "ask-arden": "Ask Arden", "review-queue": "Review Queue", "knowledge-handover": "Knowledge Handover" };

export function KnowledgeFeaturePage({ view, active = true, organizationName = "FPT Digital", departmentName = "Product Engineering", showPrivateSample = true, contextOpen, onToggleContext, onNavigate }: KnowledgeFeaturePageProps) {
  const [state, dispatch] = useReducer(reduceKnowledgePreview, undefined, createKnowledgePreview);
  const [knowledgeScreen, setKnowledgeScreen] = useState<"library" | "create" | "editor">("library");
  const [localView, setLocalView] = useState<{ from: KnowledgeFeatureView; to: KnowledgeFeatureView } | null>(null);
  const [openedDocument, setOpenedDocument] = useState<string | null>(null);
  const effectiveView = localView?.from === view ? localView.to : view;
  const goTo = (target: KnowledgeFeatureView) => {
    if (onNavigate) { setLocalView(null); onNavigate(target); }
    else setLocalView({ from: view, to: target });
  };
  const openDraft = () => { setKnowledgeScreen("editor"); goTo("knowledge"); };
  return <main id={active ? "arden-main" : undefined} className="workspace-page" tabIndex={-1}>
    <WorkspaceTopbar breadcrumb={`${organizationName} / ${departmentName} / ${labels[effectiveView]}`} previewLabel="Sample workflows · Session only" contextOpen={contextOpen} onToggleContext={onToggleContext} />
    <div className="knowledge-feature-page">
      {effectiveView === "knowledge" && knowledgeScreen === "library" && <KnowledgeLibrary active={active} showPrivateSample={showPrivateSample} onCreate={() => setKnowledgeScreen("create")} onEdit={openDraft} onOpenDocument={setOpenedDocument} />}
      {effectiveView === "knowledge" && knowledgeScreen === "create" && <CreateKnowledge draft={state.draft} onSave={(draft) => { dispatch({ type: "edit", draft }); dispatch({ type: "save" }); }} onContinue={(draft) => { dispatch({ type: "edit", draft }); dispatch({ type: "save" }); setKnowledgeScreen("editor"); }} onBack={() => setKnowledgeScreen("library")} />}
      {effectiveView === "knowledge" && knowledgeScreen === "editor" && <KnowledgeEditor state={state} dispatch={dispatch} onBack={() => setKnowledgeScreen("library")} onSubmitted={() => goTo("review-queue")} />}
      {effectiveView === "review-queue" && <KnowledgeReview state={state} dispatch={dispatch} onOpenDraft={openDraft} />}
      {effectiveView === "ask-arden" && <KnowledgeAsk />}
      {effectiveView === "knowledge-handover" && <KnowledgeHandover onReturn={() => { if (onNavigate) onNavigate("my-work"); else goTo("knowledge"); }} />}
      {state.message && (effectiveView === "knowledge" || effectiveView === "review-queue") && <p role="status" className="knowledge-action-message">{state.message}</p>}
    </div>
    {openedDocument && <KnowledgeDialog title={openedDocument} onClose={() => setOpenedDocument(null)}><p>This is a synthetic library record used to preview Arden’s layout and navigation.</p><KnowledgeNotice title="Document service not connected">Full document retrieval, version history and current permissions require Arden Core. No private or external content is loaded.</KnowledgeNotice><div className="dialog-actions"><button type="button" className="primary-button" onClick={() => setOpenedDocument(null)}>Back to library</button></div></KnowledgeDialog>}
  </main>;
}
