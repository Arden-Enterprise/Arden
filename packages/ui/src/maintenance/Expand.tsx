import type { ReactNode } from "react";

export function Expand({ id, open, children }: { id: string; open: boolean; children: ReactNode }) {
  return <div id={id} className="maintenance-expand" data-open={open || undefined} inert={!open}>
    <div className="maintenance-expand-inner">{children}</div>
  </div>;
}
