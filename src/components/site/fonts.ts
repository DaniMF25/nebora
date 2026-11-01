import {
  archivonarrow,
  audiowide,
  baskerville,
  bebas,
  caveat,
  cinzel,
  cormorant,
  courier,
  crimson,
  dancing,
  dmsans,
  dmserif,
  ebgaramond,
  exo2,
  inter,
  kalam,
  lato,
  lora,
  manrope,
  merriweather,
  michroma,
  montserrat,
  orbitron,
  oswald,
  playfair,
  plexsans,
  poppins,
  raleway,
  robotocondensed,
  satisfy,
  spacegrotesk,
  syncopate,
  worksans,
} from "@/fonts";
import type { MenuTheme } from "@/lib/menu-snapshot";
import { resolvePairing, type FontKey } from "@/lib/site-fonts";

// Fuentes alojadas en el repositorio (src/fonts, D-043): ni la compilación ni
// el visitante hacen peticiones a Google. Sin precarga, el navegador solo
// descarga las que usa la página.

const FONTS: Record<FontKey, { variable: string }> = {
  inter,
  orbitron,
  caveat,
  oswald,
  courier,
  baskerville,
  cormorant,
  montserrat,
  playfair,
  lato,
  cinzel,
  raleway,
  ebgaramond,
  worksans,
  dancing,
  bebas,
  lora,
  kalam,
  archivonarrow,
  crimson,
  satisfy,
  robotocondensed,
  merriweather,
  audiowide,
  exo2,
  michroma,
  spacegrotesk,
  syncopate,
  manrope,
  poppins,
  plexsans,
  dmserif,
  dmsans,
};

/** Clases que declaran las variables CSS de unas fuentes. */
export function fontClasses(keys: readonly FontKey[]): string {
  return [...new Set(keys)].map((k) => FONTS[k].variable).join(" ");
}

/**
 * Clases de las fuentes del tema con su combinación tipográfica (la original
 * si no se indica). Incluye siempre las de la combinación original, que el
 * CSS del tema usa como valores por defecto.
 */
export function themeFontClasses(theme: MenuTheme, pairingId?: string | null): string {
  const original = resolvePairing(theme, null);
  const chosen = resolvePairing(theme, pairingId);
  return fontClasses([...original.fonts, ...chosen.fonts]);
}
