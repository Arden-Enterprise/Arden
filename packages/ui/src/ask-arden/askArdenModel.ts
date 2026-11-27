import {
  PROTOTYPE_DENYLIST,
  type BoundUiSurface,
  type HydratedDocumentSummary,
  type TurnHydration,
} from "@arden/domain";
import type { AnswerFeedback, AskArdenAnswer } from "../shared/api-client";

export type AskArdenMessage = {
  id: string;
  role: "member" | "assistant";
  body: string;
  citations?: AskArdenAnswer["citations"];
  uiSurface?: BoundUiSurface | null;
  turnHydration?: TurnHydration | null;
  savedTurn?: { conversationId: string; turnId: string };
  feedback?: AnswerFeedback;
  privateFeedbackToken?: string;
  noteCoverage?: "FULL" | "PARTIAL";
  insufficientEvidence?: boolean;
  unavailable?: boolean;
  requestId?: string;
  /** The request failed before an answer was saved; sending the same text retries it. */
  unsent?: boolean;
};

export const starterPrompts = [
  "How does knowledge approval work?",
  "Summarize our published onboarding guidance",
  "Which policy covers external sharing?",
] as const;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Defensively copies a server-provided hydratedDocuments map while stripping prototype keys. */
export function parseHydratedDocuments(raw: unknown): Record<string, HydratedDocumentSummary> {
  const result = Object.create(null) as Record<string, HydratedDocumentSummary>;
  if (!isPlainRecord(raw)) return result;
  for (const key of Object.keys(raw)) {
    if (PROTOTYPE_DENYLIST.has(key)) continue;
    const entry = raw[key];
    if (isPlainRecord(entry) && typeof entry.documentId === "string" && typeof entry.publishedVersionId === "string" && typeof entry.title === "string") {
      result[key] = entry as unknown as HydratedDocumentSummary;
    }
  }
  return result;
}

export function mergeHydratedDocuments(
  current: Readonly<Record<string, HydratedDocumentSummary>>,
  incoming: unknown,
): Record<string, HydratedDocumentSummary> {
  const parsed = parseHydratedDocuments(incoming);
  const incomingKeys = Object.keys(parsed);
  if (incomingKeys.length === 0) return current as Record<string, HydratedDocumentSummary>;
  const merged = Object.create(null) as Record<string, HydratedDocumentSummary>;
  for (const key of Object.keys(current)) {
    if (!PROTOTYPE_DENYLIST.has(key)) merged[key] = current[key]!;
  }
  for (const key of incomingKeys) {
    merged[key] = parsed[key]!;
  }
  return merged;
}

export function parseTurnHydration(raw: unknown): TurnHydration | null {
  if (!isPlainRecord(raw)) return null;
  const metrics = isPlainRecord(raw.metrics) ? (raw.metrics as TurnHydration["metrics"]) : {};
  const lineages = isPlainRecord(raw.lineages) ? (raw.lineages as TurnHydration["lineages"]) : {};
  return { metrics, lineages };
}

export function answerMessage(answer: AskArdenAnswer, id: string): AskArdenMessage {
  const uiSurface = isPlainRecord(answer.uiSurface) ? (answer.uiSurface as unknown as BoundUiSurface) : null;
  const turnHydration = parseTurnHydration(answer.turnHydration);
  return {
    id,
    role: "assistant",
    body: answer.answer,
    requestId: answer.requestId,
    citations: answer.citations.length ? answer.citations : undefined,
    ...(uiSurface ? { uiSurface } : {}),
    ...(turnHydration ? { turnHydration } : {}),
    insufficientEvidence: answer.status === "INSUFFICIENT_EVIDENCE",
    ...(answer.conversationId && answer.turnId ? { savedTurn: { conversationId: answer.conversationId, turnId: answer.turnId } } : {}),
    ...(answer.feedback !== undefined ? { feedback: answer.feedback } : {}),
    ...(answer.feedbackToken ? { privateFeedbackToken: answer.feedbackToken } : {}),
    ...(answer.noteCoverage ? { noteCoverage: answer.noteCoverage } : {}),
  };
}

export type AnswerCitation = AskArdenAnswer["citations"][number];

