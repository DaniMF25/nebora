/** Utilidades de color para la marca de la web (D-034). */

const HEX = /^#[0-9a-f]{6}$/;

/** Normaliza un color «#RRGGBB» (en minúsculas) o devuelve null si no es válido. */
export function normalizeHex(value: string): string | null {
  const v = value.trim().toLowerCase();
  return HEX.test(v) ? v : null;
}

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** Luminancia relativa (WCAG 2.x). */
export function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

/** Relación de contraste WCAG entre dos colores (1 a 21). */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Texto legible sobre un fondo: casi negro o blanco, el de más contraste. */
export function readableOn(hex: string): string {
  return contrastRatio(hex, "#111111") >= contrastRatio(hex, "#ffffff") ? "#111111" : "#ffffff";
}

function toRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Mezcla `hex` con `target` en proporción `t` (0 = hex, 1 = target). */
export function mix(hex: string, target: string, t: number): string {
  const a = toRgb(hex);
  const b = toRgb(target);
  return `#${a
    .map((c, i) => Math.round(c + (b[i]! - c) * t))
    .map((c) => c.toString(16).padStart(2, "0"))
    .join("")}`;
}

/**
 * El color más parecido a `hex` que se lee sobre `bg` con un contraste de al
 * menos `min` (WCAG AA: 4,5 texto normal; 3 elementos gráficos y texto grande).
 * Sobre fondos oscuros se aclara; sobre claros, se oscurece (D-051).
 */
export function ensureContrast(hex: string, bg: string, min = 4.5): string {
  if (contrastRatio(hex, bg) >= min) return hex;
  const target = luminance(bg) > 0.18 ? "#000000" : "#ffffff";
  for (let step = 1; step <= 20; step++) {
    const candidate = mix(hex, target, step / 20);
    if (contrastRatio(candidate, bg) >= min) return candidate;
  }
  return target;
}

/** Variantes del color de marca para cada fondo de la web (página, portada y cabecera, pie). */
export interface BrandPalette {
  page: string;
  onPage: string;
  hero: string;
  onHero: string;
  contact: string;
}

/**
 * Variante para usar como texto sobre `bg` y, a la vez, como fondo de botón
 * con texto blanco o casi negro encima: si el texto del botón no llegara a
 * `min`, se aleja un poco más del fondo hasta que se lea.
 */
function buttonSafe(accent: string, bg: string, min = 4.5): string {
  let color = ensureContrast(accent, bg, min);
  const target = luminance(bg) > 0.18 ? "#000000" : "#ffffff";
  for (let step = 0; step < 20 && contrastRatio(readableOn(color), color) < min; step++) {
    color = mix(color, target, 0.08);
  }
  return color;
}

export function brandPalette(accent: string, bg: { page: string; hero: string; contact: string }): BrandPalette {
  const page = buttonSafe(accent, bg.page);
  const hero = buttonSafe(accent, bg.hero);
  return {
    page,
    onPage: readableOn(page),
    hero,
    onHero: readableOn(hero),
    contact: ensureContrast(accent, bg.contact),
  };
}
