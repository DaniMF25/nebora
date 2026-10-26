import { beforeAll, describe, expect, it } from "vitest";
import type { AuthUser } from "@/server/auth/service";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { createEstablishment, type Establishment } from "@/server/modules/establishments/service";
import {
  activateVersion,
  addItem,
  addSection,
  createMenu,
  deleteMenu,
  deleteSection,
  getMenuDraft,
  getPublishedMenu,
  getPublishedSnapshot,
  hasUnpublishedChanges,
  listMenus,
  listVersions,
  moveItem,
  moveSection,
  publishMenu,
  removeItem,
  renameSection,
  setItemPrice,
  setItemRecommended,
  unpublishMenu,
  updateMenu,
} from "@/server/modules/menus/menus";
import { createProduct, deleteProduct, listProducts, updateProduct } from "@/server/modules/menus/products";
import { withTenant } from "@/server/tenancy/context";
import { withAdminClient, withAppClient } from "../support/db";
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
    createEstablishment(tx, ctx, { name: `Local ${label}`, slug: `local-${uniqueSuffix()}` }),
  );
  return { owner, org, orgSlug: rows[0].slug, est };
}

async function buildMenu(f: Fixture, slug = "carta") {
  return withTenant(f.owner, f.org, async (tx, ctx) => {
    const croquetas = await createProduct(tx, ctx, {
      name: "Croquetas",
      description: "De jamón",
      priceCents: 850,
      allergens: ["gluten", "milk", "milk"],
    });
    const tarta = await createProduct(tx, ctx, { name: "Tarta de queso", priceCents: 600, allergens: ["milk", "eggs"] });
    const menu = await createMenu(tx, ctx, f.est.id, { name: "Carta principal", slug, theme: "mediterraneo" });
    const entrantes = await addSection(tx, ctx, menu.id, { name: "Entrantes" });
    const postres = await addSection(tx, ctx, menu.id, { name: "Postres" });
    const croquetasItem = await addItem(tx, ctx, menu.id, entrantes, { productId: croquetas.id });
    await addItem(tx, ctx, menu.id, postres, { productId: tarta.id, priceOverrideCents: 650 });
    return { menu, croquetas, tarta, entrantes, postres, croquetasItem };
  });
}