/** A run of answer text with the light Markdown emphasis models use; the delimiters themselves are removed. */
export type InlinePart = { text: string; strong?: boolean; emphasis?: boolean; code?: boolean };
/** One sentence: `text` is what the reader sees, `parts` the same text with its emphasis. */
export type AnswerSegment = { text: string; parts: InlinePart[]; trailing: string; sourceNumbers: number[] };
export type AnswerLine = AnswerSegment[];
export type AnswerBlock =
  | { kind: "paragraph"; lines: AnswerLine[] }
  | { kind: "heading"; line: AnswerLine }
  | { kind: "list"; ordered: boolean; start: number; items: AnswerLine[] };

const markerPattern = /\s?\[(\d{1,2})\]/g;

function sentences(paragraph: string): string[] {
  const Segmenter = (Intl as { Segmenter?: typeof Intl.Segmenter }).Segmenter;
  const parts = Segmenter
    ? Array.from(new Segmenter(undefined, { granularity: "sentence" }).segment(paragraph), (part) => part.segment)
    : paragraph.match(/[^.!?]+(?:[.!?]+["')\]]*\s*|$)/g) ?? [paragraph];
  return parts.filter((part) => part.length > 0);
}

type LineKind = { kind: "plain" } | { kind: "heading" } | { kind: "item"; ordered: boolean; number: number };
type SourceLine = LineKind & { text: string; chunk: number };

/** Splits an answer into lines, recognising headings and bullet/numbered items. Rules (---) are dropped. */
function answerLines(answer: string): SourceLine[] {
  const lines: SourceLine[] = [];
  answer.replace(/\r\n?/g, "\n").split(/\n[ \t]*\n/).forEach((chunk, index) => {
    for (const raw of chunk.split("\n")) {
      if (!raw.trim() || /^\s*([-*_])(\s*\1){2,}\s*$/.test(raw)) continue;
      const heading = /^ {0,3}#{1,6}\s+(.*?)(?:\s+#+)?\s*$/.exec(raw);
      const bullet = /^\s*[-*+]\s+(.*)$/.exec(raw);
      const ordered = /^\s*(\d{1,3})[.)]\s+(.*)$/.exec(raw);
      if (heading) lines.push({ kind: "heading", text: heading[1]!, chunk: index });
      else if (bullet) lines.push({ kind: "item", ordered: false, number: 1, text: bullet[1]!, chunk: index });
      else if (ordered) lines.push({ kind: "item", ordered: true, number: Number(ordered[1]), text: ordered[2]!, chunk: index });
      else lines.push({ kind: "plain", text: raw.trimEnd(), chunk: index });
    }
  });
  return lines;
}

type Style = { hidden?: boolean; strong?: boolean; emphasis?: boolean; code?: boolean };
const isSpace = (character: string | undefined) => character === undefined || /\s/u.test(character);
const isWord = (character: string | undefined) => character !== undefined && /[\p{L}\p{N}]/u.test(character);

/**
 * Per-character emphasis for one line: backtick code, double-asterisk or double-underscore strong text, and
 * single-asterisk or single-underscore emphasis. Computed over the whole line, so a bold phrase stays bold when a sentence boundary falls inside it. Unpaired delimiters stay visible.
 */
function inlineStyles(text: string): Style[] {
  const styles: Style[] = Array.from({ length: text.length }, () => ({}));
  const taken = new Array<boolean>(text.length).fill(false);
  for (const match of text.matchAll(/`([^`]+)`/g)) {
    const start = match.index, end = start + match[0].length - 1;
    styles[start]!.hidden = styles[end]!.hidden = true;
    for (let index = start; index <= end; index++) {
      taken[index] = true;
      if (index > start && index < end) styles[index]!.code = true;
    }
  }
  const free = (from: number, length: number) => taken.slice(from, from + length).every((value) => !value);
  const pair = (delimiter: string, style: "strong" | "emphasis") => {
    const size = delimiter.length, single = size === 1, underscore = delimiter[0] === "_";
    // A lone * or _ next to another free one belongs to an unpaired ** or __, not to emphasis.
    const alone = (index: number) => !single
      || ((text[index - 1] !== delimiter || taken[index - 1]) && (text[index + 1] !== delimiter || taken[index + 1]));
    for (let open = 0; open + size < text.length; open++) {
      if (!text.startsWith(delimiter, open) || !free(open, size) || !alone(open) || isSpace(text[open + size])
        || (underscore && isWord(text[open - 1]))) continue;
      let close = -1;
      for (let index = open + size + 1; index + size <= text.length; index++) {
        if (text.startsWith(delimiter, index) && free(index, size) && alone(index) && !isSpace(text[index - 1])
          && !(underscore && isWord(text[index + size]))) { close = index; break; }
      }
      if (close < 0) continue;
      for (let index = open; index < close + size; index++) {
        if (index < open + size || index >= close) { styles[index]!.hidden = true; taken[index] = true; }
        else styles[index]![style] = true;
      }
      open = close + size - 1;
    }
  };
  pair("**", "strong"); pair("__", "strong"); pair("*", "emphasis"); pair("_", "emphasis");
  return styles;
}

function styledParts(text: string, styles: Style[], from: number, to: number): InlinePart[] {
  const parts: InlinePart[] = [];
  for (let index = from; index < to; index++) {
    const style = styles[index]!;
    if (style.hidden) continue;
    const last = parts.at(-1);
    if (last && !!last.strong === !!style.strong && !!last.emphasis === !!style.emphasis && !!last.code === !!style.code) {
      last.text += text[index];
    } else {
      parts.push({ text: text[index]!, ...(style.strong ? { strong: true } : {}), ...(style.emphasis ? { emphasis: true } : {}),
        ...(style.code ? { code: true } : {}) });
    }
  }
  return parts;
}

/** Render explicit source markers. The Sources panel also lists passages without a marker. */
export function layoutCitedAnswer(answer: string, citations: readonly AnswerCitation[]): AnswerBlock[] {
  const lines = answerLines(answer);
  if (!lines.length) lines.push({ kind: "plain", text: answer, chunk: 0 });
  const units = lines.map((line) => sentences(line.text));
  for (const unit of units) if (!unit.length) unit.push("");
  const assigned = units.map((unit) => unit.map(() => new Set<number>()));
  const texts = units.map((unit, u) => unit.map((sentence, s) =>
    sentence.replace(markerPattern, (marker, number: string) => {
      const index = Number(number);
      if (!citations[index - 1]) return marker;
      assigned[u]![s]!.add(index);
      return "";
    })));

  const laidOut: AnswerLine[] = texts.map((unit, u) => {
    const line = unit.join(""), styles = inlineStyles(line);
    let offset = 0;
    return unit.map((sentence, s) => {
      const visible = sentence.trimEnd().length;
      const parts = styledParts(line, styles, offset, offset + visible);
      offset += sentence.length;
      return { text: parts.map((part) => part.text).join(""), parts, trailing: sentence.slice(visible),
        sourceNumbers: [...assigned[u]![s]!] };
    });
  });

  const blocks: AnswerBlock[] = [];
  lines.forEach((line, index) => {
    const content = laidOut[index]!, previous = blocks.at(-1), before = lines[index - 1];
    if (line.kind === "heading") blocks.push({ kind: "heading", line: content });
    else if (line.kind === "item") {
      if (previous?.kind === "list" && previous.ordered === line.ordered) previous.items.push(content);
      else blocks.push({ kind: "list", ordered: line.ordered, start: line.number, items: [content] });
    } else if (previous?.kind === "paragraph" && before?.kind === "plain" && before.chunk === line.chunk) {
      previous.lines.push(content);
    } else blocks.push({ kind: "paragraph", lines: [content] });
  });
  return blocks;
}

/** Preserve paragraphs and list structure when copying the visible answer as plain text. */
export function copyableAnswer(answer: string, citations: readonly AnswerCitation[]): string {
  const line = (segments: AnswerLine) => segments.map(({ text, trailing }) => text + trailing).join("");
  return layoutCitedAnswer(answer, citations).map(block => {
    if (block.kind === "heading") return line(block.line);
    if (block.kind === "paragraph") return block.lines.map(line).join("\n");
    return block.items.map((item, index) => `${block.ordered ? `${block.start + index}.` : "-"} ${line(item)}`).join("\n");
  }).join("\n\n").trim();
}
