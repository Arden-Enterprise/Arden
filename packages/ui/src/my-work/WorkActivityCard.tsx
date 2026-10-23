import { Icon } from "../shared/Icon";

export function WorkActivityCard({ recentItems, onOpenPrivateNotes, onOpenKnowledge, onOpenHandover }: {
  recentItems: readonly (readonly [string, string])[];
  onOpenPrivateNotes: () => void;
  onOpenKnowledge?: () => void;
  onOpenHandover?: () => void;
}) {
  return <aside className="my-work-side" aria-label="Workspace activity">
    <section className="island my-work-card" aria-labelledby="recently-published-title">
      <div className="my-work-card-heading"><h2 id="recently-published-title">Recently published</h2>
        <button type="button" className="island-link-button" onClick={onOpenKnowledge} disabled={!onOpenKnowledge}>Library</button></div>
      <ul className="my-work-rows">{recentItems.map(([title, meta]) => <li key={title} className="my-work-row is-compact">
        <button type="button" className="my-work-row-link" onClick={onOpenKnowledge} disabled={!onOpenKnowledge}><strong>{title}</strong><span>{meta}</span></button></li>)}</ul>
    </section>
    <section className="island my-work-card" aria-labelledby="handover-risk-title">
      <div className="my-work-card-heading"><h2 id="handover-risk-title">Handover at risk</h2>
        <button type="button" className="island-link-button" onClick={onOpenHandover} disabled={!onOpenHandover}>Handover</button></div>
      <ul className="my-work-rows"><li className="my-work-row is-compact">
        <button type="button" className="my-work-row-link" onClick={onOpenHandover} disabled={!onOpenHandover}><strong>Operations ownership</strong><span>3 assets · Missing owner</span></button>
        <span className="island-chip has-dot tone-danger">At risk</span></li></ul>
    </section>
    <section className="my-work-private" aria-labelledby="my-work-private-title">
      <div className="my-work-card-heading"><span className="island-tile" aria-hidden="true"><Icon name="lock" size={15} /></span><h2 id="my-work-private-title">Private Notes</h2></div>
      <p>Only you can open these. They stay out of shared search and AI answers.</p>
      <button type="button" className="secondary-button" onClick={onOpenPrivateNotes}>Open Private Notes</button>
    </section>
  </aside>;
}
