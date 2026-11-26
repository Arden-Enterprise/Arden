export type CaseLoadState = { request: number };

export function startCaseLoad(state: CaseLoadState): number {
  state.request += 1;
  return state.request;
}

/** Keeps only the newest case read. A minimal result drops history from any earlier read. */
export function caseLoadVisible<T extends { kind: string }, H>(
  state: CaseLoadState,
  request: number,
  item: T,
  history: { items: H[]; nextCursor: string | null },
): { item: T; history: { items: H[]; nextCursor: string | null } } | null {
  if (state.request !== request) return null;
  if (item.kind === "minimal") return { item, history: { items: [], nextCursor: null } };
  return { item, history };
}
