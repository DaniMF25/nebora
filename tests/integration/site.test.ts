import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import type { AuthUser } from "@/server/auth/service";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { createEstablishment, type Establishment } from "@/server/modules/establishments/service";
import { getOrganizationMedia, getPublicMedia, MAX_IMAGE_SIDE } from "@/server/modules/media/service";
import {
  addItem,
  addSection,
  createMenu,
  getMenuDraft,
  getPublishedMenu,
  publishMenu,
  setItemRecommended,
  unpublishMenu,
} from "@/server/modules/menus/menus";
import { createProduct, getProduct, setProductImage } from "@/server/modules/menus/products";
import { createOrganization } from "@/server/modules/organizations/service";
import { setWeeklyHours } from "@/server/modules/schedules/service";
import {
  getPublicSite,
  getSitePreview,
  getSiteProfile,
  setSiteHeroImage,
  setSiteTheme,
  updateSiteProfile,
} from "@/server/modules/site/service";
import { withTenant, withUser } from "@/server/tenancy/context";
import { withAdminClient } from "../support/db";
import { addMember, createTestOrganization, createTestUser, uniqueSuffix } from "../support/factories";

interface Fixture {
  owner: AuthUser;
  org: string;
  orgSlug: string;
  est: Establishment;
}

async function setupRestaurant(label: string): Promise<Fixture> {
  const owner = await createTestUser(`${label}-owner`);
  const org = await createTestOrganization(owner, label);
  const { rows } = await withAdminClient((c) => c.query("SELECT slug FROM organizations WHERE id = $1", [org]));
  const est = await withTenant(owner, org, (tx, ctx) =>
    createEstablishment(tx, ctx, {
      name: `Local ${label}`,
      slug: `local-${uniqueSuffix()}`,
    }),
  );
  return { owner, org, orgSlug: rows[0].slug, est };
}

/** JPEG grande con metadatos EXIF que no deben llegar a guardarse. */
async function photo(width = 2400, height = 1200, color = "#336699"): Promise<Uint8Array> {
  const buf = await sharp({
    create: { width, height, channels: 3, background: color },
  })
    .jpeg()
    .withExif({ IFD0: { Artist: "dato-privado", Copyright: "dato-privado" } })
    .toBuffer();
  return new Uint8Array(buf);
}

const baseProfile = {
  theme: "mediterraneo",
  tagline: "Cocina de mar",
  heroEyebrow: "Bienvenidos",
  heroTitle: "Sabores que te llevan al mar",
  heroText: "Producto del día y vistas al puerto.",
  phone: "+34 912 345 678",
  whatsapp: "+34 600 11 22 33",
  instagram: "https://www.instagram.com/altamar.test/",
  highlights: [
    { icon: "fish", title: "Pescado del día", text: "De la lonja cada mañana" },
    { icon: "wine", title: "Bodega", text: "" },
  ],
  featuredMenuId: null,
  published: true,
};

