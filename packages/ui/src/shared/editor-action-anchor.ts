export type EditorActionAnchor = { left: number; top: number; bottom: number };

export function pointAnchor(x: number, y: number): EditorActionAnchor {
  return { left: x, top: y, bottom: y };
}

const textareaLayout = [
  "direction", "font-family", "font-size", "font-style", "font-weight", "font-variant",
  "font-stretch", "font-kerning", "letter-spacing", "word-spacing", "line-height", "text-align",
  "text-indent", "text-transform", "tab-size", "padding-top", "padding-right", "padding-bottom",
  "padding-left", "overflow-wrap", "word-break", "white-space",
] as const;

/** A textarea's selection is not a DOM Range. Lay out its text at the same wrap width to measure it. */
export function textareaSelectionAnchor(
  field: HTMLTextAreaElement, start: number, end: number, fallback: EditorActionAnchor,
): EditorActionAnchor {
  const doc = field.ownerDocument;
  const box = field.getBoundingClientRect();
  const style = doc.defaultView?.getComputedStyle(field);
  if (!style || !field.clientWidth || !doc.createRange().getClientRects) return fallback;

  const mirror = doc.createElement("div");
  mirror.setAttribute("aria-hidden", "true");
  for (const property of textareaLayout) mirror.style.setProperty(property, style.getPropertyValue(property));
  Object.assign(mirror.style, {
    position: "fixed", visibility: "hidden", pointerEvents: "none", boxSizing: "border-box",
    left: "0", top: "0", width: `${field.clientWidth}px`,
  });
  const content = doc.createTextNode(field.value + "\u200b");
  mirror.append(content);
  doc.body.append(mirror);
  try {
    const range = doc.createRange();
    range.setStart(content, start);
    range.setEnd(content, end === start ? end + 1 : end);
    const origin = mirror.getBoundingClientRect();
    const offsetX = box.left + field.clientLeft - field.scrollLeft - origin.left;
    const offsetY = box.top + field.clientTop - field.scrollTop - origin.top;
    const lines = Array.from(range.getClientRects()).filter(rect =>
      rect.height > 0 && rect.bottom + offsetY > box.top && rect.top + offsetY < box.bottom);
    const first = lines[0];
    const last = lines.at(-1);
    if (!first || !last) return fallback;
    return {
      left: Math.min(box.right, Math.max(box.left, last.right + offsetX)),
      top: Math.max(box.top, first.top + offsetY),
      bottom: Math.min(box.bottom, last.bottom + offsetY),
    };
  } finally {
    mirror.remove();
  }
}
