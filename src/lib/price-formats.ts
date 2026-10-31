import type { PublicLanguage } from "./languages";
import { formatEuros } from "./money";

/** Formato de venta de un plato con su precio (D-038): «Media ración 6,00 €». */
export interface PriceFormat {
  label: string;
  priceCents: number;
}

export const MIN_FORMATS = 2;
export const MAX_FORMATS = 6;
export const MAX_FORMAT_LABEL = 40;

/**
 * Nombres habituales que se ofrecen al escribir y que la web traduce sola.
 * Un nombre propio se muestra tal cual en todos los idiomas.
 */
export const SUGGESTED_FORMATS = [
  "Tapa",
  "Media ración",
  "Ración",
  "Pincho",
  "Copa",
  "Botella",
  "Caña",
  "Jarra",
  "Pequeño",
  "Mediano",
  "Grande",
  "Unidad",
  "Media docena",
  "Docena",
] as const;

const TRANSLATIONS: Record<Exclude<PublicLanguage, "es">, Record<(typeof SUGGESTED_FORMATS)[number], string>> = {
  en: {
    Tapa: "Tapa",
    "Media ración": "Half portion",
    Ración: "Portion",
    Pincho: "Pintxo",
    Copa: "Glass",
    Botella: "Bottle",
    Caña: "Small beer",
    Jarra: "Pint",
    Pequeño: "Small",
    Mediano: "Medium",
    Grande: "Large",
    Unidad: "Each",
    "Media docena": "Half dozen",
    Docena: "Dozen",
  },
  fr: {
    Tapa: "Tapa",
    "Media ración": "Demi-portion",
    Ración: "Portion",
    Pincho: "Pintxo",
    Copa: "Verre",
    Botella: "Bouteille",
    Caña: "Demi",
    Jarra: "Pinte",
    Pequeño: "Petit",
    Mediano: "Moyen",
    Grande: "Grand",
    Unidad: "Pièce",
    "Media docena": "Demi-douzaine",
    Docena: "Douzaine",
  },
  de: {
    Tapa: "Tapa",
    "Media ración": "Halbe Portion",
    Ración: "Portion",
    Pincho: "Pintxo",
    Copa: "Glas",
    Botella: "Flasche",
    Caña: "Kleines Bier",
    Jarra: "Krug",
    Pequeño: "Klein",
    Mediano: "Mittel",
    Grande: "Groß",
    Unidad: "Stück",
    "Media docena": "Halbes Dutzend",
    Docena: "Dutzend",
  },
  it: {
    Tapa: "Tapa",
    "Media ración": "Mezza porzione",
    Ración: "Porzione",
    Pincho: "Pintxo",
    Copa: "Calice",
    Botella: "Bottiglia",
    Caña: "Birra piccola",
    Jarra: "Boccale",
    Pequeño: "Piccolo",
    Mediano: "Medio",
    Grande: "Grande",
    Unidad: "Pezzo",
    "Media docena": "Mezza dozzina",
    Docena: "Dozzina",
  },
  pt: {
    Tapa: "Tapa",
    "Media ración": "Meia dose",
    Ración: "Dose",
    Pincho: "Pintxo",
    Copa: "Copo",
    Botella: "Garrafa",
    Caña: "Imperial",
    Jarra: "Caneca",
    Pequeño: "Pequeno",
    Mediano: "Médio",
    Grande: "Grande",
    Unidad: "Unidade",
    "Media docena": "Meia dúzia",
    Docena: "Dúzia",
  },
  ca: {
    Tapa: "Tapa",
    "Media ración": "Mitja ració",
    Ración: "Ració",
    Pincho: "Pintxo",
    Copa: "Copa",
    Botella: "Ampolla",
    Caña: "Canya",
    Jarra: "Gerra",
    Pequeño: "Petit",
    Mediano: "Mitjà",
    Grande: "Gran",
    Unidad: "Unitat",
    "Media docena": "Mitja dotzena",
    Docena: "Dotzena",
  },
};

const SUGGESTED_BY_KEY = new Map(SUGGESTED_FORMATS.map((s) => [s.toLocaleLowerCase("es"), s]));

/** Nombre del formato en `lang`: los habituales se traducen; los propios, tal cual. */
export function formatLabel(label: string, lang: PublicLanguage): string {
  if (lang === "es") return label;
  const suggested = SUGGESTED_BY_KEY.get(label.trim().toLocaleLowerCase("es"));
  return suggested ? TRANSLATIONS[lang][suggested] : label;
}

/** Precio en una línea para el panel: «9,00 €» o «Media ración 6,00 € · Ración 10,00 €». */
export function priceSummary(priceCents: number, formats: readonly PriceFormat[] | null): string {
  return formats ? formats.map((f) => `${f.label} ${formatEuros(f.priceCents)}`).join(" · ") : formatEuros(priceCents);
}

/** Opción de un desplegable de productos: «Croquetas (9,00 €)» o «Calamares (desde 6,00 €)». */
export function productOptionLabel(p: { name: string; priceCents: number; formats: readonly PriceFormat[] | null }) {
  return `${p.name} (${p.formats ? "desde " : ""}${formatEuros(p.priceCents)})`;
}
