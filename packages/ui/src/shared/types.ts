export type Platform = "web" | "desktop";

export type WorkspaceView = "my-work" | "personal-workspace" | "organization-access";

export type PrivateNote = {
  id: string;
  title: string;
  body: string;
  updatedLabel: string;
};

export type PaneContent = {
  eyebrow: string;
  title: string;
  description: string;
  suggestions: string[];
  boundaryTitle: string;
  boundaryBody: string;
};
