import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { AuthUser } from "@/server/auth/service";
import { NotFoundError } from "@/server/errors";
import { createEstablishment } from "@/server/modules/establishments/service";
import { listCounts, listTransfers, openCount, transferStock } from "@/server/modules/inventory/operations";
import {
  createIngredient,
  createWarehouse,
  listMovements,
  listStock,
  listWarehouses,
  recordMovement,
} from "@/server/modules/inventory/service";
import { createOrder, createSupplier, listOrders } from "@/server/modules/purchasing/service";
import { withTenant } from "@/server/tenancy/context";
import { createTestOrganization, createTestUser, uniqueSuffix } from "../support/factories";

// Vistas por local de inventario y compras (filtro por establecimiento).
describe("inventario y compras filtrados por local", () => {
  let owner: AuthUser;
  let org: string;
  let centro: string;
  let playa: string;
  let whCentro: string;
  let whPlaya: string;

  beforeAll(async () => {
    owner = await createTestUser("scope-owner");
    org = await createTestOrganization(owner, "Scope");
    await withTenant(owner, org, async (tx, ctx) => {
      centro = (await createEstablishment(tx, ctx, { name: "Centro", slug: `centro-${uniqueSuffix()}` })).id;
      playa = (await createEstablishment(tx, ctx, { name: "Playa", slug: `playa-${uniqueSuffix()}` })).id;
      whCentro = await createWarehouse(tx, ctx, centro, { name: "Cámara" });
      whPlaya = await createWarehouse(tx, ctx, playa, { name: "Cámara" });
      const flour = (await createIngredient(tx, ctx, { name: "Harina", baseUnit: "g" })).id;
      for (const [wh, qty] of [
        [whCentro, "5"],
        [whPlaya, "3"],
      ] as const) {
        await recordMovement(tx, ctx, {
          warehouseId: wh,
          ingredientId: flour,
          kind: "receipt",
          quantity: qty,
          unit: "kg",
          idempotencyKey: randomUUID(),
        });
      }
      await transferStock(tx, ctx, {
        fromWarehouseId: whCentro,
        toWarehouseId: whPlaya,
        ingredientId: flour,
        quantity: "1",
        unit: "kg",
        idempotencyKey: randomUUID(),
      });
      await openCount(tx, ctx, { warehouseId: whPlaya });
      const supplier = await createSupplier(tx, ctx, { name: "Molinos" });
      await createOrder(tx, ctx, { supplierId: supplier.id, warehouseId: whCentro });
    });
  });

  const run = <T>(fn: Parameters<typeof withTenant<T>>[2]) => withTenant(owner, org, fn);

  it("stock, almacenes y movimientos solo del local pedido; sin filtro, todos", async () => {
    const stockCentro = await run((tx, ctx) => listStock(tx, ctx, centro));
    expect(stockCentro.map((l) => [l.establishmentName, l.quantity])).toEqual([["Centro", "4000.000"]]);
    const stockPlaya = await run((tx, ctx) => listStock(tx, ctx, playa));
    expect(stockPlaya.map((l) => [l.establishmentName, l.quantity])).toEqual([["Playa", "4000.000"]]);
    expect(await run((tx, ctx) => listStock(tx, ctx))).toHaveLength(2);

    expect((await run((tx, ctx) => listWarehouses(tx, ctx, playa))).map((w) => w.id)).toEqual([whPlaya]);
    const movCentro = await run((tx, ctx) => listMovements(tx, ctx, 50, centro));
    expect(movCentro.every((m) => m.warehouseId === whCentro)).toBe(true);
    expect(movCentro.map((m) => m.kind).sort()).toEqual(["receipt", "transfer_out"]);
  });

  it("un traspaso aparece en los dos locales que toca; recuentos y pedidos, solo en el suyo", async () => {
    for (const est of [centro, playa]) {
      const transfers = await run((tx, ctx) => listTransfers(tx, ctx, 20, est));
      expect(transfers).toHaveLength(1);
      expect(transfers[0]).toMatchObject({ fromEstablishmentName: "Centro", toEstablishmentName: "Playa" });
    }
    expect(await run((tx, ctx) => listCounts(tx, ctx, 20, centro))).toHaveLength(0);
    expect((await run((tx, ctx) => listCounts(tx, ctx, 20, playa)))[0]).toMatchObject({ establishmentId: playa });
    expect((await run((tx, ctx) => listOrders(tx, ctx, centro)))[0]).toMatchObject({ establishmentId: centro });
    expect(await run((tx, ctx) => listOrders(tx, ctx, playa))).toHaveLength(0);
  });

  it("un identificador de local mal formado es NotFound, no un error de base de datos", async () => {
    await expect(run((tx, ctx) => listStock(tx, ctx, "no-es-uuid"))).rejects.toBeInstanceOf(NotFoundError);
    await expect(run((tx, ctx) => listOrders(tx, ctx, "1; DROP TABLE"))).rejects.toBeInstanceOf(NotFoundError);
  });

  it("filtrar por un local de otra organización no devuelve nada", async () => {
    const other = await createTestUser("scope-other");
    const otherOrg = await createTestOrganization(other, "ScopeOther");
    const leaked = await withTenant(other, otherOrg, (tx, ctx) => listStock(tx, ctx, centro));
    expect(leaked).toEqual([]);
  });
});
