import type { AskArdenAnswer } from "../shared/api-client";

export type AskArdenMessage = {
  id: string;
  role: "member" | "assistant";
  body: string;
  citations?: AskArdenAnswer["citations"];
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

export function answerMessage(answer: AskArdenAnswer, id: string): AskArdenMessage {
  return {
    id,
    role: "assistant",
    body: answer.answer,
    requestId: answer.requestId,
    citations: answer.citations.length ? answer.citations : undefined,
    insufficientEvidence: answer.status === "INSUFFICIENT_EVIDENCE",
  };
}

export type AnswerCitation = AskArdenAnswer["citations"][number];

/** One document cited at a point in the answer, with every passage from it that supports that point. */
export type CitedSource = { key: string; label: string; title: string; citations: AnswerCitation[] };
/** A run of answer text with the light Markdown emphasis models use; the delimiters themselves are removed. */
export type InlinePart = { text: string; strong?: boolean; emphasis?: boolean; code?: boolean };
/** One sentence: `text` is what the reader sees, `parts` the same text with its emphasis. */
export type AnswerSegment = { text: string; parts: InlinePart[]; trailing: string; sources: CitedSource[] };
export type AnswerLine = AnswerSegment[];
export type AnswerBlock =
  | { kind: "paragraph"; lines: AnswerLine[] }
  | { kind: "heading"; line: AnswerLine }
  | { kind: "list"; ordered: boolean; start: number; items: AnswerLine[] };

const markerPattern = /\s?\[(\d{1,2})\]/g;
const stopWords = new Set(["the", "and", "for", "are", "was", "were", "with", "that", "this", "from", "have", "has", "not",
  "but", "can", "may", "must", "should", "will", "its", "their", "they", "you", "your", "our", "all", "any", "each", "into",
  "than", "then", "when", "which", "who", "what", "how", "also", "been", "being", "per", "via",
  "của", "và", "các", "những", "là", "cho", "với", "được", "trong", "một", "có", "không", "này", "khi", "để", "theo", "từ"]);

function tokens(text: string): Set<string> {
  const words = text.normalize("NFKC").toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return new Set(words.filter((word) => (word.length > 2 || /\p{N}/u.test(word)) && !stopWords.has(word)));
}

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

/** Decision 0021: documents are named by title; a Document Code is never shown. */
function sourceLabel(citation: AnswerCitation): string {
  return citation.title;
}

function uniqueCitations(citations: readonly AnswerCitation[]): AnswerCitation[] {
  const seen = new Set<string>();
  return citations.filter((citation) => {
    const key = `${citation.versionId}\u0000${citation.blockId ?? ""}\u0000${citation.excerpt}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function groupByDocument(citations: readonly AnswerCitation[]): CitedSource[] {
  const groups = new Map<string, CitedSource>();
  for (const citation of uniqueCitations(citations)) {
    const group = groups.get(citation.versionId);
    if (group) group.citations.push(citation);
    else groups.set(citation.versionId, { key: citation.versionId, label: sourceLabel(citation), title: citation.title, citations: [citation] });
  }
  return [...groups.values()];
}

/**
 * Places citations inline, after the sentence each one supports. Answers that number their sources with
 * `[n]` markers are placed exactly; otherwise each quote goes after the sentence sharing most of its words,
 * and a quote that matches no sentence is placed at the end of the answer. Headings, lists and inline emphasis
 * are kept as structure rather than shown as Markdown characters.
 */
export function layoutCitedAnswer(answer: string, citations: readonly AnswerCitation[]): AnswerBlock[] {
  const lines = answerLines(answer);
  if (!lines.length) lines.push({ kind: "plain", text: answer, chunk: 0 });
  const units = lines.map((line) => sentences(line.text));
  for (const unit of units) if (!unit.length) unit.push("");
  const assigned = units.map((unit) => unit.map(() => [] as AnswerCitation[]));
  const usesMarkers = [...answer.matchAll(markerPattern)].some((match) => Number(match[1]) >= 1 && Number(match[1]) <= citations.length);

  const texts = units.map((unit, u) => unit.map((sentence, s) => {
    if (!usesMarkers) return sentence;
    return sentence.replace(markerPattern, (marker, number: string) => {
      const citation = citations[Number(number) - 1];
      if (!citation) return marker;
      assigned[u]![s]!.push(citation);
      return "";
    });
  }));

  if (usesMarkers) {
    const placed = new Set(assigned.flat(2));
    for (const citation of citations) if (!placed.has(citation)) assigned.at(-1)!.at(-1)!.push(citation);
  } else {
    const sentenceTokens = texts.map((unit) => unit.map(tokens));
    for (const citation of citations) {
      const quote = tokens(citation.excerpt);
      let best: { u: number; s: number; score: number } | null = null;
      sentenceTokens.forEach((unit, u) => unit.forEach((words, s) => {
        let shared = 0;
        for (const word of words) if (quote.has(word)) shared++;
        const score = words.size ? shared / Math.sqrt(words.size) : 0;
        if (shared >= 2 && (!best || score > best.score)) best = { u, s, score };
      }));
      const target = best as { u: number; s: number } | null;
      if (target) assigned[target.u]![target.s]!.push(citation);
      else assigned.at(-1)!.at(-1)!.push(citation);
    }
  }

  const laidOut: AnswerLine[] = texts.map((unit, u) => {
    const line = unit.join(""), styles = inlineStyles(line);
    let offset = 0;
    return unit.map((sentence, s) => {
      const visible = sentence.trimEnd().length;
      const parts = styledParts(line, styles, offset, offset + visible);
      offset += sentence.length;
      return { text: parts.map((part) => part.text).join(""), parts, trailing: sentence.slice(visible),
        sources: groupByDocument(assigned[u]![s]!) };
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
