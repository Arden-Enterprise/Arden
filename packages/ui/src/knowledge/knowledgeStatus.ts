import type { KnowledgeDraftSummary, KnowledgeSubmission } from "../shared/api-client";

export function statusLabel(status: KnowledgeSubmission["status"]): string {
  return ({ PENDING_REVIEW: "Awaiting review", APPROVED: "Approved", REJECTED: "Rejected",
    WITHDRAWN: "Withdrawn" })[status];
}

export function validatePdfFile(file: Pick<File, "name" | "type" | "size"> | null): string {
  if (!file) return "Choose a PDF file from your computer.";
  if (!/\.pdf$/i.test(file.name) || (file.type && file.type !== "application/pdf")) return "Choose a PDF file. Other formats aren't accepted.";
  if (!file.size) return "Choose a PDF file that isn't empty.";
  if (file.size > 5 * 1024 * 1024) return `This file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 5 MB.`;
  return "";
}

export function draftStatus(item: Pick<KnowledgeDraftSummary, "hasPendingSubmission" | "responsibleDepartmentId" | "targetScopeType" | "audienceIds" | "versionId">, latest?: KnowledgeSubmission): { label: string; tone: string } {
  if (item.hasPendingSubmission) return { label: "Awaiting review", tone: "is-info" };
  if (!latest) return { label: item.responsibleDepartmentId && item.targetScopeType && item.audienceIds.length ? "Draft" : "Draft · metadata incomplete", tone: "" };
  if (latest.status === "APPROVED") return latest.publicationState === "ACTIVE"
    ? (latest.snapshotVersionId === item.versionId
      ? { label: "Published", tone: "is-success" } : { label: "Edited after publication", tone: "is-info" })
    : { label: "Preparing publication", tone: "is-info" };
  return { label: statusLabel(latest.status), tone: latest.status === "REJECTED" ? "is-danger" : "" };
}
