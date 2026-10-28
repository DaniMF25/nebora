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
