import { useEffect, useMemo, useRef, useState } from "react";

type ArdenShellProps = { platform: "web" | "desktop" };
type Scope = "all" | "shared" | "personal" | "external";
type NodeKind = Exclude<Scope, "all">;
type IconName =
  | "graph"
  | "work"
  | "intake"
  | "review"
  | "settings"
  | "search"
  | "chevron"
  | "close"
  | "plus"
  | "minus"
  | "fit"
  | "lock"
  | "spark"
  | "info";

type KnowledgeNode = {
  id: string;
  title: string;
  type: string;
  kind: NodeKind;
  status: string;
  source: string;
  updated: string;
  summary: string;
  x: number;
  y: number;
  size: number;
};

const nodes: KnowledgeNode[] = [
  {
    id: "release",
    title: "Release readiness",
    type: "Work brief",
    kind: "shared",
    status: "Shared draft",
    source: "Arden sample",
    updated: "Today",
    summary:
      "A working view of the decisions, checks, and open questions around the next release.",
    x: 502,
    y: 310,
    size: 19,
  },
  {
    id: "decision",
    title: "Retry strategy",
    type: "Decision",
    kind: "shared",
    status: "Published",
    source: "Arden sample",
    updated: "2 days ago",
    summary:
      "Documents when to retry requests and when to return control to the caller.",
    x: 305,
    y: 165,
    size: 13,
  },
  {
    id: "checklist",
    title: "Launch checklist",
    type: "Page",
    kind: "shared",
    status: "Published",
    source: "Arden sample",
    updated: "Yesterday",
    summary: "The reviewed sequence of checks for a release handoff.",
    x: 726,
    y: 156,
    size: 15,
  },
  {
    id: "incident",
    title: "Latency incident",
    type: "Incident note",
    kind: "shared",
    status: "Shared draft",
    source: "Arden sample",
    updated: "4 days ago",
    summary:
      "A draft incident review about elevated checkout latency and the response that followed.",
    x: 244,
    y: 383,
    size: 12,
  },
  {
    id: "runbook",
    title: "On-call handover",
    type: "Runbook",
    kind: "shared",
    status: "Published",
    source: "Arden sample",
    updated: "1 week ago",
    summary:
      "Operational steps and escalation contacts for the on-call handover.",
    x: 317,
    y: 552,
    size: 13,
  },
  {
    id: "issue",
    title: "Checkout issue",
    type: "Jira issue",
    kind: "external",
    status: "External source",
    source: "Jira · example",
    updated: "3 hours ago",
    summary:
      "A linked example issue tracking the remaining checkout verification work.",
    x: 795,
    y: 337,
    size: 11,
  },
  {
    id: "pr",
    title: "Payment API PR",
    type: "Pull request",
    kind: "external",
    status: "External source",
    source: "GitHub · example",
    updated: "Yesterday",
    summary:
      "An example code change connected to the release brief and retry decision.",
    x: 693,
    y: 501,
    size: 11,
  },
  {
    id: "note",
    title: "Questions to verify",
    type: "Private note",
    kind: "personal",
    status: "Only you",
    source: "Personal · sample",
    updated: "Today",
    summary:
      "A private list of details to confirm before the release review. This sample note is visible only in this preview.",
    x: 483,
    y: 552,
    size: 10,
  },
];

const edges: { from: string; to: string; label: string }[] = [
  { from: "release", to: "decision", label: "references" },
  { from: "release", to: "checklist", label: "references" },
  { from: "release", to: "incident", label: "informed by" },
  { from: "release", to: "issue", label: "tracks" },
  { from: "release", to: "pr", label: "related change" },
  { from: "release", to: "note", label: "personal context" },
  { from: "decision", to: "pr", label: "implemented by" },
  { from: "incident", to: "runbook", label: "updated" },
  { from: "checklist", to: "issue", label: "tracks" },
  { from: "issue", to: "pr", label: "related change" },
];

const navigation: { label: string; icon: IconName; available: boolean }[] = [
  { label: "Graph", icon: "graph", available: true },
  { label: "My work", icon: "work", available: false },
  { label: "Intake", icon: "intake", available: false },
  { label: "Reviews", icon: "review", available: false },
];

