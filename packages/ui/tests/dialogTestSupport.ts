/** jsdom has no native dialog implementation; browser focus/top-layer behavior needs browser checks. */
export function installTestDialogs(): () => void {
  const prototype = HTMLDialogElement.prototype;
  const previousShow = Object.getOwnPropertyDescriptor(prototype, "showModal");
  const previousClose = Object.getOwnPropertyDescriptor(prototype, "close");
  Object.defineProperties(prototype, {
    showModal: { configurable: true, value(this: HTMLDialogElement) { this.setAttribute("open", ""); } },
    close: { configurable: true, value(this: HTMLDialogElement) { this.removeAttribute("open"); } },
  });
  return () => {
    if (previousShow) Object.defineProperty(prototype, "showModal", previousShow); else Reflect.deleteProperty(prototype, "showModal");
    if (previousClose) Object.defineProperty(prototype, "close", previousClose); else Reflect.deleteProperty(prototype, "close");
  };
}
