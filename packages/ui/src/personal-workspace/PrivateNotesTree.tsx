import { useEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
import { Icon } from "../shared/Icon";
import type { PrivateNotesController } from "./usePrivateNotes";
import { ItemActionsMenu, type ItemActions } from "./ItemActionsMenu";
import { childrenOf, favoriteItems, moveDestinations, notesIn, ROOT_LABEL, type TreeItem } from "./privateNotesModel";
import { getNoteDraft } from "./noteDraftModel";

/** Where a dragged note lands: into a collection (or the root) last, or before/after a note in the same place. */
type DropTarget =
  | { key: string; mode: "into"; collectionId: string | null; title: string }
  | { key: string; mode: "before" | "after"; collectionId: string | null; noteId: string; title: string };

function dropHalf(event: DragEvent<HTMLElement>): "before" | "after" {
  const box = event.currentTarget.getBoundingClientRect();
  return event.clientY < box.top + box.height / 2 ? "before" : "after";
}

/** Builds the shared `···` actions for a tree item; `onRename` lets the caller choose where renaming happens. */
export function itemActions(controller: PrivateNotesController, item: TreeItem, onRename: () => void,
  onPdfImported?: () => void): ItemActions {
  const ref = { kind: item.kind, id: item.id };
  const siblings = item.kind === "note" ? notesIn(controller.collections, controller.state.notes, item.parentId) : [];
  const index = siblings.findIndex((note) => note.id === item.id);
  return {
    kind: item.kind,
    title: item.title,
    favorite: Boolean(item.favoritedAt),
    saved: item.kind === "collection" || !controller.isPending(item.note),
    destinations: moveDestinations(controller.collections, { ...ref, parentId: item.parentId }),
    onToggleFavorite: () => void controller.toggleFavorite(ref),
    onDuplicate: () => void controller.duplicate(ref),
    onRename,
    onMove: (collectionId) => void controller.moveTo(ref, collectionId),
    onTrash: () => void controller.requestTrash(ref),
    ...(item.kind === "note" ? {
      onImportPdf: () => void controller.pickPdf(item.id).then(imported => {
        if (imported) onPdfImported?.();
      }),
      order: {
        canMoveUp: index > 0, canMoveDown: index >= 0 && index < siblings.length - 1,
        onMoveUp: () => void controller.shiftNote(item.id, -1), onMoveDown: () => void controller.shiftNote(item.id, 1),
      },
      archive: { available: controller.canArchive(item.note), onArchive: () => void controller.archiveNote(item.id) },
    } : {}),
  };
}

export function focusNoteTitle() {
  requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>(".editor-title-label textarea")?.focus());
}

function RenameInput({ title, onCommit, onCancel }: { title: string; onCommit: (value: string) => void; onCancel: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const settled = useRef(false);
  useEffect(() => { input.current?.focus(); input.current?.select(); }, []);
  return <input ref={input} className="pn-rename" aria-label={`Rename ${title}`} defaultValue={title} maxLength={200}
    onKeyDown={(event) => {
      if (event.key === "Enter") { event.preventDefault(); settled.current = true; onCommit(event.currentTarget.value); }
      else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); settled.current = true; onCancel(); }
    }}
    onBlur={(event) => { if (!settled.current) { settled.current = true; onCommit(event.currentTarget.value); } }} />;
}

/**
 * Private Notes inside the main navigation (ADR 0029): Favorites first, then collections (nestable) and notes.
 * Hover or focus reveals `···`, and `+` on collections; the header row offers New collection and New note.
 */
