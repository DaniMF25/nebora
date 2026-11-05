import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { cache } from "react";
import { siteChrome } from "@/components/site/chrome";
import { SiteHome } from "@/components/site/site-home";
import { resolvePublicLanguage } from "@/lib/languages";
import { localizeSnapshot } from "@/lib/menu-snapshot";
import { publicMediaUrl } from "@/lib/site";
import { pickCurrentMenu } from "@/server/modules/menus/availability";
import { getPublicMenus, getPublishedMenu } from "@/server/modules/menus/menus";
import { getPublicSpecials, withSpecials } from "@/server/modules/menus/specials";
import { PUBLIC_TEXTS } from "@/lib/public-i18n";
import { getPublicSite, localizePublicSite } from "@/server/modules/site/service";
import { getPublicGallery } from "@/server/modules/site/gallery";
import { getPublicStories } from "@/server/modules/site/stories";
import { recordSiteView } from "@/server/modules/stats/service";
import { trackView } from "@/server/modules/stats/track";

type Params = Promise<{ orgSlug: string; estSlug: string }>;
type Search = Promise<{ lang?: string | string[] }>;

// Página pública sin sesión: solo lee el perfil publicado y la carta publicada.
// Con carta destacada, se muestra la del momento: una carta con horario que se
// sirva ahora (p. ej. «Desayunos») se impone a la destacada (D-036). Sin
// destacada, la web no muestra carta, como hasta ahora.
const load = cache(async (org: string, est: string) => {
  const found = await getPublicSite(org, est);
  if (!found) return null;
  const featured = async () => {
    let slug = found.featuredMenuSlug;
    if (slug) {
      const menus = await getPublicMenus(org, est);
      const current = menus ? pickCurrentMenu(menus.menus, menus.timezone, new Date()) : null;
      if (current) slug = current.slug;
    }
    return { slug, menu: slug ? await getPublishedMenu(org, est, slug) : null };
  };
  // La galería no depende de la carta: se lee a la vez.
  const [{ slug, menu }, gallery, stories] = await Promise.all([
    featured(),
    getPublicGallery(found.establishmentId),
    getPublicStories(found.establishmentId),
  ]);
  const site = slug === found.featuredMenuSlug ? found : { ...found, featuredMenuSlug: slug };
  return { site, menu, gallery, stories };
});

/** Idioma de la página: `?lang=`, el del navegador si el local lo ofrece, o español. */
async function pageLanguage(search: Search, offered: readonly string[]) {
  return resolvePublicLanguage((await search).lang, (await headers()).get("accept-language"), offered);
}

export async function generateMetadata({ params, searchParams }: { params: Params; searchParams: Search }): Promise<Metadata> {
  const { orgSlug, estSlug } = await params;
  const data = await load(orgSlug, estSlug);
  if (!data) return { title: "Página no encontrada" };
  const site = localizePublicSite(data.site, await pageLanguage(searchParams, data.site.languages));
  return {
    title: site.tagline ? `${site.establishmentName} · ${site.tagline}` : site.establishmentName,
    description: site.heroText ?? undefined,
  };
}

export default async function PublicSitePage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { orgSlug, estSlug } = await params;
  const data = await load(orgSlug, estSlug);
  if (!data) notFound();
  await trackView(() => recordSiteView(orgSlug, estSlug));
  const lang = await pageLanguage(searchParams, data.site.languages);
  const site = localizePublicSite(data.site, lang);
  const menu = data.menu;
  const chrome = siteChrome(site, orgSlug, estSlug, undefined, {
    lang,
    selfPath: `/${orgSlug.toLowerCase()}/${estSlug.toLowerCase()}`,
  });
  // featuredMenuSlug solo existe si la carta está publicada; `menu` lo confirma.
  const menuHref = menu ? chrome.links.menu : null;
  const t = PUBLIC_TEXTS[lang];
  // Botón de cada historia: a la reserva, la carta o el contacto de la web (si existen) o a un enlace propio.
  const ctaFor = (s: (typeof data.stories)[number]) => {
    if (s.ctaKind === "booking" && chrome.links.booking) return { href: chrome.links.booking, label: t.book, external: false };
    if (s.ctaKind === "menu" && chrome.links.menu) return { href: chrome.links.menu, label: t.storySeeMenu, external: false };
    if (s.ctaKind === "contact") return { href: chrome.links.contact, label: t.contactCta, external: false };
    if (s.ctaKind === "url" && s.ctaUrl && s.ctaLabel) return { href: s.ctaUrl, label: s.ctaLabel, external: true };
    return null;
  };

  return (
    <SiteHome
      chrome={{ ...chrome, links: { ...chrome.links, menu: menuHref } }}
      site={site}
      heroImageUrl={site.heroMediaId ? publicMediaUrl(site.heroMediaId) : null}
      gallery={data.gallery.map((g) => ({ url: publicMediaUrl(g.mediaId), caption: g.caption }))}
      stories={data.stories.map((s) => ({
        id: s.id,
        version: s.version,
        title: s.title,
        body: s.body,
        imageUrl: s.mediaId ? publicMediaUrl(s.mediaId) : null,
        cta: ctaFor(s),
      }))}
      storiesKey={data.site.establishmentId}
      menuSections={
        menu
          ? withSpecials(
              localizeSnapshot(menu.snapshot, lang),
              await getPublicSpecials(orgSlug, estSlug, lang),
              PUBLIC_TEXTS[lang].offMenu,
            ).sections
          : null
      }
    />
  );
}
