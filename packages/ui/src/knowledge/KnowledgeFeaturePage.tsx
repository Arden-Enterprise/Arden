import type { ContextControlProps } from "../shared/WorkspaceTopbar";
import type { KnowledgeReaderTarget } from "./knowledgeCitation";
import type { KnowledgeRoute, KnowledgeRouteRequest } from "./knowledgeRoute";
import type { CreatedKnowledgeDraft } from "../shared/api-client";
import type { Platform } from "../shared/types";
import { ServerKnowledgeFeaturePage } from "./ServerKnowledgeFeaturePage";

export type KnowledgeFeatureView = "knowledge" | "review-queue";
export type KnowledgeFeaturePageProps = ContextControlProps & {
  platform?: Platform;
  organizationId?: string | null;
  view: KnowledgeFeatureView;
  active?: boolean;
  organizationName?: string;
  departmentName?: string;
  createdDraft?: CreatedKnowledgeDraft | null;
  onAssignedReviewCount?: (count: number) => void;
  onDirtyChange?: (dirty: boolean) => void;
  citationTarget?: KnowledgeReaderTarget | null;
  requestedReviewId?: string | null;
  onReviewTargetHandled?: () => void;
  requestedContributionId?: string | null;
  onContributionTargetHandled?: () => void;
  routeRequest?: KnowledgeRouteRequest | null;
  onRouteChange?: (route: KnowledgeRoute, options: { replace: boolean }) => void;
  onRouteSettled?: () => void;
  onNavigate?: (view: KnowledgeFeatureView) => void;
  /** Signed-in member who is waiting for a department: Home explains the limited reading scope. */
  awaitingAssignment?: boolean;
  isAdmin?: boolean;
  canUsePrivateWorkspace?: boolean;
  onOpenPrivateNotes?: () => void;
};

export function KnowledgeFeaturePage(props: KnowledgeFeaturePageProps) {
  if (props.platform && props.organizationId && (props.view === "knowledge" || props.view === "review-queue")) {
    return <ServerKnowledgeFeaturePage platform={props.platform} organizationId={props.organizationId}
      organizationName={props.organizationName ?? "Organization"} view={props.view} active={props.active ?? true}
      createdDraftId={props.createdDraft?.id ?? null} onAssignedReviewCount={props.onAssignedReviewCount}
      onDirtyChange={props.onDirtyChange}
      citationTarget={props.citationTarget} requestedReviewId={props.requestedReviewId}
      requestedContributionId={props.requestedContributionId} onContributionTargetHandled={props.onContributionTargetHandled}
      onReviewTargetHandled={props.onReviewTargetHandled} routeRequest={props.routeRequest} onRouteChange={props.onRouteChange} onRouteSettled={props.onRouteSettled}
      awaitingAssignment={props.awaitingAssignment}
      isAdmin={props.isAdmin}
      canUsePrivateWorkspace={props.canUsePrivateWorkspace} onOpenPrivateNotes={props.onOpenPrivateNotes}
      onOpenReviews={props.onNavigate ? () => props.onNavigate!("review-queue") : undefined}
      contextOpen={props.contextOpen} onToggleContext={props.onToggleContext} />;
  }
  // Knowledge needs an organization the member has entered; there is no sample workspace.
  return null;
}
