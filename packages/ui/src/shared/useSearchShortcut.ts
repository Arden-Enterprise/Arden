import { useEffect, useRef } from "react";

export function useSearchShortcut(onReveal?: () => void, enabled = true) {
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!enabled) return;
    const focusSearch = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        onReveal?.();
        requestAnimationFrame(() => searchRef.current?.focus());
      }
    };

    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, [onReveal, enabled]);

  return searchRef;
}
