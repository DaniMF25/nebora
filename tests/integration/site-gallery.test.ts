import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import type { AuthUser } from "@/server/auth/service";
import type { Tx } from "@/server/db/pool";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { createEstablishment, type Establishment } from "@/server/modules/establishments/service";
import { getPublicMedia } from "@/server/modules/media/service";
import {
  addGalleryImage,
  getPublicGallery,
  listGallery,
  MAX_GALLERY_IMAGES,
  moveGalleryImage,
  removeGalleryImage,
  setGalleryCaption,
} from "@/server/modules/site/gallery";
import { setSitePublished, updateSiteProfile } from "@/server/modules/site/service";
import { withTenant, type TenantContext } from "@/server/tenancy/context";
import { withAdminClient } from "../support/db";
import { addMember, createTestOrganization, createTestUser, uniqueSuffix } from "../support/factories";

async function png(color = "#336699"): Promise<Uint8Array> {
  return new Uint8Array(
    await sharp({ create: { width: 40, height: 30, channels: 3, background: color } })
      .png()
      .toBuffer(),
  );
}

// Galería de la web (D-039).
describe("galería de la web", () => {
  let owner: AuthUser;
  let org: string;
  let est: Establishment;
  const asOwner = <T>(fn: (tx: Tx, ctx: TenantContext) => Promise<T>) => withTenant(owner, org, fn);
  const captions = async () => (await asOwner((tx, ctx) => listGallery(tx, ctx, est.id))).map((g) => g.caption);

  beforeAll(async () => {
    owner = await createTestUser("gallery-owner");
    org = await createTestOrganization(owner, "Galeria");
    est = await asOwner((tx, ctx) =>
      createEstablishment(tx, ctx, { name: "Puerto", slug: `puerto-${uniqueSuffix()}` }),
    );
  });

  it("añade fotos con pie, las ordena y cambia el pie", async () => {
    for (const caption of ["Terraza", "", "Cocina"]) {
      await asOwner(async (tx, ctx) => addGalleryImage(tx, ctx, est.id, await png(), { caption }));
    }
    expect(await captions()).toEqual(["Terraza", null, "Cocina"]);
    const [first, second] = await asOwner((tx, ctx) => listGallery(tx, ctx, est.id));
    await asOwner((tx, ctx) => moveGalleryImage(tx, ctx, est.id, second!.id, "up"));
    expect(await captions()).toEqual([null, "Terraza", "Cocina"]);
    // Mover la primera hacia arriba no cambia nada.
    await asOwner((tx, ctx) => moveGalleryImage(tx, ctx, est.id, second!.id, "up"));
    expect(await captions()).toEqual([null, "Terraza", "Cocina"]);
    await asOwner((tx, ctx) => setGalleryCaption(tx, ctx, est.id, second!.id, { caption: "Comedor" }));
    await asOwner((tx, ctx) => setGalleryCaption(tx, ctx, est.id, first!.id, { caption: "  " }));
    expect(await captions()).toEqual(["Comedor", null, "Cocina"]);
    await expect(
      asOwner((tx, ctx) => setGalleryCaption(tx, ctx, est.id, first!.id, { caption: "x".repeat(121) })),
    ).rejects.toThrow(ValidationError);
    await expect(asOwner((tx, ctx) => moveGalleryImage(tx, ctx, est.id, first!.id, "left"))).rejects.toThrow(
      ValidationError,
    );
  });

  it("rechaza archivos que no son imágenes y respeta el máximo", async () => {
    await expect(
      asOwner((tx, ctx) => addGalleryImage(tx, ctx, est.id, new TextEncoder().encode("<svg/>"), {})),
    ).rejects.toThrow(ValidationError);
    const other = await asOwner((tx, ctx) =>
      createEstablishment(tx, ctx, { name: "Lleno", slug: `lleno-${uniqueSuffix()}` }),
    );
    const bytes = await png("#112233");
    await asOwner(async (tx, ctx) => {
      for (let i = 0; i < MAX_GALLERY_IMAGES; i++) await addGalleryImage(tx, ctx, other.id, bytes, {});
    });
    await expect(asOwner((tx, ctx) => addGalleryImage(tx, ctx, other.id, bytes, {}))).rejects.toThrow(ValidationError);
  });

  it("solo es pública con la web publicada; quitar una foto borra el archivo", async () => {
    expect(await getPublicGallery(est.id)).toEqual([]);
    await asOwner(async (tx, ctx) => {
      await updateSiteProfile(tx, ctx, est.id, {
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
      });
      await setSitePublished(tx, ctx, est.id, { published: true });
    });
    const gallery = await getPublicGallery(est.id);
    expect(gallery.map((g) => g.caption)).toEqual(["Comedor", null, "Cocina"]);
    expect(await getPublicMedia(gallery[2]!.mediaId)).not.toBeNull();

    const last = (await asOwner((tx, ctx) => listGallery(tx, ctx, est.id)))[2]!;
    await asOwner((tx, ctx) => removeGalleryImage(tx, ctx, est.id, last.id));
    expect(await captions()).toEqual(["Comedor", null]);
    const { rowCount } = await withAdminClient((c) =>
      c.query("SELECT 1 FROM media_assets WHERE id = $1", [last.mediaId]),
    );
    expect(rowCount).toBe(0);

    await asOwner((tx, ctx) => setSitePublished(tx, ctx, est.id, { published: false }));
    expect(await getPublicGallery(est.id)).toEqual([]);
    expect(await getPublicMedia(gallery[0]!.mediaId)).toBeNull();
  });

  it("el personal no la cambia y otra organización no la ve ni la toca", async () => {
    const staff = await createTestUser("gallery-staff");
    await addMember(org, staff, "staff");
    await expect(
      withTenant(staff, org, async (tx, ctx) => addGalleryImage(tx, ctx, est.id, await png(), {})),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const image = (await asOwner((tx, ctx) => listGallery(tx, ctx, est.id)))[0]!;
    const outsider = await createTestUser("gallery-outsider");
    const outsiderOrg = await createTestOrganization(outsider, "GaleriaAjena");
    await expect(withTenant(outsider, outsiderOrg, (tx, ctx) => listGallery(tx, ctx, est.id))).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      withTenant(outsider, outsiderOrg, (tx, ctx) => removeGalleryImage(tx, ctx, est.id, image.id)),
    ).rejects.toBeInstanceOf(NotFoundError);
    // Con un local propio, tampoco puede usar el id de una foto ajena.
    const own = await withTenant(outsider, outsiderOrg, (tx, ctx) =>
      createEstablishment(tx, ctx, { name: "Suyo", slug: `suyo-${uniqueSuffix()}` }),
    );
    await expect(
      withTenant(outsider, outsiderOrg, (tx, ctx) => setGalleryCaption(tx, ctx, own.id, image.id, { caption: "x" })),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(await captions()).toEqual(["Comedor", null]);
  });
});
