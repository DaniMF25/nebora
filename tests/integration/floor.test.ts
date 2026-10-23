import { beforeAll, describe, expect, it } from "vitest";
import type { AuthUser } from "@/server/auth/service";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { createEstablishment } from "@/server/modules/establishments/service";
import {
  createTable,
  createZone,
  deleteTable,
  deleteZone,
  getFloorPlan,
  moveTable,
  updateTable,
  updateZone,
} from "@/server/modules/floor/service";
import { withTenant } from "@/server/tenancy/context";
import { withAdminClient, withAppClient } from "../support/db";
import { addMember, createTestOrganization, createTestUser, uniqueSuffix } from "../support/factories";

interface Fixture {
  owner: AuthUser;
  org: string;
  est: string;
  zone: string;
}

async function setup(label: string): Promise<Fixture> {
  const owner = await createTestUser(`${label}-owner`);
  const org = await createTestOrganization(owner, label);
  return withTenant(owner, org, async (tx, ctx) => {
    const est = (await createEstablishment(tx, ctx, { name: "Local", slug: `local-${uniqueSuffix()}` })).id;
    const zone = await createZone(tx, ctx, est, { name: "Comedor", planWidth: 8, planHeight: 6 });
    return { owner, org, est, zone };
  });
}

const run = (f: Fixture, op: (tx: never, ctx: never) => Promise<unknown>, user: AuthUser = f.owner) =>
  withTenant(user, f.org, op as never);

