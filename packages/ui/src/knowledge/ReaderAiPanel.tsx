import type { KeyboardEvent, ReactNode } from "react";
import { Icon } from "../shared/Icon";

/** The shipped Arden mark (the same asset as the workspace top bar) identifies Arden AI work. */
export const ardenAiMark = new URL("../assets/arden-logo-white.png", import.meta.url).href;

export type ReaderAiTask = "summary" | "question";

const tasks: { task: ReaderAiTask; label: string }[] = [
  { task: "summary", label: "Summary" },
  { task: "question", label: "Ask" },
];

export function readerAiTabId(id: string, task: ReaderAiTask) { return `${id}-tab-${task}`; }
export function readerAiPanelId(id: string, task: ReaderAiTask) { return `${id}-panel-${task}`; }

/**
 * Side island for on-request AI work on the open document version. Summary and Ask keep their own
 * lifecycle in the reader; this component only provides the shared frame, task choice and Close.
 */
export function ReaderAiPanel({ id, title, versionLabel, task, onTask, onClose, children }: {
  id: string;
  title: string;
  versionLabel?: string;
  task: ReaderAiTask | null;
  onTask: (task: ReaderAiTask) => void;
  onClose: () => void;
  children: ReactNode;
}) {
  const moveTab = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const index = tasks.findIndex(item => item.task === task);
    const next = event.key === "Home" ? 0 : event.key === "End" ? tasks.length - 1
      : (index + (event.key === "ArrowRight" ? 1 : -1) + tasks.length) % tasks.length;
    onTask(tasks[next].task);
    requestAnimationFrame(() => document.getElementById(readerAiTabId(id, tasks[next].task))?.focus());
  };
  return <aside id={id} className="island reader-ai-panel" aria-labelledby={`${id}-title`}>
    <header className="reader-ai-panel-header">
      <span className="reader-ai-mark"><img src={ardenAiMark} alt="" width={18} height={18} /></span>
      <div className="reader-ai-panel-heading">
        <h2 id={`${id}-title`}>Arden AI</h2>
        <p title={title}>Uses only {title}{versionLabel ? ` · v${versionLabel}` : ""}</p>
      </div>
      <button type="button" className="island-icon-button reader-ai-close" aria-label="Close Arden AI" title="Close Arden AI" onClick={onClose}>
        <Icon name="close" size={14} />
      </button>
    </header>

    {task === null ? <div className="reader-ai-launcher">
      <p>What do you want to do with this document?</p>
      <button type="button" className="reader-ai-task" onClick={() => onTask("summary")}>
        <span className="reader-ai-task-icon"><Icon name="document" size={15} /></span>
        <span><strong>Summarize</strong><small>Key points from the whole version, with their sources.</small></span>
      </button>
      <button type="button" className="reader-ai-task" onClick={() => onTask("question")}>
        <span className="reader-ai-task-icon"><Icon name="chat" size={15} /></span>
        <span><strong>Ask a question</strong><small>Answers come from this version only.</small></span>
      </button>
      <button type="button" className="reader-ai-task" disabled>
        <span className="reader-ai-task-icon"><Icon name="search" size={15} /></span>
        <span><strong>Explain a selection <span className="island-chip tone-info">Coming later</span></strong>
          <small>Select text in the document, then explain it.</small></span>
      </button>
    </div> : <div className="reader-ai-tabs" role="tablist" aria-label="Arden AI tasks">
      {tasks.map(item => <button key={item.task} id={readerAiTabId(id, item.task)} type="button" role="tab"
        className="reader-ai-tab" aria-selected={task === item.task} aria-controls={readerAiPanelId(id, item.task)}
        tabIndex={task === item.task ? 0 : -1} onKeyDown={moveTab} onClick={() => onTask(item.task)}>{item.label}</button>)}
      <button type="button" role="tab" className="reader-ai-tab" aria-selected={false} aria-disabled="true" disabled tabIndex={-1}>
        Explain <span className="reader-ai-soon">Later</span>
      </button>
    </div>}

    {children}

    <p className="reader-ai-panel-footer">AI can be wrong. Check the cited sources before you act on it.</p>
  </aside>;
}

export function ReaderAiGenerated({ children }: { children?: ReactNode }) {
  return <div className="reader-ai-meta"><span className="reader-ai-generated">AI-generated</span>{children}</div>;
}
