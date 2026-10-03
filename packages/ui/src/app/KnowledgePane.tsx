import { Icon } from "../shared/Icon";
import type { PaneContent } from "../shared/types";

export function KnowledgePane({ content }: { content: PaneContent }) {
  return (
    <aside className="knowledge-pane-redesign" aria-label="Knowledge Pane">
      <header className="knowledge-pane-header">
        <strong>Knowledge Pane</strong>
        <span>PREVIEW</span>
      </header>

      <div className="knowledge-pane-body">
        <span className="meta-label">{content.eyebrow}</span>
        <h2>{content.title}</h2>
        <p>{content.description}</p>

        <div className="pane-divider" />
        <span className="meta-label">SUGGESTED</span>
        <div className="pane-suggestions" aria-label="Suggested actions">
          {content.suggestions.map((suggestion) => (
            <button type="button" key={suggestion} disabled>
              {suggestion}
              <span>Planned</span>
            </button>
          ))}
        </div>

        <section className="access-boundary" aria-labelledby="boundary-title">
          <span className="meta-label">ACCESS BOUNDARY</span>
          <strong id="boundary-title">{content.boundaryTitle}</strong>
          <p>{content.boundaryBody}</p>
        </section>
      </div>

      <footer className="knowledge-pane-composer">
        <div aria-disabled="true">
          <Icon name="lock" size={15} />
          Ask Arden is not connected
        </div>
        <span>Answers will use only sources the signed-in user can access.</span>
      </footer>
    </aside>
  );
}
