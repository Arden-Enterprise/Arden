/** Business metadata, independent of save revisions and publication/index timestamps. */
export const knowledgeTypes = ["Policy & Standard", "Procedure", "Guide", "Reference", "Lessons Learned"] as const;
export type KnowledgeType = typeof knowledgeTypes[number];
export type KnowledgeMetadata = {
  type: KnowledgeType | null;
  /** Legacy snapshot reference. Optional on input; new saves clear it. */
  topicId?: string | null;
  version: string;
  effectiveDate: string | null;
  expirationDate: string | null;
  changeNote: string;
};
export const emptyKnowledgeMetadata = (): KnowledgeMetadata => ({
  type: null, topicId: null, version: "", effectiveDate: null, expirationDate: null, changeNote: "",
});
export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
/** Drafts may be incomplete, but never store malformed values. */
export function validKnowledgeMetadata(value: KnowledgeMetadata): boolean {
  return (value.type === null || knowledgeTypes.includes(value.type))
    && (value.topicId == null || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.topicId))
    && value.version.length <= 30 && (!value.version || /^[\w][\w.\- ]{0,29}$/.test(value.version))
    && value.changeNote.length <= 1000
    && (value.effectiveDate === null || isCalendarDate(value.effectiveDate))
    && (value.expirationDate === null || isCalendarDate(value.expirationDate))
    && !(value.effectiveDate && value.expirationDate && value.expirationDate < value.effectiveDate);
}
export function metadataSubmissionErrors(value: KnowledgeMetadata, isUpdate: boolean): string[] {
  const errors: string[] = [];
  if (!validKnowledgeMetadata(value)) errors.push("Check document details.");
  if (!value.type) errors.push("Choose a type.");
  if (!value.version.trim()) errors.push("Enter a version.");
  if (isUpdate && !value.changeNote.trim()) errors.push("Add a change note.");
  return errors;
}
/** Days before the expiration date at which readers see "Expires in N days". */
export const expiringSoonDays = 30;
export type ValidityStatus = "Current" | "Expiring soon" | "Expired" | "Upcoming";
/**
 * Reader-facing validity (requested 15 Nov 2026): a publication is in force from approval and
 * shows only its optional expiration date. "Upcoming" remains only for older drafts that still
 * carry a future effective date, so their state is never misreported.
 */
export function validityStatus(metadata: KnowledgeMetadata | null | undefined, today: string):
  { status: ValidityStatus; daysLeft: number | null } {
  if (metadata?.effectiveDate && today < metadata.effectiveDate) return { status: "Upcoming", daysLeft: null };
  const expiration = metadata?.expirationDate;
  if (!expiration) return { status: "Current", daysLeft: null };
  if (today > expiration) return { status: "Expired", daysLeft: 0 };
  const daysLeft = Math.round((Date.parse(`${expiration}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  return { status: daysLeft <= expiringSoonDays ? "Expiring soon" : "Current", daysLeft };
}
