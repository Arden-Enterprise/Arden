// Glyphs from @flaticon/flaticon-uicons 3.3.1, Regular Rounded.
// Keep this mapping in sync with the pinned font and preserve visible attribution.
export const iconGlyphs = {
  arrow: "\uf19b",
  check: "\uf3c8",
  chevron: "\uf155",
  close: "\uf4f6",
  document: "\uf57a",
  knowledge: "\uf274",
  lock: "\uf8d5",
  logout: "\ufc0c",
  plus: "\ufaac",
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
} as const;

export type IconName = keyof typeof iconGlyphs;

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
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
