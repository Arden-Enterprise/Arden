import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";

/** Closed filter control with a menu that matches the text-size menu. */
export function IslandFilterMenu({ label, value, options, onChange }: {
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const focusListOnOpen = useRef(false);
  const menuId = useId();
  const current = options.find((option) => option.value === value) ?? options[0];

  const close = (restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    if (focusListOnOpen.current) {
      focusListOnOpen.current = false;
      const selected = rootRef.current?.querySelector<HTMLButtonElement>("[role='option'][aria-selected='true']")
        ?? rootRef.current?.querySelector<HTMLButtonElement>("[role='option']");
      selected?.focus();
    }
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") close(true); };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const moveOption = (currentOption: HTMLButtonElement, direction: 1 | -1) => {
    const items = [...rootRef.current?.querySelectorAll<HTMLButtonElement>("[role='option']") ?? []];
    const index = items.indexOf(currentOption);
    items[Math.min(items.length - 1, Math.max(0, index + direction))]?.focus();
  };

  const onOptionKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown") { event.preventDefault(); moveOption(event.currentTarget, 1); }
    if (event.key === "ArrowUp") { event.preventDefault(); moveOption(event.currentTarget, -1); }
    if (event.key === "Escape") { event.preventDefault(); close(true); }
  };

  return <div className={`island-filter-menu${open ? " is-open" : ""}`} ref={rootRef}>
    <button type="button" className="island-filter-trigger" ref={triggerRef} aria-haspopup="listbox" aria-expanded={open} aria-controls={menuId}
      aria-label={current ? `${label}: ${current.label}` : label}
      onClick={(event) => {
        const next = !open;
        focusListOnOpen.current = next && event.detail === 0;
        setOpen(next);
      }}
      onKeyDown={(event) => {
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
        event.preventDefault();
        if (open) {
          const selected = rootRef.current?.querySelector<HTMLButtonElement>("[role='option'][aria-selected='true']")
            ?? rootRef.current?.querySelector<HTMLButtonElement>("[role='option']");
          selected?.focus();
          return;
        }
        focusListOnOpen.current = true;
        setOpen(true);
      }}>
      <span>{current?.label}</span>
    </button>
    {open && <div className="island-filter-list" id={menuId} role="listbox" aria-label={label}>
      {options.map((option) => <button type="button" key={option.value} role="option" aria-selected={option.value === value}
        className={option.value === value ? "is-selected" : undefined}
        onKeyDown={onOptionKeyDown}
        onClick={() => { onChange(option.value); close(true); }}>{option.label}</button>)}
    </div>}
  </div>;
}
