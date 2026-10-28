"use server";

import type { FormState } from "@/lib/form-state";
import { MAX_HIGHLIGHTS } from "@/lib/site";
import { readImageField } from "@/server/actions/form-file";
import { formString, runTenantAction } from "@/server/actions/run";
import {
  setSiteBranding,
  setSiteHeroImage,
  setSiteLogo,
  setSiteLogoSize,
  setSitePublished,
  setSiteTheme,
  updateSiteProfile,
} from "@/server/modules/site/service";
import { saveSiteTranslations } from "@/server/modules/translations/service";

const path = (orgId: string, estId: string) => `/app/${orgId}/establishments/${estId}/site`;

export async function updateSiteAction(orgId: string, estId: string, _p: FormState, fd: FormData): Promise<FormState> {
  const highlights: { icon: string; title: string; text: string }[] = [];
  for (let n = 0; n < MAX_HIGHLIGHTS; n++) {
    const title = formString(fd, `h${n}title`);
    const text = formString(fd, `h${n}text`);
    // Un destacado sin título ni texto se considera vacío; con texto pero sin título lo rechaza el servidor.
    if (!title && !text) continue;
    highlights.push({ icon: formString(fd, `h${n}icon`), title, text });
  }
  return runTenantAction(
    orgId,
    path(orgId, estId),
    (tx, ctx) =>
      updateSiteProfile(tx, ctx, estId, {
        theme: formString(fd, "theme"),
        tagline: formString(fd, "tagline"),
        heroEyebrow: formString(fd, "heroEyebrow"),
        heroTitle: formString(fd, "heroTitle"),
        heroText: formString(fd, "heroText"),
        phone: formString(fd, "phone"),
        whatsapp: formString(fd, "whatsapp"),
        instagram: formString(fd, "instagram"),
        highlights,
        featuredMenuId: formString(fd, "featuredMenuId") || null,
      }),
    "Página guardada",
  );
}

export async function setHeroImageAction(
  orgId: string,
  estId: string,
  _p: FormState,
  fd: FormData,
): Promise<FormState> {
  return runTenantAction(
    orgId,
    path(orgId, estId),
    async (tx, ctx) => setSiteHeroImage(tx, ctx, estId, await readImageField(fd)),
    "Foto guardada",
  );
}

export async function removeHeroImageAction(
  orgId: string,
  estId: string,
  _p: FormState,
  _fd: FormData,
): Promise<FormState> {
  return runTenantAction(
    orgId,
    path(orgId, estId),
    (tx, ctx) => setSiteHeroImage(tx, ctx, estId, null),
    "Foto quitada",
  );
}

export async function setThemeAction(
  orgId: string,
  estId: string,
  theme: string,
  _p: FormState,
  _fd: FormData,
): Promise<FormState> {
  return runTenantAction(
    orgId,
    path(orgId, estId),
    (tx, ctx) => setSiteTheme(tx, ctx, estId, { theme }),
    "Estilo aplicado",
  );
}

export async function saveSiteTranslationsAction(
  orgId: string,
  estId: string,
  lang: string,
  _p: FormState,
  fd: FormData,
): Promise<FormState> {
  const highlights = Array.from({ length: MAX_HIGHLIGHTS }, (_, n) => ({
    title: formString(fd, `h${n}title`),
    text: formString(fd, `h${n}text`),
  }));
  return runTenantAction(
    orgId,
    path(orgId, estId),
    (tx, ctx) =>
      saveSiteTranslations(tx, ctx, estId, lang, {
        tagline: formString(fd, "tagline"),
        heroEyebrow: formString(fd, "heroEyebrow"),
        heroTitle: formString(fd, "heroTitle"),
        heroText: formString(fd, "heroText"),
        highlights,
      }),
    "Traducción guardada",
  );
}

export async function setLogoAction(orgId: string, estId: string, _p: FormState, fd: FormData): Promise<FormState> {
  return runTenantAction(
    orgId,
    path(orgId, estId),
    async (tx, ctx) => setSiteLogo(tx, ctx, estId, await readImageField(fd)),
    "Logotipo guardado",
  );
}

export async function removeLogoAction(orgId: string, estId: string, _p: FormState, _fd: FormData): Promise<FormState> {
  return runTenantAction(orgId, path(orgId, estId), (tx, ctx) => setSiteLogo(tx, ctx, estId, null), "Logotipo quitado");
}

export async function setBrandingAction(orgId: string, estId: string, _p: FormState, fd: FormData): Promise<FormState> {
  const custom = fd.get("customAccent") === "1";
  const pairing = formString(fd, "fontPairing");
  return runTenantAction(
    orgId,
    path(orgId, estId),
    (tx, ctx) =>
      setSiteBranding(tx, ctx, estId, {
        accentColor: custom ? formString(fd, "accentColor") : null,
        fontPairing: pairing === "" ? null : pairing,
      }),
    "Marca guardada",
  );
}

export async function setLogoSizeAction(orgId: string, estId: string, _p: FormState, fd: FormData): Promise<FormState> {
  return runTenantAction(
    orgId,
    path(orgId, estId),
    (tx, ctx) => setSiteLogoSize(tx, ctx, estId, { logoSize: formString(fd, "logoSize") }),
    "Tamaño guardado",
  );
}

export async function setPublishedAction(orgId: string, estId: string, _p: FormState, fd: FormData): Promise<FormState> {
  const published = fd.get("published") === "1";
  return runTenantAction(
    orgId,
    path(orgId, estId),
    (tx, ctx) => setSitePublished(tx, ctx, estId, { published }),
    published ? "Web publicada" : "Web retirada",
  );
}
