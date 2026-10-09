export type KnowledgeScope = "Department" | "Company-wide" | "Private";
export type KnowledgeDocumentType = "Runbook" | "Decision" | "Checklist";
export type KnowledgeClassification = "INTERNAL" | "CONFIDENTIAL" | "RESTRICTED";

export type KnowledgeSection = { heading: string; body: string };
export type KnowledgeDraft = {
  title: string;
  introduction: string;
  sections: KnowledgeSection[];
  scope: KnowledgeScope;
  classification: KnowledgeClassification;
  documentType: KnowledgeDocumentType;
  tags: string;
  recoveryReady: boolean;
  sourceReady: boolean;
};

export type KnowledgeSnapshot = Readonly<{
  version: number;
  draft: KnowledgeDraft;
  decision: "pending" | "approved" | "revision-requested";
}>;

export type KnowledgePreviewState = {
  draft: KnowledgeDraft;
  savedDraft: KnowledgeDraft;
  submitted: KnowledgeSnapshot | null;
  publication: KnowledgeSnapshot | null;
  revisionRequested: boolean;
  nextVersion: number;
  message: string;
};

export type KnowledgePreviewAction =
  | { type: "edit"; draft: KnowledgeDraft }
  | { type: "save" }
  | { type: "submit" }
  | { type: "request-revision" }
  | { type: "approve"; version: number };

export const sampleQuestion = "How should we respond to an API gateway outage?";

export function createSampleDraft(): KnowledgeDraft {
  return {
    title: "API Gateway Runbook",
    introduction: "Operational guide for triaging gateway errors, validating upstream health and escalating incidents safely.",
    sections: [
      { heading: "1. Confirm the impact", body: "Check error rate by route and region. Record the first observed timestamp and the current incident commander." },
      { heading: "2. Validate dependencies", body: "Review authentication, rate limiting and upstream health. Use authorized dashboards as evidence before restarting." },
      { heading: "3. Escalate and communicate", body: "Notify Platform Reliability when impact persists beyond ten minutes. Add timeline and decision links." },
    ],
    scope: "Department",
    classification: "INTERNAL",
    documentType: "Runbook",
    tags: "gateway · incident · recovery",
    recoveryReady: false,
    sourceReady: false,
  };
}

function copyDraft(draft: KnowledgeDraft): KnowledgeDraft {
  return { ...draft, sections: draft.sections.map((section) => ({ ...section })) };
}

export function createKnowledgePreview(): KnowledgePreviewState {
  const draft = createSampleDraft();
  return {
    draft,
    savedDraft: copyDraft(draft),
    submitted: { version: 24, draft: copyDraft(draft), decision: "pending" },
    publication: null,
    revisionRequested: false,
    nextVersion: 25,
    message: "",
  };
}

export function draftReadyForReview(draft: KnowledgeDraft): boolean {
  return draft.scope !== "Private" && Boolean(draft.title.trim()) && Boolean(draft.introduction.trim()) && draft.sections.every((section) => Boolean(section.heading.trim()) && Boolean(section.body.trim())) && draft.recoveryReady && draft.sourceReady;
}

export function knowledgeDraftChanged(state: KnowledgePreviewState): boolean {
  return JSON.stringify(state.draft) !== JSON.stringify(state.savedDraft);
}

// These are synthetic UI transitions, never authentication or server authorization.
export function reduceKnowledgePreview(state: KnowledgePreviewState, action: KnowledgePreviewAction): KnowledgePreviewState {
  switch (action.type) {
    case "edit":
      return { ...state, draft: copyDraft(action.draft), message: "" };
    case "save":
      return { ...state, savedDraft: copyDraft(state.draft), message: "Draft saved in this preview session. Nothing was sent to a server." };
    case "submit": {
      if (!draftReadyForReview(state.draft)) return { ...state, message: "Complete the content and both review checks before submitting a shared snapshot." };
      const submitted: KnowledgeSnapshot = { version: state.nextVersion, draft: copyDraft(state.draft), decision: "pending" };
      return { ...state, submitted, savedDraft: copyDraft(state.draft), nextVersion: state.nextVersion + 1, revisionRequested: false, message: "An immutable sample snapshot is ready for review. The working draft remains separate." };
    }
    case "request-revision":
      if (!state.submitted || state.submitted.decision !== "pending") return state;
      return { ...state, submitted: { ...state.submitted, decision: "revision-requested" }, revisionRequested: true, message: "Sample revision requested. Resolve the source visibility and recovery checklist before resubmitting." };
    case "approve":
      if (!state.submitted || state.submitted.version !== action.version || state.submitted.decision !== "pending" || !draftReadyForReview(state.submitted.draft)) return { ...state, message: "This snapshot is not ready for approval. Resolve the checks and submit a new snapshot." };
      {
        const approved: KnowledgeSnapshot = { ...state.submitted, decision: "approved" };
        return {
          ...state,
          submitted: approved,
          publication: { ...approved, draft: copyDraft(approved.draft) },
          message: "The sample snapshot was approved and automatically published in this session. No real publication or audit record was created.",
        };
      }
  }
}

export function formatSampleVersion(version: number): string {
  return `v${Math.floor(version / 10)}.${version % 10}`;
}

export type HandoverOutcome = "retain" | "transfer" | "revise" | "archive";
export type SampleHandoverDocument = { id: string; title: string; scope: "Department" | "Company-wide"; outcome: HandoverOutcome; owner: string };

export function createSampleHandover(): SampleHandoverDocument[] {
  return [
    { id: "sample-migration", title: "Migration decision log", scope: "Company-wide", outcome: "transfer", owner: "Tuan Le" },
    { id: "sample-dependency", title: "Service dependency map", scope: "Department", outcome: "retain", owner: "Organization owner" },
    { id: "sample-cutover", title: "Cutover runbook", scope: "Department", outcome: "revise", owner: "" },
  ];
}

export function handoverReady(documents: SampleHandoverDocument[]): boolean {
  return documents.length > 0 && documents.every((document) => (document.outcome !== "transfer" && document.outcome !== "revise") || Boolean(document.owner.trim()));
}