describe("plano de sala", () => {
  let f: Fixture;
  beforeAll(async () => {
    f = await setup("floor");
  });

  it("crea mesas en huecos libres y calcula las plazas", async () => {
    const t1 = await withTenant(f.owner, f.org, (tx, ctx) => createTable(tx, ctx, f.zone, { name: "M1", maxCapacity: 4 }));
    const t2 = await withTenant(f.owner, f.org, (tx, ctx) =>
      createTable(tx, ctx, f.zone, { name: "M2", minCapacity: 2, maxCapacity: 6, shape: "rectangle", width: 3 }),
    );
    expect([t1.x, t1.y]).toEqual([0, 0]);
    expect([t2.x, t2.y]).toEqual([2, 0]);
    const plan = await withTenant(f.owner, f.org, (tx, ctx) => getFloorPlan(tx, ctx, f.est));
    expect(plan.zones.map((z) => [z.name, z.tables.length])).toEqual([["Comedor", 2]]);
    expect(plan.totalSeats).toBe(10);
    expect(plan.activeTables).toBe(2);
  });

  it("no permite solapar mesas ni salirse del plano", async () => {
    const plan = await withTenant(f.owner, f.org, (tx, ctx) => getFloorPlan(tx, ctx, f.est));
    const m1 = plan.zones[0]!.tables.find((t) => t.name === "M1")!;
    await expect(withTenant(f.owner, f.org, (tx, ctx) => moveTable(tx, ctx, m1.id, { x: 3, y: 0 }))).rejects.toBeInstanceOf(
      ConflictError,
    );
    await expect(withTenant(f.owner, f.org, (tx, ctx) => moveTable(tx, ctx, m1.id, { x: 7, y: 0 }))).rejects.toBeInstanceOf(
      ValidationError,
    );
    const moved = await withTenant(f.owner, f.org, (tx, ctx) => moveTable(tx, ctx, m1.id, { x: 0, y: 4 }));
    expect([moved.x, moved.y]).toEqual([0, 4]);
    // Agrandar una mesa hasta solapar o salirse también se rechaza.
    await expect(withTenant(f.owner, f.org, (tx, ctx) => updateTable(tx, ctx, m1.id, { height: 3 }))).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(withTenant(f.owner, f.org, (tx, ctx) => updateTable(tx, ctx, m1.id, { width: 3, height: 2 }))).resolves.toMatchObject({ width: 3 });
  });

  it("la base de datos impide solapes aunque se salte el servicio", async () => {
    await withAdminClient(async (c) => {
      const { rows } = await c.query("SELECT establishment_id FROM zones WHERE id = $1", [f.zone]);
      await expect(
        c.query(
          `INSERT INTO dining_tables (organization_id, establishment_id, zone_id, name, max_capacity, x, y, width, height)
           VALUES ($1, $2, $3, 'X1', 2, 3, 1, 2, 2)`,
          [f.org, rows[0].establishment_id, f.zone],
        ),
      ).rejects.toThrow(/dining_tables_no_overlap/);
      await expect(
        c.query(
          `INSERT INTO dining_tables (organization_id, establishment_id, zone_id, name, max_capacity, x, y, width, height)
           VALUES ($1, $2, $3, 'X2', 2, 7, 5, 2, 2)`,
          [f.org, rows[0].establishment_id, f.zone],
        ),
      ).rejects.toThrow(/table outside plan/);
    });
  });

  it("dos movimientos simultáneos al mismo hueco: solo uno lo ocupa", async () => {
    const g = await setup("floor-race");
    const a = await withTenant(g.owner, g.org, (tx, ctx) => createTable(tx, ctx, g.zone, { name: "A", maxCapacity: 2 }));
    const b = await withTenant(g.owner, g.org, (tx, ctx) => createTable(tx, ctx, g.zone, { name: "B", maxCapacity: 2 }));
    const results = await Promise.allSettled([
      withTenant(g.owner, g.org, (tx, ctx) => moveTable(tx, ctx, a.id, { x: 4, y: 4 })),
      withTenant(g.owner, g.org, (tx, ctx) => moveTable(tx, ctx, b.id, { x: 5, y: 4 })),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(ConflictError);
  });

  it("valida capacidades, nombres, tamaños y campos extra", async () => {
    for (const bad of [
      { name: "Z", maxCapacity: 0 },
      { name: "Z", minCapacity: 6, maxCapacity: 4 },
      { name: "Z", maxCapacity: 4, width: 9 },
      { name: "Z", maxCapacity: 4, shape: "triangle" },
      { name: "", maxCapacity: 4 },
      { name: "Z", maxCapacity: 4, x: 0 },
    ]) {
      await expect(withTenant(f.owner, f.org, (tx, ctx) => createTable(tx, ctx, f.zone, bad))).rejects.toBeInstanceOf(
        ValidationError,
      );
    }
    await expect(
      withTenant(f.owner, f.org, (tx, ctx) => createTable(tx, ctx, f.zone, { name: "m1", maxCapacity: 2 })),
    ).resolves.toBeTruthy(); // los nombres distinguen mayúsculas
    await expect(
      withTenant(f.owner, f.org, (tx, ctx) => createTable(tx, ctx, f.zone, { name: "M1", maxCapacity: 2 })),
    ).rejects.toBeInstanceOf(ConflictError);
    const plan = await withTenant(f.owner, f.org, (tx, ctx) => getFloorPlan(tx, ctx, f.est));
    const m2 = plan.zones[0]!.tables.find((t) => t.name === "M2")!;
    await expect(
      withTenant(f.owner, f.org, (tx, ctx) => updateTable(tx, ctx, m2.id, { minCapacity: 10 })),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("si no queda hueco, la creación falla con un mensaje claro", async () => {
    const g = await setup("floor-full");
    await withTenant(g.owner, g.org, (tx, ctx) => updateZone(tx, ctx, g.zone, { planWidth: 4, planHeight: 4 }));
    for (const name of ["A", "B", "C", "D"]) {
      await withTenant(g.owner, g.org, (tx, ctx) => createTable(tx, ctx, g.zone, { name, maxCapacity: 2 }));
    }
    await expect(
      withTenant(g.owner, g.org, (tx, ctx) => createTable(tx, ctx, g.zone, { name: "E", maxCapacity: 2 })),
    ).rejects.toThrow(/No hay hueco libre/);
  });

  it("el plano no puede encogerse dejando mesas fuera", async () => {
    const g = await setup("floor-shrink");
    const t = await withTenant(g.owner, g.org, (tx, ctx) => createTable(tx, ctx, g.zone, { name: "A", maxCapacity: 2 }));
    await withTenant(g.owner, g.org, (tx, ctx) => moveTable(tx, ctx, t.id, { x: 6, y: 4 }));
    await expect(
      withTenant(g.owner, g.org, (tx, ctx) => updateZone(tx, ctx, g.zone, { planWidth: 6 })),
    ).rejects.toThrow(/hay mesas que quedarían fuera/);
    await withTenant(g.owner, g.org, (tx, ctx) => updateZone(tx, ctx, g.zone, { planWidth: 10, name: "Comedor grande" }));
  });

  it("desactivar libera el hueco; reactivar sobre otra mesa se rechaza", async () => {
    const g = await setup("floor-active");
    const a = await withTenant(g.owner, g.org, (tx, ctx) => createTable(tx, ctx, g.zone, { name: "A", maxCapacity: 2 }));
    await withTenant(g.owner, g.org, (tx, ctx) => updateTable(tx, ctx, a.id, { active: false }));
    const b = await withTenant(g.owner, g.org, (tx, ctx) => createTable(tx, ctx, g.zone, { name: "B", maxCapacity: 2 }));
    expect([b.x, b.y]).toEqual([a.x, a.y]);
    await expect(withTenant(g.owner, g.org, (tx, ctx) => updateTable(tx, ctx, a.id, { active: true }))).rejects.toBeInstanceOf(
      ConflictError,
    );
    const plan = await withTenant(g.owner, g.org, (tx, ctx) => getFloorPlan(tx, ctx, g.est));
    expect(plan.activeTables).toBe(1);
  });

  it("mover entre zonas del mismo local; no a zonas de otro local", async () => {
    const terrace = await withTenant(f.owner, f.org, (tx, ctx) => createZone(tx, ctx, f.est, { name: "Terraza" }));
    const otherEst = await withTenant(f.owner, f.org, async (tx, ctx) => {
      const e = await createEstablishment(tx, ctx, { name: "Otro", slug: `otro-${uniqueSuffix()}` });
      return createZone(tx, ctx, e.id, { name: "Sala" });
    });
    const plan = await withTenant(f.owner, f.org, (tx, ctx) => getFloorPlan(tx, ctx, f.est));
    const m2 = plan.zones[0]!.tables.find((t) => t.name === "M2")!;
    const moved = await withTenant(f.owner, f.org, (tx, ctx) => moveTable(tx, ctx, m2.id, { x: 1, y: 1, zoneId: terrace }));
    expect(moved.zoneId).toBe(terrace);
    await expect(
      withTenant(f.owner, f.org, (tx, ctx) => moveTable(tx, ctx, m2.id, { x: 0, y: 0, zoneId: otherEst })),
    ).rejects.toBeInstanceOf(ValidationError);
    // La FK compuesta lo impide también en BD.
    await withAdminClient(async (c) => {
      await expect(c.query("UPDATE dining_tables SET zone_id = $1 WHERE id = $2", [otherEst, m2.id])).rejects.toThrow(
        /dining_tables_zone_fk/,
      );
    });
    await expect(withTenant(f.owner, f.org, (tx, ctx) => deleteZone(tx, ctx, terrace))).rejects.toBeInstanceOf(ConflictError);
    await withTenant(f.owner, f.org, (tx, ctx) => deleteTable(tx, ctx, m2.id));
    await withTenant(f.owner, f.org, (tx, ctx) => deleteZone(tx, ctx, terrace));
  });
});

describe("plano de sala: permisos y aislamiento", () => {
  it("staff ve el plano pero no lo modifica", async () => {
    const f = await setup("floor-roles");
    const t = await withTenant(f.owner, f.org, (tx, ctx) => createTable(tx, ctx, f.zone, { name: "M1", maxCapacity: 4 }));
    const staff = await createTestUser("floor-staff");
    await addMember(f.org, staff, "staff");
    await expect(withTenant(staff, f.org, (tx, ctx) => getFloorPlan(tx, ctx, f.est))).resolves.toMatchObject({ totalSeats: 4 });
    for (const op of [
      (tx: never, ctx: never) => moveTable(tx, ctx, t.id, { x: 4, y: 4 }),
      (tx: never, ctx: never) => createTable(tx, ctx, f.zone, { name: "M9", maxCapacity: 2 }),
      (tx: never, ctx: never) => createZone(tx, ctx, f.est, { name: "Terraza" }),
      (tx: never, ctx: never) => deleteTable(tx, ctx, t.id),
    ]) {
      await expect(run(f, op, staff)).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it("A no ve ni modifica zonas o mesas de B", async () => {
    const a = await setup("floor-a");
    const b = await setup("floor-b");
    const tb = await withTenant(b.owner, b.org, (tx, ctx) => createTable(tx, ctx, b.zone, { name: "B1", maxCapacity: 4 }));
    for (const op of [
      (tx: never, ctx: never) => getFloorPlan(tx, ctx, b.est),
      (tx: never, ctx: never) => createZone(tx, ctx, b.est, { name: "Intrusa" }),
      (tx: never, ctx: never) => updateZone(tx, ctx, b.zone, { name: "Hackeada" }),
      (tx: never, ctx: never) => deleteZone(tx, ctx, b.zone),
      (tx: never, ctx: never) => createTable(tx, ctx, b.zone, { name: "X", maxCapacity: 2 }),
      (tx: never, ctx: never) => updateTable(tx, ctx, tb.id, { name: "Hackeada" }),
      (tx: never, ctx: never) => moveTable(tx, ctx, tb.id, { x: 5, y: 3 }),
      (tx: never, ctx: never) => deleteTable(tx, ctx, tb.id),
    ]) {
      await expect(run(a, op)).rejects.toBeInstanceOf(NotFoundError);
    }
    // Mover una mesa propia a una zona de B.
    const ta = await withTenant(a.owner, a.org, (tx, ctx) => createTable(tx, ctx, a.zone, { name: "A1", maxCapacity: 2 }));
    await expect(
      withTenant(a.owner, a.org, (tx, ctx) => moveTable(tx, ctx, ta.id, { x: 0, y: 0, zoneId: b.zone })),
    ).rejects.toBeInstanceOf(NotFoundError);
    const planB = await withTenant(b.owner, b.org, (tx, ctx) => getFloorPlan(tx, ctx, b.est));
    expect(planB.zones[0]!.tables.map((t) => [t.name, t.x, t.y])).toEqual([["B1", 0, 0]]);

    await withAppClient(async (c) => {
      await c.query("BEGIN");
      try {
        await c.query("SELECT set_config('app.user_id', $1, true), set_config('app.org_id', $2, true)", [a.owner.id, a.org]);
        for (const t of ["zones", "dining_tables"]) {
          const { rows } = await c.query(`SELECT count(*)::int AS n FROM ${t} WHERE organization_id <> $1`, [a.org]);
          expect(rows[0].n, t).toBe(0);
        }
        const upd = await c.query("UPDATE dining_tables SET x = 9 WHERE id = $1", [tb.id]);
        expect(upd.rowCount).toBe(0);
      } finally {
        await c.query("ROLLBACK");
      }
    });
  });
});
