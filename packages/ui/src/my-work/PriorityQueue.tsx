import type { WorkQueueItem } from "./workQueueModel";

const toneClass: Record<WorkQueueItem["tone"], string> = { amber: "tone-warning", red: "tone-danger", blue: "tone-info" };
const actionLabel: Record<WorkQueueItem["type"], string> = { review: "Review", handover: "Open handover", knowledge: "Continue" };

export function PriorityQueue({ items, filtersActive, onClearFilters, onOpenKnowledge, onOpenReview, onOpenHandover }: {
  items: readonly WorkQueueItem[];
  filtersActive: boolean;
  onClearFilters: () => void;
  onOpenKnowledge?: () => void;
  onOpenReview?: () => void;
  onOpenHandover?: () => void;
}) {
  return <ul className="my-work-rows" aria-label="Priority queue items">
    {items.map((item) => {
      const onOpen = item.type === "handover" ? onOpenHandover : item.type === "review" ? onOpenReview : onOpenKnowledge;
      return <li className="my-work-row" key={item.id}>
        <div className="my-work-row-copy">
          <strong>{item.title}</strong>
          <span>{item.metadata} · {item.detail}</span>
        </div>
        <span className={`island-chip has-dot ${toneClass[item.tone]}`}>{item.statusLabel}</span>
        <span className={item.assignee === "Unassigned" ? "my-work-unassigned" : "island-avatar is-small"} aria-label={`Assigned to ${item.assignee}`}>{item.assignee === "Unassigned" ? "Unassigned" : item.assignee}</span>
        <button type="button" className="secondary-button" onClick={onOpen} disabled={!onOpen} aria-label={`${actionLabel[item.type]}: ${item.title}`}>{actionLabel[item.type]}</button>
      </li>;
    })}
    {items.length === 0 && <li className="island-empty" role="status"><h3>No sample work matches your filters.</h3>{filtersActive && <button type="button" className="secondary-button" onClick={onClearFilters}>Clear filters</button>}</li>}
  </ul>;
}
