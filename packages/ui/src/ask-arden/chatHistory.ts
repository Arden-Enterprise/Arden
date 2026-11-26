import type { AiConversationSummary } from "../shared/api-client";

export type ChatHistoryItem = AiConversationSummary & { when: string };
export type ChatHistoryGroup = { label: string; items: ChatHistoryItem[] };

const dayMs = 86_400_000;
const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

/**
 * Groups the owner's saved chats (newest first, as the server returns them) by their last update in the
 * viewer's local time. Only the title and update time exist; nothing else is inferred.
 */
export function groupChatHistory(items: readonly AiConversationSummary[], now: Date, query = ""): ChatHistoryGroup[] {
  const needle = query.trim().toLocaleLowerCase();
  const today = startOfDay(now);
  const time = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });
  const weekday = new Intl.DateTimeFormat(undefined, { weekday: "short" });
  const day = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
  const dayYear = new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" });
  const groups: ChatHistoryGroup[] = [
    { label: "Today", items: [] }, { label: "Yesterday", items: [] },
    { label: "Previous 7 days", items: [] }, { label: "Older", items: [] },
  ];
  for (const item of items) {
    if (needle && !item.title.toLocaleLowerCase().includes(needle)) continue;
    const updated = new Date(item.updatedAt);
    if (Number.isNaN(updated.getTime())) { groups[3]!.items.push({ ...item, when: "" }); continue; }
    const age = Math.round((today - startOfDay(updated)) / dayMs);
    if (age <= 0) groups[0]!.items.push({ ...item, when: time.format(updated) });
    else if (age === 1) groups[1]!.items.push({ ...item, when: weekday.format(updated) });
    else if (age < 7) groups[2]!.items.push({ ...item, when: weekday.format(updated) });
    else groups[3]!.items.push({ ...item,
      when: (updated.getFullYear() === now.getFullYear() ? day : dayYear).format(updated) });
  }
  return groups.filter((group) => group.items.length);
}
