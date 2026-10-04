import { Icon, type IconName } from "../shared/Icon";

export type QueueItem = {
  title: string;
  meta: string;
  description: string;
  icon?: IconName;
  tone?: "amber" | "blue";
  action?: "knowledge" | "handover";
};

type PriorityQueueProps = {
  items: QueueItem[];
  onClearSearch: () => void;
  searchActive?: boolean;
  onOpenKnowledge?: () => void;
  onOpenHandover?: () => void;
};

export function PriorityQueue({ items, onClearSearch, searchActive, onOpenKnowledge, onOpenHandover }: PriorityQueueProps) {
  return (
    <section className="my-work-queue" aria-labelledby="priority-title">
      <h2 id="priority-title">{searchActive ? "Search results in your queue" : "Next in your queue"}</h2>
      <div className="my-work-queue-list">
        {items.map((item) => {
          const onOpen = item.action === "handover" ? onOpenHandover : onOpenKnowledge;
          return (
            <button type="button" className="my-work-queue-row" key={item.title} onClick={onOpen} disabled={!onOpen}>
              <Icon name={item.icon ?? "document"} size={24} />
              <span className="my-work-queue-copy"><strong>{item.title}</strong><span>{item.description}</span></span>
              <span className={`my-work-queue-status tone-${item.tone ?? "amber"}`}>{item.meta}</span>
            </button>
          );
        })}
        {items.length === 0 && (
          <div className="empty-state">
            <strong>No other sample work matches this search.</strong>
            <button type="button" onClick={onClearSearch}>
              Clear search
            </button>
          </div>
        )}
      </div>
      <p className="planned-feature-note">Sample work · Review and handover previews do not change shared knowledge.</p>
    </section>
  );
}
