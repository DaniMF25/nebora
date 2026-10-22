import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { AuthUser } from "@/server/auth/service";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { createEstablishment } from "@/server/modules/establishments/service";
import {
  correctMovement,
  createIngredient,
  createWarehouse,
  listIngredients,
  listMovements,
  listStock,
  listWarehouses,
  recordMovement,
  updateIngredient,
} from "@/server/modules/inventory/service";
import { withTenant } from "@/server/tenancy/context";
import { withAdminClient, withAppClient } from "../support/db";
import { addMember, createTestOrganization, createTestUser, uniqueSuffix } from "../support/factories";

interface Fixture {
  owner: AuthUser;
  org: string;
  warehouse: string;
  flour: string; // g
  milk: string; // ml
}

async function setup(label: string): Promise<Fixture> {
  const owner = await createTestUser(`${label}-owner`);
  const org = await createTestOrganization(owner, label);
  return withTenant(owner, org, async (tx, ctx) => {
    const est = await createEstablishment(tx, ctx, { name: "Local", slug: `local-${uniqueSuffix()}` });
    const warehouse = await createWarehouse(tx, ctx, est.id, { name: "Cámara" });
    const flour = (await createIngredient(tx, ctx, { name: "Harina", baseUnit: "g", reorderLevel: "2000" })).id;
    const milk = (await createIngredient(tx, ctx, { name: "Leche", baseUnit: "ml" })).id;
    return { owner, org, warehouse, flour, milk };
  });
}

function key() {
  return randomUUID();
}

async function stockOf(f: Fixture, ingredientId: string): Promise<string | undefined> {
  const lines = await withTenant(f.owner, f.org, (tx, ctx) => listStock(tx, ctx));
  return lines.find((l) => l.ingredientId === ingredientId && l.warehouseId === f.warehouse)?.quantity;
}

function move(f: Fixture, input: Record<string, unknown>, user: AuthUser = f.owner) {
  return withTenant(user, f.org, (tx, ctx) =>
    recordMovement(tx, ctx, { warehouseId: f.warehouse, idempotencyKey: key(), ...input }),
  );
}

