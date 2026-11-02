import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteHome } from "@/components/site/site-home";
import { MENU_THEME_LABELS, MENU_THEMES, type MenuTheme } from "@/lib/menu-snapshot";
import { privateMediaUrl } from "@/lib/site";
import { FONT_PAIRING_IDS, resolvePairing } from "@/lib/site-fonts";
import { requireUser } from "@/server/auth/current-user";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import { getPublishedMenu } from "@/server/modules/menus/menus";
import { getSitePreview } from "@/server/modules/site/service";
import { listGallery } from "@/server/modules/site/gallery";
import { effectiveLook, planAllowsCustomLook } from "@/server/modules/site/plan-look";
import { isSiteDecor } from "@/lib/site-decor";
import { withTenant } from "@/server/tenancy/context";

export const metadata: Metadata = { title: "Vista previa", robots: { index: false, follow: false } };

type Params = Promise<{ orgId: string; estId: string }>;
type Search = Promise<{ theme?: string; font?: string; decor?: string }>;

/**
 * Vista previa de la web del local tal como está guardada (aunque no esté
 * publicada) y, opcionalmente, con otro estilo. Solo miembros de la organización.
 */
export default async function SitePreviewPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { orgId, estId } = await params;
  const search = await searchParams;
  const requested = search.theme;
  const user = await requireUser();
  let data;
  try {
    data = await withTenant(user, orgId, async (tx, ctx) => ({
      preview: await getSitePreview(tx, ctx, estId),
      gallery: await listGallery(tx, ctx, estId),
      plan: ctx.plan,
    }));
  } catch (err) {
    if (err instanceof NotFoundError || err instanceof ForbiddenError) notFound();
    throw err;
  }
  const { preview, plan } = data;
  // Lo que se publicaría con el plan actual (D-047). Con ?theme= o ?font= se prueba sin guardar.
  const profile = effectiveLook(preview.profile, plan);
  const gallery = planAllowsCustomLook(plan) ? data.gallery : [];
  const theme: MenuTheme = MENU_THEMES.includes(requested as MenuTheme) ? (requested as MenuTheme) : profile.theme;
  const org = preview.organizationSlug;
  const est = preview.establishmentSlug;
  const menu = preview.featuredMenuSlug ? await getPublishedMenu(org, est, preview.featuredMenuSlug) : null;
  // Con ?font= se prueba una combinación tipográfica sin guardarla.
  const fontPairing = search.font && FONT_PAIRING_IDS.includes(search.font) ? search.font : profile.fontPairing;
  const pairing = resolvePairing(theme, fontPairing);
  const self = `/preview/site/${orgId}/${estId}?theme=${theme}`;

  return (
    <SiteHome
      gallery={gallery.map((g) => ({ url: privateMediaUrl(orgId, g.mediaId), caption: g.caption }))}
      chrome={{
        theme,
        establishmentName: preview.establishmentName,
        tagline: profile.tagline,
        address: preview.address,
        phone: profile.phone,
        whatsapp: profile.whatsapp,
        instagram: profile.instagram,
        openingHours: preview.openingHours,
        logoUrl: profile.logoMediaId ? privateMediaUrl(orgId, profile.logoMediaId) : null,
        logoSize: profile.logoSize,
        accentColor: profile.accentColor,
        fontPairing,
        // Con ?decor= se prueba un fondo sin guardarlo (D-050).
        decor: isSiteDecor(search.decor) ? search.decor : profile.decor,
        links: {
          home: self,
          menu: menu && preview.featuredMenuSlug ? `/m/${org}/${est}/${preview.featuredMenuSlug}` : null,
          booking: preview.bookingEnabled ? `/r/${org}/${est}` : null,
          contact: `/${org}/${est}/contacto`,
        },
      }}
      site={{ ...profile, heroTitle: profile.heroTitle ?? preview.establishmentName }}
      heroImageUrl={profile.heroMediaId ? privateMediaUrl(orgId, profile.heroMediaId) : null}
      menuSections={menu?.snapshot.sections ?? null}
      banner={
        <div className="preview-banner" role="note">
          Vista previa · estilo {MENU_THEME_LABELS[theme]} · letra {pairing.name.toLowerCase()} ({pairing.description})
          {profile.published ? "" : " · página sin publicar"} ·{" "}
          <Link href={`/app/${orgId}/establishments/${estId}/site`}>Volver al panel</Link>
        </div>
      }
    />
  );
}