describe("cartas: borrador, publicación y versiones", () => {
  let f: Fixture;
  let m: Awaited<ReturnType<typeof buildMenu>>;

  beforeAll(async () => {
    f = await setupRestaurant("menu");
    m = await buildMenu(f);
  });

  it("un borrador nunca publicado no es accesible públicamente", async () => {
    expect(await getPublishedMenu(f.orgSlug, f.est.slug, "carta")).toBeNull();
    const draft = await withTenant(f.owner, f.org, (tx, ctx) => getMenuDraft(tx, ctx, m.menu.id));
    expect(draft.sections.map((s) => s.name)).toEqual(["Entrantes", "Postres"]);
    expect(draft.sections[0]!.items[0]).toMatchObject({ name: "Croquetas", priceCents: 850, allergens: ["gluten", "milk"] });
    expect(draft.sections[1]!.items[0]).toMatchObject({ basePriceCents: 600, priceOverrideCents: 650, priceCents: 650 });
  });

  it("publicar crea una versión inmutable que no cambia al editar el borrador", async () => {
    const v1 = await withTenant(f.owner, f.org, (tx, ctx) => publishMenu(tx, ctx, m.menu.id));
    expect(v1.versionNumber).toBe(1);

    const pub = await getPublishedMenu(f.orgSlug, f.est.slug, "CARTA");
    expect(pub).not.toBeNull();
    expect(pub!.versionNumber).toBe(1);
    expect(pub!.snapshot).toEqual({
      schemaVersion: 1,
      theme: "mediterraneo",
      organizationName: expect.any(String),
      establishmentName: "Local menu",
      menuName: "Carta principal",
      currency: "EUR",
      sections: [
        { name: "Entrantes", items: [{ name: "Croquetas", description: "De jamón", priceCents: 850, allergens: ["gluten", "milk"] }] },
        { name: "Postres", items: [{ name: "Tarta de queso", description: null, priceCents: 650, allergens: ["eggs", "milk"] }] },
      ],
    });
    // La instantánea pública no contiene identificadores internos.
    expect(JSON.stringify(pub!.snapshot)).not.toContain(m.croquetas.id);
    expect(JSON.stringify(pub!.snapshot)).not.toContain(f.org);

    // Cambios en el catálogo y el borrador no afectan a lo publicado.
    await withTenant(f.owner, f.org, async (tx, ctx) => {
      await updateProduct(tx, ctx, m.croquetas.id, { priceCents: 990, name: "Croquetas caseras" });
      await addSection(tx, ctx, m.menu.id, { name: "Borrador secreto" });
      await updateMenu(tx, ctx, m.menu.id, { theme: "futurista" });
    });
    const still = await getPublishedMenu(f.orgSlug, f.est.slug, "carta");
    expect(still!.snapshot.theme).toBe("mediterraneo");
    expect(still!.snapshot.sections.map((s) => s.name)).toEqual(["Entrantes", "Postres"]);
    expect(still!.snapshot.sections[0]!.items[0]!.priceCents).toBe(850);
  });

  it("no publica borradores incompletos", async () => {
    await expect(withTenant(f.owner, f.org, (tx, ctx) => publishMenu(tx, ctx, m.menu.id))).rejects.toThrow(
      ValidationError,
    );
    const draft = await withTenant(f.owner, f.org, (tx, ctx) => getMenuDraft(tx, ctx, m.menu.id));
    const empty = draft.sections.find((s) => s.name === "Borrador secreto")!;
    await withTenant(f.owner, f.org, (tx, ctx) => deleteSection(tx, ctx, m.menu.id, empty.id));
  });

  it("versiones sucesivas, reactivar una anterior y despublicar", async () => {
    const v2 = await withTenant(f.owner, f.org, (tx, ctx) => publishMenu(tx, ctx, m.menu.id));
    expect(v2.versionNumber).toBe(2);
    expect((await getPublishedMenu(f.orgSlug, f.est.slug, "carta"))!.snapshot.sections[0]!.items[0]!.name).toBe(
      "Croquetas caseras",
    );

    const versions = await withTenant(f.owner, f.org, (tx, ctx) => listVersions(tx, ctx, m.menu.id));
    expect(versions.map((v) => [v.versionNumber, v.isCurrent])).toEqual([
      [2, true],
      [1, false],
    ]);
    await withTenant(f.owner, f.org, (tx, ctx) => activateVersion(tx, ctx, m.menu.id, versions[1]!.id));
    expect((await getPublishedMenu(f.orgSlug, f.est.slug, "carta"))!.versionNumber).toBe(1);

    await withTenant(f.owner, f.org, (tx, ctx) => unpublishMenu(tx, ctx, m.menu.id));
    expect(await getPublishedMenu(f.orgSlug, f.est.slug, "carta")).toBeNull();
    const list = await withTenant(f.owner, f.org, (tx, ctx) => listMenus(tx, ctx, f.est.id));
    expect(list[0]!.publishedVersionNumber).toBeNull();
  });

  it("publicaciones simultáneas generan versiones consecutivas distintas", async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, () => withTenant(f.owner, f.org, (tx, ctx) => publishMenu(tx, ctx, m.menu.id))),
    );
    expect(results.map((r) => r.versionNumber).sort((x, y) => x - y)).toEqual([3, 4, 5, 6, 7, 8]);
    expect((await getPublishedMenu(f.orgSlug, f.est.slug, "carta"))!.versionNumber).toBe(8);
  });

  it("las versiones no se pueden modificar ni borrar con el rol de aplicación", async () => {
    await withAppClient(async (c) => {
      await c.query("BEGIN");
      await c.query("SELECT set_config('app.user_id', $1, true), set_config('app.org_id', $2, true)", [f.owner.id, f.org]);
      await expect(c.query("UPDATE menu_versions SET snapshot = '{}'")).rejects.toThrow(/permission denied/);
      await c.query("ROLLBACK");
      await c.query("BEGIN");
      await c.query("SELECT set_config('app.user_id', $1, true), set_config('app.org_id', $2, true)", [f.owner.id, f.org]);
      await expect(c.query("DELETE FROM menu_versions")).rejects.toThrow(/permission denied/);
      await c.query("ROLLBACK");
    });
  });

  it("reordena categorías y productos", async () => {
    await withTenant(f.owner, f.org, async (tx, ctx) => {
      await moveSection(tx, ctx, m.menu.id, m.postres, "up");
      const extra = await createProduct(tx, ctx, { name: "Patatas bravas", priceCents: 500 });
      const bravas = await addItem(tx, ctx, m.menu.id, m.entrantes, { productId: extra.id });
      await moveItem(tx, ctx, m.menu.id, bravas, "up");
      await moveItem(tx, ctx, m.menu.id, bravas, "up"); // ya es el primero: sin efecto
    });
    const draft = await withTenant(f.owner, f.org, (tx, ctx) => getMenuDraft(tx, ctx, m.menu.id));
    expect(draft.sections.map((s) => s.name)).toEqual(["Postres", "Entrantes"]);
    expect(draft.sections[1]!.items.map((i) => i.name)).toEqual(["Patatas bravas", "Croquetas caseras"]);
    await expect(
      withTenant(f.owner, f.org, (tx, ctx) => moveSection(tx, ctx, m.menu.id, m.postres, "left")),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("precio específico de carta, duplicados, archivado y borrado de productos", async () => {
    await withTenant(f.owner, f.org, (tx, ctx) => setItemPrice(tx, ctx, m.menu.id, m.croquetasItem, { priceOverrideCents: 900 }));
    let draft = await withTenant(f.owner, f.org, (tx, ctx) => getMenuDraft(tx, ctx, m.menu.id));
    expect(draft.sections[1]!.items.find((i) => i.id === m.croquetasItem)!.priceCents).toBe(900);

    await expect(
      withTenant(f.owner, f.org, (tx, ctx) => addItem(tx, ctx, m.menu.id, m.entrantes, { productId: m.croquetas.id })),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      withTenant(f.owner, f.org, (tx, ctx) => deleteProduct(tx, ctx, m.croquetas.id)),
    ).rejects.toBeInstanceOf(ConflictError);

    // Un producto archivado impide publicar hasta quitarlo.
    await withTenant(f.owner, f.org, (tx, ctx) => updateProduct(tx, ctx, m.croquetas.id, { active: false }));
    await expect(withTenant(f.owner, f.org, (tx, ctx) => publishMenu(tx, ctx, m.menu.id))).rejects.toBeInstanceOf(
      ValidationError,
    );
    await withTenant(f.owner, f.org, (tx, ctx) => removeItem(tx, ctx, m.menu.id, m.croquetasItem));
    await withTenant(f.owner, f.org, (tx, ctx) => publishMenu(tx, ctx, m.menu.id));
    await expect(
      withTenant(f.owner, f.org, (tx, ctx) => addItem(tx, ctx, m.menu.id, m.entrantes, { productId: m.croquetas.id })),
    ).rejects.toBeInstanceOf(ValidationError);
    await withTenant(f.owner, f.org, (tx, ctx) => deleteProduct(tx, ctx, m.croquetas.id));
    const products = await withTenant(f.owner, f.org, (tx, ctx) => listProducts(tx, ctx));
    expect(products.map((p) => p.name)).not.toContain("Croquetas caseras");
    draft = await withTenant(f.owner, f.org, (tx, ctx) => getMenuDraft(tx, ctx, m.menu.id));
    expect(draft.sections[1]!.items.map((i) => i.name)).toEqual(["Patatas bravas"]);
  });

  it("valida entradas: precios, alérgenos, tema, slug y campos extra", async () => {
    for (const bad of [
      { name: "X", priceCents: -1 },
      { name: "X", priceCents: 1.5 },
      { name: "X", priceCents: 100, allergens: ["chocolate"] },
      { name: "X", priceCents: 100, organizationId: f.org },
    ]) {
      await expect(withTenant(f.owner, f.org, (tx, ctx) => createProduct(tx, ctx, bad))).rejects.toBeInstanceOf(
        ValidationError,
      );
    }
    await expect(
      withTenant(f.owner, f.org, (tx, ctx) => createMenu(tx, ctx, f.est.id, { name: "X", slug: "otra", theme: "neon" })),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      withTenant(f.owner, f.org, (tx, ctx) => createMenu(tx, ctx, f.est.id, { name: "X", slug: "carta" })),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      withTenant(f.owner, f.org, (tx, ctx) => updateMenu(tx, ctx, m.menu.id, { published_version_id: null })),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(await getPublishedMenu(f.orgSlug, f.est.slug, "../carta")).toBeNull();
  });

  it("borrar una carta publicada elimina también su página pública", async () => {
    const other = await buildMenu(f, "temporal");
    await withTenant(f.owner, f.org, (tx, ctx) => publishMenu(tx, ctx, other.menu.id));
    expect(await getPublishedMenu(f.orgSlug, f.est.slug, "temporal")).not.toBeNull();
    await withTenant(f.owner, f.org, (tx, ctx) => deleteMenu(tx, ctx, other.menu.id));
    expect(await getPublishedMenu(f.orgSlug, f.est.slug, "temporal")).toBeNull();
  });
});

describe("cartas: permisos por rol", () => {
  it("staff solo lee; manager edita y publica", async () => {
    const f = await setupRestaurant("menu-roles");
    const m = await buildMenu(f);
    const staff = await createTestUser("menu-staff");
    const manager = await createTestUser("menu-manager");
    await addMember(f.org, staff, "staff");
    await addMember(f.org, manager, "manager");

    await expect(withTenant(staff, f.org, (tx, ctx) => getMenuDraft(tx, ctx, m.menu.id))).resolves.toBeTruthy();
    await expect(
      withTenant(staff, f.org, (tx, ctx) => createProduct(tx, ctx, { name: "X", priceCents: 1 })),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(withTenant(staff, f.org, (tx, ctx) => addSection(tx, ctx, m.menu.id, { name: "X" }))).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(withTenant(staff, f.org, (tx, ctx) => publishMenu(tx, ctx, m.menu.id))).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await withTenant(manager, f.org, (tx, ctx) => renameSection(tx, ctx, m.menu.id, m.entrantes, { name: "Para picar" }));
    await expect(withTenant(manager, f.org, (tx, ctx) => publishMenu(tx, ctx, m.menu.id))).resolves.toEqual({
      versionNumber: 1,
    });
  });
});

describe("cartas: aislamiento entre organizaciones", () => {
  let a: Fixture;
  let b: Fixture;
  let mb: Awaited<ReturnType<typeof buildMenu>>;
  let ma: Awaited<ReturnType<typeof buildMenu>>;

  beforeAll(async () => {
    a = await setupRestaurant("menu-a");
    b = await setupRestaurant("menu-b");
    ma = await buildMenu(a);
    mb = await buildMenu(b);
    await withTenant(b.owner, b.org, (tx, ctx) => publishMenu(tx, ctx, mb.menu.id));
  });

  it("A no puede leer, editar, publicar ni borrar la carta de B", async () => {
    const ops = [
      (tx: never, ctx: never) => getMenuDraft(tx, ctx, mb.menu.id),
      (tx: never, ctx: never) => listVersions(tx, ctx, mb.menu.id).then((v) => (v.length ? v : Promise.reject(new NotFoundError()))),
      (tx: never, ctx: never) => updateMenu(tx, ctx, mb.menu.id, { name: "Hackeada" }),
      (tx: never, ctx: never) => addSection(tx, ctx, mb.menu.id, { name: "X" }),
      (tx: never, ctx: never) => renameSection(tx, ctx, mb.menu.id, mb.entrantes, { name: "X" }),
      (tx: never, ctx: never) => removeItem(tx, ctx, mb.menu.id, mb.croquetasItem),
      (tx: never, ctx: never) => publishMenu(tx, ctx, mb.menu.id),
      (tx: never, ctx: never) => unpublishMenu(tx, ctx, mb.menu.id),
      (tx: never, ctx: never) => deleteMenu(tx, ctx, mb.menu.id),
      (tx: never, ctx: never) => listMenus(tx, ctx, b.est.id).then((l) => (l.length ? l : Promise.reject(new NotFoundError()))),
      (tx: never, ctx: never) => createMenu(tx, ctx, b.est.id, { name: "X", slug: "intrusa" }),
      (tx: never, ctx: never) => updateProduct(tx, ctx, mb.croquetas.id, { priceCents: 1 }),
      (tx: never, ctx: never) => deleteProduct(tx, ctx, mb.tarta.id),
    ];
    for (const op of ops) {
      await expect(withTenant(a.owner, a.org, op as never)).rejects.toBeInstanceOf(NotFoundError);
    }
    const products = await withTenant(a.owner, a.org, (tx, ctx) => listProducts(tx, ctx));
    expect(products.map((p) => p.id)).not.toContain(mb.croquetas.id);
    const pub = await getPublishedMenu(b.orgSlug, b.est.slug, "carta");
    expect(pub!.snapshot.sections[0]!.name).toBe("Entrantes");
  });

  it("A no puede añadir a su carta un producto de B ni usar una categoría de B", async () => {
    await expect(
      withTenant(a.owner, a.org, (tx, ctx) => addItem(tx, ctx, ma.menu.id, ma.entrantes, { productId: mb.tarta.id })),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      withTenant(a.owner, a.org, (tx, ctx) => addItem(tx, ctx, ma.menu.id, mb.entrantes, { productId: ma.tarta.id })),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("el esquema impide mezclar organizaciones (FKs compuestas)", async () => {
    await withAdminClient(async (c) => {
      await expect(
        c.query(
          "INSERT INTO menu_items (organization_id, section_id, product_id, position) VALUES ($1, $2, $3, 99)",
          [a.org, ma.entrantes, mb.tarta.id],
        ),
      ).rejects.toThrow(/menu_items_product_fk/);
      await expect(
        c.query("INSERT INTO menus (organization_id, establishment_id, name, slug) VALUES ($1, $2, 'X', 'mixta')", [
          a.org,
          b.est.id,
        ]),
      ).rejects.toThrow(/menus_establishment_fk/);
      // La versión publicada de una carta no puede ser una versión de otra carta.
      const { rows } = await c.query("SELECT id FROM menu_versions WHERE menu_id = $1", [mb.menu.id]);
      await expect(
        c.query("UPDATE menus SET published_version_id = $1 WHERE id = $2", [rows[0].id, ma.menu.id]),
      ).rejects.toThrow(/menus_published_version_fk/);
    });
  });

  it("RLS: con el contexto de A no se ven filas de cartas de B", async () => {
    await withAppClient(async (c) => {
      await c.query("BEGIN");
      try {
        await c.query("SELECT set_config('app.user_id', $1, true), set_config('app.org_id', $2, true)", [a.owner.id, a.org]);
        for (const t of ["menu_products", "menus", "menu_sections", "menu_items", "menu_versions"]) {
          const { rows } = await c.query(`SELECT count(*)::int AS n FROM ${t} WHERE organization_id <> $1`, [a.org]);
          expect(rows[0].n, t).toBe(0);
        }
      } finally {
        await c.query("ROLLBACK");
      }
    });
  });

  it("la lectura pública funciona sin sesión y solo devuelve versiones publicadas", async () => {
    expect(await getPublishedMenu(b.orgSlug, b.est.slug, "carta")).not.toBeNull();
    expect(await getPublishedMenu(a.orgSlug, a.est.slug, "carta")).toBeNull(); // A no ha publicado
    // Mezclar slugs de organizaciones distintas no encuentra nada.
    expect(await getPublishedMenu(a.orgSlug, b.est.slug, "carta")).toBeNull();
  });
});

describe("cartas: código público estable (QR)", () => {
  it("sobrevive a cambios de slug, solo resuelve cartas publicadas y la app no puede cambiarlo", async () => {
    const f = await setupRestaurant("menu-qr");
    const m = await buildMenu(f, "qr-carta");
    const { resolveMenuCode, getMenuSummary } = await import("@/server/modules/menus/menus");
    const code = m.menu.publicCode;
    expect(code).toMatch(/^[0-9a-f]{12}$/);

    expect(await resolveMenuCode(code)).toBeNull(); // sin publicar
    await withTenant(f.owner, f.org, (tx, ctx) => publishMenu(tx, ctx, m.menu.id));
    expect(await resolveMenuCode(code)).toBe(`/m/${f.orgSlug}/${f.est.slug}/qr-carta`);

    await withTenant(f.owner, f.org, (tx, ctx) => updateMenu(tx, ctx, m.menu.id, { slug: "carta-renombrada" }));
    expect(await resolveMenuCode(code)).toBe(`/m/${f.orgSlug}/${f.est.slug}/carta-renombrada`);
    const after = await withTenant(f.owner, f.org, (tx, ctx) => getMenuSummary(tx, ctx, m.menu.id));
    expect(after.publicCode).toBe(code);

    await withAppClient(async (c) => {
      await c.query("BEGIN");
      await c.query("SELECT set_config('app.user_id', $1, true), set_config('app.org_id', $2, true)", [f.owner.id, f.org]);
      await expect(c.query("UPDATE menus SET public_code = '000000000000'")).rejects.toThrow(/permission denied/);
      await c.query("ROLLBACK");
    });

    await withTenant(f.owner, f.org, (tx, ctx) => unpublishMenu(tx, ctx, m.menu.id));
    expect(await resolveMenuCode(code)).toBeNull();
    expect(await resolveMenuCode("../../etc")).toBeNull();

    const other = await buildMenu(f, "otra-carta");
    expect(other.menu.publicCode).not.toBe(code);
  });
});

describe("aviso de cambios sin publicar", () => {
  it("detecta cualquier cambio visible respecto a la versión publicada", async () => {
    const f = await setupRestaurant("outdated");
    const m = await buildMenu(f);
    const check = () => withTenant(f.owner, f.org, (tx, ctx) => hasUnpublishedChanges(tx, ctx, m.menu.id));
    const publish = () => withTenant(f.owner, f.org, (tx, ctx) => publishMenu(tx, ctx, m.menu.id));

    expect(await check()).toBeNull(); // nunca publicada
    await publish();
    expect(await check()).toBe(false);

    const changes: ((
      tx: Parameters<Parameters<typeof withTenant>[2]>[0],
      ctx: Parameters<Parameters<typeof withTenant>[2]>[1],
    ) => Promise<unknown>)[] = [
      (tx, ctx) => updateProduct(tx, ctx, m.croquetas.id, { priceCents: 900 }),
      (tx, ctx) => updateProduct(tx, ctx, m.tarta.id, { allergens: ["milk"] }),
      (tx, ctx) => setItemRecommended(tx, ctx, m.menu.id, m.croquetasItem, { recommended: true }),
      (tx, ctx) => updateMenu(tx, ctx, m.menu.id, { theme: "futurista" }),
      (tx, ctx) => moveSection(tx, ctx, m.menu.id, m.postres, "up"),
    ];
    for (const change of changes) {
      await withTenant(f.owner, f.org, change);
      expect(await check()).toBe(true);
      await publish();
      expect(await check()).toBe(false);
    }

    // Otra organización no puede consultarlo.
    const other = await setupRestaurant("outdated-other");
    await expect(
      withTenant(other.owner, other.org, (tx, ctx) => hasUnpublishedChanges(tx, ctx, m.menu.id)),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("carta para imprimir: versión publicada", () => {
  it("devuelve la versión publicada (no el borrador) y solo a la propia organización", async () => {
    const a = await setupRestaurant("print-a");
    const b = await setupRestaurant("print-b");
    const { menu } = await buildMenu(a);
    const read = (f: Fixture) => withTenant(f.owner, f.org, (tx, ctx) => getPublishedSnapshot(tx, ctx, menu.id));
    expect(await read(a)).toBeNull();
    await withTenant(a.owner, a.org, (tx, ctx) => publishMenu(tx, ctx, menu.id));
    await withTenant(a.owner, a.org, (tx, ctx) => updateMenu(tx, ctx, menu.id, { name: "Nombre en borrador" }));
    const published = await read(a);
    expect(published).toMatchObject({ versionNumber: 1, snapshot: { menuName: "Carta principal" } });
    expect(published!.snapshot.sections.map((s) => s.name)).toEqual(["Entrantes", "Postres"]);
    await expect(withTenant(a.owner, b.org, (tx, ctx) => getPublishedSnapshot(tx, ctx, menu.id))).rejects.toThrow();
    await expect(read(b)).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      withTenant(a.owner, a.org, (tx, ctx) => getPublishedSnapshot(tx, ctx, "no-es-uuid")),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
