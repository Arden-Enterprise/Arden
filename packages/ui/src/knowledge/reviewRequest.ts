import type { KnowledgeSubmission } from "../shared/api-client";

/** Approval copy must describe the action actually committed, not treat every request as publication. */
export function reviewRequestPresentation(type: KnowledgeSubmission["requestType"]) {
  if (type === "WITHDRAWAL") return {
    label: "Withdrawal", title: "Withdraw this document?",
    effect: "This document will be removed from Library and AI answers.", success: "Document withdrawn",
  };
  if (type === "READER_CHANGE") return {
    label: "Reader change", title: "Change this document’s readers?",
    effect: "The proposed readers will replace the current readers.", success: "Readers updated",
  };
  return {
    label: "New version", title: "Approve this submission?",
    effect: "This version will be prepared for publication.", success: "Preparing publication",
  };
}
