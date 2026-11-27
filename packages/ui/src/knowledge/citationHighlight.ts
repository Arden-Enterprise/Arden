import { findPageQuoteMatches, findQuoteInSegments, type TextMatch } from "./citationTextMatch";

export function textNodesIn(root: Node): Text[] {
  const walker = root.ownerDocument!.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node as Text);
  return nodes;
}

function rangesFor(nodes: readonly Text[], match: TextMatch): Array<{ node: Text; from: number; to: number }> {
  const ranges: Array<{ node: Text; from: number; to: number }> = [];
  for (let index = match.start.segment; index <= match.end.segment; index++) {
    const node = nodes[index]!;
    const from = index === match.start.segment ? match.start.offset : 0;
    const to = index === match.end.segment ? match.end.offset : node.data.length;
    if (from < to && node.data.slice(from, to).trim()) ranges.push({ node, from, to });
  }
  return ranges;
}

/**
 * Wraps the quote in `<mark>` elements. Only for DOM this code owns (the PDF text layer);
 * an editor-managed DOM would discard the change, so use {@link highlightQuoteRanges} there.
 */
export function markQuote(root: HTMLElement, quote: string, className: string, onCitedPage = false): { marks: HTMLElement[]; complete: boolean } {
  return markQuotes(root, [quote], className, onCitedPage);
}

export function markQuotes(root: HTMLElement, quotes: readonly string[], className: string, onCitedPage = false): { marks: HTMLElement[]; complete: boolean } {
  const nodes = textNodesIn(root);
  const segments = nodes.map(node => node.data);
  const matches = quotes.map(quote => onCitedPage ? findPageQuoteMatches(segments, quote) : [findQuoteInSegments(segments, quote)]);
  const rangesByNode = new Map<Text, Array<{ from: number; to: number }>>();
  for (const match of matches.flat()) {
    if (!match) continue;
    for (const { node, from, to } of rangesFor(nodes, match)) {
      const ranges = rangesByNode.get(node) ?? [];
      ranges.push({ from, to });
      rangesByNode.set(node, ranges);
    }
  }
  const marks: HTMLElement[] = [];
  for (const node of nodes) {
    const ranges = rangesByNode.get(node);
    if (!ranges) continue;
    const merged: typeof ranges = [];
    for (const range of ranges.sort((left, right) => left.from - right.from)) {
      const last = merged.at(-1);
      if (last && last.to >= range.from) last.to = Math.max(last.to, range.to);
      else merged.push(range);
    }
    const nodeMarks = [];
    for (const { from, to } of merged.reverse()) {
      const middle = from > 0 ? node.splitText(from) : node;
      if (to - from < middle.data.length) middle.splitText(to - from);
      const mark = root.ownerDocument.createElement("mark");
      mark.className = className;
      middle.parentNode!.insertBefore(mark, middle);
      mark.appendChild(middle);
      nodeMarks.unshift(mark);
    }
    marks.push(...nodeMarks);
  }
  return { marks, complete: matches.every(group => group[0]?.complete === true) };
}

export function clearMarks(root: HTMLElement, className: string): void {
  for (const mark of Array.from(root.querySelectorAll<HTMLElement>(`mark.${className}`))) {
    const parent = mark.parentNode;
    if (!parent) continue;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
    parent.normalize();
  }
}

/** DOM ranges covering the quote, without changing the DOM. */
export function quoteRanges(root: HTMLElement, quote: string): Range[] {
  const nodes = textNodesIn(root);
  const match = findQuoteInSegments(nodes.map((node) => node.data), quote);
  if (!match) return [];
  return rangesFor(nodes, match).map(({ node, from, to }) => {
    const range = root.ownerDocument.createRange();
    range.setStart(node, from);
    range.setEnd(node, to);
    return range;
  });
}

type HighlightRegistry = { set(name: string, value: unknown): void; delete(name: string): boolean };
type HighlightConstructor = new (...ranges: Range[]) => unknown;

/**
 * Paints ranges with the CSS Custom Highlight API, which leaves editor-owned DOM untouched.
 * Returns false where the API is unavailable so the caller can fall back to a block outline.
 */
export function paintHighlight(name: string, ranges: readonly Range[]): boolean {
  const registry = (globalThis.CSS as { highlights?: HighlightRegistry } | undefined)?.highlights;
  const Highlight = (globalThis as { Highlight?: HighlightConstructor }).Highlight;
  if (!registry || !Highlight || !ranges.length) return false;
  registry.set(name, new Highlight(...ranges));
  return true;
}

export function clearHighlight(name: string): void {
  (globalThis.CSS as { highlights?: HighlightRegistry } | undefined)?.highlights?.delete(name);
}
