import type { HomeSource, HomeSourceState } from "./useHomePublications";

export type HomeTab = HomeSource | "drafts" | "reports";
export function KnowledgeHomeNavigation({ tab, onTab, views, draftCount, onPrivateNotes, canUsePrivateWorkspace }: {
  tab: HomeTab; onTab: (tab: HomeTab) => void; views: Record<HomeSource, HomeSourceState>; draftCount: number;
  onPrivateNotes?: () => void; canUsePrivateWorkspace: boolean;
}) {
  const count = (source: HomeSource) => views[source].status === "ready" ? <span className="island-badge">{views[source].items.length}</span> : null;
  return <div className="km-home-navigation">
    <div className="island-seg knowledge-library-tabs" role="tablist" aria-label="Home knowledge" onKeyDown={event => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button[role="tab"]:not(:disabled)')];
      const index = buttons.indexOf(event.target as HTMLButtonElement);
      if (index < 0) return;
      event.preventDefault();
      const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
        : (index + (event.key === "ArrowLeft" ? -1 : 1) + buttons.length) % buttons.length;
      buttons[next]?.focus(); buttons[next]?.click();
    }}>
      <button id="home-tab-organization" type="button" role="tab" tabIndex={tab === "organization" ? 0 : -1} aria-selected={tab === "organization"} onClick={() => onTab("organization")}>Organization{count("organization")}</button>
      <button id="home-tab-shared" type="button" role="tab" tabIndex={tab === "shared" ? 0 : -1} aria-selected={tab === "shared"} onClick={() => onTab("shared")}>Shared with me{count("shared")}</button>
      {(views.other.status !== "ready" || views.other.items.length > 0 || tab === "other") && <button id="home-tab-other" type="button" role="tab" tabIndex={tab === "other" ? 0 : -1} aria-selected={tab === "other"} onClick={() => onTab("other")}>Other documents{count("other")}</button>}
      <button id="home-tab-drafts" type="button" role="tab" tabIndex={tab === "drafts" ? 0 : -1} aria-selected={tab === "drafts"} onClick={() => onTab("drafts")}>My Contributions<span className="island-badge">{draftCount}</span></button>
      <button id="home-tab-reports" type="button" role="tab" tabIndex={tab === "reports" ? 0 : -1} aria-selected={tab === "reports"} onClick={() => onTab("reports")}>My reports</button>
    </div>
    <div className="km-private-entry"><button type="button" className="secondary-button" disabled={!canUsePrivateWorkspace || !onPrivateNotes} onClick={onPrivateNotes}>Private notes</button>
      <span className="island-meta">{canUsePrivateWorkspace ? "Only you" : "Unavailable in this workspace"}</span></div>
  </div>;
}
