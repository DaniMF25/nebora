import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { AuthUser } from "@/server/auth/service";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { createEstablishment } from "@/server/modules/establishments/service";
import { createIngredient, createWarehouse, listIngredients, listStock } from "@/server/modules/inventory/service";
import {
  cancelOrder,
  createOrder,
  createSupplier,
  getOrder,
  listOrders,
  markOrderSent,
  receiveOrder,
  removeOrderLine,
  setOrderLine,
  setSupplierActive,
} from "@/server/modules/purchasing/service";
import { withTenant } from "@/server/tenancy/context";
import { withAdminClient, withAppClient } from "../support/db";
import { addMember, createTestOrganization, createTestUser, uniqueSuffix } from "../support/factories";

interface Fixture {
  owner: AuthUser;
  org: string;
  warehouse: string;
  supplier: string;
  rice: string;
  oil: string;
}

async function setup(label: string): Promise<Fixture> {
  const owner = await createTestUser(`${label}-owner`);
  const org = await createTestOrganization(owner, label);
  return withTenant(owner, org, async (tx, ctx) => {
    const est = await createEstablishment(tx, ctx, { name: "Local", slug: `local-${uniqueSuffix()}` });
    const warehouse = await createWarehouse(tx, ctx, est.id, { name: "Despensa" });
    const supplier = (await createSupplier(tx, ctx, { name: "Distribuciones Levante", email: "Pedidos@Levante.example" })).id;
    const rice = (await createIngredient(tx, ctx, { name: "Arroz", baseUnit: "g" })).id;
    const oil = (await createIngredient(tx, ctx, { name: "Aceite", baseUnit: "ml" })).id;
    return { owner, org, warehouse, supplier, rice, oil };
  });
}

async function draftOrder(f: Fixture): Promise<string> {
  return withTenant(f.owner, f.org, async (tx, ctx) => {
    const id = await createOrder(tx, ctx, { supplierId: f.supplier, warehouseId: f.warehouse, expectedDate: "2026-11-02" });
    await setOrderLine(tx, ctx, id, { ingredientId: f.rice, quantity: "25", unit: "kg", unitPrice: "2,15" });
    await setOrderLine(tx, ctx, id, { ingredientId: f.oil, quantity: "10", unit: "l", unitPrice: "6,40" });
    return id;
  });
}

const stockOf = async (f: Fixture) =>
  Object.fromEntries(
    (await withTenant(f.owner, f.org, (tx, ctx) => listStock(tx, ctx))).map((l) => [l.ingredientName, l.quantity]),
  );

