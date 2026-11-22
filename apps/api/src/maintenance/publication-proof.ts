export type PublicationProof = {
  state: "pending" | "applicable" | "rejected" | "upcoming";
  outcome: "UPDATED" | "WITHDRAWN" | null;
  publishedVersionId: string | null;
};

export type PublicationPointer = {
  currentVersionId: string;
  currentVersionNo: number;
  reportedVersionNo: number;
  validFrom: string;
  validUntil: string | null;
  status: string;
  requestType: string;
  publicationState: string;
  rejected: boolean;
  withdrawn: boolean;
};

export function publicationProofFromPointer(reportedVersionId: string, pointer: PublicationPointer | null, now = new Date()): PublicationProof {
  if (!pointer) return { state: "pending", outcome: null, publishedVersionId: null };
  if (!pointer.currentVersionId) {
    return pointer.withdrawn
      ? { state: "applicable", outcome: "WITHDRAWN", publishedVersionId: reportedVersionId }
      : { state: "pending", outcome: null, publishedVersionId: null };
  }
  if (new Date(pointer.validFrom).getTime() > now.getTime()) {
    return { state: "upcoming", outcome: null, publishedVersionId: pointer.currentVersionId };
  }
  if (pointer.currentVersionId === reportedVersionId) {
    return pointer.rejected
      ? { state: "rejected", outcome: null, publishedVersionId: pointer.currentVersionId }
      : { state: "pending", outcome: null, publishedVersionId: pointer.currentVersionId };
  }
  const inForce = pointer.validUntil === null || new Date(pointer.validUntil).getTime() > now.getTime();
  if (inForce && pointer.currentVersionNo > pointer.reportedVersionNo
    && pointer.status === "APPROVED" && pointer.requestType === "CONTENT" && pointer.publicationState === "ACTIVE") {
    return { state: "applicable", outcome: "UPDATED", publishedVersionId: pointer.currentVersionId };
  }
  return { state: "pending", outcome: null, publishedVersionId: pointer.currentVersionId };
}
