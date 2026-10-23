import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { AuthUser } from "@/server/auth/service";
import { getDashboard } from "@/server/modules/dashboard/service";
import { createEstablishment } from "@/server/modules/establishments/service";
import { createTable, createZone } from "@/server/modules/floor/service";
import {
  createIngredient,
  createWarehouse,
  recordMovement,
  updateIngredient,
} from "@/server/modules/inventory/service";
import { addItem, addSection, createMenu, publishMenu } from "@/server/modules/menus/menus";
import { createProduct, updateProduct } from "@/server/modules/menus/products";
import { createOrder, createSupplier, markOrderSent, setOrderLine } from "@/server/modules/purchasing/service";
import { setRecipeLine } from "@/server/modules/recipes/service";
import { createReservation, setReservationStatus } from "@/server/modules/reservations/service";
import { setWeeklyHours } from "@/server/modules/schedules/service";
import { withTenant } from "@/server/tenancy/context";
import { addMember, createTestOrganization, createTestUser, uniqueSuffix } from "../support/factories";

// Viernes 20/11/2026 a las 19:00 en Madrid (UTC+1): cerrado; abre a las 20:00.
const DAY = "2026-11-20";
const NOW = new Date("2026-11-20T18:00:00Z");

interface Fixture {
  owner: AuthUser;
  org: string;
  est: string;
}

async function setup(label: string): Promise<Fixture> {
  const owner = await createTestUser(`${label}-owner`);
  const org = await createTestOrganization(owner, label);
  const est = await withTenant(owner, org, async (tx, ctx) => {
    const id = (await createEstablishment(tx, ctx, { name: "Centro", slug: `centro-${uniqueSuffix()}` })).id;
    const slots = [1, 2, 3, 4, 5, 6, 7].flatMap((weekday) => [
      { weekday, opens: "13:00", closes: "16:00" },
      { weekday, opens: "20:00", closes: "23:30" },
    ]);
    await setWeeklyHours(tx, ctx, id, { slots });
    const zone = await createZone(tx, ctx, id, { name: "Sala" });
    const t1 = (await createTable(tx, ctx, zone, { name: "T1", minCapacity: 1, maxCapacity: 4 })).id;
    const t2 = (await createTable(tx, ctx, zone, { name: "T2", minCapacity: 1, maxCapacity: 6 })).id;
    const book = (time: string, partySize: number, tableId: string, status?: string) =>
      createReservation(tx, ctx, id, {
        date: DAY,
        time,
        durationMinutes: 90,
        partySize,
        tableIds: [tableId],
        customerName: `Cliente ${time}`,
        ...(status ? { status } : {}),
      });
    await book("13:30", 2, t1); // ya pasada, sigue activa (confirmada)
    await book("20:30", 4, t1);
    await book("21:00", 5, t2, "pending");
    const cancelled = (await book("22:00", 3, t1)).reservation.id;
    await setReservationStatus(tx, ctx, cancelled, "cancelled");

    const warehouse = await createWarehouse(tx, ctx, id, { name: "Cámara" });
    const flour = (await createIngredient(tx, ctx, { name: "Harina", baseUnit: "g", reorderLevel: "2000" })).id;
    const oil = (await createIngredient(tx, ctx, { name: "Aceite", baseUnit: "ml", reorderLevel: "500" })).id;
    await recordMovement(tx, ctx, {
      warehouseId: warehouse,
      ingredientId: flour,
      kind: "receipt",
      quantity: "1",
      unit: "kg",
      idempotencyKey: randomUUID(),
    });
    await recordMovement(tx, ctx, {
      warehouseId: warehouse,
      ingredientId: oil,
      kind: "receipt",
      quantity: "2",
      unit: "l",
      idempotencyKey: randomUUID(),
    });
    await updateIngredient(tx, ctx, oil, { cost: "6" });

    const supplier = (await createSupplier(tx, ctx, { name: "Molinos" })).id;
    const sent = await createOrder(tx, ctx, { supplierId: supplier, warehouseId: warehouse });
    await setOrderLine(tx, ctx, sent, { ingredientId: flour, quantity: "10", unit: "kg", unitPrice: "1" });
    await markOrderSent(tx, ctx, sent);
    await createOrder(tx, ctx, { supplierId: supplier, warehouseId: warehouse }); // borrador

    const pan = await createProduct(tx, ctx, { name: "Pan", priceCents: 300 });
    const aliño = await createProduct(tx, ctx, { name: "Aliño", priceCents: 200 });
    await createProduct(tx, ctx, { name: "Sin receta", priceCents: 100 });
    await setRecipeLine(tx, ctx, pan.id, { ingredientId: flour, quantity: "100", unit: "g" }); // harina sin coste
    await setRecipeLine(tx, ctx, aliño.id, { ingredientId: oil, quantity: "10", unit: "ml" }); // completo

    const published = await createMenu(tx, ctx, id, { name: "Carta", slug: "carta" });
    const section = await addSection(tx, ctx, published.id, { name: "Todo" });
    await addItem(tx, ctx, published.id, section, { productId: aliño.id });
    await publishMenu(tx, ctx, published.id);
    await createMenu(tx, ctx, id, { name: "Menú del día", slug: "dia" }); // nunca publicada
    return id;
  });
  return { owner, org, est };
}