describe("movimientos de stock", () => {
  let f: Fixture;
  beforeAll(async () => {
    f = await setup("inv");
  });

  it("las entradas y salidas actualizan el saldo con conversión de unidades", async () => {
    await move(f, { ingredientId: f.flour, kind: "receipt", quantity: "5", unit: "kg" });
    await move(f, { ingredientId: f.flour, kind: "consumption", quantity: "1250", unit: "g" });
    await move(f, { ingredientId: f.flour, kind: "waste", quantity: "0,25", unit: "kg" });
    expect(await stockOf(f, f.flour)).toBe("3500.000");
    await move(f, { ingredientId: f.flour, kind: "adjustment", direction: "decrease", quantity: "500", unit: "g" });
    expect(await stockOf(f, f.flour)).toBe("3000.000");
    const lines = await withTenant(f.owner, f.org, (tx, ctx) => listStock(tx, ctx));
    expect(lines.find((l) => l.ingredientId === f.flour)!.belowReorder).toBe(false);
  });

  it("no permite stock negativo y el intento no deja rastro", async () => {
    const before = (await withTenant(f.owner, f.org, (tx, ctx) => listMovements(tx, ctx))).length;
    await expect(move(f, { ingredientId: f.flour, kind: "consumption", quantity: "3,001", unit: "kg" })).rejects.toThrow(
      /Stock insuficiente/,
    );
    await expect(move(f, { ingredientId: f.milk, kind: "consumption", quantity: "1", unit: "ml" })).rejects.toThrow(
      /Stock insuficiente/,
    );
    expect(await stockOf(f, f.flour)).toBe("3000.000");
    expect((await withTenant(f.owner, f.org, (tx, ctx) => listMovements(tx, ctx))).length).toBe(before);
  });

  it("un reintento con la misma clave no duplica el movimiento", async () => {
    const k = key();
    const input = { ingredientId: f.milk, kind: "receipt", quantity: "1", unit: "l", idempotencyKey: k };
    const first = await move(f, input);
    const second = await move(f, input);
    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.movement.id).toBe(first.movement.id);
    expect(await stockOf(f, f.milk)).toBe("1000.000");
    // Reutilizar la clave con otros datos es un conflicto.
    await expect(move(f, { ...input, quantity: "2" })).rejects.toBeInstanceOf(ConflictError);
    expect(await stockOf(f, f.milk)).toBe("1000.000");
  });

  it("reintentos simultáneos con la misma clave aplican el movimiento una sola vez", async () => {
    const k = key();
    const results = await Promise.all(
      Array.from({ length: 6 }, () => move(f, { ingredientId: f.milk, kind: "receipt", quantity: "100", unit: "ml", idempotencyKey: k })),
    );
    expect(new Set(results.map((r) => r.movement.id)).size).toBe(1);
    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    expect(await stockOf(f, f.milk)).toBe("1100.000");
  });

  it("salidas simultáneas nunca dejan el stock en negativo", async () => {
    const g = await setup("inv-race");
    await move(g, { ingredientId: g.flour, kind: "receipt", quantity: "500", unit: "g" });
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => move(g, { ingredientId: g.flour, kind: "consumption", quantity: "100", unit: "g" })),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(5);
    for (const r of results) {
      if (r.status === "rejected") expect(r.reason).toBeInstanceOf(ValidationError);
    }
    expect(await stockOf(g, g.flour)).toBe("0.000");
    const lines = await withTenant(g.owner, g.org, (tx, ctx) => listStock(tx, ctx));
    expect(lines.find((l) => l.ingredientId === g.flour)!.belowReorder).toBe(true);
  });

  it("el saldo coincide siempre con la suma de movimientos", async () => {
    const { rows } = await withAdminClient((c) =>
      c.query(
        `SELECT l.ingredient_id, l.quantity::text AS level, sum(m.quantity_delta)::text AS total
           FROM stock_levels l JOIN stock_movements m ON m.warehouse_id = l.warehouse_id AND m.ingredient_id = l.ingredient_id
          WHERE l.organization_id = $1 GROUP BY l.ingredient_id, l.quantity`,
        [f.org],
      ),
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.level).toBe(r.total);
  });

  it("corrige con un movimiento compensatorio, una sola vez", async () => {
    const { movement } = await move(f, { ingredientId: f.flour, kind: "waste", quantity: "100", unit: "g" });
    expect(await stockOf(f, f.flour)).toBe("2900.000");
    const k = key();
    const correction = await withTenant(f.owner, f.org, (tx, ctx) => correctMovement(tx, ctx, movement.id, { idempotencyKey: k, note: "Error al registrar" }));
    expect(correction.movement).toMatchObject({ kind: "correction", quantityDelta: "100.000", correctsMovementId: movement.id });
    expect(await stockOf(f, f.flour)).toBe("3000.000");
    // Reintento de la misma corrección: idempotente.
    const again = await withTenant(f.owner, f.org, (tx, ctx) => correctMovement(tx, ctx, movement.id, { idempotencyKey: k }));
    expect(again.replayed).toBe(true);
    // Otra corrección distinta del mismo movimiento: rechazada.
    await expect(
      withTenant(f.owner, f.org, (tx, ctx) => correctMovement(tx, ctx, movement.id, { idempotencyKey: key() })),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      withTenant(f.owner, f.org, (tx, ctx) => correctMovement(tx, ctx, correction.movement.id, { idempotencyKey: key() })),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(await stockOf(f, f.flour)).toBe("3000.000");
    const list = await withTenant(f.owner, f.org, (tx, ctx) => listMovements(tx, ctx));
    expect(list.find((m) => m.id === movement.id)!.correctedByMovementId).toBe(correction.movement.id);
  });

  it("valida unidades, cantidades, tipos y claves", async () => {
    for (const bad of [
      { ingredientId: f.flour, kind: "receipt", quantity: "1", unit: "l" },
      { ingredientId: f.flour, kind: "receipt", quantity: "-1", unit: "g" },
      { ingredientId: f.flour, kind: "receipt", quantity: "0", unit: "g" },
      { ingredientId: f.flour, kind: "correction", quantity: "1", unit: "g" },
      { ingredientId: f.flour, kind: "adjustment", quantity: "1", unit: "g" },
      { ingredientId: f.flour, kind: "receipt", quantity: "1", unit: "g", idempotencyKey: "corta" },
      { ingredientId: f.flour, kind: "receipt", quantity: "1", unit: "g", quantityDelta: "-99" },
    ]) {
      await expect(move(f, bad)).rejects.toBeInstanceOf(ValidationError);
    }
    await withTenant(f.owner, f.org, (tx, ctx) => updateIngredient(tx, ctx, f.milk, { active: false }));
    await expect(move(f, { ingredientId: f.milk, kind: "receipt", quantity: "1", unit: "ml" })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await withTenant(f.owner, f.org, (tx, ctx) => updateIngredient(tx, ctx, f.milk, { active: true }));
  });

  it("los movimientos son inmutables y el saldo no se puede escribir directamente", async () => {
    await withAppClient(async (c) => {
      for (const sql of [
        "UPDATE stock_movements SET quantity_delta = 1000",
        "DELETE FROM stock_movements",
        "UPDATE stock_levels SET quantity = 999999",
        "INSERT INTO stock_levels (organization_id, warehouse_id, ingredient_id, quantity) VALUES ($1, $2, $3, 1)",
      ]) {
        await c.query("BEGIN");
        await c.query("SELECT set_config('app.user_id', $1, true), set_config('app.org_id', $2, true)", [f.owner.id, f.org]);
        await expect(
          c.query(sql, sql.includes("$1") ? [f.org, f.warehouse, f.flour] : []),
          sql,
        ).rejects.toThrow(/permission denied/);
        await c.query("ROLLBACK");
      }
    });
    await expect(
      withAdminClient((c) => c.query("DELETE FROM ingredients WHERE id = $1", [f.flour])),
    ).rejects.toThrow(/stock_/);
  });
});

