import type { AskArdenAnswer } from "../shared/api-client";

export type AskArdenMessage = {
  id: string;
  role: "member" | "assistant";
  body: string;
  citations?: AskArdenAnswer["citations"];
  insufficientEvidence?: boolean;
  unavailable?: boolean;
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
    citations: answer.citations.length ? answer.citations : undefined,
    insufficientEvidence: answer.status === "INSUFFICIENT_EVIDENCE",
  };
}

export type AnswerCitation = AskArdenAnswer["citations"][number];

/** One document cited at a point in the answer, with every passage from it that supports that point. */
export type CitedSource = { key: string; label: string; title: string; citations: AnswerCitation[] };
export type AnswerSegment = { text: string; trailing: string; sources: CitedSource[] };
export type AnswerParagraph = AnswerSegment[];

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

function sourceLabel(citation: AnswerCitation): string {
  return citation.documentCode?.trim() || citation.title;
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
 * and a quote that matches no sentence is placed at the end of the answer.
 */
export function layoutCitedAnswer(answer: string, citations: readonly AnswerCitation[]): AnswerParagraph[] {
  const paragraphs = answer.split(/\n{2,}/).filter((paragraph) => paragraph.trim()).map(sentences);
  if (!paragraphs.length) paragraphs.push([answer]);
  const assigned = paragraphs.map((paragraph) => paragraph.map(() => [] as AnswerCitation[]));
  const usesMarkers = [...answer.matchAll(markerPattern)].some((match) => Number(match[1]) >= 1 && Number(match[1]) <= citations.length);

  const texts = paragraphs.map((paragraph, p) => paragraph.map((sentence, s) => {
    if (!usesMarkers) return sentence;
    return sentence.replace(markerPattern, (marker, number: string) => {
      const citation = citations[Number(number) - 1];
      if (!citation) return marker;
      assigned[p]![s]!.push(citation);
      return "";
    });
  }));

  if (usesMarkers) {
    const placed = new Set(assigned.flat(2));
    for (const citation of citations) if (!placed.has(citation)) assigned.at(-1)!.at(-1)!.push(citation);
  } else {
    const sentenceTokens = texts.map((paragraph) => paragraph.map(tokens));
    for (const citation of citations) {
      const quote = tokens(citation.excerpt);
      let best: { p: number; s: number; score: number } | null = null;
      sentenceTokens.forEach((paragraph, p) => paragraph.forEach((words, s) => {
        let shared = 0;
        for (const word of words) if (quote.has(word)) shared++;
        const score = words.size ? shared / Math.sqrt(words.size) : 0;
        if (shared >= 2 && (!best || score > best.score)) best = { p, s, score };
      }));
      const target = best as { p: number; s: number } | null;
      if (target) assigned[target.p]![target.s]!.push(citation);
      else assigned.at(-1)!.at(-1)!.push(citation);
    }
  }

  return texts.map((paragraph, p) => paragraph.map((sentence, s) => {
    const text = sentence.trimEnd();
    return { text, trailing: sentence.slice(text.length), sources: groupByDocument(assigned[p]![s]!) };
  }));
}
