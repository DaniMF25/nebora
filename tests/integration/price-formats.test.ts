import { beforeAll, describe, expect, it } from "vitest";
import type { AuthUser } from "@/server/auth/service";
import { ValidationError } from "@/server/errors";
import { createEstablishment, type Establishment } from "@/server/modules/establishments/service";
import {
  addItem,
  addSection,
  buildSnapshot,
  createMenu,
  getPublishedMenu,
  publishMenu,
  setItemPrice,
} from "@/server/modules/menus/menus";
import { createProduct, getProduct, updateProduct } from "@/server/modules/menus/products";
import { addSpecial, getPublicSpecials } from "@/server/modules/menus/specials";
import { withTenant, type TenantContext } from "@/server/tenancy/context";
import type { Tx } from "@/server/db/pool";
import { withAdminClient } from "../support/db";
import { createTestOrganization, createTestUser, uniqueSuffix } from "../support/factories";

const FORMATS = [
  { label: "Media ración", priceCents: 600 },
  { label: "Ración", priceCents: 1000 },
];

// Formatos de precio por plato (D-038).
describe("formatos de precio", () => {
  let owner: AuthUser;
  let org: string;
  let orgSlug: string;
  let est: Establishment;
  const asOwner = <T>(fn: (tx: Tx, ctx: TenantContext) => Promise<T>) => withTenant(owner, org, fn);

  beforeAll(async () => {
    owner = await createTestUser("formats-owner");
    org = await createTestOrganization(owner, "Formatos");
    orgSlug = (await withAdminClient((c) => c.query("SELECT slug FROM organizations WHERE id = $1", [org]))).rows[0]
      .slug;
    est = await asOwner((tx, ctx) => createEstablishment(tx, ctx, { name: "Barra", slug: `barra-${uniqueSuffix()}` }));
  });

  it("con formatos, el precio del producto es el más bajo; se puede volver a precio único", async () => {
    const p = await asOwner((tx, ctx) =>
      createProduct(tx, ctx, { name: "Calamares", priceCents: 0, formats: [...FORMATS].reverse(), allergens: [] }),
    );
    expect(p.priceCents).toBe(600);
    expect(p.formats).toEqual([...FORMATS].reverse());
    const single = await asOwner((tx, ctx) => updateProduct(tx, ctx, p.id, { priceCents: 1200, formats: null }));
    expect(single).toMatchObject({ priceCents: 1200, formats: null });
    const again = await asOwner((tx, ctx) => updateProduct(tx, ctx, p.id, { priceCents: 0, formats: FORMATS }));
    expect(again.priceCents).toBe(600);
    // Cambiar solo el precio de un plato con formatos se rechaza.
    await expect(asOwner((tx, ctx) => updateProduct(tx, ctx, p.id, { priceCents: 700 }))).rejects.toThrow(
      ValidationError,
    );
  });

  it("rechaza menos de 2 o más de 6 formatos, nombres repetidos o vacíos; la BD, formas inválidas", async () => {
    const create = (formats: unknown) =>
      asOwner((tx, ctx) => createProduct(tx, ctx, { name: "Malo", priceCents: 0, formats, allergens: [] }));
    await expect(create([FORMATS[0]])).rejects.toThrow(ValidationError);
    await expect(create(Array.from({ length: 7 }, (_, i) => ({ label: `F${i}`, priceCents: 100 })))).rejects.toThrow(
      ValidationError,
    );
    await expect(create([FORMATS[0], { label: "media RACIÓN", priceCents: 700 }])).rejects.toThrow(ValidationError);
    await expect(create([FORMATS[0], { label: "  ", priceCents: 700 }])).rejects.toThrow(ValidationError);
    const id = (await asOwner((tx, ctx) => createProduct(tx, ctx, { name: "Ok", priceCents: 100, allergens: [] }))).id;
    for (const bad of [
      '[{"label": "A", "priceCents": 1}]',
      '[{"label": "A"}, {"label": "B"}]',
      '[{"label": 1, "priceCents": 1}, {"label": "B", "priceCents": 2}]',
    ]) {
      await expect(
        withAdminClient((c) => c.query("UPDATE menu_products SET formats = $2::jsonb WHERE id = $1", [id, bad])),
      ).rejects.toThrow(/menu_products_formats_shape/);
    }
  });

  it("la carta publicada lleva los formatos y no admite precio propio para ese plato", async () => {
    const { menuId, itemId } = await asOwner(async (tx, ctx) => {
      const product = await createProduct(tx, ctx, { name: "Pulpo", priceCents: 0, formats: FORMATS, allergens: [] });
      const menu = await createMenu(tx, ctx, est.id, { name: "Carta", slug: "carta" });
      const section = await addSection(tx, ctx, menu.id, { name: "Raciones" });
      await expect(
        addItem(tx, ctx, menu.id, section, { productId: product.id, priceOverrideCents: 900 }),
      ).rejects.toThrow(ValidationError);
      return { menuId: menu.id, itemId: await addItem(tx, ctx, menu.id, section, { productId: product.id }) };
    });
    await expect(
      asOwner((tx, ctx) => setItemPrice(tx, ctx, menuId, itemId, { priceOverrideCents: 900 })),
    ).rejects.toThrow(ValidationError);
    // Quitar el precio propio sí se puede.
    await asOwner((tx, ctx) => setItemPrice(tx, ctx, menuId, itemId, { priceOverrideCents: null }));
    // Un precio propio anterior a los formatos no se aplica.
    await withAdminClient((c) => c.query("UPDATE menu_items SET price_override_cents = 999 WHERE id = $1", [itemId]));
    const snapshot = await asOwner((tx, ctx) => buildSnapshot(tx, ctx, menuId));
    expect(snapshot.sections[0]!.items[0]).toMatchObject({ name: "Pulpo", priceCents: 600, formats: FORMATS });
    await asOwner((tx, ctx) => publishMenu(tx, ctx, menuId));
    const published = await getPublishedMenu(orgSlug, est.slug, "carta");
    expect(published?.snapshot.sections[0]!.items[0]!.formats).toEqual(FORMATS);
  });

  it("fuera de carta muestra los formatos y no admite precio especial para ellos", async () => {
    const product = await asOwner((tx, ctx) =>
      createProduct(tx, ctx, {
        name: "Vino",
        priceCents: 0,
        formats: [
          { label: "Copa", priceCents: 350 },
          { label: "Botella", priceCents: 1800 },
        ],
        allergens: ["sulphites"],
      }),
    );
    await expect(
      asOwner((tx, ctx) => addSpecial(tx, ctx, est.id, { productId: product.id, priceOverrideCents: 300 })),
    ).rejects.toThrow(ValidationError);
    await asOwner((tx, ctx) => addSpecial(tx, ctx, est.id, { productId: product.id }));
    const [special] = await getPublicSpecials(orgSlug, est.slug, "es");
    expect(special).toMatchObject({
      name: "Vino",
      priceCents: 350,
      formats: [{ label: "Copa" }, { label: "Botella" }],
    });
    expect((await asOwner((tx, ctx) => getProduct(tx, ctx, product.id))).formats).toHaveLength(2);
  });
});
