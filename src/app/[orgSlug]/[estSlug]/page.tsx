import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { siteChrome } from "@/components/site/chrome";
import { SiteHome } from "@/components/site/site-home";
import { publicMediaUrl } from "@/lib/site";
import { getPublishedMenu } from "@/server/modules/menus/menus";
import { getPublicSite } from "@/server/modules/site/service";

type Params = Promise<{ orgSlug: string; estSlug: string }>;

// Página pública sin sesión: solo lee el perfil publicado y la carta publicada.
const load = cache(async (org: string, est: string) => {
  const site = await getPublicSite(org, est);
  if (!site) return null;
  const menu = site.featuredMenuSlug ? await getPublishedMenu(org, est, site.featuredMenuSlug) : null;
  return { site, menu };
});

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { orgSlug, estSlug } = await params;
  const data = await load(orgSlug, estSlug);
  if (!data) return { title: "Página no encontrada" };
  return {
    title: data.site.tagline ? `${data.site.establishmentName} · ${data.site.tagline}` : data.site.establishmentName,
    description: data.site.heroText ?? undefined,
  };
}

export default async function PublicSitePage({ params }: { params: Params }) {
  const { orgSlug, estSlug } = await params;
  const data = await load(orgSlug, estSlug);
  if (!data) notFound();
  const { site, menu } = data;
  const chrome = siteChrome(site, orgSlug, estSlug);
  // featuredMenuSlug solo existe si la carta está publicada; `menu` lo confirma.
  const menuHref = menu ? chrome.links.menu : null;

  return (
    <SiteHome
      chrome={{ ...chrome, links: { ...chrome.links, menu: menuHref } }}
      site={site}
      heroImageUrl={site.heroMediaId ? publicMediaUrl(site.heroMediaId) : null}
      menuSections={menu?.snapshot.sections ?? null}
    />
  );
}
