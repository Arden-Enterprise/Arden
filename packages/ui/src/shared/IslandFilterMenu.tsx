import { useEffect, useId, useRef, useState } from "react";

/** Closed filter control with a menu that matches the text-size menu. */
export function IslandFilterMenu({ label, value, options, onChange }: {
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const current = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return <div className={`island-filter-menu${open ? " is-open" : ""}`} ref={rootRef}>
    <button type="button" className="island-filter-trigger" aria-haspopup="listbox" aria-expanded={open} aria-controls={menuId} aria-label={label}
      onClick={() => setOpen((currentOpen) => !currentOpen)}>
      <span>{current?.label}</span>
    </button>
    {open && <div className="island-filter-list" id={menuId} role="listbox" aria-label={label}>
      {options.map((option) => <button type="button" key={option.value} role="option" aria-selected={option.value === value}
        className={option.value === value ? "is-selected" : undefined}
        onClick={() => { onChange(option.value); setOpen(false); }}>{option.label}</button>)}
    </div>}
  </div>;
}
