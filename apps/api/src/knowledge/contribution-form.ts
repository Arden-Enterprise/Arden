/**
 * Flow 2 T3.2 (BM04 RF-03, SDD S-09/S-10): the contribution form's field rules.
 *
 * Save draft accepts an incomplete form but rejects malformed values. Submit requires Document Name,
 * Category and Target Readers, and a Change Description for a new version of an already approved document.
 * Effective and Expiration Dates are optional (maintainer decision 2026-11-12); when both are set, the
 * Expiration Date must be later than the Effective Date. Pure; the repository
 * loads facts (active category, readable related documents) inside its transaction.
 */

export const maxKeywords = 20;
export const maxKeywordLength = 50;
export const maxChangeDescriptionLength = 2000;
export const maxRelatedDocuments = 20;

export type ContributionField =
  | "title" | "categoryId" | "targetReaders" | "effectiveDate" | "expirationDate"
  | "keywords" | "relatedDocumentIds" | "changeDescription";

export type FieldResult<T> = { ok: true; value: T } | { ok: false; field: ContributionField; reason: string };

const isoDate = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A real calendar date written as YYYY-MM-DD. */
export function isIsoDate(value: string): boolean {
  const match = isoDate.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function validateDates(effectiveDate: string | null, expirationDate: string | null): FieldResult<null> {
  if (effectiveDate !== null && !isIsoDate(effectiveDate)) {
    return { ok: false, field: "effectiveDate", reason: "Use a date in the form YYYY-MM-DD." };
  }
  if (expirationDate !== null && !isIsoDate(expirationDate)) {
    return { ok: false, field: "expirationDate", reason: "Use a date in the form YYYY-MM-DD." };
  }
  // ISO dates compare correctly as strings.
  if (effectiveDate !== null && expirationDate !== null && expirationDate <= effectiveDate) {
    return { ok: false, field: "expirationDate", reason: "The Expiration Date must be later than the Effective Date." };
  }
  return { ok: true, value: null };
}

/** Trims entries; refuses blanks, entries over 50 characters, case-insensitive duplicates and more than 20. */
export function normalizeKeywords(keywords: readonly string[]): FieldResult<string[]> {
  const trimmed = keywords.map((keyword) => keyword.normalize("NFKC").trim());
  if (trimmed.length > maxKeywords) return { ok: false, field: "keywords", reason: `Use at most ${maxKeywords} keywords.` };
  if (trimmed.some((keyword) => keyword.length === 0 || [...keyword].length > maxKeywordLength)) {
    return { ok: false, field: "keywords", reason: `Each keyword needs 1 to ${maxKeywordLength} characters.` };
  }
  if (new Set(trimmed.map((keyword) => keyword.toLowerCase())).size !== trimmed.length) {
    return { ok: false, field: "keywords", reason: "Each keyword can be used once." };
  }
  return { ok: true, value: trimmed };
}

/** Blank becomes null. */
export function normalizeChangeDescription(value: string | null): FieldResult<string | null> {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return { ok: true, value: null };
  if ([...trimmed].length > maxChangeDescriptionLength) {
    return { ok: false, field: "changeDescription", reason: `Use at most ${maxChangeDescriptionLength} characters.` };
  }
  return { ok: true, value: trimmed };
}

export function validateRelatedDocumentIds(documentId: string, ids: readonly string[]): FieldResult<string[]> {
  if (ids.length > maxRelatedDocuments) {
    return { ok: false, field: "relatedDocumentIds", reason: `Link at most ${maxRelatedDocuments} documents.` };
  }
  if (new Set(ids).size !== ids.length) return { ok: false, field: "relatedDocumentIds", reason: "Link each document once." };
  if (ids.includes(documentId)) return { ok: false, field: "relatedDocumentIds", reason: "A document cannot be related to itself." };
  return { ok: true, value: [...ids] };
}

export type SubmitFacts = {
  title: string;
  categoryId: string | null;
  /** The saved category is still active in the organization. */
  categoryActive: boolean;
  hasTargetReaders: boolean;
  effectiveDate: string | null;
  expirationDate: string | null;
  changeDescription: string | null;
  /** The document already has an approved version, so this submission is a new version. */
  isNewVersion: boolean;
};

/** The first missing or invalid required field, in form order; null when the form can be submitted. */
export function submitFieldError(facts: SubmitFacts): { field: ContributionField; missing: boolean; reason: string } | null {
  if (!facts.title.trim()) return { field: "title", missing: true, reason: "Enter a document name." };
  if (!facts.categoryId) return { field: "categoryId", missing: true, reason: "Choose a category." };
  if (!facts.categoryActive) return { field: "categoryId", missing: false, reason: "Choose an active category." };
  if (!facts.hasTargetReaders) return { field: "targetReaders", missing: true, reason: "Choose who can read this document." };
  const dates = validateDates(facts.effectiveDate, facts.expirationDate);
  if (!dates.ok) return { field: dates.field, missing: false, reason: dates.reason };
  if (facts.isNewVersion && !facts.changeDescription?.trim()) {
    return { field: "changeDescription", missing: true, reason: "Describe what changed in this version." };
  }
  return null;
}
