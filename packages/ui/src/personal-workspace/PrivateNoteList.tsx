import type { PrivateNote } from "../shared/types";
import type { NoteDraft } from "./noteDraftModel";
import { Icon } from "../shared/Icon";

type PrivateNoteListProps = {
  notes: PrivateNote[];
  drafts: Record<string, NoteDraft>;
  selectedId: string;
  onSelect: (note: PrivateNote) => void;
  onClearSearch: () => void;
  searching: boolean;
};

export function PrivateNoteList({
  notes,
  drafts,
  selectedId,
  onSelect,
  onClearSearch,
  searching,
}: PrivateNoteListProps) {
  return (
    <section className="note-list-card" aria-label="Private notes">
      <header>
        <span className="meta-label">{notes.length} PRIVATE NOTES</span>
        <span>Updated</span>
      </header>
      <div className="note-list">
        {notes.map((note) => (
          <button
            type="button"
            key={note.id}
            className={note.id === selectedId ? "is-selected" : ""}
            aria-current={note.id === selectedId ? "true" : undefined}
            onClick={() => onSelect(note)}
          >
            <span className="note-row-icon"><Icon name="document" size={20} /></span>
            <span className="note-row-content">
              <span className="note-row-meta"><span><Icon name="lock" size={12} /> PRIVATE · ONLY YOU</span><span>{drafts[note.id] && (drafts[note.id].title !== note.title || drafts[note.id].body !== note.body) ? "Unsaved draft" : note.updatedLabel}</span></span>
              <strong>{drafts[note.id] ? drafts[note.id].title.trim() || "Untitled private note" : note.title}</strong>
              <span className="note-row-snippet">{(drafts[note.id]?.body ?? note.body) || "Empty private note"}</span>
            </span>
            <Icon name="arrow" size={18} />
          </button>
        ))}
        {notes.length === 0 && (
          <div className="empty-state note-empty-state">
            <strong>{searching ? "No private notes match this search." : "Your private workspace is ready."}</strong>
            {searching ? <button type="button" onClick={onClearSearch}>
              Clear search
            </button> : <p>Create your first private note to capture a thought.</p>}
          </div>
        )}
      </div>
    </section>
  );
}