export function PrivateNotesNavSection({ controller, navItem, pageVisible, collapsed, onOpen }: {
  controller: PrivateNotesController;
  /** The regular "Private Notes" navigation button. */
  navItem: ReactNode;
  /** True while the Private Notes page is showing, so errors are not announced twice. */
  pageVisible: boolean;
  collapsed: boolean;
  onOpen: () => void;
}) {
  const { state, collections, treeOpen, expanded, renaming, loading, error, actionError } = controller;
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const latestOnOpen = useRef(onOpen);
  latestOnOpen.current = onOpen;
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const expandTimer = useRef<{ id: string; timer: number } | null>(null);
  const clearExpandTimer = () => {
    if (expandTimer.current) window.clearTimeout(expandTimer.current.timer);
    expandTimer.current = null;
  };
  useEffect(() => clearExpandTimer, []);
  const endDrag = () => { setDragging(null); setDropTarget(null); clearExpandTimer(); };

  /** Drag and drop of notes (spec F03-ARR); Move up/down and Move to in `···` are the keyboard alternative. */
  const dropProps = (target: DropTarget["key"], resolve: (event: DragEvent<HTMLElement>) => DropTarget | null) => dragging ? {
    onDragOver: (event: DragEvent<HTMLElement>) => {
      const next = resolve(event);
      if (!next) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      if (dropTarget?.key !== next.key || dropTarget.mode !== next.mode) setDropTarget(next);
      // Hovering a closed collection opens it so the note can be dropped between its notes.
      if (next.mode === "into" && next.collectionId && !expanded.has(next.collectionId) && expandTimer.current?.id !== next.collectionId) {
        clearExpandTimer();
        const id = next.collectionId;
        expandTimer.current = { id, timer: window.setTimeout(() => controller.expandCollection(id), 650) };
      }
    },
    onDragLeave: (event: DragEvent<HTMLElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null) && dropTarget?.key === target) setDropTarget(null);
    },
    onDrop: (event: DragEvent<HTMLElement>) => {
      event.preventDefault();
      const next = resolve(event);
      const noteId = dragging;
      endDrag();
      if (!next || !noteId) return;
      if (next.mode === "into") { void controller.placeNoteAt(noteId, next.collectionId, null, `Moved to ${next.title}`); return; }
      const siblings = notesIn(collections, state.notes, next.collectionId).filter((note) => note.id !== noteId);
      const anchor = siblings.findIndex((note) => note.id === next.noteId);
      if (anchor < 0) return;
      void controller.placeNoteAt(noteId, next.collectionId, anchor + (next.mode === "after" ? 1 : 0), "Note moved");
    },
  } : {};
  const titleOf = (note: (typeof state.notes)[number]) => {
    const draft = state.drafts[note.id];
    return draft ? getNoteDraft(state, note).title : note.title;
  };
  const favorites = favoriteItems(collections, state.notes, titleOf);
  const focus = controller.focus;
  const selectedKey = focus.kind === "note" && state.selectedId ? `note:${state.selectedId}` : focus.kind === "collection" ? `collection:${focus.id}` : "";
  const treeId = "private-notes-tree";

  const open = (item: TreeItem) => {
    if (item.kind === "note") controller.openNote(item.id); else controller.openCollection(item.id);
    onOpen();
  };

  const row = (item: TreeItem, section: "favorites" | "tree", depth: number): ReactNode[] => {
    const key = `${section}:${item.kind}:${item.id}`;
    const isCollection = item.kind === "collection";
    const isOpen = isCollection && expanded.has(item.id);
    const showChevron = isCollection && section === "tree";
    const isRenaming = section === "tree" && renaming?.where === "tree" && renaming.kind === item.kind && renaming.id === item.id;
    const unsaved = item.kind === "note" && (controller.isPending(item.note) || Boolean(state.drafts[item.id]
      && (state.drafts[item.id]!.title !== item.note.title || state.drafts[item.id]!.body !== item.note.body)));
    const inTree = section === "tree";
    const draggable = inTree && item.kind === "note" && !isRenaming && !loading;
    const dropKey = `${item.kind}:${item.id}`;
    const drop = inTree && dragging && dragging !== item.id ? dropProps(dropKey, (event) => isCollection
      ? { key: dropKey, mode: "into", collectionId: item.id, title: item.title }
      : { key: dropKey, mode: dropHalf(event), collectionId: item.parentId, noteId: item.id, title: "" }) : {};
    const dropClass = dropTarget?.key === dropKey && inTree ? ` is-drop-${dropTarget.mode}` : "";
    const rows: ReactNode[] = [
      <div key={key} className={`pn-row${selectedKey === `${item.kind}:${item.id}` ? " is-selected" : ""}${menuFor === key ? " has-menu" : ""}${dragging === item.id && inTree ? " is-dragging" : ""}${dropClass}`}
        style={{ paddingLeft: 2 + depth * 14 }}
        draggable={draggable || undefined}
        onDragStart={draggable ? (event) => {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", item.title);
          setDragging(item.id);
        } : undefined}
        onDragEnd={draggable ? endDrag : undefined}
        {...drop}>
        {showChevron ? <button type="button" className={`pn-icon-button pn-chevron${isOpen ? " is-open" : ""}`}
          aria-label={`${isOpen ? "Collapse" : "Expand"} ${item.title}`} aria-expanded={isOpen}
          onClick={() => controller.toggleExpanded(item.id)}><Icon name="chevron" size={13} /></button>
          : <span className="pn-chevron-space" aria-hidden="true" />}
        {isRenaming ? <>
          <span className="pn-row-icon" aria-hidden="true"><Icon name={isCollection ? "folder" : "document"} size={15} /></span>
          <RenameInput title={item.title} onCommit={(value) => void controller.commitRename(item, value)}
            onCancel={() => {
              controller.cancelRename();
              requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-pn-row="${item.kind}:${item.id}"]`)?.focus());
            }} />
        </> : <>
          <button type="button" className="pn-row-main" data-pn-row={section === "tree" ? `${item.kind}:${item.id}` : undefined}
            aria-current={selectedKey === `${item.kind}:${item.id}` ? "page" : undefined} onClick={() => open(item)}>
            <Icon name={isCollection ? "folder" : "document"} size={15} />
            <span className="pn-ellipsis">{item.title}</span>
            {unsaved && <span className="pn-unsaved" title="Unsaved changes"><span className="sr-only">, unsaved changes</span></span>}
          </button>
          <span className="pn-row-actions">
            <ItemActionsMenu label={`More actions for ${item.title}`} actions={itemActions(controller, item,
              () => controller.startRename(item), () => latestOnOpen.current())}
              onOpenChange={(isMenuOpen) => setMenuFor(isMenuOpen ? key : null)} />
            {isCollection && <button type="button" className="pn-icon-button" aria-label={`Add a note to ${item.title}`} title="New note inside"
              onClick={() => { void controller.addNote(item.id); onOpen(); }}><Icon name="plus" size={14} /></button>}
          </span>
        </>}
      </div>,
    ];
    if (isOpen) {
      const children = childrenOf(collections, state.notes, item.id, titleOf);
      if (!children.length) {
        const emptyKey = `empty:${item.id}`;
        rows.push(<div key={`${key}:empty`} className={`pn-empty${dropTarget?.key === emptyKey ? " is-drop-into" : ""}`}
          style={{ paddingLeft: 2 + (depth + 1) * 14 + 26 }}
          {...dropProps(emptyKey, () => ({ key: emptyKey, mode: "into", collectionId: item.id, title: item.title }))}>No notes inside</div>);
      }
      for (const child of children) rows.push(...row(child, "tree", depth + 1));
    }
    return rows;
  };

  const rootItems = childrenOf(collections, state.notes, null, titleOf);
  const showTree = treeOpen && !collapsed;

  const rootKey = "root";
  return <div className="pn-nav-section">
    <div className={`pn-nav-row${dropTarget?.key === rootKey ? " is-drop-into" : ""}`}
      {...dropProps(rootKey, () => ({ key: rootKey, mode: "into", collectionId: null, title: ROOT_LABEL }))}>
      {navItem}
      {!collapsed && <span className="pn-row-actions pn-nav-actions">
        <button type="button" className="pn-icon-button" aria-label="New collection" title="New collection" disabled={loading}
          onClick={() => { void controller.createCollection(null); onOpen(); }}><Icon name="folder-add" size={15} /></button>
        <button type="button" className="pn-icon-button" aria-label="New note" title="New note" disabled={loading}
          onClick={() => { void controller.addNote(null); onOpen(); }}><Icon name="plus" size={15} /></button>
      </span>}
      {!collapsed && <button type="button" className={`pn-icon-button pn-chevron${treeOpen ? " is-open" : ""}`} aria-label="Show or hide private notes"
          aria-expanded={treeOpen} aria-controls={treeId} onClick={() => controller.setTreeOpen(!treeOpen)}><Icon name="chevron" size={13} /></button>}
    </div>
    {showTree && <div className="pn-tree" id={treeId} role="group" aria-label="Private notes">
      {loading && <div className="pn-empty" role="status">Loading…</div>}
      {!loading && error && !state.notes.length && <div className="pn-feedback" role="alert">
        <span>Couldn’t load notes.</span>
        <button type="button" className="pn-link-button" onClick={() => void controller.refresh()}>Retry</button>
      </div>}
      {!pageVisible && actionError && <div className="pn-feedback" role="alert">
        <span>{actionError}</span>
        <button type="button" className="pn-link-button" onClick={controller.dismissActionError}>Dismiss</button>
      </div>}
      {!loading && favorites.length > 0 && <>
        <div className="pn-favorites" role="group" aria-label="Favorites">
          <div className="pn-section-label" aria-hidden="true">Favorites</div>
          {favorites.flatMap((item) => row(item, "favorites", 0))}
        </div>
        <div className="pn-section-label">{collections.length ? "Collections & notes" : "Notes"}</div>
      </>}
      {!loading && rootItems.flatMap((item) => row(item, "tree", 0))}
      {!loading && !error && !rootItems.length && <div className="pn-empty">No private notes yet</div>}
    </div>}
    <span className="sr-only" role="status" aria-live="polite">{pageVisible ? "" : controller.notice?.message ?? ""}</span>
  </div>;
}
