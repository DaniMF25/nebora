import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import type { AuthUser } from "@/server/auth/service";
import type { Tx } from "@/server/db/pool";
import { ForbiddenError, ValidationError } from "@/server/errors";
import { createEstablishment } from "@/server/modules/establishments/service";
import { changePlan } from "@/server/modules/organizations/service";
import { addGalleryImage, getPublicGallery } from "@/server/modules/site/gallery";
import {
  getPublicSite,
  getSiteProfile,
  setSiteBranding,
  setSiteDecor,
  setSitePublished,
  setSiteTheme,
  updateSiteProfile,
} from "@/server/modules/site/service";
import { withTenant, type TenantContext } from "@/server/tenancy/context";
import { withAdminClient } from "../support/db";
import { createTestOrganization, createTestUser, uniqueSuffix } from "../support/factories";

const png = () =>
  sharp({ create: { width: 40, height: 30, channels: 3, background: "#aa3300" } })
    .png()
    .toBuffer();

const content = {
  theme: "futurista",
  tagline: "",
  heroEyebrow: "",
  heroTitle: "Hola",
  heroText: "",
  phone: "",
  whatsapp: "",
  instagram: "",
  highlights: [],
  featuredMenuId: null,
};

// Aspecto de la web según el plan (D-047).
describe("web pública según el plan", () => {
  let owner: AuthUser;
  let org: string;
  let orgSlug: string;
  let est: string;
  let estSlug: string;
  const asOwner = <T>(fn: (tx: Tx, ctx: TenantContext) => Promise<T>) => withTenant(owner, org, fn);

  beforeAll(async () => {
    owner = await createTestUser("look-owner");
    // Con el plan Avanzado elige estilo, color, tipografía y galería.
    org = await createTestOrganization(owner, "Aspecto", "advanced");
    orgSlug = (await withAdminClient((c) => c.query("SELECT slug FROM organizations WHERE id = $1", [org]))).rows[0]
      .slug;
    estSlug = `local-${uniqueSuffix()}`;
    est = await asOwner(async (tx, ctx) => {
      const id = (await createEstablishment(tx, ctx, { name: "Local", slug: estSlug })).id;
      await updateSiteProfile(tx, ctx, id, content);
      await setSiteBranding(tx, ctx, id, { accentColor: "#123456", fontPairing: null });
      await addGalleryImage(tx, ctx, id, await png(), { caption: "Comedor" });
      await setSitePublished(tx, ctx, id, { published: true });
      return id;
    });
  });

  it("fondo decorativo (D-050): se guarda y sale en la web; valores no previstos, no", async () => {
    await asOwner((tx, ctx) => setSiteDecor(tx, ctx, est, { decor: "seafood" }));
    expect((await getPublicSite(orgSlug, estSlug))!.decor).toBe("seafood");
    await expect(asOwner((tx, ctx) => setSiteDecor(tx, ctx, est, { decor: "gatos" }))).rejects.toThrow(ValidationError);
  });

  it("en Avanzado la web muestra lo elegido", async () => {
    const site = (await getPublicSite(orgSlug, estSlug))!;
    expect([site.theme, site.accentColor]).toEqual(["futurista", "#123456"]);
    expect(await getPublicGallery(est)).toHaveLength(1);
  });

  it("en Básico: Clásico, sin color propio ni galería, sin borrar lo guardado; al subir vuelve", async () => {
    await asOwner((tx, ctx) => changePlan(tx, ctx, { plan: "basic" }));
    const site = (await getPublicSite(orgSlug, estSlug))!;
    expect([site.theme, site.accentColor, site.fontPairing, site.decor]).toEqual(["clasico", null, null, null]);
    expect(await getPublicGallery(est)).toEqual([]);

    // El servidor no deja cambiar estilo, color ni galería…
    await asOwner(async (tx, ctx) => {
      await expect(setSiteTheme(tx, ctx, est, { theme: "moderno" })).rejects.toThrow(ForbiddenError);
      await expect(setSiteBranding(tx, ctx, est, { accentColor: "#ff0000", fontPairing: null })).rejects.toThrow(
        ForbiddenError,
      );
      await expect(addGalleryImage(tx, ctx, est, await png(), {})).rejects.toThrow(ForbiddenError);
      await expect(setSiteDecor(tx, ctx, est, { decor: null })).rejects.toThrow(ForbiddenError);
      // …ni colarlo por el formulario de contenido, que tampoco pisa el estilo guardado.
      await updateSiteProfile(tx, ctx, est, { ...content, theme: "moderno", tagline: "Nuevo lema" });
      const saved = await getSiteProfile(tx, ctx, est);
      expect([saved.theme, saved.tagline]).toEqual(["futurista", "Nuevo lema"]);
    });

    await asOwner((tx, ctx) => changePlan(tx, ctx, { plan: "advanced" }));
    const back = (await getPublicSite(orgSlug, estSlug))!;
    expect([back.theme, back.accentColor, back.decor]).toEqual(["futurista", "#123456", "seafood"]);
    expect(await getPublicGallery(est)).toHaveLength(1);
  });
});
