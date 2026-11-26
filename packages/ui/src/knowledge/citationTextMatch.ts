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

function locateInSegments(segments: readonly string[]) {
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
  return (target: string, complete: boolean, unique = false): TextMatch | null => {
    if (!target) return null;
    const index = haystack.indexOf(target);
    if (index < 0 || (unique && haystack.indexOf(target, index + 1) !== -1)) return null;
    const first = positions[index]!, last = positions[index + target.length - 1]!;
    const lastCharacter = segments[last.segment]!.codePointAt(last.offset)!;
    return { start: first, end: { segment: last.segment, offset: last.offset + (lastCharacter > 0xffff ? 2 : 1) }, complete };
  };
}

function locatePrefix(needle: string, locate: ReturnType<typeof locateInSegments>): TextMatch | null {
  // A chunk can continue onto the next page; highlighting its opening still shows the reader where it starts.
  for (const length of [160, 80, minimumPartialLength]) {
    if (needle.length <= length) continue;
    const partial = locate(needle.slice(0, length), false);
    if (partial) return partial;
  }
  return null;
}

export function findQuoteInSegments(segments: readonly string[], quote: string): TextMatch | null {
  const needle = compact(quote);
  if (!needle) return null;
  const locate = locateInSegments(segments);
  return locate(needle, true) ?? locatePrefix(needle, locate);
}

/** The same PDF page can expose table cells or headings between lines in its rendered text order. */
export function findPageQuoteMatches(segments: readonly string[], quote: string): TextMatch[] {
  const needle = compact(quote);
  if (!needle) return [];
  const locate = locateInSegments(segments);
  const whole = locate(needle, true);
  if (whole) return [whole];

  const lines = quote.split(/\r?\n/).map(compact).filter(line => line.length >= 12);
  const matched = lines.flatMap(line => {
    const match = locate(line, false, true);
    return match ? [{ match, length: line.length }] : [];
  });
  const inOrder = matched.every(({ match }, index) => {
    const previous = matched[index - 1]?.match.end;
    return !previous || previous.segment < match.start.segment
      || (previous.segment === match.start.segment && previous.offset <= match.start.offset);
  });
  // Require multiple unique, ordered lines covering most of the quote. Leave layout-only gaps unpainted.
  if (matched.length >= 2 && inOrder && matched.reduce((size, line) => size + line.length, 0) / needle.length >= 0.6) {
    return matched.map(line => line.match);
  }
  const prefix = locatePrefix(needle, locate);
  return prefix ? [prefix] : [];
}
