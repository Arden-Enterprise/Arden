type WorkActivityCardProps = {
  recentItems: readonly (readonly [string, string])[];
  onOpenPrivateNotes: () => void;
};

export function WorkActivityCard({ recentItems, onOpenPrivateNotes }: WorkActivityCardProps) {
  return (
    <aside className="workspace-card activity-card">
      <span className="meta-label">RECENTLY PUBLISHED</span>
      <div className="recent-list">
        {recentItems.map(([title, meta]) => (
          <div key={title}>
            <strong>{title}</strong>
            <span>{meta}</span>
          </div>
        ))}
      </div>

      <div className="card-divider" />
      <span className="meta-label">HANDOVER AT RISK</span>
      <h2>Knowledge Handover</h2>
      <p>3 assets have no receiving owner. Final review closes in 2 days.</p>
      <button type="button" className="secondary-button" disabled>
        Handover API not connected
      </button>

      <div className="card-divider" />
      <span className="meta-label">PERSONAL · PRIVATE</span>
      <strong>Questions for architecture review</strong>
      <span className="private-note-copy">Not used in shared answers</span>
      <button type="button" className="text-button" onClick={onOpenPrivateNotes}>
        Open Personal Workspace
      </button>
    </aside>
  );
}
