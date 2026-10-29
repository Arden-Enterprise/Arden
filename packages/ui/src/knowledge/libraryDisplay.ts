/** A leading document code such as "NSS-STD-067 — " that some titles carry. */
const leadingCodePattern = /^([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+)\s*[—–-]\s+/;

/**
 * Splits a publication's display title from its document code for the Library list.
 * Display only: the stored title and code are unchanged. A code is shown only when the
 * publication has one or its title starts with one; otherwise no code line is rendered.
 */
export function libraryTitleParts(title: string, documentCode: string | null | undefined): { code: string | null; title: string } {
  const match = leadingCodePattern.exec(title);
  const code = documentCode?.trim() || match?.[1] || null;
  // Strip the prefix when it is the code being shown, so the code never appears twice.
  const shownTitle = match && match[1] === code ? title.slice(match[0].length) : title;
  return { code, title: shownTitle || title };
}

export function libraryDateLabel(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
