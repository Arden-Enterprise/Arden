export type Platform = "web" | "desktop";

export type WorkspaceView = "ask-arden" | "personal-workspace" | "organization-access" | "knowledge" | "review-queue" | "graph";

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
  /** Owner-chosen order inside its collection or the root (spec F03-ARR); null or absent sorts first. */
  position?: number | null;
  /** ISO creation time; breaks ties between unplaced notes (newest first). */
  createdAt?: string;
  /** Decision 0034: "pdf" for an original PDF kept in Private; its body stays empty. */
  kind?: "note" | "pdf";
  /** For a PDF item: whether the private AI side panel can read its text. */
  textAvailable?: boolean;
};

/** An owner-private folder in the private workspace (ADR 0029). Never shared. */
export type PrivateCollection = {
  id: string;
  title: string;
  parentId: string | null;
  favoritedAt: string | null;
};
