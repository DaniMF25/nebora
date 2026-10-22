import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { MenuView } from "@/components/menu-view";
import { getPublishedMenu } from "@/server/modules/menus/menus";

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
  return <MenuView snapshot={menu.snapshot} />;
}