describe("pedidos de compra y recepciones", () => {
  let f: Fixture;
  beforeAll(async () => {
    f = await setup("buy");
  });

  it("numera los pedidos, calcula totales y solo se editan en borrador", async () => {
    const id = await draftOrder(f);
    const order = await withTenant(f.owner, f.org, (tx, ctx) => getOrder(tx, ctx, id));
    expect(order.status).toBe("draft");
    expect(order.number).toBe(1);
    // 25 kg × 2,15 €/kg + 10 l × 6,40 €/l = 53,75 + 64,00 = 117,75 €
    expect(order.totalCents).toBe("11775.0000");
    expect(order.lines.map((l) => [l.ingredientName, l.quantityOrdered, l.quantityReceived])).toEqual([
      ["Aceite", "10000.000", "0.000"],
      ["Arroz", "25000.000", "0.000"],
    ]);

    // Actualizar la línea de un ingrediente la sustituye.
    await withTenant(f.owner, f.org, (tx, ctx) =>
      setOrderLine(tx, ctx, id, { ingredientId: f.rice, quantity: "20", unit: "kg", unitPrice: "2,15" }),
    );
    const updated = await withTenant(f.owner, f.org, (tx, ctx) => getOrder(tx, ctx, id));
    expect(updated.lines).toHaveLength(2);
    expect(updated.totalCents).toBe("10700.0000");

    await expect(withTenant(f.owner, f.org, (tx, ctx) => receiveOrder(tx, ctx, id, {
      lines: [{ lineId: updated.lines[0]!.id, quantity: "1", unit: "l" }], idempotencyKey: randomUUID(),
    }))).rejects.toThrow(/No se puede recibir un pedido borrador/);

    await withTenant(f.owner, f.org, (tx, ctx) => markOrderSent(tx, ctx, id));
    await expect(
      withTenant(f.owner, f.org, (tx, ctx) =>
        setOrderLine(tx, ctx, id, { ingredientId: f.rice, quantity: "1", unit: "kg", unitPrice: "1" }),
      ),
    ).rejects.toThrow(/No se puede modificar un pedido enviado/);
    await expect(
      withTenant(f.owner, f.org, (tx, ctx) => removeOrderLine(tx, ctx, id, updated.lines[0]!.id)),
    ).rejects.toBeInstanceOf(ValidationError);
    const second = await draftOrder(f);
    expect((await withTenant(f.owner, f.org, (tx, ctx) => getOrder(tx, ctx, second))).number).toBe(2);
  });

  it("recepción parcial y total: entradas de stock, estado y coste de referencia", async () => {
    const id = await draftOrder(f);
    await withTenant(f.owner, f.org, (tx, ctx) => markOrderSent(tx, ctx, id));
    const order = await withTenant(f.owner, f.org, (tx, ctx) => getOrder(tx, ctx, id));
    const riceLine = order.lines.find((l) => l.ingredientName === "Arroz")!;
    const oilLine = order.lines.find((l) => l.ingredientName === "Aceite")!;
    const before = await stockOf(f);

    const r1 = await withTenant(f.owner, f.org, (tx, ctx) =>
      receiveOrder(tx, ctx, id, {
        lines: [
          { lineId: riceLine.id, quantity: "15", unit: "kg" },
          { lineId: oilLine.id, quantity: "10", unit: "l" },
        ],
        idempotencyKey: randomUUID(),
      }),
    );
    expect(r1.status).toBe("partially_received");
    const mid = await stockOf(f);
    expect(Number(mid.Arroz) - Number(before.Arroz ?? 0)).toBe(15000);
    expect(Number(mid.Aceite) - Number(before.Aceite ?? 0)).toBe(10000);

    // No se puede recibir más de lo pendiente (quedan 10 kg de arroz).
    await expect(
      withTenant(f.owner, f.org, (tx, ctx) =>
        receiveOrder(tx, ctx, id, { lines: [{ lineId: riceLine.id, quantity: "10,001", unit: "kg" }], idempotencyKey: randomUUID() }),
      ),
    ).rejects.toThrow(/más de lo pendiente/);
    await expect(
      withTenant(f.owner, f.org, (tx, ctx) =>
        receiveOrder(tx, ctx, id, { lines: [{ lineId: oilLine.id, quantity: "1", unit: "ml" }], idempotencyKey: randomUUID() }),
      ),
    ).rejects.toThrow(/más de lo pendiente/);

    const r2 = await withTenant(f.owner, f.org, (tx, ctx) =>
      receiveOrder(tx, ctx, id, { lines: [{ lineId: riceLine.id, quantity: "10", unit: "kg" }], idempotencyKey: randomUUID() }),
    );
    expect(r2.status).toBe("received");
    const done = await withTenant(f.owner, f.org, (tx, ctx) => getOrder(tx, ctx, id));
    expect(done.lines.map((l) => [l.ingredientName, l.quantityReceived])).toEqual([
      ["Aceite", "10000.000"],
      ["Arroz", "25000.000"],
    ]);
    expect(done.receipts).toHaveLength(2);
    await expect(withTenant(f.owner, f.org, (tx, ctx) => cancelOrder(tx, ctx, id))).rejects.toBeInstanceOf(ValidationError);

    const ingredients = await withTenant(f.owner, f.org, (tx, ctx) => listIngredients(tx, ctx));
    expect(ingredients.find((i) => i.name === "Arroz")!.costCentsPerRef).toBe("215.0000");
    expect(ingredients.find((i) => i.name === "Aceite")!.costCentsPerRef).toBe("640.0000");

    // Cada línea de recepción está enlazada a un movimiento de entrada.
    const { rows } = await withAdminClient((c) =>
      c.query(
        `SELECT m.kind, m.quantity_delta::text AS delta FROM goods_receipt_lines rl
           JOIN stock_movements m ON m.id = rl.movement_id
           JOIN goods_receipts g ON g.id = rl.receipt_id WHERE g.order_id = $1 ORDER BY m.created_at, m.quantity_delta`,
        [id],
      ),
    );
    expect(rows.every((r) => r.kind === "receipt")).toBe(true);
    expect(rows.map((r) => r.delta).sort()).toEqual(["10000.000", "10000.000", "15000.000"]);
  });

  it("recepciones idempotentes, también con reintentos simultáneos", async () => {
    const id = await draftOrder(f);
    await withTenant(f.owner, f.org, (tx, ctx) => markOrderSent(tx, ctx, id));
    const order = await withTenant(f.owner, f.org, (tx, ctx) => getOrder(tx, ctx, id));
    const rice = order.lines.find((l) => l.ingredientName === "Arroz")!;
    const before = await stockOf(f);
    const key = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        withTenant(f.owner, f.org, (tx, ctx) =>
          receiveOrder(tx, ctx, id, { lines: [{ lineId: rice.id, quantity: "5", unit: "kg" }], idempotencyKey: key }),
        ),
      ),
    );
    expect(new Set(results.map((r) => r.receiptId)).size).toBe(1);
    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    const after = await stockOf(f);
    expect(Number(after.Arroz) - Number(before.Arroz)).toBe(5000);

    const other = await draftOrder(f);
    await withTenant(f.owner, f.org, (tx, ctx) => markOrderSent(tx, ctx, other));
    await expect(
      withTenant(f.owner, f.org, (tx, ctx) =>
        receiveOrder(tx, ctx, other, { lines: [{ lineId: rice.id, quantity: "1", unit: "kg" }], idempotencyKey: key }),
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("recepciones simultáneas distintas no superan lo pedido", async () => {
    const id = await draftOrder(f);
    await withTenant(f.owner, f.org, (tx, ctx) => markOrderSent(tx, ctx, id));
    const order = await withTenant(f.owner, f.org, (tx, ctx) => getOrder(tx, ctx, id));
    const oil = order.lines.find((l) => l.ingredientName === "Aceite")!; // 10 l
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () =>
        withTenant(f.owner, f.org, (tx, ctx) =>
          receiveOrder(tx, ctx, id, { lines: [{ lineId: oil.id, quantity: "4", unit: "l" }], idempotencyKey: randomUUID() }),
        ),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    const after = await withTenant(f.owner, f.org, (tx, ctx) => getOrder(tx, ctx, id));
    expect(after.lines.find((l) => l.id === oil.id)!.quantityReceived).toBe("8000.000");
  });

  it("valida proveedores, pedidos y cancelación", async () => {
    await expect(
      withTenant(f.owner, f.org, (tx, ctx) => createSupplier(tx, ctx, { name: "Distribuciones Levante" })),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      withTenant(f.owner, f.org, (tx, ctx) => createSupplier(tx, ctx, { name: "X", email: "no-es-correo" })),
    ).rejects.toBeInstanceOf(ValidationError);
    const id = await draftOrder(f);
    await withTenant(f.owner, f.org, (tx, ctx) => cancelOrder(tx, ctx, id));
    await expect(withTenant(f.owner, f.org, (tx, ctx) => markOrderSent(tx, ctx, id))).rejects.toBeInstanceOf(ValidationError);
    const empty = await withTenant(f.owner, f.org, (tx, ctx) =>
      createOrder(tx, ctx, { supplierId: f.supplier, warehouseId: f.warehouse }),
    );
    await expect(withTenant(f.owner, f.org, (tx, ctx) => markOrderSent(tx, ctx, empty))).rejects.toThrow(/no tiene líneas/);
    await withTenant(f.owner, f.org, (tx, ctx) => setSupplierActive(tx, ctx, f.supplier, false));
    await expect(
      withTenant(f.owner, f.org, (tx, ctx) => createOrder(tx, ctx, { supplierId: f.supplier, warehouseId: f.warehouse })),
    ).rejects.toThrow(/archivado/);
    await withTenant(f.owner, f.org, (tx, ctx) => setSupplierActive(tx, ctx, f.supplier, true));
  });

  it("las recepciones son inmutables para la aplicación", async () => {
    await withAppClient(async (c) => {
      for (const sql of ["DELETE FROM goods_receipts", "UPDATE goods_receipt_lines SET quantity = 999", "DELETE FROM purchase_orders"]) {
        await c.query("BEGIN");
        await c.query("SELECT set_config('app.user_id', $1, true), set_config('app.org_id', $2, true)", [f.owner.id, f.org]);
        await expect(c.query(sql), sql).rejects.toThrow(/permission denied/);
        await c.query("ROLLBACK");
      }
    });
  });
});

describe("compras: permisos", () => {
  it("staff recibe mercancía sin ver precios; no crea ni edita pedidos", async () => {
    const f = await setup("buy-roles");
    const staff = await createTestUser("buy-staff");
    await addMember(f.org, staff, "staff");
    const id = await draftOrder(f);
    await withTenant(f.owner, f.org, (tx, ctx) => markOrderSent(tx, ctx, id));

    const seen = await withTenant(staff, f.org, (tx, ctx) => getOrder(tx, ctx, id));
    expect(seen.totalCents).toBeNull();
    expect(seen.lines.every((l) => l.unitPriceCents === null && l.lineTotalCents === null)).toBe(true);
    expect((await withTenant(staff, f.org, (tx, ctx) => listOrders(tx, ctx))).every((o) => o.totalCents === null)).toBe(true);

    const rice = seen.lines.find((l) => l.ingredientName === "Arroz")!;
    const r = await withTenant(staff, f.org, (tx, ctx) =>
      receiveOrder(tx, ctx, id, { lines: [{ lineId: rice.id, quantity: "25", unit: "kg" }], idempotencyKey: randomUUID() }),
    );
    expect(r.status).toBe("partially_received");

    await expect(
      withTenant(staff, f.org, (tx, ctx) => createOrder(tx, ctx, { supplierId: f.supplier, warehouseId: f.warehouse })),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(withTenant(staff, f.org, (tx, ctx) => cancelOrder(tx, ctx, id))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(withTenant(staff, f.org, (tx, ctx) => createSupplier(tx, ctx, { name: "Otro" }))).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});

describe("compras: aislamiento entre organizaciones", () => {
  it("A no ve ni opera pedidos, proveedores o líneas de B", async () => {
    const a = await setup("buy-a");
    const b = await setup("buy-b");
    const orderB = await draftOrder(b);
    const lineB = (await withTenant(b.owner, b.org, (tx, ctx) => getOrder(tx, ctx, orderB))).lines[0]!;

    expect(await withTenant(a.owner, a.org, (tx, ctx) => listOrders(tx, ctx))).toEqual([]);
    for (const op of [
      (tx: never, ctx: never) => getOrder(tx, ctx, orderB),
      (tx: never, ctx: never) => markOrderSent(tx, ctx, orderB),
      (tx: never, ctx: never) => cancelOrder(tx, ctx, orderB),
      (tx: never, ctx: never) => setOrderLine(tx, ctx, orderB, { ingredientId: a.rice, quantity: "1", unit: "kg", unitPrice: "1" }),
      (tx: never, ctx: never) => removeOrderLine(tx, ctx, orderB, lineB.id),
      (tx: never, ctx: never) => receiveOrder(tx, ctx, orderB, { lines: [{ lineId: lineB.id, quantity: "1", unit: "kg" }], idempotencyKey: randomUUID() }),
      (tx: never, ctx: never) => createOrder(tx, ctx, { supplierId: b.supplier, warehouseId: a.warehouse }),
      (tx: never, ctx: never) => createOrder(tx, ctx, { supplierId: a.supplier, warehouseId: b.warehouse }),
      (tx: never, ctx: never) => setSupplierActive(tx, ctx, b.supplier, false),
    ]) {
      await expect(withTenant(a.owner, a.org, op as never)).rejects.toBeInstanceOf(NotFoundError);
    }
    // Una línea de B no se puede recibir en un pedido de A.
    const orderA = await draftOrder(a);
    await withTenant(a.owner, a.org, (tx, ctx) => markOrderSent(tx, ctx, orderA));
    await expect(
      withTenant(a.owner, a.org, (tx, ctx) =>
        receiveOrder(tx, ctx, orderA, { lines: [{ lineId: lineB.id, quantity: "1", unit: "kg" }], idempotencyKey: randomUUID() }),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
    // Ingrediente de B en un pedido de A.
    const orderA2 = await withTenant(a.owner, a.org, (tx, ctx) => createOrder(tx, ctx, { supplierId: a.supplier, warehouseId: a.warehouse }));
    await expect(
      withTenant(a.owner, a.org, (tx, ctx) =>
        setOrderLine(tx, ctx, orderA2, { ingredientId: b.rice, quantity: "1", unit: "kg", unitPrice: "1" }),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);

    await withAdminClient(async (c) => {
      await expect(
        c.query(
          "INSERT INTO purchase_orders (organization_id, number, supplier_id, warehouse_id) VALUES ($1, 999, $2, $3)",
          [a.org, b.supplier, a.warehouse],
        ),
      ).rejects.toThrow(/purchase_orders_supplier_fk/);
    });
    await withAppClient(async (c) => {
      await c.query("BEGIN");
      try {
        await c.query("SELECT set_config('app.user_id', $1, true), set_config('app.org_id', $2, true)", [a.owner.id, a.org]);
        for (const t of ["suppliers", "purchase_orders", "purchase_order_lines", "goods_receipts", "goods_receipt_lines"]) {
          const { rows } = await c.query(`SELECT count(*)::int AS n FROM ${t} WHERE organization_id <> $1`, [a.org]);
          expect(rows[0].n, t).toBe(0);
        }
      } finally {
        await c.query("ROLLBACK");
      }
    });
  });
});
