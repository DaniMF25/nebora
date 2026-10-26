import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { AuthUser } from "@/server/auth/service";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { createEstablishment, getEstablishment, listEstablishments } from "@/server/modules/establishments/service";
import { transferStock } from "@/server/modules/inventory/operations";
import {
  createIngredient,
  createWarehouse,
  listStock,
  listWarehouses,
  recordMovement,
} from "@/server/modules/inventory/service";
import { addSection, createMenu, getMenuDraft, listMenus } from "@/server/modules/menus/menus";
import { createProduct } from "@/server/modules/menus/products";
import {
  acceptInvitation,
  changeMemberRole,
  createInvitation,
  listMembers,
  setMemberEstablishments,
} from "@/server/modules/members/service";
import { getEstablishmentStats } from "@/server/modules/stats/service";
import { withTenant, type TenantContext } from "@/server/tenancy/context";
import type { Tx } from "@/server/db/pool";
import { withAdminClient, withAppClient } from "../support/db";
import { addMember, createTestOrganization, createTestUser, uniqueSuffix } from "../support/factories";

// Miembros limitados a locales concretos (D-031): servicios y RLS.
describe("acceso por local", () => {
  let owner: AuthUser;
  let manager: AuthUser; // solo Centro
  let org: string;
  let centro: string;
  let playa: string;
  let whCentro: string;
  let whPlaya: string;
  let menuPlaya: string;
  let flour: string;
  let managerMembership: string;

  const asOwner = <T>(fn: (tx: Tx, ctx: TenantContext) => Promise<T>) => withTenant(owner, org, fn);
  const asManager = <T>(fn: (tx: Tx, ctx: TenantContext) => Promise<T>) => withTenant(manager, org, fn);

  beforeAll(async () => {
    owner = await createTestUser("acc-owner");
    manager = await createTestUser("acc-manager");
    org = await createTestOrganization(owner, "Acceso");
    await addMember(org, manager, "manager");
    await asOwner(async (tx, ctx) => {
      centro = (await createEstablishment(tx, ctx, { name: "Centro", slug: `centro-${uniqueSuffix()}` })).id;
      playa = (await createEstablishment(tx, ctx, { name: "Playa", slug: `playa-${uniqueSuffix()}` })).id;
      whCentro = await createWarehouse(tx, ctx, centro, { name: "Cámara" });
      whPlaya = await createWarehouse(tx, ctx, playa, { name: "Cámara" });
      flour = (await createIngredient(tx, ctx, { name: "Harina", baseUnit: "g" })).id;
      for (const wh of [whCentro, whPlaya]) {
        await recordMovement(tx, ctx, {
          warehouseId: wh,
          ingredientId: flour,
          kind: "receipt",
          quantity: "5",
          unit: "kg",
          idempotencyKey: randomUUID(),
        });
      }
      menuPlaya = (await createMenu(tx, ctx, playa, { name: "Carta playa", slug: "carta", theme: "moderno" })).id;
      await createMenu(tx, ctx, centro, { name: "Carta centro", slug: "carta", theme: "moderno" });
    });
    await withAdminClient(async (c) => {
      for (const est of [centro, playa]) {
        await c.query(
          `INSERT INTO reservations (organization_id, establishment_id, starts_at, ends_at, party_size, customer_name)
           VALUES ($1, $2, now() + interval '1 day', now() + interval '1 day 2 hours', 2, $3)`,
          [org, est, `Cliente ${est === centro ? "Centro" : "Playa"}`],
        );
      }
      managerMembership = (
        await c.query("SELECT id FROM memberships WHERE organization_id = $1 AND user_id = $2", [org, manager.id])
      ).rows[0].id;
    });
    await asOwner((tx, ctx) =>
      setMemberEstablishments(tx, ctx, managerMembership, { allEstablishments: false, establishmentIds: [centro] }),
    );
  });

  it("el contexto refleja el ámbito y quita la gestión del catálogo común", async () => {
    await asManager(async (_tx, ctx) => {
      expect(ctx.establishments).toEqual(new Set([centro]));
      expect(ctx.permissions.has("catalog.manage")).toBe(false);
      expect(ctx.permissions.has("menus.edit")).toBe(true);
    });
    await asOwner(async (_tx, ctx) => expect(ctx.establishments).toBe("all"));
  });

  it("solo ve su local: establecimientos, almacenes, stock y cartas", async () => {
    await asManager(async (tx, ctx) => {
      expect((await listEstablishments(tx, ctx)).map((e) => e.id)).toEqual([centro]);
      await expect(getEstablishment(tx, ctx, playa)).rejects.toBeInstanceOf(NotFoundError);
      expect((await listWarehouses(tx, ctx)).map((w) => w.id)).toEqual([whCentro]);
      expect((await listStock(tx, ctx)).map((l) => l.warehouseId)).toEqual([whCentro]);
      expect(await listStock(tx, ctx, playa)).toEqual([]);
      expect((await listMenus(tx, ctx, centro)).map((m) => m.name)).toEqual(["Carta centro"]);
      expect(await listMenus(tx, ctx, playa)).toEqual([]);
    });
    await expect(asManager((tx, ctx) => getMenuDraft(tx, ctx, menuPlaya))).rejects.toBeInstanceOf(NotFoundError);
    await expect(asManager((tx, ctx) => addSection(tx, ctx, menuPlaya, { name: "X" }))).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(asManager((tx, ctx) => getEstablishmentStats(tx, ctx, playa, 7))).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("no puede mover stock ni crear almacenes en otro local, ni traspasar hacia él", async () => {
    await expect(
      asManager((tx, ctx) =>
        recordMovement(tx, ctx, {
          warehouseId: whPlaya,
          ingredientId: flour,
          kind: "consumption",
          quantity: "1",
          unit: "kg",
          idempotencyKey: randomUUID(),
        }),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(asManager((tx, ctx) => createWarehouse(tx, ctx, playa, { name: "Otra" }))).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      asManager((tx, ctx) =>
        transferStock(tx, ctx, {
          fromWarehouseId: whCentro,
          toWarehouseId: whPlaya,
          ingredientId: flour,
          quantity: "1",
          unit: "kg",
          idempotencyKey: randomUUID(),
        }),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
    // En su local, todo sigue funcionando.
    await asManager((tx, ctx) =>
      recordMovement(tx, ctx, {
        warehouseId: whCentro,
        ingredientId: flour,
        kind: "consumption",
        quantity: "1",
        unit: "kg",
        idempotencyKey: randomUUID(),
      }),
    );
  });

  it("no gestiona el catálogo común; con acceso a todos los locales, sí", async () => {
    await expect(
      asManager((tx, ctx) => createProduct(tx, ctx, { name: "Croquetas", priceCents: 900 })),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const other = await createTestUser("acc-manager-all");
    await addMember(org, other, "manager");
    await withTenant(other, org, (tx, ctx) => createProduct(tx, ctx, { name: "Croquetas", priceCents: 900 }));
  });

  it("RLS: con el rol de aplicación y el contexto del encargado no se leen ni escriben filas de otro local", async () => {
    await withAppClient(async (c) => {
      await c.query("BEGIN");
      try {
        await c.query("SELECT set_config('app.user_id', $1, true)", [manager.id]);
        await c.query("SELECT set_config('app.org_id', $1, true)", [org]);
        const count = async (sql: string) => (await c.query(sql)).rows[0].n as number;
        expect(await count("SELECT count(*)::int AS n FROM establishments")).toBe(1);
        expect(await count("SELECT count(*)::int AS n FROM warehouses")).toBe(1);
        expect(await count("SELECT count(*)::int AS n FROM menus")).toBe(1);
        expect(await count("SELECT count(*)::int AS n FROM reservations")).toBe(1);
        expect(await count("SELECT count(*)::int AS n FROM stock_levels")).toBe(1);
        expect(await count(`SELECT count(*)::int AS n FROM stock_movements WHERE warehouse_id = '${whPlaya}'`)).toBe(0);
        // Catálogo común: visible entero.
        expect(await count("SELECT count(*)::int AS n FROM ingredients")).toBe(1);
        await c.query("SAVEPOINT s");
        await expect(
          c.query(
            `INSERT INTO stock_movements (organization_id, warehouse_id, ingredient_id, kind, quantity_delta,
                                          idempotency_key, created_by_user_id)
             VALUES ($1, $2, $3, 'receipt', 1000, $4, $5)`,
            [org, whPlaya, flour, randomUUID(), manager.id],
          ),
        ).rejects.toThrow(/row-level security/);
        await c.query("ROLLBACK TO SAVEPOINT s");
        await expect(
          c.query("INSERT INTO zones (organization_id, establishment_id, name) VALUES ($1, $2, 'X')", [org, playa]),
        ).rejects.toThrow(/row-level security|violates/);
      } finally {
        await c.query("ROLLBACK");
      }
    });
  });

  it("cambiar el acceso: validaciones, sin autoasignarse y ascender a administrador da acceso total", async () => {
    await expect(
      asOwner((tx, ctx) => setMemberEstablishments(tx, ctx, managerMembership, { allEstablishments: false })),
    ).rejects.toBeInstanceOf(ValidationError);
    const foreign = await createTestUser("acc-foreign");
    const foreignOrg = await createTestOrganization(foreign, "AccesoAjeno");
    const foreignEst = await withTenant(foreign, foreignOrg, (tx, ctx) =>
      createEstablishment(tx, ctx, { name: "Ajeno", slug: `ajeno-${uniqueSuffix()}` }),
    );
    await expect(
      asOwner((tx, ctx) =>
        setMemberEstablishments(tx, ctx, managerMembership, {
          allEstablishments: false,
          establishmentIds: [foreignEst.id],
        }),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
    // El encargado no gestiona miembros (ni su propio acceso).
    await expect(
      asManager((tx, ctx) => setMemberEstablishments(tx, ctx, managerMembership, { allEstablishments: true })),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const ownerMembership = (await asOwner((tx, ctx) => listMembers(tx, ctx))).find((m) => m.userId === owner.id)!;
    await expect(
      asOwner((tx, ctx) =>
        setMemberEstablishments(tx, ctx, ownerMembership.membershipId, {
          allEstablishments: false,
          establishmentIds: [centro],
        }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const promoted = await createTestUser("acc-promoted");
    await addMember(org, promoted, "staff");
    const pm = (await asOwner((tx, ctx) => listMembers(tx, ctx))).find((m) => m.userId === promoted.id)!;
    await asOwner((tx, ctx) =>
      setMemberEstablishments(tx, ctx, pm.membershipId, { allEstablishments: false, establishmentIds: [playa] }),
    );
    await asOwner((tx, ctx) => changeMemberRole(tx, ctx, pm.membershipId, { role: "admin" }));
    const after = (await asOwner((tx, ctx) => listMembers(tx, ctx))).find((m) => m.userId === promoted.id)!;
    expect(after).toMatchObject({ role: "admin", allEstablishments: true, establishmentIds: [] });
    await expect(
      asOwner((tx, ctx) =>
        setMemberEstablishments(tx, ctx, pm.membershipId, { allEstablishments: false, establishmentIds: [playa] }),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("una invitación limitada crea un miembro limitado a esos locales", async () => {
    const invitee = await createTestUser("acc-invitee");
    const { token } = await asOwner((tx, ctx) =>
      createInvitation(tx, ctx, { email: invitee.email, role: "staff", establishmentIds: [playa] }),
    );
    await acceptInvitation(invitee, token);
    await withTenant(invitee, org, async (tx, ctx) => {
      expect(ctx.establishments).toEqual(new Set([playa]));
      expect((await listEstablishments(tx, ctx)).map((e) => e.id)).toEqual([playa]);
    });
    await expect(
      asOwner((tx, ctx) =>
        createInvitation(tx, ctx, { email: "admin@example.test", role: "admin", establishmentIds: [playa] }),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      asOwner((tx, ctx) => createInvitation(tx, ctx, { email: "x@example.test", role: "staff", establishmentIds: [] })),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
