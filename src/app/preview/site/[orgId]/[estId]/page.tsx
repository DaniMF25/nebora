import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteHome } from "@/components/site/site-home";
import { MENU_THEME_LABELS, MENU_THEMES, type MenuTheme } from "@/lib/menu-snapshot";
import { privateMediaUrl } from "@/lib/site";
import { requireUser } from "@/server/auth/current-user";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import { getPublishedMenu } from "@/server/modules/menus/menus";
import { getSitePreview } from "@/server/modules/site/service";
import { withTenant } from "@/server/tenancy/context";

export const metadata: Metadata = { title: "Vista previa", robots: { index: false, follow: false } };

type Params = Promise<{ orgId: string; estId: string }>;
type Search = Promise<{ theme?: string }>;

/**
 * Vista previa de la web del local tal como está guardada (aunque no esté
 * publicada) y, opcionalmente, con otro estilo. Solo miembros de la organización.
 */
export default async function SitePreviewPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { orgId, estId } = await params;
  const requested = (await searchParams).theme;
  const user = await requireUser();
  let preview;
  try {
    preview = await withTenant(user, orgId, (tx, ctx) => getSitePreview(tx, ctx, estId));
  } catch (err) {
    if (err instanceof NotFoundError || err instanceof ForbiddenError) notFound();
    throw err;
  }
  const { profile } = preview;
  const theme: MenuTheme = MENU_THEMES.includes(requested as MenuTheme) ? (requested as MenuTheme) : profile.theme;
  const org = preview.organizationSlug;
  const est = preview.establishmentSlug;
  const menu = preview.featuredMenuSlug ? await getPublishedMenu(org, est, preview.featuredMenuSlug) : null;
  const self = `/preview/site/${orgId}/${estId}?theme=${theme}`;

  return (
    <SiteHome
      chrome={{
        theme,
        establishmentName: preview.establishmentName,
        tagline: profile.tagline,
        address: preview.address,
        phone: profile.phone,
        whatsapp: profile.whatsapp,
        instagram: profile.instagram,
        openingHours: preview.openingHours,
        links: {
          home: self,
          menu: menu && preview.featuredMenuSlug ? `/m/${org}/${est}/${preview.featuredMenuSlug}` : null,
          booking: preview.bookingEnabled ? `/r/${org}/${est}` : null,
        },
      }}
      site={{ ...profile, heroTitle: profile.heroTitle ?? preview.establishmentName }}
      heroImageUrl={profile.heroMediaId ? privateMediaUrl(orgId, profile.heroMediaId) : null}
      menuSections={menu?.snapshot.sections ?? null}
      banner={
        <div className="preview-banner" role="note">
          Vista previa · estilo {MENU_THEME_LABELS[theme]}
          {profile.published ? "" : " · página sin publicar"} ·{" "}
          <Link href={`/app/${orgId}/establishments/${estId}/site`}>Volver al panel</Link>
        </div>
      }
    />
  );
}
