import { describe, expect, it } from "vitest";
import { createEstablishment } from "@/server/modules/establishments/service";
import { addItem, addSection, createMenu, getPublishedMenu, publishMenu } from "@/server/modules/menus/menus";
import { createProduct, updateProduct } from "@/server/modules/menus/products";
import { updateOrganization } from "@/server/modules/organizations/service";
import { withTenant } from "@/server/tenancy/context";
import { withAdminClient } from "../support/db";
import { addMember, createTestOrganization, createTestUser, uniqueSuffix } from "../support/factories";

// Publicación automática de las cartas publicadas (D-048).
describe("publicación automática", () => {
  it("un plato en varias cartas: cambiarlo publica todas las que ya estaban publicadas", async () => {
    const owner = await createTestUser("auto-owner");
    const org = await createTestOrganization(owner, "Auto");
    const orgSlug = (await withAdminClient((c) => c.query("SELECT slug FROM organizations WHERE id = $1", [org])))
      .rows[0].slug as string;
    const estSlug = `local-${uniqueSuffix()}`;
    const ids = await withTenant(owner, org, async (tx, ctx) => {
      const est = await createEstablishment(tx, ctx, { name: "Local", slug: estSlug });
      const dish = await createProduct(tx, ctx, { name: "Paella", priceCents: 1400 });
      const menus: string[] = [];
      for (const slug of ["mediodia", "noche", "borrador"]) {
        const menu = await createMenu(tx, ctx, est.id, { name: slug, slug });
        const section = await addSection(tx, ctx, menu.id, { name: "Arroces" });
        await addItem(tx, ctx, menu.id, section, { productId: dish.id });
        menus.push(menu.id);
      }
      await publishMenu(tx, ctx, menus[0]!);
      await publishMenu(tx, ctx, menus[1]!);
      return { dish: dish.id };
    });
    const published = (slug: string) => getPublishedMenu(orgSlug, estSlug, slug);

    await withTenant(owner, org, (tx, ctx) => updateProduct(tx, ctx, ids.dish, { priceCents: 1550 }));
    for (const slug of ["mediodia", "noche"]) {
      const m = (await published(slug))!;
      expect([m.versionNumber, m.snapshot.sections[0]!.items[0]!.priceCents]).toEqual([2, 1550]);
    }
    // La carta que nunca se publicó sigue sin publicar.
    expect(await published("borrador")).toBeNull();

    // El nombre de la organización también sale en las cartas.
    await withTenant(owner, org, (tx, ctx) => updateOrganization(tx, ctx, { name: "Grupo Arroz" }));
    expect((await published("noche"))!.snapshot.organizationName).toBe("Grupo Arroz");

    // Sin permiso de publicar (personal) no puede editar; el encargado sí, y se publica.
    const manager = await createTestUser("auto-manager");
    await addMember(org, manager, "manager");
    await withTenant(manager, org, (tx, ctx) => updateProduct(tx, ctx, ids.dish, { name: "Paella valenciana" }));
    expect((await published("mediodia"))!.snapshot.sections[0]!.items[0]!.name).toBe("Paella valenciana");
  });
});
