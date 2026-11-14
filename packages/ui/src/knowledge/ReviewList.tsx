import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "../shared/Icon";
import type { AssignedKnowledgeReview, DecidedKnowledgeReview } from "../shared/api-client";
import { reviewRequestPresentation } from "./reviewRequest";

/**
 * REV-02 "Reviews · Linear list": the Reviews landing page. Needs review rows open the decision workspace
 * (REV-01); Approved and Rejected rows are the reviewer's own decided history and are read-only.
 */
type GroupKey = "pending" | "approved" | "rejected";
type Row = { id: string; title: string; requestLabel?: string; versionNo: number | null; departmentId: string;
  authorName: string | null; date: string; detail: string; status: GroupKey; openable: boolean };

const groupLabels: Record<GroupKey, string> = { pending: "Needs review", approved: "Approved", rejected: "Rejected" };
const statusIcons = { pending: "status-pending", approved: "status-approved", rejected: "status-rejected" } as const;

function shortDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, sameYear ? { month: "short", day: "numeric" }
    : { month: "short", day: "numeric", year: "numeric" });
}

/** One or two initials for an author avatar; the email domain is ignored. */
export function initialsOf(name: string): string {
  const parts = name.replace(/@.*$/, "").split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "")).toUpperCase() || "?";
}

const publicationLabels: Record<DecidedKnowledgeReview["publicationState"], string> = {
  NONE: "", PREPARING: "Preparing publication", ACTIVE: "Published", FAILED: "Publication failed",
  SUPERSEDED: "Newer version published",
};

