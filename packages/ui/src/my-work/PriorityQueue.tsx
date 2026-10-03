export type QueueItem = {
  title: string;
  meta: string;
  description: string;
};

type PriorityQueueProps = {
  items: QueueItem[];
  onClearSearch: () => void;
};

export function PriorityQueue({ items, onClearSearch }: PriorityQueueProps) {
  return (
    <section className="workspace-card priority-card" aria-labelledby="priority-title">
      <div className="card-heading">
        <h2 id="priority-title">Priority queue</h2>
        <span>SORTED BY RISK, DUE DATE AND GOVERNANCE STATE</span>
      </div>
      <div className="work-list">
        {items.map((item) => (
          <article className="work-row" key={item.title}>
            <strong>{item.title}</strong>
            <span>{item.meta}</span>
            <p>{item.description}</p>
          </article>
        ))}
        {items.length === 0 && (
          <div className="empty-state">
            <strong>No sample work matches this search.</strong>
            <button type="button" onClick={onClearSearch}>
              Clear search
            </button>
          </div>
        )}
      </div>
      <button type="button" className="primary-button" disabled>
        Review API not connected
      </button>
    </section>
  );
}
