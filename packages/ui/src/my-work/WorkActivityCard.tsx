import { Icon } from "../shared/Icon";

type WorkActivityCardProps = {
  recentItems: readonly (readonly [string, string])[];
  onOpenPrivateNotes: () => void;
  onOpenKnowledge?: () => void;
};

export function WorkActivityCard({ recentItems, onOpenPrivateNotes, onOpenKnowledge }: WorkActivityCardProps) {
  return (
    <aside className="my-work-published" aria-labelledby="recently-published-title">
      <h2 id="recently-published-title">Recently published</h2>
      <div className="my-work-published-list">
        {recentItems.map(([title, meta]) => (
          <button type="button" className="my-work-published-row" key={title} onClick={onOpenKnowledge} disabled={!onOpenKnowledge}>
            <Icon name="check" size={18} />
            <span><strong>{title}</strong><span>{meta}</span></span>
          </button>
        ))}
      </div>
      <div className="my-work-private-shortcut">
        <span className="meta-label"><Icon name="lock" size={14} /> PERSONAL · PRIVATE</span>
        <strong>Questions for architecture review</strong>
        <span className="private-note-copy">Your rough thoughts stay private.</span>
        <button type="button" className="text-button" onClick={onOpenPrivateNotes}>Open Personal Workspace</button>
      </div>
    </aside>
  );
}