export function ReviewList({ pending, decided, departmentName, busy, onOpen, onRefresh }: {
  pending: readonly AssignedKnowledgeReview[];
  decided: readonly DecidedKnowledgeReview[];
  departmentName: (id: string | null) => string;
  busy: boolean;
  onOpen: (submissionId: string) => void;
  onRefresh: () => void;
}) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<GroupKey>>(new Set());
  const [hidden, setHidden] = useState<ReadonlySet<GroupKey>>(new Set());
  const [filterOpen, setFilterOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [optionsOpen, setOptionsOpen] = useState(false);
  const optionsRef = useRef<HTMLDivElement>(null);
  const optionsButton = useRef<HTMLButtonElement>(null);
  const filterInput = useRef<HTMLInputElement>(null);
  const optionsId = useId();

  useEffect(() => { if (filterOpen) filterInput.current?.focus(); }, [filterOpen]);
  useEffect(() => {
    if (!optionsOpen) return;
    const onPointer = (event: PointerEvent) => { if (!optionsRef.current?.contains(event.target as Node)) setOptionsOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { setOptionsOpen(false); optionsButton.current?.focus(); } };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onPointer); document.removeEventListener("keydown", onKey); };
  }, [optionsOpen]);

  const rows: Row[] = [
    ...pending.map((item): Row => {
      return { id: item.submissionId, title: item.title, versionNo: item.versionNo ?? null,
        requestLabel: item.requestType && item.requestType !== "CONTENT" ? reviewRequestPresentation(item.requestType).label : undefined,
        departmentId: item.departmentId, authorName: item.authorName ?? null, date: item.submittedAt,
        detail: item.approvalBlocked ? "Approval blocked: the readers can no longer be enforced. You can still reject."
          : `Submitted ${shortDate(item.submittedAt)}`, status: "pending", openable: true };
    }),
    ...decided.map((item): Row => {
      const outcome = item.decision === "APPROVED" ? "Approved" : "Rejected";
      const publication = item.decision === "APPROVED" ? publicationLabels[item.publicationState] : "";
      return { id: item.submissionId, title: item.title, versionNo: item.versionNo,
        departmentId: item.departmentId, authorName: item.authorName, date: item.decidedAt,
        detail: [`${outcome} ${shortDate(item.decidedAt)}`, publication].filter(Boolean).join(" · "),
        status: item.decision === "APPROVED" ? "approved" : "rejected", openable: false };
    }),
  ];
  const normalized = query.trim().toLocaleLowerCase();
  const matches = (row: Row) => !normalized || [row.title, departmentName(row.departmentId), row.authorName ?? ""]
    .some((value) => value.toLocaleLowerCase().includes(normalized));
  const groups = (["pending", "approved", "rejected"] as const).map((key) => ({
    key, rows: rows.filter((row) => row.status === key && matches(row)),
  })).filter((group) => !hidden.has(group.key) && (group.key === "pending" || group.rows.length > 0));
  const toggle = (set: ReadonlySet<GroupKey>, key: GroupKey) => {
    const next = new Set(set); if (next.has(key)) next.delete(key); else next.add(key); return next;
  };
  const pendingBlocked = pending.some((item) => item.approvalBlocked);

  return <section className="island review-board" aria-labelledby="review-board-title">
    <header className="review-board-toolbar">
      <h1 id="review-board-title" className="sr-only">Reviews</h1>
      {filterOpen && <label className="review-board-filter">
        <Icon name="search" size={14} />
        <input ref={filterInput} type="search" value={query} placeholder="Filter by title, department or author"
          aria-label="Filter reviews" onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Escape") { setQuery(""); setFilterOpen(false); } }} />
      </label>}
      <span className="review-board-spacer" />
      <button type="button" className="island-link-button review-board-refresh" disabled={busy} onClick={onRefresh}>Refresh</button>
      <button type="button" className={`island-icon-button review-board-tool${filterOpen ? " is-active" : ""}`}
        aria-label="Filter" aria-pressed={filterOpen} title="Filter"
        onClick={() => { if (filterOpen) setQuery(""); setFilterOpen(!filterOpen); }}><Icon name="filter" size={14} /></button>
      <div className="review-board-options" ref={optionsRef}>
        <button ref={optionsButton} type="button" className={`island-icon-button review-board-tool${optionsOpen ? " is-active" : ""}`}
          aria-label="Display options" title="Display options" aria-haspopup="true" aria-expanded={optionsOpen}
          aria-controls={optionsOpen ? optionsId : undefined} onClick={() => setOptionsOpen(!optionsOpen)}><Icon name="sliders" size={14} /></button>
        {optionsOpen && <div id={optionsId} className="review-board-menu" role="group" aria-label="Show groups">
          <p className="review-board-menu-label">Show groups</p>
          {(["approved", "rejected"] as const).map((key) => <label key={key} className="review-board-menu-item">
            <input type="checkbox" checked={!hidden.has(key)} onChange={() => setHidden(toggle(hidden, key))} />
            <span>{groupLabels[key]}</span>
          </label>)}
        </div>}
      </div>
    </header>
    <div className="review-board-groups">
      {groups.map((group) => {
        const open = !collapsed.has(group.key);
        const headingId = `review-group-${group.key}`;
        return <section key={group.key} className={`review-group is-${group.key}`} aria-labelledby={headingId}>
          <h2 className="review-group-heading">
            <button type="button" id={headingId} className="review-group-header" aria-expanded={open}
              onClick={() => setCollapsed(toggle(collapsed, group.key))}>
              <span className="review-group-chevron" aria-hidden="true"><Icon name="chevron" size={12} /></span>
              <span className={`review-status-icon is-${group.key}`} aria-hidden="true"><Icon name={statusIcons[group.key]} size={14} /></span>
              <span className="review-group-label">{groupLabels[group.key]}</span>
              <span className="review-group-count">{group.rows.length}</span>
              {group.key === "pending" && pendingBlocked && <span className="sr-only">, some approvals are blocked</span>}
            </button>
          </h2>
          {open && (group.rows.length ? <ul className="review-rows">
            {group.rows.map((row) => {
              const content = <>
                <span className={`review-status-icon is-${row.status}`} aria-hidden="true"><Icon name={statusIcons[row.status]} size={14} /></span>
                <span className="review-row-title">
                  <strong>{row.title}</strong>
                  {row.requestLabel && <span className="island-chip">{row.requestLabel}</span>}
                  {row.versionNo !== null && <span className="review-row-version">v{row.versionNo}</span>}
                  {row.status === "pending" && pending.find((item) => item.submissionId === row.id)?.approvalBlocked
                    && <span className="review-blocked-dot" title="Approval blocked: the readers can no longer be enforced" />}
                </span>
                <span className="review-row-department" title={departmentName(row.departmentId)}>
                  <Icon name="layers" size={11} /><span>{departmentName(row.departmentId)}</span></span>
                <span className="review-row-author" title={row.authorName ?? "Author unavailable"}>
                  {row.authorName ? <><span className="review-row-avatar" aria-hidden="true">{initialsOf(row.authorName)}</span>
                    <span>{row.authorName}</span></> : <span className="review-row-muted">—</span>}
                </span>
                <time className="review-row-date" dateTime={row.date}>{shortDate(row.date)}</time>
                <span className="sr-only">, {groupLabels[row.status]}, {row.detail}</span>
              </>;
              return <li key={row.id}>{row.openable
                ? <button type="button" className="review-row" title={row.detail} disabled={busy} onClick={() => onOpen(row.id)}>{content}</button>
                : <div className="review-row is-static" title={row.detail}>{content}</div>}</li>;
            })}
          </ul> : <p className="review-rows-empty">{normalized ? "No matches." : "Nothing to review. You’re caught up."}</p>)}
        </section>;
      })}
    </div>
  </section>;
}
