import type { HighlightIcon } from "@/lib/site";

type IconName = HighlightIcon | "pin" | "phone" | "clock" | "instagram" | "whatsapp" | "home" | "menu" | "calendar" | "arrow";

// Trazos propios (sin dependencias), heredan el color del texto.
const PATHS: Record<IconName, React.ReactNode> = {
  chef: (
    <>
      <path d="M7 14h10v6H7z" />
      <path d="M7 14a4 4 0 1 1 1.5-7.7A4.5 4.5 0 0 1 16.5 6 4 4 0 1 1 17 14" />
      <path d="M7 17h10" />
    </>
  ),
  leaf: (
    <>
      <path d="M5 19c0-8 5-13 14-14 0 9-5 14-13 14" />
      <path d="M5 19 13 11" />
    </>
  ),
  fish: (
    <>
      <path d="M3 12c3-4 7-6 11-6 3 0 5 2 7 6-2 4-4 6-7 6-4 0-8-2-11-6Z" />
      <path d="M3 12 1 8m2 4-2 4" />
      <circle cx="16" cy="11" r="0.8" />
    </>
  ),
  wine: (
    <>
      <path d="M8 3h8l-.5 6a3.5 3.5 0 0 1-7 0z" />
      <path d="M12 12.5V20m-4 0h8" />
    </>
  ),
  fire: <path d="M12 21c-4 0-6-2.6-6-6 0-4 3-6 4-10 2 2 3 4 3 6 1-1 1.6-2 2-3 2 2 3 4.5 3 7 0 3.4-2 6-6 6Z" />,
  star: <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" />,
  heart: <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  pin: (
    <>
      <path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21Z" />
      <circle cx="12" cy="9.5" r="2.5" />
    </>
  ),
  phone: (
    <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" />
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  instagram: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="0.6" />
    </>
  ),
  whatsapp: (
    <>
      <path d="M4 20l1.3-4A8.5 8.5 0 1 1 8.3 19z" />
      <path d="M9 9c0 3 3 6 6 6l1-1.5-2-1-1 1c-1-.5-2-1.5-2.5-2.5l1-1-1-2z" />
    </>
  ),
  home: (
    <>
      <path d="M3 11 12 4l9 7" />
      <path d="M5 10v10h14V10" />
    </>
  ),
  menu: (
    <>
      <rect x="5" y="3" width="14" height="18" rx="2" />
      <path d="M9 8h6m-6 4h6m-6 4h4" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4m8-4v4" />
    </>
  ),
  arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
};

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {PATHS[name]}
    </svg>
  );
}
