import type { CSSProperties, ReactNode } from "react";

type ColumnStyle = CSSProperties & { "--island-columns": string; "--island-list-min": string };

/**
 * A data table drawn as an island of grid rows. ARIA table roles keep row/cell
 * semantics that CSS grid display would otherwise remove from a native table.
 */
export function IslandTable({ label, columns, minWidth, headers, children, footer }: {
  label: string;
  /** CSS grid-template-columns shared by the header and every row. */
  columns: string;
  minWidth: number;
  headers: ReactNode[];
  children: ReactNode;
  footer?: ReactNode;
}) {
  const style: ColumnStyle = { "--island-columns": columns, "--island-list-min": `${minWidth}px` };
  return <section className="island island-list" style={style} aria-label={label}>
    <div className="island-list-inner" role="table" aria-label={label}>
      <div role="rowgroup"><div className="island-row is-head" role="row">
        {headers.map((header, index) => <span key={index} role="columnheader">{header}</span>)}
      </div></div>
      <div role="rowgroup">{children}</div>
    </div>
    {footer && <div className="island-list-footer">{footer}</div>}
  </section>;
}

export function IslandRow({ selected = false, children, className = "", onClick }: { selected?: boolean; children: ReactNode; className?: string; onClick?: (event: React.MouseEvent<HTMLDivElement>) => void }) {
  return <div role="row" className={`island-row${selected ? " is-selected" : ""}${className ? ` ${className}` : ""}`} onClick={onClick}>{children}</div>;
}

export function IslandCell({ children, className = "island-row-cell" }: { children?: ReactNode; className?: string }) {
  return <div role="cell" className={className}>{children}</div>;
}
