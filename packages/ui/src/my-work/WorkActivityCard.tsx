import { Icon } from "../shared/Icon";

export function WorkActivityCard({ recentItems, onOpenPrivateNotes, onOpenKnowledge, onOpenHandover }: {
  recentItems: readonly (readonly [string, string])[];
  onOpenPrivateNotes: () => void;
  onOpenKnowledge?: () => void;
  onOpenHandover?: () => void;
}) {
  return <aside className="my-work-activity" aria-label="Workspace activity">
    <section aria-labelledby="recently-published-title">
      <div className="my-work-activity-heading"><h2 id="recently-published-title">Recently published</h2><button type="button" onClick={onOpenKnowledge} disabled={!onOpenKnowledge}>View all <Icon name="arrow" size={14} /></button></div>
      {recentItems.map(([title, meta]) => <button type="button" className="my-work-activity-row" key={title} onClick={onOpenKnowledge} disabled={!onOpenKnowledge}><span className="my-work-icon-tile"><Icon name="document" size={21} /></span><span><strong>{title}</strong><span>{meta}</span></span></button>)}
    </section>
    <section aria-labelledby="handover-risk-title">
      <div className="my-work-activity-heading"><h2 id="handover-risk-title">Handover at risk</h2><button type="button" onClick={onOpenHandover} disabled={!onOpenHandover}>View all <Icon name="arrow" size={14} /></button></div>
      <button type="button" className="my-work-activity-row tone-red" onClick={onOpenHandover} disabled={!onOpenHandover}><span className="my-work-icon-tile"><Icon name="handover" size={21} /></span><span><strong>Operations ownership</strong><span>3 assets · Missing owner</span></span></button>
    </section>
    <section aria-labelledby="my-work-private-title">
      <div className="my-work-activity-heading"><h2 id="my-work-private-title">Personal workspace</h2><Icon name="lock" size={16} /></div>
      <button type="button" className="my-work-activity-row tone-green" onClick={onOpenPrivateNotes}><span className="my-work-icon-tile"><Icon name="lock" size={21} /></span><span><strong>Questions for architecture review</strong><span>Personal · Private</span></span></button>
    </section>
  </aside>;
}