describe("panel de inicio", () => {
  let f: Fixture;
  beforeAll(async () => {
    f = await setup("dash");
  });

  it("resume el día de cada local con datos reales", async () => {
    const d = await withTenant(f.owner, f.org, (tx, ctx) => getDashboard(tx, ctx, NOW));
    expect(d.establishments).toHaveLength(1);
    const e = d.establishments[0]!;
    expect(e).toMatchObject({ name: "Centro", date: DAY, openNow: false });
    expect(e.nextOpening?.toISOString()).toBe("2026-11-20T19:00:00.000Z");
    // Activas: 13:30 (2), 20:30 (4) y 21:00 pendiente (5); la cancelada no cuenta.
    expect(e.reservations).toMatchObject({ active: 3, covers: 11, pending: 1 });
    expect(e.reservations?.next).toMatchObject({ customerName: "Cliente 20:30", partySize: 4 });
  });

  it("lista los avisos: stock bajo, pedidos, escandallos y cartas", async () => {
    const d = await withTenant(f.owner, f.org, (tx, ctx) => getDashboard(tx, ctx, NOW));
    expect(d.lowStock?.map((l) => l.ingredientName)).toEqual(["Harina"]);
    expect(d.orders?.drafts).toBe(1);
    expect(d.orders?.awaitingReceipt.map((o) => o.supplierName)).toEqual(["Molinos"]);
    expect(d.incompleteCostings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Pan", reason: "faltan costes" }),
        expect.objectContaining({ name: "Sin receta", reason: "sin receta" }),
      ]),
    );
    expect(d.incompleteCostings?.map((p) => p.name)).not.toContain("Aliño");
    expect(d.menusToPublish).toEqual([expect.objectContaining({ name: "Menú del día", neverPublished: true })]);

    // Un cambio de precio deja la carta publicada desactualizada.
    await withTenant(f.owner, f.org, async (tx, ctx) => {
      const { listProducts } = await import("@/server/modules/menus/products");
      const aliño = (await listProducts(tx, ctx)).find((p) => p.name === "Aliño")!;
      await updateProduct(tx, ctx, aliño.id, { priceCents: 250 });
    });
    const after = await withTenant(f.owner, f.org, (tx, ctx) => getDashboard(tx, ctx, NOW));
    expect(after.menusToPublish?.map((m) => [m.name, m.neverPublished])).toEqual(
      expect.arrayContaining([
        ["Carta", false],
        ["Menú del día", true],
      ]),
    );
  });

  it("el personal solo ve los bloques de sus permisos", async () => {
    const staff = await createTestUser("dash-staff");
    await addMember(f.org, staff, "staff");
    const d = await withTenant(staff, f.org, (tx, ctx) => getDashboard(tx, ctx, NOW));
    expect(d.establishments[0]?.reservations?.active).toBe(3);
    expect(d.lowStock).not.toBeNull();
    expect(d.orders).not.toBeNull();
    expect(d.incompleteCostings).toBeNull(); // sin costs.read
  });

  it("no mezcla datos de otra organización", async () => {
    const other = await setup("dash-other");
    const d = await withTenant(other.owner, other.org, (tx, ctx) => getDashboard(tx, ctx, NOW));
    expect(d.establishments.map((e) => e.id)).toEqual([other.est]);
    expect(d.lowStock).toHaveLength(1);
    expect(d.orders?.awaitingReceipt).toHaveLength(1);
    // Una organización nueva sin locales: portada vacía, sin errores.
    const lonely = await createTestUser("dash-empty");
    const emptyOrg = await createTestOrganization(lonely, "dash-empty");
    const empty = await withTenant(lonely, emptyOrg, (tx, ctx) => getDashboard(tx, ctx, NOW));
    expect(empty).toMatchObject({ establishments: [], lowStock: [], incompleteCostings: [], menusToPublish: [] });
    expect(empty.orders).toEqual({ drafts: 0, awaitingReceipt: [] });
  });
});
