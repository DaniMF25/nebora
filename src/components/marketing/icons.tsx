/** Iconos de la web pública (trazo, heredan el color). Decorativos. */
const PATHS = {
  menu: "M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4Zm0 13a3 3 0 0 1 3-3h11M9 8h6M9 11h4",
  web: "M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18Z",
  calendar: "M4 6h16v14H4V6Zm0 4h16M8 3v4m8-4v4m-8 7h3",
  team: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm-6 9a6 6 0 0 1 12 0m1-9a3 3 0 1 0 0-6m2 15a5 5 0 0 0-3-4.6",
  box: "M3 7.5 12 3l9 4.5v9L12 21l-9-4.5v-9Zm0 0L12 12m0 0 9-4.5M12 12v9",
  truck: "M3 6h11v10H3V6Zm11 4h4l3 3v3h-7v-6ZM7 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm10 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z",
  chart: "M4 20V4m0 16h16M8 16v-4m4 4V8m4 8v-6",
  globe: "M4 5h7m-3.5 0v2m3 0c-.8 3.3-3.3 6-6.5 7.5M6 10c1 1.8 2.6 3.3 4.5 4.3M12 20l4-9 4 9m-6.8-3h5.6",
  check: "m5 12.5 4.2 4.2L19 7",
} as const;

export type MarketingIconName = keyof typeof PATHS;

export function MarketingIcon({ name, className }: { name: MarketingIconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={name === "check" ? 2.4 : 1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
