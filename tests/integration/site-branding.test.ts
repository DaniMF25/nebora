import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import type { AuthUser } from "@/server/auth/service";
import type { Tx } from "@/server/db/pool";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { createEstablishment } from "@/server/modules/establishments/service";
import { getPublicMedia } from "@/server/modules/media/service";
import {
  getPublicSite,
  getSiteProfile,
  setSiteBranding,
  setSiteLogo,
  setSiteLogoSize,
  updateSiteProfile,
} from "@/server/modules/site/service";
import { withTenant, type TenantContext } from "@/server/tenancy/context";
import { withAdminClient, withAppClient } from "../support/db";
import { addMember, createTestOrganization, createTestUser, uniqueSuffix } from "../support/factories";

/** PNG con transparencia (los logotipos suelen tenerla). */
async function logoPng(): Promise<Uint8Array> {
  return new Uint8Array(
    await sharp({ create: { width: 600, height: 200, channels: 4, background: { r: 180, g: 140, b: 86, alpha: 0 } } })
      .png()
      .toBuffer(),
  );
}

// Marca de la web: logotipo, color y tipografía (D-034).
describe("marca de la web", () => {
  let owner: AuthUser;
  let org: string;
  let orgSlug: string;
  let est: { id: string; slug: string };
  const asOwner = <T>(fn: (tx: Tx, ctx: TenantContext) => Promise<T>) => withTenant(owner, org, fn);

  beforeAll(async () => {
    owner = await createTestUser("brand-owner");
    org = await createTestOrganization(owner, "Marca");
    orgSlug = (await withAdminClient((c) => c.query("SELECT slug FROM organizations WHERE id = $1", [org]))).rows[0]
      .slug;
    const e = await asOwner((tx, ctx) =>
      createEstablishment(tx, ctx, { name: "Faro", slug: `faro-${uniqueSuffix()}` }),
    );
    est = { id: e.id, slug: e.slug };
  });

  it("guarda color normalizado y tipografía; null vuelve a los del estilo", async () => {
    await asOwner((tx, ctx) =>
      setSiteBranding(tx, ctx, est.id, { accentColor: "#2E86AB", fontPairing: "med-playfair" }),
    );
    expect(await asOwner((tx, ctx) => getSiteProfile(tx, ctx, est.id))).toMatchObject({
      accentColor: "#2e86ab",
      fontPairing: "med-playfair",
    });
    await asOwner((tx, ctx) => setSiteBranding(tx, ctx, est.id, { accentColor: "", fontPairing: null }));
    expect(await asOwner((tx, ctx) => getSiteProfile(tx, ctx, est.id))).toMatchObject({
      accentColor: null,
      fontPairing: null,
    });
  });

  it("rechaza colores y tipografías no válidos (también en la base de datos)", async () => {
    for (const input of [
      { accentColor: "red", fontPairing: null },
      { accentColor: "#123", fontPairing: null },
      { accentColor: "#000000;background:url(//x)", fontPairing: null },
      { accentColor: null, fontPairing: "comic-sans" },
      { accentColor: null, fontPairing: null, extra: 1 },
    ]) {
      await expect(asOwner((tx, ctx) => setSiteBranding(tx, ctx, est.id, input))).rejects.toBeInstanceOf(
        ValidationError,
      );
    }
    await withAppClient(async (c) => {
      await c.query("BEGIN");
      try {
        await c.query("SELECT set_config('app.user_id', $1, true)", [owner.id]);
        await c.query("SELECT set_config('app.org_id', $1, true)", [org]);
        await expect(
          c.query("UPDATE establishment_profiles SET accent_color = 'blue' WHERE establishment_id = $1", [est.id]),
        ).rejects.toThrow(/establishment_profiles_accent_format/);
      } finally {
        await c.query("ROLLBACK");
      }
    });
  });

  it("el logotipo conserva la transparencia y solo es público con la web publicada", async () => {
    const png = await logoPng();
    await asOwner((tx, ctx) => setSiteLogo(tx, ctx, est.id, png));
    const { logoMediaId } = await asOwner((tx, ctx) => getSiteProfile(tx, ctx, est.id));
    expect(logoMediaId).toBeTruthy();
    const stored = await withAdminClient((c) => c.query("SELECT data FROM media_assets WHERE id = $1", [logoMediaId]));
    expect((await sharp(stored.rows[0].data).metadata()).hasAlpha).toBe(true);
    expect(await getPublicMedia(logoMediaId!)).toBeNull();

    await asOwner((tx, ctx) =>
      updateSiteProfile(tx, ctx, est.id, {
        theme: "moderno",
        tagline: "",
        heroEyebrow: "",
        heroTitle: "Hola",
        heroText: "",
        phone: "",
        whatsapp: "",
        instagram: "",
        highlights: [],
        featuredMenuId: null,
        published: true,
      }),
    );
    await asOwner((tx, ctx) =>
      setSiteBranding(tx, ctx, est.id, { accentColor: "#e4572e", fontPairing: "mod-dmserif" }),
    );
    expect(await getPublicMedia(logoMediaId!)).not.toBeNull();
    expect(await getPublicSite(orgSlug, est.slug)).toMatchObject({
      logoMediaId,
      accentColor: "#e4572e",
      fontPairing: "mod-dmserif",
    });

    // Tamaño del logotipo: mediano por defecto; solo pequeño, mediano o grande.
    expect((await getPublicSite(orgSlug, est.slug))!.logoSize).toBe("medium");
    await asOwner((tx, ctx) => setSiteLogoSize(tx, ctx, est.id, { logoSize: "large" }));
    expect((await getPublicSite(orgSlug, est.slug))!.logoSize).toBe("large");
    await expect(
      asOwner((tx, ctx) => setSiteLogoSize(tx, ctx, est.id, { logoSize: "huge" })),
    ).rejects.toBeInstanceOf(ValidationError);

    await asOwner((tx, ctx) => setSiteLogo(tx, ctx, est.id, null));
    expect((await getPublicSite(orgSlug, est.slug))!.logoMediaId).toBeNull();
    expect(await getPublicMedia(logoMediaId!)).toBeNull();
  });

  it("el personal no cambia la marca y otra organización no la ve", async () => {
    const staff = await createTestUser("brand-staff");
    await addMember(org, staff, "staff");
    await expect(
      withTenant(staff, org, (tx, ctx) => setSiteBranding(tx, ctx, est.id, { accentColor: null, fontPairing: null })),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const other = await createTestUser("brand-other");
    const otherOrg = await createTestOrganization(other, "MarcaAjena");
    await expect(withTenant(other, otherOrg, (tx, ctx) => setSiteLogo(tx, ctx, est.id, null))).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});
