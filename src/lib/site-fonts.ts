import type { MenuTheme } from "./menu-snapshot";

/**
 * Combinaciones tipográficas de cada estilo de la web (D-034). La primera de
 * cada estilo es la original. `display` se usa en titulares (y en el nombre
 * del local salvo que haya `brand`), `body` en el texto. Las fuentes las
 * aloja la aplicación (next/font, components/site/fonts.ts).
 */
export const FONT_KEYS = [
  "inter",
  "orbitron",
  "caveat",
  "oswald",
  "courier",
  "baskerville",
  "cormorant",
  "montserrat",
  "playfair",
  "lato",
  "cinzel",
  "raleway",
  "ebgaramond",
  "worksans",
  "dancing",
  "bebas",
  "lora",
  "kalam",
  "archivonarrow",
  "crimson",
  "satisfy",
  "robotocondensed",
  "merriweather",
  "audiowide",
  "exo2",
  "michroma",
  "spacegrotesk",
  "syncopate",
  "manrope",
  "poppins",
  "plexsans",
  "dmserif",
  "dmsans",
] as const;
export type FontKey = (typeof FONT_KEYS)[number];

const SERIF = "Georgia, serif";
const SANS = "system-ui, sans-serif";
const f = (key: FontKey, fallback: string) => `var(--font-${key}), ${fallback}`;

export interface FontPairing {
  id: string;
  theme: MenuTheme;
  name: string;
  /** Fuentes en lenguaje llano para el panel. */
  description: string;
  display: string;
  body: string;
  /** Solo en estilos con letra propia para el nombre (Clásico). */
  brand?: string;
  fonts: FontKey[];
}

export const FONT_PAIRINGS: readonly FontPairing[] = [
  // Mediterráneo: serif elegante en titulares, sin serifa limpia en el texto.
  { id: "med-cormorant", theme: "mediterraneo", name: "Original", description: "Cormorant Garamond y Montserrat", display: f("cormorant", SERIF), body: f("montserrat", SANS), fonts: ["cormorant", "montserrat"] },
  { id: "med-playfair", theme: "mediterraneo", name: "Editorial", description: "Playfair Display y Lato", display: f("playfair", SERIF), body: f("lato", SANS), fonts: ["playfair", "lato"] },
  { id: "med-cinzel", theme: "mediterraneo", name: "Clásica romana", description: "Cinzel y Raleway", display: f("cinzel", SERIF), body: f("raleway", SANS), fonts: ["cinzel", "raleway"] },
  { id: "med-garamond", theme: "mediterraneo", name: "Literaria", description: "EB Garamond y Work Sans", display: f("ebgaramond", SERIF), body: f("worksans", SANS), fonts: ["ebgaramond", "worksans"] },
  // Clásico: manuscrita para el nombre, rotulada para titulares, serif para el texto.
  { id: "cla-caveat", theme: "clasico", name: "Original", description: "Caveat, Oswald y Libre Baskerville", brand: f("caveat", "cursive"), display: f("oswald", "'Arial Narrow', sans-serif"), body: f("baskerville", SERIF), fonts: ["caveat", "oswald", "baskerville", "courier"] },
  { id: "cla-dancing", theme: "clasico", name: "Bodega", description: "Dancing Script, Bebas Neue y Lora", brand: f("dancing", "cursive"), display: f("bebas", "'Arial Narrow', sans-serif"), body: f("lora", SERIF), fonts: ["dancing", "bebas", "lora", "courier"] },
  { id: "cla-kalam", theme: "clasico", name: "Pizarra", description: "Kalam, Archivo Narrow y Crimson Text", brand: f("kalam", "cursive"), display: f("archivonarrow", "'Arial Narrow', sans-serif"), body: f("crimson", SERIF), fonts: ["kalam", "archivonarrow", "crimson", "courier"] },
  { id: "cla-satisfy", theme: "clasico", name: "Casa de comidas", description: "Satisfy, Roboto Condensed y Merriweather", brand: f("satisfy", "cursive"), display: f("robotocondensed", "'Arial Narrow', sans-serif"), body: f("merriweather", SERIF), fonts: ["satisfy", "robotocondensed", "merriweather", "courier"] },
  // Futurista: geométrica en titulares, sin serifa técnica en el texto.
  { id: "fut-orbitron", theme: "futurista", name: "Original", description: "Orbitron e Inter", display: f("orbitron", SANS), body: f("inter", SANS), fonts: ["orbitron", "inter"] },
  { id: "fut-audiowide", theme: "futurista", name: "Neón", description: "Audiowide y Exo 2", display: f("audiowide", SANS), body: f("exo2", SANS), fonts: ["audiowide", "exo2"] },
  { id: "fut-michroma", theme: "futurista", name: "Laboratorio", description: "Michroma y Space Grotesk", display: f("michroma", SANS), body: f("spacegrotesk", SANS), fonts: ["michroma", "spacegrotesk"] },
  { id: "fut-syncopate", theme: "futurista", name: "Minimal", description: "Syncopate y Manrope", display: f("syncopate", SANS), body: f("manrope", SANS), fonts: ["syncopate", "manrope"] },
  // Moderno: sin serifa neutra, o un titular con carácter.
  { id: "mod-inter", theme: "moderno", name: "Original", description: "Inter", display: f("inter", SANS), body: f("inter", SANS), fonts: ["inter"] },
  { id: "mod-poppins", theme: "moderno", name: "Redonda", description: "Poppins e Inter", display: f("poppins", SANS), body: f("inter", SANS), fonts: ["poppins", "inter"] },
  { id: "mod-grotesk", theme: "moderno", name: "Técnica", description: "Space Grotesk e IBM Plex Sans", display: f("spacegrotesk", SANS), body: f("plexsans", SANS), fonts: ["spacegrotesk", "plexsans"] },
  { id: "mod-dmserif", theme: "moderno", name: "Revista", description: "DM Serif Display y DM Sans", display: f("dmserif", SERIF), body: f("dmsans", SANS), fonts: ["dmserif", "dmsans"] },
];

export const FONT_PAIRING_IDS = FONT_PAIRINGS.map((p) => p.id);

export function pairingsFor(theme: MenuTheme): FontPairing[] {
  return FONT_PAIRINGS.filter((p) => p.theme === theme);
}

/** Combinación elegida si es de ese estilo; si no (o ninguna), la original del estilo. */
export function resolvePairing(theme: MenuTheme, id: string | null | undefined): FontPairing {
  const options = pairingsFor(theme);
  return options.find((p) => p.id === id) ?? options[0]!;
}

/** Variables CSS de la web que cambia la combinación (las lee site.module.css). */
export function pairingStyle(p: FontPairing): Record<string, string> {
  return {
    "--s-font-display": p.display,
    "--s-font-body": p.body,
    ...(p.brand
      ? { "--s-font-brand": p.brand, "--s-font-section": p.brand, "--s-font-card": p.body }
      : {}),
  };
}
