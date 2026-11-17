/**
 * Locates a cited quote inside text that a viewer split into pieces (PDF text-layer runs, rich-text nodes).
 *
 * Extracted and rendered text rarely agree on whitespace, line breaks, ligatures or typographic punctuation,
 * so matching ignores whitespace and compares a normalized form. Positions map back to the original pieces.
 */
export type TextPosition = { segment: number; offset: number };
export type TextMatch = { start: TextPosition; end: TextPosition; complete: boolean };

const punctuation: Record<string, string> = {
  "‘": "'", "’": "'", "‚": "'", "‛": "'", "′": "'",
  "“": "\"", "”": "\"", "„": "\"", "″": "\"",
  "‐": "-", "‑": "-", "‒": "-", "–": "-", "—": "-", "−": "-",
  "…": "...", " ": " ",
};

function normalizedCharacters(character: string): string {
  return (punctuation[character] ?? character).normalize("NFKC").toLocaleLowerCase().replace(/[\s­​-‍﻿]/gu, "");
}

function compact(text: string): string {
  let value = "";
  for (const character of text) value += normalizedCharacters(character);
  return value;
}

/** Shortest quote prefix still worth locating when the whole quote is not on one page. */
const minimumPartialLength = 24;

export function findQuoteInSegments(segments: readonly string[], quote: string): TextMatch | null {
  const needle = compact(quote);
  if (!needle) return null;
  let haystack = "";
  const positions: TextPosition[] = [];
  segments.forEach((segment, index) => {
    let offset = 0;
    for (const character of segment) {
      const normalized = normalizedCharacters(character);
      haystack += normalized;
      // String#indexOf and DOM text offsets use UTF-16 code units, not code points.
      for (let unit = 0; unit < normalized.length; unit++) {
        positions.push({ segment: index, offset });
      }
      offset += character.length;
    }
  });
  const locate = (target: string, complete: boolean): TextMatch | null => {
    const index = haystack.indexOf(target);
    if (index < 0) return null;
    const first = positions[index]!, last = positions[index + target.length - 1]!;
    const lastCharacter = segments[last.segment]!.codePointAt(last.offset)!;
    return { start: first, end: { segment: last.segment, offset: last.offset + (lastCharacter > 0xffff ? 2 : 1) }, complete };
  };
  const whole = locate(needle, true);
  if (whole) return whole;
  // A chunk can continue onto the next page; highlighting its opening still shows the reader where it starts.
  for (const length of [160, 80, minimumPartialLength]) {
    if (needle.length <= length) continue;
    const partial = locate(needle.slice(0, length), false);
    if (partial) return partial;
  }
  return null;
}

/** True when the quote, or its opening, appears in the text. */
export function textContainsQuote(text: string, quote: string): boolean {
  return findQuoteInSegments([text], quote) !== null;
}
