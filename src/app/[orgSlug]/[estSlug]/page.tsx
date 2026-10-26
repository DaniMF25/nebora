import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { cache } from "react";
import { siteChrome } from "@/components/site/chrome";
import { SiteHome } from "@/components/site/site-home";
import { resolvePublicLanguage } from "@/lib/languages";
import { localizeSnapshot } from "@/lib/menu-snapshot";
import { publicMediaUrl } from "@/lib/site";
import { getPublishedMenu } from "@/server/modules/menus/menus";
import { getPublicSite, localizePublicSite } from "@/server/modules/site/service";
import { recordSiteView } from "@/server/modules/stats/service";
import { trackView } from "@/server/modules/stats/track";

type Params = Promise<{ orgSlug: string; estSlug: string }>;
type Search = Promise<{ lang?: string | string[] }>;

// Página pública sin sesión: solo lee el perfil publicado y la carta publicada.
const load = cache(async (org: string, est: string) => {
  const site = await getPublicSite(org, est);
  if (!site) return null;
  const menu = site.featuredMenuSlug ? await getPublishedMenu(org, est, site.featuredMenuSlug) : null;
  return { site, menu };
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

  return (
    <SiteHome
      chrome={{ ...chrome, links: { ...chrome.links, menu: menuHref } }}
      site={site}
      heroImageUrl={site.heroMediaId ? publicMediaUrl(site.heroMediaId) : null}
      menuSections={menu ? localizeSnapshot(menu.snapshot, lang).sections : null}
    />
  );
}