describe("inventario: permisos", () => {
  it("staff registra movimientos pero no corrige ni configura", async () => {
    const f = await setup("inv-roles");
    const staff = await createTestUser("inv-staff");
    await addMember(f.org, staff, "staff");
    const { movement } = await move(f, { ingredientId: f.flour, kind: "receipt", quantity: "1", unit: "kg" }, staff);
    expect(movement.createdByName).toBe("inv-staff");
    await expect(
      withTenant(staff, f.org, (tx, ctx) => correctMovement(tx, ctx, movement.id, { idempotencyKey: key() })),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      withTenant(staff, f.org, (tx, ctx) => createIngredient(tx, ctx, { name: "Sal", baseUnit: "g" })),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("inventario: aislamiento entre organizaciones", () => {
  let a: Fixture;
  let b: Fixture;
  beforeAll(async () => {
    a = await setup("inv-a");
    b = await setup("inv-b");
    await move(b, { ingredientId: b.flour, kind: "receipt", quantity: "10", unit: "kg" });
  });

  it("A no ve ni mueve el stock de B", async () => {
    const lists = await withTenant(a.owner, a.org, async (tx, ctx) => ({
      ingredients: await listIngredients(tx, ctx),
      warehouses: await listWarehouses(tx, ctx),
      stock: await listStock(tx, ctx),
      movements: await listMovements(tx, ctx),
    }));
    expect(lists.ingredients.map((i) => i.id)).not.toContain(b.flour);
    expect(lists.warehouses.map((w) => w.id)).not.toContain(b.warehouse);
    expect(lists.stock).toEqual([]);
    expect(lists.movements).toEqual([]);

    // Ids de B desde el contexto de A.
    for (const input of [
      { warehouseId: b.warehouse, ingredientId: a.flour },
      { warehouseId: a.warehouse, ingredientId: b.flour },
      { warehouseId: b.warehouse, ingredientId: b.flour },
    ]) {
      await expect(
        withTenant(a.owner, a.org, (tx, ctx) =>
          recordMovement(tx, ctx, { ...input, kind: "consumption", quantity: "1", unit: "kg", idempotencyKey: key() }),
        ),
      ).rejects.toBeInstanceOf(NotFoundError);
    }
    const bMovements = await withTenant(b.owner, b.org, (tx, ctx) => listMovements(tx, ctx));
    await expect(
      withTenant(a.owner, a.org, (tx, ctx) => correctMovement(tx, ctx, bMovements[0]!.id, { idempotencyKey: key() })),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      withTenant(a.owner, a.org, (tx, ctx) => updateIngredient(tx, ctx, b.flour, { name: "Hackeada" })),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(await stockOf(b, b.flour)).toBe("10000.000");
  });

  it("la misma clave de idempotencia en otra organización no interfiere", async () => {
    const k = key();
    await move(a, { ingredientId: a.flour, kind: "receipt", quantity: "1", unit: "kg", idempotencyKey: k });
    const r = await move(b, { ingredientId: b.flour, kind: "receipt", quantity: "1", unit: "kg", idempotencyKey: k });
    expect(r.replayed).toBe(false);
    expect(await stockOf(b, b.flour)).toBe("11000.000");
  });

  it("el esquema impide mezclar organizaciones y RLS oculta filas ajenas", async () => {
    await withAdminClient(async (c) => {
      await expect(
        c.query(
          `INSERT INTO stock_movements (organization_id, warehouse_id, ingredient_id, kind, quantity_delta, idempotency_key)
           VALUES ($1, $2, $3, 'receipt', 1, 'mezcla-org-12345')`,
          [a.org, a.warehouse, b.flour],
        ),
      ).rejects.toThrow(/stock_movements_ingredient_fk/);
    });
    await withAppClient(async (c) => {
      await c.query("BEGIN");
      try {
        await c.query("SELECT set_config('app.user_id', $1, true), set_config('app.org_id', $2, true)", [a.owner.id, a.org]);
        for (const t of ["ingredients", "warehouses", "stock_levels", "stock_movements"]) {
          const { rows } = await c.query(`SELECT count(*)::int AS n FROM ${t} WHERE organization_id <> $1`, [a.org]);
          expect(rows[0].n, t).toBe(0);
        }
        await expect(
          c.query(
            `INSERT INTO stock_movements (organization_id, warehouse_id, ingredient_id, kind, quantity_delta, idempotency_key, created_by_user_id)
             VALUES ($1, $2, $3, 'receipt', 1, 'intrusion-1234', $4)`,
            [b.org, b.warehouse, b.flour, a.owner.id],
          ),
        ).rejects.toThrow(/row-level security/);
      } finally {
        await c.query("ROLLBACK");
      }
    });
  });
});
