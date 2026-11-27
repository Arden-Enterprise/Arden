// Glyphs from @flaticon/flaticon-uicons 3.3.1, Regular Rounded.
// Keep this mapping in sync with the pinned font.
export const iconGlyphs = {
  arrow: "\uf19b",
  check: "\uf3c8",
  chevron: "\uf155",
  close: "\uf4f6",
  document: "\uf57a",
  knowledge: "\uf274",
  "book-open": "\uf281",
  lock: "\uf8d5",
  logout: "\ufc0c",
  plus: "\ufaac",
  minus: "\uf94e",
  search: "\ufbba",
  work: "\uf2e9",
  chat: "\uf4a1",
  review: "\uf438",
  handover: "\uf5ea",
  organization: "\ufea1",
  integrations: "\ufaa8",
  sidebar: "\ufc08",
  menu: "\uf925",
  shield: "\ufbdb",
  warning: "\ufe33",
  layers: "\uf87c",
  building: "\uf303",
  people: "\ufea6",
  expand: "\uf153",
  pdf: "\uf66a",
  edit: "\ufa29",
  filter: "\uf215",
  sliders: "\ufbd1",
  "status-pending": "\uf406",
  "status-approved": "\uf3c4",
  "status-rejected": "\uf4f4",
  calendar: "\uf339",
  branch: "\uf482",
  "arrow-down": "\uf19c",
  "arrow-up": "\uf19f",
  download: "\uf591",
  "open-external": "\uf1b3",
  home: "\uf7b8",
  flag: "\uf695",
  refresh: "\ufb34",
  star: "\ufce9",
  trash: "\ufe17",
  folder: "\uf6ba",
  "folder-add": "\uf118",
  copy: "\uf4dd",
  more: "\uf927",
  move: "\uf984",
  restore: "\ufe12",
  settings: "\ufbd2",
  archive: "\uf16d",
  unarchive: "\uf800",
} as const;

export type IconName = keyof typeof iconGlyphs | "graph";

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  if (name === "graph") {
    return (
      <svg
        className="arden-icon"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.85}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        <circle cx="5.5" cy="12" r="2.5" />
        <circle cx="18.5" cy="6.5" r="2.5" />
        <circle cx="18.5" cy="17.5" r="2.5" />
        <path d="M7.9 11.1 16.1 7.4M7.9 12.9l8.2 3.7" />
      </svg>
    );
  }
  return (
    <svg
      className="arden-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <text x="12" y="12" textAnchor="middle" dominantBaseline="central">{iconGlyphs[name]}</text>
    </svg>
  );
}
