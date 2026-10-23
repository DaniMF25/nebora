import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { AuthUser } from "@/server/auth/service";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { createEstablishment } from "@/server/modules/establishments/service";
import {
  applyCount,
  cancelCount,
  getCount,
  listTransfers,
  openCount,
  saveCountLines,
  transferStock,
} from "@/server/modules/inventory/operations";
import {
  correctMovement,
  createIngredient,
  createWarehouse,
  listMovements,
  listStock,
  recordMovement,
} from "@/server/modules/inventory/service";
import { withTenant } from "@/server/tenancy/context";
import { addMember, createTestOrganization, createTestUser, uniqueSuffix } from "../support/factories";

interface Fixture {
  owner: AuthUser;
  staff: AuthUser;
  org: string;
  central: string;
  bar: string;
  flour: string;
  milk: string;
  eggs: string;
}

async function setup(label: string): Promise<Fixture> {
  const owner = await createTestUser(`${label}-owner`);
  const staff = await createTestUser(`${label}-staff`);
  const org = await createTestOrganization(owner, label);
  await addMember(org, staff, "staff");
  return withTenant(owner, org, async (tx, ctx) => {
    const est = await createEstablishment(tx, ctx, { name: "Local", slug: `local-${uniqueSuffix()}` });
    const central = await createWarehouse(tx, ctx, est.id, { name: "Cocina central" });
    const bar = await createWarehouse(tx, ctx, est.id, { name: "Barra" });
    const flour = (await createIngredient(tx, ctx, { name: "Harina", baseUnit: "g" })).id;
    const milk = (await createIngredient(tx, ctx, { name: "Leche", baseUnit: "ml" })).id;
    const eggs = (await createIngredient(tx, ctx, { name: "Huevos", baseUnit: "unit" })).id;
    const receive = (ingredientId: string, quantity: string, unit: string) =>
      recordMovement(tx, ctx, {
        warehouseId: central,
        ingredientId,
        kind: "receipt",
        quantity,
        unit,
        idempotencyKey: randomUUID(),
      });
    await receive(flour, "10", "kg");
    await receive(milk, "6", "l");
    await receive(eggs, "30", "unit");
    return { owner, staff, org, central, bar, flour, milk, eggs };
  });
}

async function stock(f: Fixture): Promise<Record<string, string>> {
  const lines = await withTenant(f.owner, f.org, (tx, ctx) => listStock(tx, ctx));
  return Object.fromEntries(lines.map((l) => [`${l.warehouseName}/${l.ingredientName}`, l.quantity]));
}

const transfer = (f: Fixture, input: Record<string, unknown>, user: AuthUser = f.staff) =>
  withTenant(user, f.org, (tx, ctx) =>
    transferStock(tx, ctx, {
      fromWarehouseId: f.central,
      toWarehouseId: f.bar,
      ingredientId: f.flour,
      unit: "kg",
      idempotencyKey: randomUUID(),
      ...input,
    }),
  );

