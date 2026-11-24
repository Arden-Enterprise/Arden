import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Icon } from "../shared/Icon";
import type { MoveDestination } from "./privateNotesModel";

export type ItemActions = {
  kind: "note" | "collection";
  title: string;
  favorite: boolean;
  /** Favorites and Duplicate need a saved note; a never-saved note only offers local actions. */
  saved: boolean;
  destinations: MoveDestination[];
  onToggleFavorite: () => void;
  onDuplicate: () => void;
  onRename: () => void;
  onMove: (collectionId: string | null) => void;
  onTrash: () => void;
  /** Notes only (spec F03-ARR): keyboard alternative to dragging inside the same place. */
  order?: { canMoveUp: boolean; canMoveDown: boolean; onMoveUp: () => void; onMoveDown: () => void };
  /** Notes only (spec F03-PDF revision 2): add a PDF's text to this note. */
  onImportPdf?: () => void;
  /** Notes only (spec F03-ARR): `available` is false for never-saved notes and unsaved edits. */
  archive?: { available: boolean; onArchive: () => void };
};

const MENU_WIDTH = 240;

/**
 * `···` menu for a private note or collection, used on sidebar rows and in the page header.
 * Real buttons with menu roles; Escape, Tab and outside clicks close it and return focus to the trigger.
 * The popover is fixed-positioned against the trigger so the scrolling sidebar cannot clip it.
 */
