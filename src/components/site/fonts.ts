import {
  Archivo_Narrow,
  Audiowide,
  Bebas_Neue,
  Caveat,
  Cinzel,
  Cormorant_Garamond,
  Courier_Prime,
  Crimson_Text,
  Dancing_Script,
  DM_Sans,
  DM_Serif_Display,
  EB_Garamond,
  Exo_2,
  IBM_Plex_Sans,
  Inter,
  Kalam,
  Lato,
  Libre_Baskerville,
  Lora,
  Manrope,
  Merriweather,
  Michroma,
  Montserrat,
  Orbitron,
  Oswald,
  Playfair_Display,
  Poppins,
  Raleway,
  Roboto_Condensed,
  Satisfy,
  Space_Grotesk,
  Syncopate,
  Work_Sans,
} from "next/font/google";
import type { MenuTheme } from "@/lib/menu-snapshot";
import { resolvePairing, type FontKey } from "@/lib/site-fonts";

// Fuentes alojadas por la propia aplicación (next/font las descarga al
// compilar): el visitante no hace peticiones a Google. Sin precarga, el
// navegador solo descarga las que usa la página. next/font exige opciones
// literales en cada llamada.
const inter = Inter({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-inter" });
const orbitron = Orbitron({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-orbitron" });
const caveat = Caveat({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-caveat" });
const oswald = Oswald({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-oswald" });
const courier = Courier_Prime({ subsets: ["latin"], display: "swap", preload: false, weight: ["400", "700"], variable: "--font-courier" });
const baskerville = Libre_Baskerville({ subsets: ["latin"], display: "swap", preload: false, weight: ["400", "700"], variable: "--font-baskerville" });
const cormorant = Cormorant_Garamond({ subsets: ["latin"], display: "swap", preload: false, weight: ["400", "500", "600"], variable: "--font-cormorant" });
const montserrat = Montserrat({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-montserrat" });
const playfair = Playfair_Display({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-playfair" });
const lato = Lato({ subsets: ["latin"], display: "swap", preload: false, weight: ["400", "700"], variable: "--font-lato" });
const cinzel = Cinzel({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-cinzel" });
const raleway = Raleway({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-raleway" });
const ebgaramond = EB_Garamond({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-ebgaramond" });
const worksans = Work_Sans({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-worksans" });
const dancing = Dancing_Script({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-dancing" });
const bebas = Bebas_Neue({ subsets: ["latin"], display: "swap", preload: false, weight: "400", variable: "--font-bebas" });
const lora = Lora({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-lora" });
const kalam = Kalam({ subsets: ["latin"], display: "swap", preload: false, weight: ["400", "700"], variable: "--font-kalam" });
const archivonarrow = Archivo_Narrow({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-archivonarrow" });
const crimson = Crimson_Text({ subsets: ["latin"], display: "swap", preload: false, weight: ["400", "600", "700"], variable: "--font-crimson" });
const satisfy = Satisfy({ subsets: ["latin"], display: "swap", preload: false, weight: "400", variable: "--font-satisfy" });
const robotocondensed = Roboto_Condensed({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-robotocondensed" });
const merriweather = Merriweather({ subsets: ["latin"], display: "swap", preload: false, weight: ["400", "700"], variable: "--font-merriweather" });
const audiowide = Audiowide({ subsets: ["latin"], display: "swap", preload: false, weight: "400", variable: "--font-audiowide" });
const exo2 = Exo_2({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-exo2" });
const michroma = Michroma({ subsets: ["latin"], display: "swap", preload: false, weight: "400", variable: "--font-michroma" });
const spacegrotesk = Space_Grotesk({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-spacegrotesk" });
const syncopate = Syncopate({ subsets: ["latin"], display: "swap", preload: false, weight: ["400", "700"], variable: "--font-syncopate" });
const manrope = Manrope({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-manrope" });
const poppins = Poppins({ subsets: ["latin"], display: "swap", preload: false, weight: ["400", "500", "600", "700"], variable: "--font-poppins" });
const plexsans = IBM_Plex_Sans({ subsets: ["latin"], display: "swap", preload: false, weight: ["400", "500", "600"], variable: "--font-plexsans" });
const dmserif = DM_Serif_Display({ subsets: ["latin"], display: "swap", preload: false, weight: "400", variable: "--font-dmserif" });
const dmsans = DM_Sans({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-dmsans" });

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
