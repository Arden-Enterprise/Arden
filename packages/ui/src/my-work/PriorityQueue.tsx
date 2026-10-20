import { Icon } from "../shared/Icon";
import type { WorkQueueItem } from "./workQueueModel";

export function PriorityQueue({ items, filtersActive, onClearFilters, onOpenKnowledge, onOpenReview, onOpenHandover }: {
  items: readonly WorkQueueItem[];
  filtersActive: boolean;
  onClearFilters: () => void;
  onOpenKnowledge?: () => void;
  onOpenReview?: () => void;
  onOpenHandover?: () => void;
}) {
  return <section className="my-work-queue" aria-labelledby="priority-title">
    <div className="my-work-queue-list">
      {items.map((item) => {
        const onOpen = item.type === "handover" ? onOpenHandover : item.type === "review" ? onOpenReview : onOpenKnowledge;
        return <button type="button" className={`my-work-task tone-${item.tone}`} key={item.id} onClick={onOpen} disabled={!onOpen}>
          <span className="my-work-icon-tile"><Icon name={item.type === "handover" ? "handover" : item.type === "review" ? "review" : "document"} size={25} /></span>
          <span className="my-work-task-copy"><strong>{item.title}</strong><span className="my-work-task-badges"><span className="my-work-status"><span aria-hidden="true" className="my-work-status-dot" />{item.statusLabel}</span><span className="my-work-detail">{item.detail}</span></span><span className="my-work-task-metadata">{item.metadata}</span></span>
          <span className={item.assignee === "Unassigned" ? "my-work-unassigned" : "my-work-avatar"} aria-label={`Assigned to ${item.assignee}`}>{item.assignee}</span><Icon name="chevron" size={18} />
        </button>;
      })}
      {items.length === 0 && <div className="empty-state" role="status"><strong>No sample work matches your filters.</strong>{filtersActive && <button type="button" onClick={onClearFilters}>Clear filters</button>}</div>}
    </div>
  </section>;
}
