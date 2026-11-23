export type Platform = "web" | "desktop";

export type WorkspaceView = "ask-arden" | "personal-workspace" | "organization-access" | "knowledge" | "review-queue";

export type PrivateNote = {
  id: string;
  title: string;
  body: string;
  updatedLabel: string;
  sourceVersionId?: string;
};

