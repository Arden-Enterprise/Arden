/** The parts of a ProseMirror mark and document that this check reads. */
export type SelectionMark = { type: { name: string }; eq(other: SelectionMark): boolean };
type SelectionNode<M> = { isText: boolean; marks: readonly M[] };
type SelectionDoc<M> = { nodesBetween(from: number, to: number, visit: (node: SelectionNode<M>) => void): void };

/**
 * The inline formatting shared by every character of a selection, so an AI rewrite can carry it over.
 * Returns null when the selection mixes formatting or contains a link: one style cannot be applied to
 * the new text without losing or misplacing part of the original.
 */
export function uniformSelectionMarks<M extends SelectionMark>(doc: SelectionDoc<M>, from: number, to: number): readonly M[] | null {
  let shared: readonly M[] | undefined;
  let uniform = true;
  doc.nodesBetween(from, to, node => {
    if (!uniform || !node.isText) return;
    if (node.marks.some(mark => mark.type.name === "link")) { uniform = false; return; }
    if (shared === undefined) { shared = node.marks; return; }
    const current = shared;
    uniform = current.length === node.marks.length && current.every(mark => node.marks.some(other => other.eq(mark)));
  });
  return uniform ? shared ?? [] : null;
}
