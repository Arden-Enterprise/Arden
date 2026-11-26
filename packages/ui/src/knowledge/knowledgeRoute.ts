/** Where Home (the Knowledge view) is: a full-page screen with its own address. */
export type KnowledgeHomeLocation =
  | { kind: "home" }
  | { kind: "document"; id: string }
  | { kind: "draft"; id: string }
  | { kind: "create" }
  | { kind: "report"; caseId: string }
  /** Decision 0034: a private item shared directly with this member (read only, not reviewed). */
  | { kind: "shared"; id: string };

/** Where Reviews is: the publication queue or a submission, the maintenance queue or a case. */
export type KnowledgeReviewLocation =
  | { kind: "reviews" }
  | { kind: "review"; id: string }
  | { kind: "maintenance" }
  | { kind: "maintenance-case"; caseId: string };

export type KnowledgeLocation = KnowledgeHomeLocation | KnowledgeReviewLocation;

/** What Knowledge shows in each of its two views. */
export type KnowledgeRoute = { home: KnowledgeHomeLocation; reviews: KnowledgeReviewLocation };

/** A request from the shell (browser Back/Forward or an opened address) to show a location, handled once. */
export type KnowledgeRouteRequest = { location: KnowledgeLocation; navigationId: string };

export const emptyKnowledgeRoute: KnowledgeRoute = { home: { kind: "home" }, reviews: { kind: "reviews" } };

export function sameKnowledgeLocation(left: KnowledgeLocation, right: KnowledgeLocation): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
