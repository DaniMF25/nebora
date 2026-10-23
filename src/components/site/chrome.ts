import type { PublicSite } from "@/server/modules/site/service";
import type { SiteChrome } from "./site-shell";

/**
 * Cabecera, pie y navegación de la web del local a partir del perfil
 * publicado. `menuHref` permite enlazar la carta que se está viendo aunque no
 * sea la destacada.
 */
export function siteChrome(site: PublicSite, orgSlug: string, estSlug: string, menuHref?: string): SiteChrome {
  const org = orgSlug.toLowerCase();
  const est = estSlug.toLowerCase();
  return {
    ...site,
    links: {
      home: `/${org}/${est}`,
      menu: menuHref ?? (site.featuredMenuSlug ? `/m/${org}/${est}/${site.featuredMenuSlug}` : null),
      booking: site.bookingEnabled ? `/r/${org}/${est}` : null,
    },
  };
}
