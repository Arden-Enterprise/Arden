import { forwardRef } from "react";
import { Icon } from "./Icon";

type SearchFieldProps = {
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  shortcutHint?: string;
};

export const SearchField = forwardRef<HTMLInputElement, SearchFieldProps>(
  function SearchField(
    { value, placeholder, onChange, shortcutHint = "Ctrl K" },
    ref,
  ) {
    return (
      <div className="workspace-search">
        <Icon name="search" size={16} />
        <input
          ref={ref}
          type="search"
          aria-label={placeholder.replace(/…$/, "")}
          aria-keyshortcuts="Control+k Meta+k"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
        />
        {value ? (
          <button
            type="button"
            onClick={(event) => {
              onChange("");
              event.currentTarget.parentElement?.querySelector("input")?.focus();
            }}
            aria-label="Clear search"
          >
            <Icon name="close" size={14} />
          </button>
        ) : (
          <kbd aria-hidden="true">{shortcutHint}</kbd>
        )}
      </div>
    );
  },
);
