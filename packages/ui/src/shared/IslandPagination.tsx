export const pageSizeOptions = [10, 20] as const;
export type PageSize = (typeof pageSizeOptions)[number];

export type PageSlot = number | "gap";

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, index) => from + index);

/**
 * Page numbers to show in seven stable slots: the first and last page, the current page and its
 * neighbours, with a gap wherever pages are skipped (1 2 3 4 5 … 167, 1 … 49 50 51 … 167).
 */
export function paginationRange(page: number, pageCount: number): PageSlot[] {
  if (pageCount <= 7) return range(1, Math.max(0, pageCount));
  if (page <= 4) return [...range(1, 5), "gap", pageCount];
  if (page >= pageCount - 3) return [1, "gap", ...range(pageCount - 4, pageCount)];
  return [1, "gap", page - 1, page, page + 1, "gap", pageCount];
}

export function pageCountFor(total: number, pageSize: number) {
  return Math.max(1, Math.ceil(total / pageSize));
}

/** A numbered pager for island tables: page size, position summary and first/previous/next/last navigation. */
export function IslandPagination({ label, noun, page, pageSize, total, onPage, onPageSize }: {
  /** What is being paged, used in accessible names (e.g. "All documents"). */
  label: string;
  /** Plural noun in the summary (e.g. "documents"). */
  noun: string;
  page: number;
  pageSize: PageSize;
  total: number;
  onPage: (page: number) => void;
  onPageSize: (pageSize: PageSize) => void;
}) {
  const pageCount = pageCountFor(total, pageSize);
  const first = total ? (page - 1) * pageSize + 1 : 0;
  const last = Math.min(total, page * pageSize);
  const count = (value: number) => value.toLocaleString("en-US");
  const go = (target: number) => { if (target !== page && target >= 1 && target <= pageCount) onPage(target); };
  return <nav className="island-pagination" aria-label={`${label} pages`}>
    <label className="island-pagination-size">Show
      <select value={pageSize} aria-label={`${noun[0].toUpperCase()}${noun.slice(1)} per page`}
        onChange={event => onPageSize(Number(event.target.value) as PageSize)}>
        {pageSizeOptions.map(option => <option key={option} value={option}>{option}</option>)}
      </select>per page</label>
    <span className="island-pagination-summary" role="status">Showing {count(first)}–{count(last)} of {count(total)} {noun}</span>
    {pageCount > 1 && <div className="island-pagination-pages">
      <button type="button" className="is-edge" aria-label="First page" disabled={page === 1} onClick={() => go(1)}>«</button>
      <button type="button" aria-label="Previous page" disabled={page === 1} onClick={() => go(page - 1)}>‹</button>
      {paginationRange(page, pageCount).map((slot, index) => slot === "gap"
        ? <span key={`gap-${index}`} className="island-pagination-gap" aria-hidden="true">…</span>
        : <button type="button" key={slot} aria-label={`Page ${slot}`} aria-current={slot === page ? "page" : undefined}
          onClick={() => go(slot)}>{slot}</button>)}
      <button type="button" aria-label="Next page" disabled={page === pageCount} onClick={() => go(page + 1)}>›</button>
      <button type="button" className="is-edge" aria-label="Last page" disabled={page === pageCount} onClick={() => go(pageCount)}>»</button>
    </div>}
  </nav>;
}