const iconPaths: Record<IconName, React.ReactNode> = {
  graph: (
    <>
      <circle cx="5" cy="12" r="2" />
      <circle cx="12" cy="5" r="2" />
      <circle cx="19" cy="12" r="2" />
      <circle cx="12" cy="19" r="2" />
      <path d="m6.5 10.5 4-4m3 0 4 4m0 3-4 4m-3 0-4-4" />
    </>
  ),
  work: (
    <>
      <rect x="3" y="6" width="18" height="14" rx="2" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 11h18" />
    </>
  ),
  intake: (
    <>
      <path d="M4 4h16v12H4zM4 12h5l2 3h2l2-3h5M4 19h16" />
    </>
  ),
  review: (
    <>
      <path d="M5 3h11l3 3v15H5zM16 3v4h3M8 12h8M8 16h5" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4m0-14.2-1.4 1.4M6.3 17.7l-1.4 1.4" />
    </>
  ),
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m16 16 5 5" />
    </>
  ),
  chevron: <path d="m9 6 6 6-6 6" />,
  close: <path d="M5 5 19 19M19 5 5 19" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  fit: (
    <>
      <path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10" width="14" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </>
  ),
  spark: (
    <path d="m12 2 1.7 6.3L20 10l-6.3 1.7L12 18l-1.7-6.3L4 10l6.3-1.7L12 2Zm7 14 .7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7L19 16Z" />
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5m0-8h.01" />
    </>
  ),
};

function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {iconPaths[name]}
    </svg>
  );
}

function GraphMark({
  kind,
  selected = false,
}: {
  kind: NodeKind;
  selected?: boolean;
}) {
  return (
    <span
      className={`kind-mark kind-mark--${kind}${selected ? " kind-mark--selected" : ""}`}
      aria-hidden="true"
    />
  );
}

