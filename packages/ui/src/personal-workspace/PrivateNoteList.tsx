import type { ReactNode } from "react";
import type { PrivateNote } from "../shared/types";
import type { NoteDraft } from "./noteDraftModel";
import { Icon } from "../shared/Icon";

type PrivateNoteListProps = {
  notes: PrivateNote[];
  drafts: Record<string, NoteDraft>;
  selectedId: string;
  search: ReactNode;
  onCreate: () => void;
  onSelect: (note: PrivateNote) => void;
  onClearSearch: () => void;
  searching: boolean;
};

export function PrivateNoteList({
  notes,
  drafts,
  selectedId,
  search,
  onCreate,
  onSelect,
  onClearSearch,
  searching,
}: PrivateNoteListProps) {
  return (
    <section className="note-list-card" aria-label="Your private notes">
      <header className="note-list-header">
        {search}
        <button type="button" className="island-icon-button" onClick={onCreate} aria-label="New private note" title="New private note"><Icon name="plus" size={16} /></button>
      </header>
      <span className="meta-label note-list-count">{notes.length} PRIVATE NOTES</span>
      <div className="note-list">
        {notes.map((note) => {
          const draft = drafts[note.id];
          const unsaved = Boolean(draft && (draft.title !== note.title || draft.body !== note.body));
          return (
            <button
              type="button"
              key={note.id}
              className={note.id === selectedId ? "is-selected" : ""}
              aria-current={note.id === selectedId ? "true" : undefined}
              onClick={() => onSelect(note)}
            >
              <strong>{draft ? draft.title.trim() || "Untitled private note" : note.title}</strong>
              <span className="note-row-snippet">{(draft?.body ?? note.body) || "Empty private note"}</span>
              <span className={`note-row-meta${unsaved ? " is-unsaved" : ""}`}>{unsaved ? "Unsaved draft" : note.updatedLabel}</span>
            </button>
          );
        })}
        {notes.length === 0 && (
          <div className="island-empty note-empty-state">
            <h3>{searching ? "No private notes match this search." : "Your private workspace is ready."}</h3>
            {searching ? <button type="button" className="secondary-button" onClick={onClearSearch}>Clear search</button>
              : <button type="button" className="secondary-button" onClick={onCreate}>New private note</button>}
          </div>
        )}
      </div>
    </section>
  );
}
