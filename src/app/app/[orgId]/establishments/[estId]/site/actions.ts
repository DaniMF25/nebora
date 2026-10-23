"use server";

import type { FormState } from "@/lib/form-state";
import { MAX_HIGHLIGHTS } from "@/lib/site";
import { readImageField } from "@/server/actions/form-file";
import { formString, runTenantAction } from "@/server/actions/run";
import { setSiteHeroImage, updateSiteProfile } from "@/server/modules/site/service";

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
        published: fd.get("published") === "on",
      }),
    "Página guardada",
  );
}

export async function setHeroImageAction(orgId: string, estId: string, _p: FormState, fd: FormData): Promise<FormState> {
  return runTenantAction(
    orgId,
    path(orgId, estId),
    async (tx, ctx) => setSiteHeroImage(tx, ctx, estId, await readImageField(fd)),
    "Foto guardada",
  );
}

export async function removeHeroImageAction(orgId: string, estId: string, _p: FormState, _fd: FormData): Promise<FormState> {
  return runTenantAction(orgId, path(orgId, estId), (tx, ctx) => setSiteHeroImage(tx, ctx, estId, null), "Foto quitada");
}
