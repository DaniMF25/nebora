/**
 * Fondos decorativos de la web según el tipo de cocina (D-050). Dibujos
 * propios de trazo fino (sin imágenes de terceros) en una losa de 240×240 que
 * se repite. La web los pinta como máscara con el color del texto del estilo
 * y muy poca opacidad: decoran sin cambiar el fondo ni restar legibilidad.
 */

export const SITE_DECORS = ["seafood", "grill", "burger", "healthy", "italian", "cafe"] as const;
export type SiteDecor = (typeof SITE_DECORS)[number];

export function isSiteDecor(value: unknown): value is SiteDecor {
  return typeof value === "string" && (SITE_DECORS as readonly string[]).includes(value);
}

// Motivos sueltos, cada uno dibujado en una caja de unos 48×48 desde (0, 0).
const MOTIFS = {
  fish: `<path d="M4 24c8-11 24-11 32 0c-8 11-24 11-32 0z"/><path d="M36 24l10-8v16z"/><circle cx="13" cy="21" r="1.5"/><path d="M22 17c2 4 2 10 0 14"/>`,
  shrimp: `<path d="M10 12c14-6 30 2 30 16c0 10-9 14-16 10"/><path d="M24 38c-4-2-5-6-3-9"/><path d="M18 15l3 6M26 13l1 7M33 16l-2 6M38 23l-5 3"/><path d="M10 12c-4-4-6-8-5-12M12 13c-6-1-9-3-11-7"/>`,
  shell: `<path d="M24 44L6 22a20 20 0 0 1 36 0z"/><path d="M24 44L13 12M24 44V9M24 44l11-32M24 44L7 20M24 44l17-24"/>`,
  steak: `<path d="M8 20c0-10 12-14 22-12c10 2 14 10 12 18c-2 10-12 16-22 14c-8-2-12-10-12-20z"/><path d="M15 16h14M22 16v20"/>`,
  grill: `<rect x="4" y="10" width="40" height="28" rx="4"/><path d="M14 10v28M24 10v28M34 10v28M4 24h40"/>`,
  flame: `<path d="M24 44c-10 0-15-7-14-15c1-7 7-10 6-18c6 3 9 8 9 13c2-2 3-5 3-7c5 4 8 9 8 14c0 8-5 13-12 13z"/>`,
  burger: `<path d="M6 22c0-10 8-16 18-16s18 6 18 16z"/><path d="M4 28h40M6 34c6 2 12-2 18 0s12 2 18 0"/><path d="M6 38h36c0 4-2 6-6 6H12c-4 0-6-2-6-6z"/><path d="M16 13l1 1M24 11l1 1M31 14l1 1"/>`,
  fries: `<path d="M10 22l4 24h20l4-24z"/><path d="M14 22l-2-16M20 22l1-18M26 22l-1-16M32 22l3-15M38 22l1-12"/>`,
  cup: `<path d="M12 14h24l-3 32H15z"/><path d="M10 14h28M24 14l4-12h6"/>`,
  leaf: `<path d="M6 42C6 18 22 6 42 6c0 22-14 36-36 36z"/><path d="M6 42L30 18M16 32h8M22 26v-8"/>`,
  avocado: `<path d="M24 4c-6 0-8 8-12 16c-4 8-4 24 12 24s16-16 12-24c-4-8-6-16-12-16z"/><circle cx="24" cy="30" r="7"/>`,
  apple: `<path d="M24 14c-6-4-18-2-18 12c0 12 8 20 18 16c10 4 18-4 18-16c0-14-12-16-18-12z"/><path d="M24 14c0-6 2-9 6-10M24 12c-4-6-10-6-12-4c4 4 8 4 12 4z"/>`,
  pizza: `<path d="M24 46L4 8c12-6 28-6 40 0z"/><path d="M6 13c11-5 25-5 36 0"/><circle cx="22" cy="20" r="3"/><circle cx="30" cy="28" r="2.5"/><circle cx="18" cy="30" r="2"/>`,
  tomato: `<circle cx="24" cy="27" r="17"/><path d="M24 10l-4-6M24 10l5-5M24 10l-8 2M24 10l8 2"/>`,
  basil: `<path d="M24 46V22"/><path d="M24 30c-12 0-18-8-16-16c10 0 16 6 16 16zM24 24c12 0 18-8 16-16c-10 0-16 6-16 16z"/>`,
  coffee: `<path d="M8 18h28v14a12 12 0 0 1-12 12h-4A12 12 0 0 1 8 32z"/><path d="M36 22h4a5 5 0 0 1 0 10h-5"/><path d="M16 4c-3 4 3 6 0 10M24 4c-3 4 3 6 0 10"/>`,
  croissant: `<path d="M4 34c4-14 14-22 20-22s16 8 20 22c-6-4-10-4-12-2c-2-6-6-8-8-8s-6 2-8 8c-2-2-6-2-12 2z"/><path d="M18 20l4 10M30 20l-4 10"/>`,
  bean: `<ellipse cx="24" cy="24" rx="12" ry="17" transform="rotate(30 24 24)"/><path d="M17 12c8 6 6 18 14 24"/>`,
} as const;

type Motif = keyof typeof MOTIFS;

/** Losa de 240×240 con los motivos repartidos y algo girados para que no parezca una cuadrícula. */
function tile(motifs: [Motif, Motif, Motif]): string {
  const [a, b, c] = motifs;
  const place = (m: Motif, x: number, y: number, rotate: number, scale = 1) =>
    `<g transform="translate(${x} ${y}) rotate(${rotate} 24 24) scale(${scale})">${MOTIFS[m]}</g>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 240 240" fill="none" ` +
    `stroke="#000" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">` +
    place(a, 18, 20, -12) +
    place(b, 140, 46, 18, 0.9) +
    place(c, 70, 150, 8, 0.95) +
    place(a, 172, 168, 24, 0.75) +
    `</svg>`
  );
}

export const DECOR_INFO: Record<SiteDecor, { name: string; description: string; svg: string }> = {
  seafood: {
    name: "Mariscos y pescado",
    description: "Peces, gambas y conchas",
    svg: tile(["fish", "shrimp", "shell"]),
  },
  grill: {
    name: "Carnes y parrilla",
    description: "Filetes, parrilla y brasas",
    svg: tile(["steak", "grill", "flame"]),
  },
  burger: {
    name: "Hamburguesería",
    description: "Hamburguesas, patatas y refrescos",
    svg: tile(["burger", "fries", "cup"]),
  },
  healthy: { name: "Saludable", description: "Hojas, aguacates y fruta", svg: tile(["leaf", "avocado", "apple"]) },
  italian: { name: "Italiano", description: "Pizza, tomates y albahaca", svg: tile(["pizza", "tomato", "basil"]) },
  cafe: {
    name: "Cafetería y brunch",
    description: "Café, cruasanes y granos",
    svg: tile(["coffee", "croissant", "bean"]),
  },
};

/** Valor CSS `url(...)` del fondo, para usarlo como máscara. */
export function decorCssUrl(decor: SiteDecor): string {
  return `url("data:image/svg+xml,${encodeURIComponent(DECOR_INFO[decor].svg)}")`;
}