describe("imágenes: validación y reprocesado", () => {
  let f: Fixture;
  let productId: string;

  beforeAll(async () => {
    f = await setupRestaurant("img");
    productId = await withTenant(
      f.owner,
      f.org,
      async (tx, ctx) => (await createProduct(tx, ctx, { name: "Lubina", priceCents: 2200 })).id,
    );
  });

  it("guarda una copia WebP reducida y sin metadatos", async () => {
    await withTenant(f.owner, f.org, async (tx, ctx) => setProductImage(tx, ctx, productId, await photo()));
    const product = await withTenant(f.owner, f.org, (tx, ctx) => getProduct(tx, ctx, productId));
    expect(product.imageMediaId).toBeTruthy();
    const file = await withTenant(f.owner, f.org, (tx, ctx) => getOrganizationMedia(tx, ctx, product.imageMediaId!));
    expect(file.contentType).toBe("image/webp");
    const meta = await sharp(file.data).metadata();
    expect(meta.format).toBe("webp");
    expect(Math.max(meta.width!, meta.height!)).toBe(MAX_IMAGE_SIDE);
    expect(meta.exif).toBeUndefined();
    expect(file.data.includes(Buffer.from("dato-privado"))).toBe(false);
  });

  it("rechaza archivos que no son imágenes aunque se declaren como tales", async () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const fakeJpeg = new Uint8Array([
      0xff,
      0xd8,
      0xff,
      0xe0,
      ...new TextEncoder().encode("<html>no soy un jpeg</html>"),
    ]);
    for (const bytes of [svg, fakeJpeg, new Uint8Array()]) {
      await expect(
        withTenant(f.owner, f.org, (tx, ctx) => setProductImage(tx, ctx, productId, bytes)),
      ).rejects.toBeInstanceOf(ValidationError);
    }
  });

  it("el personal sin permiso de edición no puede subir fotos", async () => {
    const staff = await createTestUser("img-staff");
    await addMember(f.org, staff, "staff");
    await expect(
      withTenant(staff, f.org, async (tx, ctx) => setProductImage(tx, ctx, productId, await photo(10, 10))),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("otra organización no puede leer la imagen ni asociarla", async () => {
    const product = await withTenant(f.owner, f.org, (tx, ctx) => getProduct(tx, ctx, productId));
    const other = await setupRestaurant("img-other");
    await expect(
      withTenant(other.owner, other.org, (tx, ctx) => getOrganizationMedia(tx, ctx, product.imageMediaId!)),
    ).rejects.toBeInstanceOf(NotFoundError);
    // La FK compuesta impide apuntar a una imagen ajena incluso escribiendo directamente.
    await expect(
      withAdminClient(async (c) => {
        const p = await c.query(
          "INSERT INTO menu_products (organization_id, name, price_cents) VALUES ($1, 'x', 1) RETURNING id",
          [other.org],
        );
        await c.query("UPDATE menu_products SET image_media_id = $2 WHERE id = $1", [
          p.rows[0].id,
          product.imageMediaId,
        ]);
      }),
    ).rejects.toMatchObject({ code: "23503" });
  });
});

describe("imágenes públicas: solo las del contenido publicado", () => {
  let f: Fixture;
  let menuId: string;
  let productId: string;
  let itemId: string;

  beforeAll(async () => {
    f = await setupRestaurant("pubimg");
    ({ menuId, productId, itemId } = await withTenant(f.owner, f.org, async (tx, ctx) => {
      const product = await createProduct(tx, ctx, {
        name: "Pulpo",
        priceCents: 1800,
      });
      const menu = await createMenu(tx, ctx, f.est.id, {
        name: "Carta",
        slug: "carta",
        theme: "mediterraneo",
      });
      const section = await addSection(tx, ctx, menu.id, { name: "Del mar" });
      const item = await addItem(tx, ctx, menu.id, section, {
        productId: product.id,
      });
      return { menuId: menu.id, productId: product.id, itemId: item };
    }));
  });

  it("la foto de un producto no se sirve hasta publicar una carta que la incluya, y deja de servirse al despublicar", async () => {
    await withTenant(f.owner, f.org, async (tx, ctx) => setProductImage(tx, ctx, productId, await photo(800, 600)));
    const first = (await withTenant(f.owner, f.org, (tx, ctx) => getProduct(tx, ctx, productId))).imageMediaId!;
    expect(await getPublicMedia(first)).toBeNull();

    await withTenant(f.owner, f.org, async (tx, ctx) => {
      await setItemRecommended(tx, ctx, menuId, itemId, { recommended: true });
      await publishMenu(tx, ctx, menuId);
    });
    const published = await getPublishedMenu(f.orgSlug, f.est.slug, "carta");
    expect(published!.snapshot.sections[0]!.items[0]).toMatchObject({
      name: "Pulpo",
      imageId: first,
      recommended: true,
    });
    expect((await getPublicMedia(first))?.contentType).toBe("image/webp");

    // Al cambiar la foto, la carta publicada mantiene la suya y la nueva no es pública hasta republicar.
    await withTenant(f.owner, f.org, async (tx, ctx) =>
      setProductImage(tx, ctx, productId, await photo(800, 600, "#aa3300")),
    );
    const second = (await withTenant(f.owner, f.org, (tx, ctx) => getProduct(tx, ctx, productId))).imageMediaId!;
    expect(second).not.toBe(first);
    expect(await getPublicMedia(first)).not.toBeNull();
    expect(await getPublicMedia(second)).toBeNull();

    await withTenant(f.owner, f.org, (tx, ctx) => unpublishMenu(tx, ctx, menuId));
    expect(await getPublicMedia(first)).toBeNull();
  });

  it("el borrador refleja la foto y la marca de recomendado; los datos ajenos no", async () => {
    const draft = await withTenant(f.owner, f.org, (tx, ctx) => getMenuDraft(tx, ctx, menuId));
    expect(draft.sections[0]!.items[0]).toMatchObject({ recommended: true });
    const other = await setupRestaurant("pubimg-other");
    await expect(
      withTenant(other.owner, other.org, (tx, ctx) =>
        setItemRecommended(tx, ctx, menuId, itemId, { recommended: false }),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("identificadores mal formados o inexistentes no se sirven", async () => {
    expect(await getPublicMedia("no-es-uuid")).toBeNull();
    expect(await getPublicMedia("00000000-0000-4000-8000-000000000000")).toBeNull();
  });
});

describe("página pública del local", () => {
  let f: Fixture;

  beforeAll(async () => {
    f = await setupRestaurant("site");
    await withTenant(f.owner, f.org, (tx, ctx) =>
      setWeeklyHours(tx, ctx, f.est.id, {
        slots: [{ weekday: 5, opens: "20:00", closes: "23:30" }],
      }),
    );
  });

  it("sin perfil o sin publicar no hay página pública", async () => {
    expect(await getPublicSite(f.orgSlug, f.est.slug)).toBeNull();
    const profile = await withTenant(f.owner, f.org, (tx, ctx) => getSiteProfile(tx, ctx, f.est.id));
    expect(profile).toMatchObject({ published: false, highlights: [] });
    await withTenant(f.owner, f.org, (tx, ctx) =>
      updateSiteProfile(tx, ctx, f.est.id, {
        ...baseProfile,
        published: false,
      }),
    );
    expect(await getPublicSite(f.orgSlug, f.est.slug)).toBeNull();
  });

  it("no se puede publicar sin titular", async () => {
    await expect(
      withTenant(f.owner, f.org, (tx, ctx) => updateSiteProfile(tx, ctx, f.est.id, { ...baseProfile, heroTitle: "" })),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("valida los campos y normaliza WhatsApp e Instagram", async () => {
    for (const bad of [
      { instagram: "no válido con espacios" },
      { whatsapp: "llámame" },
      {
        highlights: [1, 2, 3, 4].map(() => ({
          icon: "star",
          title: "x",
          text: "",
        })),
      },
      { highlights: [{ icon: "calavera", title: "x", text: "" }] },
      { theme: "neon" },
      { heroText: "x".repeat(401) },
      { organizationId: f.org },
    ]) {
      await expect(
        withTenant(f.owner, f.org, (tx, ctx) => updateSiteProfile(tx, ctx, f.est.id, { ...baseProfile, ...bad })),
      ).rejects.toBeInstanceOf(ValidationError);
    }
    const saved = await withTenant(f.owner, f.org, (tx, ctx) => updateSiteProfile(tx, ctx, f.est.id, baseProfile));
    expect(saved).toMatchObject({
      whatsapp: "34600112233",
      instagram: "altamar.test",
      published: true,
    });
  });

  it("publicada: muestra contenido, horario real y solo la carta destacada si está publicada", async () => {
    const menu = await withTenant(f.owner, f.org, async (tx, ctx) => {
      const p = await createProduct(tx, ctx, {
        name: "Arroz",
        priceCents: 1600,
      });
      const m = await createMenu(tx, ctx, f.est.id, {
        name: "Carta",
        slug: "carta",
        theme: "mediterraneo",
      });
      const s = await addSection(tx, ctx, m.id, { name: "Arroces" });
      await addItem(tx, ctx, m.id, s, { productId: p.id });
      await updateSiteProfile(tx, ctx, f.est.id, {
        ...baseProfile,
        featuredMenuId: m.id,
      });
      return m;
    });
    let site = await getPublicSite(f.orgSlug, f.est.slug);
    expect(site).toMatchObject({
      heroTitle: baseProfile.heroTitle,
      theme: "mediterraneo",
      featuredMenuSlug: null,
      bookingEnabled: false,
      openingHours: [{ weekday: 5, opensMinute: 1200, durationMinutes: 210 }],
    });
    expect(site!.highlights).toHaveLength(2);

    await withTenant(f.owner, f.org, (tx, ctx) => publishMenu(tx, ctx, menu.id));
    site = await getPublicSite(f.orgSlug, f.est.slug);
    expect(site).toMatchObject({
      featuredMenuSlug: "carta",
      featuredMenuCode: menu.publicCode,
    });
    // Los slugs no distinguen mayúsculas y los mal formados no consultan nada.
    expect(await getPublicSite(f.orgSlug.toUpperCase(), f.est.slug)).not.toBeNull();
    expect(await getPublicSite("../x", f.est.slug)).toBeNull();
  });

  it("la foto principal solo es pública mientras la página está publicada", async () => {
    await withTenant(f.owner, f.org, async (tx, ctx) => setSiteHeroImage(tx, ctx, f.est.id, await photo(1600, 900)));
    const heroId = (await getPublicSite(f.orgSlug, f.est.slug))!.heroMediaId!;
    expect(await getPublicMedia(heroId)).not.toBeNull();
    await withTenant(f.owner, f.org, (tx, ctx) =>
      updateSiteProfile(tx, ctx, f.est.id, {
        ...baseProfile,
        published: false,
      }),
    );
    expect(await getPublicMedia(heroId)).toBeNull();
    await withTenant(f.owner, f.org, (tx, ctx) => updateSiteProfile(tx, ctx, f.est.id, baseProfile));
    await withTenant(f.owner, f.org, (tx, ctx) => setSiteHeroImage(tx, ctx, f.est.id, null));
    expect(await getPublicMedia(heroId)).toBeNull();
  });

  it("la carta destacada debe ser de este local y de esta organización", async () => {
    const otherEstMenu = await withTenant(f.owner, f.org, async (tx, ctx) => {
      const e = await createEstablishment(tx, ctx, {
        name: "Otro local",
        slug: `otro-${uniqueSuffix()}`,
      });
      return (await createMenu(tx, ctx, e.id, { name: "Carta", slug: "carta" })).id;
    });
    const foreign = await setupRestaurant("site-foreign");
    const foreignMenu = await withTenant(
      foreign.owner,
      foreign.org,
      async (tx, ctx) =>
        (
          await createMenu(tx, ctx, foreign.est.id, {
            name: "Carta",
            slug: "carta",
          })
        ).id,
    );
    for (const featuredMenuId of [otherEstMenu, foreignMenu]) {
      await expect(
        withTenant(f.owner, f.org, (tx, ctx) =>
          updateSiteProfile(tx, ctx, f.est.id, {
            ...baseProfile,
            featuredMenuId,
          }),
        ),
      ).rejects.toBeInstanceOf(ValidationError);
    }
  });

  it("el personal no puede editar y otra organización no ve ni edita el perfil", async () => {
    const staff = await createTestUser("site-staff");
    await addMember(f.org, staff, "staff");
    await expect(
      withTenant(staff, f.org, (tx, ctx) => updateSiteProfile(tx, ctx, f.est.id, baseProfile)),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      withTenant(staff, f.org, (tx, ctx) => setSiteHeroImage(tx, ctx, f.est.id, null)),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const other = await setupRestaurant("site-other");
    for (const op of [
      (tx: Parameters<Parameters<typeof withTenant>[2]>[0], ctx: Parameters<Parameters<typeof withTenant>[2]>[1]) =>
        getSiteProfile(tx, ctx, f.est.id),
      (tx: Parameters<Parameters<typeof withTenant>[2]>[0], ctx: Parameters<Parameters<typeof withTenant>[2]>[1]) =>
        updateSiteProfile(tx, ctx, f.est.id, baseProfile),
    ]) {
      await expect(withTenant(other.owner, other.org, op)).rejects.toBeInstanceOf(NotFoundError);
    }
  });
});

describe("identificadores de organización reservados", () => {
  it("no se puede crear una organización con el nombre de una ruta de la aplicación", async () => {
    const user = await createTestUser("reserved");
    for (const slug of ["app", "login", "media", "r"]) {
      await expect(
        withUser(user, (tx, ctx) => createOrganization(tx, ctx, { name: "X", slug })),
      ).rejects.toBeInstanceOf(ValidationError);
    }
    await expect(
      withAdminClient((c) => c.query("INSERT INTO organizations (name, slug) VALUES ('X', 'app')")),
    ).rejects.toMatchObject({ code: "23514" });
  });
});

describe("estilo y vista previa de la web", () => {
  it("cambiar el estilo no toca el contenido; la vista previa funciona sin publicar y solo para miembros", async () => {
    const f = await setupRestaurant("theme");
    await withTenant(f.owner, f.org, (tx, ctx) =>
      updateSiteProfile(tx, ctx, f.est.id, { ...baseProfile, theme: "clasico", published: false }),
    );
    await withTenant(f.owner, f.org, (tx, ctx) => setSiteTheme(tx, ctx, f.est.id, { theme: "futurista" }));
    const profile = await withTenant(f.owner, f.org, (tx, ctx) => getSiteProfile(tx, ctx, f.est.id));
    expect(profile).toMatchObject({ theme: "futurista", heroTitle: baseProfile.heroTitle, published: false });
    await expect(
      withTenant(f.owner, f.org, (tx, ctx) => setSiteTheme(tx, ctx, f.est.id, { theme: "neon" })),
    ).rejects.toBeInstanceOf(ValidationError);

    // Vista previa sin publicar: los datos guardados, sin carta destacada (no hay ninguna publicada).
    const preview = await withTenant(f.owner, f.org, (tx, ctx) => getSitePreview(tx, ctx, f.est.id));
    expect(preview).toMatchObject({
      establishmentName: f.est.name,
      organizationSlug: f.orgSlug,
      featuredMenuSlug: null,
      bookingEnabled: false,
    });
    expect(preview.profile.published).toBe(false);
    expect(await getPublicSite(f.orgSlug, f.est.slug)).toBeNull();

    // El personal la ve pero no cambia el estilo; otra organización no ve nada.
    const staff = await createTestUser("theme-staff");
    await addMember(f.org, staff, "staff");
    await expect(withTenant(staff, f.org, (tx, ctx) => getSitePreview(tx, ctx, f.est.id))).resolves.toBeDefined();
    await expect(
      withTenant(staff, f.org, (tx, ctx) => setSiteTheme(tx, ctx, f.est.id, { theme: "moderno" })),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const other = await setupRestaurant("theme-other");
    await expect(withTenant(other.owner, other.org, (tx, ctx) => getSitePreview(tx, ctx, f.est.id))).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      withTenant(other.owner, other.org, (tx, ctx) => setSiteTheme(tx, ctx, f.est.id, { theme: "moderno" })),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

