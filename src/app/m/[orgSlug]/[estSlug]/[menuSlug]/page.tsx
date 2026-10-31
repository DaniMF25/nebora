import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { cache } from "react";
import { MenuView } from "@/components/menu-view";
import { languageLinks, siteChrome } from "@/components/site/chrome";
import { SiteMenu } from "@/components/site/site-menu";
import { SiteShell } from "@/components/site/site-shell";
import { resolvePublicLanguage, withLang } from "@/lib/languages";
import { localizeSnapshot } from "@/lib/menu-snapshot";
import { PUBLIC_TEXTS } from "@/lib/public-i18n";
import { groupOpeningHours } from "@/lib/site-hours";
import { menuServing } from "@/server/modules/menus/availability";
import { getPublicMenus, getPublishedMenu } from "@/server/modules/menus/menus";
import { getPublicSite, localizePublicSite } from "@/server/modules/site/service";
import { recordMenuView } from "@/server/modules/stats/service";
import { trackView } from "@/server/modules/stats/track";

type Params = Promise<{ orgSlug: string; estSlug: string; menuSlug: string }>;
type Search = Promise<{ lang?: string | string[] }>;

// Página pública sin sesión: solo puede mostrar la versión publicada.
const load = cache((org: string, est: string, menu: string) => getPublishedMenu(org, est, menu));
const loadSite = cache((org: string, est: string) => getPublicSite(org, est));
const loadMenus = cache((org: string, est: string) => getPublicMenus(org, est));

/**
 * Idiomas que se ofrecen: los de la web del local si está publicada; si no,
 * los que llevaba la carta al publicarse.
 */
async function pageLanguage(org: string, est: string, menu: string, search: Search) {
  const [snapshot, site] = [await load(org, est, menu), await loadSite(org, est)];
  const offered = site?.languages ?? snapshot?.snapshot.languages ?? [];
  const lang = resolvePublicLanguage((await search).lang, (await headers()).get("accept-language"), offered);
  return { lang, offered };
}

export async function generateMetadata({ params, searchParams }: { params: Params; searchParams: Search }): Promise<Metadata> {
  const { orgSlug, estSlug, menuSlug } = await params;
  const menu = await load(orgSlug, estSlug, menuSlug);
  if (!menu) return { title: "Carta no encontrada" };
  const { lang } = await pageLanguage(orgSlug, estSlug, menuSlug, searchParams);
  const snapshot = localizeSnapshot(menu.snapshot, lang);
  return { title: `${snapshot.menuName} · ${snapshot.establishmentName}` };
}

export default async function PublicMenuPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { orgSlug, estSlug, menuSlug } = await params;
  const menu = await load(orgSlug, estSlug, menuSlug);
  if (!menu) notFound();
  await trackView(() => recordMenuView(orgSlug, estSlug, menuSlug));
  const { lang, offered } = await pageLanguage(orgSlug, estSlug, menuSlug, searchParams);
  const snapshot = localizeSnapshot(menu.snapshot, lang);
  const base = `/m/${orgSlug.toLowerCase()}/${estSlug.toLowerCase()}`;
  const href = `${base}/${menuSlug.toLowerCase()}`;
  // Horario de esta carta y enlaces a las demás del local (D-036).
  const menus = await loadMenus(orgSlug, estSlug);
  const t = PUBLIC_TEXTS[lang];
  const serving = menus
    ? menuServing(
        menus,
        menuSlug.toLowerCase(),
        lang,
        new Date(),
        (slug) => (offered.length > 0 ? withLang(`${base}/${slug}`, lang) : `${base}/${slug}`),
        (slots) => groupOpeningHours(slots, t).map((l) => `${l.days} ${l.slots.join(", ")}`),
      )
    : null;
  // Si el local tiene su web publicada, la carta se integra en ella con el
  // estilo de la web; si no, se muestra sola con el tema de la versión.
  const site = await loadSite(orgSlug, estSlug);
  if (!site) {
    return (
      <MenuView
        snapshot={snapshot}
        lang={lang}
        serving={serving}
        languageLinks={offered.length > 0 ? languageLinks(offered, href) : []}
      />
    );
  }
  return (
    <SiteShell
      current="menu"
      site={siteChrome(localizePublicSite(site, lang), orgSlug, estSlug, href, { lang, selfPath: href })}
    >
      <SiteMenu snapshot={snapshot} lang={lang} serving={serving} />
    </SiteShell>
  );
}
