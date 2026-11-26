export type InlineFormat = "bold" | "italic" | "strike" | "code";

export const inlineFormats: readonly InlineFormat[] = ["bold", "italic", "strike", "code"];

const markers: Record<InlineFormat, string> = { bold: "**", italic: "_", strike: "~~", code: "`" };

/** Leading Markdown block syntax stays outside inline markers so lists and headings keep working. */
const blockPrefix = /^(?:\s*(?:#{1,6}\s+|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+|>\s*))+/;

type Segment = { start: number; end: number };

/** Inline Markdown cannot span lines, so each selected line is formatted on its own. */
function segments(value: string, start: number, end: number): Segment[] {
  const result: Segment[] = [];
  let lineStart = value.lastIndexOf("\n", start - 1) + 1;
  while (lineStart <= end && lineStart <= value.length) {
    const newline = value.indexOf("\n", lineStart);
    const lineEnd = newline === -1 ? value.length : newline;
    let from = Math.max(start, lineStart);
    let to = Math.min(end, lineEnd);
    if (from === lineStart) from += value.slice(lineStart, lineEnd).match(blockPrefix)?.[0].length ?? 0;
    while (from < to && /\s/.test(value[from]!)) from += 1;
    while (to > from && /\s/.test(value[to - 1]!)) to -= 1;
    if (from < to) result.push({ start: from, end: to });
    if (newline === -1) break;
    lineStart = newline + 1;
  }
  return result;
}

type MarkerPair = { open: number; close: number };

const formatMarkers = Object.values(markers);

function wrapping(value: string, { start, end }: Segment, marker: string): MarkerPair | null {
  // A selection may include the marker pair or sit inside one or more nested pairs.
  let left = start;
  let right = end;
  while (left < right) {
    const candidate = formatMarkers.find(item => right - left > item.length * 2
      && value.startsWith(item, left) && value.startsWith(item, right - item.length));
    if (!candidate) break;
    if (candidate === marker) return { open: left, close: right - marker.length };
    if (candidate === markers.code) break;
    left += candidate.length;
    right -= candidate.length;
  }
  left = start;
  right = end;
  while (left > 0 && right < value.length) {
    const candidate = formatMarkers.find(item => left >= item.length
      && value.startsWith(item, left - item.length) && value.startsWith(item, right));
    if (!candidate) break;
    if (candidate === marker) return { open: left - marker.length, close: right };
    left -= candidate.length;
    right += candidate.length;
  }
  return null;
}

export function activeInlineFormats(value: string, start: number, end: number): Record<InlineFormat, boolean> {
  const parts = segments(value, start, end);
  const active = { bold: false, italic: false, strike: false, code: false };
  for (const format of inlineFormats) {
    active[format] = parts.length > 0 && parts.every(part => wrapping(value, part, markers[format]) !== null);
  }
  return active;
}

export type InlineFormatEdit = {
  /** Range of the original text to replace with `insert`. */
  from: number; to: number; insert: string;
  value: string;
  /** The formatted text in `value`, excluding the markers. */
  start: number; end: number;
};

/** Adds the format to every selected line, or removes it when every line already has it. */
export function toggleInlineFormat(value: string, start: number, end: number, format: InlineFormat): InlineFormatEdit | null {
  const parts = segments(value, start, end);
  if (!parts.length) return null;
  const marker = markers[format];
  const remove = parts.every(part => wrapping(value, part, marker) !== null);
  let output = "";
  let cursor = 0;
  let selectionStart = 0;
  let selectionEnd = 0;
  let from = 0;
  let to = 0;
  parts.forEach((part, index) => {
    const wrapped = wrapping(value, part, marker);
    let outerStart = part.start;
    let outerEnd = part.end;
    let inner = value.slice(part.start, part.end);
    let selectedStart = 0;
    let selectedEnd = inner.length;
    let added = "";
    if (remove && wrapped) {
      const { open, close } = wrapped;
      const size = marker.length;
      outerStart = Math.min(part.start, open);
      outerEnd = Math.max(part.end, close + size);
      inner = value.slice(outerStart, open) + value.slice(open + size, close) + value.slice(close + size, outerEnd);
      selectedStart = Math.max(part.start, open + size) - outerStart - size;
      selectedEnd = Math.min(part.end, close) - outerStart - size;
    } else if (!wrapped) {
      added = marker;
    }
    if (index === 0) from = outerStart;
    output += value.slice(cursor, outerStart) + added;
    if (index === 0) selectionStart = output.length + selectedStart;
    if (index === parts.length - 1) { selectionEnd = output.length + selectedEnd; to = outerEnd; }
    output += inner + added;
    cursor = outerEnd;
  });
  const tail = value.slice(cursor);
  output += tail;
  return { from, to, insert: output.slice(from, output.length - tail.length), value: output, start: selectionStart, end: selectionEnd };
}