export function ArdenShell({ platform }: ArdenShellProps) {
  const [selectedId, setSelectedId] = useState("release");
  const [scope, setScope] = useState<Scope>("all");
  const [query, setQuery] = useState("");
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [compactGraph, setCompactGraph] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(max-width: 760px)").matches,
  );
  const [mobileOverview, setMobileOverview] = useState(false);
  const [paneOpen, setPaneOpen] = useState(true);
  const drag = useRef<{
    x: number;
    y: number;
    panX: number;
    panY: number;
  } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 760px)");
    const update = () => setCompactGraph(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setSelectedId("release");
      setScope("all");
      setQuery("");
      setZoom(1);
      setPan({ x: 0, y: 0 });
      setMobileOverview(false);
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, []);
  const selected = nodes.find((node) => node.id === selectedId) ?? nodes[0];
  const visible = useMemo(
    () => nodes.filter((node) => scope === "all" || node.kind === scope),
    [scope],
  );
  const visibleIds = useMemo(
    () => new Set(visible.map((node) => node.id)),
    [visible],
  );
  const matchingIds = useMemo(
    () =>
      new Set(
        visible
          .filter((node) =>
            `${node.title} ${node.type} ${node.summary}`
              .toLowerCase()
              .includes(query.trim().toLowerCase()),
          )
          .map((node) => node.id),
      ),
    [visible, query],
  );
  const related = edges
    .filter((edge) => edge.from === selected.id || edge.to === selected.id)
    .map((edge) => ({
      ...edge,
      node: nodes.find(
        (node) => node.id === (edge.from === selected.id ? edge.to : edge.from),
      )!,
    }));
  const focusGraph = compactGraph && !mobileOverview;
  const viewWidth = (focusGraph ? 660 : 1000) / zoom;
  const viewHeight = 660 / zoom;
  const centerX = focusGraph ? selected.x : 500;
  const centerY = focusGraph ? selected.y : 330;
  const viewBox = `${centerX - viewWidth / 2 + pan.x} ${centerY - viewHeight / 2 + pan.y} ${viewWidth} ${viewHeight}`;
  const changeScope = (next: Scope) => {
    setScope(next);
    if (next !== "all" && selected.kind !== next) {
      const first = nodes.find((node) => node.kind === next);
      if (first) {
        setSelectedId(first.id);
        setPan({ x: 0, y: 0 });
        setMobileOverview(false);
      }
    }
  };
  const changeZoom = (direction: number) => {
    setMobileOverview(false);
    setZoom((value) =>
      Math.max(0.7, Math.min(1.65, Number((value + direction).toFixed(2)))),
    );
  };
  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setMobileOverview(false);
  };
  const fitGraph = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setMobileOverview(compactGraph);
  };
  const onPointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if ((event.target as Element).closest(".graph-node")) return;
    drag.current = {
      x: event.clientX,
      y: event.clientY,
      panX: pan.x,
      panY: pan.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!drag.current || !svgRef.current) return;
    const bounds = svgRef.current.getBoundingClientRect();
    setPan({
      x:
        drag.current.panX -
        ((event.clientX - drag.current.x) * viewWidth) / bounds.width,
      y:
        drag.current.panY -
        ((event.clientY - drag.current.y) * viewHeight) / bounds.height,
    });
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  return (
    <div className="arden-app">
      <aside className="arden-sidebar" aria-label="Main navigation">
        <div className="brand-row">
          <span className="brand-wordmark">ARDEN</span>
          <span className="brand-edition">PREVIEW</span>
        </div>
        <div className="workspace-switch" aria-label="Current workspace">
          <div className="workspace-avatar">E</div>
          <div className="workspace-text">
            <strong>Example workspace</strong>
            <span>Sample data</span>
          </div>
          <Icon name="chevron" size={15} />
        </div>
        <div className="side-section-label">WORKSPACE</div>
        <nav className="side-nav" aria-label="Workspace">
          {navigation.map((item) => (
            <button
              key={item.label}
              type="button"
              className={`nav-item${item.available ? " is-active" : ""}`}
              disabled={!item.available}
              title={
                item.available
                  ? undefined
                  : `${item.label} is planned for a later build`
              }
              aria-current={item.available ? "page" : undefined}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
              {!item.available && <span className="nav-soon">Soon</span>}
            </button>
          ))}
        </nav>
        <div className="side-section-label side-section-label--admin">
          MANAGE
        </div>
        <button
          className="nav-item"
          type="button"
          disabled
          title="Administration is planned for a later build"
        >
          <Icon name="settings" />
          <span>Administration</span>
          <span className="nav-soon">Soon</span>
        </button>
        <div className="sidebar-bottom">
          <div className="privacy-note">
            <Icon name="lock" size={17} />
            <div>
              <strong>Private by design</strong>
              <span>Customer-controlled Core</span>
            </div>
          </div>
          <div className="sidebar-footer">
            Interface preview <span>·</span>{" "}
            {platform === "desktop" ? "Windows desktop" : "Web"}
          </div>
        </div>
      </aside>
      <main className="arden-main">
        <header className="topbar">
          <div className="breadcrumbs">
            <span>Workspace</span>
            <Icon name="chevron" size={14} />
            <strong>Graph</strong>
          </div>
          <div className="topbar-right">
            <span className="preview-dot" />
            <span>Sample workspace</span>
          </div>
        </header>
        <section className="graph-page" aria-labelledby="graph-title">
          <div className="page-heading">
            <div>
              <h1 id="graph-title">Knowledge graph</h1>
              <p>Explore how work, decisions, and sources connect.</p>
            </div>
            <span className="sample-badge">
              <span className="sample-badge-dot" /> SAMPLE DATA
            </span>
          </div>
          <div className="graph-toolbar">
            <label className="search-field">
              <Icon name="search" size={18} />
              <input
                value={query}
                onChange={(event) => {
                  const next = event.target.value;
                  setQuery(next);
                  const first = visible.find((node) =>
                    `${node.title} ${node.type} ${node.summary}`
                      .toLowerCase()
                      .includes(next.trim().toLowerCase()),
                  );
                  if (next.trim() && first) {
                    setSelectedId(first.id);
                    setPan({ x: 0, y: 0 });
                    setMobileOverview(false);
                  }
                }}
                placeholder="Search this graph"
                aria-label="Search sample graph"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  aria-label="Clear search"
                >
                  <Icon name="close" size={15} />
                </button>
              )}
            </label>
            <div
              className="scope-switch"
              role="group"
              aria-label="Filter graph by visibility"
            >
              {(["all", "shared", "personal", "external"] as Scope[]).map(
                (option) => (
                  <button
                    key={option}
                    type="button"
                    className={scope === option ? "is-selected" : ""}
                    onClick={() => changeScope(option)}
                    aria-pressed={scope === option}
                  >
                    {option === "all"
                      ? "All"
                      : option[0].toUpperCase() + option.slice(1)}
                  </button>
                ),
              )}
            </div>
          </div>
          <div className="graph-surface">
            <div className="graph-corner-label">
              <strong>
                {query
                  ? `${matchingIds.size} matching`
                  : `${visible.length} items`}
              </strong>
              <span>Illustrative network</span>
            </div>
            <svg
              ref={svgRef}
              className="graph-svg"
              viewBox={viewBox}
              role="group"
              aria-label="Interactive sample knowledge graph"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onWheel={(event) => {
                event.preventDefault();
                changeZoom(event.deltaY > 0 ? -0.08 : 0.08);
              }}
            >
              <g className="graph-edges">
                {edges
                  .filter(
                    (edge) =>
                      visibleIds.has(edge.from) && visibleIds.has(edge.to),
                  )
                  .map((edge) => {
                    const from = nodes.find((node) => node.id === edge.from)!;
                    const to = nodes.find((node) => node.id === edge.to)!;
                    const focused =
                      edge.from === selected.id || edge.to === selected.id;
                    const faded =
                      query.trim() &&
                      !(matchingIds.has(edge.from) && matchingIds.has(edge.to));
                    return (
                      <line
                        key={`${edge.from}-${edge.to}`}
                        x1={from.x}
                        y1={from.y}
                        x2={to.x}
                        y2={to.y}
                        className={`${focused ? "is-focused" : ""}${faded ? " is-faded" : ""}`}
                      />
                    );
                  })}
              </g>
              {visible.map((node) => {
                const active = node.id === selected.id;
                const connected = edges.some(
                  (edge) =>
                    (edge.from === selected.id && edge.to === node.id) ||
                    (edge.to === selected.id && edge.from === node.id),
                );
                const muted = Boolean(
                  (query.trim() && !matchingIds.has(node.id)) ||
                    (selectedId && !active && !connected),
                );
                const labelRight = compactGraph && node.x > 680;
                const labelLeft = compactGraph && node.x < 270;
                const labelAnchor = labelRight
                  ? "end"
                  : labelLeft
                    ? "start"
                    : "middle";
                const labelX = labelRight ? 30 : labelLeft ? -30 : 0;
                return (
                  <g
                    key={node.id}
                    className={`graph-node graph-node--${node.kind}${active ? " is-active" : ""}${muted ? " is-muted" : ""}`}
                    transform={`translate(${node.x} ${node.y})`}
                    role="button"
                    tabIndex={0}
                    aria-label={`${node.title}, ${node.type}, ${node.status}`}
                    aria-pressed={active}
                    onClick={() => {
                      setSelectedId(node.id);
                      setPan({ x: 0, y: 0 });
                      setMobileOverview(false);
                      setPaneOpen(true);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedId(node.id);
                        setPan({ x: 0, y: 0 });
                        setMobileOverview(false);
                        setPaneOpen(true);
                      }
                    }}
                  >
                    <circle className="node-hit" r="38" />
                    <circle className="node-halo" r={node.size + 11} />
                    {node.kind === "external" ? (
                      <rect
                        className="node-core"
                        x={-node.size}
                        y={-node.size}
                        width={node.size * 2}
                        height={node.size * 2}
                        rx="3"
                      />
                    ) : (
                      <circle className="node-core" r={node.size} />
                    )}
                    <text
                      className="node-title"
                      textAnchor={labelAnchor}
                      x={labelX}
                      y={node.size + 28}
                    >
                      {node.title}
                    </text>
                    <text
                      className="node-type"
                      textAnchor={labelAnchor}
                      x={labelX}
                      y={node.size + 43}
                    >
                      {node.type}
                    </text>
                  </g>
                );
              })}
            </svg>
            <div className="graph-controls" aria-label="Graph view controls">
              <button
                type="button"
                onClick={() => changeZoom(0.15)}
                aria-label="Zoom in"
                title="Zoom in"
              >
                <Icon name="plus" size={17} />
              </button>
              <button
                type="button"
                onClick={() => changeZoom(-0.15)}
                aria-label="Zoom out"
                title="Zoom out"
              >
                <Icon name="minus" size={17} />
              </button>
              <button
                type="button"
                onClick={fitGraph}
                aria-label="Fit graph"
                title="Fit graph"
              >
                <Icon name="fit" size={16} />
              </button>
            </div>
            <div className="graph-hint">
              {compactGraph ? (
                "Drag to explore"
              ) : (
                <>
                  Drag to pan <span>·</span> Scroll to zoom <span>·</span> Esc
                  to reset
                </>
              )}
            </div>
          </div>
          <div className="mobile-selection" aria-live="polite">
            <GraphMark kind={selected.kind} selected />
            <div>
              <strong>{selected.title}</strong>
              <span>
                {selected.status} · {selected.source}
              </span>
            </div>
            <span className="mobile-selection-label">SELECTED</span>
          </div>
          <div className="mobile-node-list" aria-label="Sample graph items">
            {visible
              .filter((node) => !query.trim() || matchingIds.has(node.id))
              .map((node) => (
                <button
                  type="button"
                  key={node.id}
                  className={selected.id === node.id ? "is-current" : ""}
                  onClick={() => {
                    setSelectedId(node.id);
                    setPan({ x: 0, y: 0 });
                    setMobileOverview(false);
                    setPaneOpen(true);
                  }}
                >
                  <GraphMark kind={node.kind} />
                  <span>
                    <strong>{node.title}</strong>
                    <small>{node.type}</small>
                  </span>
                  <Icon name="chevron" size={15} />
                </button>
              ))}
            {query.trim() && matchingIds.size === 0 && (
              <p>No sample items match this search.</p>
            )}
          </div>
          <div className="graph-footer">
            <div className="legend">
              <span>
                <GraphMark kind="shared" /> Shared
              </span>
              <span>
                <GraphMark kind="personal" /> Personal
              </span>
              <span>
                <GraphMark kind="external" /> External source
              </span>
            </div>
            <button
              type="button"
              className="graph-info"
              onClick={() => {
                setScope("all");
                setQuery("");
                resetView();
                setSelectedId("release");
                setMobileOverview(false);
              }}
            >
              <Icon name="info" size={16} /> Reset sample view
            </button>
          </div>
        </section>
      </main>
      <aside
        className={`knowledge-pane${paneOpen ? "" : " is-collapsed"}`}
        aria-label="Knowledge pane"
      >
        <div className="pane-header">
          <strong>Knowledge pane</strong>
          <button
            type="button"
            aria-label={
              paneOpen ? "Collapse knowledge pane" : "Expand knowledge pane"
            }
            onClick={() => setPaneOpen((open) => !open)}
          >
            <Icon name={paneOpen ? "close" : "chevron"} size={17} />
          </button>
        </div>
        {paneOpen && (
          <div className="pane-content">
            <div className="pane-identity">
              <div className="pane-kind">
                <GraphMark kind={selected.kind} selected />
                {selected.type}
              </div>
              <h2>{selected.title}</h2>
              <p>{selected.summary}</p>
            </div>
            <div className="pane-section">
              <h3>Context</h3>
              <dl className="detail-list">
                <div>
                  <dt>Status</dt>
                  <dd>{selected.status}</dd>
                </div>
                <div>
                  <dt>Visibility</dt>
                  <dd>
                    {selected.kind === "personal"
                      ? "Only you"
                      : selected.kind === "external"
                        ? "Source-scoped"
                        : "Shared"}
                  </dd>
                </div>
                <div>
                  <dt>Source</dt>
                  <dd>{selected.source}</dd>
                </div>
                <div>
                  <dt>Updated</dt>
                  <dd>{selected.updated}</dd>
                </div>
              </dl>
            </div>
            <div className="pane-section">
              <div className="pane-section-heading">
                <h3>Connections</h3>
                <span>{related.length}</span>
              </div>
              <div className="relation-list">
                {related.map((relation) => (
                  <button
                    type="button"
                    key={`${relation.from}-${relation.to}`}
                    onClick={() => {
                      setSelectedId(relation.node.id);
                      setPan({ x: 0, y: 0 });
                      setMobileOverview(false);
                      if (scope !== "all" && relation.node.kind !== scope)
                        setScope("all");
                    }}
                  >
                    <GraphMark kind={relation.node.kind} />
                    <span className="relation-text">
                      <strong>{relation.node.title}</strong>
                      <small>{relation.label}</small>
                    </span>
                    <Icon name="chevron" size={15} />
                  </button>
                ))}
              </div>
            </div>
            <div className="pane-bottom">
              <div className="agent-icon">
                <Icon name="spark" size={17} />
              </div>
              <div>
                <strong>Ask Arden</strong>
                <p>Available when private AI is connected.</p>
              </div>
              <span className="planned-label">PLANNED</span>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}
