import { useEffect, useRef, useState } from "react";
import { entryAssets } from "./entryAssets";

export function KnowledgeConnections() {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setScale(Math.min(entry.contentRect.width / 640, 1));
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="knowledge-connections-viewport" ref={viewportRef} aria-hidden="true">
      <div className="knowledge-connections" style={{ transform: `scale(${scale})` }}>
        <img className="knowledge-connections-lines" src={entryAssets.connections} alt="" width={640} height={250} />
        <span className="connection-node connection-runbook" />
        <span className="connection-label connection-runbook-label">Runbook</span>
        <img className="connection-node connection-decision" src={entryAssets.decision} alt="" width={18} height={18} />
        <span className="connection-label connection-decision-label">Decision</span>
        <img className="connection-node connection-incident" src={entryAssets.incident} alt="" width={12} height={12} />
        <span className="connection-label connection-incident-label">Incident</span>
        <span className="connection-node connection-guide" />
        <span className="connection-label connection-guide-label">Guide</span>
        <img className="connection-node connection-draft" src={entryAssets.draft} alt="" width={12} height={12} />
        <span className="connection-label connection-draft-label">Draft</span>
      </div>
    </div>
  );
}
