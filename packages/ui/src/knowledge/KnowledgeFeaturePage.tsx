import { useEffect, useReducer, useRef, useState } from "react";
import { WorkspaceTopbar, type ContextControlProps } from "../shared/WorkspaceTopbar";
import { CreateKnowledge } from "./CreateKnowledge";
import { KnowledgeEditor } from "./KnowledgeEditor";
import { KnowledgeHandover } from "./KnowledgeHandover";
import { KnowledgeLibrary, sampleDocuments, type SampleKnowledgeDocument } from "./KnowledgeLibrary";
import { KnowledgeDocumentDetail } from "./KnowledgeDocumentDetail";
import type { KnowledgeNavigationTarget } from "./knowledgeCitation";
import { KnowledgeReview } from "./KnowledgeReview";
import { createKnowledgePreview, reduceKnowledgePreview } from "./knowledgePreviewModel";
import type { CreatedKnowledgeDraft } from "../shared/api-client";
import type { Platform } from "../shared/types";
import { ServerKnowledgeFeaturePage } from "./ServerKnowledgeFeaturePage";

export type KnowledgeFeatureView = "knowledge" | "review-queue" | "knowledge-handover";
export type KnowledgeFeaturePageProps = ContextControlProps & {
  platform?: Platform;
  organizationId?: string | null;
  view: KnowledgeFeatureView;
  active?: boolean;
  organizationName?: string;
  departmentName?: string;
  createdDraft?: CreatedKnowledgeDraft | null;
  onAssignedReviewCount?: (count: number) => void;
  citationTarget?: KnowledgeNavigationTarget | null;
  onNavigate?: (view: KnowledgeFeatureView | "my-work") => void;
};

const labels: Record<KnowledgeFeatureView, string> = { knowledge: "Knowledge", "review-queue": "Review Queue", "knowledge-handover": "Knowledge Handover" };

export function KnowledgeFeaturePage(props: KnowledgeFeaturePageProps) {
  if (props.platform && props.organizationId && (props.view === "knowledge" || props.view === "review-queue")) {
    return <ServerKnowledgeFeaturePage platform={props.platform} organizationId={props.organizationId}
      organizationName={props.organizationName ?? "Organization"} view={props.view} active={props.active ?? true}
      createdDraftId={props.createdDraft?.id ?? null} onAssignedReviewCount={props.onAssignedReviewCount}
      citationTarget={props.citationTarget}
      contextOpen={props.contextOpen} onToggleContext={props.onToggleContext} />;
  }
  return <SampleKnowledgeFeaturePage {...props} />;
}

function SampleKnowledgeFeaturePage({ view, active = true, organizationName = "FPT Digital", departmentName = "Product Engineering", createdDraft = null, citationTarget, contextOpen, onToggleContext, onNavigate }: KnowledgeFeaturePageProps) {
  const [state, dispatch] = useReducer(reduceKnowledgePreview, undefined, createKnowledgePreview);
  const [knowledgeScreen, setKnowledgeScreen] = useState<"library" | "create" | "editor">("library");
  const [localView, setLocalView] = useState<{ from: KnowledgeFeatureView; to: KnowledgeFeatureView } | null>(null);
  const [openedDocument, setOpenedDocument] = useState<SampleKnowledgeDocument | null>(null);
  const [openedCitation, setOpenedCitation] = useState<KnowledgeNavigationTarget | null>(null);
  const openedCitationId = useRef<string | null>(null);
  const effectiveView = localView?.from === view ? localView.to : view;
  useEffect(() => { if (createdDraft) setKnowledgeScreen("library"); }, [createdDraft?.id]);
  useEffect(() => {
    if (!active || view !== "knowledge" || !citationTarget || openedCitationId.current === citationTarget.navigationId) return;
    openedCitationId.current = citationTarget.navigationId;
    const source = sampleDocuments.find((document) => document.id === citationTarget.documentId);
    if (!source) return;
    const versionExists = source.versions.some((version) => version.id === citationTarget.versionId);
    if (!versionExists) return;
    setOpenedDocument({ ...source, activeVersionId: citationTarget.versionId });
    setOpenedCitation(citationTarget);
    setKnowledgeScreen("library");
  }, [active, citationTarget, view]);
  const goTo = (target: KnowledgeFeatureView) => {
    if (onNavigate) { setLocalView(null); onNavigate(target); }
    else setLocalView({ from: view, to: target });
  };
  const openDraft = () => { setKnowledgeScreen("editor"); goTo("knowledge"); };
  return <main id={active ? "arden-main" : undefined} className="workspace-page" tabIndex={-1}>
    <WorkspaceTopbar breadcrumb={`${organizationName} / ${departmentName} / ${openedDocument?.title ?? labels[effectiveView]}`} previewLabel={createdDraft && effectiveView === "knowledge" ? "Draft · Demo content" : "Demo"} contextOpen={contextOpen} onToggleContext={onToggleContext} />
    <div className="knowledge-feature-page">
      {effectiveView === "knowledge" && openedDocument && <KnowledgeDocumentDetail metadata={openedDocument}
        focusTarget={openedCitation}
        onBack={() => { setOpenedDocument(null); setOpenedCitation(null); }}
        onVersionChange={(activeVersionId) => { setOpenedDocument({ ...openedDocument, activeVersionId }); setOpenedCitation(null); }}
        content={<div className="knowledge-reader-sample-page">
          <header><span>{openedDocument.documentCode} / VERSION {openedDocument.versions.find((version) => version.id === openedDocument.activeVersionId)?.label}</span><h2>{openedDocument.title}</h2></header>
          {openedDocument.sourceBlocks.map((block) => <section key={block.id} data-source-block-id={block.id}>
            {block.heading && <h3>{block.heading}</h3>}<p>{block.text}</p>
          </section>)}
          <footer>Demo document</footer>
        </div>} />}
      {effectiveView === "knowledge" && !openedDocument && knowledgeScreen === "library" && <KnowledgeLibrary active={active} createdDraft={createdDraft} onCreate={() => setKnowledgeScreen("create")} onOpenDocument={(document) => { setOpenedCitation(null); setOpenedDocument(document); }} />}
      {effectiveView === "knowledge" && knowledgeScreen === "create" && <CreateKnowledge draft={state.draft} onSave={(draft) => { dispatch({ type: "edit", draft }); dispatch({ type: "save" }); }} onContinue={(draft) => { dispatch({ type: "edit", draft }); dispatch({ type: "save" }); setKnowledgeScreen("editor"); }} onBack={() => setKnowledgeScreen("library")} />}
      {effectiveView === "knowledge" && knowledgeScreen === "editor" && <KnowledgeEditor state={state} dispatch={dispatch} onBack={() => setKnowledgeScreen("library")} onSubmitted={() => goTo("review-queue")} />}
      {effectiveView === "review-queue" && <KnowledgeReview state={state} dispatch={dispatch} onOpenDraft={openDraft} />}
      {effectiveView === "knowledge-handover" && <KnowledgeHandover onReturn={() => { if (onNavigate) onNavigate("my-work"); else goTo("knowledge"); }} />}
      {state.message && (effectiveView === "knowledge" || effectiveView === "review-queue") && <p role="status" className="knowledge-action-message">{state.message}</p>}
    </div>
  </main>;
}
