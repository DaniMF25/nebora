import { beforeAll, describe, expect, it } from "vitest";
import type { AuthUser } from "@/server/auth/service";
import type { Tx } from "@/server/db/pool";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { createEstablishment } from "@/server/modules/establishments/service";
import { addItem, addSection, createMenu, getMenuDraft, removeItem } from "@/server/modules/menus/menus";
import { createProduct, getProduct, listProducts, setProductEstablishments } from "@/server/modules/menus/products";
import { listMembers, setMemberEstablishments } from "@/server/modules/members/service";
import { withTenant, type TenantContext } from "@/server/tenancy/context";
import { withAppClient } from "../support/db";
import { addMember, createTestOrganization, createTestUser, uniqueSuffix } from "../support/factories";

// Productos disponibles solo en algunos locales (D-032).
describe("disponibilidad de productos por local", () => {
  let owner: AuthUser;
  let org: string;
  let centro: string;
  let playa: string;
  let product: string;
  let menuCentro: string;
  let menuPlaya: string;
  let sectionCentro: string;
  let sectionPlaya: string;

  const asOwner = <T>(fn: (tx: Tx, ctx: TenantContext) => Promise<T>) => withTenant(owner, org, fn);

  beforeAll(async () => {
    owner = await createTestUser("avail-owner");
    org = await createTestOrganization(owner, "Disponible");
    await asOwner(async (tx, ctx) => {
      centro = (await createEstablishment(tx, ctx, { name: "Centro", slug: `centro-${uniqueSuffix()}` })).id;
      playa = (await createEstablishment(tx, ctx, { name: "Playa", slug: `playa-${uniqueSuffix()}` })).id;
      product = (await createProduct(tx, ctx, { name: "Paella", priceCents: 1800 })).id;
      menuCentro = (await createMenu(tx, ctx, centro, { name: "Carta", slug: "carta", theme: "moderno" })).id;
      menuPlaya = (await createMenu(tx, ctx, playa, { name: "Carta", slug: "carta", theme: "moderno" })).id;
      sectionCentro = await addSection(tx, ctx, menuCentro, { name: "Arroces" });
      sectionPlaya = await addSection(tx, ctx, menuPlaya, { name: "Arroces" });
    });
  });

  it("por defecto está disponible en todos los locales", async () => {
    const p = await asOwner((tx, ctx) => getProduct(tx, ctx, product));
    expect(p).toMatchObject({ allEstablishments: true, establishmentIds: [] });
    expect((await asOwner((tx, ctx) => listProducts(tx, ctx, { availableIn: playa }))).map((x) => x.id)).toContain(
      product,
    );
  });

  it("no se retira de un local mientras esté en una de sus cartas", async () => {
    const itemPlaya = await asOwner((tx, ctx) => addItem(tx, ctx, menuPlaya, sectionPlaya, { productId: product }));
    await expect(
      asOwner((tx, ctx) =>
        setProductEstablishments(tx, ctx, product, { allEstablishments: false, establishmentIds: [centro] }),
      ),
    ).rejects.toThrow(ConflictError);
    await expect(
      asOwner((tx, ctx) =>
        setProductEstablishments(tx, ctx, product, { allEstablishments: false, establishmentIds: [centro] }),
      ),
    ).rejects.toThrow(/«Carta» \(Playa\)/);
    await asOwner((tx, ctx) => removeItem(tx, ctx, menuPlaya, itemPlaya));
    await asOwner((tx, ctx) =>
      setProductEstablishments(tx, ctx, product, { allEstablishments: false, establishmentIds: [centro] }),
    );
    expect(await asOwner((tx, ctx) => getProduct(tx, ctx, product))).toMatchObject({
      allEstablishments: false,
      establishmentIds: [centro],
    });
  });

  it("las cartas de otros locales no lo ofrecen ni lo aceptan", async () => {
    expect((await asOwner((tx, ctx) => listProducts(tx, ctx, { availableIn: playa }))).map((x) => x.id)).not.toContain(
      product,
    );
    expect((await asOwner((tx, ctx) => listProducts(tx, ctx, { availableIn: centro }))).map((x) => x.id)).toContain(
      product,
    );
    await expect(
      asOwner((tx, ctx) => addItem(tx, ctx, menuPlaya, sectionPlaya, { productId: product })),
    ).rejects.toBeInstanceOf(ValidationError);
    await asOwner((tx, ctx) => addItem(tx, ctx, menuCentro, sectionCentro, { productId: product }));
    expect((await asOwner((tx, ctx) => getMenuDraft(tx, ctx, menuCentro))).sections[0]!.items).toHaveLength(1);
  });

  it("la base de datos lo impide aunque se salte el servidor", async () => {
    await withAppClient(async (c) => {
      await c.query("BEGIN");
      try {
        await c.query("SELECT set_config('app.user_id', $1, true)", [owner.id]);
        await c.query("SELECT set_config('app.org_id', $1, true)", [org]);
        await expect(
          c.query("INSERT INTO menu_items (organization_id, section_id, product_id, position) VALUES ($1, $2, $3, 9)", [
            org,
            sectionPlaya,
            product,
          ]),
        ).rejects.toThrow(/product_not_available/);
      } finally {
        await c.query("ROLLBACK");
      }
    });
  });

  it("validaciones y permisos", async () => {
    await expect(
      asOwner((tx, ctx) =>
        setProductEstablishments(tx, ctx, product, { allEstablishments: false, establishmentIds: [] }),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    const other = await createTestUser("avail-other");
    const otherOrg = await createTestOrganization(other, "DisponibleAjeno");
    const foreign = await withTenant(other, otherOrg, (tx, ctx) =>
      createEstablishment(tx, ctx, { name: "Ajeno", slug: `ajeno-${uniqueSuffix()}` }),
    );
    await expect(
      asOwner((tx, ctx) =>
        setProductEstablishments(tx, ctx, product, { allEstablishments: false, establishmentIds: [foreign.id] }),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
    // Otra organización no lo ve.
    await expect(
      withTenant(other, otherOrg, (tx, ctx) => setProductEstablishments(tx, ctx, product, { allEstablishments: true })),
    ).rejects.toBeInstanceOf(NotFoundError);
    // Un encargado limitado a un local no cambia el catálogo común.
    const mgr = await createTestUser("avail-mgr");
    await addMember(org, mgr, "manager");
    const m = (await asOwner((tx, ctx) => listMembers(tx, ctx))).find((x) => x.userId === mgr.id)!;
    await asOwner((tx, ctx) =>
      setMemberEstablishments(tx, ctx, m.membershipId, { allEstablishments: false, establishmentIds: [centro] }),
    );
    await expect(
      withTenant(mgr, org, (tx, ctx) => setProductEstablishments(tx, ctx, product, { allEstablishments: true })),
    ).rejects.toBeInstanceOf(ForbiddenError);
    // Volver a todos los locales.
    await asOwner((tx, ctx) => setProductEstablishments(tx, ctx, product, { allEstablishments: true }));
    expect(await asOwner((tx, ctx) => getProduct(tx, ctx, product))).toMatchObject({
      allEstablishments: true,
      establishmentIds: [],
    });
  });
});
