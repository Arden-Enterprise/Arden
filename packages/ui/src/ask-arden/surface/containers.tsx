import { Fragment, useId, useRef, useState, type KeyboardEvent } from "react";
import type {
  BoundCardNode,
  BoundRowNode,
  BoundSectionNode,
  BoundSplitNode,
  BoundStackNode,
  BoundTabsNode,
  SurfaceAction,
} from "@arden/domain";
import { Icon } from "../../shared/Icon";
import { ActionBar } from "./ActionBar";
import { isSurfaceActionNode, safeGetOwn } from "./formatters";
import type { SurfaceRenderContext } from "./types";

export function StackBlock({
  node,
  visited,
  ctx,
}: {
  node: BoundStackNode;
  visited: ReadonlySet<string>;
  ctx: SurfaceRenderContext;
}) {
  return (
    <div className="arden-surface-stack" data-gap={node.gap ?? "md"}>
      {node.childIds.map((childId) => (
        <Fragment key={childId}>{ctx.renderNode(childId, visited)}</Fragment>
      ))}
    </div>
  );
}

export function RowBlock({
  node,
  visited,
  ctx,
}: {
  node: BoundRowNode;
  visited: ReadonlySet<string>;
  ctx: SurfaceRenderContext;
}) {
  return (
    <div className="arden-surface-row" data-columns={node.columns ?? 2}>
      {node.childIds.map((childId) => (
        <div key={childId} className="arden-surface-row-cell">
          {ctx.renderNode(childId, visited)}
        </div>
      ))}
    </div>
  );
}

export function CardBlock({
  node,
  visited,
  ctx,
}: {
  node: BoundCardNode;
  visited: ReadonlySet<string>;
  ctx: SurfaceRenderContext;
}) {
  const headingId = useId();
  const footerActions: Array<{ id: string; action: SurfaceAction }> = [];

  if (node.footerIds && node.footerIds.length > 0) {
    for (const footerId of node.footerIds) {
      if (visited.has(footerId)) continue;
      const footerNode = safeGetOwn(ctx.surface.nodes, footerId);
      if (footerNode && isSurfaceActionNode(footerNode)) {
        footerActions.push({ id: footerId, action: footerNode });
      }
    }
  }

  return (
    <section
      className="arden-surface-card"
      data-tone={node.tone ?? "default"}
      aria-labelledby={node.title ? headingId : undefined}
    >
      {(node.title || node.subtitle) && (
        <header className="arden-surface-card-header">
          {node.title && (
            <h3 id={headingId} className="arden-surface-card-title">
              {node.title}
            </h3>
          )}
          {node.subtitle && <p className="arden-surface-card-subtitle">{node.subtitle}</p>}
        </header>
      )}
      <div className="arden-surface-card-body">
        {node.bodyIds.map((childId) => (
          <Fragment key={childId}>{ctx.renderNode(childId, visited)}</Fragment>
        ))}
      </div>
      {footerActions.length > 0 && (
        <footer className="arden-surface-card-footer">
          <ActionBar
            actions={footerActions}
            hydratedDocuments={ctx.hydratedDocuments}
            onAction={ctx.onAction}
            onPrefillPrompt={ctx.onPrefillPrompt}
          />
        </footer>
      )}
    </section>
  );
}

export function SectionBlock({
  node,
  visited,
  ctx,
}: {
  node: BoundSectionNode;
  visited: ReadonlySet<string>;
  ctx: SurfaceRenderContext;
}) {
  const [open, setOpen] = useState<boolean>(node.defaultOpen ?? true);
  const panelId = useId();

  return (
    <section className="arden-surface-section" data-open={open ? "true" : "false"}>
      <button
        type="button"
        className="arden-surface-section-trigger"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="arden-surface-section-chevron" aria-hidden="true">
          <Icon name="chevron" size={13} />
        </span>
        <span className="arden-surface-section-title">{node.title}</span>
      </button>
      <div id={panelId} className="arden-surface-section-panel" hidden={!open}>
        {open &&
          node.childIds.map((childId) => (
            <Fragment key={childId}>{ctx.renderNode(childId, visited)}</Fragment>
          ))}
      </div>
    </section>
  );
}

export function TabsBlock({
  node,
  visited,
  ctx,
}: {
  node: BoundTabsNode;
  visited: ReadonlySet<string>;
  ctx: SurfaceRenderContext;
}) {
  const baseId = useId();
  const [selectedId, setSelectedId] = useState<string>(() =>
    node.tabs.some((tab) => tab.id === node.defaultTabId)
      ? node.defaultTabId
      : (node.tabs[0]?.id ?? ""),
  );
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const activeTabId = node.tabs.some((tab) => tab.id === selectedId)
    ? selectedId
    : node.tabs.some((tab) => tab.id === node.defaultTabId)
      ? node.defaultTabId
      : (node.tabs[0]?.id ?? "");

  const selectByIndex = (nextIndex: number) => {
    const nextTab = node.tabs[nextIndex];
    if (!nextTab) return;
    setSelectedId(nextTab.id);
    tabRefs.current[nextIndex]?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const total = node.tabs.length;
    if (total === 0) return;
    if (event.key === "ArrowRight") {
      event.preventDefault();
      selectByIndex((index + 1) % total);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      selectByIndex((index - 1 + total) % total);
    } else if (event.key === "Home") {
      event.preventDefault();
      selectByIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      selectByIndex(total - 1);
    }
  };

  return (
    <div className="arden-surface-tabs">
      <div className="arden-surface-tabs-list" role="tablist" aria-orientation="horizontal">
        {node.tabs.map((tab, index) => {
          const isSelected = tab.id === activeTabId;
          return (
            <button
              key={tab.id}
              ref={(element) => {
                tabRefs.current[index] = element;
              }}
              id={`${baseId}-tab-${tab.id}`}
              type="button"
              role="tab"
              className="arden-surface-tab"
              aria-selected={isSelected}
              aria-controls={`${baseId}-panel-${tab.id}`}
              tabIndex={isSelected ? 0 : -1}
              onClick={() => setSelectedId(tab.id)}
              onKeyDown={(event) => handleKeyDown(event, index)}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      {node.tabs.map((tab) => {
        const isSelected = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            id={`${baseId}-panel-${tab.id}`}
            role="tabpanel"
            className="arden-surface-tab-panel"
            aria-labelledby={`${baseId}-tab-${tab.id}`}
            tabIndex={0}
            hidden={!isSelected}
          >
            {isSelected &&
              tab.childIds.map((childId) => (
                <Fragment key={childId}>{ctx.renderNode(childId, visited)}</Fragment>
              ))}
          </div>
        );
      })}
    </div>
  );
}

export function SplitBlock({
  node,
  visited,
  ctx,
}: {
  node: BoundSplitNode;
  visited: ReadonlySet<string>;
  ctx: SurfaceRenderContext;
}) {
  return (
    <div className="arden-surface-split">
      <div className="arden-surface-split-pane">
        {node.leftTitle && <h4 className="arden-surface-split-title">{node.leftTitle}</h4>}
        <div className="arden-surface-split-body">{ctx.renderNode(node.leftId, visited)}</div>
      </div>
      <div className="arden-surface-split-pane">
        {node.rightTitle && <h4 className="arden-surface-split-title">{node.rightTitle}</h4>}
        <div className="arden-surface-split-body">{ctx.renderNode(node.rightId, visited)}</div>
      </div>
    </div>
  );
}
