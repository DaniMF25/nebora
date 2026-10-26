import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { MenuView } from "@/components/menu-view";
import { siteChrome } from "@/components/site/chrome";
import { SiteMenu } from "@/components/site/site-menu";
import { SiteShell } from "@/components/site/site-shell";
import { getPublishedMenu } from "@/server/modules/menus/menus";
import { getPublicSite } from "@/server/modules/site/service";
import { recordMenuView } from "@/server/modules/stats/service";
import { trackView } from "@/server/modules/stats/track";

type Params = Promise<{ orgSlug: string; estSlug: string; menuSlug: string }>;

// Página pública sin sesión: solo puede mostrar la versión publicada.
const load = cache((org: string, est: string, menu: string) => getPublishedMenu(org, est, menu));

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { orgSlug, estSlug, menuSlug } = await params;
  const menu = await load(orgSlug, estSlug, menuSlug);
  if (!menu) return { title: "Carta no encontrada" };
  return { title: `${menu.snapshot.menuName} · ${menu.snapshot.establishmentName}` };
}

export default async function PublicMenuPage({ params }: { params: Params }) {
  const { orgSlug, estSlug, menuSlug } = await params;
  const menu = await load(orgSlug, estSlug, menuSlug);
  if (!menu) notFound();
  await trackView(() => recordMenuView(orgSlug, estSlug, menuSlug));
  // Si el local tiene su web publicada, la carta se integra en ella con el
  // estilo de la web; si no, se muestra sola con el tema de la versión.
  const site = await getPublicSite(orgSlug, estSlug);
  if (!site) return <MenuView snapshot={menu.snapshot} />;
  const href = `/m/${orgSlug.toLowerCase()}/${estSlug.toLowerCase()}/${menuSlug.toLowerCase()}`;
  return (
    <SiteShell current="menu" site={siteChrome(site, orgSlug, estSlug, href)}>
      <SiteMenu snapshot={menu.snapshot} />
    </SiteShell>
  );
}
