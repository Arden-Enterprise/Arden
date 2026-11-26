/** Reading views of already-authorized publications, not additional access grants. */
export const publicationScopes = ["ALL_READABLE", "ORGANIZATION", "SHARED"] as const;
export type PublicationScope = typeof publicationScopes[number];

/**
 * Use the approved publication's reader mode, never its author/owner department.
 * Missing legacy readers remain in the compatible ALL_READABLE view only, until
 * an explicit mapping establishes their readership. Callers must authorize first.
 */
export function matchesPublicationScope(readerMode: string | null | undefined, scope: PublicationScope): boolean {
  switch (scope) {
    case "ALL_READABLE": return true;
    case "ORGANIZATION": return readerMode === "ORGANIZATION";
    case "SHARED": return readerMode === "DEPARTMENT" || readerMode === "SELECTED_MEMBERS";
    default: return false;
  }
}
