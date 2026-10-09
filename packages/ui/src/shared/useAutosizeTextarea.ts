import { useLayoutEffect, useRef } from "react";

export function useAutosizeTextarea(value: string, minimumHeight: number) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const textarea = ref.current;
    if (!textarea) return;
    let active = true;
    const resize = () => {
      textarea.style.height = "auto";
      const style = getComputedStyle(textarea);
      const borders = Number.parseFloat(style.borderTopWidth) + Number.parseFloat(style.borderBottomWidth);
      textarea.style.height = `${Math.max(minimumHeight, textarea.scrollHeight + borders + 1)}px`;
    };
    resize();
    void document.fonts.ready.then(() => { if (active) resize(); });
    let previousWidth = textarea.getBoundingClientRect().width;
    const observer = new ResizeObserver(() => {
      const width = textarea.getBoundingClientRect().width;
      if (width !== previousWidth) { previousWidth = width; resize(); }
    });
    observer.observe(textarea);
    return () => { active = false; observer.disconnect(); };
  }, [value, minimumHeight]);

  return ref;
}
