import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import type { AuthUser } from "@/server/auth/service";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { createEstablishment, type Establishment } from "@/server/modules/establishments/service";
import { getPublicMedia } from "@/server/modules/media/service";
import { addItem, addSection, createMenu, publishMenu, unpublishMenu } from "@/server/modules/menus/menus";
import {
  createProduct,
  getProduct,
  setProductEstablishments,
  setProductImage,
  updateProduct,
} from "@/server/modules/menus/products";
import { addSpecial, getPublicSpecials, listSpecials, removeSpecial } from "@/server/modules/menus/specials";
import { withTenant } from "@/server/tenancy/context";
import { withAdminClient } from "../support/db";
import { addMember, createTestOrganization, createTestUser, uniqueSuffix } from "../support/factories";

// Fuera de carta (D-037).
describe("platos fuera de carta", () => {
  let owner: AuthUser;
  let org: string;
  let orgSlug: string;
  let est: Establishment;
  let other: Establishment;
  let menuId: string;
  let turbot: string;
  let squid: string;
  const asOwner = <T>(fn: Parameters<typeof withTenant<T>>[2]) => withTenant(owner, org, fn);
  const publicNames = async (lang: "es" | "en" = "es") =>
    (await getPublicSpecials(orgSlug, est.slug, lang)).map((s) => `${s.name} ${s.priceCents}`);

  beforeAll(async () => {
    owner = await createTestUser("specials-owner");
    org = await createTestOrganization(owner, "FueraCarta");
    orgSlug = (await withAdminClient((c) => c.query("SELECT slug FROM organizations WHERE id = $1", [org]))).rows[0]
      .slug;
    est = await asOwner((tx, ctx) =>
      createEstablishment(tx, ctx, { name: "Puerto", slug: `puerto-${uniqueSuffix()}` }),
    );
    other = await asOwner((tx, ctx) => createEstablishment(tx, ctx, { name: "Otro", slug: `otro-${uniqueSuffix()}` }));
    turbot = (
      await asOwner((tx, ctx) => createProduct(tx, ctx, { name: "Rodaballo", priceCents: 2800, allergens: ["fish"] }))
    ).id;
    squid = (
      await asOwner((tx, ctx) => createProduct(tx, ctx, { name: "Chipirones", priceCents: 1400, allergens: [] }))
    ).id;
    menuId = await asOwner(async (tx, ctx) => {
      const p = await createProduct(tx, ctx, { name: "Croquetas", priceCents: 900, allergens: [] });
      const menu = await createMenu(tx, ctx, est.id, { name: "Carta", slug: "carta" });
      const section = await addSection(tx, ctx, menu.id, { name: "Entrantes" });
      await addItem(tx, ctx, menu.id, section, { productId: p.id });
      return menu.id;
    });
  });

  it("solo se ven en un local con carta o web publicada", async () => {
    await asOwner((tx, ctx) => addSpecial(tx, ctx, est.id, { productId: turbot, priceOverrideCents: 2500 }));
    expect(await publicNames()).toEqual([]);
    await asOwner((tx, ctx) => publishMenu(tx, ctx, menuId));
    expect(await publicNames()).toEqual(["Rodaballo 2500"]);
    const listed = await asOwner((tx, ctx) => listSpecials(tx, ctx, est.id));
    expect(listed).toMatchObject([{ productName: "Rodaballo", priceCents: 2500, status: "visible" }]);
  });

  it("respeta la vigencia en la fecha local del establecimiento", async () => {
    await asOwner((tx, ctx) => addSpecial(tx, ctx, est.id, { productId: squid }));
    expect(await publicNames()).toEqual(["Rodaballo 2500", "Chipirones 1400"]);
    const setDates = (sql: string) =>
      withAdminClient((c) =>
        c.query(`UPDATE menu_specials SET ${sql} WHERE establishment_id = $1 AND product_id = $2`, [est.id, squid]),
      );
    const today = "(now() AT TIME ZONE 'Europe/Madrid')::date";
    await setDates(`starts_on = ${today} + 1, ends_on = NULL`);
    expect(await publicNames()).toEqual(["Rodaballo 2500"]);
    expect((await asOwner((tx, ctx) => listSpecials(tx, ctx, est.id)))[1]!.status).toBe("scheduled");
    await setDates(`starts_on = ${today} - 3, ends_on = ${today} - 1`);
    expect(await publicNames()).toEqual(["Rodaballo 2500"]);
    expect((await asOwner((tx, ctx) => listSpecials(tx, ctx, est.id)))[1]!.status).toBe("expired");
    await setDates(`starts_on = ${today}, ends_on = ${today}`);
    expect(await publicNames()).toEqual(["Rodaballo 2500", "Chipirones 1400"]);
    await expect(
      withAdminClient((c) =>
        c.query(
          `UPDATE menu_specials SET starts_on = ${today}, ends_on = ${today} - 1 WHERE establishment_id = $1 AND product_id = $2`,
          [est.id, squid],
        ),
      ),
    ).rejects.toThrow(/menu_specials_dates_check/);
  });

  it("rechaza duplicados, fechas al revés, productos archivados o no disponibles en el local", async () => {
    await expect(asOwner((tx, ctx) => addSpecial(tx, ctx, est.id, { productId: turbot }))).rejects.toThrow(
      ConflictError,
    );
    await expect(
      asOwner((tx, ctx) =>
        addSpecial(tx, ctx, other.id, { productId: turbot, startsOn: "2026-11-02", endsOn: "2026-11-01" }),
      ),
    ).rejects.toThrow(ValidationError);
    const onlyOther = await asOwner(async (tx, ctx) => {
      const p = await createProduct(tx, ctx, { name: "Solo en otro", priceCents: 100, allergens: [] });
      await setProductEstablishments(tx, ctx, p.id, { allEstablishments: false, establishmentIds: [other.id] });
      return p.id;
    });
    await expect(asOwner((tx, ctx) => addSpecial(tx, ctx, est.id, { productId: onlyOther }))).rejects.toThrow(
      ValidationError,
    );
    // El trigger lo impide también escribiendo directamente.
    await expect(
      withAdminClient((c) =>
        c.query("INSERT INTO menu_specials (organization_id, establishment_id, product_id) VALUES ($1, $2, $3)", [
          org,
          est.id,
          onlyOther,
        ]),
      ),
    ).rejects.toThrow(/product_not_available/);
    // Archivar el producto lo retira de la web sin borrar el plato fuera de carta.
    await asOwner((tx, ctx) => updateProduct(tx, ctx, squid, { active: false }));
    expect(await publicNames()).toEqual(["Rodaballo 2500"]);
    expect((await asOwner((tx, ctx) => listSpecials(tx, ctx, est.id)))[1]!.status).toBe("archived");
    await asOwner((tx, ctx) => updateProduct(tx, ctx, squid, { active: true }));
  });

  it("traduce con el catálogo y publica su foto solo mientras se ve", async () => {
    await withAdminClient(async (c) => {
      await c.query("UPDATE establishments SET languages = '{en}' WHERE id = $1", [est.id]);
      await c.query(`UPDATE menu_products SET i18n = '{"en": {"name": "Turbot"}}' WHERE id = $1`, [turbot]);
    });
    expect(await publicNames("en")).toEqual(["Turbot 2500", "Chipirones 1400"]);

    const bytes = new Uint8Array(
      await sharp({ create: { width: 40, height: 40, channels: 3, background: "#336699" } })
        .png()
        .toBuffer(),
    );
    await asOwner((tx, ctx) => setProductImage(tx, ctx, squid, bytes));
    const imageId = (await asOwner((tx, ctx) => getProduct(tx, ctx, squid))).imageMediaId!;
    expect((await getPublicSpecials(orgSlug, est.slug, "es"))[1]!.imageId).toBe(imageId);
    expect(await getPublicMedia(imageId)).not.toBeNull();
    const special = (await asOwner((tx, ctx) => listSpecials(tx, ctx, est.id)))[1]!;
    await asOwner((tx, ctx) => removeSpecial(tx, ctx, est.id, special.id));
    expect(await getPublicMedia(imageId)).toBeNull();
    // Sin carta ni web publicadas, nada es público.
    await asOwner((tx, ctx) => unpublishMenu(tx, ctx, menuId));
    expect(await publicNames()).toEqual([]);
    await asOwner((tx, ctx) => publishMenu(tx, ctx, menuId));
  });

  it("el personal no los cambia y otra organización no los ve ni los toca", async () => {
    const staff = await createTestUser("specials-staff");
    await addMember(org, staff, "staff");
    expect(await withTenant(staff, org, (tx, ctx) => listSpecials(tx, ctx, est.id))).toHaveLength(1);
    await expect(
      withTenant(staff, org, (tx, ctx) => addSpecial(tx, ctx, est.id, { productId: squid })),
    ).rejects.toThrow(ForbiddenError);
    const outsider = await createTestUser("specials-outsider");
    const outsiderOrg = await createTestOrganization(outsider, "FueraAjena");
    await expect(withTenant(outsider, outsiderOrg, (tx, ctx) => listSpecials(tx, ctx, est.id))).rejects.toThrow(
      NotFoundError,
    );
    const special = (await asOwner((tx, ctx) => listSpecials(tx, ctx, est.id)))[0]!;
    await expect(
      withTenant(outsider, outsiderOrg, (tx, ctx) => removeSpecial(tx, ctx, est.id, special.id)),
    ).rejects.toThrow(NotFoundError);
    expect(await publicNames()).toEqual(["Rodaballo 2500"]);
  });
});
