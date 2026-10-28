import { LANGUAGE_NATIVE_NAMES, withLang, type PublicLanguage } from "@/lib/languages";
import { publicMediaUrl } from "@/lib/site";
import type { PublicSite } from "@/server/modules/site/service";
import type { SiteChrome } from "./site-shell";

/**
 * Cabecera, pie y navegación de la web del local a partir del perfil
 * publicado. `menuHref` permite enlazar la carta que se está viendo aunque no
 * sea la destacada.
 */
export function siteChrome(
  site: PublicSite,
  orgSlug: string,
  estSlug: string,
  menuHref?: string,
  i18n?: { lang: PublicLanguage; selfPath: string },
): SiteChrome {
  const org = orgSlug.toLowerCase();
  const est = estSlug.toLowerCase();
  // Con idiomas, los enlaces internos llevan el idioma elegido (D-033).
  const multilingual = site.languages.length > 0 && i18n !== undefined;
  const link = (href: string) => (multilingual ? withLang(href, i18n.lang) : href);
  const menu = menuHref ?? (site.featuredMenuSlug ? `/m/${org}/${est}/${site.featuredMenuSlug}` : null);
  return {
    ...site,
    logoUrl: site.logoMediaId ? publicMediaUrl(site.logoMediaId) : null,
    lang: i18n?.lang ?? "es",
    languageLinks: multilingual ? languageLinks(site.languages, i18n.selfPath) : [],
    links: {
      home: link(`/${org}/${est}`),
      menu: menu ? link(menu) : null,
      // La reserva online aún no está traducida: se enlaza sin idioma.
      booking: site.bookingEnabled ? `/r/${org}/${est}` : null,
    },
  };
}

/** Enlaces del selector de idioma: español y los idiomas del local. */
export function languageLinks(
  languages: readonly PublicLanguage[],
  selfPath: string,
): { lang: PublicLanguage; label: string; href: string }[] {
  const all: PublicLanguage[] = ["es", ...languages.filter((l) => l !== "es")];
  return all.map((lang) => ({ lang, label: LANGUAGE_NATIVE_NAMES[lang], href: withLang(selfPath, lang) }));
}
