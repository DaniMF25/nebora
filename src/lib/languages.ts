/**
 * Idiomas de la web y las cartas. El español es el idioma de origen; cada
 * local elige además cuáles de estos ofrece (D-033).
 */
export const LANGUAGES = ["en", "fr", "de", "it", "pt", "ca"] as const;
export type Language = (typeof LANGUAGES)[number];
export type PublicLanguage = "es" | Language;

/** Nombre de cada idioma en ese idioma (para el selector público). */
export const LANGUAGE_NATIVE_NAMES: Record<PublicLanguage, string> = {
  es: "Español",
  en: "English",
  fr: "Français",
  de: "Deutsch",
  it: "Italiano",
  pt: "Português",
  ca: "Català",
};

/** Nombre de cada idioma en español (para el panel). */
export const LANGUAGE_LABELS: Record<Language, string> = {
  en: "Inglés",
  fr: "Francés",
  de: "Alemán",
  it: "Italiano",
  pt: "Portugués",
  ca: "Catalán",
};

export function isLanguage(value: unknown): value is Language {
  return typeof value === "string" && (LANGUAGES as readonly string[]).includes(value);
}

/**
 * Idioma de una página pública: el pedido en la URL (`?lang=`) si el local lo
 * ofrece; si no, el primero del navegador (Accept-Language) que se ofrezca; si
 * no, español.
 */
export function resolvePublicLanguage(
  requested: string | string[] | undefined,
  acceptLanguage: string | null,
  offered: readonly string[],
): PublicLanguage {
  const value = Array.isArray(requested) ? requested[0] : requested;
  if (value === "es") return "es";
  if (isLanguage(value) && offered.includes(value)) return value;
  if (value !== undefined) return "es";
  const prefs = (acceptLanguage ?? "")
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      return { lang: (tag ?? "").toLowerCase().split("-")[0]!, q: q ? Number(q.slice(2)) : 1 };
    })
    .filter((p) => p.lang && Number.isFinite(p.q) && p.q > 0)
    .sort((a, b) => b.q - a.q);
  for (const p of prefs) {
    if (p.lang === "es") return "es";
    if (isLanguage(p.lang) && offered.includes(p.lang)) return p.lang;
  }
  return "es";
}

/**
 * Añade `?lang=` a un enlace público. Se añade también para el español: así la
 * elección explícita del visitante prevalece sobre el idioma del navegador.
 */
export function withLang(href: string, lang: PublicLanguage): string {
  const [path, hash] = href.split("#");
  const sep = path!.includes("?") ? "&" : "?";
  return `${path}${sep}lang=${lang}${hash !== undefined ? `#${hash}` : ""}`;
}