describe("traspasos entre almacenes", () => {
  let f: Fixture;
  beforeAll(async () => {
    f = await setup("tr");
  });

  it("mueve el stock con dos movimientos enlazados y conserva el total", async () => {
    await transfer(f, { quantity: "2,5", note: "Para el turno de noche" });
    expect(await stock(f)).toMatchObject({ "Cocina central/Harina": "7500.000", "Barra/Harina": "2500.000" });
    const movements = await withTenant(f.owner, f.org, (tx, ctx) => listMovements(tx, ctx, 5));
    expect(
      movements
        .slice(0, 2)
        .map((m) => [m.kind, m.quantityDelta])
        .sort(),
    ).toEqual([
      ["transfer_in", "2500.000"],
      ["transfer_out", "-2500.000"],
    ]);
    const [last] = await withTenant(f.owner, f.org, (tx, ctx) => listTransfers(tx, ctx));
    expect(last).toMatchObject({ fromWarehouseName: "Cocina central", toWarehouseName: "Barra", quantity: "2500.000" });
  });

  it("sin stock suficiente no traspasa nada", async () => {
    const before = await stock(f);
    await expect(transfer(f, { ingredientId: f.eggs, quantity: "31", unit: "unit" })).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(await stock(f)).toEqual(before);
  });

  it("valida origen, destino, unidad y pertenencia", async () => {
    await expect(transfer(f, { toWarehouseId: f.central, quantity: "1" })).rejects.toBeInstanceOf(ValidationError);
    await expect(transfer(f, { quantity: "1", unit: "l" })).rejects.toBeInstanceOf(ValidationError);
    await expect(transfer(f, { quantity: "0" })).rejects.toBeInstanceOf(ValidationError);
    const other = await setup("tr-other");
    await expect(transfer(f, { toWarehouseId: other.bar, quantity: "1" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(transfer(f, { ingredientId: other.flour, quantity: "1" })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("es idempotente: un reintento no duplica y otra operación con la misma clave es un conflicto", async () => {
    const key = randomUUID();
    const before = await stock(f);
    const first = await transfer(f, { quantity: "1", idempotencyKey: key });
    const again = await transfer(f, { quantity: "1", idempotencyKey: key });
    expect(again).toEqual({ transferId: first.transferId, replayed: true });
    expect(
      BigInt((await stock(f))["Barra/Harina"]!.replace(".", "")) - BigInt(before["Barra/Harina"]!.replace(".", "")),
    ).toBe(1000000n);
    await expect(transfer(f, { quantity: "2", idempotencyKey: key })).rejects.toBeInstanceOf(ConflictError);
  });

  it("con traspasos simultáneos nunca queda stock negativo y el total se conserva", async () => {
    const g = await setup("tr-race");
    // 30 huevos: 8 traspasos simultáneos de 5 → solo caben 6.
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () => transfer(g, { ingredientId: g.eggs, quantity: "5", unit: "unit" })),
    );
    const ok = results.filter((r) => r.status === "fulfilled").length;
    expect(ok).toBe(6);
    for (const r of results) if (r.status === "rejected") expect(r.reason).toBeInstanceOf(ValidationError);
    expect(await stock(g)).toMatchObject({ "Cocina central/Huevos": "0.000", "Barra/Huevos": "30.000" });
  });

  it("la BD rechaza un traspaso sin sus dos movimientos", async () => {
    await expect(
      withTenant(f.owner, f.org, (tx, ctx) =>
        tx.query(
          `INSERT INTO stock_transfers (organization_id, from_warehouse_id, to_warehouse_id, ingredient_id, quantity,
                                        idempotency_key, created_by_user_id)
           VALUES ($1, $2, $3, $4, 1, $5, $6)`,
          [ctx.organizationId, f.central, f.bar, f.flour, randomUUID(), ctx.userId],
        ),
      ),
    ).rejects.toMatchObject({ code: "23514", constraint: "stock_transfers_balanced" });
  });

  it("las patas de un traspaso no se anulan sueltas (ni por servicio ni en BD)", async () => {
    const [leg] = (await withTenant(f.owner, f.org, (tx, ctx) => listMovements(tx, ctx, 50))).filter(
      (m) => m.kind === "transfer_out",
    );
    await expect(
      withTenant(f.owner, f.org, (tx, ctx) => correctMovement(tx, ctx, leg!.id, { idempotencyKey: randomUUID() })),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      withTenant(f.owner, f.org, (tx, ctx) =>
        tx.query(
          `INSERT INTO stock_movements (organization_id, warehouse_id, ingredient_id, kind, quantity_delta,
                                        idempotency_key, corrects_movement_id, created_by_user_id)
           VALUES ($1, $2, $3, 'correction', 1, $4, $5, $6)`,
          [ctx.organizationId, leg!.warehouseId, leg!.ingredientId, randomUUID(), leg!.id, ctx.userId],
        ),
      ),
    ).rejects.toMatchObject({ code: "23514", constraint: "stock_movements_correction_kind" });
  });
});

describe("recuentos físicos", () => {
  let f: Fixture;
  beforeAll(async () => {
    f = await setup("cnt");
  });

  it("es ciego mientras está abierto, solo lo aplica un responsable y ajusta lo contado", async () => {
    const id = await withTenant(f.staff, f.org, (tx, ctx) =>
      openCount(tx, ctx, { warehouseId: f.central, note: "Mes" }),
    );
    await expect(
      withTenant(f.staff, f.org, (tx, ctx) => openCount(tx, ctx, { warehouseId: f.central })),
    ).rejects.toBeInstanceOf(ConflictError);
    await withTenant(f.staff, f.org, (tx, ctx) =>
      saveCountLines(tx, ctx, id, {
        lines: [
          { ingredientId: f.flour, quantity: "9,2", unit: "kg" }, // había 10 kg → −800 g
          { ingredientId: f.eggs, quantity: "0", unit: "unit" }, // había 30 → −30
          { ingredientId: f.milk, quantity: "", unit: "l" }, // sin contar: no se toca
        ],
      }),
    );
    const open = await withTenant(f.staff, f.org, (tx, ctx) => getCount(tx, ctx, id));
    expect(open.status).toBe("open");
    expect(open.lines.find((l) => l.ingredientName === "Harina")).toMatchObject({
      counted: "9200.000",
      expected: null,
    });
    expect(open.lines.find((l) => l.ingredientName === "Leche")?.counted).toBeNull();

    // Un movimiento mientras se cuenta: la diferencia se calcula al aplicar.
    await withTenant(f.owner, f.org, (tx, ctx) =>
      recordMovement(tx, ctx, {
        warehouseId: f.central,
        ingredientId: f.flour,
        kind: "consumption",
        quantity: "500",
        unit: "g",
        idempotencyKey: randomUUID(),
      }),
    );

    await expect(withTenant(f.staff, f.org, (tx, ctx) => applyCount(tx, ctx, id))).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    const changes = await withTenant(f.owner, f.org, (tx, ctx) => applyCount(tx, ctx, id));
    expect(changes).toBe(2);
    expect(await stock(f)).toMatchObject({
      "Cocina central/Harina": "9200.000",
      "Cocina central/Huevos": "0.000",
      "Cocina central/Leche": "6000.000",
    });
    const applied = await withTenant(f.staff, f.org, (tx, ctx) => getCount(tx, ctx, id));
    expect(applied.status).toBe("applied");
    expect(applied.lines.map((l) => [l.ingredientName, l.expected, l.difference])).toEqual([
      ["Harina", "9500.000", "-300.000"],
      ["Huevos", "30.000", "-30.000"],
    ]);
    const counts = (await withTenant(f.owner, f.org, (tx, ctx) => listMovements(tx, ctx, 10))).filter(
      (m) => m.kind === "count",
    );
    expect(counts.map((m) => m.quantityDelta).sort()).toEqual(["-30.000", "-300.000"]);

    // Cerrado: ni el servicio ni la BD permiten cambiarlo.
    await expect(
      withTenant(f.staff, f.org, (tx, ctx) =>
        saveCountLines(tx, ctx, id, { lines: [{ ingredientId: f.flour, quantity: "1", unit: "kg" }] }),
      ),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(withTenant(f.owner, f.org, (tx, ctx) => applyCount(tx, ctx, id))).rejects.toBeInstanceOf(
      ConflictError,
    );
    await expect(
      withTenant(f.owner, f.org, (tx, ctx) =>
        tx.query("UPDATE stock_count_lines SET counted_quantity = 1 WHERE organization_id = $1 AND count_id = $2", [
          ctx.organizationId,
          id,
        ]),
      ),
    ).rejects.toMatchObject({ code: "23514", constraint: "stock_count_lines_open" });
    // Los ajustes de recuento no se anulan sueltos.
    await expect(
      withTenant(f.owner, f.org, (tx, ctx) =>
        correctMovement(tx, ctx, counts[0]!.id, { idempotencyKey: randomUUID() }),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("la aplicación no puede marcar un recuento como aplicado sin generar los ajustes", async () => {
    const id = await withTenant(f.owner, f.org, (tx, ctx) => openCount(tx, ctx, { warehouseId: f.bar }));
    await withTenant(f.owner, f.org, (tx, ctx) =>
      saveCountLines(tx, ctx, id, { lines: [{ ingredientId: f.flour, quantity: "3", unit: "kg" }] }),
    );
    await expect(
      withTenant(f.owner, f.org, (tx, ctx) =>
        tx.query(
          "UPDATE stock_counts SET status = 'applied', closed_at = now() WHERE organization_id = $1 AND id = $2",
          [ctx.organizationId, id],
        ),
      ),
    ).rejects.toMatchObject({ code: "23514", constraint: "stock_counts_transition" });
    await expect(
      withTenant(f.owner, f.org, (tx) =>
        tx.query("UPDATE stock_count_lines SET expected_quantity = 0 WHERE count_id = $1", [id]),
      ),
    ).rejects.toMatchObject({ code: "42501" }); // sin privilegio sobre esa columna
    await withTenant(f.owner, f.org, (tx, ctx) => cancelCount(tx, ctx, id));
    const cancelled = await withTenant(f.owner, f.org, (tx, ctx) => getCount(tx, ctx, id));
    expect(cancelled.status).toBe("cancelled");
    expect((await stock(f))["Barra/Harina"]).toBeUndefined(); // nada aplicado
    // Tras cancelar se puede abrir otro en el mismo almacén.
    await withTenant(f.owner, f.org, (tx, ctx) => openCount(tx, ctx, { warehouseId: f.bar }));
  });

  it("dos aplicaciones simultáneas solo ajustan una vez", async () => {
    const g = await setup("cnt-race");
    const id = await withTenant(g.owner, g.org, (tx, ctx) => openCount(tx, ctx, { warehouseId: g.central }));
    await withTenant(g.owner, g.org, (tx, ctx) =>
      saveCountLines(tx, ctx, id, { lines: [{ ingredientId: g.eggs, quantity: "12", unit: "unit" }] }),
    );
    // Orden forzado: la primera aplicación queda sin confirmar mientras arranca la segunda.
    let applied!: () => void;
    let release!: () => void;
    const firstApplied = new Promise<void>((r) => (applied = r));
    const releaseFirst = new Promise<void>((r) => (release = r));
    const first = withTenant(g.owner, g.org, async (tx, ctx) => {
      const n = await applyCount(tx, ctx, id);
      applied();
      await releaseFirst;
      return n;
    });
    await firstApplied;
    const second = withTenant(g.owner, g.org, (tx, ctx) => applyCount(tx, ctx, id));
    await new Promise((r) => setTimeout(r, 300)); // la segunda debe quedar esperando al bloqueo
    release();
    const results = await Promise.allSettled([first, second]);
    expect(results[0]).toMatchObject({ status: "fulfilled", value: 1 });
    expect(results[1].status).toBe("rejected");
    if (results[1].status === "rejected") expect(results[1].reason).toBeInstanceOf(ConflictError);
    expect((await stock(g))["Cocina central/Huevos"]).toBe("12.000");
    const counts = (await withTenant(g.owner, g.org, (tx, ctx) => listMovements(tx, ctx, 20))).filter(
      (m) => m.kind === "count",
    );
    expect(counts).toHaveLength(1);
  });

  it("otra organización no puede ver, contar ni aplicar el recuento", async () => {
    const id = await withTenant(f.owner, f.org, (tx, ctx) => openCount(tx, ctx, { warehouseId: f.central }));
    const other = await setup("cnt-other");
    await expect(withTenant(other.owner, other.org, (tx, ctx) => getCount(tx, ctx, id))).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      withTenant(other.owner, other.org, (tx, ctx) =>
        saveCountLines(tx, ctx, id, { lines: [{ ingredientId: other.flour, quantity: "1", unit: "kg" }] }),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
    // Llamar directamente a la función con un recuento ajeno: no lo encuentra o no tiene permiso.
    await expect(
      withTenant(other.owner, other.org, (tx) => tx.query("SELECT app.apply_stock_count($1)", [id])),
    ).rejects.toMatchObject({ code: expect.stringMatching(/^(P0002|42501)$/) });
    const mine = await withTenant(f.owner, f.org, (tx, ctx) => getCount(tx, ctx, id));
    expect(mine.status).toBe("open");
  });
});
