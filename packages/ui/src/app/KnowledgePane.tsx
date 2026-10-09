import { useEffect, useRef } from "react";
import { Icon } from "../shared/Icon";
import type { PaneContent } from "../shared/types";

export function KnowledgePane({ content, open, onToggle }: { content: PaneContent; open: boolean; onToggle: () => void }) {
  const paneRef = useRef<HTMLElement>(null);
  const wasOpen = useRef(open);
  useEffect(() => {
    if (open && !wasOpen.current) {
      paneRef.current?.focus();
      if (window.matchMedia("(max-width: 760px)").matches) paneRef.current?.scrollIntoView({ block: "start" });
    }
    wasOpen.current = open;
  }, [open]);

  return (
    <aside ref={paneRef} id="arden-context-panel" className={`knowledge-pane-redesign${open ? "" : " is-collapsed"}`} aria-label="Knowledge Pane" tabIndex={-1}>
      <header className="knowledge-pane-header">
        <strong>Knowledge Pane</strong>
        <button type="button" className="pane-control" aria-label={open ? "Collapse context pane" : "Expand context pane"} aria-expanded={open} onClick={() => {
          onToggle();
          if (open) document.querySelector<HTMLButtonElement>(".context-toggle")?.focus();
        }}><Icon name={open ? "close" : "knowledge"} size={18} /></button>
      </header>
      {open && <>
        <div className="knowledge-pane-body">
          <span className="meta-label">{content.eyebrow}</span>
          <h2>{content.title}</h2>
          <p>{content.description}</p>
          <section className="access-boundary" aria-labelledby="boundary-title">
            <span className="meta-label">ACCESS BOUNDARY</span>
            <strong id="boundary-title">{content.boundaryTitle}</strong>
            <p>{content.boundaryBody}</p>
          </section>
          <details className="pane-planned-features">
            <summary>Planned assistance</summary>
            <p>These actions will be available when Ask Arden is connected.</p>
            <ul>{content.suggestions.map((suggestion) => <li key={suggestion}>{suggestion}</li>)}</ul>
          </details>
        </div>
        <footer className="knowledge-pane-composer">
          <div><Icon name="lock" size={15} /> Ask Arden · Planned</div>
          <span>Answers will use only sources you can access.</span>
        </footer>
      </>}
    </aside>
  );
}