export function ItemActionsMenu({ actions, label, placement = "side", triggerClassName = "pn-icon-button", disabled = false, onOpenChange }: {
  actions: ItemActions;
  label: string;
  placement?: "side" | "below";
  triggerClassName?: string;
  disabled?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"main" | "move">("main");
  const [position, setPosition] = useState<CSSProperties>({ visibility: "hidden" });
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;

  const close = (returnFocus: boolean) => {
    setOpen(false);
    setMode("main");
    onOpenChangeRef.current?.(false);
    if (returnFocus) trigger.current?.focus();
  };

  useLayoutEffect(() => {
    if (!open || !trigger.current || !menu.current) return;
    const anchor = trigger.current.getBoundingClientRect();
    // A transformed or contained ancestor can become the containing block of a fixed element; measure its origin.
    menu.current.style.left = "0px";
    menu.current.style.top = "0px";
    const box = menu.current.getBoundingClientRect();
    const originX = box.left;
    const originY = box.top;
    const width = box.width || MENU_WIDTH;
    const height = box.height;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    let left = placement === "side" ? anchor.right + 8 : anchor.right - width;
    let top = placement === "side" ? anchor.top - 6 : anchor.bottom + 6;
    if (left + width > viewportWidth - 8) left = Math.max(8, Math.min(anchor.left, viewportWidth - width - 8));
    if (placement === "side" && left < anchor.right && left + width > anchor.left) top = anchor.bottom + 6;
    if (top + height > viewportHeight - 8) top = Math.max(8, viewportHeight - height - 8);
    setPosition({ left: Math.max(8, left) - originX, top: top - originY });
  }, [open, mode, placement]);

  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLButtonElement>("[role=menuitem]:not(:disabled)")?.focus();
  }, [open, mode]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menu.current?.contains(target) || trigger.current?.contains(target)) return;
      close(false);
      // Focus returns to the trigger unless the click moved it somewhere useful.
      requestAnimationFrame(() => {
        if (!document.activeElement || document.activeElement === document.body) trigger.current?.focus();
      });
    };
    const onViewportChange = (event: Event) => {
      if (event.type === "scroll" && menu.current?.contains(event.target as Node)) return;
      close(false);
    };
    document.addEventListener("pointerdown", onPointer);
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
    };
  }, [open]);

  const choose = (run: () => void, returnFocus = true) => {
    close(returnFocus);
    run();
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      close(true);
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const items = [...(menu.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]:not(:disabled)") ?? [])];
    if (!items.length) return;
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
      : event.key === "ArrowDown" ? (index + 1) % items.length : (index - 1 + items.length) % items.length;
    items[next]?.focus();
  };

  const kindLabel = actions.kind === "note" ? "Note" : "Collection";

  return <>
    <button type="button" ref={trigger} className={triggerClassName} aria-label={label} title={label} disabled={disabled}
      aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
      onClick={() => {
        if (open) { close(false); return; }
        setPosition({ visibility: "hidden" });
        setMode("main");
        setOpen(true);
        onOpenChangeRef.current?.(true);
      }}>
      <Icon name="more" size={15} />
    </button>
    {open && <div ref={menu} id={menuId} className="pn-menu" role="menu" aria-label={`Actions for ${actions.title}`}
      style={{ position: "fixed", ...position }} onKeyDown={onKeyDown}>
      {mode === "main" ? <>
        <div className="pn-menu-label" aria-hidden="true">{kindLabel}</div>
        <button type="button" role="menuitem" disabled={!actions.saved} onClick={() => choose(actions.onToggleFavorite)}>
          <Icon name="star" size={15} /><span>{actions.favorite ? "Remove from favorites" : "Add to favorites"}</span>
        </button>
        <div className="pn-menu-separator" role="separator" />
        <button type="button" role="menuitem" disabled={!actions.saved} onClick={() => choose(actions.onDuplicate)}>
          <Icon name="copy" size={15} /><span>Duplicate</span>
        </button>
        <button type="button" role="menuitem" onClick={() => choose(actions.onRename, false)}>
          <Icon name="edit" size={15} /><span>Rename</span>
        </button>
        {actions.onImportPdf && <button type="button" role="menuitem" onClick={() => choose(actions.onImportPdf!, false)}>
          <Icon name="pdf" size={15} /><span>Import PDF</span>
        </button>}
        <button type="button" role="menuitem" aria-haspopup="menu" onClick={() => setMode("move")}>
          <Icon name="move" size={15} /><span className="pn-menu-grow">Move to</span><Icon name="chevron" size={13} />
        </button>
        {actions.order && <>
          <button type="button" role="menuitem" disabled={!actions.order.canMoveUp} onClick={() => choose(actions.order!.onMoveUp)}>
            <Icon name="arrow-up" size={15} /><span>Move up</span>
          </button>
          <button type="button" role="menuitem" disabled={!actions.order.canMoveDown} onClick={() => choose(actions.order!.onMoveDown)}>
            <Icon name="arrow-down" size={15} /><span>Move down</span>
          </button>
        </>}
        <div className="pn-menu-separator" role="separator" />
        {actions.archive && <button type="button" role="menuitem" disabled={!actions.archive.available}
          title={actions.archive.available ? undefined : "Save or discard your changes first"}
          onClick={() => choose(actions.archive!.onArchive, false)}>
          <Icon name="archive" size={15} /><span>Archive</span>
        </button>}
        <button type="button" role="menuitem" className="is-danger" onClick={() => choose(actions.onTrash, false)}>
          <Icon name="trash" size={15} /><span>Move to trash</span>
        </button>
      </> : <>
        <div className="pn-menu-head">
          <button type="button" role="menuitem" className="pn-icon-button" aria-label="Back to actions" onClick={() => setMode("main")}>
            <span className="pn-flip"><Icon name="chevron" size={13} /></span>
          </button>
          <span>Move to…</span>
        </div>
        {actions.destinations.map((destination) => <button key={destination.id ?? "root"} type="button" role="menuitem"
          disabled={destination.current} aria-label={`Move to ${destination.title}`} style={{ paddingLeft: 8 + destination.depth * 14 }}
          onClick={() => choose(() => actions.onMove(destination.id))}>
          <Icon name={destination.id ? "folder" : "lock"} size={15} />
          <span className="pn-menu-grow pn-ellipsis">{destination.title}</span>
          {destination.current && <span className="pn-menu-current">Current</span>}
        </button>)}
      </>}
    </div>}
  </>;
}
