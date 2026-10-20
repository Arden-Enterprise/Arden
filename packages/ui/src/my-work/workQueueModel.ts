export type WorkType = "review" | "handover" | "knowledge";
export type WorkStatus = "review-requested" | "at-risk" | "in-progress" | "source-changed";
export type WorkQueueItem = {
  id: string;
  title: string;
  type: WorkType;
  status: WorkStatus;
  statusLabel: string;
  detail: string;
  metadata: string;
  assignee: string;
  tone: "amber" | "red" | "blue";
};

export const sampleWorkQueue: readonly WorkQueueItem[] = [
  { id: "sample-runbook", title: "API Gateway Runbook", type: "review", status: "review-requested", statusLabel: "Review requested", detail: "Due today", metadata: "Platform Reliability · Updated 3h ago", assignee: "TD", tone: "amber" },
  { id: "sample-handover", title: "Operations ownership handover", type: "handover", status: "at-risk", statusLabel: "Missing owner", detail: "3 assets", metadata: "Owner departure · Updated 1 day ago", assignee: "Unassigned", tone: "red" },
  { id: "sample-retrospective", title: "Incident retrospective — 18 Sep", type: "knowledge", status: "in-progress", statusLabel: "In progress", detail: "Check scope", metadata: "Incident Management · Updated 2 days ago", assignee: "MK", tone: "blue" },
  { id: "sample-timeout", title: "Checkout timeout decision", type: "knowledge", status: "source-changed", statusLabel: "Source changed", detail: "Jira ARD-482", metadata: "Arden Core · Updated 2 days ago", assignee: "HP", tone: "amber" },
];

export function filterWorkQueue(items: readonly WorkQueueItem[], filters: { query: string; type: WorkType | "all"; status: WorkStatus | "all" }): WorkQueueItem[] {
  const query = filters.query.trim().toLocaleLowerCase();
  return items.filter((item) => (filters.type === "all" || item.type === filters.type)
    && (filters.status === "all" || item.status === filters.status)
    && `${item.title} ${item.statusLabel} ${item.detail} ${item.metadata} ${item.assignee}`.toLocaleLowerCase().includes(query));
}
