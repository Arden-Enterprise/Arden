import { useId, useMemo, useState } from "react";
import { Icon } from "../shared/Icon";
import type { KnowledgeAudienceOption } from "./audience-options";
import type { ReaderChoices } from "./readerSelection";

const sectionLabels: Record<keyof ReaderChoices, string> = { organization: "ORGANIZATION", departments: "DEPARTMENT", groups: "GROUPS" };

function readerKindLabel(audience: KnowledgeAudienceOption): string {
  return audience.kind === "ORGANIZATION_ALL" ? "Everyone in the organization"
    : audience.kind === "DEPARTMENT_ALL" ? "Everyone in the department" : "Audience group";
}

/**
 * One search field for everyone who may read the publication (organization, department, groups),
 * with the chosen readers listed below. It only reports choices; scope and validation stay with the caller.
 */
export function ReaderPicker({ choices, selectedIds, audiences, disabled, departmentHint, onAdd, onRemove }: {
  choices: ReaderChoices;
  selectedIds: readonly string[];
  audiences: readonly KnowledgeAudienceOption[];
  disabled: boolean;
  /** Shown when no department audience can be offered yet. */
  departmentHint?: string;
  onAdd: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const inputId = useId();
  const listId = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const search = query.trim().toLocaleLowerCase();

  const sections = useMemo(() => (Object.keys(choices) as Array<keyof ReaderChoices>).map((key) => ({
    key, label: sectionLabels[key],
    options: choices[key].filter((audience) => !selectedIds.includes(audience.id) && audience.name.toLocaleLowerCase().includes(search)),
  })).filter((section) => section.options.length > 0), [choices, selectedIds, search]);
  const flat = sections.flatMap((section) => section.options);
  const active = flat[Math.min(activeIndex, flat.length - 1)];
  const optionId = (id: string) => `${listId}-${id}`;

  const choose = (id: string) => { onAdd(id); setQuery(""); setActiveIndex(0); };
  const selected = selectedIds.map((id) => audiences.find((audience) => audience.id === id))
    .filter((audience): audience is KnowledgeAudienceOption => Boolean(audience));

  return <div className="reader-picker">
    <div className="reader-picker-field">
      <label htmlFor={inputId} className="sr-only">Add a reader: organization, department or group</label>
      <Icon name="search" size={14} />
      <input id={inputId} type="text" role="combobox" autoComplete="off" disabled={disabled} value={query} placeholder="Add organization, department or group…"
        aria-expanded={open && flat.length > 0} aria-controls={listId} aria-autocomplete="list"
        aria-activedescendant={open && active ? optionId(active.id) : undefined}
        onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
        onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); setOpen(true); }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") { event.preventDefault(); setOpen(true); setActiveIndex((index) => Math.min(index + 1, flat.length - 1)); }
          else if (event.key === "ArrowUp") { event.preventDefault(); setActiveIndex((index) => Math.max(index - 1, 0)); }
          else if (event.key === "Enter" && open && active) { event.preventDefault(); choose(active.id); }
          else if (event.key === "Escape" && open) { event.stopPropagation(); setOpen(false); }
        }} />
    </div>
    {open && !disabled && <div id={listId} role="listbox" aria-label="Available readers" className="reader-picker-list">
      {sections.length ? sections.map((section) => <div key={section.key} role="group" aria-label={section.label}>
        <div className="reader-picker-section" aria-hidden="true">{section.label}</div>
        {section.options.map((audience) => <div key={audience.id} id={optionId(audience.id)} role="option" aria-selected={active?.id === audience.id}
          className={`reader-picker-option${active?.id === audience.id ? " is-active" : ""}`}
          onMouseDown={(event) => event.preventDefault()} onClick={() => choose(audience.id)}>
          <Icon name={audience.kind === "ORGANIZATION_ALL" ? "building" : "people"} size={14} />
          <span><strong>{audience.name}</strong><small>{readerKindLabel(audience)}</small></span>
        </div>)}
      </div>) : <p className="reader-picker-empty">{search ? "No matching audience you can target." : "Every available audience is already added."}</p>}
      {departmentHint && <p className="reader-picker-empty">{departmentHint}</p>}
    </div>}
    {selected.length ? <ul className="reader-picker-selected" aria-label="Readers">
      {selected.map((audience) => <li key={audience.id}>
        <span className="island-tile" aria-hidden="true"><Icon name={audience.kind === "ORGANIZATION_ALL" ? "building" : "people"} size={14} /></span>
        <span><strong>{audience.name}</strong><small>{readerKindLabel(audience)}</small></span>
        <button type="button" className="island-icon-button" disabled={disabled} aria-label={`Remove ${audience.name}`} onClick={() => onRemove(audience.id)}><Icon name="close" size={12} /></button>
      </li>)}
    </ul> : <p className="island-meta">No readers yet. Add at least one audience before submitting.</p>}
  </div>;
}
