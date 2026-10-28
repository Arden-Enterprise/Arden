const pdfPageBlockPattern = /^pdf-page-([1-9]\d*)(?:-|$)/;

export function citationPage(sourceBlockIds: readonly string[], parentSectionBlockId?: string | null): number | undefined {
  const candidates = parentSectionBlockId ? [...sourceBlockIds, parentSectionBlockId] : sourceBlockIds;
  for (const candidate of candidates) {
    const match = pdfPageBlockPattern.exec(candidate);
    if (!match) continue;
    const page = Number(match[1]);
    if (Number.isSafeInteger(page)) return page;
  }
  return undefined;
}
