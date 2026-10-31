import { notFound, redirect } from "next/navigation";
import { pickCurrentMenu } from "@/server/modules/menus/availability";
import { getPublicMenus } from "@/server/modules/menus/menus";

type Params = Promise<{ orgSlug: string; estSlug: string }>;
type Search = Promise<{ lang?: string | string[] }>;

/**
 * «Carta del momento» del local (D-036): un único enlace (o QR) que lleva a la
 * carta que se sirve ahora según los horarios de las cartas publicadas.
 */
export default async function CurrentMenuPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { orgSlug, estSlug } = await params;
  const data = await getPublicMenus(orgSlug, estSlug);
  const current = data ? pickCurrentMenu(data.menus, data.timezone, new Date()) : null;
  if (!current) notFound();
  const lang = (await searchParams).lang;
  const query = typeof lang === "string" && /^[a-z]{2}$/.test(lang) ? `?lang=${lang}` : "";
  redirect(`/m/${orgSlug.toLowerCase()}/${estSlug.toLowerCase()}/${current.slug}${query}`);
}
