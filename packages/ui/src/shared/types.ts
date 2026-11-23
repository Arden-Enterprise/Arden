export type Platform = "web" | "desktop";

export type WorkspaceView = "ask-arden" | "personal-workspace" | "organization-access" | "knowledge" | "review-queue" | "knowledge-handover";

export type PrivateNote = {
  id: string;
  title: string;
  body: string;
  updatedLabel: string;
  sourceVersionId?: string;
  /** Owning private collection; null or absent means the Private Notes root (ADR 0029). */
  collectionId?: string | null;
  /** Set when the note is in Favorites; the note still lives in its collection. */
  favoritedAt?: string | null;
};

/** An owner-private folder in the private workspace (ADR 0029). Never shared. */
export type PrivateCollection = {
  id: string;
  title: string;
  parentId: string | null;
  favoritedAt: string | null;
};

export type PaneContent = {
  eyebrow: string;
  title: string;
  description: string;
  suggestions: string[];
  boundaryTitle: string;
  boundaryBody: string;
};
