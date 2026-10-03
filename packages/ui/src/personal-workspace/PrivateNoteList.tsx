import type { PrivateNote } from "../shared/types";

type PrivateNoteListProps = {
  notes: PrivateNote[];
  selectedId: string;
  onSelect: (note: PrivateNote) => void;
  onClearSearch: () => void;
};

export function PrivateNoteList({
  notes,
  selectedId,
  onSelect,
  onClearSearch,
}: PrivateNoteListProps) {
  return (
    <section className="note-list-card" aria-label="Private notes">
      <header>
        <span className="meta-label">PRIVATE NOTES</span>
        <span>{notes.length}</span>
      </header>
      <div className="note-list">
        {notes.map((note) => (
          <button
            type="button"
            key={note.id}
            className={note.id === selectedId ? "is-selected" : ""}
            onClick={() => onSelect(note)}
          >
            <strong>{note.title}</strong>
            <span>{note.updatedLabel}</span>
            <p>{note.body || "Empty private note"}</p>
          </button>
        ))}
        {notes.length === 0 && (
          <div className="empty-state note-empty-state">
            <strong>No private notes match this search.</strong>
            <button type="button" onClick={onClearSearch}>
              Clear search
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
