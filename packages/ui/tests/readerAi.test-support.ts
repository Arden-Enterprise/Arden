import { fireEvent, screen } from "@testing-library/react";

/** Selects a reader AI task the way a member does: its tab when shown, otherwise Arden AI and the task choice. */
export function chooseReaderTask(task: "summary" | "question") {
  const tab = screen.queryByRole("tab", { name: task === "summary" ? "Summary" : "Ask" });
  if (tab) { fireEvent.click(tab); return; }
  const launcherName = task === "summary" ? /^Summarize/ : /^Ask a question/;
  if (!screen.queryByRole("button", { name: launcherName })) fireEvent.click(screen.getByRole("button", { name: "Arden AI" }));
  fireEvent.click(screen.getByRole("button", { name: launcherName }));
}
